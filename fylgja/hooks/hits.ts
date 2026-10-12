/**
 * Reading what Fylgja answers a search with, and what it says of one record
 * the search found. Only what the window shows is taken, each text held as
 * received and made safe where it is drawn. An answer that does not read as
 * the one expected is no answer; a hit that does not read as one is left out.
 */

import { pageOf } from './citations'
import { isRecord } from './payload'
import { resolutionsOf } from './resolve'
import { reasonStatusOf } from './scribe/facts'
import type { ReasonStatus } from './scribe/types'

/** How many hits one search is asked for: the most Fylgja's `search` returns. */
export const MAX_HITS = 20

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}/
const WORD = /^[a-z_]{1,40}$/

/** One record a search found: a pointer to it, as `search` answers. */
export type Hit = {
  id: string
  /** What the server says it is: `atom` for a knowledge atom, whatever the atom holds. */
  kind: string
  /** What it says: the start of its statement, as the server cut it. */
  sentence: string
  /** The topic it is filed in, when the server names one that is not the statement itself. */
  topic: string
  /** The day it was said, `YYYY-MM-DD`. */
  date: string | null
  /** The project it lives under, as the names from the top of the tree down. */
  path: string[]
  /** The organizations it is about. */
  about: string[]
  /** The question it answers, from its topic down. */
  aspect: string[]
  /** The value that holds now, when this is an older statement of it. */
  newer: string
  /** Its page in the Fylgja app; null for a kind the app has no page for, which an atom is. */
  link: string | null
}

/**
 * One record as `open` answers for it: what a hit does not carry. Neither
 * answer says which files a record concerns or how far it is to be relied
 * on; those are `recall`'s to say, which is asked by repository.
 */
export type Detail = {
  /** What the record itself is: a decision, a gotcha, or whatever word the server has for it. */
  kind: string
  /** Its statement, whole. */
  sentence: string
  /** A decision's reason, and whether one was given. */
  reason: string
  reasonStatus: ReasonStatus | null
  /** What was weighed and ruled out. */
  alternatives: string[]
  decidedBy: string
  /** The meeting, session or note it was said in. */
  source: { id: string; title: string } | null
}

/** The record a hit was said in, as `resolve` answers for it. */
export type Source = { kind: string; title: string; date: string | null; link: string | null }

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function texts(value: unknown, max: number): string[] {
  return (Array.isArray(value) ? value : []).map(text).filter(one => one !== '').slice(0, max)
}

function word(value: unknown): string {
  return typeof value === 'string' && WORD.test(value) ? value : ''
}

function day(value: unknown): string | null {
  return typeof value === 'string' && DAY.test(value) ? value.slice(0, 10) : null
}

function hitOf(value: unknown): Hit | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !ID.test(value.id)) {
    return undefined
  }

  const title = text(value.title)
  const sentence = text(value.content_preview) || title

  if (sentence === '') {
    return undefined
  }

  return {
    id: value.id.toLowerCase(),
    kind: word(value.type) || 'record',
    sentence,
    // A record filed in no topic is titled with the start of its own statement.
    topic: sentence.startsWith(title) ? '' : title,
    date: day(value.date),
    path: isRecord(value.project) ? texts(value.project.path, 8) : [],
    about: texts(value.entities, 6),
    aspect: texts(value.aspect_path, 6),
    newer: isRecord(value.newer_value) ? text(value.newer_value.value) : '',
    link: pageOf(value.link),
  }
}

/**
 * The records a search found, each once, in the order given; or undefined
 * when the answer is not the list expected. A search for one kind that
 * matched nothing of it answers with records of other kinds and says so:
 * those are not what was asked for, and nothing was found.
 */
export function hitsOf(payload: Record<string, unknown>): Hit[] | undefined {
  if (!Array.isArray(payload.results)) {
    return undefined
  }

  const hits = new Map<string, Hit>()

  for (const entry of payload.filter_matched === false ? [] : payload.results) {
    const hit = hitOf(entry)

    if (hit !== undefined && !hits.has(hit.id) && hits.size < MAX_HITS) {
      hits.set(hit.id, hit)
    }
  }

  return [...hits.values()]
}

/**
 * What `open` says of the record `id`, or undefined when the answer is not
 * about that record: one answered under another id is not trusted.
 */
export function detailOf(payload: Record<string, unknown>, id: string): Detail | undefined {
  const focus = isRecord(payload.focus) ? payload.focus : undefined
  const atom = isRecord(focus?.atom) ? focus.atom : undefined

  if (focus === undefined || atom === undefined || text(atom.id).toLowerCase() !== id || text(atom.content) === '') {
    return undefined
  }

  const decision = isRecord(focus.decision) ? focus.decision : {}
  const sourceId = text(atom.source_id).toLowerCase()

  return {
    kind: word(atom.type) || 'record',
    sentence: text(atom.content),
    reason: text(decision.reason),
    reasonStatus: reasonStatusOf(decision.reason_status),
    alternatives: texts(decision.alternatives, 6),
    decidedBy: text(decision.decided_by_name),
    source: ID.test(sourceId) ? { id: sourceId, title: text(atom.source_title) } : null,
  }
}

/**
 * What `resolve` says the record `id` is, when it is one the person may
 * read: its kind, its own title and day, and its page.
 */
export function sourceOf(payload: Record<string, unknown>, id: string): Source | undefined {
  const [found] = resolutionsOf(payload, [{ id, kind: 'meeting' }]) ?? []

  if (found?.state !== 'found') {
    return undefined
  }

  const answered = (payload.records as unknown[]).find(record => isRecord(record) && text(record.ref).toLowerCase() === id)

  return { kind: found.kind, title: found.title, date: found.date, link: isRecord(answered) ? pageOf(answered.link) : null }
}
