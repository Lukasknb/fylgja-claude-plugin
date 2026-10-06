/**
 * Finding what the person is typing a reference for: the text between a
 * trigger (`@@` or `{{`) and the cursor.
 *
 * Only the few characters before the cursor are read, so the cost is the
 * same for a draft of ten characters and one of a hundred thousand.
 */

export type Mark = '@@' | '{{'

export type Trigger = {
  mark: Mark
  /** Where the trigger's first character sits in the draft. */
  start: number
  /** What was typed after the trigger, up to the cursor, as typed. */
  raw: string
  /** `raw` as a search reads it: trimmed, single-spaced. */
  query: string
}

/** A query longer than this is prose, not the name of a record. */
export const MAX_QUERY = 60

const NEWLINE = 10
const RETURN = 13
const AT = 64
const OPEN = 123
const CLOSE = 125
const BAR = 124

function isGap(code: number): boolean {
  // Nothing before the trigger, or white space, or an opening bracket or quote.
  return Number.isNaN(code) || code <= 32 || code === 40 || code === 91 || code === 34 || code === 39
}

export function queryOf(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

/**
 * The trigger the cursor stands after, or undefined.
 *
 * `@@` counts at the start of a word only, so an address or a decorator in
 * pasted code opens nothing. `{{` counts anywhere, except as the start of a
 * reference that is already written out (`{{fylgja:`). A line break, a
 * closing brace or a bar between trigger and cursor ends it: the person has
 * moved on, or the cursor is inside a finished reference.
 */
export function triggerAt(text: string, cursor: number): Trigger | undefined {
  const floor = Math.max(0, cursor - MAX_QUERY - 1)

  for (let at = cursor - 1; at >= floor; at -= 1) {
    const code = text.charCodeAt(at)

    if (code === NEWLINE || code === RETURN || code === CLOSE || code === BAR) {
      return undefined
    }

    if (code !== AT && code !== OPEN) {
      continue
    }

    if (at === 0 || text.charCodeAt(at - 1) !== code) {
      return undefined
    }

    const start = at - 1
    const raw = text.slice(at + 1, cursor)

    if (code === AT) {
      return isGap(text.charCodeAt(start - 1)) ? { mark: '@@', start, raw, query: queryOf(raw) } : undefined
    }

    return raw.startsWith('fylgja:') ? undefined : { mark: '{{', start, raw, query: queryOf(raw) }
  }

  return undefined
}
