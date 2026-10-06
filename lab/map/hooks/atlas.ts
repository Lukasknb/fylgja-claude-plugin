/**
 * What the map remembers of the project tree and how it reads more: one
 * level per call, on the session's own Fylgja connection, kept in this
 * module's memory only and bounded.
 */

import type { Host } from './host'
import { knowledgeOf, listedOf, outlineOf } from './outline'
import type { Listed } from './outline'
import { payloadOf } from './payload'
import { drawn } from './plain'
import { recencyOf } from './recency'
import { ROOT, startOf } from './shape'
import type { Fetch, Knowledge, Place, Position, Row } from './shape'

/** How many places and how many state views are kept; the oldest go first. */
const PLACES_MAX = 240
const KNOWLEDGE_MAX = 40
/** A level's children are read a page at a time, up to this many pages. */
const PAGES_MAX = 5
/** Reads under way at once, and reads started within any one minute. */
const AT_ONCE = 3
const PER_MINUTE = 90
/** How many listed projects are opened to find the top-level areas. */
const PROBES_MAX = 6

export const SIGN_IN_NOTE = 'Fylgja needs sign-in: run /mcp, then /map again.'
export const OFFLINE_NOTE = 'Fylgja is not available in this session.'
export const UNREADABLE_NOTE = 'The project tree could not be read.'

export type Atlas = {
  places: Map<string, Place>
  knowledge: Map<string, Knowledge>
  /** A place's path as the server spelled it, for lookups by name. */
  rawPaths: Map<string, string[]>
  /** What is being read or could not be read, by `o:<id>` and `s:<id>`. */
  fetches: Map<string, Fetch>
  /** The top-level areas found so far, in the order found. */
  tops: Row[]
  /** Whether the search for top-level areas has finished. */
  hasReadTops: boolean
  /** Whether top-level areas may exist that `tops` does not hold. */
  mayMissTops: boolean
  /** One line while Fylgja cannot be reached at all, else ''. */
  note: string
  /** One line after a project asked for by name was not found, else ''. */
  miss: string
  /** How often each read has failed; one that failed twice is not tried again until asked for anew. */
  failures: Map<string, number>
  /** Where the person is, as the hooks module last heard or set it. */
  position: Position
  /** Counts the times the hooks module moved the person; the navigator follows a change. */
  epoch: number
  /** Counts the times everything was dropped; an answer from before a drop is not kept. */
  generation: number
  /** Reads waiting for a free slot, and how many are under way. */
  queue: (() => void)[]
  running: number
  /** When the reads of the last minute started. */
  started: number[]
}

export function create(): Atlas {
  return {
    places: new Map(),
    knowledge: new Map(),
    rawPaths: new Map(),
    fetches: new Map(),
    tops: [],
    hasReadTops: false,
    mayMissTops: false,
    note: '',
    miss: '',
    failures: new Map(),
    position: startOf(),
    epoch: 0,
    generation: 0,
    queue: [],
    running: 0,
    started: [],
  }
}

/** Forgets everything read so far. The person's position is kept. */
export function forget(atlas: Atlas): void {
  atlas.generation += 1
  atlas.places.clear()
  atlas.knowledge.clear()
  atlas.rawPaths.clear()
  atlas.fetches.clear()
  atlas.failures.clear()
  atlas.tops = []
  atlas.hasReadTops = false
  atlas.mayMissTops = false
}

/** Whether nothing has been read or tried yet, as after the plugin was loaded anew under an open pane. */
export function isUntouched(atlas: Atlas): boolean {
  return !atlas.hasReadTops && !atlas.fetches.has(`o:${ROOT}`) && !atlas.failures.has(`o:${ROOT}`)
}

/** Lets every read that failed be tried again: the person asked anew. */
export function retry(atlas: Atlas): void {
  atlas.failures.clear()
  atlas.miss = ''

  for (const [key, fetch] of atlas.fetches) {
    if (fetch === 'failed') {
      atlas.fetches.delete(key)
    }
  }
}

function keep<T>(map: Map<string, T>, key: string, value: T, max: number): void {
  map.delete(key)
  map.set(key, value)

  for (const oldest of map.keys()) {
    if (map.size <= max) {
      break
    }

    map.delete(oldest)
  }
}

/** The level above every top-level area, made of the areas found so far. */
function rootOf(atlas: Atlas): Place {
  return {
    id: ROOT,
    name: 'Fylgja',
    path: [],
    band: 'other',
    lifecycle: '',
    definition: '',
    include: [],
    exclude: [],
    atoms: 0,
    meetings: 0,
    weeks: 0,
    last: '',
    flags: [],
    rows: atlas.tops,
    folded: null,
    hasMore: false,
    link: '',
  }
}

/** The place kept under `id`; the root is the areas found so far. */
export function placeOf(atlas: Atlas, id: string): Place | undefined {
  return id === ROOT ? rootOf(atlas) : atlas.places.get(id)
}

/** Waits for a free slot, then runs `read`; rejects when too many reads started this minute. */
async function slot<T>(atlas: Atlas, read: () => Promise<T>): Promise<T> {
  if (atlas.running >= AT_ONCE) {
    await new Promise<void>(resolve => atlas.queue.push(resolve))
  }

  const now = Date.now()
  atlas.started = atlas.started.filter(at => now - at < 60_000)

  if (atlas.started.length >= PER_MINUTE) {
    atlas.queue.shift()?.()
    throw new Error('too many reads this minute')
  }

  atlas.started.push(now)
  atlas.running += 1

  try {
    return await read()
  } finally {
    atlas.running -= 1
    atlas.queue.shift()?.()
  }
}

/**
 * One read tool called on Fylgja, answered as its JSON object, or undefined
 * for every way it can fail: signed out, switched off, an error, another
 * shape. The pane's one line says which, and signing out drops what was read
 * so nothing shows what another account was allowed to see.
 */
async function ask(
  host: Host,
  atlas: Atlas,
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const generation = atlas.generation

  try {
    const connection = await host.connect()

    if (!connection.isConnected) {
      const note = connection.reason === 'auth' ? SIGN_IN_NOTE : OFFLINE_NOTE

      if (atlas.note !== note) {
        forget(atlas)
        atlas.note = note
      }

      return undefined
    }

    atlas.note = ''
    const answer = payloadOf(await slot(atlas, () => host.call(connection.server, tool, args)))

    return generation === atlas.generation ? answer : undefined
  } catch {
    return undefined
  }
}

/** Reads a project's outline with every page of its children, by id or by name. */
async function readOutline(host: Host, atlas: Atlas, ref: string): Promise<Place | undefined> {
  let place: Place | undefined
  let cursor: string | undefined

  for (let page = 0; page < PAGES_MAX; page += 1) {
    const args = cursor === undefined ? { ref, detail: false } : { ref: place?.id ?? ref, detail: false, cursor }
    const read = outlineOf(await ask(host, atlas, 'open', args), Date.now())

    if (read === undefined) {
      break
    }

    if (place === undefined) {
      place = read.place
      atlas.rawPaths.set(place.id, read.rawPath)
    } else {
      const known = new Set(place.rows.map(row => row.id))
      place.rows.push(...read.place.rows.filter(row => !known.has(row.id)))
    }

    cursor = read.next
    place.hasMore = cursor !== undefined

    if (cursor === undefined) {
      break
    }
  }

  if (place !== undefined) {
    keep(atlas.places, place.id, place, PLACES_MAX)
  }

  return place
}

/** Runs `read` once per key at a time and keeps whether it is under way or failed. */
async function once<T>(
  host: Host,
  atlas: Atlas,
  key: string,
  read: () => Promise<T | undefined>,
): Promise<T | undefined> {
  if (atlas.fetches.get(key) === 'loading' || (atlas.failures.get(key) ?? 0) >= 2) {
    return undefined
  }

  atlas.fetches.set(key, 'loading')
  const generation = atlas.generation
  const value = await read()

  if (generation === atlas.generation) {
    if (value === undefined) {
      atlas.fetches.set(key, 'failed')
      atlas.failures.set(key, (atlas.failures.get(key) ?? 0) + 1)
    } else {
      atlas.fetches.delete(key)
    }
  }

  host.redraw()

  return value
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function addTop(atlas: Atlas, place: Place): void {
  if (!atlas.tops.some(top => top.id === place.id)) {
    atlas.tops = [
      ...atlas.tops,
      {
        id: place.id,
        name: place.name,
        band: place.band,
        recency: recencyOf(place.last, Date.now()),
        kids: place.rows.length + (place.folded?.count ?? 0),
      },
    ]
  }
}

/**
 * The top-level area a place sits under: the place itself at the top, an
 * area already found, or the area of that name looked up. Undefined when the
 * name does not lead to a top-level project (two projects share it, say).
 */
async function topOf(host: Host, atlas: Atlas, place: Place): Promise<Place | undefined> {
  if (place.path.length <= 1) {
    return place
  }

  const found = atlas.tops.find(top => sameName(top.name, place.path[0] ?? ''))
  const known = found === undefined ? undefined : atlas.places.get(found.id)

  if (known !== undefined) {
    return known
  }

  const raw = atlas.rawPaths.get(place.id)?.[0]
  const top = raw === undefined ? undefined : await readOutline(host, atlas, raw)

  return top !== undefined && top.path.length <= 1 ? top : undefined
}

/**
 * Finds the top-level areas. The server lists projects flat, without their
 * place in the tree, so a few listed projects are opened and each one's path
 * names its area. The search stops after a handful; when projects are left
 * that nothing placed, the root column says areas may be missing.
 */
async function readTops(host: Host, atlas: Atlas): Promise<true | undefined> {
  const listed = listedOf(await ask(host, atlas, 'get_project', { limit: 200 }))

  if (listed === undefined) {
    return undefined
  }

  const unplaced = new Map<string, Listed>(listed.projects.map(project => [project.id, project]))

  for (const top of atlas.tops) {
    unplaced.delete(top.id)
  }

  for (let probe = 0; probe < PROBES_MAX && unplaced.size > 0; probe += 1) {
    const [id] = unplaced.keys()

    if (id === undefined) {
      break
    }

    unplaced.delete(id)
    const place = atlas.places.get(id) ?? (await readOutline(host, atlas, id))

    if (place === undefined) {
      continue
    }

    // A project whose area cannot be found by name is listed at the top
    // itself: it stays reachable, one level higher than it really sits.
    const top = (await topOf(host, atlas, place)) ?? place
    addTop(atlas, top)
    unplaced.delete(top.id)

    for (const row of top.rows) {
      unplaced.delete(row.id)
    }

    host.redraw()
  }

  atlas.mayMissTops = unplaced.size > 0 || listed.isCut
  atlas.hasReadTops = true

  return true
}

/** Starts reading a level that is not known yet. Never waited for by a hook. */
export function wantPlace(host: Host, atlas: Atlas, id: string): void {
  if (id === ROOT) {
    if (!atlas.hasReadTops) {
      void once(host, atlas, `o:${ROOT}`, () => readTops(host, atlas)).then(found => {
        if (found === undefined && atlas.note === '') {
          atlas.note = UNREADABLE_NOTE
          host.redraw()
        }
      })
    }

    return
  }

  if (!atlas.places.has(id)) {
    void once(host, atlas, `o:${id}`, () => readOutline(host, atlas, id))
  }
}

/** Starts reading what is known at a project now. Never waited for by a hook. */
export function wantKnowledge(host: Host, atlas: Atlas, id: string): void {
  if (id === ROOT || atlas.knowledge.has(id)) {
    return
  }

  void once(host, atlas, `s:${id}`, async () => {
    const known = knowledgeOf(await ask(host, atlas, 'open', { ref: id, detail: true }))

    if (known !== undefined) {
      keep(atlas.knowledge, id, known, KNOWLEDGE_MAX)
    }

    return known
  })
}

/** Puts the person at `position`; the navigator follows. */
function move(host: Host, atlas: Atlas, position: Position): void {
  atlas.position = position
  atlas.epoch += 1
  host.redraw()
}

/**
 * Goes to the project called `name` (or with that id): reads it, then the
 * levels above it by the names in its path, and highlights it in its
 * parent's column. A level that cannot be found by name ends the walk, and
 * the project is listed at the top instead, so it is shown either way.
 */
export async function goTo(host: Host, atlas: Atlas, name: string): Promise<void> {
  const generation = atlas.generation
  const place = await readOutline(host, atlas, name)

  if (generation !== atlas.generation) {
    return
  }

  if (place === undefined) {
    atlas.miss = `No project called '${drawn(name, 60)}' could be read.`

    host.redraw()

    return
  }

  const top = await topOf(host, atlas, place)
  const path = [ROOT]
  let level = top

  if (top !== undefined && top.id !== place.id) {
    path.push(top.id)

    for (const part of place.path.slice(1, -1)) {
      const row: Row | undefined = level?.rows.find(child => sameName(child.name, part))
      level = row === undefined ? undefined : (atlas.places.get(row.id) ?? (await readOutline(host, atlas, row.id)))

      if (level === undefined) {
        break
      }

      path.push(level.id)
    }
  }

  if (generation !== atlas.generation) {
    return
  }

  if (top !== undefined) {
    addTop(atlas, top)
  }

  if (top === undefined || level === undefined) {
    addTop(atlas, place)
  }

  const base = { ...atlas.position, risksOpen: false, commitmentsOpen: false }

  if (level === undefined || top === undefined || top.id === place.id) {
    move(host, atlas, { ...base, path: [ROOT], pick: place.id })
  } else if (level.rows.some(row => row.id === place.id)) {
    move(host, atlas, { ...base, path, pick: place.id })
  } else {
    // Not listed among its parent's rows (a fine-grained child the outline
    // folds into a count): the person is put inside it instead.
    move(host, atlas, { ...base, path: [...path, place.id], pick: '' })
  }
}
