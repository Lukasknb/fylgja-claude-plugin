/**
 * One list of records that follows a query as it is typed: the one above
 * the prompt, and the one in the pane.
 *
 * With fewer than two characters it shows the most recent meetings. From two
 * on it searches, but not before the typing has paused, and until the answer
 * is there it shows the recent meetings whose title holds what was typed, so
 * something useful is on screen at once.
 */

import { MAX_ROWS } from './candidate'
import type { Candidate } from './candidate'
import type { Host, Timer } from './host'
import * as Source from './source'

/** A search needs at least this many characters. */
export const MIN_QUERY = 2

/** A search goes out this long after the last change of the query, not sooner. */
export const DEBOUNCE_MS = 400

export type Finder = {
  /** What is typed, trimmed; undefined until something was asked for. */
  query: string | undefined
  /** The last search answered, and what for. */
  answer: { query: string; list: Candidate[] } | undefined
  /** Which row a choosing key takes. */
  highlight: number
  /** Counts the changes of the query: an answer to an earlier one is dropped. */
  turn: number
  /** The search that waits for the typing to pause. */
  timer: Timer | undefined
}

export function create(): Finder {
  return {
    query: undefined,
    answer: undefined,
    highlight: 0,
    turn: 0,
    timer: undefined,
  }
}

/** Forgets the query and stops whatever waits to be asked. */
export function reset(finder: Finder): void {
  finder.timer?.cancel()
  finder.timer = undefined
  finder.query = undefined
  finder.answer = undefined
  finder.highlight = 0
  finder.turn += 1
}

async function recents(host: Host, source: Source.Source): Promise<void> {
  await Source.loadRecents(host, source)
  host.redraw()
}

async function search(host: Host, source: Source.Source, finder: Finder, query: string): Promise<void> {
  const turn = finder.turn
  const list = await Source.search(host, source, query, () => finder.turn === turn)

  if (finder.turn !== turn) {
    return
  }

  if (list !== undefined) {
    finder.answer = { query, list }
  }

  host.redraw()
}

/**
 * Makes the list follow `query`. Returns whether the query changed.
 *
 * Nothing is asked of Fylgja here: what has to be asked is left to a timer,
 * `delay` milliseconds on for a search, so the caller (a keystroke) is never
 * kept waiting, and a query that changes again first is never searched.
 */
export function want(host: Host, source: Source.Source, finder: Finder, query: string, delay: number): boolean {
  if (finder.query === query) {
    return false
  }

  finder.timer?.cancel()
  finder.timer = undefined
  finder.query = query
  finder.highlight = 0
  finder.turn += 1

  if (query.length < MIN_QUERY) {
    // Read again when they are old, and when the last call failed: this one may not.
    if (Source.freshRecents(source) === undefined || source.problem !== undefined) {
      finder.timer = host.after(0, () => void recents(host, source).catch(() => undefined))
    }

    return true
  }

  const kept = Source.answered(source, query)

  if (kept !== undefined) {
    finder.answer = { query, list: kept }
  } else if (finder.answer?.query !== query) {
    finder.timer = host.after(delay, () => void search(host, source, finder, query).catch(() => undefined))
  }

  return true
}

export type View = {
  /** The records to list, at most six. */
  rows: Candidate[]
  /** True when the rows are the answer to exactly what is typed: they will not change under the person's finger. */
  isSettled: boolean
  /** The one line to show when there are no rows. */
  line: string | undefined
}

export const SIGN_IN_LINE = 'Fylgja: sign in with /mcp'
export const FAILED_LINE = 'Fylgja did not answer'
export const LOOKING_LINE = 'looking'
export const MORE_LINE = 'one more letter to search'
export const NONE_LINE = 'no matching meeting, session, note or project'
export const NO_RECENT_LINE = 'no recent meetings; type two letters to search'

function matching(list: readonly Candidate[], query: string): Candidate[] {
  const needle = query.toLowerCase()

  return (needle === '' ? list : list.filter(one => one.title.toLowerCase().includes(needle))).slice(0, MAX_ROWS)
}

/**
 * What the list shows now. Reads only what is held; asks nothing.
 *
 * The answer to exactly what is typed comes first. Without one, a problem
 * with Fylgja is said in one line. Otherwise the recent meetings stand in:
 * all of them for no query, those whose title holds it for one letter, and
 * the same as a first guess while a search is on its way.
 */
export function viewOf(finder: Finder, source: Source.Source): View {
  const query = finder.query ?? ''
  const isSearch = query.length >= MIN_QUERY

  if (isSearch && finder.answer?.query === query) {
    const rows = finder.answer.list.slice(0, MAX_ROWS)

    return { rows, isSettled: true, line: rows.length === 0 ? NONE_LINE : undefined }
  }

  if (source.problem !== undefined) {
    return { rows: [], isSettled: false, line: source.problem === 'signed-out' ? SIGN_IN_LINE : FAILED_LINE }
  }

  const held = source.recents?.list
  const rows = held === undefined ? [] : matching(held, query)

  if (rows.length > 0) {
    return { rows, isSettled: !isSearch, line: undefined }
  }

  if (isSearch || held === undefined) {
    return { rows, isSettled: false, line: LOOKING_LINE }
  }

  return { rows, isSettled: false, line: query === '' ? NO_RECENT_LINE : MORE_LINE }
}

/** Moves the highlight one row down (`by` 1) or up (-1), around the ends. */
export function move(finder: Finder, rows: number, by: 1 | -1): void {
  finder.highlight = rows === 0 ? 0 : (Math.min(finder.highlight, rows - 1) + by + rows) % rows
}
