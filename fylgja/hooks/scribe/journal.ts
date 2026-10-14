/**
 * The session log: what Scribe keeps on this machine of each conversation,
 * so that a plugin loaded afresh for it picks up where the one before left
 * off. Claude Code loads the plugin with nothing it held after
 * `/reload-plugins`, when it starts a plugin again whose copy it lost, on
 * `claude --resume` and `--continue`, and when a conversation moved to the
 * background goes on in a job that resumed it as a fork under an id of its
 * own.
 *
 * It lives in the plugin's own store (`$.store`, one JSON file of the
 * plugin's under Claude Code's configuration folder), which Claude Code
 * writes under a lock shared by its processes. The log of a conversation is
 * one entry per load of the plugin that wrote to it, `scribe.log.<its
 * id>.<the load's>`, so two processes never write the same entry: the
 * session the background job forked from and the job itself, or two
 * windows on one conversation. An entry is a list of lines, each one JSON
 * text: what changed since the line before, the first of them all of it.
 * The store can only replace an entry whole, so a line is appended by
 * writing the entry again; past `MAX_LINES` lines or `MAX_SEGMENT_CHARS`
 * characters the entry is written again as one line that holds it all. A
 * line that does not read, or a part of one, is passed over and the rest
 * stands: a store edited by hand, or by another version of the plugin,
 * costs what it spoiled and nothing else.
 *
 * Reading a log is folding its lines: each record, and each of the other
 * parts as a whole, is as the latest line that says anything of it has it,
 * a record taken back as late as or later than it was kept is gone. So
 * what two loads wrote side by side is one log again.
 *
 * Which conversation a load goes on from is found by its id, or, for a
 * conversation that has no log of its own, by marks of its rows that a fork
 * carries over: the id of its last tool call, and a hash of those rows
 * taken in order (`marksOf`, `nearest`). An index, `scribe.logs`, holds
 * each logged conversation's marks, when it was last written and its size,
 * so a load reads one entry to find the one it goes on from, and the
 * oldest are let go by it: past `MAX_AGE_MS`, past the newest `MAX_KEPT`,
 * or past `MAX_TOTAL_CHARS` in all. Two processes may write the index at
 * once and one of them lose its line: then it is written again at that
 * conversation's next write, and a log the index lost is found by its
 * entries' names.
 *
 * What a log holds: each record Scribe kept as the session holds it (its
 * sentence, reason, what was ruled out, its files, whether it is Scribe's
 * own to rewrite), the records taken out that can be put back, the
 * question waiting for an answer, what waits to be sent to Fylgja, how far
 * Scribe has read the conversation, the commits it saw and what the shell
 * staged for the next, and its counts. Never a word of a prompt, a reply,
 * a file or a plan: the prompts the session sent are kept as hashes keyed
 * with a salt of this machine's own (`keyedHashOf`), and found again among
 * the conversation's rows.
 *
 * Only the conversation a log is of takes up its question and its writes
 * that wait: a fork picks up the records and how far it was read, never
 * what its parent was still to ask or send. An entry another load wrote
 * within `LIVE_MS` may be one that still runs, and is never let go.
 */

import { isRecord } from '../payload'
import { SCHEMA } from '../telemetry-schema'
import type { Question } from './band'
import type { Row } from './delta'
import type { Away, Index, Whole } from './staged'
import type { Anchor, Commit, Deferred, Doubted, Draft, Fact, Place, ReasonStatus, RecordKind, Written } from './types'

/** Each load's log of a conversation is kept under this, the conversation's id, a dot and the load's own id. */
export const PREFIX = 'scribe.log.'

/** The index of the conversations logged: their marks, when each was last written, and its size. */
export const INDEX = 'scribe.logs'

/** What the plugin kept before the session log: let go wherever it is found. */
export const LEGACY_PREFIX = 'scribe.list.'
export const LEGACY_INDEX = 'scribe.lists'

/** No more conversations are logged than this; the one written longest ago goes first. */
export const MAX_KEPT = 25

/** A conversation not written for this long is let go. */
export const MAX_AGE_MS = 30 * 24 * 3_600_000

/** No more characters are logged in all than this; the conversations written longest ago go first. */
export const MAX_TOTAL_CHARS = 1_000_000

/** A load's entry holds no more lines than this before it is written again as one. */
export const MAX_LINES = 24

/** Nor more characters than this. */
export const MAX_SEGMENT_CHARS = 32_000

/** No more records taken back are remembered as taken back than this. */
export const MAX_TOMBS = 100

/** No more logged conversations the index lost are read on one load than this. */
export const MAX_ORPHANS = 8

/** `$.session.messages` answers the newest this many rows: a conversation that long may have older ones it leaves out. */
export const MAX_ROWS = 4096

/** No more marks of the rows a compaction left are kept than this: the newest. */
export const MAX_SEAM = 600

/**
 * An entry written this recently may be a load that is still running (a
 * second window on the conversation): another load never lets it go, and
 * neither does the pruning of old conversations.
 */
export const LIVE_MS = 6 * 3_600_000

/** No more hashes of the developer's prompts are kept than this: the newest. */
export const MAX_PROMPT_HASHES = 100

/** What tells the conversation's rows apart, as they stood when it was written. */
export type Marks = {
  /** The id of the last tool call; null when it had made none. */
  tie: string | null
  /** A hash of the first `count` rows, in order; null with none. */
  seed: string | null
  count: number
}

/** A record as the log keeps it: as the session holds it, whether it is Scribe's own, when it was last changed and when first kept. */
export type Logged = Written & { isMine?: true; at: number; since: number }

/** A record taken out of the session's list, and when. */
export type Tomb = { id: string; at: number }

/** The question on show and those waiting their turn, and what keeps the session's questions within their share. */
export type Asking = {
  pending: Question[]
  /** Records offered in the session; none is offered twice. */
  told: string[]
  /** Decisions asked about, by their sentence in lower case. */
  asked: string[]
  questions: number
  unanswered: number
  /** Recorded decisions whose code changed, waiting to be asked about. */
  doubted: Doubted[]
}

/** How far Scribe has read the conversation. */
export type Cursor = {
  /** How many rows a look has been through; -1 when not known. */
  consumed: number
  /** The mark of the last of them. */
  mark: string | null
  /** The marks of the rows the last compaction left, until a look has been through them. */
  seam: string[] | null
  hasPrompt: boolean
  hasActed: boolean
  compactions: number
  hasCompacted: boolean
  /** A hash of each prompt the developer sent, oldest first: what tells their rows from every other once they are read again. */
  prompts: string[]
}

/** What the session did to its repositories that a commit holds, and the commits it saw. */
export type Work = {
  /** The commits seen in the rows. */
  commits: string[]
  toAttach: Commit[]
  index: Index
  created: string[]
  edited: [string, string[]][]
  editedRepos: string[]
  changedPlaces: string[]
  commitsToPair: { repo: string; files: string[] }[]
  agentRepo: string | null
  /** The records a commit of the session was attached to. */
  own: string[]
  takesPaths: boolean
  takesBase: boolean
  filesIn: [string, number][]
}

/** What the session counts. */
export type Counts = {
  dropped: number
  lost: [string, number][]
  letGo: number
  unplaced: number
  wakes: number
  /** When each wake of the last hour began. */
  wakeTimes: number[]
  denied: [string, { content: string; date: string | null; since: number }][]
}

/** The parts of a log other than its records, each written and read as a whole. */
export type Groups = {
  recorded: { id: string | null; content: string }[]
  asked: string[]
  gone: Written[]
  band: Asking
  deferred: Deferred[]
  cursor: Cursor
  work: Work
  /** Where each file the session touched lies, by the path a tool line writes and by its full path: apart from the rest, as it changes on its own. */
  places: [string, Place][]
  counts: Counts
}

/** One line: what changed, as of `at`. */
export type Patch = { at: number; recs?: Logged[]; tombs?: Tomb[]; set?: Partial<Groups> }

/** One load's entry of a conversation's log. */
export type Segment = Marks & { conv: string; writer: string; at: number; lines: string[] }

/** One conversation as the index lists it. */
export type Entry = Marks & { conv: string; at: number; chars: number }

/** A log read: its records in the order they were first kept, those taken back, and the latest of each other part it holds. */
export type Folded = { records: Logged[]; tombs: Tomb[]; groups: Partial<Groups> }

/** What the session holds now, as it is logged. */
export type Now = { records: (Written & { isMine?: true })[]; groups: Groups }

/** What a load has written of its log: each record as text, when it last changed and when first kept; each part as text; what was taken back. */
export type Book = {
  recs: Map<string, { text: string; at: number; since: number }>
  groups: Map<string, string>
  tombs: Map<string, number>
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CONV = /^[A-Za-z0-9_-]{1,80}$/
const WRITER = /^[a-z0-9]{4,16}$/
const TIE = /^[A-Za-z0-9_-]{1,120}$/
const HASH = /^[0-9a-z]{1,16}$/
const SHA = /^[0-9a-f]{7,64}$/i
const KEY = /^scribe\.log\.([A-Za-z0-9_-]{1,80})\.([a-z0-9]{4,16})$/

const KINDS: readonly string[] = ['decision', 'gotcha', 'correction'] satisfies RecordKind[]
const OUTCOMES: readonly string[] = ['created', 'restored', 'reasoned', 'held', 'updated', 'withdrawn'] satisfies Written['outcome'][]
const STATUSES: readonly string[] = ['stated', 'not_stated', 'no_strong_reason'] satisfies ReasonStatus[]
const RULES: readonly string[] = SCHEMA.events.commit.rule.oneOf
const SAID: readonly string[] = ['given-up', 'unconfirmed', 'gone', 'unchecked']

/** The longest text of any one part that is read back; anything longer is no part of a record. */
const MAX_TEXT = 4000

/** No list of a line is read back longer than this: its newest. */
export const MAX_LIST = 200

/** The key the log of the conversation `conv` written by the load `writer` is kept under; undefined for ids that cannot be one. */
export function keyOf(conv: string, writer: string): string | undefined {
  return CONV.test(conv) && WRITER.test(writer) ? `${PREFIX}${conv}.${writer}` : undefined
}

/** The conversation and the load a key of the log names; undefined for any other key. */
export function partsOf(key: string): { conv: string; writer: string } | undefined {
  const found = KEY.exec(key)

  return found === null ? undefined : { conv: found[1] ?? '', writer: found[2] ?? '' }
}

/** Whether a key is one the plugin kept before the session log. */
export function isLegacy(key: string): boolean {
  return key === LEGACY_INDEX || key.startsWith(LEGACY_PREFIX)
}

/** A new load's own id: random, so two loads never share one. */
export function writerId(): string {
  return `${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`
}

/** A short hash of `text` (53 bits, in base 36): what tells texts apart, and holds none of their words. */
export function hashOf(text: string, seed = 0): string {
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

/**
 * A hash of `text` keyed with this machine's own salt (`saltOf`): one that
 * cannot be looked up in a list made ahead of time. Whoever can read the
 * store can read the salt as well, and still test a guess against it.
 */
export function keyedHashOf(salt: string, text: string): string {
  return hashOf(`${salt}\u0000${text}`)
}

/** A new salt for this machine: random, made once and kept in the store. */
export function newSalt(): string {
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

/** A salt as the store holds it; undefined for anything else. */
export function saltOf(value: unknown): string | undefined {
  return typeof value === 'string' && /^[0-9a-z]{12,64}$/.test(value) ? value : undefined
}

/** The hash of each prefix of the rows, keyed with the salt: the first `n` rows hash to the `n - 1`th. */
function prefixesOf(rows: readonly Row[], salt: string): string[] {
  const hashes: string[] = []
  let last = salt

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
export function marksOf(rows: readonly Row[], salt: string): Marks {
  const seed = isWhole(rows) ? (prefixesOf(rows, salt).at(-1) ?? null) : null

  return { tie: tiesOf(rows).at(-1) ?? null, seed, count: seed === null ? 0 : rows.length }
}

/**
 * The logged conversation that the conversation whose rows are `rows` goes
 * on from: of those its rows go on from, the one that shares the longest
 * run of rows with them. A fork of a fork shares more with the nearest,
 * which already holds what the older ones kept, and a sibling forked from
 * the same one shares no rows of the other past their common start. The id
 * of the last tool call is used only where the rows cannot be compared: an
 * entry with no hash, or rows read from a history longer than the rows
 * answered.
 */
export function nearest(entries: readonly Entry[], rows: readonly Row[], salt: string): Entry | undefined {
  const prefixes = isWhole(rows) ? prefixesOf(rows, salt) : []
  const ties = new Set(tiesOf(rows))
  const byRows = entries.filter(one => one.seed !== null && one.count <= prefixes.length && prefixes[one.count - 1] === one.seed)

  if (byRows.length > 0) {
    return byRows.reduce((best, one) => (one.count > best.count || (one.count === best.count && one.at > best.at) ? one : best))
  }

  const byTie = entries.filter(one => (one.seed === null || prefixes.length === 0) && one.tie !== null && ties.has(one.tie))

  return byTie.reduce<Entry | undefined>((best, one) => (best === undefined || one.at > best.at ? one : best), undefined)
}

// Reading back. Every part is checked for its shape and its bounds, and one
// that does not read is passed over: what is left of a line still stands.

function text(value: unknown, max = MAX_TEXT): string | undefined {
  return typeof value === 'string' && value.length <= max ? value : undefined
}

function texts(value: unknown, max = MAX_TEXT): string[] {
  return (Array.isArray(value) ? value : []).flatMap(one => text(one, max) ?? []).slice(-MAX_LIST)
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

function time(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function textOrNull(value: unknown): string | null | undefined {
  return value === null ? null : text(value)
}

function statusOf(value: unknown): ReasonStatus | null | undefined {
  return value === null ? null : typeof value === 'string' && STATUSES.includes(value) ? (value as ReasonStatus) : undefined
}

function anchorsOf(value: unknown): Anchor[] {
  return (Array.isArray(value) ? value : [])
    .flatMap(one => {
      const path = isRecord(one) ? text(one.path, 1000) : undefined
      const symbol = isRecord(one) ? text(one.symbol, 400) : undefined

      return path === undefined ? [] : [symbol === undefined ? { path } : { path, symbol }]
    })
    .slice(0, MAX_LIST)
}

function kindOf(value: unknown): RecordKind | undefined {
  return typeof value === 'string' && KINDS.includes(value) ? (value as RecordKind) : undefined
}

/** A record the session kept, or undefined when it does not read as one. */
export function writtenOf(value: unknown): Written | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const id = typeof value.id === 'string' && ID.test(value.id) ? value.id : undefined
  const kind = kindOf(value.kind)
  const content = text(value.content)
  const reasonStatus = statusOf(value.reasonStatus)
  const outcome = typeof value.outcome === 'string' && OUTCOMES.includes(value.outcome) ? (value.outcome as Written['outcome']) : undefined
  const replaced = textOrNull(value.replaced)

  if (id === undefined || kind === undefined || content === undefined || reasonStatus === undefined || outcome === undefined || replaced === undefined) {
    return undefined
  }

  const repo = textOrNull(value.repo)
  const detail = text(value.detail)
  const against = typeof value.against === 'string' && ID.test(value.against) ? value.against : undefined

  return {
    id,
    kind,
    content,
    reasonStatus,
    outcome,
    replaced,
    ...(repo === undefined ? {} : { repo }),
    ...(Array.isArray(value.anchors) ? { anchors: anchorsOf(value.anchors) } : {}),
    ...(detail === undefined ? {} : { detail }),
    ...(Array.isArray(value.alternatives) ? { alternatives: texts(value.alternatives) } : {}),
    ...(Array.isArray(value.triggers) ? { triggers: texts(value.triggers) } : {}),
    ...(against === undefined ? {} : { against }),
  }
}

function loggedOf(value: unknown): Logged | undefined {
  const written = writtenOf(value)
  const at = isRecord(value) ? time(value.at) : undefined
  const since = isRecord(value) ? time(value.since) : undefined

  if (written === undefined || at === undefined || since === undefined || !isRecord(value)) {
    return undefined
  }

  return { ...written, ...(value.isMine === true ? { isMine: true as const } : {}), at, since }
}

/** A record a model proposed, as a question or a write that waits holds it. */
function draftOf(value: unknown): Draft | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const kind = kindOf(value.kind)
  const content = text(value.content)
  const detail = text(value.detail)
  const reasonStatus = statusOf(value.reasonStatus)
  const supersedes = textOrNull(value.supersedes)
  const repo = textOrNull(value.repo)
  const updates = textOrNull(value.updates)

  if (
    kind === undefined ||
    content === undefined ||
    detail === undefined ||
    reasonStatus === undefined ||
    supersedes === undefined ||
    repo === undefined ||
    updates === undefined
  ) {
    return undefined
  }

  return {
    kind,
    content,
    detail,
    alternatives: texts(value.alternatives),
    anchors: anchorsOf(value.anchors),
    triggers: texts(value.triggers),
    reasonStatus,
    supersedes,
    repo,
    updates,
    ...(value.fromChoice === true ? { fromChoice: true } : {}),
  }
}

/** A record as Fylgja returned it, as a question holds it. */
function factOf(value: unknown): Fact | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const id = text(value.id, 120)
  const kind = text(value.kind, 40)
  const content = text(value.content)
  const detail = text(value.detail)
  const reasonStatus = statusOf(value.reasonStatus)
  const date = textOrNull(value.date)
  const origin = text(value.origin, 40)
  const link = textOrNull(value.link)
  const changed = value.changed === null ? null : Array.isArray(value.changed) ? texts(value.changed, 1000) : undefined

  if (
    id === undefined ||
    kind === undefined ||
    content === undefined ||
    detail === undefined ||
    reasonStatus === undefined ||
    date === undefined ||
    origin === undefined ||
    link === undefined ||
    changed === undefined
  ) {
    return undefined
  }

  return {
    id,
    kind,
    content,
    detail,
    alternatives: texts(value.alternatives),
    anchors: anchorsOf(value.anchors),
    addedByOthers: texts(value.addedByOthers, 1000),
    reasonStatus,
    date,
    origin,
    link,
    changed,
  }
}

/** A question waiting for the developer, as it comes up again: untouched. */
function questionOf(value: unknown): Question | undefined {
  if (!isRecord(value) || value.kind !== 'question') {
    return undefined
  }

  const options = texts(value.options, 1000).slice(0, 3)

  if (value.form === 'reason') {
    const id = typeof value.id === 'string' && ID.test(value.id) ? value.id : undefined
    const content = text(value.content)

    return id === undefined || content === undefined ? undefined : { kind: 'question', form: 'reason', id, content, options, isTouched: false }
  }

  if (value.form === 'reversal') {
    const draft = draftOf(value.draft)
    const prior = factOf(value.prior)

    return draft === undefined || prior === undefined ? undefined : { kind: 'question', form: 'reversal', draft, prior, options, isTouched: false }
  }

  if (value.form === 'holds') {
    const fact = factOf(value.fact)
    const repo = text(value.repo, 400)

    // A card that had already said what came of its answer is put away by any key: there is nothing to bring back.
    return fact === undefined || repo === undefined || (typeof value.said === 'string' && SAID.includes(value.said))
      ? undefined
      : { kind: 'question', form: 'holds', fact, repo, isTouched: false }
  }

  return undefined
}

function doubtedOf(value: unknown): Doubted | undefined {
  const fact = isRecord(value) ? factOf(value.fact) : undefined
  const repo = isRecord(value) ? text(value.repo, 400) : undefined

  return fact === undefined || repo === undefined || !isRecord(value) ? undefined : { fact, repo, asks: value.asks === true }
}

/** A write that waits for the next turn. Only the two kinds Scribe ever puts off: a record to write, and a change to one of its own. */
function deferredOf(value: unknown): Deferred | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  if ('draft' in value) {
    const draft = draftOf(value.draft)
    const against = typeof value.against === 'string' && ID.test(value.against) ? value.against : undefined

    return draft === undefined ? undefined : against === undefined ? { draft } : { draft, against }
  }

  return value.tool === 'amend_memory' && isRecord(value.args) && typeof value.args.atom_id === 'string'
    ? { tool: 'amend_memory', args: value.args }
    : undefined
}

function commitOf(value: unknown): Commit | undefined {
  if (!isRecord(value) || typeof value.sha !== 'string' || !SHA.test(value.sha)) {
    return undefined
  }

  return typeof value.rule === 'string' && RULES.includes(value.rule)
    ? { sha: value.sha, paths: texts(value.paths, 1000), rule: value.rule as Commit['rule'] }
    : undefined
}

function awayOf(value: unknown): Away | undefined {
  return value === false || value === 'inside' || value === 'outside' ? value : undefined
}

function wholeOf(value: unknown): Whole | undefined {
  return value === false || value === 'tracked' || value === 'all' ? value : undefined
}

function stagedOf(value: unknown): Index | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const whole = wholeOf(value.whole)
  const isAway = awayOf(value.isAway)

  return whole === undefined || isAway === undefined
    ? undefined
    : { named: value.named === null ? null : texts(value.named, 1000), hasStaged: value.hasStaged === true, whole, isAway }
}

function placeOf(value: unknown): Place | undefined {
  const repo = isRecord(value) ? text(value.repo, 400) : undefined
  const path = isRecord(value) ? text(value.path, 1000) : undefined

  return repo === undefined || path === undefined ? undefined : { repo, path }
}

/** `[key, value]` pairs, each key text and each value read by `read`. */
function pairsOf<T>(value: unknown, read: (one: unknown) => T | undefined, max = MAX_LIST * 4): [string, T][] {
  return (Array.isArray(value) ? value : [])
    .flatMap((pair): [string, T][] => {
      const key = Array.isArray(pair) ? text(pair[0], 1000) : undefined
      const one = Array.isArray(pair) ? read(pair[1]) : undefined

      return key === undefined || one === undefined ? [] : [[key, one]]
    })
    .slice(-max)
}

function each<T>(value: unknown, read: (one: unknown) => T | undefined, max = MAX_LIST): T[] {
  return (Array.isArray(value) ? value : []).flatMap(one => read(one) ?? []).slice(-max)
}

/** Each part of a line by its own reading: one that does not read is left out, and its earlier word on it stands. */
const GROUPS: { [K in keyof Groups]: (value: unknown) => Groups[K] | undefined } = {
  recorded: value =>
    Array.isArray(value)
      ? each(value, one => {
          const content = isRecord(one) ? text(one.content) : undefined
          const id = isRecord(one) && typeof one.id === 'string' && ID.test(one.id) ? one.id : null

          return content === undefined ? undefined : { id, content }
        })
      : undefined,
  asked: value => (Array.isArray(value) ? texts(value) : undefined),
  gone: value => (Array.isArray(value) ? each(value, writtenOf) : undefined),
  band: value =>
    isRecord(value)
      ? {
          pending: each(value.pending, questionOf, 8),
          told: texts(value.told, 120),
          asked: texts(value.asked),
          questions: count(value.questions),
          unanswered: count(value.unanswered),
          doubted: each(value.doubted, doubtedOf, 8),
        }
      : undefined,
  deferred: value => (Array.isArray(value) ? each(value, deferredOf, 20) : undefined),
  cursor: value =>
    isRecord(value) && typeof value.consumed === 'number' && Number.isInteger(value.consumed) && value.consumed >= -1
      ? {
          consumed: value.consumed,
          mark: typeof value.mark === 'string' && HASH.test(value.mark) ? value.mark : null,
          seam: Array.isArray(value.seam) ? value.seam.filter((one): one is string => typeof one === 'string' && HASH.test(one)).slice(-MAX_SEAM) : null,
          hasPrompt: value.hasPrompt === true,
          hasActed: value.hasActed === true,
          compactions: count(value.compactions),
          hasCompacted: value.hasCompacted === true,
          prompts: (Array.isArray(value.prompts) ? value.prompts : []).filter((one): one is string => typeof one === 'string' && HASH.test(one)).slice(-MAX_PROMPT_HASHES),
        }
      : undefined,
  work: value =>
    isRecord(value)
      ? {
          commits: texts(value.commits, 64).filter(sha => SHA.test(sha)),
          toAttach: each(value.toAttach, commitOf, 10),
          index: stagedOf(value.index) ?? { named: [], hasStaged: false, whole: false, isAway: false },
          created: texts(value.created, 1000),
          edited: pairsOf(value.edited, one => (Array.isArray(one) ? texts(one, 1000) : undefined)),
          editedRepos: texts(value.editedRepos, 400),
          changedPlaces: texts(value.changedPlaces, 1400),
          commitsToPair: each(value.commitsToPair, one =>
            isRecord(one) && typeof one.repo === 'string' ? { repo: one.repo, files: texts(one.files, 1000) } : undefined,
          ),
          agentRepo: typeof value.agentRepo === 'string' ? value.agentRepo : null,
          own: texts(value.own, 120),
          takesPaths: value.takesPaths !== false,
          takesBase: value.takesBase !== false,
          filesIn: pairsOf(value.filesIn, one => (typeof one === 'number' && Number.isInteger(one) && one > 0 ? one : undefined)),
        }
      : undefined,
  places: value => (Array.isArray(value) ? pairsOf(value, placeOf) : undefined),
  counts: value =>
    isRecord(value)
      ? {
          dropped: count(value.dropped),
          lost: pairsOf(value.lost, one => (count(one) > 0 ? count(one) : undefined)),
          letGo: count(value.letGo),
          unplaced: count(value.unplaced),
          wakes: count(value.wakes),
          wakeTimes: (Array.isArray(value.wakeTimes) ? value.wakeTimes : []).flatMap(one => time(one) ?? []).slice(-60),
          denied: pairsOf(value.denied, one => {
            const content = isRecord(one) ? text(one.content) : undefined
            const date = isRecord(one) ? textOrNull(one.date) : undefined

            return content === undefined || date === undefined || !isRecord(one) ? undefined : { content, date, since: count(one.since) }
          }),
        }
      : undefined,
}

/** One line as it reads; undefined for a line that does not. */
export function patchOf(line: unknown): Patch | undefined {
  let value: unknown

  try {
    value = typeof line === 'string' ? JSON.parse(line) : undefined
  } catch {
    return undefined
  }

  const at = isRecord(value) ? time(value.at) : undefined

  if (!isRecord(value) || at === undefined) {
    return undefined
  }

  const set: Partial<Groups> = {}

  if (isRecord(value.set)) {
    for (const name of Object.keys(GROUPS) as (keyof Groups)[]) {
      const one = Object.hasOwn(value.set, name) ? GROUPS[name](value.set[name]) : undefined

      if (one !== undefined) {
        ;(set as Record<string, unknown>)[name] = one
      }
    }
  }

  const tombs = each(value.tombs, one => {
    const id = isRecord(one) && typeof one.id === 'string' && ID.test(one.id) ? one.id : undefined
    const when = isRecord(one) ? time(one.at) : undefined

    return id === undefined || when === undefined ? undefined : { id, at: when }
  }, MAX_TOMBS * 2)

  return { at, recs: each(value.recs, loggedOf, MAX_LIST), tombs, set }
}

/** One load's entry as the store holds it; undefined when it does not read as one. */
export function segmentOf(value: unknown): Segment | undefined {
  if (!isRecord(value) || typeof value.conv !== 'string' || !CONV.test(value.conv) || typeof value.writer !== 'string' || !WRITER.test(value.writer)) {
    return undefined
  }

  return {
    conv: value.conv,
    writer: value.writer,
    at: time(value.at) ?? 0,
    ...marksIn(value),
    lines: (Array.isArray(value.lines) ? value.lines : []).filter((line): line is string => typeof line === 'string'),
  }
}

function marksIn(value: Record<string, unknown>): Marks {
  const count = typeof value.count === 'number' && Number.isInteger(value.count) && value.count > 0 ? value.count : 0
  const seed = typeof value.seed === 'string' && HASH.test(value.seed) && count > 0 ? value.seed : null

  return { tie: typeof value.tie === 'string' && TIE.test(value.tie) ? value.tie : null, seed, count: seed === null ? 0 : count }
}

/** The index as the store holds it: one entry a conversation, the latest where it names one twice. Anything else reads as none. */
export function entriesOf(value: unknown): Entry[] {
  const all = (Array.isArray(value) ? value : []).flatMap(one =>
    isRecord(one) && typeof one.conv === 'string' && CONV.test(one.conv)
      ? [{ conv: one.conv, at: time(one.at) ?? 0, chars: count(one.chars), ...marksIn(one) }]
      : [],
  )

  return [...new Map(all.map(one => [one.conv, one])).values()]
}

/** The index entry for what `segment` says of its conversation. */
export function entryOf(segment: Segment, chars: number): Entry {
  return { conv: segment.conv, at: segment.at, chars, tie: segment.tie, seed: segment.seed, count: segment.count }
}

/**
 * Reads a log from the entries its loads wrote. Each line is taken in the
 * order of its time; a record is as the latest line that kept it has it,
 * and gone where it was taken back as late or later; every other part is
 * as the latest line that says anything of it has it.
 */
export function fold(segments: readonly Segment[]): Folded {
  const lines = segments
    .flatMap(segment => segment.lines.flatMap(line => patchOf(line) ?? []))
    .map((patch, place) => ({ patch, place }))
    .sort((one, two) => one.patch.at - two.patch.at || one.place - two.place)
  const recs = new Map<string, Logged>()
  const first = new Map<string, number>()
  const tombs = new Map<string, number>()
  const groups: Partial<Groups> = {}

  for (const { patch } of lines) {
    for (const rec of patch.recs ?? []) {
      const had = recs.get(rec.id)

      if (!first.has(rec.id)) {
        first.set(rec.id, first.size)
      }

      if (had === undefined || rec.at >= had.at) {
        recs.set(rec.id, rec)
      }
    }

    for (const tomb of patch.tombs ?? []) {
      tombs.set(tomb.id, Math.max(tombs.get(tomb.id) ?? -Infinity, tomb.at))
    }

    Object.assign(groups, patch.set)
  }

  const records = [...recs.values()]
    .filter(rec => rec.at > (tombs.get(rec.id) ?? -Infinity))
    .sort((one, two) => one.since - two.since || (first.get(one.id) ?? 0) - (first.get(two.id) ?? 0))

  return {
    records,
    tombs: [...tombs].map(([id, at]) => ({ id, at })).slice(-MAX_TOMBS),
    groups,
  }
}

/**
 * A record as it is written to the log: its parts in one order, whatever
 * order the session put them in, so the same record is the same text.
 * Undefined for one that would not read back.
 */
function canonicalOf(record: Written & { isMine?: true }): (Written & { isMine?: true }) | undefined {
  const written = writtenOf(record)

  return written === undefined ? undefined : record.isMine === true ? { ...written, isMine: true } : written
}

/** A book that has written nothing yet. */
export function emptyBook(): Book {
  return { recs: new Map(), groups: new Map(), tombs: new Map() }
}

/** The book a load starts from that picked up `folded`: its records keep the times they had, so a line written beside them by another load is weighed fairly. */
export function bookOf(folded: Folded): Book {
  const book = emptyBook()

  for (const { at, since, ...rest } of folded.records) {
    const one = canonicalOf(rest)

    if (one !== undefined) {
      book.recs.set(rest.id, { text: JSON.stringify(one), at, since })
    }
  }

  for (const tomb of folded.tombs) {
    book.tombs.set(tomb.id, tomb.at)
  }

  return book
}

/**
 * The line that brings what the book says up to `now`, as of `at`, and the
 * book after it; no line when nothing changed. A whole line holds
 * everything, whether or not it changed: it starts a load's entry, and
 * takes the place of its lines when they are too many.
 */
export function next(book: Book, now: Now, at: number, isWhole: boolean): { patch: Patch | undefined; book: Book } {
  const after = emptyBook()
  const recs: Logged[] = []
  const tombs: Tomb[] = []
  const set: Partial<Groups> = {}
  const records = now.records.flatMap(one => canonicalOf(one) ?? [])
  const standing = new Set(records.map(one => one.id))

  for (const record of records) {
    const textNow = JSON.stringify(record)
    const had = book.recs.get(record.id)
    const isChanged = had === undefined || had.text !== textNow
    const one = { text: textNow, at: isChanged ? at : had.at, since: had?.since ?? at }

    after.recs.set(record.id, one)

    if (isChanged || isWhole) {
      recs.push({ ...record, at: one.at, since: one.since })
    }
  }

  for (const [id, when] of book.tombs) {
    if (!standing.has(id)) {
      after.tombs.set(id, when)
    }
  }

  for (const id of book.recs.keys()) {
    if (!standing.has(id)) {
      after.tombs.set(id, at)
      tombs.push({ id, at })
    }
  }

  // The oldest of those taken back are forgotten first.
  for (const id of [...after.tombs.keys()].slice(0, -MAX_TOMBS)) {
    after.tombs.delete(id)
  }

  for (const name of Object.keys(now.groups) as (keyof Groups)[]) {
    const textNow = JSON.stringify(now.groups[name])

    after.groups.set(name, textNow)

    if (isWhole || book.groups.get(name) !== textNow) {
      ;(set as Record<string, unknown>)[name] = now.groups[name]
    }
  }

  const wholeTombs = isWhole ? [...after.tombs].map(([id, when]) => ({ id, at: when })) : tombs
  const isEmpty = recs.length === 0 && wholeTombs.length === 0 && Object.keys(set).length === 0

  return {
    patch: isEmpty
      ? undefined
      : {
          at,
          ...(recs.length === 0 ? {} : { recs }),
          ...(wholeTombs.length === 0 ? {} : { tombs: wholeTombs }),
          ...(Object.keys(set).length === 0 ? {} : { set }),
        },
    book: after,
  }
}

/**
 * The index after the oldest conversations are let go: those not written
 * for `MAX_AGE_MS`, those past the newest `MAX_KEPT`, and those past
 * `MAX_TOTAL_CHARS` in all, newest first. The conversations in `keep`, and any
 * written within `LIVE_MS`, always stay.
 */
export function retained(entries: readonly Entry[], now: number, keep: ReadonlySet<string>): { kept: Entry[]; dropped: string[] } {
  const kept: Entry[] = []
  const dropped: string[] = []
  let chars = 0

  for (const one of [...entries].sort((a, b) => b.at - a.at)) {
    const isOver = now - one.at > MAX_AGE_MS || kept.length >= MAX_KEPT || chars + one.chars > MAX_TOTAL_CHARS
    // Written lately: a session may still be writing it.
    const isLive = now - one.at < LIVE_MS

    if (isOver && !keep.has(one.conv) && !isLive) {
      dropped.push(one.conv)
    } else {
      kept.push(one)
      chars += one.chars
    }
  }

  return { kept: kept.toReversed(), dropped }
}
