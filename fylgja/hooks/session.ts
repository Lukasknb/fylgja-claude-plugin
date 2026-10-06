import type { Host } from './host'
import * as Memory from './memory'
import type { Asked } from './resolve'
import * as SignIn from './sign-in'

/** How often the server is asked whether the person has signed in, while the line is up. */
export const RECHECK_MS = 5000

/** What the plugin keeps while it runs. */
export type Session = {
  /** What Fylgja confirmed about the references drawn so far. */
  memory: Memory.Memory
  /** References waiting to be asked about, in the order they were first drawn. */
  queue: Asked[]
  /** Ids queued or being asked about right now: never asked twice at once. */
  pending: Set<string>
  /** How many lookups have failed for an id since everything was last dropped. */
  failures: Map<string, number>
  /** Whether queued references are being worked through. */
  isLooking: boolean
  signIn: SignIn.SignIn
  /** Runs while the sign-in line is up, and only then. */
  recheck: { cancel: () => void } | undefined
  /**
   * Counts the times everything known was dropped. A lookup notes it when it
   * starts and keeps its answer only if it has not moved since.
   */
  epoch: number
}

export function create(): Session {
  return {
    memory: Memory.create(),
    queue: [],
    pending: new Set(),
    failures: new Map(),
    isLooking: false,
    signIn: SignIn.create(),
    recheck: undefined,
    epoch: 0,
  }
}

/**
 * Drops everything known and everything under way: nothing is confirmed
 * about any reference, an answer still on its way is not kept, and the rows
 * that are drawn next ask afresh.
 */
export function startOver(session: Session): void {
  session.epoch += 1
  session.memory.clear()
  session.queue = []
  session.pending.clear()
  session.failures.clear()
}

/**
 * The name to call Fylgja's server under, or undefined when it is not
 * connected; the sign-in line is kept true along the way.
 *
 * A person who has to sign in may sign in as someone else, so everything
 * known about references is dropped when the line goes up: a chip never
 * shows what another account was allowed to see. While the line is up the
 * server is asked again every few seconds, so the line goes soon after the
 * person has signed in, whatever they do next; when it goes, the rows are
 * drawn again and look their references up.
 */
export async function serverOf(host: Host, session: Session, isFirst = false): Promise<string | undefined> {
  const { server, change } = await SignIn.check(host, session.signIn, isFirst)

  if (session.signIn.isShown && session.recheck === undefined) {
    session.recheck = host.every(RECHECK_MS, () => {
      void serverOf(host, session).catch(() => undefined)
    })
  }

  if (!session.signIn.isShown && session.recheck !== undefined) {
    session.recheck.cancel()
    session.recheck = undefined
  }

  if (change !== undefined) {
    startOver(session)
    host.redraw()
  }

  return server
}
