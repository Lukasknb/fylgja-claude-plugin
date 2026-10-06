/**
 * The same list in a pane, under a field to type the query in: what `/pick`
 * opens. It needs nothing of the prompt box but one write, so it works
 * wherever a pane does.
 */

import type { Elements, RenderElement } from 'claude-code'

import { referenceOf } from './candidate'
import type { Candidate } from './candidate'
import * as Finder from './finder'
import type { Host } from './host'
import { decorationsOf } from './paint'
import { NOT_TAKEN_LINE } from './picker'
import { lineOf, rowsOf } from './rows'
import type { Kit } from './rows'
import type { Source } from './source'
import { MAX_QUERY, queryOf } from './trigger'

export const PANE_ID = 'fylgja-pick'

export type Pane = {
  finder: Finder.Finder
  /** The field's text exactly as typed, handed back to the field on every drawing. */
  typed: string
  /** Said under the field when a choice could not be written. */
  note: string | undefined
}

export function create(): Pane {
  return { finder: Finder.create(), typed: '', note: undefined }
}

/** Has the list follow what the field holds; a search waits `delay` milliseconds for more typing. */
export function type(host: Host, source: Source, pane: Pane, typed: string, delay: number): void {
  pane.typed = typed.slice(0, MAX_QUERY)
  pane.note = undefined
  Finder.want(host, source, pane.finder, queryOf(pane.typed), delay)
  host.redraw()
}

/** Starts the pane over with `typed` in its field, as `/pick` opens it. */
export function begin(host: Host, source: Source, pane: Pane, typed: string): void {
  Finder.reset(pane.finder)
  // Typed as a command and entered: nothing more is coming, so nothing is waited for.
  type(host, source, pane, typed, 0)
}

/** Puts the reference to `candidate` in the prompt box at the cursor and closes the pane. */
export async function choose(host: Host, pane: Pane, candidate: Candidate): Promise<void> {
  const text = `${referenceOf(candidate)} `
  const filled = await host.fill({
    text,
    mode: 'insert',
    decorations: decorationsOf(text),
  })

  if (filled.isFilled) {
    Finder.reset(pane.finder)
    pane.typed = ''
    await host.close(PANE_ID)
  } else {
    pane.note = NOT_TAKEN_LINE
    host.redraw()
  }
}

/**
 * Enter in the field: chooses the first record when the list is the answer
 * to what the field holds, and otherwise searches now instead of waiting for
 * the typing to pause.
 */
export function submit(host: Host, source: Source, pane: Pane, typed: string): void {
  type(host, source, pane, typed, 0)

  const view = Finder.viewOf(pane.finder, source)
  const first = view.rows[0]

  if (view.isSettled && first !== undefined) {
    void choose(host, pane, first).catch(() => undefined)
  } else if (pane.finder.timer !== undefined && pane.finder.query !== undefined) {
    // A search is waiting for the typing to pause: it is asked for again with no wait.
    const query = pane.finder.query

    Finder.reset(pane.finder)
    Finder.want(host, source, pane.finder, query, 0)
  }
}

type Field = Elements['terminal']['Input']

/**
 * The pane's body. `Input` is undefined on a surface that draws no fields
 * (a phone): the list of recent meetings is shown there without one.
 */
export function draw(
  kit: Kit,
  Input: Field | undefined,
  host: Host,
  source: Source,
  pane: Pane,
  width: number,
): RenderElement {
  const view = Finder.viewOf(pane.finder, source)
  const body: RenderElement[] = []

  if (Input !== undefined) {
    body.push(
      Input({
        key: 'query',
        placeholder: 'part of a title',
        value: pane.typed,
        submitLabel: 'pick',
        autoFocus: true,
        onInput: value => type(host, source, pane, value, Finder.DEBOUNCE_MS),
        onSubmit: value => submit(host, source, pane, value),
      }),
    )
  }

  if (pane.note !== undefined) {
    body.push(lineOf(kit, pane.note, undefined))
  }

  if (view.line !== undefined) {
    body.push(lineOf(kit, view.line, undefined))
  }

  body.push(
    ...rowsOf(kit, view.rows, {
      width,
      highlight: undefined,
      isNumbered: view.isSettled,
      onDismiss: undefined,
      onChoose: candidate => void choose(host, pane, candidate).catch(() => undefined),
    }),
  )

  return kit.Box({ flexDirection: 'column', children: body })
}
