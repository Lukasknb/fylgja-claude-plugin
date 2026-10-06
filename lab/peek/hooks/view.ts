import type { Ref } from './refs'

/**
 * What the peek pane is showing: the records peeked at so far, which of
 * them is on show, and which sections the person folded away. Ids and kinds
 * only; what the records say is held by the library.
 */
export type View = {
  /** The records peeked at, oldest first, as a browser keeps pages. */
  history: Ref[]
  /** Which of them is shown; -1 before the first. */
  at: number
  /** The sections folded away, by name. They stay folded from one record to the next. */
  folded: Set<string>
  /** Where the view is drawn: in its pane, in the band above the prompt when no pane could be placed, or nowhere. */
  where: 'closed' | 'pane' | 'band'
  /** What "Copy reference" last came to, until the person moves on. */
  note: { is: 'inserted' } | { is: 'refused'; text: string } | undefined
}

const MAX_HISTORY = 50

export function create(): View {
  return { history: [], at: -1, folded: new Set(), where: 'closed', note: undefined }
}

export function current(view: View): Ref | undefined {
  return view.history[view.at]
}

/**
 * Puts a record on show. A record other than the one shown is added after
 * it and what lay ahead is dropped, as a browser does on a new page.
 */
export function show(view: View, ref: Ref): void {
  view.note = undefined

  if (current(view)?.id === ref.id) {
    return
  }

  view.history = [...view.history.slice(0, view.at + 1), ref].slice(-MAX_HISTORY)
  view.at = view.history.length - 1
}

/** Moves back (-1) or forward (1) when there is a record that way; says whether it moved. */
export function step(view: View, by: -1 | 1): boolean {
  if (view.history[view.at + by] === undefined) {
    return false
  }

  view.at += by
  view.note = undefined

  return true
}

export function toggle(view: View, section: string): void {
  if (!view.folded.delete(section)) {
    view.folded.add(section)
  }
}
