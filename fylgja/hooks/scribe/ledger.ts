/**
 * The ledger: the view of Fylgja's window that lists what Scribe kept in
 * this session, one row per record, newest first, with the record that is
 * selected opened.
 *
 * It is open only because the developer opened it, by pressing the mark
 * above the prompt or by its command, and it shows what the plugin already
 * holds: nothing is asked of Fylgja or of a model to draw it. What is here
 * is its state and its description in the shapes every view of the window
 * is drawn from (see `listing.ts`, which also says how the window is
 * worked). Every word that comes from a record passes the sanitiser the
 * chips use.
 */

import { glyphOf } from '../glyphs'
import { fitted, LEGENDS, roomFor, stepped } from '../listing'
import type { Action, Line, View } from '../listing'
import { drawn } from '../plain'
import { isWaiting } from './anchoring'
import type { Armed } from './band'
import type { Written } from './types'
import { kindName, MAX_CONTENT, MAX_OPTION, why } from './view'
import type { Part } from './view'

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
  /** Counts the times the field was opened: each opening is a field of its own, so what was typed into one and left is in none after it. */
  openings: number
  /** Whether the window had the keys when it was last drawn. */
  hadKeys: boolean
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

/** What the window says of a decision that points at no code yet. */
export const NO_CODE = 'no code yet'

export function create(): Ledger {
  return {
    isOpen: false,
    selected: undefined,
    acting: undefined,
    gone: [],
    editing: undefined,
    openings: 0,
    hadKeys: false,
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
  const to = stepped(
    entries.map(entry => entry.record.id),
    ledger.selected,
    by,
  )

  if (to !== undefined) {
    rest(ledger, to)
  }

  return to
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

/** The record `id` has its sentence put right: a field is opened for it, holding the sentence as it stands. */
export function edit(ledger: Ledger, id: string): void {
  ledger.editing = id
  ledger.openings += 1
}

/**
 * A change to a record was asked of Fylgja and answered, done or not: its
 * keys are put away. Whatever the record has become, the next Enter is on
 * its row and only brings its keys up again; a key held down changes
 * nothing twice, and never undoes what it just did.
 */
export function settled(ledger: Ledger): void {
  ledger.acting = undefined
  ledger.armed = null
  ledger.editing = undefined
}

/**
 * The element the focus ring belongs on: the selected record's row, or,
 * while that record's keys are up, the key that waits for its second press
 * or else the first of them. Undefined with no record, and while the field
 * is open, which holds the ring itself.
 */
export function ringKey(entries: readonly Entry[], ledger: Ledger): string | undefined {
  const selected = selectedIn(entries, ledger)

  if (selected === undefined || ledger.editing !== undefined) {
    return undefined
  }

  const id = selected.record.id

  return ledger.acting === id ? (ledger.armed?.key ?? actionKeys(id, selected.isGone)[0] ?? `row:${id}`) : `row:${id}`
}

/** The window was closed: what was half done in it is let go. What was removed can still be put back when it opens again. */
export function closed(ledger: Ledger): void {
  ledger.isOpen = false
  ledger.hadKeys = false
  ledger.acting = undefined
  ledger.armed = null
  ledger.editing = undefined
}

/** What the title bar says after Fylgja's name while this view is up. */
export const NAME = 'kept in this session'

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

/** Why a record was not kept: the rule Fylgja refused it by, or why the plugin itself let it go; any other rule is said by its name. */
const NOT_KEPT: Readonly<Record<string, string>> = {
  leans_on_conversation: 'wording leaned on this conversation',
  label_stayed: 'named something by a label only this conversation knew',
  about_work: 'about how this work was organised, not the code',
}

/**
 * The one line that says what was not kept, grouped by why; undefined when
 * everything was. It is said here, where somebody asked what was kept, and
 * never above the prompt.
 */
export function notKept(lost: ReadonlyMap<string, number>): string | undefined {
  const said = [...lost]
    .filter(([, count]) => count > 0)
    .map(([code, count]) => `${count} not kept — ${Object.hasOwn(NOT_KEPT, code) ? NOT_KEPT[code] : `Fylgja turned it down (${code})`}`)

  return said.length === 0 ? undefined : said.join(' · ')
}

const OUTCOMES: Readonly<Record<Written['outcome'], string>> = {
  created: '',
  restored: 'put back',
  reasoned: 'reason saved',
  held: 'held by someone else',
  updated: 'updated',
  withdrawn: 'removed',
}

/**
 * A key that acts only when pressed twice. While it waits for the second
 * press it says what it said before, as a key of a card does: neither its
 * words nor its place move under a finger.
 */
function twice(ledger: Ledger, key: string, label: string): Action {
  return ledger.armed?.key === key ? { key, label, isArmed: true } : { key, label }
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
  const waiting = isWaiting(record)

  return [
    // The whole sentence, where its row had no room for it.
    ...(isCut ? [[{ text: drawn(record.content, MAX_CONTENT) }]] : []),
    ...why({ kind: record.kind, detail: record.detail ?? '', reasonStatus: record.reasonStatus }).map(row => row.parts),
    ...(rejected.length === 0 ? [] : [[{ text: 'Rejected: ', tone: 'dim' } as const, { text: rejected.join('; ') }]]),
    // One picked up after the plugin was loaded again does not say which files it concerns: nothing is said of them.
    // A decision that points at no code yet says so: its code is added once the session writes it.
    ...(record.isPartial === true && places.length === 0 && !waiting
      ? []
      : [
          [
            { text: 'In: ', tone: 'dim' } as const,
            ...(places.length === 0
              ? [{ text: waiting ? NO_CODE : 'no file', tone: 'dim' } as const]
              : [
                  { text: `${places.slice(0, MAX_PLACES).join(', ')}${more > 0 ? ` and ${more} more` : ''}` },
                  ...(waiting ? [{ text: ` · ${NO_CODE}`, tone: 'dim' } as const] : []),
                ]),
          ],
        ]),
    ...(record.replaced === null ? [] : [[{ text: 'Replaces: ', tone: 'dim' } as const, { text: drawn(record.replaced, MAX_CONTENT) }]]),
  ]
}

/**
 * What the window shows now, laid out for `columns` cells.
 *
 * @param isFocused whether the window has the keys: the line of keys names them only then
 * @param away why there is nothing to list, when Scribe does not run here
 * @param rows how many rows the window has room for; every row is drawn when it is not known
 * @param lost how many records were not kept, by the rule Fylgja refused them by
 */
export function viewOf(
  written: readonly Written[],
  ledger: Ledger,
  columns: number,
  isFocused: boolean,
  away?: Away,
  rows = Number.MAX_SAFE_INTEGER,
  lost: ReadonlyMap<string, number> = new Map(),
): View {
  if (away !== undefined) {
    return {
      name: NAME,
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
    const whole = drawn(record.content, MAX_CONTENT)
    const sentence = drawn(record.content, roomFor(columns, kind, outcome, MAX_CONTENT))
    const trouble = ledger.trouble.get(id)
    const isBusy = ledger.busy.has(id)
    const isEditing = isSelected && !isGone && !isBusy && ledger.editing === id
    const isActing = isSelected && !isBusy && ledger.acting === id

    return {
      id,
      isSelected,
      isDim: isGone,
      kind,
      sentence,
      tail: outcome,
      detail: isSelected ? opened(record, sentence !== whole) : [],
      ...(trouble === undefined ? {} : { trouble }),
      ...(isBusy ? { waiting: WAITING } : {}),
      ...(isEditing
        ? {
            field: {
              // A field of its own for each opening: one left with Escape takes what was typed into it with it.
              key: `reword-text:${id}:${ledger.openings}`,
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
            ? [twice(ledger, `putback:${id}`, 'Put back')]
            : [{ key: `reword:${id}`, label: 'Reword' }, twice(ledger, `remove:${id}`, 'Remove')],
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
  const closing = notKept(lost)
  const hasRule = fitted(lines, rows - 3 - (lines.length === 0 ? 1 : 0) - (isArmed ? 1 : 0) - (closing === undefined ? 0 : 1))

  return {
    name: NAME,
    count: written.length === 0 ? '' : `${written.length} kept`,
    lines,
    ...(lines.length === 0 ? { quiet: QUIET.empty } : {}),
    ...(closing === undefined ? {} : { closing }),
    isArmed,
    hasRule,
    legend,
  }
}
