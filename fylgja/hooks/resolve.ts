import { isRecord } from './payload'
import { drawn } from './plain'
import type { TokenKind } from './token'

/** A reference to ask Fylgja about: the record's id, and the kind its reference names. */
export type Asked = { id: string; kind: TokenKind }

/** How many references one `resolve` call asks about. */
export const MAX_REFERENCES = 20

/** No chip shows more of a title than this. */
const MAX_TITLE = 80

/**
 * A record Fylgja confirmed the person may read, as much of it as a chip
 * shows. The title is held as it is drawn: already made safe, never empty.
 */
export type Found = {
  state: 'found'
  id: string
  kind: string
  title: string
  date: string | null
  isPrivate: boolean
}

/** A reference Fylgja could not find, or that is not the person's to read. */
export type Missing = { state: 'missing'; id: string; kind: string }

export type Resolution = Found | Missing

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function foundOf(record: Record<string, unknown>, token: Asked): Found | undefined {
  const title = typeof record.title === 'string' ? drawn(record.title, MAX_TITLE) : ''
  // Fylgja may know kinds this build does not; any plain word is taken.
  const kind = typeof record.kind === 'string' && /^[a-z_]{1,40}$/.test(record.kind) ? record.kind : null
  const date = text(record.date)
  // A record answered under another id than the one asked for is not trusted.
  const isAsked = typeof record.id === 'string' && record.id.toLowerCase() === token.id

  // A title with nothing left to draw confirms nothing a person could read.
  if (!isAsked || title === '' || kind === null) {
    return undefined
  }

  return {
    state: 'found',
    id: token.id,
    kind,
    title,
    date: date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    isPrivate: record.visibility === 'private to you',
  }
}

/**
 * What Fylgja said about each reference asked for by id, in the order asked;
 * or undefined when the answer is not the list expected.
 *
 * An entry that fits neither "found" nor "not found" is left out, so nothing
 * is claimed about that reference either way.
 */
export function resolutionsOf(
  payload: Record<string, unknown>,
  asked: readonly Asked[],
): Resolution[] | undefined {
  if (!Array.isArray(payload.records)) {
    return undefined
  }

  const answered = new Map<string, Record<string, unknown>>()

  for (const record of payload.records) {
    if (isRecord(record) && typeof record.ref === 'string') {
      answered.set(record.ref.toLowerCase(), record)
    }
  }

  const resolutions: Resolution[] = []

  for (const token of asked) {
    const record = answered.get(token.id)

    if (record?.found === false) {
      resolutions.push({ state: 'missing', id: token.id, kind: token.kind })
    } else if (record?.found === true) {
      const found = foundOf(record, token)

      if (found !== undefined) {
        resolutions.push(found)
      }
    }
  }

  return resolutions
}
