import type { Host } from './host'
import { isLeftToPlugin } from './project'
import { OWN_SERVER } from './scribe/grant'
import * as Memory from './memory'
import type { Asked } from './resolve'
import * as SignIn from './sign-in'

/**
 * What the line under the prompt says, until the next prompt, when Fylgja is
 * connected through an entry that is not the plugin's own.
 */
export const TWIN_STATUS =
  'Fylgja is also set up outside the plugin here, so the plugin stays out: it only works through the connection it declares itself'

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
  /**
   * The name the engine last answered for the server this plugin declares:
   * the one its own calls go to, and are let through on. Undefined until it
   * has connected, and again while the person has to sign in.
   */
  server: string | undefined
  /** A line of Scribe's for the status line, shown while the sign-in line is not up. */
  notice: string | undefined
  /** Whether the engine last answered an entry other than the plugin's own for its server. */
  isOutside: boolean
  /** The directory the session runs in, as far as it is known. */
  cwd: string | undefined
  /**
   * Whether the project leaves Fylgja's connection to the plugin: found out
   * once, when the session starts, starts over or moves, and never per call.
   */
  vetted: Promise<boolean> | undefined
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
    server: undefined,
    notice: undefined,
    isOutside: false,
    cwd: undefined,
    vetted: undefined,
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
 * Puts a line of the plugin's own on the line under the prompt, or takes it
 * away. The sign-in line comes first: while it is up, the line is kept and
 * shown when sign-in is done.
 */
export function say(host: Host, session: Session, notice: string | undefined): void {
  session.notice = notice

  if (!session.signIn.isShown) {
    host.status(notice)
  }
}

/** The person sent a prompt: the line about Fylgja being set up outside the plugin has been there long enough. */
export function prompted(host: Host, session: Session): void {
  if (session.notice === TWIN_STATUS) {
    say(host, session, undefined)
  }
}

/**
 * The session is in `cwd`: at its start, and whenever it is found to have
 * moved. What the project holds is looked at afresh.
 */
export function located(session: Session, cwd: string): void {
  if (session.cwd !== cwd) {
    session.cwd = cwd
    session.vetted = undefined
  }
}

/** The conversation started over: the project may have changed under it, so it is looked at afresh. */
export function revet(session: Session): void {
  session.vetted = undefined
}

/**
 * Whether the account behind the connection is the one the plugin is meant
 * to work for. Fylgja's server has no tool yet that names the signed-in
 * account, so there is nothing to hold the connection to: no pin is
 * available. When the server offers one, this is the place that asks it.
 */
export function accountPin(): 'unavailable' | 'match' | 'mismatch' {
  return 'unavailable'
}

/**
 * The name to call Fylgja's server under, or undefined when the plugin is
 * not to call it: it is not connected, or the connection is not the
 * plugin's own. The sign-in line is kept true along the way.
 *
 * This is the one place that decides whether the connection is the
 * plugin's own, for the lookups of references and for Scribe alike. Two
 * things must hold. The project's `.mcp.json` files, from the working
 * directory up, hold no entry that could stand in for the plugin's server
 * (see `project.ts`); they are read before any answer is trusted, once per
 * session and not per call. And the engine answers the plugin's own
 * connection name. Otherwise the same address is configured outside the
 * plugin, the engine runs the connection with that entry's credentials,
 * and a cloned repository can set those to anybody's. Nothing of this
 * plugin goes there: Fylgja is not asked whether it is connected, no lookup
 * is made, a reference stays the chip that claims nothing, and one line
 * under the prompt says why, once.
 *
 * A person who has to sign in may sign in as someone else, so everything
 * known about references is dropped when the line goes up: a chip never
 * shows what another account was allowed to see. While the line is up the
 * server is asked again every few seconds, so the line goes soon after the
 * person has signed in, whatever they do next; when it goes, the rows are
 * drawn again and look their references up.
 */
export async function serverOf(host: Host, session: Session, isFirst = false): Promise<string | undefined> {
  if (session.vetted === undefined) {
    const cwd = session.cwd ?? (await host.cwd().catch(() => undefined))

    // A project that cannot be looked at is not vouched for.
    session.vetted ??= cwd === undefined ? Promise.resolve(false) : isLeftToPlugin(host, cwd).catch(() => false)
  }

  if (!(await session.vetted)) {
    if (!session.isOutside) {
      session.isOutside = true
      say(host, session, TWIN_STATUS)
    }

    session.server = undefined

    return undefined
  }

  const { server: answered, change } = await SignIn.check(host, session.signIn, isFirst)
  const isOutside = answered !== undefined && (answered !== OWN_SERVER || accountPin() === 'mismatch')
  const server = isOutside ? undefined : answered

  // Said when it becomes so, not at every answer: the line does not flicker.
  if (isOutside && !session.isOutside) {
    say(host, session, TWIN_STATUS)
  }

  session.isOutside = isOutside || (answered === undefined && session.isOutside)

  // An answer that came late names no server; the name last known stands
  // until the person has to sign in.
  session.server = isOutside ? undefined : (server ?? (session.signIn.isShown ? undefined : session.server))

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
