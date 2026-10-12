/**
 * The ledger: the window that lists what Scribe kept in this session, one
 * row per record, newest first, with the record that is selected opened.
 *
 * It is open only because the developer opened it, by pressing the mark
 * above the prompt or by its command, and it shows what the plugin already
 * holds: nothing is asked of Fylgja or of a model to draw it. What is here
 * is its state and the description both surfaces draw it from. Every word
 * that comes from a record passes the sanitiser the chips use.
 *
 * No key of it is a letter or a digit. What the developer types is a prompt
 * and goes to the prompt box, whether the window has the keys or not; the
 * window is worked with the arrows, Enter and Escape, or with clicks. The
 * arrows move from record to record. Enter on a record brings up what can
 * be done with it, and only there can something be changed.
 */

import { glyphOf } from '../glyphs'
import { drawn } from '../plain'
import type { Armed } from './band'
import type { Written } from './types'
import { kindName, MAX_CONTENT, MAX_OPTION, why } from './view'
import type { Field, Part } from './view'

export type Ledger = {
  /** Whether the window is open, as far as the plugin was told. */
  isOpen: boolean
  /** The id of the record that is selected; with none, the newest is. */
  selected: string | undefined
  /** The id of the record whose keys are up: what can be done with it. Only the selected record's ever are. */
  acting: string | undefined
  /** The records taken out of Fylgja in this session, oldest first: each can be put back. */
  gone: Written[]
  /** The id of the record whose sentence is being put right in the window's field. */
  editing: string | undefined
  /** A key of the window pressed once, waiting for its second press. */
  armed: Armed | null
  /** The ids of the records a change is on its way to Fylgja for: no second one is started for them meanwhile. */
  busy: Set<string>
  /** What went wrong with the last change to a record, by its id: said in its row until the next change to it. */
  trouble: Map<string, string>
}

/** No more removed records are held than this; the oldest go first. */
export const MAX_GONE = 40

/** A record's row lists no more of its places than this. */
const MAX_PLACES = 8

/** A row's sentence is never cut shorter than this, however narrow the window. */
const MIN_SENTENCE = 16

/** Cells of a row that are not the record's: the mark in front, and the room a key's own edges take where it is drawn. */
const ROW_EDGE = 3

export function create(): Ledger {
  return {
    isOpen: false,
    selected: undefined,
    acting: undefined,
    gone: [],
    editing: undefined,
    armed: null,
    busy: new Set(),
    trouble: new Map(),
  }
}

/** One row of the window: a record that stands, or one that was removed and can be put back. */
export type Entry = { record: Written; isGone: boolean }

/**
 * The rows, in the order they are listed: the records that stand, newest
 * first, and under them the removed ones, newest first.
 */
export function entriesOf(written: readonly Written[], ledger: Ledger): Entry[] {
  const standing = new Set(written.map(record => record.id))

  return [
    ...written.toReversed().map(record => ({ record, isGone: false })),
    ...ledger.gone
      .filter(record => !standing.has(record.id))
      .toReversed()
      .map(record => ({ record, isGone: true })),
  ]
}

/**
 * Lets go of what the window held for a record that is no longer what it
 * was: a field open on a record that does not stand any more, and keys up
 * for one that is not listed. Scribe may take a record back while the
 * window is open on it.
 */
export function tidy(written: readonly Written[], ledger: Ledger): void {
  if (ledger.editing !== undefined && !written.some(record => record.id === ledger.editing)) {
    ledger.editing = undefined
  }

  if (ledger.acting !== undefined && !entriesOf(written, ledger).some(entry => entry.record.id === ledger.acting)) {
    ledger.acting = undefined
    ledger.armed = null
  }
}

/** Notes a record that was taken out of Fylgja, so the window can offer to put it back. */
export function shelve(ledger: Ledger, gone: Written): void {
  ledger.gone = [...ledger.gone.filter(one => one.id !== gone.id), gone].slice(-MAX_GONE)
}

/** The row that is selected: the one picked, or the first while that one is not listed. */
export function selectedIn(entries: readonly Entry[], ledger: Ledger): Entry | undefined {
  return entries.find(entry => entry.record.id === ledger.selected) ?? entries[0]
}

/**
 * The selection came to rest on the record `id`, by an arrow or by the
 * focus ring landing on its row. Whatever was half done is let go: the keys
 * that were up, a key that waited for its second press, and an open field.
 * Whether anything changed.
 */
export function rest(ledger: Ledger, id: string): boolean {
  const isSame = ledger.selected === id && ledger.acting === undefined && ledger.armed === null && ledger.editing === undefined

  ledger.selected = id
  ledger.acting = undefined
  ledger.armed = null
  ledger.editing = undefined

  return !isSame
}

/**
 * Moves the selection `by` rows, stopping at either end. The id of the
 * record now selected, or undefined when it did not move.
 */
export function step(entries: readonly Entry[], ledger: Ledger, by: number): string | undefined {
  const current = selectedIn(entries, ledger)
  const at = current === undefined ? -1 : entries.indexOf(current)
  const to = entries[Math.min(entries.length - 1, Math.max(0, at + by))]

  if (to === undefined || to === current) {
    return undefined
  }

  rest(ledger, to.record.id)

  return to.record.id
}

/**
 * The focus ring moved onto `key`, or off the window's own elements. A key
 * that waited for its second press and is not the one the ring is on stops
 * waiting: a confirmation never outlives a move away. Whether anything changed.
 */
export function ringed(ledger: Ledger, key: string | undefined): boolean {
  if (ledger.armed === null || ledger.armed.key === key) {
    return false
  }

  ledger.armed = null

  return true
}

/** The window was closed: what was half done in it is let go. What was removed can still be put back when it opens again. */
export function closed(ledger: Ledger): void {
  ledger.isOpen = false
  ledger.acting = undefined
  ledger.armed = null
  ledger.editing = undefined
}

/** A key of the window: its address and its words. It is pressed with Enter while the ring is on it, or with a click. */
export type Action = { key: string; label: string; isArmed?: true }

export type Line = {
  id: string
  isSelected: boolean
  /** Whether the record was removed: its row is dim and offers only to put it back. */
  isGone: boolean
  /** What kind of record it is, with its glyph. */
  kind: string
  /** Its sentence, cut to the row. */
  sentence: string
  /** What became of it, when it is not simply new. */
  outcome: string
  /** The selected record, opened: its reason, what was ruled out and where it applies. Empty for every other row. */
  detail: Part[][]
  /** What went wrong with the last change to it. */
  trouble?: string
  /** Said while a change to it is on its way to Fylgja. */
  waiting?: string
  field?: Field
  actions: Action[]
}

export type View = {
  /** How many records stand, as the title says it. */
  count: string
  lines: Line[]
  /** The one line shown in place of rows. */
  quiet?: string
  /** Whether a key of the selected record waits for its second press. */
  isArmed: boolean
  /** Whether the rule under the title bar is drawn: it is the first thing let go when the window has no room for everything. */
  hasRule: boolean
  legend: string
}

/** Why the window has no rows to show although it is open. */
export type Away = 'off' | 'signed-out'

/** What the window says in place of rows. */
export const QUIET = {
  empty: 'Nothing kept in this session yet.',
  off: 'Scribe is off in this session: nothing is kept.',
  'signed-out': 'Fylgja is not here for your account in this session: nothing is kept.',
} as const

/** What a row says when a change to its record did not go through. */
export const TROUBLE = {
  reword: 'Not saved: Fylgja did not take the new wording. The record is as it was.',
  remove: 'Not removed: Fylgja did not take it out. The record still stands.',
  putback: 'Not put back: Fylgja did not take the record.',
  length: `Not saved: one sentence of at most ${MAX_CONTENT} characters.`,
} as const

export const WAITING = 'Asking Fylgja…'

/**
 * The line of keys, for each state the window is in. Without the keys it
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

/** What a card says while one of its keys waits for its second press. */
export const ARMED_NOTE = 'Enter again within five seconds and it is done. Nothing is changed until then.'

const OUTCOMES: Readonly<Record<Written['outcome'], string>> = {
  created: '',
  restored: 'put back',
  reasoned: 'reason saved',
  held: 'held by someone else',
  updated: 'updated',
  withdrawn: 'removed',
}

/** A key that acts only when pressed twice: what it says before, and once it waits for the second press. */
function twice(ledger: Ledger, key: string, label: string, again: string): Action {
  return ledger.armed?.key === key ? { key, label: again, isArmed: true } : { key, label }
}

/** The keys of the record `id` in the order they are drawn: the first is the one the ring goes to when they come up. */
export function actionKeys(id: string, isGone: boolean): string[] {
  return isGone ? [`putback:${id}`] : [`reword:${id}`, `remove:${id}`]
}

function opened(record: Written, isCut: boolean): Part[][] {
  const rejected = (record.alternatives ?? []).map(one => drawn(one, MAX_OPTION)).filter(text => text !== '')
  const places = (record.anchors ?? []).map(anchor =>
    drawn(anchor.symbol === undefined ? anchor.path : `${anchor.path} (${anchor.symbol})`, MAX_CONTENT),
  )
  const more = places.length - MAX_PLACES

  return [
    // The whole sentence, where its row had no room for it.
    ...(isCut ? [[{ text: drawn(record.content, MAX_CONTENT) }]] : []),
    ...why({ kind: record.kind, detail: record.detail ?? '', reasonStatus: record.reasonStatus }).map(row => row.parts),
    ...(rejected.length === 0 ? [] : [[{ text: 'Rejected: ', tone: 'dim' } as const, { text: rejected.join('; ') }]]),
    [
      { text: 'In: ', tone: 'dim' },
      places.length === 0
        ? { text: 'no file', tone: 'dim' }
        : { text: `${places.slice(0, MAX_PLACES).join(', ')}${more > 0 ? ` and ${more} more` : ''}` },
    ],
    ...(record.replaced === null ? [] : [[{ text: 'Replaces: ', tone: 'dim' } as const, { text: drawn(record.replaced, MAX_CONTENT) }]]),
  ]
}

/**
 * What the window shows now, laid out for `columns` cells.
 *
 * @param isFocused whether the window has the keys: the line of keys names them only then
 * @param away why there is nothing to list, when Scribe does not run here
 * @param rows how many rows the window has room for; every row is drawn when it is not known
 */
export function viewOf(
  written: readonly Written[],
  ledger: Ledger,
  columns: number,
  isFocused: boolean,
  away?: Away,
  rows = Number.MAX_SAFE_INTEGER,
): View {
  if (away !== undefined) {
    return {
      count: '',
      lines: [],
      quiet: QUIET[away],
      isArmed: false,
      hasRule: true,
      legend: isFocused ? LEGENDS.quiet : LEGENDS.awayQuiet,
    }
  }

  const entries = entriesOf(written, ledger)
  const selected = selectedIn(entries, ledger)
  const lines = entries.map(({ record, isGone }): Line => {
    const id = record.id
    const isSelected = selected?.record.id === id
    const kind = `${glyphOf('decision')} ${kindName(record.kind)}`
    const outcome = isGone ? OUTCOMES.withdrawn : OUTCOMES[record.outcome]
    // The row is one line: its mark, its kind and what became of it are kept, and the sentence is cut to what is left.
    // A sentence that is cut ends in one mark more than it was cut to.
    const room = columns - ROW_EDGE - kind.length - 3 - (outcome === '' ? 0 : outcome.length + 3) - 1
    const whole = drawn(record.content, MAX_CONTENT)
    const sentence = drawn(record.content, Math.max(MIN_SENTENCE, Math.min(MAX_CONTENT, room)))
    const trouble = ledger.trouble.get(id)
    const isBusy = ledger.busy.has(id)
    const isEditing = isSelected && !isGone && !isBusy && ledger.editing === id
    const isActing = isSelected && !isBusy && ledger.acting === id

    return {
      id,
      isSelected,
      isGone,
      kind,
      sentence,
      outcome,
      detail: isSelected ? opened(record, sentence !== whole) : [],
      ...(trouble === undefined ? {} : { trouble }),
      ...(isBusy ? { waiting: WAITING } : {}),
      ...(isEditing
        ? {
            field: {
              key: 'reword-text',
              label: 'Reword',
              value: whole,
              placeholder: 'one sentence',
              submitLabel: 'save',
            },
          }
        : {}),
      actions: isEditing
        ? [{ key: 'cancel', label: 'Cancel' }]
        : !isActing
          ? []
          : isGone
            ? [twice(ledger, `putback:${id}`, 'Put back', 'Again to put back')]
            : [{ key: `reword:${id}`, label: 'Reword' }, twice(ledger, `remove:${id}`, 'Remove', 'Again to remove')],
    }
  })
  const open = lines.find(line => line.isSelected)
  const legend = !isFocused
    ? lines.length === 0
      ? LEGENDS.awayQuiet
      : LEGENDS.away
    : lines.length === 0
      ? LEGENDS.quiet
      : open?.field !== undefined
        ? LEGENDS.field
        : (open?.actions.length ?? 0) > 0
          ? LEGENDS.keys
          : LEGENDS.list

  const isArmed = lines.some(line => line.actions.some(action => action.isArmed === true))
  const hasRule = fitted(lines, rows - 3 - (lines.length === 0 ? 1 : 0) - (isArmed ? 1 : 0))

  return {
    count: written.length === 0 ? '' : `${written.length} kept`,
    lines,
    ...(lines.length === 0 ? { quiet: QUIET.empty } : {}),
    isArmed,
    hasRule,
    legend,
  }
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
function fitted(lines: Line[], room: number): boolean {
  const open = lines.find(line => line.isSelected)
  const heightOf = (line: Line): number =>
    1 +
    (line.trouble === undefined ? 0 : 1) +
    (line.isSelected ? line.detail.length + (line.waiting === undefined ? 0 : 1) + (line.field === undefined ? 0 : 1) + (line.actions.length === 0 ? 0 : 1) : 0)
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
