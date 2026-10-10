// Writes hooks/scribe/shape.ts: the server's rules for the shape of a
// record, as Scribe's instruction states them to its model, out of
// server-gate.json (which gate-from-server.py writes out of the server's own
// file). Nothing of them is typed by hand: run this after the gate file
// changes.
//
//   node shape-from-gate.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const gate = JSON.parse(readFileSync(new URL('./server-gate.json', import.meta.url), 'utf8'))
const words = pattern =>
  pattern
    .replace(/^\\b\(|\)\\b$/g, '')
    .split('|')
    .map(word => word.replace(/(?:\\d)+/g, 'NN'))
const list = values => `[\n${values.map(value => `  ${JSON.stringify(value)},`).join('\n')}\n]`

writeFileSync(
  new URL('../../hooks/scribe/shape.ts', import.meta.url),
  `/**
 * The shape Fylgja's server takes a record in, for Scribe's instruction to
 * state to its model so that a record passes the first time it is sent.
 *
 * Written by tests/scenarios/shape-from-gate.mjs out of the server's own
 * rules as they stood at its commit ${gate.commit}. Not edited by hand.
 */

/** Words that may open a sentence before its instruction: "Never run …". */
export const CONDITIONAL_OPENERS: readonly string[] = ${list(gate.conditionals)}

/** Verbs that may open a sentence as an instruction. */
export const VERB_OPENERS: readonly string[] = ${list(gate.verbs)}

/** A decision or a correction may be a statement instead, when it holds one of these words. */
export const STATEMENT_WORDS: readonly string[] = ${list(words(gate.statement_verbs))}

/** Phrases that make a sentence a report of where something stands; such a sentence is refused. */
export const STATUS_PHRASES: readonly string[] = ${list(words(gate.status_phrases))}

/** Words that make it one when they stand beside a ticket, a pull request or a date. */
export const STATUS_WORDS: readonly string[] = ${list(words(gate.status_words))}

export const SHAPE_LIMITS = {
  /** The longest sentence, in characters. */
  content: ${gate.limits.content},
  /** The longest reason. */
  detail: ${gate.limits.detail},
  /** How many alternatives a decision may list, and the longest of them. */
  alternatives: ${gate.limits.alternatives},
  alternative: ${gate.limits.alternative},
} as const
`,
)
