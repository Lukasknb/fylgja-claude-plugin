import { ask } from './ask'
import type { Host } from './host'
import * as Memory from './memory'
import { MAX_REFERENCES, resolutionsOf } from './resolve'
import type { Asked } from './resolve'
import { CALL_TIMEOUT_MS, limited } from './scribe/time'
import { serverOf } from './session'
import type { Session } from './session'

/** A reference whose lookup failed is asked about once more, then left alone. */
const MAX_FAILURES = 2

/** No more references wait to be asked about than this; the ones that waited longest are let go. */
export const MAX_QUEUED = 200

async function lookUp(host: Host, session: Session, server: string, asked: readonly Asked[]): Promise<void> {
  const epoch = session.epoch
  const asking = ask(host, server, 'resolve', { refs: asked.map(one => one.id) })
  const payload = await limited(host.after, asking, CALL_TIMEOUT_MS).catch(() => undefined)

  // Everything was dropped while Fylgja was asked: these are no longer wanted.
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

  if (payload === undefined) {
    // A failed call may be a sign-in that lapsed; asking says so under the prompt.
    await serverOf(host, session)
  }
}

async function work(host: Host, session: Session, isFirst: boolean): Promise<void> {
  // Who is signed in is settled first, also when no reference waits.
  let server = await serverOf(host, session, isFirst)

  // A reference waits, and is not counted as failed, while Fylgja is not to
  // be asked: not connected, not the plugin's own connection, or the hook
  // that would ask has handed back.
  while (server !== undefined && session.queue.length > 0 && host.isLive()) {
    await lookUp(host, session, server, session.queue.splice(0, MAX_REFERENCES)).catch(() => undefined)
    // The rows are drawn again with what is known now. A drawing only notes
    // references that are neither known, nor waiting, nor given up on.
    host.redraw()
    server = session.queue.length > 0 ? await serverOf(host, session) : server
  }
}

/**
 * Notes the references a drawn row holds, unless what Fylgja says of them is
 * known, waited for or given up on. Nothing is asked here: a row is drawn
 * from code no call to Fylgja may be started in. `flush` asks.
 *
 * A reference is asked about once: again only after everything known was
 * dropped (a new conversation, a sign-in), or once more after a lookup that
 * failed. So a row drawn a hundred times, on every resize and reload, still
 * asks once.
 */
export function want(session: Session, references: readonly Asked[]): void {
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

  for (const gone of session.queue.splice(0, Math.max(0, session.queue.length - MAX_QUEUED))) {
    session.pending.delete(gone.id)
  }
}

/**
 * Asks Fylgja about the references that wait, from a hook that is being
 * waited on: who is signed in first, then the references, only their ids, at
 * most twenty per call, one call after the other. The rows are drawn again as the
 * answers arrive. What the hook has no time for waits for the next one.
 *
 * @param isFirst the first asking of a session; see `SignIn.check`
 */
export function flush(host: Host, session: Session, isFirst = false): Promise<void> {
  // Two hooks may ask at once; each takes its own references off the queue, and who is signed in is asked once.
  return work(host, session, isFirst).catch(() => undefined)
}
