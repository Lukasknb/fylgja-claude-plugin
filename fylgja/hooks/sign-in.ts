import type { Host } from './host'

/** The line shown under the prompt while Fylgja needs sign-in. */
export const SIGN_IN_TEXT = 'sign in with /mcp'

export type SignIn = {
  /** Whether the sign-in line is on screen. */
  isShown: boolean
  /** How many times the server's state has been asked. */
  asked: number
  /** Which of those asks the line last followed. An answer to an earlier one is out of date. */
  applied: number
}

export function create(): SignIn {
  return { isShown: false, asked: 0, applied: 0 }
}

/** What one answer about the server's state came to. */
export type Checked = {
  /** The name to call the server under, when it is connected and the answer is current. */
  server: string | undefined
  /** Whether this answer put the line up or took it down. */
  change: 'shown' | 'cleared' | undefined
}

/**
 * Asks Fylgja's server for its state and makes the sign-in line say it: the
 * line is up exactly while the latest answer is that the server needs
 * sign-in.
 *
 * Only that is said out loud. A server that is switched off, not approved,
 * refused by policy or unreachable is silent, and takes the line down if it
 * was up: that is the person's or their organization's choice, or not theirs
 * to fix.
 *
 * Answers can arrive out of order. One that was asked before an answer
 * already followed is dropped, so a slow "needs sign-in" never overrules a
 * later "connected".
 *
 * @param isFirst writes the line's state even when it seems unchanged: a
 *   plugin that was just loaded cannot know what an earlier load left on screen
 */
export async function check(host: Host, signIn: SignIn, isFirst: boolean): Promise<Checked> {
  signIn.asked += 1
  const turn = signIn.asked
  const connection = await host.connect()

  if (turn < signIn.applied) {
    return { server: undefined, change: undefined }
  }

  signIn.applied = turn

  const needsSignIn = !connection.isConnected && connection.reason === 'auth'
  const change = needsSignIn === signIn.isShown ? undefined : needsSignIn ? 'shown' : 'cleared'

  if (change !== undefined || isFirst) {
    signIn.isShown = needsSignIn
    host.status(needsSignIn ? SIGN_IN_TEXT : undefined)
  }

  return { server: connection.isConnected ? connection.server : undefined, change }
}
