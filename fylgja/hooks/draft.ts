import { create as createKnown, shapedIn } from './known'
import type { Known, Span } from './known'
import { swap } from './swap'

/**
 * After this many swaps in a row that the prompt box did not take, with
 * none taken in between, the box is believed not to take chips at all.
 */
const MAX_REFUSED = 3

/**
 * What this plugin knows of the prompt box: the chip texts it has shown,
 * the box as it last answered for it, and whether the box takes chips.
 */
export type Draft = {
  known: Known
  /** The box as this plugin last answered for it. */
  text: string
  /** What the box held before the last answer's swap, until the next edit shows whether it was taken. */
  below: string | undefined
  /** How many swaps in a row the box did not take. */
  refused: number
}

/** One edit of the box: the draft before it and what the editor did to it. */
export type Edit = { text: string; start: number; end: number; inputText: string; key: string | undefined }

export type Shown = {
  text: string
  cursor: number
  /** Where the chips stand in `text`. */
  chips: Span[]
  /** Where `text` holds something shaped like a chip that this plugin does not know. */
  strangers: Span[]
  /** Where an offset into the box as it came lies in `text`. */
  at: (offset: number) => number
}

export function create(): Draft {
  return { known: createKnown(), text: '', below: undefined, refused: 0 }
}

/** A new conversation, or a new prompt: the box is given the benefit of the doubt again. */
export function startOver(draft: Draft): void {
  draft.below = undefined
  draft.refused = 0
}

/**
 * What is left of a chip after Backspace took its end or Delete took its
 * start, as a stretch of the box after that edit. A chip goes as one thing:
 * the key that would break it takes all of it out.
 */
function remains(draft: Draft, edit: Edit, box: string): Span | undefined {
  const isOneDeletion =
    (edit.key === 'backspace' || edit.key === 'delete') &&
    edit.inputText === '' &&
    edit.end > edit.start &&
    box === edit.text.slice(0, edit.start) + edit.text.slice(edit.end)

  if (!isOneDeletion) {
    return undefined
  }

  for (const chip of shapedIn(draft.known, edit.text)) {
    if (chip.token === undefined) {
      continue
    }

    if (edit.key === 'backspace' && chip.end === edit.end && chip.start < edit.start) {
      return { start: chip.start, end: edit.start }
    }

    if (edit.key === 'delete' && chip.start === edit.start && chip.end > edit.end) {
      return { start: edit.start, end: edit.start + chip.end - edit.end }
    }
  }

  return undefined
}

/**
 * The box to show after an edit, given the box the editor made of it: every
 * complete reference becomes a chip, and every chip text this plugin has
 * shown before is a chip wherever it stands whole, mark to mark.
 *
 * Whether the box takes a swap is only seen at the next edit. One that
 * starts from the text before the swap means the answer was not used:
 * late, or thrown away. That costs nothing, the swap is simply made again.
 * Only `MAX_REFUSED` of those in a row, with no swap taken in between, are
 * read as a box that takes no chips; from then on references are left as
 * written, and painted, until `startOver`. Chips that already stand are
 * never affected.
 */
export function edited(draft: Draft, edit: Edit, box: { text: string; cursor: number }): Shown {
  if (draft.below !== undefined && draft.below !== draft.text) {
    draft.refused = edit.text === draft.below ? draft.refused + 1 : edit.text === draft.text ? 0 : draft.refused
  }

  draft.below = undefined

  const rest = remains(draft, edit, box.text)
  const text = rest === undefined ? box.text : box.text.slice(0, rest.start) + box.text.slice(rest.end)
  const without = (offset: number): number =>
    rest === undefined || offset <= rest.start ? offset : Math.max(rest.start, offset - (rest.end - rest.start))

  const swapped =
    draft.refused >= MAX_REFUSED
      ? { text, cursor: without(box.cursor), at: (offset: number) => offset }
      : swap(draft.known, text, without(box.cursor))
  const shaped = shapedIn(draft.known, swapped.text)

  draft.below = swapped.text === text ? undefined : box.text
  draft.text = swapped.text

  return {
    text: swapped.text,
    cursor: swapped.cursor,
    chips: shaped.filter(one => one.token !== undefined),
    strangers: shaped.filter(one => one.token === undefined),
    at: offset => swapped.at(without(offset)),
  }
}
