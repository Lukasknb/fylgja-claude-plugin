/**
 * What Fylgja's server takes, as far as the plugin holds itself to it before
 * it sends: the lengths and counts over which the server refuses rather than
 * trims, and what a path is. They mirror the server's anchor rules and caps
 * and have to change with them.
 *
 * Whether a sentence is a memory is the server's to say, and it says why
 * when it refuses: that is read here by its code.
 */

/** A record's sentence is at most this long. */
export const MAX_CONTENT_CHARS = 220

/** A record's detail is at most this long. */
export const MAX_DETAIL_CHARS = 1200

/** Rejected options a decision may list, and how long each may be. */
export const MAX_ALTERNATIVES = 6
export const MAX_ALTERNATIVE_CHARS = 220

/** Path anchors one write may send; over it the write is refused, not cut. */
export const MAX_ANCHORS = 12

export const MAX_PATH_CHARS = 400
export const MAX_SYMBOL_CHARS = 200

/**
 * The name of the rule Fylgja refused something by. Every refusal of the
 * server's opens `refused:<code> — <what to do>`; the code is what is read,
 * never the words after it. Undefined for anything else.
 */
export function codeOf(refusal: string | undefined): string | undefined {
  return /^refused:([a-z_]{1,60})(?![a-z_])/.exec(refusal ?? '')?.[1]
}

/** The part of a record a refusal is about, and so the only part a correction may change. */
export type Part = 'content' | 'triggers' | 'reason' | 'alternatives' | 'anchors'

const PARTS: Readonly<Record<string, Part>> = {
  not_imperative: 'content',
  too_long: 'content',
  not_one_sentence: 'content',
  status_not_memory: 'content',
  no_trigger: 'triggers',
  reason_missing: 'reason',
  reason_contradiction: 'reason',
  not_a_decision: 'reason',
  detail_too_long: 'reason',
  alternatives_too_many: 'alternatives',
  anchor_invalid: 'anchors',
  anchors_too_many: 'anchors',
  anchor_cap: 'anchors',
}

/**
 * Which part of a record a refusal teaches something about; undefined for a
 * refusal that says nothing a rewording could mend (the record is gone, too
 * many were written, the server is having trouble) and for a code not known
 * here, which is a failure and nothing more.
 */
export function teaches(code: string | undefined): Part | undefined {
  if (code === undefined) {
    return undefined
  }

  return Object.hasOwn(PARTS, code) ? PARTS[code] : undefined
}

/** Refusals that are the server's trouble and not the record's: tried once more, later, as it is. */
export const PASSING: readonly string[] = ['search_index_unavailable', 'edit_conflict']

const LINE_REFERENCE = /(?::\d+(?:-\d+)?(?::\d+)?|#L\d+(?:-L?\d+)?)$/
const CONTROL = /[\u0000-\u001f\u007f]/

/** `path` without a line or a range at its end: lines move with every edit, and the server takes none. */
export function withoutLine(path: string): string {
  return path.replace(LINE_REFERENCE, '')
}

/** Whether the server takes `path` as a path of the repository. */
export function isRepoPath(path: string): boolean {
  const segments = path.split('/')

  return (
    path !== '' &&
    path === path.trim() &&
    path.length <= MAX_PATH_CHARS &&
    !CONTROL.test(path) &&
    !path.includes('\\') &&
    !/^[A-Za-z]:/.test(path) &&
    !path.startsWith('/') &&
    !path.endsWith('/') &&
    !segments.includes('..') &&
    !segments.includes('.') &&
    !segments.includes('') &&
    !LINE_REFERENCE.test(path)
  )
}

/** A symbol as the server takes it: trimmed, a name and not a snippet; undefined when it is none. */
export function symbolOf(value: unknown): string | undefined {
  const symbol = typeof value === 'string' ? value.trim() : ''

  return symbol === '' || symbol.length > MAX_SYMBOL_CHARS || CONTROL.test(symbol) ? undefined : symbol
}
