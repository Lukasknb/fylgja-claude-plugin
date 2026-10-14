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
 * to Fylgja a batch at a time by a hook Claude Code is waiting on, through
 * the session's own connection. Nothing is written to this machine. Nothing
 * is sent while Fylgja is signed out, or with the plugin's option for it
 * off. A batch is sent once: one that did not arrive is let go, never sent
 * again. A server that does not know the tool is asked once and not again
 * in the session, and so is one whose answers keep failing. None of this
 * touches Scribe: it runs the same whether or not an event was ever sent.
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
export const MAX_WAITING = 200

/** A batch is waited for no longer than this. */
export const SEND_TIMEOUT_MS = 10_000

/** After this many batches in a row that did not arrive, no more are sent in the session. */
export const MAX_FAILURES = 3

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
export function surfaceOf(surface: string | null | undefined): Surface {
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

/**
 * Sends one batch of what waits, when there is any and Fylgja is signed in.
 * Call it from a hook that is being waited on. It never rejects. A batch the
 * hook could not start any more (it stopped being waited on) stays in line
 * for the next hook, and is no failure. A batch that was started and did not
 * arrive is gone: it is not sent again.
 *
 * A server that answers that it has no such tool is an older one: nothing
 * more is sent in this session. So it is when the call is not let through,
 * and after `MAX_FAILURES` batches in a row that did not arrive, with one
 * last batch to say so.
 */
export async function send(telemetry: Telemetry, door: Door): Promise<void> {
  const { server } = door

  if (!telemetry.isOn || telemetry.stopped !== undefined || telemetry.isSending || server === undefined) {
    return
  }

  if (telemetry.waiting.length === 0 && telemetry.dropped === 0) {
    return
  }

  telemetry.isSending = true

  let now = 0
  let isStarted = false
  const isLast = telemetry.isLast

  try {
    now = Math.round(await door.now())
    anchored(telemetry, now)

    // The hook stopped being waited on meanwhile: nothing can be started, and nothing is taken from the line.
    if (!door.isOpen()) {
      return
    }

    const lost = telemetry.dropped
    const batch = telemetry.waiting.splice(0, SCHEMA.maxBatch - (lost > 0 ? 1 : 0))
    const events = [
      ...(lost > 0 ? [{ name: 'events_dropped', at: now, props: fitted('events_dropped', { count: lost }) }] : []),
      ...batch.map(event => ({ name: event.name, at: event.at ?? now, props: event.props })),
    ]

    telemetry.dropped = 0

    const answering = door.call(server, TOOL, {
      plugin_version: telemetry.plugin ?? NO_VERSION,
      engine_version: telemetry.engine ?? NO_VERSION,
      surface: telemetry.surface,
      session: telemetry.session,
      events,
    })

    isStarted = true

    const result = await limited(door.after, answering, SEND_TIMEOUT_MS).catch((error: unknown) => {
      // Refused for being asked outside a hook that is waited on: never started, so it waits for the next one.
      if (error instanceof Error && error.message === DETACHED) {
        isStarted = false
        telemetry.waiting = [...batch, ...telemetry.waiting]
        telemetry.dropped += lost
      }

      throw error
    })

    if (isRecord(result) && result.isError === true) {
      if (UNKNOWN_TOOL.test(wordsOf(result))) {
        stop(telemetry, 'old-server')
      } else {
        failed(telemetry, now)
      }
    } else {
      telemetry.failures = 0
    }
  } catch (error) {
    const words = error instanceof Error ? error.message : ''

    if (words === DETACHED) {
      // Not a failure of the batch: it is still in line.
    } else if (REFUSAL.test(words)) {
      stop(telemetry, 'not-let-through')
    } else if (UNKNOWN_TOOL.test(words)) {
      stop(telemetry, 'old-server')
    } else {
      failed(telemetry, now)
    }
  } finally {
    telemetry.isSending = false

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
