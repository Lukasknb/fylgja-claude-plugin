/**
 * The reference grammar as the shipped Fylgja plugin reads it, kept here so
 * a test can tell whether a string holds a reference, and to which record.
 */
const PATTERN =
  /\{\{fylgja:(meeting|session|note|project)(?: [^{}|\n]{0,200})?\|([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\}\}/g

/** The ids of the references `text` holds, in the order written. */
export function tokensInForTest(text: string): string[] {
  return [...text.matchAll(PATTERN)].map(match => (match[2] ?? '').toLowerCase())
}
