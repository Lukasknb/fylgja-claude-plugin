/**
 * What this plugin reads from Fylgja for one question: one search, then the
 * top few hits opened with the cheapest read that gives content. Bounded in
 * the number of records and in the characters kept of each and of all.
 */

import type { Host } from './host'
import { isRecord, payloadOf } from './payload'
import { drawn, lines } from './plain'

/** A record the search named. Every field is checked; the title is held as it is drawn. */
export type Hit = {
  id: string
  /** A plain lower-case word; `record` for a kind that is not one. */
  kind: string
  title: string
  date: string | null
  /** The address that opens the record in the Fylgja app, when the server gave one that is Fylgja's. */
  link: string | null
  /** The read that opens it: the two tools a search hit can name. */
  tool: 'get_meeting' | 'open'
  /** The id that read takes. */
  ref: string
  /** The search's own excerpt, shown to nobody; the fallback text when the read fails. */
  preview: string
}

/** A hit whose content was read, or whose excerpt stands in for it. */
export type Source = Hit & {
  /** What the model is given of this record. */
  text: string
  /** False when the read failed and `text` is only the search's excerpt. */
  isRead: boolean
  /** True when the server or this plugin cut the record's text. */
  isCut: boolean
}

export type Bounds = {
  /** How many hits one search asks for. */
  hits: number
  /** How many of them are opened. */
  reads: number
  /** The characters kept of one record. */
  perRecord: number
  /** The characters kept of all records together. */
  total: number
}

export const NARROW: Bounds = {
  hits: 8,
  reads: 4,
  perRecord: 3000,
  total: 9000,
}

/** What a person gets by asking to widen: more hits listed, more of them read. */
export const WIDE: Bounds = {
  hits: 20,
  reads: 8,
  perRecord: 2500,
  total: 16_000,
}

export type Searched =
  | { state: 'hits'; server: string; hits: Hit[] }
  | { state: 'signed-out' }
  | { state: 'offline' }
  | { state: 'rate-limited'; seconds: number | null }
  | { state: 'failed' }
  | { state: 'unexpected' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAX_TITLE = 80
const MAX_PREVIEW = 400

function uuidOf(value: unknown): string | undefined {
  const id = typeof value === 'string' ? value.toLowerCase() : ''

  return UUID.test(id) ? id : undefined
}

/**
 * `value` when it is an address of a record in the Fylgja app and names one
 * of `ids`; otherwise null. A link is drawn only for exactly this: https,
 * Fylgja's own host, no user, no port, the path `/open/<kind>/<id>`.
 */
export function linkOf(value: unknown, ids: readonly string[]): string | null {
  if (typeof value !== 'string' || value.length > 200 || !URL.canParse(value)) {
    return null
  }

  const url = new URL(value)
  const path = /^\/open\/[a-z_]{1,40}\/([0-9a-f-]{36})$/.exec(url.pathname)
  const isFylgja =
    url.protocol === 'https:' &&
    url.hostname === 'fylgja.lknblab.dev' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === ''

  return isFylgja && path?.[1] !== undefined && ids.includes(path[1]) ? url.href : null
}

function hitOf(value: unknown): Hit | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const id = uuidOf(value.id)

  if (id === undefined) {
    return undefined
  }

  const resource = isRecord(value.resource) ? value.resource : {}
  const kind = typeof value.type === 'string' && /^[a-z_]{1,40}$/.test(value.type) ? value.type : 'record'
  const ref = uuidOf(resource.id) ?? id
  const title = typeof value.title === 'string' ? drawn(value.title, MAX_TITLE) : ''
  const names = resource.tool === 'get_meeting' || (resource.tool === undefined && kind === 'meeting')

  return {
    id,
    kind,
    title: title === '' ? '(untitled)' : title,
    date: typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date) ? value.date : null,
    link: linkOf(value.link, [id, ref]),
    tool: names ? 'get_meeting' : 'open',
    ref,
    preview: typeof value.content_preview === 'string' ? value.content_preview.slice(0, MAX_PREVIEW) : '',
  }
}

function textOf(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return ''
  }

  return result.content
    .map(block => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('')
}

/** The seconds a rate-limit refusal asks to wait; null when it names none; undefined when `text` is no such refusal. */
function waitOf(text: string): number | null | undefined {
  const seconds = /\bwait (\d{1,4}) seconds?\b/i.exec(text)?.[1]

  if (seconds !== undefined) {
    return Number(seconds)
  }

  return /rate.?limit|too many (?:requests|calls)/i.test(text) ? null : undefined
}

/**
 * Asks Fylgja once for the records that match `query`.
 *
 * Exactly one `search` call is made, whatever it answers: the server bills
 * every search and limits them. A failure is told apart only as far as a
 * person can act on it: sign in, wait, or neither.
 */
export async function search(host: Host, query: string, bounds: Bounds): Promise<Searched> {
  const connection = await host.connect().catch(() => undefined)

  if (connection === undefined || !connection.isConnected) {
    return { state: connection?.reason === 'auth' ? 'signed-out' : 'offline' }
  }

  let result: unknown
  let refusal = ''

  try {
    result = await host.call(connection.server, 'search', {
      query,
      limit: bounds.hits,
    })
    refusal = isRecord(result) && result.isError === true ? textOf(result) : ''
  } catch (error) {
    // Only the wait is read from the refusal; its text is kept nowhere.
    refusal = error instanceof Error ? error.message : ' '
  }

  if (refusal !== '') {
    const wait = waitOf(refusal)

    if (wait !== undefined) {
      return { state: 'rate-limited', seconds: wait }
    }

    // A sign-in can lapse mid-session; asking again says so.
    const again = await host.connect().catch(() => undefined)

    return {
      state: again !== undefined && !again.isConnected && again.reason === 'auth' ? 'signed-out' : 'failed',
    }
  }

  const payload = payloadOf(result)

  if (payload === undefined || !Array.isArray(payload.results)) {
    return { state: 'unexpected' }
  }

  const hits = new Map<string, Hit>()

  for (const one of payload.results.slice(0, bounds.hits)) {
    const hit = hitOf(one)

    if (hit !== undefined && !hits.has(hit.id)) {
      hits.set(hit.id, hit)
    }
  }

  return { state: 'hits', server: connection.server, hits: [...hits.values()] }
}

const ENVELOPE = new Set(['author', 'scope', 'content_note', 'link', 'truncated', 'included'])

function listOf(value: unknown, pick: (item: unknown) => unknown): string[] {
  return Array.isArray(value)
    ? value.map(pick).filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : []
}

/** A meeting's summary, decisions and key points as plain lines. */
function meetingText(payload: Record<string, unknown>): string {
  const decisions = listOf(payload.decisions, item => (isRecord(item) ? item.what : undefined))
  const points = listOf(payload.key_points, item => item)

  return [
    typeof payload.summary === 'string' ? `Summary: ${payload.summary}` : '',
    decisions.length > 0 ? `Decisions:\n${decisions.map(what => `- ${what}`).join('\n')}` : '',
    points.length > 0 ? `Key points:\n${points.map(point => `- ${point}`).join('\n')}` : '',
  ]
    .filter(part => part !== '')
    .join('\n')
}

/** A record that arrived as text between Fylgja's fence lines: the text between them. */
function fencedText(text: string): string {
  return text
    .split('\n')
    .filter(line => !/^<<<(?:end )?fylgja-record\b/.test(line.trim()))
    .join('\n')
    .trim()
}

/**
 * The content of one read and whether the server cut it, or undefined when
 * the read failed or carried nothing to read.
 */
function contentOf(result: unknown): { text: string; isCut: boolean } | undefined {
  if (!isRecord(result) || result.isError === true) {
    return undefined
  }

  const payload = payloadOf(result)

  if (payload === undefined) {
    const text = fencedText(textOf(result))

    return text === '' ? undefined : { text, isCut: text.includes('[truncated:') }
  }

  const isMeeting = 'summary' in payload || 'key_points' in payload || 'decisions' in payload
  const rest = Object.fromEntries(Object.entries(payload).filter(([key]) => !ENVELOPE.has(key)))
  const text = isMeeting ? meetingText(payload) : JSON.stringify(rest)

  return text === '' || text === '{}' ? undefined : { text, isCut: payload.truncated === true }
}

async function open(host: Host, server: string, hit: Hit): Promise<unknown> {
  const args =
    hit.tool === 'get_meeting'
      ? { meeting_id: hit.ref, include: ['summary', 'decisions', 'key_points'] }
      : { ref: hit.ref }

  return host.call(server, hit.tool, args).catch(() => undefined)
}

export type Read = {
  /** The records the model is given, in the order they are numbered from 1. */
  sources: Source[]
  /** Hits that were found and not read. */
  others: Hit[]
  /** Whether any record's text was cut, by the server or by this plugin's bounds. */
  isCut: boolean
}

/**
 * Opens the first `bounds.reads` of `hits`, one read each, and keeps of each
 * what the bounds allow.
 *
 * `carried` are records an earlier answer in the same thread rested on: they
 * come first, are not read again, and count towards the same bounds. A hit
 * whose read fails stays a source with the search's excerpt as its text; one
 * with nothing at all is listed as found and not read.
 */
export async function read(
  host: Host,
  server: string,
  hits: readonly Hit[],
  carried: readonly Source[],
  bounds: Bounds,
): Promise<Read> {
  const held = new Set(carried.map(source => source.id))
  const fresh = hits.filter(hit => !held.has(hit.id))
  const wanted = fresh.slice(0, Math.max(0, bounds.reads - carried.length))
  const results = await Promise.all(wanted.map(hit => open(host, server, hit)))

  const sources: Source[] = []
  const others: Hit[] = []
  let room = bounds.total
  let isCut = false

  const keep = (hit: Hit, raw: string, isRead: boolean, wasCut: boolean): void => {
    const whole = lines(raw).join('\n').trim()
    const text = whole.slice(0, Math.min(bounds.perRecord, room))
    const isShort = text.length < whole.length

    if (text === '') {
      others.push(hit)
      isCut ||= whole !== ''

      return
    }

    room -= text.length
    isCut ||= isShort || wasCut
    sources.push({ ...hit, text, isRead, isCut: isShort || wasCut })
  }

  for (const source of carried) {
    keep(source, source.text, source.isRead, source.isCut)
  }

  wanted.forEach((hit, at) => {
    const content = contentOf(results[at])

    keep(hit, content?.text ?? hit.preview, content !== undefined, content?.isCut ?? false)
  })

  others.push(...fresh.slice(wanted.length))

  return { sources, others, isCut }
}
