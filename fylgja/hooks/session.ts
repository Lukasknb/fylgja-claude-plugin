import { accountOf, isPinned, keptPin, nameOf, PIN_KEY, pinOf, tailOf } from './account'
import type { Account } from './account'
import { markOf } from './companion'
import type { Doing } from './companion'
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
  /**
   * Whether Fylgja is here for the pinned account, as far as the latest
   * answers say: connected through the plugin's own entry, and signed in as
   * the account this machine is set up for. The mark shows only then.
   */
  isHere: boolean
  /**
   * Whether the mark's line is up above the prompt. It comes up only while
   * the prompt box is empty, and goes whenever Fylgja is not here.
   */
  isMarked: boolean
  /** The mark as it read when the band was last asked to draw; undefined for none. */
  mark: string | undefined
  /** What Scribe is at, asked whenever the mark is worked out. Set once, by the plugin; without it the mark rests. */
  doing: (() => Doing | undefined) | undefined
  /** The line last said about why the plugin stays out; said once, not at every answer. */
  offLine: string | undefined
  /** The account Fylgja answered for this connection, and whether it is the pinned one. */
  account: { state: 'unknown' | 'pinned' | 'other' | 'unsaid'; who: Account | undefined }
  /** The pinned account as last seen in this process: its name is known only from here. */
  known: Account | undefined
  /**
   * Whether the account is the pinned one, as far as Fylgja has said: asked
   * before any other call to Fylgja. Only an answer is kept. An ask that
   * failed or came too late leaves it unknown, and it is asked again.
   */
  pin: 'unknown' | 'match' | 'mismatch'
  /** The asking who is signed in that is under way, if one is. */
  pinning: Promise<'match' | 'mismatch' | 'unavailable'> | undefined
  /** The end of the pinned account's ids, to tell it from another of the same name. */
  pinTail: string | undefined
  /** Whether the prompt box holds text: the account line then shows, and takes no key. */
  isTyping: boolean
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
    signIn: SignIn.create(),
    server: undefined,
    notice: undefined,
    isOutside: false,
    isHere: false,
    isMarked: false,
    mark: undefined,
    doing: undefined,
    offLine: undefined,
    account: { state: 'unknown', who: undefined },
    known: undefined,
    pin: 'unknown',
    pinning: undefined,
    pinTail: undefined,
    isTyping: false,
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

/**
 * The mark as the band above the prompt draws it now, in the place of
 * nothing: undefined while its line is not up. What it says is worked out
 * as it is drawn, so it never says more than is true at that moment.
 */
export function markView(session: Session): string | undefined {
  return session.isMarked && session.isHere ? markOf(session.doing?.()) : undefined
}

/**
 * Brings the mark up to date after something it says may have changed, and
 * has the band drawn again only when the mark reads differently than it did.
 *
 * Its line comes up only while the prompt box is empty, as nothing new
 * comes up above the prompt while the person is typing; once the box is
 * empty again it comes. A line that is up changes its words where it
 * stands, which moves nothing. It goes at once, typing or not, when Fylgja
 * is no longer here for the pinned account: it must never say what is not so.
 *
 * It only shows, so it never fails: a band that could not be drawn again
 * stays as it is, and whatever called this goes on as it would have without it.
 */
export function remark(host: Host, session: Session): void {
  try {
    if (!session.isHere) {
      session.isMarked = false
    } else if (!session.isTyping) {
      session.isMarked = true
    }

    const mark = markView(session)

    if (mark !== session.mark) {
      session.mark = mark
      host.redraw()
    }
  } catch {
    // The band stays as it is.
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
  session.pin = 'unknown'
  session.acceptUntil = 0
  session.isPutOff = false
  // Until both are known again, the mark does not vouch for either.
  session.isHere = false
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
    return 'unavailable'
  }

  const kept = await host.stored(PIN_KEY)
  const pin = keptPin(kept)

  // The first account this machine connects as is the one it is set up for.
  if (kept === undefined || kept === null) {
    await host.store(PIN_KEY, pinOf(who))
  } else if (pin === undefined || !isPinned(pin, who)) {
    session.account = { state: 'other', who }
    session.pinTail = pin === undefined ? undefined : tailOf(pin)
    session.pin = 'mismatch'

    return 'mismatch'
  }

  session.account = { state: 'pinned', who }
  session.known = who
  session.pin = 'match'

  return 'match'
}

/** What the line under the prompt says when another account is signed in than the one this machine is set up for. */
export function otherStatus(now: Account, known: Account | undefined, pinTail?: string): string {
  const pinned =
    known !== undefined ? nameOf(known) : `the account this machine is set up for${pinTail === undefined ? '' : ` #${pinTail}`}`

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
  session.isHere = false
  remark(host, session)

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

  const before =
    session.known === undefined
      ? session.pinTail === undefined
        ? undefined
        : `account #${session.pinTail}`
      : nameOf(session.known)

  const isArmed = !session.isTyping && session.acceptUntil !== 0

  return {
    register: 'asks',
    head: 'which account is this?',
    note: 'Until you answer, the plugin stays out: nothing is looked up, and nothing is recorded.',
    rows: [
      {
        parts: [
          { text: '? ', tone: 'mark' },
          { text: 'Fylgja is signed in as another account than this machine is set up for. ', tone: 'strong' },
          { text: `Now: ${nameOf(who)}` },
          ...(before === undefined ? [] : [{ text: ` · before: ${before}`, tone: 'dim' } as const]),
          ...(session.isTyping ? [{ text: ' · empty the prompt box to answer', tone: 'dim' } as const] : []),
        ],
      },
    ],
    // While the prompt box holds text the line is only read: a digit typed there is the person's text.
    keys: session.isTyping
      ? []
      : [
          {
            key: 'account-accept',
            hotkey: '1',
            label: isArmed ? 'Press again to use this account' : 'Use this account from now on',
            ...(isArmed ? { isArmed: true as const } : {}),
          },
          { key: 'account-later', hotkey: '0', label: 'Not now', tone: 'quiet' as const },
        ],
  }
}

/** The prompt box changed. Whether it holds text decides whether the account line takes keys. */
export function typed(host: Host, session: Session, text: string): void {
  const isTyping = text.trim() !== ''

  if (isTyping !== session.isTyping) {
    session.isTyping = isTyping
    session.acceptUntil = 0
    // The mark's line waits for an empty box to come up.
    remark(host, session)

    if (session.account.state === 'other' && !session.isPutOff) {
      host.redraw()
    }
  }
}

/**
 * A key of the account line was pressed. Accepting takes two presses within
 * a few seconds: it changes which account everything is written to.
 */
export async function pressed(host: Host, session: Session, key: string): Promise<void> {
  const { who } = session.account

  if (session.account.state !== 'other' || who === undefined || session.isTyping) {
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
      session.pin = 'match'
      session.acceptUntil = 0
      session.isOutside = false
      session.isHere = true
      session.offLine = undefined
      remark(host, session)
      say(host, session, undefined)
      // What was known was another account's to see.
      startOver(session)
    }
  }

  host.redraw()
}

/** The sign-in line went up or came down: what was known may be another account's, and so may the account. */
function followed(host: Host, session: Session, change: 'shown' | 'cleared' | undefined): void {
  if (!session.signIn.isShown && session.recheck !== undefined) {
    session.recheck.cancel()
    session.recheck = undefined
  }

  if (change !== undefined) {
    startOver(session)
    session.pin = 'unknown'
    host.redraw()
  }
}

/**
 * While the sign-in line is up, Claude Code is asked every few seconds
 * whether Fylgja is connected yet, so the line goes soon after the person
 * has signed in. This runs from a timer, so it asks Claude Code only and
 * never calls Fylgja: who is signed in, and the references that wait, are
 * asked about by the next hook that is being waited on.
 */
async function recheck(host: Host, session: Session): Promise<void> {
  const { change } = await SignIn.check(host, session.signIn, false)

  followed(host, session, change)
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
 * drawn again and their references are asked about at the next chance.
 *
 * Call this from a hook that is being waited on. From anywhere else it
 * calls nothing on Fylgja, and answers undefined while who is signed in is
 * not yet known.
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

  const { server: answered, change, isLatest } = await SignIn.check(host, session.signIn, isFirst)

  if (session.signIn.isShown && session.recheck === undefined) {
    session.recheck = host.every(RECHECK_MS, () => {
      void recheck(host, session).catch(() => undefined)
    })
  }

  followed(host, session, change)

  // Not connected, by the latest answer: Fylgja is not here, whoever was signed in.
  if (answered === undefined && isLatest) {
    session.isHere = false
    remark(host, session)
  }

  if (answered !== undefined && answered !== OWN_SERVER) {
    return stayOut(host, session, TWIN_STATUS)
  }

  // Before anything else is asked of Fylgja: is this the account the machine is set up for?
  if (answered !== undefined) {
    if (session.pin === 'unknown') {
      // Asked only from a hook that is being waited on. From anywhere else
      // it stays unknown, nothing is called, and the next such hook asks.
      if (session.pinning === undefined && !host.isLive()) {
        return undefined
      }

      // The plugin's own connection: its own calls may go there, the question of who is signed in first.
      session.server = answered
      session.pinning ??= accountPin(host, session, answered)
        .catch(() => 'unavailable' as const)
        .finally(() => {
          session.pinning = undefined
        })

      // No answer, or none in time, is not kept: it is asked again at the next chance.
      if ((await session.pinning) === 'unavailable') {
        session.account = { state: 'unsaid', who: undefined }

        return stayOut(host, session, UNSAID_STATUS)
      }
    }

    if (session.pin !== 'match') {
      const { who } = session.account

      return stayOut(host, session, who === undefined ? UNSAID_STATUS : otherStatus(who, session.known, session.pinTail))
    }

    // The account is the one this machine is set up for: a line that said otherwise has had its day.
    if (session.offLine !== undefined) {
      if (session.notice === session.offLine) {
        say(host, session, undefined)
      }

      session.offLine = undefined
      host.redraw()
    }

    session.isOutside = false
    session.isHere = true
    remark(host, session)
  }

  // An answer that came late names no server; the name last known stands
  // until the person has to sign in.
  session.server = answered ?? (session.signIn.isShown || session.isOutside ? undefined : session.server)

  return answered
}
