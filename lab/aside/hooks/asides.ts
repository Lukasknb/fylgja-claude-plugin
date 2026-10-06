/**
 * This session's asides: every question asked, what was read for it and what
 * it came to. Held in this module's memory only, a bounded number of them,
 * and gone when the session ends or the plugin reloads.
 */

import type { Answer, Earlier } from './answer'
import type { Hit, Source } from './retrieve'

/** Where a question is on its way to an answer; each step is named on screen. */
export type Phase = 'searching' | 'reading' | 'answering' | 'done'

/** What a question came to. */
export type Outcome =
  | ({ kind: 'answered' } & Answer)
  /** The model replied, and nothing in the reply pointed at a record that was read. */
  | { kind: 'uncited' }
  | { kind: 'model-silent'; why: 'rate-limited' | 'timed-out' | 'failed' }
  | { kind: 'no-hits' }
  | { kind: 'signed-out' }
  | { kind: 'offline' }
  | { kind: 'rate-limited'; seconds: number | null }
  | { kind: 'failed' }
  | { kind: 'unexpected' }

export type Turn = {
  id: number
  question: string
  /** What the question before it in the thread came to; undefined for a thread's first. */
  earlier: Earlier | undefined
  /** Records the earlier answer rested on, taken along without reading them again. */
  carried: Source[]
  isWide: boolean
  phase: Phase
  /** How many records are being read, or were. */
  reading: number
  sources: Source[]
  others: Hit[]
  isCut: boolean
  outcome: Outcome | undefined
}

export type Asides = {
  turns: Turn[]
  /** The position in `turns` of the one on screen. */
  shown: number
  /** True once the person asked for a new thread: the next question typed in the pane follows nothing. */
  isFresh: boolean
  /** What the person has typed into the pane's field and not yet sent. */
  draft: string
  /** One line about the last press that could not do what it says, or undefined. */
  notice: string | undefined
  /** True while the pane could not be placed and the band above the prompt stands in for it. */
  isBand: boolean
  made: number
}

/** No more than this many asides are remembered; the oldest go first. */
export const MAX_TURNS = 20

/** How many of an earlier answer's records the next question takes along. */
const MAX_CARRIED = 2

export function create(): Asides {
  return {
    turns: [],
    shown: 0,
    isFresh: false,
    draft: '',
    notice: undefined,
    isBand: false,
    made: 0,
  }
}

/** The aside on screen, or undefined before the first question. */
export function shownOf(asides: Asides): Turn | undefined {
  return asides.turns[asides.shown]
}

/**
 * What a question that follows `turn` is told about it: the question, the
 * answer as it was shown, and the ids of the records it rested on. Undefined
 * when `turn` has no answer to follow.
 */
function earlierOf(turn: Turn): { earlier: Earlier; carried: Source[] } | undefined {
  if (turn.outcome?.kind !== 'answered') {
    return undefined
  }

  const carried = turn.outcome.cited
    .map(n => turn.sources[n - 1])
    .filter((source): source is Source => source !== undefined)
    .slice(0, MAX_CARRIED)

  return {
    earlier: {
      question: turn.question,
      answer: turn.outcome.text,
      sourceIds: carried.map(source => source.id),
    },
    carried,
  }
}

/**
 * Adds a question and puts it on screen.
 *
 * @param after the aside it follows, when it is a follow-up
 * @param again the aside it asks again more widely: same thread, same context
 */
export function begin(asides: Asides, question: string, after: Turn | undefined, again: Turn | undefined): Turn {
  asides.made += 1
  const context = after === undefined ? undefined : earlierOf(after)

  const turn: Turn = {
    id: asides.made,
    question,
    earlier: again?.earlier ?? context?.earlier,
    carried: again?.carried ?? context?.carried ?? [],
    isWide: again !== undefined,
    phase: 'searching',
    reading: 0,
    sources: [],
    others: [],
    isCut: false,
    outcome: undefined,
  }

  asides.turns.push(turn)
  asides.turns.splice(0, Math.max(0, asides.turns.length - MAX_TURNS))
  asides.shown = asides.turns.length - 1
  asides.isFresh = false
  asides.notice = undefined

  return turn
}

/** Moves what is on screen by `by` asides, staying within the ones remembered. */
export function step(asides: Asides, by: number): void {
  asides.shown = Math.min(Math.max(asides.shown + by, 0), Math.max(asides.turns.length - 1, 0))
  asides.notice = undefined
}
