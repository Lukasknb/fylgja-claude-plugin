import { drawn } from './plain'
import type { TokenKind } from './token'

/** One record the person can put in the prompt. */
export type Candidate = {
  kind: TokenKind
  /** The record's id, lower-cased. */
  id: string
  /** The title as the server sent it. Sanitised wherever it is shown or written. */
  title: string
  /** `YYYY-MM-DD`, when the server gave one. */
  date: string | undefined
}

/** No list shows more than this many records. */
export const MAX_ROWS = 6

const KINDS: readonly string[] = ['meeting', 'session', 'note', 'project']
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DATE = /^\d{4}-\d{2}-\d{2}/

/** The longest label written into a reference. */
const MAX_LABEL = 80

/** `kind` when a reference can name a record of that kind. */
export function kindOf(kind: unknown): TokenKind | undefined {
  return typeof kind === 'string' && KINDS.includes(kind) ? (kind as TokenKind) : undefined
}

/** `id` lower-cased when it is a record id, else undefined. */
export function idOf(id: unknown): string | undefined {
  const lower = typeof id === 'string' ? id.toLowerCase() : ''

  return ID.test(lower) ? lower : undefined
}

/** The day at the start of `date`, when it starts with one. */
export function dayOf(date: unknown): string | undefined {
  return typeof date === 'string' && DATE.test(date) ? date.slice(0, 10) : undefined
}

/**
 * The reference for `candidate`, as the Fylgja app copies one:
 * `{{fylgja:<kind> <title>|<id>}}`.
 *
 * The title is only a label for the person, and it came from the server, so
 * it is flattened first: one line, no invisible characters, no brackets, and
 * no bar. Whatever a title holds, what is written is exactly one reference,
 * to this record's id.
 */
export function referenceOf(candidate: Candidate): string {
  const label = drawn(candidate.title, MAX_LABEL).replace(/[{}|]/g, '/')

  return `{{fylgja:${candidate.kind}${label === '' ? '' : ` ${label}`}|${candidate.id}}}`
}

/** `list` without a record named twice, at most `max` long. */
export function distinct(list: readonly Candidate[], max: number): Candidate[] {
  const seen = new Set<string>()
  const kept: Candidate[] = []

  for (const one of list) {
    if (kept.length >= max) {
      break
    }

    if (!seen.has(one.id)) {
      seen.add(one.id)
      kept.push(one)
    }
  }

  return kept
}
