/**
 * What the fork answered, read leniently, and whether it may be kept. A
 * reading is kept only when the fork saw the images, saw as many as the
 * prompt carried, and echoed the prompt it was meant to read: anything else
 * may be another message's image, or none. No field of it may hold an
 * image's bytes (`bytes.ts`).
 */

import { isRecord } from '../payload'
import { holdsBytes } from './bytes'
import { normalised } from './key'
import { ECHO_CHARS } from './prompt'
import { echoesQuote } from './quote'

export const SHOWS = ['coworker_chat', 'app_ui', 'issue_tracker', 'log_or_terminal', 'other'] as const
export const LEGIBILITY = ['clear', 'partly', 'poor'] as const
export const ROLES = ['colleague', 'customer_via_colleague', 'developer', 'unknown'] as const
export const BASES = ['in_image', 'by_developer'] as const

export type Shows = (typeof SHOWS)[number]
export type Legibility = (typeof LEGIBILITY)[number]
export type Role = (typeof ROLES)[number]
export type ExpectedBasis = (typeof BASES)[number]

/** The longest description the server takes. */
export const MAX_OBSERVED = 1200

/** The longest expectation: one sentence, as long as a record's. */
export const MAX_EXPECTED = 220

/** The longest quote held for the card. */
const MAX_QUOTE = 400

/** What a reading says of the images: what leaves the machine, and the quote, which never does. */
export type Read = {
  shows: Shows
  legibility: Legibility
  reporterRole: Role
  observed: string
  expected: string | null
  expectedBasis: ExpectedBasis | null
  /** The words in the images, verbatim and in their own language: held in the running plugin for the card, and nowhere else. */
  quote?: string
}

/** Why a reply was not kept. */
export type Refusal = 'unreadable' | 'not_visible' | 'count_mismatch' | 'echo_mismatch' | 'image_bytes' | 'quoted'

/** The fields the reply holds, each as written, or undefined where it holds none of that kind. */
type Fields = Record<string, unknown>

/** The first `{` to the last `}` of the reply, read as one object; undefined when that is none. */
function fieldsOf(text: string): Fields | undefined {
  const from = text.indexOf('{')
  const to = text.lastIndexOf('}')

  if (from === -1 || to <= from) {
    return undefined
  }

  try {
    const value: unknown = JSON.parse(text.slice(from, to + 1))

    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** One word of `words`, read as the fork may have spelled it; `fallback` for anything else. */
function wordOf<W extends string>(words: readonly W[], value: unknown, fallback: W): W {
  const word = typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : ''

  return (words as readonly string[]).includes(word) ? (word as W) : fallback
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/** No shorter shared opening proves a fork read the right message, unless the whole message is shorter. */
export const MIN_ECHO = 40

/**
 * Whether the fork echoed the prompt that was entered. Both are normalised
 * as the key is and cut to their first `ECHO_CHARS` characters; they match
 * when they are equal, or when the echo is an opening of the prompt at least
 * `MIN_ECHO` characters long (or the whole of a shorter prompt). An echo
 * longer than the prompt is another message.
 */
export function isEcho(entered: string, echo: unknown): boolean {
  if (typeof echo !== 'string') {
    return false
  }

  const want = normalised(entered).slice(0, ECHO_CHARS)
  const got = normalised(echo).slice(0, ECHO_CHARS)

  if (got === want) {
    return true
  }

  const shorter = Math.min(want.length, got.length)

  return want !== '' && shorter >= Math.min(MIN_ECHO, want.length) && want.startsWith(got)
}

/**
 * The reading in a fork's reply, or why it is not kept.
 *
 * @param entered the prompt as it entered the session
 * @param images how many images it carried
 */
export function readingOf(text: string, entered: string, images: number): { read: Read } | { refused: Refusal } {
  const fields = fieldsOf(text)

  if (fields === undefined) {
    return { refused: holdsBytes(text) ? 'image_bytes' : 'unreadable' }
  }

  // Nothing of a reply that carries an image's bytes is kept, whichever field carries them.
  if (Object.values(fields).some(value => typeof value === 'string' && holdsBytes(value))) {
    return { refused: 'image_bytes' }
  }

  if (fields.image_visible !== true) {
    return { refused: 'not_visible' }
  }

  const seen = typeof fields.images_seen === 'number' || typeof fields.images_seen === 'string' ? Number(fields.images_seen) : NaN

  if (seen !== images) {
    return { refused: 'count_mismatch' }
  }

  if (!isEcho(entered, fields.echo)) {
    return { refused: 'echo_mismatch' }
  }

  const observed = textOf(fields.observed).slice(0, MAX_OBSERVED).trim()

  if (observed === '') {
    return { refused: 'unreadable' }
  }

  const said = textOf(fields.expected)
  const named = wordOf<ExpectedBasis | 'none'>([...BASES, 'none'], fields.expected_basis, 'none')
  const basis = named === 'none' ? null : named
  // An expectation is one sentence the server takes, and says where it comes from; otherwise it is not stated.
  const isStated = said !== '' && said.length <= MAX_EXPECTED && basis !== null && said.toLowerCase() !== 'null'
  // Held against the whole quote; only what the card shows of it is cut.
  const whole = textOf(fields.quote)
  const quote = whole.slice(0, MAX_QUOTE)

  // The reader's description carries the image's own words out: nothing of it is kept. An expectation that copied them is not stated.
  if (echoesQuote(observed, whole)) {
    return { refused: 'quoted' }
  }

  const isCopied = isStated && echoesQuote(said, whole)

  return {
    read: {
      shows: wordOf(SHOWS, fields.shows, 'other'),
      legibility: wordOf(LEGIBILITY, fields.legibility, 'partly'),
      reporterRole: wordOf(ROLES, fields.reporter_role, 'unknown'),
      observed,
      expected: isStated && !isCopied ? said : null,
      expectedBasis: isStated && !isCopied ? basis : null,
      ...(quote === '' ? {} : { quote }),
    },
  }
}
