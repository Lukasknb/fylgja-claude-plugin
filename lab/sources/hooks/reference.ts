/**
 * The reference the Fylgja app copies for Claude, built for a record the
 * ledger holds: `{{fylgja:<kind> <title>|<uuid>}}`.
 */

import type { Seen } from "./call";
import { drawn } from "./plain";

/** The kinds a reference can name. */
const KINDS = ["meeting", "session", "note", "project"];

const MAX_TITLE = 80;

/**
 * The reference for `seen`, or undefined when it has no id or is of a kind
 * no reference names.
 *
 * The title is only a label for the person: it is made safe to draw and
 * loses the three characters the reference is built from, so no title can
 * end the reference early or pass a second id.
 */
export function referenceOf(seen: Seen): string | undefined {
  if (seen.id === undefined || !KINDS.includes(seen.kind)) {
    return undefined;
  }

  const title = drawn(seen.title, MAX_TITLE)
    .replace(/[{}|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return `{{fylgja:${seen.kind}${title === "" ? "" : ` ${title}`}|${seen.id}}}`;
}
