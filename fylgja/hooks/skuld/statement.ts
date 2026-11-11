/**
 * The one sentence a developer is asked to keep as expected behaviour, and
 * where its words come from. A reading's own expectation is used where it
 * has one: transcribed when it was in the image, stated when the developer
 * typed it beside the image. Otherwise the sentence is proposed at the turn
 * the fix landed (`statementOf`), and holds only where the quote it rests on
 * is found word for word in what the session holds: in a prompt of the
 * developer's since the report it is theirs (stated), in the turn's final
 * answer the assistant's (concluded, and confirmed by the developer's key).
 * No sentence, no question. The reader's expectation is never filled in
 * afterwards.
 */

import { holdsBytes } from '../reader/bytes'
import { echoesQuote } from '../reader/quote'
import type { Read } from '../reader/reply'
import { MAX_EXPECTED } from '../reader/reply'

/** Where the words of a kept requirement come from (L13). */
export type Basis = 'transcribed' | 'stated' | 'concluded'

export type Statement = { text: string; basis: Basis }

/** The reading's own expectation, as the sentence to keep; undefined when it states none. */
export function statedIn(read: Read): Statement | undefined {
  if (read.expected === null || read.expectedBasis === null) {
    return undefined
  }

  return { text: read.expected, basis: read.expectedBasis === 'in_image' ? 'transcribed' : 'stated' }
}

/** Text as it is compared: its spaces evened out, its quote marks plain. */
function even(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** No shorter quote is taken as what a sentence rests on. */
const MIN_QUOTE = 8

/**
 * The sentence proposed at the fix's turn, held against what the session
 * holds; undefined when there is none, or when its quote is in neither.
 *
 * @param prompts the developer's prompts since the report
 * @param answer the turn's final answer
 */
export function concludedFrom(
  proposed: { statement?: unknown; quote?: unknown } | 'none' | undefined,
  prompts: readonly string[],
  answer: string,
  imageQuote?: string,
): Statement | undefined {
  const given = proposed === 'none' ? undefined : proposed
  const text = typeof given?.statement === 'string' ? given.statement.replace(/\s+/g, ' ').trim() : ''
  const quote = typeof given?.quote === 'string' ? even(given.quote) : ''

  // One sentence the server takes (its English is the prompt's to ask for), holding neither an image's bytes nor the words in the image.
  if (text === '' || text.length > MAX_EXPECTED || quote.length < MIN_QUOTE || holdsBytes(text) || echoesQuote(text, imageQuote)) {
    return undefined
  }

  if (prompts.some(prompt => even(prompt).includes(quote))) {
    return { text, basis: 'stated' }
  }

  return even(answer).includes(quote) ? { text, basis: 'concluded' } : undefined
}
