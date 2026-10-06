/**
 * Reading the two answers the picker asks Fylgja for: the timeline's text,
 * for the most recent meetings, and a search's hits.
 *
 * Both came from the server. Only the documented fields are read, and an
 * answer of another shape is undefined, never a guess.
 */

import { dayOf, distinct, idOf, kindOf, MAX_ROWS } from './candidate'
import type { Candidate } from './candidate'
import { isRecord, payloadOf } from './payload'

/** How many recent meetings are kept to choose and to match from. */
export const MAX_RECENT = 30

// `- <date> · meeting · <title>[ · in <path>] (id: <uuid>)`: one meeting in
// the timeline's text. The id is the last thing on the line.
const MEETING_LINE = /^- (\d{4}-\d{2}-\d{2}) · meeting · (.+) \(id: ([0-9a-fA-F-]{36})\)\s*$/

function textOf(result: unknown): string | undefined {
  if (typeof result === 'string') {
    return result
  }

  if (!isRecord(result) || result.isError === true) {
    return undefined
  }

  // A text tool's structured form is its text under `result`.
  if (isRecord(result.structuredContent) && typeof result.structuredContent.result === 'string') {
    return result.structuredContent.result
  }

  if (!Array.isArray(result.content)) {
    return undefined
  }

  return result.content
    .map(block => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('\n')
}

/**
 * The meetings the timeline's text lists, newest first as the server wrote
 * them, or undefined when the answer is no text at all.
 *
 * Every line that is not a meeting's is passed over: the fence around the
 * record, headings, sessions, changes to the project tree.
 */
export function meetingsOf(result: unknown): Candidate[] | undefined {
  const text = textOf(result)

  if (text === undefined) {
    return undefined
  }

  const found: Candidate[] = []

  for (const line of text.split('\n')) {
    const match = MEETING_LINE.exec(line)
    const id = idOf(match?.[3])

    if (match === null || id === undefined) {
      continue
    }

    // The place the meeting is filed under follows the title; it is not part of it.
    const rest = match[2] ?? ''
    const filed = rest.lastIndexOf(' · in ')

    found.push({
      kind: 'meeting',
      id,
      title: filed > 0 ? rest.slice(0, filed) : rest,
      date: match[1],
    })
  }

  return distinct(found, MAX_RECENT)
}

/**
 * The hits of a search that a reference can name (meetings, sessions, notes
 * and projects), best first, or undefined when the answer has no list of
 * hits. Topics, facts and people are passed over: no reference names them.
 */
export function hitsOf(result: unknown): Candidate[] | undefined {
  const payload = payloadOf(result)

  if (payload === undefined || !Array.isArray(payload.results)) {
    return undefined
  }

  const found: Candidate[] = []

  for (const hit of payload.results) {
    if (!isRecord(hit)) {
      continue
    }

    const kind = kindOf(hit.type)
    const id = idOf(hit.id)

    if (kind !== undefined && id !== undefined) {
      found.push({
        kind,
        id,
        title: typeof hit.title === 'string' ? hit.title : '',
        date: dayOf(hit.date),
      })
    }
  }

  return distinct(found, MAX_ROWS)
}
