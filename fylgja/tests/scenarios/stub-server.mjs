// A stand-in for Fylgja's server, for the scenario run: an MCP server over
// stdio under the name the plugin's own server has, with the tools the
// plugin calls. It answers in the shapes of the real server's contracts
// (`MemoryContextResponse`, `MemoryRememberResponse`, `MemoryAmendResponse`,
// `CommitAttachResponse`, `WhoAmIResponse`) and refuses what the real
// server's gate and anchor rules refuse, in its words (`refused:<rule> — …`).
// It holds the records the scenarios give it, keeps what is written in
// memory, and appends one line per call to the file named in
// SCRIBE_STUB_LOG. It reaches no network and no real knowledge base.
import { randomUUID } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const scenarios = JSON.parse(readFileSync(process.env.SCRIBE_SCENARIOS, 'utf8'))
const LOG = process.env.SCRIBE_STUB_LOG

// Who the stand-in is signed in as; SCRIBE_STUB_USER names another user.
const WHO = {
  user: { id: process.env.SCRIBE_STUB_USER ?? '11111111-0000-4000-8000-000000000001', display_name: 'Scenario Runner' },
  team: { id: '22222222-0000-4000-8000-000000000002', name: 'Stand-in' },
  profile: { id: '33333333-0000-4000-8000-000000000003', name: 'Work' },
}

const held = new Map(scenarios.map(scenario => [scenario.repo, (scenario.records ?? []).map(asStored)]))

const loose = { type: 'object', additionalProperties: true }
const TOOLS = ['whoami', 'recall', 'search', 'open', 'resolve', 'remember', 'amend_memory', 'attach_commit'].map(name => ({
  name,
  description: `Stand-in for Fylgja's ${name}.`,
  inputSchema: loose,
}))

const json = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false })
const failed = text => ({ content: [{ type: 'text', text }], isError: true })
const everything = () => [...held.values()].flat()

// ---- the server's gate (domain/services/memory_gate.py) ----
const OPENERS = [
  'after', 'always', 'before', 'do not', "don't", 'for', 'if', 'never', 'on', 'only', 'when',
  'add', 'assume', 'avoid', 'bind', 'build', 'call', 'cap', 'check', 'confirm', 'configure', 'copy', 'delete', 'deploy',
  'disable', 'drop', 'enable', 'ensure', 'expect', 'export', 'fetch', 'grant', 'install', 'keep', 'kill', 'label', 'leave',
  'limit', 'log', 'make', 'merge', 'mount', 'move', 'pass', 'pin', 'point', 'prefer', 'put', 'query', 'read', 'rebuild',
  'reboot', 'reindex', 'remove', 'rename', 'restart', 'restore', 'retry', 'reuse', 'revoke', 'rotate', 'route', 'run', 'send',
  'set', 'skip', 'split', 'stamp', 'start', 'stop', 'store', 'tag', 'treat', 'update', 'use', 'verify', 'wait', 'wrap', 'write',
] // prettier-ignore
const STATES = /\b(is|are|must|stays|becomes)\b/i
const STATUS = /\b(open PR|draft PR|in review|awaiting review|blocked on|waiting for|as of 20\d\d|is now live)\b/i
const STATUS_WORD = /\b(merged|pending|landed|WIP|awaiting|deployed on)\b/gi
const STATUS_ANCHOR = /#\d+|\b[A-Z]{2,6}-\d+\b|\b20\d\d-\d{2}-\d{2}\b|\b20\d\d\b/g
const TICKET = /#\d+|\b[A-Z]{2,6}-\d+\b/g
const HINTS = {
  too_long:
    'content is one imperative sentence of at most 220 characters — put the reasoning, the exact commands and the paths in detail',
  detail_too_long: 'detail is at most 1200 characters — this is a memory, not a write-up',
  not_one_sentence: 'content is ONE sentence — everything after the first full stop belongs in detail',
  status_not_memory:
    'this is the state of the world today, not something that will still be true next month; write the rule you learned instead, or nothing',
  not_imperative: 'content must start with an instruction (Use, Never, Always, Run, Check, Before, When …)',
  no_trigger:
    'a runbook or gotcha nobody can be warned about is unreachable — pass the verbatim command or error keywords in triggers',
  burst: 'batch settled findings at the end of the task; one atom per fact',
  not_a_decision:
    'alternatives and reason_status describe a decision: what was ruled out, and whether a reason was given. This kind has neither',
  reason_missing:
    'a decision says why. Put the reason in detail. If there is none on record, say which case it is: reason_status="not_stated" or reason_status="no_strong_reason"',
  reason_contradiction:
    'detail and reason_status disagree: stated needs a reason in detail, and not_stated means there is no reason to put in detail',
  alternatives_too_many: 'alternatives holds at most 6 options of at most 220 characters each',
}
const refusal = rule => failed(`refused:${rule} — ${HINTS[rule]}`)

function readsAsStatus(text) {
  if (STATUS.test(text)) {
    return true
  }

  const anchors = [...text.matchAll(STATUS_ANCHOR)].map(match => [match.index, match.index + match[0].length])

  return [...text.matchAll(STATUS_WORD)].some(word =>
    anchors.some(([from, to]) => word.index + word[0].length >= from - 40 && word.index <= to + 40),
  )
}

function gate(kind, content, detail, triggers, reasonStatus, alternatives) {
  const sentence = String(content ?? '').trim()
  const both = `${sentence}\n${detail ?? ''}`
  const opens = OPENERS.some(opener =>
    new RegExp(`^${opener.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(sentence.toLowerCase()),
  )
  const rules = [
    ['too_long', sentence.length > 220],
    ['detail_too_long', typeof detail === 'string' && detail.trim().length > 1200],
    ['not_one_sentence', (sentence.replace(/`[^`]*`/g, ' ').match(/[.!?](?:\s|$)/g) ?? []).length > 1],
    ['status_not_memory', readsAsStatus(both) || (both.match(TICKET) ?? []).length > 2],
    ['not_imperative', !(opens || ((kind === 'decision' || kind === 'correction') && STATES.test(sentence)))],
    ['no_trigger', (kind === 'gotcha' || kind === 'runbook') && !(triggers ?? []).some(trigger => String(trigger).trim() !== '')],
  ]
  const broken = rules.find(([, isBroken]) => isBroken)?.[0]

  if (broken !== undefined) {
    return broken
  }

  const hasReason = String(detail ?? '').trim() !== ''
  const options = alternatives ?? []

  if (kind !== 'decision') {
    return reasonStatus !== undefined || options.length > 0 ? 'not_a_decision' : undefined
  }

  if (options.length > 6 || options.some(option => String(option).length > 220)) {
    return 'alternatives_too_many'
  }

  if (reasonStatus === undefined) {
    return hasReason ? undefined : 'reason_missing'
  }

  return (reasonStatus === 'stated' && !hasReason) || (reasonStatus === 'not_stated' && hasReason)
    ? 'reason_contradiction'
    : undefined
}

// ---- the server's anchor rules (domain/services/code_anchor.py) ----
const PATH_RULE =
  "a path is relative to the repository root with '/' separators, e.g. 'apps/api/app/main.py' or 'apps/api' for a directory: no leading '/', no trailing '/', no '.' or '..' segment, no backslash, no drive letter, no control character, no line number, at most 400 characters"

function pathFault(path) {
  const segments = String(path).split('/')
  const rules = [
    ['is empty', !path],
    ['contains a control character', /[\x00-\x1f\x7f]/.test(path)],
    ['is longer than 400 characters', path.length > 400],
    ['contains a backslash', path.includes('\\')],
    ['starts with a drive letter', /^[A-Za-z]:/.test(path)],
    ["is absolute (starts with '/')", path.startsWith('/')],
    ["ends with '/'", path.endsWith('/')],
    ["contains a '..' segment", segments.includes('..')],
    ["contains a '.' segment", segments.includes('.')],
    ["contains an empty segment ('//')", segments.includes('')],
    ['starts or ends with whitespace', path !== path.trim()],
  ]

  return (
    rules.find(([, isBroken]) => isBroken)?.[0] ??
    (/(:\d+(-\d+)?(:\d+)?|#L\d+(-L?\d+)?)$/.test(path) ? 'ends with a line reference' : undefined)
  )
}

function anchorsFault(anchors) {
  if (anchors.length > 12) {
    return `anchors holds ${anchors.length} entries; at most 12 — anchor the directory instead`
  }

  for (const [position, anchor] of anchors.entries()) {
    const fault = typeof anchor?.path === 'string' ? pathFault(anchor.path) : 'is empty'

    if (fault !== undefined) {
      return `anchors[${position}].path ${fault} — ${PATH_RULE}`
    }

    if (typeof anchor.symbol === 'string' && anchor.symbol.trim().length > 200) {
      return `anchors[${position}].symbol is longer than 200 characters — a symbol is a name, not a snippet`
    }
  }

  return undefined
}

// ---- records as the server returns them ----
function asStored(record) {
  return {
    topic_title: null,
    triggers: [],
    confidence: 0.9,
    volatility: 'stable',
    last_verified: '2026-08-03T09:00:00Z',
    staleness: 'fresh',
    newer_value: null,
    may_be_replaced_by: [],
    detail: null,
    alternatives: [],
    reason_status: null,
    origin: 'scribe',
    commits: [],
    written_by: WHO.user.id,
    ...record,
    // A scenario writes its anchors as a list of paths; each is the author's.
    anchors: (Array.isArray(record.anchors) ? record.anchors : (record.anchors?.paths ?? [])).map(anchor => ({
      path: anchor.path,
      symbol: anchor.symbol ?? null,
      added_by: anchor.added_by ?? 'author',
    })),
  }
}

/** The record's anchors as a read returns them: the most recent twelve paths and five commits, and the totals. */
function anchorsOut(record, matched = []) {
  const paths = record.anchors
  const shown =
    paths.length <= 12 ? paths : [...paths.filter(anchor => matched.includes(anchor.path)), ...paths.slice(-12)].slice(0, 12)

  return { paths: shown, commits: record.commits.slice(-5), paths_total: paths.length, commits_total: record.commits.length }
}

function asFact(record, asked) {
  const dirs = path => path.split('/').map((_, at, all) => all.slice(0, at + 1).join('/'))
  const matched =
    asked === undefined ? null : asked.filter(path => record.anchors.some(anchor => dirs(path).includes(anchor.path)))
  const { commits, written_by, link, ...rest } = record

  return { ...rest, ...(link === undefined ? {} : { link }), anchors: anchorsOut(record, matched ?? []), matched_paths: matched }
}

const bursts = new Map()

function call(name, args) {
  const records = held.get(args.repo) ?? []

  if (name === 'whoami') {
    return json(WHO)
  }

  if (name === 'recall') {
    if (Array.isArray(args.paths)) {
      const fault =
        args.paths.length > 30 ? 'paths holds too many entries' : args.paths.map(pathFault).find(found => found !== undefined)

      if (fault !== undefined) {
        return failed(`paths ${fault} — ${PATH_RULE}`)
      }
    }

    const facts = records
      .map(record => asFact(record, Array.isArray(args.paths) ? args.paths : undefined))
      .filter(fact => fact.matched_paths === null || fact.matched_paths.length > 0)

    return json({ repo: args.repo, facts, known_repos: [], repo_hint: null })
  }

  if (name === 'search') {
    return json({
      results: everything()
        .slice(0, 5)
        .map(record => asFact(record)),
    })
  }

  if (name === 'open' || name === 'resolve') {
    const record = everything().find(one => one.id === args.id)

    return record === undefined ? failed('record not found') : json(asFact(record))
  }

  if (name === 'remember') {
    const anchors = args.anchors ?? []
    const fault = anchorsFault(anchors)

    if (fault !== undefined) {
      return failed(fault)
    }

    const rule = gate(args.kind ?? 'gotcha', args.content, args.detail, args.triggers, args.reason_status, args.alternatives)

    if (rule !== undefined) {
      return refusal(rule)
    }

    // Scribe may write twelve records a session in ten minutes; the thirteenth is refused.
    const written = bursts.get(args.session_id) ?? 0

    if (args.author === 'scribe' && written >= 12) {
      return refusal('burst')
    }

    const existing = records.find(record => record.content === args.content)

    if (existing !== undefined) {
      const isTheirs = existing.written_by !== WHO.user.id
      const fresh = anchors.filter(
        anchor => !existing.anchors.some(had => had.path === anchor.path && (had.symbol ?? null) === (anchor.symbol ?? null)),
      )

      existing.anchors.push(
        ...fresh.map(anchor => ({ path: anchor.path, symbol: anchor.symbol ?? null, added_by: isTheirs ? 'you' : 'author' })),
      )

      return json({
        atom_id: existing.id,
        outcome: 'duplicate',
        supersede: 'not_requested',
        superseded_prior_id: null,
        supersede_rejected_reason: null,
        grounding_flagged: false,
        anchors: anchorsOut(existing),
        anchors_added: fresh.length,
        reason_status: existing.reason_status,
        known_repos: [],
        repo_hint: null,
        note: isTheirs
          ? "this record is another member's: only its author changes its text, reason or alternatives, so those were left as they are"
          : null,
      })
    }

    const record = asStored({
      id: randomUUID(),
      type: args.kind ?? 'gotcha',
      content: args.content,
      detail: args.detail ?? null,
      triggers: args.triggers ?? [],
      alternatives: args.alternatives ?? [],
      anchors,
      reason_status: (args.kind ?? 'gotcha') === 'decision' ? (args.reason_status ?? 'stated') : null,
      origin: args.author ?? 'assistant',
      session_id: args.session_id,
    })
    const prior = args.supersedes === undefined ? undefined : everything().find(one => one.id === args.supersedes)

    bursts.set(args.session_id, written + 1)
    held.set(args.repo, [...records, record])

    return json({
      atom_id: record.id,
      outcome: 'created',
      supersede: args.supersedes === undefined ? 'not_requested' : prior === undefined ? 'rejected' : 'applied',
      superseded_prior_id: prior?.id ?? null,
      supersede_rejected_reason: args.supersedes !== undefined && prior === undefined ? 'no such memory' : null,
      grounding_flagged: false,
      anchors: anchorsOut(record),
      anchors_added: record.anchors.length,
      reason_status: record.reason_status,
      known_repos: [],
      repo_hint: null,
      note: null,
    })
  }

  if (name === 'amend_memory') {
    const record = everything().find(one => one.id === args.atom_id && one.written_by === WHO.user.id)

    if (record === undefined) {
      return failed('record not found')
    }

    if (args.op === 'remove') {
      for (const [repo, list] of held) {
        held.set(
          repo,
          list.filter(one => one !== record),
        )
      }

      return json({ atom_id: record.id, outcome: 'removed', restored_prior_id: null })
    }

    const content = args.content ?? record.content
    const detail = args.detail ?? record.detail
    const taken = everything().find(one => one !== record && one.content === content)

    if (taken !== undefined) {
      return failed(`atom ${taken.id} on this topic already says this; atom ${record.id} was not changed`)
    }

    const status = args.reason_status ?? (String(detail ?? '').trim() === '' ? (record.reason_status ?? undefined) : undefined)
    const rule = gate(
      record.type,
      content,
      detail,
      record.triggers,
      status === 'stated' ? undefined : status,
      args.alternatives ?? record.alternatives,
    )

    if (rule !== undefined) {
      return refusal(rule)
    }

    const isChanged =
      content !== record.content ||
      detail !== record.detail ||
      args.reason_status !== undefined ||
      args.alternatives !== undefined

    Object.assign(record, {
      content,
      detail,
      alternatives: args.alternatives ?? record.alternatives,
      reason_status:
        record.type === 'decision'
          ? (args.reason_status ?? (String(detail ?? '').trim() === '' ? record.reason_status : 'stated'))
          : null,
    })

    return json({ atom_id: record.id, outcome: isChanged ? 'fixed' : 'unchanged', restored_prior_id: null })
  }

  if (name === 'attach_commit') {
    if (!/^[0-9a-f]{7,40}$/.test(String(args.sha))) {
      return failed(
        "sha is not a commit — a commit is its lowercase hex sha, 7 to 40 characters, e.g. '4d9da09a' (git rev-parse HEAD)",
      )
    }

    const mine = records.filter(record => record.session_id === args.session_id && record.commits.length === 0)

    for (const record of mine) {
      record.commits.push(args.sha)
    }

    return json({ attached: mine.length, atom_ids: mine.map(record => record.id) })
  }

  return failed(`Unknown tool: ${name}`)
}

const send = message => process.stdout.write(`${JSON.stringify(message)}\n`)

createInterface({ input: process.stdin }).on('line', line => {
  let request

  try {
    request = JSON.parse(line)
  } catch {
    return
  }

  if (request.id === undefined) {
    return
  }

  const reply = result => send({ jsonrpc: '2.0', id: request.id, result })

  if (request.method === 'initialize') {
    reply({
      protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'fylgja-stub', version: '0.0.2' },
    })
  } else if (request.method === 'tools/list') {
    reply({ tools: TOOLS })
  } else if (request.method === 'tools/call') {
    const { name, arguments: args = {} } = request.params ?? {}
    const result = call(name, args)

    if (LOG) {
      appendFileSync(LOG, `${JSON.stringify({ tool: name, args, isError: result.isError })}\n`)
    }

    reply(result)
  } else {
    reply({})
  }
})
