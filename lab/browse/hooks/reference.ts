/**
 * The reference dropped into the prompt box for a record: the same
 * `{{fylgja:<kind> <title>|<uuid>}}` the Fylgja app copies, which Claude
 * reads as written and opens with Fylgja's tools when it chooses to.
 */

import { drawn } from "./plain";
import type { Row } from "./records";
import type { TokenKind } from "./token";

const KINDS: readonly TokenKind[] = ["meeting", "session", "note", "project"];

/** The kind a reference to this record is written with, or undefined when the grammar has none for it. */
export function tokenKindOf(kind: string): TokenKind | undefined {
  return KINDS.find((known) => known === kind);
}

/**
 * The reference for `row`, or undefined for a kind that has none.
 *
 * The title is a label only. It is cleaned a second time for this grammar:
 * braces and the bar would end the label early or start another reference,
 * so none is left in it.
 */
export function referenceOf(row: Row): string | undefined {
  const kind = tokenKindOf(row.kind);

  if (kind === undefined) {
    return undefined;
  }

  const label = drawn(row.title, 80)
    .replace(/[{}|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return `{{fylgja:${kind}${label === "" ? "" : ` ${label}`}|${row.id}}}`;
}
