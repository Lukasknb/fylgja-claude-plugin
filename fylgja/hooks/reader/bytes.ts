/**
 * The byte guard: what an image reading must never carry. A reader that
 * echoed part of an image's encoding into its words would send the image
 * itself, so every field is held against this before it is kept, and a
 * reading with one such field is not kept at all, so the bytes never leave
 * the machine. It mirrors the server's `carries_image_bytes`
 * (`app/domain/services/image_reading.py`), which refuses such a reading
 * (`image_bytes`).
 */

/** An unbroken run this long of base64 characters is a blob, whatever it encodes. */
const MIN_BLOB = 512
const OPAQUE = new RegExp(`[A-Za-z0-9+/=]{${MIN_BLOB},}`)

/** An image written inline as a data URL. */
const DATA_URL = /data:\s*image\//i

/** A base64 run that opens as a PNG, JPEG, GIF or WEBP file does. */
const HEADER = /(?<![A-Za-z0-9+/])(?:iVBORw0KGgo|\/9j\/|R0lGOD|UklGR)[A-Za-z0-9+/=]{16,}/

/** A base64-alphabet run this long is no English word; a blob broken into lines is many of them. */
const LONG_RUN = /[A-Za-z0-9+/=]{24,}/g

/** Whether a run mixes upper case, lower case and digits, as a base64 run almost always does and a hash or a path seldom. */
function isMixed(run: string): boolean {
  return /[A-Z]/.test(run) && /[a-z]/.test(run) && /[0-9]/.test(run)
}

/** Whether `text` may hold an image's bytes, or anything else encoded. */
export function holdsBytes(text: string): boolean {
  if (OPAQUE.test(text) || DATA_URL.test(text) || HEADER.test(text)) {
    return true
  }

  const runs = (text.match(LONG_RUN) ?? []).filter(isMixed)

  return runs.reduce((sum, run) => sum + run.length, 0) >= MIN_BLOB
}
