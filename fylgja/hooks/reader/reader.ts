/**
 * The image reader: a pasted image becomes text that Fylgja can use, read on
 * the developer's own machine by a fork of the conversation, which sees the
 * image as Claude did. It is a general layer: every reading is context for
 * whatever Fylgja later extracts from the session, and a report of
 * expected behaviour (`skuld/`) is only one use of it.
 *
 * A prompt that carries images arms a reading. Once the turn's first step is
 * back, Scribe judges from the text alone whether the images are worth
 * reading (`worthReading`); on its yes, the reader forks at a later step
 * boundary of the same turn, or at the turn's end, when every guard holds
 * (`dueOf`). The fork's answer is kept only when it saw the images and
 * echoed the prompt (`reply.ts`); otherwise it is tried once more at the
 * turn's end, and then given up. No second fork ever repairs a reply.
 *
 * What a reading holds is the reader's English description, an expectation
 * where one was stated, roles and counts. The words in the image are held
 * for the card in the running plugin and never leave it; the prompt's text
 * is held to check the echo and is never logged or sent. Nothing here calls
 * Fylgja: the upload goes out from a hook Claude Code waits on, through
 * Scribe's own call (`uploadOf` is its shape).
 */

import type { Statement } from '../skuld/statement'
import type { Report, Word } from '../telemetry'
import type { Usage } from '../scribe/loop'
import { FORK_PROMPT } from './prompt'
import { readingOf } from './reply'
import type { ExpectedBasis, Legibility, Read, Role, Shows } from './reply'

/** No more fork requests are made in a session than this, retries included. */
export const MAX_FORKS = 3

/** A fork is made only this soon after the main conversation's last response, while its prompt cache is warm. */
export const WARM_MS = 120_000

/** Once a fork read less than this share of its prefix from the cache, no other is made in the session. */
export const COLD_SHARE = 0.5

/** The most images the server counts for one prompt; the fork is held to the prompt's own count. */
export const MAX_IMAGES = 20

/** No more readings are held for a session than this: the newest. */
export const MAX_READINGS = 20

/** Whether the code a report is about was the session's own work in progress or brought in with the report. */
export type WorkState = 'unknown' | 'brought_in' | 'work_in_progress'

/** What the developer said of a reading, once and for good. */
export type Verdict = 'keep' | 'not_requirement'

/** Where a question about a reading stands: not put yet, put, typed past once and due again, or done with. */
export type Asking = 'not_yet' | 'asked' | 'again' | 'done'

/** One prompt's images and what became of them. */
export type Reading = {
  /** The prompt's hash and when it entered: the key on Fylgja, and in the session. Empty until the hash is known. */
  key: string
  promptHash: string
  promptedAt: string
  /** The conversation it was entered in. */
  sessionId: string
  imageCount: number
  /** The prompt as it entered: held in the running plugin to check the fork's echo and for Scribe's gate, and never logged or sent. */
  text: string
  status: 'armed' | 'read' | 'given_up'
  /** The turn its fork belongs to, once known. */
  turnId: string | undefined
  /** Whether the first step of that turn has come back. */
  hasStepped: boolean
  /** Whether that turn has ended: no fork is made for it after. */
  isOver: boolean
  /** Scribe's judgement whether the images are worth reading. */
  gate: 'none' | 'asking' | 'yes' | 'no'
  /** How many forks were made for it. */
  forks: number
  /** Whether a fork's answer was not kept and one more is owed at the turn's end. */
  isRetryOwed: boolean
  /** Which prompt of the session it was, and how many compactions had been counted when it entered. */
  serial: number
  compactions: number
  read: Read | undefined
  workState: WorkState
  /** Its id on Fylgja, once the server has it. */
  id: string | undefined
  /** The upload as the server last took it; undefined when the server has nothing of it yet. */
  sent: string | undefined
  verdict: Verdict | undefined
  /** The files the session had changed when it entered, by `stateKey`, and those git said were changed in the tree. */
  before: string[]
  dirty: string[] | undefined
  /** The files the session changed since, as tool lines write them. */
  since: string[]
  /** How many of the developer's prompts had been held when it entered: those after are what a statement may rest on. */
  spokenFrom: number
  asking: Asking
  /** The sentence it would be kept as, once worked out; null when there is none. */
  statement: Statement | null | undefined
  /**
   * Whether the prompt's words prove nothing about which message a fork read:
   * it had none, or the same as an earlier prompt of the session. Such a
   * reading is forked for only at a step boundary of its own turn.
   */
  isWeak: boolean
  /** How many more turns' ends a fix may still land at; none after the next image prompt. */
  turnsLeft: number
  /**
   * Whether the words in the image are in hand: read in this load. A reading
   * picked up from the log has lost them, so nothing proposed for it can be
   * held against them.
   */
  hasQuote: boolean
}

/** A fix is looked for at the end of the report's own turn and of this many after it, or until the next image prompt. */
export const FIX_TURNS = 5

/** The readings of a session and what keeps the forks within bounds. */
export type Images = {
  readings: Reading[]
  /** Fork requests made in the session. */
  forks: number
  isForking: boolean
  /** Whether a fork found the cache cold: none is made after. */
  isCold: boolean
  /** When the main conversation last answered; undefined before it has. */
  respondedAt: number | undefined
  /** Counts the prompts that entered the main conversation. */
  prompts: number
  /** The main conversation's last final answer: what a statement may rest on. Held in the running plugin only. */
  lastAnswer: string
  /** The prompts of the session that carried images, normalised: one whose words were seen before proves nothing. Held in the running plugin only. */
  texts: Set<string>
}

export function create(): Images {
  return { readings: [], forks: 0, isForking: false, isCold: false, respondedAt: undefined, prompts: 0, lastAnswer: '', texts: new Set() }
}

/** What the fork came back with, as the host hands it over. */
export type Forked = { text: string | undefined; reason: string | undefined; usage: Usage }

/** The engine calls the reader makes. */
export type ReaderHost = {
  /** `$.model.fork`: the main conversation as Claude last sent it, with `prompt` after it. */
  fork: (prompt: string) => Promise<Forked>
  report: Report
}

/** When a fork may be made: at a step boundary of the prompt's turn, or at its end. */
export type Moment = Word<'image', 'moment'>

/**
 * A prompt that carries images is about to enter: its reading is armed. It
 * is armed before the prompt enters, since the turn may begin before the
 * hook hears that it did; `entered` says it did, and with which words.
 */
export function arm(images: Images, input: { text: string; imageCount: number; turnId: string | undefined; compactions: number; spokenFrom: number; before: string[] }): Reading {
  const reading: Reading = {
    key: '',
    promptHash: '',
    promptedAt: '',
    sessionId: '',
    imageCount: input.imageCount,
    text: input.text,
    status: 'armed',
    turnId: input.turnId,
    hasStepped: false,
    isOver: false,
    gate: 'none',
    forks: 0,
    isRetryOwed: false,
    serial: -1,
    compactions: input.compactions,
    read: undefined,
    workState: 'unknown',
    id: undefined,
    sent: undefined,
    verdict: undefined,
    before: input.before,
    dirty: undefined,
    since: [],
    spokenFrom: input.spokenFrom,
    asking: 'not_yet',
    statement: undefined,
    isWeak: false,
    turnsLeft: FIX_TURNS + 1,
    hasQuote: true,
  }

  // A later report is what the session works on now: no earlier one's fix is looked for after it.
  for (const one of images.readings) {
    one.turnsLeft = 0
  }

  images.readings = [...images.readings, reading].slice(-MAX_READINGS)

  return reading
}

/** A prompt entered the main conversation, whoever sent it: an armed reading of an earlier one is no longer the latest. */
export function prompted(images: Images): number {
  images.prompts += 1

  return images.prompts
}

/** The armed prompt did not enter: its reading goes. */
export function dropped(images: Images, reading: Reading): void {
  images.readings = images.readings.filter(one => one !== reading)
}

/** The reading the main conversation's turn `turnId` is about, if one is armed for it. */
export function armedFor(images: Images, turnId: string | undefined): Reading | undefined {
  const last = images.readings.at(-1)

  if (last === undefined || last.status !== 'armed' || last.isOver) {
    return undefined
  }

  return last.turnId === undefined || turnId === undefined || last.turnId === turnId ? last : undefined
}

/** Whether every guard holds for a fork of `reading` now, at `moment`. */
export function isDue(images: Images, reading: Reading, moment: Moment, now: number, compactions: number): boolean {
  const isOwed = moment === 'step' ? reading.forks === 0 : reading.forks === 0 || reading.isRetryOwed

  return (
    // Words that prove nothing are read only at a step of the prompt's own turn.
    !(reading.isWeak && moment === 'turn_end') &&
    reading.status === 'armed' &&
    !reading.isOver &&
    reading.key !== '' &&
    reading.hasStepped &&
    reading.gate === 'yes' &&
    isOwed &&
    // Still the latest prompt of the main conversation, and nothing compacted since it entered.
    reading.serial === images.prompts &&
    reading.compactions === compactions &&
    // The cache is warm, one fork at a time, and the session has fork requests left.
    images.respondedAt !== undefined &&
    now - images.respondedAt <= WARM_MS &&
    !images.isForking &&
    images.forks < MAX_FORKS &&
    !images.isCold
  )
}

/** The share of a fork's prefix the cache served, in the words it is reported by. */
function shareOf(usage: Usage): Word<'image', 'cache_share'> {
  const all = usage.cacheRead + usage.input + usage.cacheWrite

  if (all === 0) {
    return 'none'
  }

  const share = usage.cacheRead / all

  return share < COLD_SHARE ? 'under_half' : share < 0.9 ? 'half_to_90' : 'over_90'
}

/**
 * Forks the main conversation for `reading` and keeps what the fork read.
 * The fork is asked for at once, before anything is awaited, so from the
 * hook the caller is in; this resolves once its answer is dealt with, and
 * never rejects. The caller has checked `isDue`. A call the engine refused
 * is no request: it is not counted, and what was owed is owed still, unless
 * the turn is over, when the reading is given up.
 */
export async function fork(host: ReaderHost, images: Images, reading: Reading, moment: Moment): Promise<void> {
  images.isForking = true

  const owed = reading.isRetryOwed
  let forked: Forked

  try {
    forked = await host.fork(FORK_PROMPT)
  } catch {
    // The engine would not make the call: nothing was asked, so nothing is counted, and what was owed is owed still.
    images.isForking = false
    reading.isRetryOwed = !reading.isOver && (owed || moment === 'step')

    if (reading.isOver && reading.status === 'armed') {
      reading.status = 'given_up'
    }

    return
  }

  images.isForking = false
  reading.forks += 1
  reading.isRetryOwed = false

  // A fork with nothing to fork made no request.
  if (forked.reason !== 'nothing-to-fork') {
    images.forks += 1
  }

  // How warm the cache was is told by a fork that answered: one cut short read whatever it had got to.
  const share = forked.text === undefined ? undefined : shareOf(forked.usage)

  if (share === 'under_half') {
    images.isCold = true
  }

  const came = forked.text === undefined ? undefined : readingOf(forked.text, reading.text, reading.imageCount)
  // An aborted fork has no word of its own: it is reported without one.
  const outcome: Word<'image', 'outcome'> | undefined =
    came === undefined
      ? forked.reason === 'api-error'
        ? 'api_error'
        : forked.reason === 'empty-reply'
          ? 'empty_reply'
          : forked.reason === 'nothing-to-fork'
            ? 'nothing_to_fork'
            : undefined
      : 'read' in came
        ? 'read'
        : came.refused === 'quoted'
          ? 'unreadable'
          : came.refused

  host.report('image', {
    stage: outcome === 'echo_mismatch' ? 'echo' : 'fork',
    ...(outcome === undefined ? {} : { outcome }),
    moment,
    ...(share === undefined ? {} : { cache_share: share }),
  })

  if (came !== undefined && 'read' in came) {
    reading.read = came.read
    reading.status = 'read'

    return
  }

  // A reply with an image's bytes or the image's words in it is not asked again: no fork repairs a reply. Anything else
  // is tried once more at the turn's end, when this was not that.
  const isFinal = came !== undefined && (came.refused === 'image_bytes' || came.refused === 'quoted')

  if (moment === 'step' && !isFinal && !reading.isOver) {
    reading.isRetryOwed = true
  } else {
    reading.status = 'given_up'
  }
}

/** The turn of `reading` ended and no fork for it is under way or due: it is not read. */
export function over(reading: Reading): void {
  reading.isOver = true

  if (reading.status === 'armed' && !reading.isRetryOwed) {
    reading.status = 'given_up'
  }
}

/** What `save_image_reading` is sent for a reading: the reading as it now stands, never its quote or its prompt. */
export type Upload = {
  session_id: string
  prompt_hash: string
  prompted_at: string
  image_count: number
  shows: Shows
  legibility: Legibility
  reporter_role: Role
  observed: string
  expected?: string
  expected_basis?: ExpectedBasis
  work_state: WorkState
  verdict?: 'not_requirement'
}

/** The upload of a reading that was read; undefined for one that was not. */
export function uploadOf(reading: Reading): Upload | undefined {
  const { read } = reading

  if (reading.status !== 'read' || read === undefined || reading.key === '') {
    return undefined
  }

  return {
    session_id: reading.sessionId,
    prompt_hash: reading.promptHash,
    prompted_at: reading.promptedAt,
    image_count: Math.min(reading.imageCount, MAX_IMAGES),
    shows: read.shows,
    legibility: read.legibility,
    reporter_role: read.reporterRole,
    observed: read.observed,
    ...(read.expected === null || read.expectedBasis === null ? {} : { expected: read.expected, expected_basis: read.expectedBasis }),
    work_state: reading.workState,
    ...(reading.verdict === 'not_requirement' ? { verdict: 'not_requirement' as const } : {}),
  }
}

/**
 * Whether the reading stands on Fylgja otherwise than the server last took
 * it: it is sent at the next turn's end. One the developer kept is settled
 * on the server by the record's write and is never sent again.
 */
export function isAhead(reading: Reading): boolean {
  const upload = uploadOf(reading)

  return upload !== undefined && reading.verdict !== 'keep' && reading.sent !== JSON.stringify(upload)
}
