/**
 * What the plugin reports about its own working, so that a fault on
 * somebody's machine can be found without anything of that machine leaving
 * it: a look that ended without a verdict, a write Fylgja refused, a window
 * that did not open.
 *
 * An event is a name from a fixed list and, under keys from a fixed list,
 * whole numbers, flags and words from fixed lists (`telemetry-schema.ts`).
 * It has no key that takes text, so no path, file or repository name,
 * branch, sha, record id, error message, prompt or word of a record can be
 * put in one: such an event does not compile, and a value that is not of
 * its key's kind is left out here before anything is sent. Fylgja's server
 * holds the same list and takes nothing outside it.
 *
 * Events wait in memory, no more than a fixed number of them, and are sent
 * to Fylgja a batch at a time as a prompt is submitted, through the
 * session's own connection: never as a turn ends, since a call made after
 * Claude is done reads to a program that watches the session as Claude
 * working again. What waits when the session ends is put away on this
 * machine as one batch, under a key of its own and with nothing in it but
 * the events, and the first prompt of a later session sends it beside its
 * own; nothing else is written to this machine. Nothing is sent while
 * Fylgja is signed out, or with the plugin's option for it off. A batch is
 * sent once: one that did not arrive is let go, never sent again. A server
 * that does not know the tool is asked once and not again in the session,
 * and so is one whose answers keep failing. None of this touches Scribe: it
 * runs the same whether or not an event was ever sent.
 */
import { DETACHED, REFUSAL } from './live'
import { isRecord } from './payload'
import { REFUSED } from './scribe/grant'
import { limited } from './scribe/time'
import { SCHEMA } from './telemetry-schema'

type Listed = typeof SCHEMA.events

/** The name of an event the plugin may report. */
export type EventName = keyof Listed

type Taken<Kind> = Kind extends { readonly flag: true }
  ? boolean
  : Kind extends { readonly whole: readonly [number, number] }
    ? number
    : Kind extends { readonly oneOf: readonly (infer Word)[] }
      ? Word
      : never

/** What an event may hold: each of its keys, with a value of that key's kind. Every key may be left out. */
export type Props<Name extends EventName> = { -readonly [Key in keyof Listed[Name]]?: Taken<Listed[Name][Key]> }

/** The words one key of one event takes. */
export type Word<Name extends EventName, Key extends keyof Listed[Name]> = Taken<Listed[Name][Key]>

/** Where a session is drawn, as it may be reported. */
export type Surface = (typeof SCHEMA.surfaces)[number]

/** Notes one event. It never fails and is never waited for. */
export type Report = <Name extends EventName>(name: Name, props: Props<Name>) => void

type Value = number | boolean | string

/** One event waiting to be sent; `at` is undefined until the time is known. */
type Waiting = { name: EventName; at: number | undefined; props: Record<string, Value> }

/** One event as it is sent. */
type Sent = { name: string; at: number; props: Record<string, Value> }

/** One batch as the server's tool takes it: what sent it, and its events. */
type Batch = { plugin_version: string; engine_version: string; surface: Surface; session: string; events: Sent[] }

/** Why nothing more is sent in a session. */
export type Stopped = 'old-server' | 'not-let-through' | 'failing'

export type Telemetry = {
  /** The plugin's option: off, nothing is noted and nothing sent. */
  isOn: boolean
  /** An id made up for this session, at random. Not Claude Code's session id, which names a transcript on this machine. */
  session: string
  surface: Surface
  /** The plugin's own version, or undefined while it is not known. */
  plugin: string | undefined
  /** The engine's release, or undefined while it is not known. */
  engine: string | undefined
  /** The events not yet sent, oldest first. */
  waiting: Waiting[]
  /** How many were let go unsent because more were waiting than are held. */
  dropped: number
  /** Batches in a row that did not arrive. */
  failures: number
  /** Set once nothing more is to be sent in this session. */
  stopped: Stopped | undefined
  isSending: boolean
  /** Set once the batches kept failing: one more is sent, saying so, and then no more. */
  isLast: boolean
  /** The time by the engine's clock at one moment of this process's own, from which an event's time is read. */
  anchor: { epoch: number; at: number } | undefined
}

/** The tool of Fylgja's server that takes the events. */
export const TOOL = 'report_events'

/** No more events wait than this; the oldest are let go, and counted. */
const MAX_WAITING = 200

/** A batch is waited for no longer than this. */
export const SEND_TIMEOUT_MS = 10_000

/** After this many batches in a row that did not arrive, no more are sent in the session. */
const MAX_FAILURES = 3

/** The start of the key a batch a session left unsent is put away under; the rest is made up at random. */
export const KEPT_PREFIX = 'fylgja.unsent.'

/** No more batches wait on the machine than this; the oldest is let go first. */
const MAX_KEPT = 5

/** Sent for a version that is not known, or not spelled as one. */
export const NO_VERSION = '0.0.0'

// How a server, or the engine for it, says it has no such tool.
const UNKNOWN_TOOL = /unknown tool|no such tool|tool not found/i

export function create(isOn: boolean): Telemetry {
  return {
    isOn,
    session: crypto.randomUUID(),
    surface: 'none',
    plugin: undefined,
    engine: undefined,
    waiting: [],
    dropped: 0,
    failures: 0,
    stopped: undefined,
    isSending: false,
    isLast: false,
    anchor: undefined,
  }
}

/** One word of `words`: `value` when it is one of them, otherwise `other`. */
export function wordOf<const Words extends readonly string[], Other extends Words[number] | undefined>(
  words: Words,
  value: unknown,
  other: Other,
): Words[number] | Other {
  return typeof value === 'string' && words.includes(value) ? value : other
}

/** Where a session is drawn, as one of the listed words. */
function surfaceOf(surface: string | null | undefined): Surface {
  return surface === null || surface === undefined ? 'none' : wordOf(SCHEMA.surfaces, surface, 'other')
}

/**
 * A session began: it has an id of its own, and whatever waited from the
 * one before is let go. Whether a server knows the tool is found out anew.
 */
export function started(telemetry: Telemetry, surface: string | null | undefined): void {
  telemetry.session = crypto.randomUUID()
  telemetry.surface = surfaceOf(surface)
  telemetry.waiting = []
  telemetry.dropped = 0
  telemetry.failures = 0
  telemetry.stopped = undefined
  telemetry.isLast = false
}

/** The engine said which release it is. Only a release's own spelling is kept. */
export function engineIs(telemetry: Telemetry, release: string | undefined): void {
  telemetry.engine = release !== undefined && new RegExp(`^${SCHEMA.patterns.engine_version}$`).test(release) ? release : undefined
}

/**
 * The plugin's own `plugin.json` was read: the version it states is the
 * plugin's. Only three numbers with dots between them are kept, and nothing
 * else of the file is looked at.
 */
export function pluginIs(telemetry: Telemetry, manifest: string): void {
  let version: unknown

  try {
    const stated: unknown = JSON.parse(manifest)

    version = isRecord(stated) ? stated.version : undefined
  } catch {
    version = undefined
  }

  telemetry.plugin =
    typeof version === 'string' && new RegExp(`^${SCHEMA.patterns.plugin_version}$`).test(version) ? version : undefined
}

/**
 * The time by the engine's clock is `epoch` now. An event noted from here on
 * has its time read from it, and one noted before it was known is given it.
 */
export function anchored(telemetry: Telemetry, epoch: number): void {
  telemetry.anchor = { epoch, at: performance.now() }

  for (const event of telemetry.waiting) {
    event.at ??= Math.round(epoch)
  }
}

/** `props` with every value made to fit its key: a number rounded and held to its bounds, and anything that is not of its key's kind left out. */
function fitted(name: EventName, props: Readonly<Record<string, unknown>>): Record<string, Value> {
  const kinds: Readonly<Record<string, unknown>> = SCHEMA.events[name]
  const fits: Record<string, Value> = {}

  for (const [key, value] of Object.entries(props)) {
    const kind = kinds[key]

    if (!isRecord(kind)) {
      continue
    }

    if (kind.flag === true && typeof value === 'boolean') {
      fits[key] = value
    } else if (Array.isArray(kind.whole) && typeof value === 'number' && Number.isFinite(value)) {
      const [lo, hi] = kind.whole as [number, number]

      fits[key] = Math.min(hi, Math.max(lo, Math.round(value)))
    } else if (Array.isArray(kind.oneOf) && typeof value === 'string' && kind.oneOf.includes(value)) {
      fits[key] = value
    }
  }

  return fits
}

/**
 * Notes one event, to be sent with the next batch. Nothing is asked of
 * anyone for it and it cannot fail. Over `MAX_WAITING` the oldest is let go
 * and counted.
 */
export function record<Name extends EventName>(telemetry: Telemetry, name: Name, props: Props<Name>): void {
  if (!telemetry.isOn || telemetry.stopped !== undefined || telemetry.isLast) {
    return
  }

  const { anchor } = telemetry

  telemetry.waiting.push({
    name,
    at: anchor === undefined ? undefined : Math.round(anchor.epoch + performance.now() - anchor.at),
    props: fitted(name, props),
  })

  while (telemetry.waiting.length > MAX_WAITING) {
    telemetry.waiting.shift()
    telemetry.dropped += 1
  }
}

/** The way to Fylgja a batch is sent by: one hook's own, for as long as that hook is being waited on. */
export type Door = {
  /** The name Fylgja's server is called under; undefined while Fylgja is signed out, or is not the plugin's own. */
  server: string | undefined
  /** Whether the hook is still being waited on: a call can be started only while it is. */
  isOpen: () => boolean
  /** One tool call on that server, as the hook makes its own. */
  call: (server: string, tool: string, args: Record<string, unknown>) => Promise<unknown>
  now: () => Promise<number>
  after: (ms: number, fn: () => void) => { cancel: () => void }
  /** Told once the batches' calls are started, or that none will be: the hook may hand back from then on. */
  started?: () => void
}

function stop(telemetry: Telemetry, why: Stopped): void {
  telemetry.stopped = why
  telemetry.waiting = []
  telemetry.dropped = 0
}

/**
 * A batch did not arrive. After `MAX_FAILURES` in a row nothing but one
 * last batch waits, saying that the reports stop; whether or not it
 * arrives, nothing more is sent in the session.
 */
function failed(telemetry: Telemetry, now: number): void {
  telemetry.failures += 1

  if (telemetry.failures >= MAX_FAILURES) {
    telemetry.isLast = true
    telemetry.dropped = 0
    telemetry.waiting = [{ name: 'telemetry_stopped', at: now, props: fitted('telemetry_stopped', { reason: 'failing' }) }]
  }
}

function wordsOf(result: unknown): string {
  const blocks = isRecord(result) && Array.isArray(result.content) ? result.content : []

  return blocks.map(block => (isRecord(block) && typeof block.text === 'string' ? block.text : '')).join('')
}

/** The plugin's own key-value store on this machine (`$.store`), as far as batches put away use it. */
export type Shelf = {
  keys: () => Promise<string[]>
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
}

/** What waits, as one batch of at most the server's own number of events, taken out of the line. */
function batchOf(telemetry: Telemetry, now: number): Batch {
  const lost = telemetry.dropped
  const taken = telemetry.waiting.splice(0, SCHEMA.maxBatch - (lost > 0 ? 1 : 0))

  telemetry.dropped = 0

  return {
    plugin_version: telemetry.plugin ?? NO_VERSION,
    engine_version: telemetry.engine ?? NO_VERSION,
    surface: telemetry.surface,
    session: telemetry.session,
    events: [
      ...(lost > 0 ? [{ name: 'events_dropped', at: now, props: fitted('events_dropped', { count: lost }) }] : []),
      ...taken.map(event => ({ name: event.name, at: event.at ?? now, props: event.props })),
    ],
  }
}

/**
 * A batch read back from the machine, as it is sent again: its envelope as
 * it was spelled, and of its events only those of a listed name, each with
 * its values made to fit their keys once more. Anything else is no batch.
 */
function keptBatchOf(value: unknown): Batch | undefined {
  if (!isRecord(value) || !Array.isArray(value.events)) {
    return undefined
  }

  const { plugin_version, engine_version, surface, session } = value
  const isSpelled =
    typeof plugin_version === 'string' &&
    new RegExp(`^${SCHEMA.patterns.plugin_version}$`).test(plugin_version) &&
    typeof engine_version === 'string' &&
    new RegExp(`^${SCHEMA.patterns.engine_version}$`).test(engine_version) &&
    typeof session === 'string' &&
    new RegExp(`^${SCHEMA.patterns.session}$`).test(session) &&
    typeof surface === 'string' &&
    (SCHEMA.surfaces as readonly string[]).includes(surface)

  if (!isSpelled) {
    return undefined
  }

  const events = value.events.flatMap((event: unknown): Sent[] => {
    if (!isRecord(event) || typeof event.name !== 'string' || !Object.hasOwn(SCHEMA.events, event.name) || !Number.isInteger(event.at)) {
      return []
    }

    const name = event.name as EventName

    return [{ name, at: event.at as number, props: fitted(name, isRecord(event.props) ? event.props : {}) }]
  })

  return events.length === 0
    ? undefined
    : { plugin_version, engine_version, surface: surface as Surface, session, events: events.slice(0, SCHEMA.maxBatch) }
}

/**
 * The session ends: what waits is put away on this machine as one batch,
 * for the first prompt of a later session to send (see `send`). With more
 * batches already waiting there than are kept, the oldest are let go. Never
 * rejects; a batch that could not be put away is let go.
 */
export async function putAway(telemetry: Telemetry, shelf: Shelf, now: number): Promise<void> {
  if (!telemetry.isOn || telemetry.stopped !== undefined || (telemetry.waiting.length === 0 && telemetry.dropped === 0)) {
    return
  }

  anchored(telemetry, now)

  const batch = batchOf(telemetry, Math.round(now))

  // Whatever waited beyond the one batch is let go with the session.
  telemetry.waiting = []
  telemetry.dropped = 0

  try {
    const kept = (await shelf.keys()).filter(key => key.startsWith(KEPT_PREFIX))

    for (const oldest of kept.slice(0, Math.max(0, kept.length - (MAX_KEPT - 1)))) {
      await shelf.delete(oldest)
    }

    await shelf.set(`${KEPT_PREFIX}${crypto.randomUUID()}`, batch)
  } catch {
    // Let go.
  }
}

/** The batches put away on this machine, taken off it: each is sent once, whatever comes of it. */
async function takenOff(shelf: Shelf): Promise<{ key: string; batch: Batch }[]> {
  const taken: { key: string; batch: Batch }[] = []

  try {
    for (const key of (await shelf.keys()).filter(one => one.startsWith(KEPT_PREFIX)).slice(0, MAX_KEPT)) {
      const batch = keptBatchOf(await shelf.get(key))

      await shelf.delete(key)

      if (batch !== undefined) {
        taken.push({ key, batch })
      }
    }
  } catch {
    // What was taken is sent; the rest waits.
  }

  return taken
}

/** What came of one batch's call. */
type Outcome = 'arrived' | 'detached' | 'old-server' | 'not-let-through' | 'failed'

async function outcomeOf(door: Door, answering: Promise<unknown>): Promise<Outcome> {
  try {
    const result = await limited(door.after, answering, SEND_TIMEOUT_MS)

    if (isRecord(result) && result.isError === true) {
      return UNKNOWN_TOOL.test(wordsOf(result)) ? 'old-server' : 'failed'
    }

    return 'arrived'
  } catch (error) {
    const words = error instanceof Error ? error.message : ''

    return words === DETACHED ? 'detached' : REFUSAL.test(words) ? 'not-let-through' : UNKNOWN_TOOL.test(words) ? 'old-server' : 'failed'
  }
}

/**
 * Sends one batch of what waits, and beside it each batch an ended session
 * put away on this machine (`shelf`), when there is any and Fylgja is
 * signed in. Call it from a hook that is being waited on. It never rejects.
 * The calls are all started at once, and `door.started` is told as soon as
 * they are, or that none will be; only then may the hook hand back. A batch
 * the hook could not start any more (it stopped being waited on) stays in
 * line for the next hook, and is no failure. A batch that was started and
 * did not arrive is gone: it is not sent again.
 *
 * A server that answers that it has no such tool is an older one: nothing
 * more is sent in this session. So it is when the call is not let through,
 * and after `MAX_FAILURES` sends in a row in which no batch arrived, with
 * one last batch to say so.
 */
export async function send(telemetry: Telemetry, door: Door, shelf?: Shelf): Promise<void> {
  const { server } = door

  if (!telemetry.isOn || telemetry.stopped !== undefined || telemetry.isSending || server === undefined) {
    door.started?.()

    return
  }

  telemetry.isSending = true

  let now = 0
  let isStarted = false
  let isTold = false
  const told = (): void => {
    if (!isTold) {
      isTold = true
      door.started?.()
    }
  }
  const isLast = telemetry.isLast

  try {
    const kept = shelf === undefined ? [] : await takenOff(shelf)

    now = Math.round(await door.now())
    anchored(telemetry, now)

    // The hook stopped being waited on meanwhile: nothing can be started, and nothing is taken from the line.
    if (!door.isOpen()) {
      for (const { key, batch } of kept) {
        await shelf?.set(key, batch).catch(() => undefined)
      }

      return
    }

    const hasOwn = telemetry.waiting.length > 0 || telemetry.dropped > 0

    if (!hasOwn && kept.length === 0) {
      return
    }

    const lost = telemetry.dropped
    const own = hasOwn ? batchOf(telemetry, now) : undefined
    const ownAnswer = own === undefined ? undefined : door.call(server, TOOL, own)
    const keptAnswers = kept.map(({ batch }) => door.call(server, TOOL, batch))

    told()

    const outcomes = await Promise.all([
      ...(ownAnswer === undefined ? [] : [outcomeOf(door, ownAnswer)]),
      ...keptAnswers.map(answering => outcomeOf(door, answering)),
    ])
    const ownOutcome = ownAnswer === undefined ? undefined : outcomes[0]

    isStarted = outcomes.some(outcome => outcome !== 'detached')

    // Refused for being asked outside a hook that is waited on: never started, so it waits for the next one.
    if (own !== undefined && ownOutcome === 'detached') {
      const back = own.events.slice(lost > 0 ? 1 : 0).map(event => ({ ...event, name: event.name as EventName }))

      telemetry.waiting = [...back, ...telemetry.waiting]
      telemetry.dropped += lost
    }

    if (outcomes.includes('old-server')) {
      stop(telemetry, 'old-server')
    } else if (outcomes.includes('not-let-through')) {
      stop(telemetry, 'not-let-through')
    } else if (outcomes.includes('arrived')) {
      telemetry.failures = 0
    } else if (outcomes.includes('failed')) {
      failed(telemetry, now)
    }
  } catch {
    failed(telemetry, now)
  } finally {
    telemetry.isSending = false

    told()

    if (isLast && isStarted && telemetry.stopped === undefined) {
      stop(telemetry, 'failing')
    }
  }
}

/**
 * What kind of failure an error was, told from its type and from the
 * plugin's own fixed words for a failure, never from anything else it says.
 */
export function causeOf(error: unknown): Word<'error', 'cause'> {
  if (!(error instanceof Error)) {
    return 'other'
  }

  if (error.name === 'TimedOut') {
    return 'timeout'
  }

  if (error.name === 'AbortError' || error.message === DETACHED) {
    return 'aborted'
  }

  if (error.message === REFUSED || REFUSAL.test(error.message)) {
    return 'auth'
  }

  if (error instanceof SyntaxError) {
    return 'parse'
  }

  return error.message === 'failed' || error.message === 'Fylgja is not connected' ? 'network' : 'other'
}

/** How many a search found, as one of four sizes. */
export function sizeOf(found: number): Word<'search', 'results'> {
  return found <= 0 ? 'none' : found <= 3 ? '1_3' : found <= 10 ? '4_10' : 'over_10'
}
