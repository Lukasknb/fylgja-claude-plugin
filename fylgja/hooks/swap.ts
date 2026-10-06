import { chipTextsOf } from './chip'
import { hold, MAX_HELD, shapedIn, touches } from './known'
import type { Known, Span } from './known'
import { tokensIn } from './token'
import type { Token } from './token'

/** The most references one edit turns into chips; any more stay as written. */
export const MAX_NEW = 50

/** A draft longer than this is left as written. */
export const MAX_DRAFT = 100_000

export type Swapped = {
  text: string
  cursor: number
  /** Where an offset into the text before the swap lies in the text after it. */
  at: (offset: number) => number
}

type Change = Span & { by: number; chip: Span }

/**
 * The text `token` is to be shown as: the first of its few texts that no
 * other reference uses, or undefined when all are taken.
 *
 * A text in `strangers`, the chip-shaped stretches of the draft this plugin
 * does not know, is passed over: taking it would make a reference of
 * something that is in the box as plain text, such as a chip from an
 * earlier session.
 */
function textFor(
  token: Token,
  known: Known,
  fresh: ReadonlyMap<string, string>,
  strangers: ReadonlySet<string>,
): string | undefined {
  return chipTextsOf(token).find(text => {
    const holder = fresh.get(text) ?? known.get(text)

    return holder === undefined ? !strangers.has(text) : holder === token.text
  })
}

function build(text: string, chosen: ReadonlyMap<Token, string>): { out: string; changes: Change[] } {
  const changes: Change[] = []
  let out = ''
  let done = 0

  for (const [token, chip] of chosen) {
    out += text.slice(done, token.start)
    changes.push({
      start: token.start,
      end: token.end,
      by: chip.length - token.text.length,
      chip: { start: out.length, end: out.length + chip.length },
    })
    out += chip
    done = token.end
  }

  return { out: out + text.slice(done), changes }
}

/**
 * Puts a chip in place of complete references in `text`, remembers each in
 * `known`, and moves the cursor along: it stays where it was among the text
 * around the chips, and one that stood inside a reference lands after its
 * chip.
 *
 * Some references stay as written:
 * - all of them in a draft longer than `MAX_DRAFT`;
 * - those past the first `MAX_NEW` of one edit, and those that would make
 *   the draft hold more chips than are remembered, so no chip already
 *   standing is lost to a later one;
 * - one whose few possible texts are all taken;
 * - one whose chip would make the text around it read as a reference of its
 *   own, as when one reference is wrapped around another.
 *
 * The work is a fixed number of passes over the draft and a few lookups for
 * each of at most `MAX_NEW` references.
 */
export function swap(known: Known, text: string, cursor: number): Swapped {
  const tokens = text.length > MAX_DRAFT ? [] : tokensIn(text)
  const shaped = shapedIn(known, text)
  const standing = new Set(shaped.filter(one => one.token !== undefined).map(one => one.chip))
  const strangers = new Set(shaped.filter(one => one.token === undefined).map(one => one.chip))
  const room = Math.min(MAX_NEW, MAX_HELD - standing.size)

  if (tokens.length === 0 || room <= 0) {
    return { text, cursor, at: offset => offset }
  }

  const fresh = new Map<string, string>()
  const chosen = new Map<Token, string>()

  for (const token of tokens) {
    if (chosen.size >= room) {
      break
    }

    const chip = textFor(token, known, fresh, strangers)

    if (chip !== undefined) {
      fresh.set(chip, token.text)
      chosen.set(token, chip)
    }
  }

  let { out, changes } = build(text, chosen)
  const wrapping = tokensIn(out)
  const wrapped = changes.map(change => touches(change.chip, wrapping))

  if (wrapped.includes(true)) {
    ;[...chosen.keys()].forEach((token, n) => {
      if (wrapped[n] === true) {
        chosen.delete(token)
      }
    })
    ;({ out, changes } = build(text, chosen))
  }

  for (const [token, chip] of chosen) {
    standing.add(chip)
    hold(known, chip, token.text, standing)
  }

  const at = (offset: number): number => {
    let moved = offset

    for (const change of changes) {
      if (offset >= change.end) {
        moved += change.by
      } else if (offset > change.start) {
        return change.chip.end
      }
    }

    return moved
  }

  return { text: out, cursor: at(cursor), at }
}
