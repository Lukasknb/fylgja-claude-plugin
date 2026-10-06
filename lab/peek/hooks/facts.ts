import { isRecord } from './payload'
import { drawn } from './plain'
import { isMeeting, pathOf } from './record'
import type { Rec } from './record'

/**
 * What is cheaply known about a record: enough for the card a chip shows
 * under the pointer. Everything in it came from Fylgja and is safe to draw.
 */
export type Found = {
  state: 'found'
  id: string
  kind: string
  title: string
  date: string | null
  /** Where the record is filed, from the top; empty when unknown. */
  path: string[]
  /** A meeting's decisions and commitments, counted; null when not known. */
  decisions: number | null
  commitments: number | null
}

/** A record Fylgja could not find, or that is not the person's to read. */
export type Missing = { state: 'missing'; id: string }

export type Fact = Found | Missing

/**
 * What `resolve` said about the record asked for by `id`, or undefined when
 * its entry says nothing usable. An entry answered under another id is not
 * trusted, and a title with nothing left to draw confirms nothing.
 */
export function factOfResolved(entry: Record<string, unknown>, id: string): Fact | undefined {
  if (entry.found === false) {
    return { state: 'missing', id }
  }

  const title = typeof entry.title === 'string' ? drawn(entry.title, 80) : ''
  const kind = typeof entry.kind === 'string' && /^[a-z_]{1,40}$/.test(entry.kind) ? entry.kind : undefined
  const isAsked = typeof entry.id === 'string' && entry.id.toLowerCase() === id

  if (entry.found !== true || !isAsked || title === '' || kind === undefined) {
    return undefined
  }

  return {
    state: 'found',
    id,
    kind,
    title,
    date: typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : null,
    path: pathOf(entry.project),
    decisions: null,
    commitments: null,
  }
}

/** The entries of a `resolve` answer by the reference each answers, or undefined when it is not that answer. */
export function resolvedById(json: Record<string, unknown>): Map<string, Record<string, unknown>> | undefined {
  if (!Array.isArray(json.records)) {
    return undefined
  }

  const entries = new Map<string, Record<string, unknown>>()

  for (const entry of json.records) {
    if (isRecord(entry) && typeof entry.ref === 'string') {
      entries.set(entry.ref.toLowerCase(), entry)
    }
  }

  return entries
}

/** What a record that was read says for its card. */
export function factOfRecord(record: Rec): Found {
  return {
    state: 'found',
    id: record.id,
    kind: record.kind,
    title: drawn(record.title, 80),
    date: record.date,
    path: record.path,
    decisions: isMeeting(record) ? record.decisions.length : null,
    commitments: isMeeting(record) && record.has.commitments ? record.commitments.length : null,
  }
}

/**
 * `next` with what `before` knew and `next` does not: one source knows where
 * a meeting is filed, another how many decisions it has.
 */
export function merged(before: Fact | undefined, next: Fact): Fact {
  if (before?.state !== 'found' || next.state !== 'found') {
    return next
  }

  return {
    ...next,
    date: next.date ?? before.date,
    path: next.path.length > 0 ? next.path : before.path,
    decisions: next.decisions ?? before.decisions,
    commitments: next.commitments ?? before.commitments,
  }
}
