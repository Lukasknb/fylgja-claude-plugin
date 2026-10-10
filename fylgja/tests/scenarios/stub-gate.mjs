// The stand-in server's reading of Fylgja's memory gate
// (domain/services/memory_gate.py): whether a memory is taken, and the one
// line the server answers when it is not.
//
// The word lists, patterns and texts are read from server-gate.json, which
// gate-from-server.py writes out of the server's own file; nothing of them
// is typed here. The steps that read a sentence by those lists are written
// here after the server's, and gate-selfcheck.mjs holds them to the
// server's own verdict on every sentence of that file's `cases`.
import { readFileSync } from 'node:fs'

export const GATE = JSON.parse(readFileSync(new URL('./server-gate.json', import.meta.url), 'utf8'))

const OPENERS = [...GATE.conditionals, ...GATE.verbs]
const SUBJECTS = new Set(GATE.subjects)
const STATES = new RegExp(GATE.statement_verbs, 'i')
const STATUS = new RegExp(GATE.status_phrases, 'i')
const STATUS_WORD = new RegExp(GATE.status_words, 'gi')
const STATUS_ANCHOR = /#\d+|\b[A-Z]{2,6}-\d+\b|\b20\d\d-\d{2}-\d{2}\b|\b20\d\d\b/g
const TICKET = /#\d+|\b[A-Z]{2,6}-\d+\b/g
const N = GATE.narrative
const FIRST_PERSON = new Set(N.first_person)
const REPORT_OPENERS = new Set(N.report_openers)
const REPORT_TIMES = new RegExp(N.report_times)
const PAST_FORMS = new Set(N.past_forms)
const NOT_PAST_IN_ED = new Set(N.not_past_in_ed)
const ONLY_EVER_A_VERB = new Set(N.only_ever_a_verb)
const AFTER_A_VERB = new Set(N.after_a_verb)
const RELATIVES = new Set(N.relatives)

// Stands in for a code span, a quotation or an identifier while a sentence is read for its shape.
const CODE = '\u0000'
const SPANS = /`[^`]*`|"[^"]*"|“[^”]*”|\([^)]*\)/g
const TOKEN = /[^\s,;:—–]+/g
const PLAIN_WORD = /^[a-z]+(?:'[a-z]+)?$/
const EDGES = /^[.!?'’]+|[.!?'’]+$/g

/** The sentence as words to read its shape from, lowercased; whatever is not a plain word is a placeholder. */
function shapeTokens(content) {
  return (content.replace(SPANS, ` ${CODE} `).match(TOKEN) ?? []).map(raw => {
    const word = raw.replace(EDGES, '').toLowerCase()

    return PLAIN_WORD.test(word) ? word : CODE
  })
}

const isPast = word => PAST_FORMS.has(word) || (word.endsWith('ed') && !NOT_PAST_IN_ED.has(word) && word.length > 3)

/** Why a sentence reads as an account of what happened and not as what holds: its shape and the word that shows it; undefined for a statement or an instruction. */
export function narrativeOf(content) {
  const text = content.trim()
  const tokens = shapeTokens(text)

  if (tokens.every(token => token === CODE)) {
    return { shape: 'no_words', word: '' }
  }

  if (text.endsWith('?')) {
    return { shape: 'question', word: '?' }
  }

  const [first] = tokens

  if (FIRST_PERSON.has(first) || REPORT_OPENERS.has(first)) {
    return { shape: 'opener', word: first }
  }

  if (first.endsWith('ing') && first.length > 4) {
    return { shape: 'progress', word: first }
  }

  const when = REPORT_TIMES.exec(tokens.map(token => (token === CODE ? 'x' : token)).join(' '))

  if (when !== null) {
    return { shape: 'time', word: when[0].replace(/^[.!]+|[.!]+$/g, '') }
  }

  for (const [position, word] of tokens.slice(0, N.main_verb_within).entries()) {
    if (RELATIVES.has(word)) {
      break
    }

    if (word === CODE || !isPast(word)) {
      continue
    }

    const following = tokens[position + 1]

    if (ONLY_EVER_A_VERB.has(word) || following === undefined || AFTER_A_VERB.has(following)) {
      return { shape: 'past', word }
    }
  }

  return undefined
}

function readsAsStatus(text) {
  if (STATUS.test(text)) {
    return true
  }

  const anchors = [...text.matchAll(STATUS_ANCHOR)].map(match => [match.index, match.index + match[0].length])

  return [...text.matchAll(STATUS_WORD)].some(word =>
    anchors.some(([from, to]) => Math.min(Math.abs(word.index - to), Math.abs(from - (word.index + word[0].length))) <= 40),
  )
}

function opensAcceptably(sentence, kind) {
  const lowered = sentence.toLowerCase()

  if (OPENERS.some(opener => lowered.startsWith(opener) && !/^\w/.test(lowered.slice(opener.length)))) {
    return true
  }

  if ((kind === 'decision' || kind === 'correction') && STATES.test(sentence)) {
    return true
  }

  // A decision says what holds in whatever words say it; what it may not be is an account of what happened.
  return kind === 'decision' && narrativeOf(sentence) === undefined
}

/** The code of the first rule a memory breaks, or undefined when the server takes it. */
export function gate(kind, content, detail, triggers, reasonStatus, alternatives) {
  const sentence = String(content ?? '').trim()
  const both = `${sentence}\n${detail ?? ''}`
  const rules = [
    ['too_long', sentence.length > GATE.limits.content],
    ['detail_too_long', typeof detail === 'string' && detail.trim().length > GATE.limits.detail],
    ['not_one_sentence', (sentence.replace(/`[^`]*`/g, ' ').match(/[.!?](?:\s|$)/g) ?? []).length > 1],
    ['status_not_memory', readsAsStatus(both) || (both.match(TICKET) ?? []).length > 2],
    ['not_imperative', !opensAcceptably(sentence, kind)],
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

/** What the gate says of a sentence that is not shaped as its kind must be. */
function notImperative(sentence, kind) {
  const rule = GATE.hints.not_imperative

  if (kind === 'decision') {
    const found = narrativeOf(sentence)
    const said =
      found === undefined
        ? 'content is not a decision'
        : N.says[found.shape].replace('{word}', found.word.slice(0, GATE.max_echoed_word))

    return `${said}. Rule: ${N.rule}. State the decision itself, for example ${N.rewrites}`
  }

  const word = sentence.match(/^[A-Za-z][A-Za-z'_-]*/)?.[0].slice(0, GATE.max_echoed_word)

  if (word === undefined) {
    return `content does not open with a word. Rule: ${rule}. Rewrite it as, for example, "Run <the command> when <the symptom>" or "Never <do this> without <that>"`
  }

  const verb = word.toLowerCase()

  return SUBJECTS.has(verb) || verb.endsWith('ed') || verb.endsWith('ing')
    ? `content opens with "${word}", which tells what happened or what is the case. Rule: ${rule}. State the rule that came out of it, for example "Always <do this> before <that>" or "Check <this> when <that happens>"`
    : `content opens with "${word}", which is not an opener the gate knows as an instruction. Rule: ${rule}. Keep your sentence and open it with one it knows, for example "Always ${verb} <…>" or "Use <…> to ${verb} <…>"`
}

/** The one line a refused write gets: its code, what to do, and one acceptable rewrite. */
export function refusalText(rule, content, kind) {
  const hint = rule === 'not_imperative' ? notImperative(String(content ?? '').trim(), kind) : GATE.hints[rule]
  const example = GATE.examples[rule]

  return example === undefined ? `refused:${rule} — ${hint}` : `refused:${rule} — ${hint}. Acceptable instead: ${example}`
}
