/**
 * The key a reading is stored under on Fylgja, which the server computes the
 * same way from the transcript: the SHA-256 of the prompt's text with the
 * image placeholders taken out. No salt and no hash of an image: the server
 * must find the prompt again by its words alone, and the plugin never reads
 * an image's bytes.
 *
 * Mirrors `prompt_hash` of the server's `app/domain/services/image_reading.py`
 * byte for byte: change one only together with the other.
 */

/**
 * What counts as whitespace in the key, as one class: exactly what
 * ECMAScript's `\s` matches, which is the server's `WHITESPACE_CLASS`.
 * U+0085 and U+001C to U+001F are not whitespace here; trimming uses the
 * same class.
 */
const SPACE = '\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff'
const SPACES = new RegExp(`[${SPACE}]+`, 'gu')
const EDGES = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, 'gu')
const MARKER = /\[Image #\d+\]/g

/**
 * The prompt's text as both sides hash it: its text blocks joined with a line
 * break, NFC, every `[Image #N]` removed, trimmed, and each run of whitespace
 * one space.
 */
export function normalised(text: string | readonly string[]): string {
  const joined = typeof text === 'string' ? text : text.join('\n')

  return joined.normalize('NFC').replace(MARKER, '').replace(EDGES, '').replace(SPACES, ' ')
}

/** The SHA-256 of the normalised prompt, 64 lowercase hex digits. */
export async function promptHash(text: string | readonly string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalised(text)))

  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
