/**
 * What Scribe has to show above the prompt, and the rules that keep it
 * quiet. Silence is the usual state: each rule here is a limit the code
 * holds, whatever the model proposed.
 *
 * One thing shows at a time. A question comes before a tell and a tell
 * before a receipt; a question never shows while Claude is working, and
 * nothing new comes up while the developer is typing.
 */

import type { Draft, Fact, Written } from './types'

/** A recorded decision or gotcha about the code in hand, offered to the developer. */
export type Tell = {
  kind: 'tell'
  fact: Fact
  /** Whether its reason, alternatives and anchors are shown. */
  isOpen: boolean
  isTouched: boolean
}

/** Why a decision was taken, asked of the developer about a record just written without a reason. */
export type ReasonQuestion = {
  kind: 'question'
  form: 'reason'
  /** The written record the answer is saved to. */
  id: string
  content: string
  /** Two or three reasons the model thought likely, to pick from. */
  options: string[]
  isTouched: boolean
}

/** Whether a new decision replaces a recorded one; the new one is written once this is answered. */
export type ReversalQuestion = {
  kind: 'question'
  form: 'reversal'
  draft: Draft
  prior: Fact
  options: string[]
  isTouched: boolean
}

export type Question = ReasonQuestion | ReversalQuestion
export type Item = Tell | Question

/** One line saying what Scribe just wrote. It waits for nobody and nothing waits for it. */
export type Receipt = {
  records: Written[]
  /** Whether the records are listed, each with its own keys. */
  isOpen: boolean
  /** Counts the receipts shown, so a timer set for an earlier one clears nothing. */
  serial: number
}

/** The one-line field the band holds: a record's sentence being put right, or a reason being typed. */
export type Editing = { what: 'fix'; id: string; value: string } | { what: 'reason' }

/** What is kept across sessions on this machine. Ids and counters only. */
export type Kept = {
  /** Records the developer said they knew; never offered again. */
  known: string[]
  /** How many offers in a row were typed past. */
  typedPast: number
  /** How many coming offers are let go unseen for it. */
  skip: number
  /** Whether Scribe has ever shown anything on this machine. */
  hasShown: boolean
}

/** A key that undoes or settles something for good, pressed once: it acts when pressed again in time. */
export type Armed = { key: string; until: number }

export type Band = {
  current: Item | null
  queue: Item[]
  receipt: Receipt | null
  /** What was written and is not on show yet: it waits for the developer to stop typing. */
  held: Written[]
  /** Items pushed out of the line; a reversal among them still has its record to write. */
  overflow: Item[]
  armed: Armed | null
  editing: Editing | null
  isAboutOpen: boolean
  /** Whether the item on show is the first ever on this machine, and says what Scribe is. */
  offersAbout: boolean
  /** Records offered in this session; none is offered twice. */
  told: Set<string>
  /** Decisions asked about in this session, by their sentence; none is asked about twice. */
  asked: Set<string>
  questions: number
  unanswered: number
  hasAskedThisTurn: boolean
  tellsThisTurn: number
  receipts: number
  isWorking: boolean
  /** Whether the prompt box holds text: the developer is typing. */
  isTyping: boolean
  kept: Kept
}

/** No more wait their turn than this; an older one is let go, never shown late. */
export const MAX_QUEUE = 5

/** No more questions than this in one session. */
export const MAX_QUESTIONS = 4

/** After this many questions went unanswered in a session, none follows. */
export const MAX_UNANSWERED = 2

export const MAX_TELLS_PER_TURN = 1

/** No more ids of known records are kept than this; the oldest go first. */
export const MAX_KNOWN = 500

/** The longest run of offers let go after being ignored. */
const MAX_SKIP = 16

/** A receipt lists no more records than this. */
const MAX_RECEIPT = 7

export function freshKept(): Kept {
  return { known: [], typedPast: 0, skip: 0, hasShown: false }
}

export function create(): Band {
  return {
    current: null,
    queue: [],
    receipt: null,
    held: [],
    overflow: [],
    armed: null,
    editing: null,
    isAboutOpen: false,
    offersAbout: false,
    told: new Set(),
    asked: new Set(),
    questions: 0,
    unanswered: 0,
    hasAskedThisTurn: false,
    tellsThisTurn: 0,
    receipts: 0,
    isWorking: false,
    isTyping: false,
    kept: freshKept(),
  }
}

/**
 * How many coming offers are let go after `typedPast` in a row were ignored:
 * the first two cost nothing, then 1, 2, 4, 8 and at most 16.
 */
export function skipsAfter(typedPast: number): number {
  return typedPast <= 2 ? 0 : Math.min(MAX_SKIP, 2 ** (typedPast - 3))
}

function enqueue(band: Band, item: Item): void {
  const line = [...band.queue, item]

  band.overflow.push(...line.slice(0, -MAX_QUEUE))
  band.queue = line.slice(-MAX_QUEUE)
}

/**
 * Puts a record in line to be told, unless a rule says no: it was offered
 * in this session, the developer knows it, or this turn has had its tell.
 */
export function offerTell(band: Band, fact: Fact): boolean {
  if (band.told.has(fact.id) || band.kept.known.includes(fact.id) || band.tellsThisTurn >= MAX_TELLS_PER_TURN) {
    return false
  }

  band.told.add(fact.id)
  band.tellsThisTurn += 1
  enqueue(band, { kind: 'tell', fact, isOpen: false, isTouched: false })

  return true
}

/**
 * Puts a question in line, unless a rule says no: one was asked at this
 * turn's end, this decision was asked about before, the session has had its
 * share, or two went unanswered.
 *
 * @param about the decision's sentence
 */
export function offerQuestion(band: Band, question: Question, about: string): boolean {
  const key = about.toLowerCase()

  if (band.hasAskedThisTurn || band.asked.has(key) || band.questions >= MAX_QUESTIONS || band.unanswered >= MAX_UNANSWERED) {
    return false
  }

  band.asked.add(key)
  band.questions += 1
  band.hasAskedThisTurn = true
  enqueue(band, question)

  return true
}

/**
 * Takes down the question about why the record `id` was decided: its reason
 * has turned up, or the record is gone. One that was never shown gives its
 * place among the session's questions back.
 */
export function withdrawQuestion(band: Band, id: string): void {
  const isAbout = (item: Item): boolean => item.kind === 'question' && item.form === 'reason' && item.id === id
  const waiting = band.queue.filter(isAbout).length

  band.queue = band.queue.filter(item => !isAbout(item))
  band.questions = Math.max(0, band.questions - waiting)

  if (band.current !== null && isAbout(band.current)) {
    band.current = null
    band.editing = band.editing?.what === 'reason' ? null : band.editing
  }
}

/**
 * Notes what was just written, to be shown as a receipt once nothing stands
 * in the way (`settle`). The newest are kept when there are more than a
 * line can list.
 */
export function receive(band: Band, records: readonly Written[]): void {
  const again = new Set(records.map(record => record.id))

  // A later word on a record takes the place of the earlier one.
  band.held = [...band.held.filter(record => !again.has(record.id)), ...records].slice(-MAX_RECEIPT)
}

/** A key that needs a second press acts within this long of the first. */
export const ARM_MS = 5000

/**
 * What a key is armed under. A receipt's Remove is armed for the record it
 * removes, not for its place in the list, which another record coming in
 * could shift between the two presses.
 */
export function armOf(band: Band, key: string): string {
  const record = key.startsWith('remove:') ? band.receipt?.records[Number(key.slice(7))] : undefined

  return record === undefined ? key : `remove:${record.id}`
}

/** What holds a key that waits for its second press: the band, or the window of what was kept. */
export type Arming = { armed: Armed | null }

/**
 * Whether the key armed as `arm`, one that writes to Fylgja or settles
 * something for good, may act now: only on its second press in a row, within
 * `ARM_MS` of the first. The first press changes nothing but what the key
 * says. A digit typed alone into an empty prompt box presses a key of the
 * band, and a question comes up just when a developer may be answering
 * Claude with "1": so no single press may ever write, replace, remove or
 * silence.
 */
export function confirmedIn(holder: Arming, arm: string, now: number): boolean {
  const isSecond = holder.armed?.key === arm && now <= holder.armed.until

  holder.armed = isSecond ? null : { key: arm, until: now + ARM_MS }

  return isSecond
}

/** Whether `key` of the band may act now; see `confirmedIn`. */
export function confirmed(band: Band, key: string, now: number): boolean {
  return confirmedIn(band, armOf(band, key), now)
}

export type Tally = Pick<Band, 'told' | 'asked' | 'questions' | 'unanswered'>

export function tallyOf(band: Band): Tally {
  return { told: band.told, asked: band.asked, questions: band.questions, unanswered: band.unanswered }
}

/** What `settle` did, for the caller to carry out what follows from it. */
export type Settled = {
  /** Whether what the band shows may have changed. */
  isChanged: boolean
  /** Whether what is kept on this machine changed. */
  isKeptChanged: boolean
  /** Items let go unseen. A reversal among them still has its record to write. */
  dropped: Item[]
  /** The serial of a receipt that came up just now, for its time to start. */
  receipt: number | undefined
}

/**
 * Brings the next waiting item up, when nothing is up and the developer is
 * not typing. A question waits while Claude works. Each item coming up is
 * one offer: while offers are being let go for having been ignored, it is
 * dropped unseen and counted off.
 */
export function settle(band: Band): Settled {
  const settled: Settled = {
    isChanged: false,
    isKeptChanged: false,
    dropped: band.overflow,
    receipt: undefined,
  }

  band.overflow = []

  // What was written comes up as a receipt once the developer is not typing.
  if (band.held.length > 0 && !band.isTyping) {
    band.receipts += 1
    band.receipt = {
      records: [
        ...(band.receipt?.records ?? []).filter(shown => !band.held.some(held => held.id === shown.id)),
        ...band.held,
      ].slice(-MAX_RECEIPT),
      isOpen: false,
      serial: band.receipts,
    }
    band.held = []
    settled.receipt = band.receipts
    settled.isChanged = true
  }
  const shown = band.current

  // A question comes before a tell: a tell nobody has touched yet steps
  // back for it, and comes up again after.
  if (shown?.kind === 'tell' && !shown.isTouched && !band.isTyping && !band.isWorking && band.editing === null) {
    const question = band.queue.find(item => item.kind === 'question')

    if (question !== undefined) {
      band.queue = [question, shown, ...band.queue.filter(item => item !== question)].slice(0, MAX_QUEUE)
      band.current = null
    }
  }

  while (band.current === null && !band.isTyping) {
    // A question comes before a tell; while Claude works, only a tell may come up.
    const asks = band.isWorking ? -1 : band.queue.findIndex(item => item.kind === 'question')
    const at = asks === -1 ? band.queue.findIndex(item => item.kind === 'tell') : asks

    if (at === -1) {
      break
    }

    const item = band.queue[at] as Item

    band.queue = band.queue.filter((_, index) => index !== at)

    if (band.kept.skip > 0) {
      band.kept.skip -= 1
      settled.isKeptChanged = true
      settled.dropped.push(item)
      continue
    }

    band.current = item
    settled.isChanged = true
  }

  // The first thing ever shown on a machine says what Scribe is.
  if (!band.kept.hasShown && (band.current !== null || band.receipt !== null)) {
    band.kept.hasShown = true
    band.offersAbout = true
    settled.isKeptChanged = true
  }

  return settled
}

/** A key was pressed on what is shown: the developer is paying attention, so no offer is held back. */
export function touch(band: Band): boolean {
  const isKeptChanged = band.kept.typedPast !== 0 || band.kept.skip !== 0

  band.kept.typedPast = 0
  band.kept.skip = 0

  if (band.current !== null) {
    band.current.isTouched = true
  }

  return isKeptChanged
}

/** Takes down the item on show and whatever was open over it. */
export function clear(band: Band): void {
  band.current = null
  band.editing = null
  band.isAboutOpen = false
  band.offersAbout = false
}

/**
 * The developer sent a prompt. Whatever is on show is taken down, unless
 * they are typing into its field; an offer they never touched counts as
 * ignored. The receipt goes, shown or not yet, and the turn that begins
 * has its own tell.
 *
 * @returns the item taken down, when there was one
 */
export function submitted(band: Band): Item | undefined {
  const item = band.editing === null ? band.current : null

  if (item !== null) {
    if (!item.isTouched) {
      band.kept.typedPast += 1
      band.kept.skip = skipsAfter(band.kept.typedPast)
      band.unanswered += item.kind === 'question' ? 1 : 0
    }

    clear(band)
  }

  band.receipt = null
  band.held = []
  band.armed = null
  band.tellsThisTurn = 0
  band.isTyping = false
  band.isWorking = true

  return item ?? undefined
}

/** Marks a record as known for good: it is never offered on this machine again. */
export function know(band: Band, id: string): void {
  band.kept.known = [...band.kept.known.filter(known => known !== id), id].slice(-MAX_KNOWN)
}
