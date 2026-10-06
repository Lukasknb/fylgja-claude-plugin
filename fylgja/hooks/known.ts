import { CLOSE, MAX_INSIDE, OPEN } from './chip'
import { GLYPHS } from './glyphs'
import { tokensIn } from './token'

/** A stretch of a text, `end` not included. */
export type Span = { start: number; end: number }

/**
 * A stretch of a text shaped like a chip: the opening mark, a record glyph,
 * and the closing mark a little further on. `token` is the reference it
 * stands for, or undefined when this plugin does not know the text.
 */
export type Shaped = Span & { chip: string; token: string | undefined }

/**
 * Every chip text this plugin has put in the prompt box since it was loaded,
 * with the reference each stands for exactly as it was pasted. One text
 * stands for one reference, so a chip is recognised by its whole text: in
 * the draft, in a prompt brought back into the box, and in the prompt as it
 * is sent.
 *
 * Held in the running plugin only: never stored, written or logged. At most
 * `MAX_HELD` are kept; the one seen longest ago goes first. The map's order
 * is that order, the most recently seen last.
 */
export type Known = Map<string, string>

/** The most chip texts remembered at once. */
export const MAX_HELD = 500

// A chip's shape, from mark to mark. Neither mark, nor a line end, can
// stand between the two, and the stretch between them is bounded, so one
// pass over a text finds every such stretch.
const SHAPE = new RegExp(`${OPEN}[${GLYPHS.join('')}] [^${OPEN}${CLOSE}\\n]{1,${MAX_INSIDE}}${CLOSE}`, 'gu')

export function create(): Known {
  return new Map()
}

/**
 * Remembers that `chip` stands for `token`. When the store is full, the
 * chip seen longest ago that is not in `standing` makes room. False when
 * there is no room to make.
 */
export function hold(known: Known, chip: string, token: string, standing: ReadonlySet<string>): boolean {
  if (!known.has(chip) && known.size >= MAX_HELD) {
    let oldest: string | undefined

    for (const text of known.keys()) {
      if (!standing.has(text)) {
        oldest = text
        break
      }
    }

    if (oldest === undefined) {
      return false
    }

    known.delete(oldest)
  }

  known.delete(chip)
  known.set(chip, token)

  return true
}

/**
 * Every chip-shaped stretch of `text`, in order, each with the reference it
 * stands for when its whole text, mark to mark, is one this plugin has
 * shown. A known one counts as seen just now.
 *
 * Nothing is matched in part: text before the opening mark, after the
 * closing one or changed in between leaves either the same chip or none. A
 * stretch inside a reference that is written out is not reported: the
 * reference is read whole. The work is one pass over the text and one
 * lookup per stretch.
 */
export function shapedIn(known: Known, text: string): Shaped[] {
  const found: Shaped[] = []
  const written = tokensIn(text)
  let next = 0

  for (const match of text.matchAll(SHAPE)) {
    const start = match.index
    const chip = match[0]

    while ((written[next]?.end ?? Infinity) <= start) {
      next += 1
    }

    if ((written[next]?.start ?? Infinity) <= start) {
      continue
    }

    const token = known.get(chip)

    if (token !== undefined) {
      known.delete(chip)
      known.set(chip, token)
    }

    found.push({ start, end: start + chip.length, chip, token })
  }

  return found
}

/**
 * `text` with every chip in it replaced by the reference it stands for,
 * exactly as that was pasted. Nothing else changes: a chip-shaped stretch
 * this plugin does not know stays as typed, and a text without chips comes
 * back as it is.
 */
export function restored(known: Known, text: string): string {
  let out = ''
  let done = 0

  for (const shaped of shapedIn(known, text)) {
    if (shaped.token !== undefined) {
      out += text.slice(done, shaped.start) + shaped.token
      done = shaped.end
    }
  }

  return done === 0 ? text : out + text.slice(done)
}

/** Whether `span` shares any character with one of `others`. */
export function touches(span: Span, others: readonly Span[]): boolean {
  return others.some(other => other.start < span.end && span.start < other.end)
}
