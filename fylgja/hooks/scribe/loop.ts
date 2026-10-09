/**
 * One wake of Scribe: a few model calls, each answered with a lookup or with
 * the verdict, the lookups run by the plugin.
 *
 * A wake is bounded on every side: so many model calls, so many lookups, one
 * search, a time limit on each call and on the whole. A wake that runs into
 * any of them, or that the model answers unreadably twice running, ends with
 * nothing done.
 */

import { payloadOf } from '../payload'
import { factsOf, idsIn } from './facts'
import { CALL_TIMEOUT_MS, limited } from './time'
import type { After } from './time'
import { ANSWER_NOW, fenced } from './prompt'
import type { Block } from './prompt'
import { replyOf, verdictOf } from './verdict'
import type { Seen } from './verdict'
import type { Fact, Verdict } from './types'

export const MAX_STEPS = 4
export const MAX_LOOKUPS = 3
export const MAX_SEARCHES = 1

/** No model call of a wake may take longer. */
export const STEP_TIMEOUT_MS = 25_000

/** No wake may take longer in all. */
export const WAKE_DEADLINE_MS = 45_000

/** No more of one lookup's answer is handed to the model than this. */
export const MAX_RESULT_CHARS = 4000
const MAX_REPLY_TOKENS = 1500

/** The lookups the model may ask for. It is never handed a tool that writes. */
const LOOKUPS: ReadonlySet<string> = new Set(['recall', 'search', 'open'])

/** The four token counts of one model call. */
export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Completion = { text: string | undefined; usage: Usage }

export type Request = {
  model: string
  system: readonly Block[]
  prompt: readonly Block[]
  maxTokens: number
  timeoutMs: number
}

/** The engine calls a wake makes. */
export type LoopHost = {
  /** `$.model.complete`: one reply, or no text when the call failed or ran out of time. */
  complete: (request: Request) => Promise<Completion>
  /** One read on Fylgja's server; rejects when it is refused or fails. */
  lookup: (tool: string, args: Record<string, unknown>) => Promise<unknown>
  /** `$.clock.now`. */
  now: () => Promise<number>
  /** `$.clock.after`. */
  after: After
}

export type Wake = {
  model: string
  system: string
  /** The plan documents and the earlier wakes: the part that is the same from call to call. */
  fixed: readonly Block[]
  /** The wake in hand. */
  current: string
  repo: string
  /** The records the wake is shown from the start. */
  shown: readonly Fact[]
  seen: Omit<Seen, 'facts'>
}

/** How a wake ended. Every ending but `verdict` leaves nothing done. */
export type Ending = 'verdict' | 'unreadable' | 'steps' | 'deadline' | 'no-reply'

export type Woken = {
  ending: Ending
  verdict: Verdict
  /** Every record the wake held whole, by id. */
  facts: Map<string, Fact>
  steps: number
  lookups: number
  usage: Usage
}

const NOTHING: Verdict = { records: [], question: null, tells: [] }

function argsOf(tool: string, args: Record<string, unknown>, repo: string): Record<string, unknown> | undefined {
  const query = typeof args.query === 'string' ? args.query.trim().slice(0, 300) : ''
  const id = typeof args.id === 'string' ? idsIn(args.id)[0] : undefined

  // The repository is the session's, whatever the model wrote.
  if (tool === 'recall') {
    return query === '' ? undefined : { query, repo }
  }

  if (tool === 'search') {
    return query === '' ? undefined : { query }
  }

  return id === undefined ? undefined : { id }
}

function textOf(result: unknown): string {
  const blocks = (result as { content?: unknown } | null)?.content
  const text = (Array.isArray(blocks) ? blocks : [])
    .map(block => (typeof (block as { text?: unknown } | null)?.text === 'string' ? (block as { text: string }).text : ''))
    .join('')

  return text === '' ? JSON.stringify(payloadOf(result) ?? {}) : text
}

/** Runs one wake to its end. Never rejects: a failure anywhere is an ending. */
export async function wake(host: LoopHost, input: Wake): Promise<Woken> {
  const facts = new Map(input.shown.map(fact => [fact.id, fact]))
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const ended = (ending: Ending, steps: number, lookups: number, verdict: Verdict = NOTHING): Woken => ({
    ending,
    verdict,
    facts,
    steps,
    lookups,
    usage,
  })

  let said = ''
  let steps = 0
  let lookups = 0
  let searches = 0
  let unreadable = 0

  try {
    const startedAt = await host.now()

    while (steps < MAX_STEPS) {
      const left = WAKE_DEADLINE_MS - ((await host.now()) - startedAt)

      if (left <= 0) {
        return ended('deadline', steps, lookups)
      }

      steps += 1

      const reply = await host.complete({
        model: input.model,
        system: [{ text: input.system, cache: true }],
        prompt: [...input.fixed, { text: `${input.current}${said}${ANSWER_NOW}` }],
        maxTokens: MAX_REPLY_TOKENS,
        timeoutMs: Math.max(1, Math.min(STEP_TIMEOUT_MS, Math.floor(left))),
      })

      usage.input += reply.usage.input
      usage.output += reply.usage.output
      usage.cacheRead += reply.usage.cacheRead
      usage.cacheWrite += reply.usage.cacheWrite

      if (reply.text === undefined) {
        return ended((await host.now()) - startedAt >= WAKE_DEADLINE_MS ? 'deadline' : 'no-reply', steps, lookups)
      }

      const asked = replyOf(reply.text)

      if (asked.kind === 'unreadable') {
        unreadable += 1

        if (unreadable >= 2) {
          return ended('unreadable', steps, lookups)
        }

        said += `\n\n[Your last reply could not be used: ${asked.why}. Answer again with one JSON object and nothing else.]`
        continue
      }

      unreadable = 0

      if (asked.kind === 'verdict') {
        return ended('verdict', steps, lookups, verdictOf(asked.value, { ...input.seen, facts }))
      }

      const args = LOOKUPS.has(asked.tool) ? argsOf(asked.tool, asked.args, input.repo) : undefined
      const isOver = lookups >= MAX_LOOKUPS || (asked.tool === 'search' && searches >= MAX_SEARCHES)

      if (args === undefined || isOver) {
        said += `\n\n[That lookup was not run: ${isOver ? 'no lookups are left in this wake' : 'it is not one of the three lookups, or its arguments are missing'}. Answer with your verdict.]`
        continue
      }

      lookups += 1
      searches += asked.tool === 'search' ? 1 : 0

      let found: string

      try {
        // A lookup's time is the wake's time: it is waited for no longer
        // than the wake has left.
        const spent = (await host.now()) - startedAt
        const result = await limited(
          host.after,
          host.lookup(asked.tool, args),
          Math.min(CALL_TIMEOUT_MS, WAKE_DEADLINE_MS - spent),
        )

        found = textOf(result).slice(0, MAX_RESULT_CHARS)

        for (const fact of factsOf(payloadOf(result))) {
          facts.set(fact.id, fact)
        }
      } catch {
        found = '(the lookup failed; go on without it)'
      }

      said += `\n\nYou asked for ${asked.tool} ${JSON.stringify(args)}. Its result:\n${fenced(`${asked.tool} result`, found)}`
    }

    return ended('steps', steps, lookups)
  } catch {
    return ended('no-reply', steps, lookups)
  }
}
