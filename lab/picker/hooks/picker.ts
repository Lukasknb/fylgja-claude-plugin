/**
 * The picker in the prompt box: open from the moment a trigger and the
 * cursor after it are in the draft, closed when they are not.
 *
 * Everything here that runs on a keystroke is synchronous and reads only a
 * few characters around the cursor. What has to be asked of Fylgja is left
 * to a timer by the list (finder.ts), never asked from here.
 */

import type { ClientKeyEvent } from 'claude-code'

import { referenceOf } from './candidate'
import type { Candidate } from './candidate'
import * as Finder from './finder'
import type { Box, Host, Timer } from './host'
import { decorationsOf } from './paint'
import type { Source } from './source'
import { queryOf, triggerAt } from './trigger'
import type { Mark } from './trigger'

export type Picker = {
  /** The trigger the list is open for. */
  open: { mark: Mark; start: number; span: string } | undefined
  /** Where the trigger sits that the person closed the list on; it stays closed there. */
  dismissed: number | undefined
  finder: Finder.Finder
  /** Reads the draft now and then while the list is open. */
  watch: Timer | undefined
  isReading: boolean
  /** Said in the list's place when a choice could not be written. */
  note: string | undefined
}

/** One edit of the prompt box, as much of it as the picker reads. */
export type Edit = {
  key?: ClientKeyEvent
  text: string
  cursor: number
  start: number
  end: number
  inputText: string
}

/** How often the draft is read while the list is open. */
export const WATCH_MS = 300

export const NOT_TAKEN_LINE = 'the prompt box did not take it; try again'

export function create(): Picker {
  return {
    open: undefined,
    dismissed: undefined,
    finder: Finder.create(),
    watch: undefined,
    isReading: false,
    note: undefined,
  }
}

function close(host: Host, picker: Picker): void {
  picker.open = undefined
  picker.note = undefined
  picker.watch?.cancel()
  picker.watch = undefined
  Finder.reset(picker.finder)
  host.redraw()
}

/** Closes the list and keeps it closed for as long as the same trigger stays in the draft. */
export function dismiss(host: Host, picker: Picker): void {
  picker.dismissed = picker.open?.start
  close(host, picker)
}

/** The draft with what is between `start` and `end` replaced by the reference to `candidate` and a space. */
function written(text: string, start: number, end: number, candidate: Candidate): Box {
  const reference = `${referenceOf(candidate)} `

  return {
    text: text.slice(0, start) + reference + text.slice(end),
    cursor: start + reference.length,
  }
}

/**
 * Reads the draft while the list is open. Some changes of the draft raise no
 * edit (a prompt that was sent, a paste on some terminals), and this is how
 * the list notices them. It runs only between a trigger being typed and the
 * list closing.
 */
function startWatch(host: Host, picker: Picker, source: Source): void {
  picker.watch ??= host.every(WATCH_MS, () => {
    if (picker.isReading || picker.open === undefined) {
      return
    }

    picker.isReading = true
    void host
      .read()
      .then(box => {
        if (picker.open !== undefined) {
          follow(host, picker, source, undefined, box)
        }
      })
      .catch(() => undefined)
      .finally(() => {
        picker.isReading = false
      })
  })
}

/**
 * The record a digit just typed chooses, or undefined.
 *
 * Only after `@@`, where a digit means a row; after `{{` every character is
 * part of the query, so a title with a number in it can be searched. And
 * only while the rows on screen are the settled answer to what was typed
 * before the digit: a digit typed ahead of the answer is part of the query.
 */
function byDigit(picker: Picker, source: Source, edit: Edit, raw: string, cursor: number): Candidate | undefined {
  const isOneDigit = /^[1-9]$/.test(edit.inputText) && edit.start === edit.end && edit.start + 1 === cursor

  if (picker.open?.mark !== '@@' || !isOneDigit || queryOf(raw.slice(0, -1)) !== picker.finder.query) {
    return undefined
  }

  const view = Finder.viewOf(picker.finder, source)

  return view.isSettled ? view.rows[Number(edit.inputText) - 1] : undefined
}

/**
 * Follows the draft after an edit (or a read of it): opens the list on a
 * trigger, has it follow the query, closes it when the trigger is gone.
 *
 * Returns the box to show instead when the edit chose a record, with the
 * trigger and the query replaced by the reference and the cursor after it.
 */
export function follow(host: Host, picker: Picker, source: Source, edit: Edit | undefined, box: Box): Box | undefined {
  const found = triggerAt(box.text, box.cursor)

  if (found === undefined) {
    picker.dismissed = undefined

    if (picker.open !== undefined) {
      close(host, picker)
    }

    return undefined
  }

  if (picker.dismissed === found.start) {
    return undefined
  }

  picker.dismissed = undefined

  const isSame = picker.open !== undefined && picker.open.start === found.start && picker.open.mark === found.mark

  if (isSame && edit !== undefined) {
    const chosen = byDigit(picker, source, edit, found.raw, box.cursor)

    if (chosen !== undefined) {
      close(host, picker)

      return written(box.text, found.start, box.cursor, chosen)
    }
  }

  if (!isSame) {
    Finder.reset(picker.finder)
  }

  picker.open = {
    mark: found.mark,
    start: found.start,
    span: box.text.slice(found.start, box.cursor),
  }
  picker.note = undefined

  const isChanged = Finder.want(host, source, picker.finder, found.query, Finder.DEBOUNCE_MS)

  startWatch(host, picker, source)

  if (!isSame || isChanged) {
    host.redraw()
  }

  return undefined
}

/**
 * Answers a key that works the open list instead of the draft: Up and Down
 * move the highlight, Tab and Enter choose the highlighted record, Escape
 * closes the list. Returns the box to show, the key consumed, or undefined
 * for every other key and whenever the list is not open at the cursor.
 */
export function keyTaken(host: Host, picker: Picker, source: Source, edit: Edit): Box | undefined {
  const key = edit.key

  if (picker.open === undefined || key === undefined || key.ctrl === true || key.meta === true) {
    return undefined
  }

  const found = triggerAt(edit.text, edit.cursor)

  if (found === undefined || found.start !== picker.open.start) {
    return undefined
  }

  const same = { text: edit.text, cursor: edit.cursor }

  if (key.key === 'escape') {
    dismiss(host, picker)

    return same
  }

  const rows = Finder.viewOf(picker.finder, source).rows

  if (rows.length === 0 || key.shift === true) {
    return undefined
  }

  if (key.key === 'up' || key.key === 'down') {
    Finder.move(picker.finder, rows.length, key.key === 'down' ? 1 : -1)
    host.redraw()

    return same
  }

  const chosen =
    key.key === 'tab' || key.key === 'return' ? rows[Math.min(picker.finder.highlight, rows.length - 1)] : undefined

  if (chosen === undefined) {
    return undefined
  }

  close(host, picker)

  return written(edit.text, found.start, edit.cursor, chosen)
}

/**
 * Writes the reference to `candidate` into the draft after a click on its
 * row. A click is no edit, so the draft is read and written through the
 * prompt's own calls: the trigger and the query are replaced when they are
 * still where they were, otherwise the reference goes in at the cursor.
 */
export async function press(host: Host, picker: Picker, candidate: Candidate): Promise<void> {
  const open = picker.open
  const box = await host.read()
  const isInPlace = open !== undefined && box.text.slice(open.start, open.start + open.span.length) === open.span
  const text = isInPlace
    ? written(box.text, open.start, open.start + open.span.length, candidate).text
    : `${referenceOf(candidate)} `
  const filled = await host.fill({ text, mode: isInPlace ? 'replace' : 'insert', decorations: decorationsOf(text) })

  if (filled.isFilled) {
    close(host, picker)
  } else {
    picker.note = NOT_TAKEN_LINE
    host.redraw()
  }
}
