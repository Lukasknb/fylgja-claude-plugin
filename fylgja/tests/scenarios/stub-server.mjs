// A stand-in for Fylgja's server, for the scenario run: an MCP server over
// stdio under the name the plugin's own server has, with the seven tools
// Scribe calls. It holds the records the scenarios give it, keeps what is
// written in memory, and appends one line per call to the file named in
// SCRIBE_STUB_LOG. It reaches no network and no real knowledge base.
import { randomUUID } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const scenarios = JSON.parse(readFileSync(process.env.SCRIBE_SCENARIOS, 'utf8'))
const LOG = process.env.SCRIBE_STUB_LOG
const held = new Map(scenarios.map(scenario => [scenario.repo, [...(scenario.records ?? [])]]))

const loose = { type: 'object', additionalProperties: true }
const TOOLS = ['recall', 'search', 'open', 'resolve', 'remember', 'amend_memory', 'attach_commit'].map(name => ({
  name,
  description: `Stand-in for Fylgja's ${name}.`,
  inputSchema: loose,
}))

const json = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false })
const refused = why => ({ content: [{ type: 'text', text: `refused:${why}` }], isError: true })
const everything = () => [...held.values()].flat()

/** The server's own rules for a write, as far as Scribe can trip them. */
function gate(args) {
  if (typeof args.content !== 'string' || args.content.length === 0 || args.content.length > 220) {
    return 'too_long — content is one imperative sentence of at most 220 characters'
  }

  if ((args.kind === 'gotcha' || args.kind === 'runbook') && !(Array.isArray(args.triggers) && args.triggers.length > 0)) {
    return 'no_trigger — pass the verbatim command or error keywords in triggers'
  }

  const detail = typeof args.detail === 'string' ? args.detail.trim() : ''

  if (args.kind === 'decision') {
    if (detail === '' && args.reason_status !== 'not_stated' && args.reason_status !== 'no_strong_reason') {
      return 'no_reason — a decision needs its reason in detail, or reason_status not_stated or no_strong_reason'
    }

    if (detail !== '' && args.reason_status === 'not_stated') {
      return 'contradictory — not_stated together with a detail'
    }
  } else if (args.reason_status !== undefined || args.alternatives !== undefined) {
    return 'not_a_decision — reason_status and alternatives belong to a decision'
  }

  return undefined
}

function call(name, args) {
  const records = held.get(args.repo) ?? []

  if (name === 'recall') {
    const paths = Array.isArray(args.paths) ? args.paths : undefined
    const facts =
      paths === undefined
        ? records
        : records.filter(record =>
            record.anchors.some(anchor => paths.some(path => path === anchor.path || path.startsWith(`${anchor.path}/`))),
          )

    return json({ repo: args.repo, facts })
  }

  if (name === 'search') {
    return json({ results: everything().slice(0, 5) })
  }

  if (name === 'open' || name === 'resolve') {
    const record = everything().find(one => one.id === args.id)

    return record === undefined ? refused('not_found') : json(record)
  }

  if (name === 'remember') {
    const why = gate(args)

    if (why !== undefined) {
      return refused(why)
    }

    const duplicate = records.find(record => record.content === args.content)

    if (duplicate !== undefined) {
      return json({ atom_id: duplicate.id, outcome: 'duplicate', supersede: 'not_requested' })
    }

    const record = {
      id: randomUUID(),
      type: args.kind,
      content: args.content,
      detail: args.detail ?? '',
      alternatives: args.alternatives ?? [],
      anchors: args.anchors ?? [],
      reason_status: args.reason_status ?? (args.kind === 'decision' ? 'stated' : null),
      origin: args.author,
    }

    held.set(args.repo, [...records, record])

    return json({
      atom_id: record.id,
      outcome: 'created',
      supersede: args.supersedes === undefined ? 'not_requested' : 'applied',
      anchors: record.anchors,
      reason_status: record.reason_status,
    })
  }

  if (name === 'amend_memory') {
    return json({ atom_id: args.atom_id, outcome: args.op === 'remove' ? 'removed' : 'fixed' })
  }

  if (name === 'attach_commit') {
    return json({ attached: 0, atom_ids: [] })
  }

  return refused(`unknown tool ${name}`)
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
      serverInfo: { name: 'fylgja-stub', version: '0.0.1' },
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
