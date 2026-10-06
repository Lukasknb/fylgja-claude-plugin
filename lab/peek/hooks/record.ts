import { isRecord, unfenced } from './payload'
import { drawn, paragraphs } from './plain'
import { linkOf } from './refs'

/**
 * A Fylgja record as the peek pane shows it. Everything a person reads in
 * it is made safe to draw here, once, when the server's answer is taken
 * apart; the markdown body of a note or session is the one exception and is
 * cleaned where it is drawn, because cleaning it needs to know which links
 * the pane answers.
 */

const MAX_TITLE = 120
const MAX_LINE = 400
const MAX_LIST = 40

/** What every kind of record has. */
type Common = {
  id: string
  /** The record's own title or name, safe to draw, never empty. */
  title: string
  /** `YYYY-MM-DD`, or null. */
  date: string | null
  /** Where the record is filed, from the top of the project tree; empty when unknown. */
  path: string[]
  /** "private to you" and the like, when the server said. */
  scope: string | null
  /** Whether the server said it cut the record short. */
  isCut: boolean
}

export type Commitment = { what: string; owner: string | null; deadline: string | null; status: string | null }

export type Meeting = Common & {
  kind: 'meeting'
  participants: string[]
  summary: string | null
  decisions: string[]
  keyPoints: string[]
  commitments: Commitment[]
  /** Which sections the server was asked for and answered: a section not among them is unknown, not empty. */
  has: { participants: boolean; commitments: boolean }
}

export type Child = { id: string; name: string; under: number; lastActivity: string | null }

export type Project = Common & {
  kind: 'project'
  definition: string | null
  meetings: number | null
  children: Child[]
  /** Whether more children exist than this page lists. */
  hasMore: boolean
}

export type Page = Common & {
  /** `note`, `session`, or another kind of document Fylgja keeps as text. */
  kind: string
  /** The record's markdown, as the server sent it between its fences. */
  body: string
}

export type Person = Common & {
  kind: 'person'
  role: string | null
  organization: string | null
  interactions: { date: string | null; summary: string }[]
}

/** A record of a kind this build has no view for. */
export type Other = Common & { kind: string; isOther: true }

export type Rec = Meeting | Project | Page | Person | Other

export function isMeeting(record: Rec): record is Meeting {
  return record.kind === 'meeting' && 'decisions' in record
}

export function isProject(record: Rec): record is Project {
  return record.kind === 'project' && 'children' in record
}

export function isPerson(record: Rec): record is Person {
  return record.kind === 'person' && 'interactions' in record
}

export function isPage(record: Rec): record is Page {
  return 'body' in record
}

const DAY = /^\d{4}-\d{2}-\d{2}/

function dayOf(value: unknown): string | null {
  return typeof value === 'string' && DAY.test(value) ? value.slice(0, 10) : null
}

function line(value: unknown, max = MAX_LINE): string {
  return typeof value === 'string' ? drawn(value, max) : ''
}

function lines(value: unknown, pick: (item: unknown) => unknown = item => item): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .slice(0, MAX_LIST)
    .map(item => line(pick(item)))
    .filter(text => text !== '')
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/** The path a `project` crumb names (`{ path: [...], id }`), safe to draw. */
export function pathOf(crumb: unknown): string[] {
  return isRecord(crumb) ? lines(crumb.path).map(name => drawn(name, 60)) : []
}

const SCOPES: readonly string[] = ['private to you', 'shared with your team', 'private to its author']

function scopeOf(value: unknown): string | null {
  return typeof value === 'string' && SCOPES.includes(value) ? value : null
}

/** Whether an answer names the record that was asked for. One that names another is not trusted. */
function isAsked(answered: unknown, id: string): boolean {
  return typeof answered === 'string' && answered.toLowerCase() === id
}

/**
 * A meeting out of `get_meeting`'s or `open`'s answer, or undefined when
 * the answer is not that meeting.
 */
export function meetingOf(json: Record<string, unknown>, id: string): Meeting | undefined {
  const title = line(json.title, MAX_TITLE)

  if (!isAsked(json.id, id) || title === '') {
    return undefined
  }

  const included = Array.isArray(json.included) ? json.included : []
  const commitments = (Array.isArray(json.action_items) ? json.action_items : [])
    .slice(0, MAX_LIST)
    .filter(isRecord)
    .map(item => ({
      what: line(item.what),
      owner: line(item.assignee_name, 60) || null,
      deadline: dayOf(item.deadline),
      status: line(item.status, 20) || null,
    }))
    .filter(item => item.what !== '')

  return {
    kind: 'meeting',
    id,
    title,
    date: dayOf(json.date),
    path: pathOf(json.project),
    scope: scopeOf(json.scope),
    isCut: json.truncated === true,
    participants: lines(json.participants).map(name => drawn(name, 60)),
    summary: typeof json.summary === 'string' && json.summary.trim() !== '' ? paragraphs(json.summary, 4000) : null,
    decisions: lines(json.decisions, item => (isRecord(item) ? item.what : undefined)),
    keyPoints: lines(json.key_points),
    commitments,
    has: { participants: included.includes('participants'), commitments: included.includes('action_items') },
  }
}

/** A project's outline out of `open`'s answer, or undefined when the answer is not that project's outline. */
export function projectOf(json: Record<string, unknown>, id: string): Project | undefined {
  const subject = isRecord(json.subject) ? json.subject : {}
  const title = line(subject.name, MAX_TITLE)

  if (!isAsked(subject.id, id) || title === '' || !Array.isArray(json.children)) {
    return undefined
  }

  const counts = isRecord(json.counts) ? json.counts : {}
  const children = json.children
    .slice(0, 60)
    .filter(isRecord)
    .map(child => ({
      id: typeof child.id === 'string' ? child.id.toLowerCase() : '',
      name: line(child.name, 80),
      under: count(child.children) ?? 0,
      lastActivity: dayOf(child.last_activity),
    }))
    .filter(child => child.name !== '' && linkOf('project', child.id) !== undefined)

  return {
    kind: 'project',
    id,
    title,
    date: dayOf(counts.last_activity),
    // The path ends with the project's own name; what is drawn above the title is where it sits.
    path: lines(subject.path).map(name => drawn(name, 60)).slice(0, -1),
    scope: scopeOf(json.scope),
    isCut: json.truncated === true,
    definition: typeof json.definition === 'string' && json.definition.trim() !== '' ? paragraphs(json.definition, 1200) : null,
    meetings: count(counts.meetings),
    children,
    hasMore: typeof json.next_cursor === 'string' && json.next_cursor !== '',
  }
}

/** A person out of `open`'s answer, or undefined when it names nobody. */
export function personOf(json: Record<string, unknown>, id: string): Person | undefined {
  const title = line(json.full_name, MAX_TITLE)

  if (title === '') {
    return undefined
  }

  const interactions = (Array.isArray(json.interactions) ? json.interactions : [])
    .slice(0, 12)
    .filter(isRecord)
    .map(item => ({ date: dayOf(item.date), summary: line(item.summary) }))
    .filter(item => item.summary !== '')

  return {
    kind: 'person',
    id,
    title,
    date: null,
    path: pathOf(json.project),
    scope: scopeOf(json.scope),
    isCut: json.truncated === true,
    role: line(json.role, 80) || null,
    organization: line(json.organization, 80) || null,
    interactions,
  }
}

const FILED = /^Filed under: ([^\n]{1,400})\n+/
const HEADING = /^# ([^\n]{1,400})\n*/
const KIND_LINE = /\*\*Kind:\*\* ([a-z_]{1,40})\b/

/**
 * A note, a session or another document out of the text `open` answers
 * with, or undefined when the text has no title to show.
 *
 * `asked` is the kind the reference named. Without one the text says it:
 * a session's heading starts with "Session", a document names its kind.
 */
export function pageOf(text: string, id: string, asked: string | undefined): Page | undefined {
  const fenced = unfenced(text)
  const filed = FILED.exec(fenced.body)
  const afterFiled = filed === null ? fenced.body : fenced.body.slice(filed[0].length)
  const heading = HEADING.exec(afterFiled)
  const title = drawn(heading?.[1] ?? '', MAX_TITLE)

  if (title === '') {
    return undefined
  }

  const body = afterFiled.slice(heading?.[0].length ?? 0)
  const isSession = /^Session\b/.test(title)
  const said = KIND_LINE.exec(body.slice(0, 600))?.[1]
  // "Top > Child (project id: …) · about Org": the names before the bracket.
  const path = (filed?.[1] ?? '')
    .replace(/\s*\(project id:[^)]*\).*$/, '')
    .split(' > ')
    .map(name => drawn(name, 60))
    .filter(name => name !== '')

  return {
    // A session's heading is certain; otherwise the reference's word is taken before the text's.
    kind: isSession ? 'session' : (asked ?? said ?? 'document'),
    id,
    title,
    date: dayOf(/\*\*Date:\*\* (\d{4}-\d{2}-\d{2})/.exec(body.slice(0, 600))?.[1]),
    path,
    scope: scopeOf(fenced.scope),
    isCut: fenced.isCut,
    body,
  }
}

/** A record of a kind the pane has no view for: its kind and whatever it calls itself. */
export function otherOf(json: Record<string, unknown>, id: string): Other | undefined {
  const kind = typeof json.kind === 'string' && /^[a-z_]{1,40}$/.test(json.kind) ? json.kind : undefined
  const subject = isRecord(json.subject) ? json.subject : {}
  const title = line(json.title, MAX_TITLE) || line(json.what, MAX_TITLE) || line(subject.name, MAX_TITLE)

  if (kind === undefined || title === '') {
    return undefined
  }

  return { kind, id, title, date: dayOf(json.date), path: pathOf(json.project), scope: scopeOf(json.scope), isCut: false, isOther: true }
}
