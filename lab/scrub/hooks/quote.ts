/**
 * The text a quoted row puts into the prompt box, and the clock times shown
 * beside rows.
 */

import type { Head, Line } from "./meeting";

const QUOTE_LENGTH = 160;

/** A moment as `mm:ss`, or `h:mm:ss` from one hour on. */
export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const tail = `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

  return hours > 0 ? `${hours}:${tail}` : tail;
}

/**
 * `"<text>" — <speaker>, {{fylgja:meeting <title>|<id>}} at mm:ss `.
 *
 * Every part was made safe when it was read: the text and the title hold no
 * double quote, no bracket of any kind and no line break. A `|` in the title
 * would end the reference's label early, so it becomes a slash. The result
 * therefore holds exactly one reference, the one to this meeting.
 */
export function quoteOf(head: Head, line: Line, speaker: string): string {
  const said =
    line.x.length > QUOTE_LENGTH
      ? `${line.x.slice(0, QUOTE_LENGTH - 1).trimEnd()}…`
      : line.x;
  const title = head.title.replaceAll("|", "/");

  return `"${said}" — ${speaker}, {{fylgja:meeting ${title}|${head.id}}} at ${clock(line.t)} `;
}
