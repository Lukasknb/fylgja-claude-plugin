/**
 * Reading the records Fylgja returns for a lookup, whichever of its shapes
 * they come in. A record that does not read as one is left out.
 */

import { pageOf } from '../citations'
import { isRecord } from '../payload'
import { anchorsOf } from './repo'
import { namesOf } from './scope'
import type { Fact, ReasonStatus } from './types'

const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

const MAX_FACTS = 30

/** Every record id written in `text`, lower-cased. */
export function idsIn(text: string): string[] {
  return (text.match(ID) ?? []).map(id => id.toLowerCase())
}

export function reasonStatusOf(value: unknown): ReasonStatus | null {
  return value === 'stated' || value === 'not_stated' || value === 'no_strong_reason' ? value : null
}

function strings(value: unknown, max: number): string[] {
  return (Array.isArray(value) ? value : [])
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    .slice(0, max)
}

/** A record's path anchors, from a plain list of them or from a list that mixes paths and commits. */
function paths(value: unknown): unknown[] {
  const list = isRecord(value) ? value.paths : value

  return (Array.isArray(list) ? list : []).flatMap(entry => {
    if (!isRecord(entry)) {
      return [entry]
    }

    if (entry.kind !== undefined && entry.kind !== 'path') {
      return []
    }

    return [{ path: entry.path ?? entry.ref, symbol: entry.symbol, added_by: entry.added_by }]
  })
}

function factOf(value: unknown): Fact | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const id = typeof value.id === 'string' ? value.id : value.atom_id
  const kind = typeof value.type === 'string' ? value.type : value.kind
  const day = [value.last_verified, value.created_at, value.date].find(
    (entry): entry is string => typeof entry === 'string' && /^\d{4}-\d{2}-\d{2}/.test(entry),
  )

  if (
    typeof id !== 'string' ||
    idsIn(id)[0] !== id.toLowerCase() ||
    typeof value.content !== 'string' ||
    value.content.trim() === ''
  ) {
    return undefined
  }

  return {
    id: id.toLowerCase(),
    kind: typeof kind === 'string' && /^[a-z_]{1,40}$/.test(kind) ? kind : 'record',
    content: value.content,
    detail: typeof value.detail === 'string' ? value.detail : '',
    alternatives: strings(value.alternatives, 6),
    anchors: anchorsOf(paths(value.anchors), 12),
    addedByOthers: paths(value.anchors).flatMap(anchor =>
      isRecord(anchor) && anchor.added_by === 'other' && typeof anchor.path === 'string' ? [anchor.path] : [],
    ),
    reasonStatus: reasonStatusOf(value.reason_status),
    date: day?.slice(0, 10) ?? null,
    origin: typeof value.origin === 'string' && /^[a-z_]{1,40}$/.test(value.origin) ? value.origin : '',
    link: pageOf(value.link),
    changed: changedOf(value),
    ...(namesOf(value.applies_to).length === 0 ? {} : { appliesTo: namesOf(value.applies_to) }),
  }
}

/** No more files a commit touched are kept of one record than this. */
const MAX_CHANGED = 6

/**
 * The files of a record that a commit touched after it was last confirmed,
 * as the server names them; null when it says no such thing. A record marked
 * so without its files is kept as marked, with none named.
 */
function changedOf(value: Record<string, unknown>): string[] | null {
  const stamp = isRecord(value.code_changed) ? value.code_changed : undefined

  return stamp === undefined && value.staleness !== 'code_changed' ? null : strings(stamp?.paths, MAX_CHANGED)
}

/** No more of one file's path is said than this. */
const MAX_PATH = 120

/**
 * What is said of a record whose code changed after it was last confirmed,
 * wherever the record is shown to a person or handed to a model: a few
 * plain words and the file, so that neither takes it for settled. Undefined
 * for every other record.
 *
 * @param safe makes a path fit to stand where the line is put
 */
export function changedLine(fact: Pick<Fact, 'changed'>, safe: (path: string, max: number) => string): string | undefined {
  if (fact.changed === null) {
    return undefined
  }

  // On one line, whatever the path holds.
  const [first, ...rest] = fact.changed.map(path => safe(path.replace(/\s+/g, ' ').trim(), MAX_PATH)).filter(path => path !== '')

  return first === undefined
    ? 'Its code changed since it was last confirmed.'
    : `Its code changed since it was last confirmed: ${first}${rest.length === 0 ? '' : ` and ${rest.length} more`}`
}

/** The records a lookup answered with, each once, in the order given. */
export function factsOf(payload: Record<string, unknown> | undefined): Fact[] {
  const list = payload === undefined ? [] : [payload.facts, payload.matches, payload.records].find(Array.isArray)
  const facts = new Map<string, Fact>()

  for (const entry of (list as unknown[] | undefined) ?? []) {
    const fact = factOf(entry)

    if (fact !== undefined && !facts.has(fact.id) && facts.size < MAX_FACTS) {
      facts.set(fact.id, fact)
    }
  }

  return [...facts.values()]
}

/** Whether `fact` is anchored to one of `files` itself, not to a folder above it. */
export function isAnchoredTo(fact: Fact, files: readonly string[]): boolean {
  return fact.anchors.some(anchor => files.includes(anchor.path))
}

/**
 * How many repositories Fylgja offered in place of a spelling it does not
 * know; 0 when it knew the one asked for. Scribe never switches to one of
 * them by itself: which repository this is, is the session's to say.
 */
export function knownReposIn(payload: Record<string, unknown> | undefined): number {
  return Array.isArray(payload?.known_repos) ? payload.known_repos.length : 0
}
