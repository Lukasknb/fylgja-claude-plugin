/**
 * Which account a connection to Fylgja is signed in as, and the one this
 * machine is set up for.
 *
 * The first account the plugin ever connects as on a machine is pinned: its
 * user, team and profile ids are kept, and nothing else of it. From then on
 * the plugin works only while Fylgja answers that same account. A different
 * one (another sign-in, a token somebody else configured) turns everything
 * off until the person accepts it themselves.
 */

import { isRecord } from './payload'
import { drawn } from './plain'

/** Who Fylgja says a connection is signed in as. Names are for showing, and are held in memory only. */
export type Account = {
  user: { id: string; name: string | null }
  team: { id: string; name: string } | null
  profile: { id: string; name: string }
}

/** What is kept of the pinned account on this machine: ids, and nothing a person would read. */
export type Pin = { user: string; team: string | null; profile: string }

/** The key the pin is kept under. */
export const PIN_KEY = 'fylgja.account'

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function idOf(value: unknown): string | undefined {
  return typeof value === 'string' && ID.test(value) ? value.toLowerCase() : undefined
}

function named(value: unknown): { id: string; name: string } | undefined {
  const id = isRecord(value) ? idOf(value.id) : undefined

  return id === undefined || !isRecord(value) || typeof value.name !== 'string' ? undefined : { id, name: value.name }
}

/** The account `whoami` answered with, or undefined when the answer is not one. */
export function accountOf(payload: Record<string, unknown> | undefined): Account | undefined {
  const user = isRecord(payload?.user) ? payload.user : undefined
  const id = idOf(user?.id)
  const profile = named(payload?.profile)
  const team = payload?.team === null || payload?.team === undefined ? null : named(payload.team)

  // A team that is there and does not read as one is no answer at all.
  if (id === undefined || profile === undefined || team === undefined) {
    return undefined
  }

  return { user: { id, name: typeof user?.display_name === 'string' ? user.display_name : null }, team, profile }
}

export function pinOf(account: Account): Pin {
  return { user: account.user.id, team: account.team?.id ?? null, profile: account.profile.id }
}

/** The pin as it was kept, or undefined when what is kept is not one. */
export function keptPin(value: unknown): Pin | undefined {
  const user = isRecord(value) ? idOf(value.user) : undefined
  const profile = isRecord(value) ? idOf(value.profile) : undefined
  const team = isRecord(value) && value.team !== null ? idOf(value.team) : null

  return user === undefined || profile === undefined || team === undefined ? undefined : { user, team, profile }
}

/** Whether `account` is the pinned one: the same user, the same team and the same profile. */
export function isPinned(pin: Pin, account: Account): boolean {
  const now = pinOf(account)

  return pin.user === now.user && pin.team === now.team && pin.profile === now.profile
}

/**
 * A name Fylgja sent, as it is drawn: made safe as every text of the
 * server's is, short, and without the marks an account's line is built
 * from, so a name cannot pass for another account's whole line.
 */
const short = (text: string): string => drawn(text.replace(/[\p{Ps}\p{Pe}#]/gu, ' '), 30) || 'no name'

/**
 * The ends of an account's ids, six characters: two of the user's, two of
 * the team's (`--` without one) and two of the profile's, shown after a `#`.
 * Two accounts under the same name show different ones.
 */
export function tailOf(pin: Pin): string {
  return `${pin.user.slice(-2)}${pin.team?.slice(-2) ?? '--'}${pin.profile.slice(-2)}`
}

/** An account in a few words: the person, the team or the profile they write to, and the end of its ids. */
export function nameOf(account: Account): string {
  const who = account.user.name === null ? 'an account without a name' : short(account.user.name)

  return `${who} (${short(account.team?.name ?? account.profile.name)}) #${tailOf(pinOf(account))}`
}

/** Where records go, for the lines that say so. */
export function destinationOf(account: Account): string {
  const who = account.user.name === null ? '' : ` as ${short(account.user.name)}`

  return `${short(account.team?.name ?? 'no team')}${who}, profile ${short(account.profile.name)}`
}
