// The stand-in server's verdict on a memory: whether Fylgja's gate
// (domain/services/memory_gate.py) takes it, and the one line the server
// answers when it does not.
//
// With SCRIBE_SERVER_GATE naming the server's own memory_gate.py on this
// machine, the verdict is the server's: its code is run (gate-check.py), not
// copied. That is how a measured run is made.
//
// Without it, the rules that are lists and lengths are applied from
// server-gate.json (which gate-from-server.py writes out of the server's
// file): length, one sentence, status, how a gotcha or a correction opens,
// and a decision's reason and alternatives. The server's rule for what makes
// a decision an account of what happened is long and still moving, and is
// NOT applied then: every decision that passes the other rules is taken.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const GATE = JSON.parse(readFileSync(new URL('./server-gate.json', import.meta.url), 'utf8'))

/** The server's own file, when this machine has it. */
export const SERVER = process.env.SCRIBE_SERVER_GATE || undefined

const OPENERS = [...GATE.conditionals, ...GATE.verbs]
const SUBJECTS = new Set(GATE.subjects)
const STATES = new RegExp(GATE.statement_verbs, 'i')
const STATUS = new RegExp(GATE.status_phrases, 'i')
const STATUS_WORD = new RegExp(GATE.status_words, 'gi')
const STATUS_ANCHOR = /#\d+|\b[A-Z]{2,6}-\d+\b|\b20\d\d-\d{2}-\d{2}\b|\b20\d\d\b/g
const TICKET = /#\d+|\b[A-Z]{2,6}-\d+\b/g

function readsAsStatus(text) {
  if (STATUS.test(text)) {
    return true
  }

  const anchors = [...text.matchAll(STATUS_ANCHOR)].map(match => [match.index, match.index + match[0].length])

  return [...text.matchAll(STATUS_WORD)].some(word =>
    anchors.some(([from, to]) => Math.min(Math.abs(word.index - to), Math.abs(from - (word.index + word[0].length))) <= 40),
  )
}

/** The code of the first rule a memory breaks by the lists and lengths alone; undefined when it breaks none. */
function listed(kind, content, detail, triggers, reasonStatus, alternatives) {
  const sentence = String(content ?? '').trim()
  const both = `${sentence}\n${detail ?? ''}`
  const lowered = sentence.toLowerCase()
  const opens =
    kind === 'decision' ||
    OPENERS.some(opener => lowered.startsWith(opener) && !/^\w/.test(lowered.slice(opener.length))) ||
    (kind === 'correction' && STATES.test(sentence))
  const rules = [
    ['too_long', sentence.length > GATE.limits.content],
    ['detail_too_long', typeof detail === 'string' && detail.trim().length > GATE.limits.detail],
    ['not_one_sentence', (sentence.replace(/`[^`]*`/g, ' ').match(/[.!?](?:\s|$)/g) ?? []).length > 1],
    ['status_not_memory', readsAsStatus(both) || (both.match(TICKET) ?? []).length > 2],
    ['not_imperative', !opens],
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

  if (options.length > GATE.limits.alternatives || options.some(option => String(option).length > GATE.limits.alternative)) {
    return 'alternatives_too_many'
  }

  if (reasonStatus === undefined) {
    return hasReason ? undefined : 'reason_missing'
  }

  return (reasonStatus === 'stated' && !hasReason) || (reasonStatus === 'not_stated' && hasReason)
    ? 'reason_contradiction'
    : undefined
}

/** What the gate says of a gotcha or a correction that does not open as an instruction. */
function notImperative(sentence) {
  const rule = GATE.hints.not_imperative
  const word = sentence.match(/^[A-Za-z][A-Za-z'_-]*/)?.[0].slice(0, GATE.max_echoed_word)

  if (word === undefined) {
    return `content does not open with a word. Rule: ${rule}. Rewrite it as, for example, "Run <the command> when <the symptom>" or "Never <do this> without <that>"`
  }

  const verb = word.toLowerCase()

  return SUBJECTS.has(verb) || verb.endsWith('ed') || verb.endsWith('ing')
    ? `content opens with "${word}", which tells what happened or what is the case. Rule: ${rule}. State the rule that came out of it, for example "Always <do this> before <that>" or "Check <this> when <that happens>"`
    : `content opens with "${word}", which is not an opener the gate knows as an instruction. Rule: ${rule}. Keep your sentence and open it with one it knows, for example "Always ${verb} <…>" or "Use <…> to ${verb} <…>"`
}

/** The one line the server answers for a rule that was broken. */
export function refusalText(rule, content) {
  const hint = rule === 'not_imperative' ? notImperative(String(content ?? '').trim()) : GATE.hints[rule]
  const example = GATE.examples[rule]

  return example === undefined ? `refused:${rule} — ${hint}` : `refused:${rule} — ${hint}. Acceptable instead: ${example}`
}

/**
 * The one line the server answers for a memory it does not take, or
 * undefined when it takes it.
 *
 * @param reasonStatus as the caller sent it; undefined when it sent none
 */
export function refusalOf(kind, content, detail, triggers, reasonStatus, alternatives) {
  if (SERVER !== undefined) {
    const asked = {
      kind,
      content,
      detail: detail ?? null,
      triggers: triggers ?? [],
      reason_status: reasonStatus ?? null,
      alternatives: alternatives ?? [],
    }
    const ran = spawnSync('python3', ['-I', fileURLToPath(new URL('./gate-check.py', import.meta.url)), SERVER], {
      input: `${JSON.stringify(asked)}\n`,
      encoding: 'utf8',
      timeout: 10_000,
    })

    if (ran.status !== 0) {
      throw new Error(`the server's gate could not be run: ${ran.stderr?.slice(0, 200)}`)
    }

    return JSON.parse(ran.stdout).refusal ?? undefined
  }

  const rule = listed(kind, content, detail, triggers, reasonStatus, alternatives)

  return rule === undefined ? undefined : refusalText(rule, content)
}
