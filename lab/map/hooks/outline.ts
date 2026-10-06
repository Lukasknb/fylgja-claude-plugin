/**
 * Reading what Fylgja answers about the project tree: the flat list of
 * projects, one project's outline, and what is known at a project now.
 *
 * Nothing is trusted beyond its documented fields. Every text is sanitised
 * here, once, and an answer of another shape reads as no answer.
 */

import { isRecord } from './payload'
import { drawn } from './plain'
import { recencyOf } from './recency'
import { isId } from './shape'
import type { Band, Knowledge, Place, Row } from './shape'

const NAME_MAX = 80
const TEXT_MAX = 240
const DEFINITION_MAX = 600
const LIST_MAX = 60

/** The one host a link into the Fylgja app may point at. */
const APP_HOST = 'fylgja.lknblab.dev'

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? drawn(value, max) : ''
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function day(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, LIST_MAX) : []
}

function texts(value: unknown, max: number): string[] {
  return list(value)
    .map(item => text(item, max))
    .filter(item => item !== '')
}

function bandOf(value: unknown): Band {
  return value === 'orientation' || value === 'workstream' || value === 'technical' ? value : 'other'
}

/**
 * The address that opens project `id` in the Fylgja app, when `value` is
 * exactly that: https, Fylgja's own host, no port or credentials, and the
 * path of this very project. Anything else is no link.
 */
function linkOf(value: unknown, id: string): string {
  if (typeof value !== 'string' || !URL.canParse(value)) {
    return ''
  }

  const url = new URL(value)
  const isOurs =
    url.protocol === 'https:' &&
    url.host === APP_HOST &&
    url.username === '' &&
    url.password === '' &&
    url.search === ''

  return isOurs && url.pathname === `/open/project/${id}` && url.hash === '' ? url.href : ''
}

function rowOf(value: unknown, nowMs: number): Row | undefined {
  if (!isRecord(value) || !isId(value.id)) {
    return undefined
  }

  const name = text(value.name, NAME_MAX)

  return name === ''
    ? undefined
    : {
        id: value.id,
        name,
        band: bandOf(value.band),
        recency: recencyOf(value.last_activity, nowMs),
        kids: count(value.children),
      }
}

/** One page of a project's outline as the server sent it. */
export type OutlinePage = {
  place: Place
  /** The project's path as the server spelled it: what a lookup by name must be asked with. */
  rawPath: string[]
  /** The cursor of the next page of children, or undefined on the last. */
  next: string | undefined
}

/** The outline in `payload`, or undefined when it is not one. */
export function outlineOf(payload: Record<string, unknown> | undefined, nowMs: number): OutlinePage | undefined {
  if (payload === undefined || payload.kind !== 'project' || !isRecord(payload.subject) || !isId(payload.subject.id)) {
    return undefined
  }

  const subject = payload.subject
  const id = subject.id as string
  const name = text(subject.name, NAME_MAX)
  const rawPath = list(subject.path).filter((part): part is string => typeof part === 'string')

  if (name === '' || !Array.isArray(payload.children)) {
    return undefined
  }

  const counts = isRecord(payload.counts) ? payload.counts : {}
  const technical = isRecord(payload.technical) ? payload.technical : undefined
  const rows = list(payload.children)
    .map(child => rowOf(child, nowMs))
    .filter((row): row is Row => row !== undefined)

  return {
    place: {
      id,
      name,
      path: rawPath.map(part => drawn(part, NAME_MAX)),
      band: bandOf(payload.band),
      lifecycle: text(payload.lifecycle, 24),
      definition: text(payload.definition, DEFINITION_MAX),
      include: texts(payload.include_cues, NAME_MAX).slice(0, 8),
      exclude: texts(payload.exclude_cues, NAME_MAX).slice(0, 8),
      atoms: count(counts.atoms),
      meetings: count(counts.meetings),
      weeks: count(counts.active_weeks),
      last: day(counts.last_activity),
      flags: texts(payload.flags, 40).slice(0, 6),
      rows,
      folded:
        technical !== undefined && count(technical.count) > 0
          ? {
              count: count(technical.count),
              names: texts(technical.names, NAME_MAX).slice(0, 3),
            }
          : null,
      hasMore: false,
      link: linkOf(payload.link, id) || linkOf(subject.link, id),
    },
    rawPath,
    next: typeof payload.next_cursor === 'string' && payload.next_cursor !== '' ? payload.next_cursor : undefined,
  }
}

/** A project as the flat list names it. */
export type Listed = { id: string; name: string }

/** The projects of the flat list that are not archived, or undefined when `payload` is no list. */
export function listedOf(
  payload: Record<string, unknown> | undefined,
): { projects: Listed[]; isCut: boolean } | undefined {
  if (payload === undefined || !Array.isArray(payload.projects)) {
    return undefined
  }

  const all = payload.projects.filter(
    (item): item is { id: string; name: string; archived?: unknown } =>
      isRecord(item) && isId(item.id) && typeof item.name === 'string',
  )

  return {
    projects: all.filter(item => item.archived !== true).map(item => ({ id: item.id, name: item.name })),
    isCut: count(payload.total) > payload.projects.length,
  }
}

function atomDay(value: unknown): string {
  return isRecord(value) ? day(value.occurred_at) : ''
}

/** What is known at a project now, or undefined when `payload` is not a state view. */
export function knowledgeOf(payload: Record<string, unknown> | undefined): Knowledge | undefined {
  if (payload === undefined || !isRecord(payload.current) || payload.focus != null) {
    return undefined
  }

  const open = isRecord(payload.open) ? payload.open : {}

  return {
    aspects: list(payload.current.aspects)
      .filter(isRecord)
      .map(aspect => ({
        question: text(aspect.title, 120),
        value: text(aspect.value, TEXT_MAX) || (isRecord(aspect.current) ? text(aspect.current.content, TEXT_MAX) : ''),
        date: atomDay(aspect.current),
        isGroup: aspect.is_group === true,
      }))
      .filter(aspect => aspect.question !== '' && (aspect.isGroup || aspect.value !== '')),
    decisions: list(payload.current.decisions)
      .filter(isRecord)
      .map(atom => ({
        text: text(atom.content, TEXT_MAX),
        date: day(atom.occurred_at),
      }))
      .filter(atom => atom.text !== ''),
    risks: list(open.risks)
      .filter(isRecord)
      .map(atom => text(atom.content, TEXT_MAX))
      .filter(risk => risk !== ''),
    commitments: list(open.commitments)
      .filter(isRecord)
      .map(item => ({
        what: text(item.what, TEXT_MAX),
        deadline: day(item.deadline),
      }))
      .filter(item => item.what !== ''),
    proposed: list(payload.changes).filter(change => isRecord(change) && change.status === 'proposed').length,
    isCut: payload.truncated === true,
  }
}
