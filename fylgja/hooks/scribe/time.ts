/**
 * Bounding a wait. Scribe does its work inside the end of a turn, so nothing
 * it waits for may wait for ever: a server that never answers ends as a
 * failure after a fixed time, and the work goes on.
 */

/** `$.clock.after`: calls `fn` once, `ms` milliseconds on. */
export type After = (ms: number, fn: () => void) => { cancel: () => void }

/** No call to Fylgja is waited for longer than this. */
export const CALL_TIMEOUT_MS = 8000

/** What a wait that ran out of time rejects with. */
export class TimedOut extends Error {
  constructor() {
    super('timed out')
    this.name = 'TimedOut'
  }
}

/**
 * `work`, or a rejection once `ms` have passed without it settling. `work`
 * itself is not stopped; whatever it comes to later is let go.
 */
export function limited<T>(after: After, work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = after(Math.max(1, ms), () => reject(new TimedOut()))

    work.then(
      value => {
        timer.cancel()
        resolve(value)
      },
      (error: unknown) => {
        timer.cancel()
        reject(error instanceof Error ? error : new Error('failed'))
      },
    )
  })
}
