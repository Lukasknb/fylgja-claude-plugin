/**
 * Whether the fix for a reported image landed, and whether the code it
 * changed was the session's own work in progress or brought in with the
 * report. Only paths are held, never what a file says.
 *
 * When a prompt with images enters, a snapshot is taken: the files the
 * session had changed, and the files git says are changed in the tree. Every
 * step of the main conversation and of its agents adds the files it changes
 * to the reading's `since`. At a turn's end the fix has landed when `since`
 * holds a product source file; it was work in progress when any such file
 * was in the snapshot, else it was brought in. Work in progress is never
 * asked about: it is context for Fylgja, as every reading is.
 */

import { isCode } from '../scribe/anchoring'
import type { Reading, WorkState } from '../reader/reader'
import { relativeTo } from '../scribe/repo'
import type { Place } from '../scribe/types'
import { stateKey } from '../scribe/verdict'

/** No more paths are held of a reading's snapshot, or of what changed since, than this. */
export const MAX_PATHS = 200

/** Tests and their fixtures are no product: a fix shows in the code the tests hold to. */
const TEST_PATH = /(?:^|\/)(?:tests?|__tests__|__mocks__|specs?|fixtures|testdata|e2e)\/|(?:^|\/)test_[^/]*$|[._-](?:test|spec)\.[^/]+$|_test\.[^/]+$|(?:^|\/)conftest\.py$/i

/** Whether a path from its repository's root is a test or a test's fixture. */
export function isTestPath(path: string): boolean {
  return TEST_PATH.test(path)
}

/** Whether a file is product source: code, and no test. */
export function isProduct(path: string): boolean {
  return isCode(path) && !isTestPath(path)
}

/** The files a step changed join what changed since each reading still being followed entered. */
export function changed(readings: readonly Reading[], files: readonly string[]): void {
  for (const reading of readings) {
    if (reading.status === 'given_up' || reading.verdict !== undefined || reading.workState !== 'unknown' || reading.turnsLeft <= 0) {
      continue
    }

    reading.since = [...new Set([...reading.since, ...files])].slice(-MAX_PATHS)
  }
}

/** The paths of `git status --porcelain -z`, as paths from the tree's root; a rename gives both its paths. */
export function dirtyOf(stdout: string): string[] {
  const entries = stdout.split('\0').filter(entry => entry !== '')
  const paths: string[] = []

  for (let at = 0; at < entries.length; at += 1) {
    const entry = entries[at] ?? ''
    const path = entry.slice(3)

    if (path !== '') {
      paths.push(path)
    }

    // A rename or a copy is followed by the path it came from.
    if (/^[RC]/.test(entry)) {
      at += 1
      paths.push(entries[at] ?? '')
    }
  }

  return paths.filter(path => path !== '').slice(0, MAX_PATHS)
}

/**
 * The product files the fix changed, each where it lies, once it has landed;
 * none while it has not. A file the session cannot place in a repository
 * is no product file of one.
 */
export function landedIn(reading: Reading, places: ReadonlyMap<string, Place>): Place[] {
  const found = reading.since.flatMap(file => {
    const place = places.get(file)

    return place !== undefined && isProduct(place.path) ? [place] : []
  })

  return [...new Map(found.map(place => [stateKey(place), place])).values()]
}

/** What the fix was, by the files it landed in: work in progress when one of them was changed before the report came. */
export function workStateOf(reading: Reading, landed: readonly Place[], root: string, places: ReadonlyMap<string, Place>): WorkState {
  if (landed.length === 0) {
    return 'unknown'
  }

  const before = new Set(reading.before)
  const dirty = new Set(reading.dirty ?? [])
  // The tree's own files as git names them, by the path a tool line writes.
  const inTree = (place: Place): boolean =>
    reading.since.some(file => stateKeyOf(places.get(file)) === stateKey(place) && dirty.has(relativeTo(root, file) ?? ''))

  return landed.some(place => before.has(stateKey(place)) || inTree(place)) ? 'work_in_progress' : 'brought_in'
}

function stateKeyOf(place: Place | undefined): string | undefined {
  return place === undefined ? undefined : stateKey(place)
}
