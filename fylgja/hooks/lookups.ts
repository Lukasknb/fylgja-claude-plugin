import { ask } from './ask'
import type { Host } from './host'
import * as Memory from './memory'
import { MAX_REFERENCES, resolutionsOf } from './resolve'
import type { Asked } from './resolve'
import { serverOf } from './session'
import type { Session } from './session'

/** A reference whose lookup failed is asked about once more, then left alone. */
const MAX_FAILURES = 2

async function lookUp(host: Host, session: Session, asked: readonly Asked[]): Promise<void> {
  const epoch = session.epoch
  const server = await serverOf(host, session)

  // Everything was dropped while the server was asked: these are no longer wanted.
  if (epoch !== session.epoch) {
    return
  }

  const payload =
    server === undefined ? undefined : await ask(host, server, 'resolve', { refs: asked.map(one => one.id) })

  if (epoch !== session.epoch) {
    return
  }

  const resolutions = (payload === undefined ? undefined : resolutionsOf(payload, asked)) ?? []
  const answered = new Set(resolutions.map(resolution => resolution.id))

  for (const one of asked) {
    session.pending.delete(one.id)

    if (!answered.has(one.id)) {
      session.failures.set(one.id, (session.failures.get(one.id) ?? 0) + 1)
    }
  }

  Memory.keep(session.memory, resolutions)

  if (server !== undefined && payload === undefined) {
    // A failed call may be a sign-in that lapsed; asking says so under the prompt.
    await serverOf(host, session)
  }
}

async function work(host: Host, session: Session): Promise<void> {
  // Let every row of one drawing pass add its references before the first batch leaves.
  await Promise.resolve()

  while (session.queue.length > 0) {
    await lookUp(host, session, session.queue.splice(0, MAX_REFERENCES)).catch(() => undefined)
  }

  // The rows are drawn again with what is known now. A drawing asks only
  // about references that are neither known, nor under way, nor given up on,
  // so this cannot go round for ever.
  host.redraw()
}

/**
 * Has Fylgja asked about the references a drawn row holds, unless that is
 * settled or under way already. Returns at once: the row is drawn with what
 * is known now, and drawn again when the answers arrive.
 *
 * Only ids are sent, at most twenty per call, one call at a time. A
 * reference is asked about once: again only after everything known was
 * dropped (a new conversation, a sign-in), or once more after a lookup that
 * failed. So a row drawn a hundred times, on every resize and reload, still
 * asks once.
 */
export function want(host: Host, session: Session, references: readonly Asked[]): void {
  for (const one of references) {
    const isSettled =
      session.memory.has(one.id) ||
      session.pending.has(one.id) ||
      (session.failures.get(one.id) ?? 0) >= MAX_FAILURES

    if (!isSettled) {
      session.pending.add(one.id)
      session.queue.push({ id: one.id, kind: one.kind })
    }
  }

  if (session.queue.length > 0 && !session.isLooking) {
    session.isLooking = true
    void work(host, session)
      .catch(() => undefined)
      .finally(() => {
        session.isLooking = false
        // References a row added while the last batch was finishing.
        want(host, session, [])
      })
  }
}
