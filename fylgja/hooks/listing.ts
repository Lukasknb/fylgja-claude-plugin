/**
 * What Fylgja's window lists, whichever of its views is up: rows of records,
 * one of them selected and opened, and under the selected one the keys that
 * act on it. The views (what Scribe kept, what a search found) describe
 * themselves in these shapes, and one drawing draws them all.
 *
 * No key of the window is a letter or a digit, in any view. What the
 * developer types is a prompt and goes to the prompt box, whether the window
 * has the keys or not; the window is worked with the arrows, Enter and
 * Escape, or with clicks. The arrows move from row to row. Enter on a row
 * brings up what can be done with its record, and only there does anything
 * happen.
 */

import type { Field, Part } from './scribe/view'

/**
 * A key of the window: its address and its words. It is pressed with Enter
 * while the ring is on it, or with a click. An armed key was pressed once
 * and acts when it is pressed again in time: it keeps its words and its
 * place, and is only marked.
 */
export type Action = { key: string; label: string; isArmed?: true }

export type Line = {
  id: string
  isSelected: boolean
  /** Whether the row is drawn dim although it is selected: a record that was removed. */
  isDim: boolean
  /** What kind of record it is, with its glyph. */
  kind: string
  /** Its sentence, cut to the row. */
  sentence: string
  /** What stands after the sentence, dim: what became of the record, or when it was said. */
  tail: string
  /** The selected record, opened: what it holds, a line each. Empty for every other row. */
  detail: Part[][]
  /** What went wrong with the last thing asked about it. */
  trouble?: string
  /** Said while Fylgja is asked about it. */
  waiting?: string
  field?: Field
  actions: Action[]
  /** The record's page, drawn beside its keys as a link the terminal opens. */
  link?: { href: string; label: string }
}

export type View = {
  /** Which view this is, in the few words after Fylgja's name. */
  name: string
  /** How many records there are, as the title bar says it. */
  count: string
  /** The view's own field, above its rows; `isHeld` while the ring is in it. */
  field?: Field & { isHeld: boolean }
  lines: Line[]
  /** The one line shown in place of rows. */
  quiet?: string
  /** The one key of a view that lists nothing and can do one thing about it, under that line. */
  action?: Action
  /** One line under the rows, about what the view does not list. */
  closing?: string
  /** Whether a key of the selected record waits for its second press. */
  isArmed: boolean
  /** Whether the rule under the title bar is drawn: it is the first thing let go when the window has no room for everything. */
  hasRule: boolean
  legend: string
}

/**
 * The line of keys, for each state a view can be in. Without the keys it
 * names none of them: it says how the window is given them.
 */
export const LEGENDS = {
  list: '↑↓ record · enter what can be done · esc close',
  keys: '↑↓ move · enter press · esc close',
  field: 'enter save · esc leave the field',
  quiet: 'esc close',
  away: 'ctrl+x tab gives this window the keys · or click a record',
  awayQuiet: 'ctrl+x tab gives this window the keys',
} as const

/** A row's sentence is never cut shorter than this, however narrow the window. */
const MIN_SENTENCE = 16

/** Cells of a row that are not the record's: the mark in front, and the room a key's own edges take where it is drawn. */
const ROW_EDGE = 3

/**
 * How many characters of its sentence a row of `columns` cells has room
 * for, at most `max`. The row is one line: its mark, its kind and its tail
 * are kept, and the sentence is cut to what is left. A sentence that is cut
 * ends in one mark more than it was cut to.
 */
export function roomFor(columns: number, kind: string, tail: string, max: number): number {
  return Math.max(MIN_SENTENCE, Math.min(max, columns - ROW_EDGE - kind.length - 3 - (tail === '' ? 0 : tail.length + 3) - 1))
}

/**
 * The id `by` rows from `selected` in `ids`, stopping at either end; with
 * none selected the first counts as selected. Undefined when that is where
 * the selection already is.
 */
export function stepped(ids: readonly string[], selected: string | undefined, by: number): string | undefined {
  const current = selected !== undefined && ids.includes(selected) ? selected : ids[0]
  const at = current === undefined ? -1 : ids.indexOf(current)
  const to = ids[Math.min(ids.length - 1, Math.max(0, at + by))]

  return to === current ? undefined : to
}

/**
 * Notes whether the window has the keys as a view of it is drawn. Whether
 * it was just given them: its focus ring is then on nothing, and is to be
 * seated.
 */
export function keyed(view: { hadKeys: boolean }, isFocused: boolean): boolean {
  const isGiven = isFocused && !view.hadKeys

  view.hadKeys = isFocused

  return isGiven
}

/**
 * Makes the rows fit a window with room for `room` of them, when little
 * enough is over: the title bar and the line of keys are what a window is
 * known by, and are not to be scrolled out of sight for one row. The rule
 * under the title bar goes first. While the selected record's keys or its
 * field are up, the last lines of what it holds go next, down to one: the
 * record was read before its keys were asked for. Whether the rule stays.
 * A list that is longer than that is left whole and scrolled.
 */
export function fitted(lines: Line[], room: number): boolean {
  const open = lines.find(line => line.isSelected)
  const heightOf = (line: Line): number =>
    1 +
    (line.trouble === undefined ? 0 : 1) +
    (line.isSelected
      ? line.detail.length +
        (line.waiting === undefined ? 0 : 1) +
        (line.field === undefined ? 0 : 1) +
        (line.actions.length === 0 && line.link === undefined ? 0 : 1)
      : 0)
  const over = lines.reduce((sum, line) => sum + heightOf(line), 0) - room
  const isWorkedOn = open !== undefined && (open.actions.length > 0 || open.field !== undefined)
  const spare = isWorkedOn ? Math.max(0, open.detail.length - 1) : 0

  if (over <= 0 || over > 1 + spare) {
    return true
  }

  if (open !== undefined && over > 1) {
    open.detail = open.detail.slice(0, open.detail.length - (over - 1))
  }

  return false
}
