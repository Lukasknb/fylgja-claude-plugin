/**
 * When this plugin may call Fylgja.
 *
 * Claude Code lets a plugin's own tool call through only while the call is
 * awaited inside a hook it is itself waiting on. A call started from
 * anywhere else (a row being drawn, a timer, work a hook started and left
 * behind) is refused, and in an interactive session might raise a question
 * to the person instead. So no such call is ever started: every call to
 * Fylgja goes through `called`, with the `Live` of the hook that makes it.
 */

/** One hook being waited on: open from when it begins its work until it hands back. */
export type Live = { isOpen: boolean }

/** What a call rejects with when it was asked for outside a hook that is being waited on. */
export const DETACHED = 'detached'

/** How long a hook that must not hold anything up waits for Fylgja. What it started goes on; what was not started waits. */
export const SHORT_WAIT_MS = 1500

export function open(): Live {
  return { isOpen: true }
}

/** The hook hands back: nothing more is started in its name. */
export function close(live: Live): void {
  live.isOpen = false
}

/**
 * The one way a call to Fylgja is started. Outside an open hook nothing is
 * started and the call rejects with `DETACHED`.
 */
export function called<T>(live: Live | undefined, start: () => Promise<T>): Promise<T> {
  return live?.isOpen === true ? start() : Promise.reject(new Error(DETACHED))
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
