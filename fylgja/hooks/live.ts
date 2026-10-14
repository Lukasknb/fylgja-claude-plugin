/**
 * When this plugin may call Fylgja.
 *
 * Claude Code lets a plugin's own tool call through only while the call is
 * awaited inside a hook it is itself waiting on. A call started from
 * anywhere else (a row being drawn, a timer, work a hook started and left
 * behind) is refused, and in an interactive session might raise a question
 * to the person instead. So no such call is ever started: every call to
 * Fylgja goes through `called`, with the `Live` of the hook that makes it,
 * or through `passed`, which hands the call of work that outlived its hook
 * to a hook that is being waited on.
 */

/**
 * One hook being waited on: open from when it begins its work until it hands
 * back. `left` is called as it hands back, when something of its own waits
 * to hear of it.
 */
export type Live = { isOpen: boolean; left?: () => void }

/** What a call rejects with when it was asked for outside a hook that is being waited on. */
export const DETACHED = 'detached'

/**
 * How the engine words a call of a plugin's that it did not let through:
 * `<plugin>: $.mcp.call(<server>, <tool>) refused: <why>`. A server's own
 * error may say "connection refused" or "access denied" and is not that.
 * Only whether it is one is read; the words go no further.
 */
export const REFUSAL = /\$\.mcp\.call\([^)\n]*\) refused:/

/** How long a hook that must not hold anything up waits for Fylgja. What it started goes on; what was not started waits. */
export const SHORT_WAIT_MS = 1500

export function open(): Live {
  return { isOpen: true }
}

/** The hook hands back: nothing more is started in its name. */
export function close(live: Live): void {
  live.isOpen = false
  live.left?.()
}

/**
 * The one way a call to Fylgja is started. Outside an open hook nothing is
 * started and the call rejects with `DETACHED`.
 */
export function called<T>(live: Live | undefined, start: () => Promise<T>): Promise<T> {
  return live?.isOpen === true ? start() : Promise.reject(new Error(DETACHED))
}

/**
 * The calls of work that goes on after the hook it began in has handed back.
 * Such work may not start a call itself, so it leaves the call here, and a
 * hook that is being waited on starts it: with its own `by`, from its own
 * code, so the call is that hook's in every way Claude Code can tell.
 */
export type Line<By> = {
  /** The calls not yet started, oldest first. */
  waiting: ((by: By) => void)[]
  /** Wakes each hook that is starting calls from the line, when a call joins it. */
  stirs: Set<() => void>
}

export function line<By>(): Line<By> {
  return { waiting: [], stirs: new Set() }
}

/**
 * How long a call waits in the line for a hook to start it. Between two
 * steps of a turn no hook is being waited on while a tool runs: a short run
 * is waited out, and after a long one the call is given up, so that work
 * which outlived its hook ends in good time whatever the turn is doing.
 */
export const LINE_WAIT_MS = 3000

/**
 * The hook `live` starts what waits in the line, and what joins it, until it
 * hands back. Called from the hook itself and not waited for: it ends when
 * the hook is closed.
 *
 * @param by what a call is started with: the hook's own engine interface
 */
export async function serve<By>(calls: Line<By>, live: Live, by: By): Promise<void> {
  while (live.isOpen) {
    for (const take of calls.waiting.splice(0)) {
      take(by)
    }

    let stir: () => void = () => undefined
    const stirred = new Promise<void>(resolve => {
      stir = resolve
    })

    calls.stirs.add(stir)
    live.left = stir
    await stirred
    calls.stirs.delete(stir)
  }
}

/**
 * A call to Fylgja from work that may outlive its hook. While `live` is open
 * the call is started here, as `called` starts one. After that it waits in
 * the line for a hook that is being waited on, which starts it. One that no
 * hook took within `ms` is taken out of the line and rejects with
 * `DETACHED`: it is never started late, for an answer nobody waits for.
 */
export function passed<By, T>(
  calls: Line<By>,
  live: Live | undefined,
  by: By,
  after: (ms: number, fn: () => void) => { cancel: () => void },
  ms: number,
  start: (by: By) => Promise<T>,
): Promise<T> {
  if (live?.isOpen === true) {
    return start(by)
  }

  return new Promise((resolve, reject) => {
    const take = (from: By): void => {
      timer.cancel()

      try {
        start(from).then(resolve, reject)
      } catch (error) {
        reject(error instanceof Error ? error : new Error('failed'))
      }
    }
    const timer = after(Math.max(1, ms), () => {
      calls.waiting = calls.waiting.filter(one => one !== take)
      reject(new Error(DETACHED))
    })

    calls.waiting.push(take)

    for (const stir of calls.stirs) {
      stir()
    }
  })
}

/**
 * Waits for `work`, but no longer than `ms`, and never fails. `work` itself
 * is not stopped.
 */
export function briefly(
  after: (ms: number, fn: () => void) => { cancel: () => void },
  work: Promise<unknown>,
  ms: number,
): Promise<void> {
  return new Promise(resolve => {
    const timer = after(Math.max(1, ms), () => resolve())
    const done = (): void => {
      timer.cancel()
      resolve()
    }

    work.then(done, done)
  })
}
