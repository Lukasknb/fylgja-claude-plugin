/**
 * Asking Fylgja, sparingly. Every search is billed and the server allows
 * sixty a minute, so here searches go out one at a time and at least
 * `SEARCH_GAP_MS` apart, a search nobody waits for any more is never sent,
 * and an answer is kept for a while so that deleting a letter asks nothing.
 *
 * What is kept is kept in this running plugin only, bounded, and dropped
 * when the person turns out to be signed out.
 */

import { hitsOf, meetingsOf } from './answers'
import type { Candidate } from './candidate'
import type { Host } from './host'
import { isRecord } from './payload'

/** Why Fylgja has nothing to show, when it has not. */
export type Problem = 'signed-out' | 'failed'

export type Source = {
  /** The most recent meetings, and when they were read. */
  recents: { list: Candidate[]; at: number } | undefined
  /** The read of the recent meetings that is under way. */
  loading: Promise<void> | undefined
  /** Answered searches by query, oldest first. */
  answers: Map<string, { list: Candidate[]; at: number }>
  /** Resolves when the next search may be sent. */
  turn: Promise<void>
  /** What the last call came to, when it was not an answer. */
  problem: Problem | undefined
}

/** The least time between two searches: under sixty a minute, whatever is typed. */
export const SEARCH_GAP_MS = 1100

const RECENTS_FRESH_MS = 60_000
const ANSWER_FRESH_MS = 5 * 60_000
const MAX_ANSWERS = 30
const SEARCH_LIMIT = 20

export function create(): Source {
  return {
    recents: undefined,
    loading: undefined,
    answers: new Map(),
    turn: Promise.resolve(),
    problem: undefined,
  }
}

function forget(source: Source): void {
  source.recents = undefined
  source.answers.clear()
}

/**
 * One read tool called on Fylgja. Undefined when there is no answer; the
 * reason is kept as the source's problem, and a good answer clears it.
 */
async function ask(host: Host, source: Source, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const connection = await host.connect().catch(() => undefined)

  if (connection === undefined || !connection.isConnected) {
    source.problem = connection?.reason === 'auth' ? 'signed-out' : 'failed'
    forget(source)

    return undefined
  }

  const answer = await host.call(connection.server, tool, args).catch(() => undefined)

  if (answer !== undefined && !(isRecord(answer) && answer.isError === true)) {
    return answer
  }

  // A call that fails may be a sign-in that lapsed: the server is asked which.
  const again = await host.connect().catch(() => undefined)
  const isSignedOut = again !== undefined && !again.isConnected && again.reason === 'auth'

  source.problem = isSignedOut ? 'signed-out' : 'failed'

  if (isSignedOut) {
    forget(source)
  }

  return undefined
}

/** The recent meetings, when they were read less than a minute ago. */
export function freshRecents(source: Source): Candidate[] | undefined {
  const held = source.recents

  return held !== undefined && performance.now() - held.at < RECENTS_FRESH_MS ? held.list : undefined
}

/**
 * Reads the most recent meetings from the timeline, unless a read is under
 * way already. Never rejects.
 */
export function loadRecents(host: Host, source: Source): Promise<void> {
  source.loading ??= ask(host, source, 'get_timeline', {})
    .then(answer => {
      if (answer === undefined) {
        return
      }

      const list = meetingsOf(answer)

      source.problem = list === undefined ? 'failed' : undefined

      if (list !== undefined) {
        source.recents = { list, at: performance.now() }
      }
    })
    .catch(() => {
      source.problem = 'failed'
    })
    .finally(() => {
      source.loading = undefined
    })

  return source.loading
}

/** The kept answer to `query`, when it is still fresh. */
export function answered(source: Source, query: string): Candidate[] | undefined {
  const held = source.answers.get(query.toLowerCase())

  return held !== undefined && performance.now() - held.at < ANSWER_FRESH_MS ? held.list : undefined
}

function keep(source: Source, query: string, list: Candidate[]): void {
  const key = query.toLowerCase()

  source.answers.delete(key)
  source.answers.set(key, { list, at: performance.now() })

  for (const oldest of source.answers.keys()) {
    if (source.answers.size <= MAX_ANSWERS) {
      break
    }

    source.answers.delete(oldest)
  }
}

function wait(host: Host, ms: number): Promise<void> {
  return new Promise(resolve => {
    host.after(ms, resolve)
  })
}

/**
 * Searches Fylgja for `query`, after every search asked before this one and
 * the gap behind the last. `isWanted` is asked again right before the call
 * goes out: a search the person has typed past is dropped unsent.
 *
 * Resolves the hits a reference can name; undefined when the search was
 * dropped or came to nothing (the source's problem says which). Never rejects.
 */
export function search(
  host: Host,
  source: Source,
  query: string,
  isWanted: () => boolean,
): Promise<Candidate[] | undefined> {
  const mine = source.turn.then(async () => {
    const kept = answered(source, query)

    if (kept !== undefined || !isWanted()) {
      return { list: kept, isSent: false }
    }

    const cooled = wait(host, SEARCH_GAP_MS)
    const answer = await ask(host, source, 'search', {
      query,
      limit: SEARCH_LIMIT,
    }).catch(() => undefined)
    const list = answer === undefined ? undefined : hitsOf(answer)

    if (answer !== undefined) {
      source.problem = list === undefined ? 'failed' : undefined
    }

    if (list !== undefined) {
      keep(source, query, list)
    }

    return { list, isSent: true, cooled }
  })

  // The next search waits for this one's answer and for the gap after it.
  source.turn = mine.then(
    done => done.cooled,
    () => undefined,
  )

  return mine.then(
    done => done.list,
    () => undefined,
  )
}
