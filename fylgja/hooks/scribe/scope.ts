/**
 * Where a record holds: the organizations (customers, suppliers, partners)
 * a record is true for alone, when the session makes clear it is not true
 * generally. The names go to Fylgja as the session says them, and Fylgja
 * answers with the names it knows them by; a record with none holds
 * generally.
 *
 * A server from before it took them turns the write down for the argument:
 * the write is sent again without it, once, and not sent it again in the
 * session, as the commit a decision was written at is (`base.ts`).
 */

/** No more organizations are named for one record than this, nor longer names. */
export const MAX_APPLIES_TO = 3
export const MAX_ORGANIZATION = 80

/** What `remember` is told: the organizations the record holds for, as the session names them. */
export type Scope = { applies_to: string[] }

/** The one line a card or the window shows for a record that holds for some organizations only. */
export function forLine(names: readonly string[]): string {
  return `For: ${names.join(', ')}`
}

/** The organization names Fylgja answered with, as many as are kept. */
export function namesOf(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .filter((name): name is string => typeof name === 'string' && name.trim() !== '')
    .map(name => name.trim().slice(0, MAX_ORGANIZATION))
    .slice(0, MAX_APPLIES_TO)
}

const OLD_WORDS = /\bapplies_to\b[\s\S]{0,200}?unexpected[ _]keyword[ _]argument|unexpected[ _]keyword[ _]argument[\s\S]{0,200}?\bapplies_to\b/i

/**
 * Whether Fylgja turned a write down for `applies_to`: a server from before
 * it took it. Such an answer from today's servers names the arguments the
 * tool does take, and `applies_to` is not among them; older servers name the
 * argument they did not expect.
 */
export function isUnknownScope(refusal: string): boolean {
  const isUntaken = /invalid arguments[\s\S]{0,40}an argument this tool does not take/i.test(refusal) && !/\bapplies_to\b/.test(refusal)

  return isUntaken || OLD_WORDS.test(refusal)
}
