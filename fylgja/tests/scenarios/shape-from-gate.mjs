// Writes hooks/scribe/shape.ts: the server's rules for the shape of a
// record, as Scribe's instruction states them to its model, and
// hooks/scribe/bar.ts: the server's bar of what is worth recording at all,
// out of server-gate.json (which gate-from-server.py writes out of the
// server's own files). Nothing of them is typed by hand: run this after the
// gate file changes.
//
//   node shape-from-gate.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const gate = JSON.parse(readFileSync(new URL('./server-gate.json', import.meta.url), 'utf8'))
const words = pattern =>
  pattern
    .replace(/^\\b\(|\)\\b$/g, '')
    .split('|')
    .map(word => word.replace(/(?:\\d)+/g, 'NN'))
// The sentences the server's own refusals give as acceptable, sorted by how they open.
const openers = [...gate.conditionals, ...gate.verbs]
const examples = Object.values(gate.examples).flatMap(text => [...text.matchAll(/content="([^"]+)"/g)].map(match => match[1]))
const isInstruction = sentence => openers.some(opener => new RegExp(`^${opener}\\b`, 'i').test(sentence))
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

/** Instructions the server's own refusals give as acceptable: how a gotcha or a correction is worded. */
export const INSTRUCTION_EXAMPLES: readonly string[] = ${list(examples.filter(isInstruction))}

/** Statements they give as acceptable: how a decision is worded. */
export const STATEMENT_EXAMPLES: readonly string[] = ${list(examples.filter(sentence => !isInstruction(sentence)))}

/** The server's rule for a decision, in its own words, and the two rewrites its refusal offers. */
export const DECISION_RULE = ${JSON.stringify(gate.narrative.rule)}
export const DECISION_REWRITES = ${JSON.stringify(gate.narrative.rewrites)}

/** Words that open a report of work in progress, a question, and a guess: none of them is a decision. */
export const PROGRESS_OPENERS: readonly string[] = ${list(gate.narrative.progress_openers)}
export const QUESTION_OPENERS: readonly string[] = ${list(gate.narrative.question_openers)}
export const HEDGES: readonly string[] = ${list(gate.narrative.hedges)}

/** Words a decision may not open with: who did it, when it was, how far it has got. Such a sentence is an account. */
export const ACCOUNT_OPENERS: readonly string[] = ${list([...gate.narrative.first_person, ...gate.narrative.report_openers])}

/** Words a sentence opens with when it tells what happened or what is the case, and gives no instruction. */
export const NARRATIVE_OPENERS: readonly string[] = ${list(gate.subjects)}

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

const bar = gate.bar
writeFileSync(
  new URL('../../hooks/scribe/bar.ts', import.meta.url),
  `/**
 * The bar a record clears before the knowledge base keeps it, in the words
 * Fylgja's server states it in: to the coding assistant in its remember
 * tool, and to the model that judges the assistant's decisions. Scribe's
 * instruction states the same words, so the two hold one bar.
 *
 * Written by tests/scenarios/shape-from-gate.mjs out of the server's own
 * text (domain/services/memory_bar.py) as it stood at its commit ${gate.commit}.
 * Not edited by hand.
 */

/** The one test, as a question. */
export const BAR_QUESTION = ${JSON.stringify(bar.question)}

/** The default answer to it. */
export const BAR_DEFAULT = ${JSON.stringify(bar.default)}

/** How the work is organised: never a record, however carefully it was weighed. */
export const WORK_ORGANISATION = ${JSON.stringify(bar.work_organisation)}

/** Why work organisation never passes the test. */
export const WORK_ORGANISATION_WHY = ${JSON.stringify(bar.work_organisation_why)}

/** What else never clears the bar. */
export const BAR_NEVER: readonly string[] = ${list(bar.never)}

/** The exception: how changes ship, when it holds for every change of a kind. */
export const STANDING_RULE = ${JSON.stringify(bar.standing_rule)}
export const STANDING_RULE_EXAMPLES: readonly string[] = ${list(bar.standing_rule_examples)}
export const STANDING_RULE_TEST = ${JSON.stringify(bar.standing_rule_test)}

/** What a decision that clears the bar looks like. */
export const BAR_EARNS: readonly string[] = ${list(bar.earns)}
`,
)
