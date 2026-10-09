import { accountOf, isPinned, keptPin, nameOf, PIN_KEY, pinOf } from './account'
import type { Account } from './account'
import type { Host } from './host'
import { isLeftToPlugin } from './project'
import { payloadOf } from './payload'
import { OWN_SERVER } from './scribe/grant'
import { CALL_TIMEOUT_MS, limited } from './scribe/time'
import type { View } from './scribe/view'
import * as Memory from './memory'
import type { Asked } from './resolve'
import * as SignIn from './sign-in'

/**
 * What the line under the prompt says, until the next prompt, when Fylgja is
 * connected through an entry that is not the plugin's own.
 */
export const TWIN_STATUS =
  'Fylgja is also set up outside the plugin here, so the plugin stays out: it only works through the connection it declares itself'

/** What the line says when Fylgja does not say which account is signed in. */
export const UNSAID_STATUS = 'Fylgja did not say which account is signed in, so the plugin stays out for now'

/** A key that accepts an account acts on its second press within this long. */
export const ACCEPT_MS = 5000

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
  /** The line last said about why the plugin stays out; said once, not at every answer. */
  offLine: string | undefined
  /** The account Fylgja answered for this connection, and whether it is the pinned one. */
  account: { state: 'unknown' | 'pinned' | 'other' | 'unsaid'; who: Account | undefined }
  /** The pinned account as last seen in this process: its name is known only from here. */
  known: Account | undefined
  /**
   * Whether the account is the pinned one: asked once, when the session
   * starts or starts over, before any other call to Fylgja.
   */
  pinned: Promise<'match' | 'mismatch' | 'unavailable'> | undefined
  /** Until when a second press accepts the account; 0 with no first press. */
  acceptUntil: number
  /** Whether the person put the question of the account off for this session. */
  isPutOff: boolean
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
    offLine: undefined,
    account: { state: 'unknown', who: undefined },
    known: undefined,
    pinned: undefined,
    acceptUntil: 0,
    isPutOff: false,
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

/** The person sent a prompt: a line about why the plugin stays out has been there long enough. */
export function prompted(host: Host, session: Session): void {
  if (session.notice !== undefined && session.notice === session.offLine) {
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

/**
 * The conversation started or started over: the project may have changed
 * under it and so may the sign-in, so both are looked at afresh before
 * anything else is asked of Fylgja.
 */
export function revet(session: Session): void {
  session.vetted = undefined
  session.pinned = undefined
  session.acceptUntil = 0
  session.isPutOff = false
}

/**
 * Whether the account behind the connection is the one this machine is set
 * up for. Fylgja is asked who is signed in; the first account ever seen on a
 * machine is pinned, and every later one is held to it. No answer, an answer
 * that is not one, or one that comes too late is no match either: the plugin
 * does not work for an account it could not name.
 */
export async function accountPin(host: Host, session: Session, server: string): Promise<'match' | 'mismatch' | 'unavailable'> {
  const who = accountOf(payloadOf(await limited(host.after, host.call(server, 'whoami', {}), CALL_TIMEOUT_MS)))

  if (who === undefined) {
    session.account = { state: 'unsaid', who: undefined }

    return 'unavailable'
  }

  const kept = await host.stored(PIN_KEY)
  const pin = keptPin(kept)

  // The first account this machine connects as is the one it is set up for.
  if (kept === undefined || kept === null) {
    await host.store(PIN_KEY, pinOf(who))
  } else if (pin === undefined || !isPinned(pin, who)) {
    session.account = { state: 'other', who }

    return 'mismatch'
  }

  session.account = { state: 'pinned', who }
  session.known = who

  return 'match'
}

/** What the line under the prompt says when another account is signed in than the one this machine is set up for. */
export function otherStatus(now: Account, known: Account | undefined): string {
  const pinned = known === undefined ? 'the account this machine is set up for' : nameOf(known)

  return `Fylgja is signed in as ${nameOf(now)}, not as ${pinned}: the plugin stays out until you accept that above the prompt`
}

/** The plugin stays out, and says why once. */
function stayOut(host: Host, session: Session, line: string): undefined {
  if (session.offLine !== line) {
    session.offLine = line
    say(host, session, line)
    // The band may have something to show, or to stop showing.
    host.redraw()
  }

  session.isOutside = true
  session.server = undefined

  return undefined
}

/**
 * What the band above the prompt shows while another account is signed in
 * than the pinned one: who it is, and the key that accepts it. Undefined
 * otherwise, and once the person has put it off for the session.
 */
export function accountView(session: Session): View | undefined {
  const { state, who } = session.account

  if (state !== 'other' || who === undefined || session.isPutOff) {
    return undefined
  }

  return {
    rows: [
      {
        parts: [
          { text: '? ', tone: 'mark' },
          { text: 'Fylgja is signed in as another account than this machine is set up for. ', tone: 'strong' },
          { text: `Now: ${nameOf(who)}` },
          ...(session.known === undefined ? [] : [{ text: ` · before: ${nameOf(session.known)}`, tone: 'dim' } as const]),
        ],
      },
    ],
    keys: [
      {
        key: 'account-accept',
        hotkey: '1',
        label: session.acceptUntil === 0 ? 'Use this account from now on' : 'Press again to use this account',
      },
      { key: 'account-later', hotkey: '0', label: 'Not now' },
    ],
  }
}

/**
 * A key of the account line was pressed. Accepting takes two presses within
 * a few seconds: it changes which account everything is written to.
 */
export async function pressed(host: Host, session: Session, key: string): Promise<void> {
  const { who } = session.account

  if (session.account.state !== 'other' || who === undefined) {
    return
  }

  if (key === 'account-later') {
    session.isPutOff = true
    session.acceptUntil = 0
  } else if (key === 'account-accept') {
    const now = await host.now()

    if (session.acceptUntil === 0 || now > session.acceptUntil) {
      const until = now + ACCEPT_MS

      session.acceptUntil = until
      host.after(ACCEPT_MS, () => {
        if (session.acceptUntil === until) {
          session.acceptUntil = 0
          host.redraw()
        }
      })
    } else {
      await host.store(PIN_KEY, pinOf(who))
      session.account = { state: 'pinned', who }
      session.known = who
      session.pinned = Promise.resolve('match')
      session.acceptUntil = 0
      session.isOutside = false
      session.offLine = undefined
      say(host, session, undefined)
      // What was known was another account's to see.
      startOver(session)
    }
  }

  host.redraw()
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
    return stayOut(host, session, TWIN_STATUS)
  }

  const { server: answered, change } = await SignIn.check(host, session.signIn, isFirst)

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

  if (answered !== undefined && answered !== OWN_SERVER) {
    return stayOut(host, session, TWIN_STATUS)
  }

  // Before anything else is asked of Fylgja: is this the account the machine is set up for?
  if (answered !== undefined) {
    // The plugin's own connection: its own calls may go there, the question of who is signed in first.
    session.server = answered
    session.pinned ??= accountPin(host, session, answered).catch(() => {
      session.account = { state: 'unsaid', who: undefined }

      return 'unavailable' as const
    })

    const pin = await session.pinned

    if (pin !== 'match') {
      const who = pin === 'mismatch' ? session.account.who : undefined

      return stayOut(host, session, who === undefined ? UNSAID_STATUS : otherStatus(who, session.known))
    }

    session.isOutside = false
  }

  // An answer that came late names no server; the name last known stands
  // until the person has to sign in.
  session.server = answered ?? (session.signIn.isShown || session.isOutside ? undefined : session.server)

  return answered
}
