import { glyphOf } from './glyphs'
import type { Memory } from './memory'
import { distinctById, tokensIn } from './token'
import type { Token } from './token'

/** The references a message holds, each record once. */
export function referencesIn(text: string): Token[] {
  return distinctById(tokensIn(text))
}

function chipOf(token: Token, memory: Memory): string {
  const known = memory.get(token.id)

  if (known === undefined) {
    // Nothing confirmed yet: the kind and the start of the id, which claim nothing.
    return `[${glyphOf(token.kind)} ${token.kind} · ${token.id.slice(0, 8)}]`
  }

  if (known.state === 'missing') {
    return `[${glyphOf(known.kind)} ${known.kind} · not found]`
  }

  const parts = [
    `${glyphOf(known.kind)} "${known.title}"`,
    known.date,
    known.isPrivate ? 'private to you' : null,
  ].filter(part => part !== null)

  return `[${parts.join(' · ')}]`
}

/**
 * A message's text with each Fylgja reference shown as a chip, or undefined
 * when it holds none.
 *
 * A chip carries what Fylgja confirmed (the record's own title, its date, and
 * that it is private when it is). The label inside the reference is never
 * shown: a reference Fylgja has not answered for is drawn from its kind and
 * id alone.
 *
 * A confirmed chip is the only one with double quotes: they hold the title,
 * and everything this plugin says about the record (its date, that it is
 * private) stands after the closing quote. A title holds no double quote,
 * middle dot or bracket of its own, or anything that draws like one. So no
 * record's title can add a date or a private mark to its chip, or make it
 * read as "not found" or as unconfirmed.
 */
export function rowTextOf(text: string, memory: Memory): string | undefined {
  const tokens = tokensIn(text)

  if (tokens.length === 0) {
    return undefined
  }

  let row = ''
  let at = 0

  for (const token of tokens) {
    row += text.slice(at, token.start) + chipOf(token, memory)
    at = token.end
  }

  return row + text.slice(at)
}
