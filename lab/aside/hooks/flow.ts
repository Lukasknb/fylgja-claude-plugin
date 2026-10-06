/**
 * One question from start to finish: one search, a few reads, one model
 * call. Nothing here touches the conversation; every step ends in a state
 * the pane says in words.
 */

import { answerOf, promptOf, SYSTEM } from './answer'
import { begin } from './asides'
import type { Asides, Outcome, Turn } from './asides'
import type { Host } from './host'
import { NARROW, read, search, WIDE } from './retrieve'

/** A follow-up is searched together with the question it follows, since it rarely stands alone. */
const MAX_QUERY = 300

async function outcomeOf(host: Host, turn: Turn): Promise<Outcome> {
  const bounds = turn.isWide ? WIDE : NARROW
  const query = turn.earlier === undefined ? turn.question : `${turn.earlier.question} ${turn.question}`
  const found = await search(host, query.slice(0, MAX_QUERY), bounds)

  if (found.state !== 'hits') {
    return found.state === 'rate-limited' ? { kind: 'rate-limited', seconds: found.seconds } : { kind: found.state }
  }

  if (found.hits.length === 0 && turn.carried.length === 0) {
    return { kind: 'no-hits' }
  }

  turn.phase = 'reading'
  turn.reading = Math.min(bounds.reads, found.hits.length + turn.carried.length)
  host.redraw()

  const got = await read(host, found.server, found.hits, turn.carried, bounds)
  turn.sources = got.sources
  turn.others = got.others
  turn.isCut = got.isCut
  turn.reading = got.sources.length

  if (got.sources.length === 0) {
    return { kind: 'no-hits' }
  }

  turn.phase = 'answering'
  host.redraw()

  const reply = await host
    .complete(SYSTEM, promptOf(turn.question, got.sources, turn.earlier))
    .catch(() => ({ isAnswered: false, why: 'failed' }) as const)

  if (!reply.isAnswered) {
    return { kind: 'model-silent', why: reply.why }
  }

  const answer = answerOf(reply.text, got.sources.length)

  return answer === undefined ? { kind: 'uncited' } : { kind: 'answered', ...answer }
}

/**
 * Asks `question` and shows its progress in the pane. Resolves when it has
 * an outcome; it never rejects, and whatever goes wrong becomes an outcome
 * the pane says in one line.
 *
 * The question is on screen before the first wait, so the pane that opens
 * for it never shows an older one.
 */
export function ask(
  host: Host,
  asides: Asides,
  question: string,
  after: Turn | undefined,
  again: Turn | undefined,
): Promise<void> {
  const turn = begin(asides, question, after, again)
  host.redraw()

  return outcomeOf(host, turn)
    .catch((): Outcome => ({ kind: 'failed' }))
    .then(outcome => {
      turn.outcome = outcome
      turn.phase = 'done'
      host.redraw()
    })
}
