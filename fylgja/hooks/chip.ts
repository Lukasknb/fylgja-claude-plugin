import { glyphOf } from './glyphs'
import { drawn } from './plain'
import { titleOf } from './token'
import type { Token } from './token'

/** A chip in the prompt box shows at most this much of a title. */
const MAX_TITLE = 60

/** How many numbered texts a reference may fall back to. */
const MAX_NUMBERED = 3

/** The marks a chip's text begins and ends with. */
export const OPEN = '‹'
export const CLOSE = '›'

/**
 * The most characters between a chip's two marks: the glyph, the cut title
 * and its ellipsis, the start of an id and a number, with their separators.
 */
export const MAX_INSIDE = MAX_TITLE + 20

/**
 * The few texts a reference may stand as in the prompt box, the preferred
 * one first: between the two marks, the record's glyph and the pasted
 * title, or its kind and the start of its id when it has no title. The
 * later ones add the start of the id, then a number, so two different
 * references never share a text.
 *
 * The title is the label that was pasted, shown bare. It is never put in
 * double quotes or square brackets, which is how a message row shows a
 * title Fylgja confirmed. The two marks are taken out of it, and the
 * sanitiser every drawn text passes leaves it no quote of any kind (which
 * the marks and their look-alikes are), no bracket, glyph or middle dot. So
 * whatever was pasted, a title cannot end its chip early, spell another
 * chip or the part that tells two chips apart, or read as confirmed.
 */
export function chipTextsOf(token: Token): string[] {
  const glyph = glyphOf(token.kind)
  const title = drawn(titleOf(token).replaceAll(OPEN, '').replaceAll(CLOSE, ''), MAX_TITLE)
  const marked = `${glyph} ${title === '' ? token.kind : title} · ${token.id.slice(0, 8)}`
  const numbered = Array.from({ length: MAX_NUMBERED }, (_, n) => `${marked} · ${n + 2}`)
  const insides = title === '' ? [marked, ...numbered] : [`${glyph} ${title}`, marked, ...numbered]

  return insides.map(inside => OPEN + inside + CLOSE)
}
