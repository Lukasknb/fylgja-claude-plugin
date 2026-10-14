/**
 * Which records Scribe kept in a conversation, as kept on this machine so
 * that a plugin loaded again for the same conversation lists them again.
 *
 * Claude Code loads the plugin afresh, with nothing it held, when the
 * conversation is moved to the background from the agents view and opened
 * again: the conversation then goes on in a background job that resumed it
 * as a fork, under an id of its own, and a job that is started again later
 * resumes it under that id. What is kept here is how such a load finds the
 * conversation it goes on: by its id, or by marks of the rows it had when
 * this was written, which a fork carries over: the id of its last tool
 * call, and a hash of those rows taken in order. Neither is a word of the
 * conversation.
 *
 * Each conversation is kept under a key of its own, so no session ever
 * writes over another's. A short index of them, newest last, is how the
 * oldest are let go: losing a write to it costs that pruning, never a
 * conversation's records.
 *
 * Ids and fixed words only, never a word of a record: the record's
 * sentence, reason and what was ruled out are asked of Fylgja again when the
 * list is picked up (`open`, one record each), and a record Fylgja says it
 * no longer has is not listed.
 */

import type { Detail } from '../hits'
import { isRecord } from '../payload'
import type { Row } from './delta'
import type { RecordKind, Written } from './types'

/** The key one conversation is kept under is this and its id. */
export const PREFIX = 'scribe.list.'

/** The index of the conversations kept, oldest first. */
export const INDEX = 'scribe.lists'

/** No more conversations are kept than this; the one written longest ago goes first. */
export const MAX_SAVED = 20

/** No more records of one conversation are kept than the window lists. */
export const MAX_RECORDS = 40

/** No more keys are read when a conversation is looked for than this: the index's first, then any it lost. */
export const MAX_READ = 60

/** `$.session.messages` answers the newest this many rows: a conversation that long may have older ones it leaves out. */
export const MAX_ROWS = 4096

/**
 * One record a conversation kept: its id, what it is, how it came to be
 * listed, and whether it was a decision that pointed at no code yet.
 */
export type SavedRecord = { id: string; kind: RecordKind; outcome: Written['outcome']; waiting?: true }

/** What tells the conversation's rows apart, as they stood when it was written. */
export type Marks = {
  /** The id of the last tool call; null when it had made none. */
  tie: string | null
  /** A hash of the first `count` rows, in order; null with none. */
  seed: string | null
  count: number
}

/** One conversation: its id, when it was written, its marks, and its records, oldest first. */
export type Saved = Marks & { id: string; at: number; records: SavedRecord[] }

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SESSION = /^[A-Za-z0-9_-]{1,80}$/
const TIE = /^[A-Za-z0-9_-]{1,120}$/
const SEED = /^[0-9a-z]{1,16}$/
const KINDS: readonly string[] = ['decision', 'gotcha', 'correction'] satisfies RecordKind[]
const OUTCOMES: readonly string[] = ['created', 'restored', 'reasoned', 'held', 'updated', 'withdrawn'] satisfies Written['outcome'][]

/** The key the conversation `id` is kept under; undefined for an id that cannot be one. */
export function keyOf(id: string): string | undefined {
  return SESSION.test(id) ? `${PREFIX}${id}` : undefined
}

function savedRecordOf(value: unknown): SavedRecord | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !ID.test(value.id)) {
    return undefined
  }

  const kind = typeof value.kind === 'string' && KINDS.includes(value.kind) ? (value.kind as RecordKind) : undefined
  const outcome = typeof value.outcome === 'string' && OUTCOMES.includes(value.outcome) ? (value.outcome as Written['outcome']) : undefined

  if (kind === undefined || outcome === undefined) {
    return undefined
  }

  return value.waiting === true ? { id: value.id, kind, outcome, waiting: true } : { id: value.id, kind, outcome }
}

/** One conversation as the store holds it, or undefined when it does not read as one. */
export function savedOf(value: unknown): Saved | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !SESSION.test(value.id)) {
    return undefined
  }

  const records = (Array.isArray(value.records) ? value.records : []).flatMap(one => savedRecordOf(one) ?? []).slice(-MAX_RECORDS)
  const count = typeof value.count === 'number' && Number.isInteger(value.count) && value.count > 0 ? value.count : 0
  const seed = typeof value.seed === 'string' && SEED.test(value.seed) && count > 0 ? value.seed : null

  return {
    id: value.id,
    at: typeof value.at === 'number' && Number.isFinite(value.at) ? value.at : 0,
    tie: typeof value.tie === 'string' && TIE.test(value.tie) ? value.tie : null,
    seed,
    count: seed === null ? 0 : count,
    records,
  }
}

/** The index as the store holds it: the ids it lists, each once, oldest first. Anything else reads as none. */
export function indexOf(value: unknown): string[] {
  const ids = (Array.isArray(value) ? value : []).filter((id): id is string => typeof id === 'string' && SESSION.test(id))

  return ids.filter((id, at) => ids.lastIndexOf(id) === at)
}

/** The index with `id` written last, and the ids it lets go for their number. */
export function indexed(index: readonly string[], id: string): { index: string[]; dropped: string[] } {
  const all = [...index.filter(one => one !== id), id]

  return { index: all.slice(-MAX_SAVED), dropped: all.slice(0, Math.max(0, all.length - MAX_SAVED)) }
}

/** A short hash of `text` (53 bits, in base 36): what tells rows apart, and holds none of their words. */
function hashOf(text: string, seed = 0): string {
  let one = 0xdeadbeef ^ seed
  let two = 0x41c6ce57 ^ seed

  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at)

    one = Math.imul(one ^ code, 2654435761)
    two = Math.imul(two ^ code, 1597334677)
  }

  one = Math.imul(one ^ (one >>> 16), 2246822507) ^ Math.imul(two ^ (two >>> 13), 3266489909)
  two = Math.imul(two ^ (two >>> 16), 2246822507) ^ Math.imul(one ^ (one >>> 13), 3266489909)

  return (4294967296 * (2097151 & two) + (one >>> 0)).toString(36)
}

/** The hash of each prefix of the rows: the first `n` rows hash to the `n - 1`th. */
function prefixesOf(rows: readonly Row[]): string[] {
  const hashes: string[] = []
  let last = ''

  for (const row of rows) {
    const calls = row.toolUses.map(use => use.tool_use_id ?? use.tool).join(',')

    last = hashOf(`${last}\u0000${row.role}\u0000${row.text}\u0000${calls}`)
    hashes.push(last)
  }

  return hashes
}

/** The ids of the tool calls the conversation's rows hold, oldest first. */
function tiesOf(rows: readonly Row[]): string[] {
  return rows.flatMap(row => row.toolUses.flatMap(use => (typeof use.tool_use_id === 'string' && TIE.test(use.tool_use_id) ? [use.tool_use_id] : [])))
}

/** Whether the rows read are the conversation's whole history: then they begin where it began. */
function isWhole(rows: readonly Row[]): boolean {
  return rows.length < MAX_ROWS
}

/**
 * The marks of the rows as they stand. The hash is taken only of a whole
 * history: rows read from a longer one begin wherever its newest rows do,
 * and only the tool call tells it apart.
 */
export function marksOf(rows: readonly Row[]): Marks {
  const seed = isWhole(rows) ? (prefixesOf(rows).at(-1) ?? null) : null

  return { tie: tiesOf(rows).at(-1) ?? null, seed, count: seed === null ? 0 : rows.length }
}

/**
 * The one conversation to pick up for the conversation `id` whose rows are
 * `rows`. Its own, kept under its id, always. Otherwise the one its rows go
 * on from that shares the longest run of rows with them: a fork of a fork
 * shares more with the nearest, which already holds what the older ones
 * kept, and a sibling forked from the same one shares no rows of the other
 * past their common start. The id of the last tool call is used only where
 * the rows cannot be compared: an entry kept with no hash, or rows read
 * from a history longer than the rows answered.
 */
export function nearest(saved: readonly Saved[], id: string, rows: readonly Row[]): Saved | undefined {
  const own = saved.find(one => one.id === id)

  if (own !== undefined) {
    return own
  }

  const prefixes = isWhole(rows) ? prefixesOf(rows) : []
  const ties = new Set(tiesOf(rows))
  const byRows = saved.filter(one => one.seed !== null && one.count <= prefixes.length && prefixes[one.count - 1] === one.seed)

  if (byRows.length > 0) {
    return byRows.reduce((best, one) => (one.count > best.count || (one.count === best.count && one.at > best.at) ? one : best))
  }

  const byTie = saved.filter(one => (one.seed === null || prefixes.length === 0) && one.tie !== null && ties.has(one.tie))

  return byTie.reduce<Saved | undefined>((best, one) => (best === undefined || one.at > best.at ? one : best), undefined)
}

/**
 * A record picked up again, as Fylgja says it reads now. Which files it
 * concerns and its triggers are not said by `open`, so it is marked as
 * known in part: taken out, it is not offered to be put back.
 */
export function recordOf(saved: SavedRecord, detail: Detail): Written {
  return {
    id: saved.id,
    kind: saved.kind,
    content: detail.sentence,
    reasonStatus: detail.reasonStatus,
    ...(detail.reason === '' ? {} : { detail: detail.reason }),
    alternatives: detail.alternatives,
    outcome: saved.outcome,
    replaced: null,
    isPartial: true,
    ...(saved.waiting === true ? { waiting: true as const } : {}),
  }
}
