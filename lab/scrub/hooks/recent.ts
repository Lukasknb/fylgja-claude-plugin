/**
 * The most recent meetings, read out of the activity text `get_timeline`
 * answers with. Meetings are only ever listed as text, one line each:
 * `- <date> · meeting · <title>[ · in <path>] (id: <uuid>)`.
 */

import { drawn } from "./plain";

export type Recent = {
  id: string;
  /** The title, already safe to draw. */
  title: string;
  date: string;
};

/** How many meetings the picker offers: one per digit key. */
export const MAX_RECENT = 9;

const TITLE_LENGTH = 60;
const LINE =
  /^- (\d{4}-\d{2}-\d{2}) · meeting · (.+) \(id: ([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)\s*$/;

/**
 * The meetings the text lists, newest first as the server wrote them, each
 * id once. A line of any other shape is skipped, so text that only looks
 * like a list yields nothing.
 */
export function recentIn(text: string): Recent[] {
  const found: Recent[] = [];
  const seen = new Set<string>();

  for (const line of text.split("\n")) {
    const match = LINE.exec(line);
    const [, date, label, rawId] = match ?? [];

    if (date === undefined || label === undefined || rawId === undefined) {
      continue;
    }

    const id = rawId.toLowerCase();

    if (seen.has(id)) {
      continue;
    }

    seen.add(id);

    // The place a meeting is filed under follows the title after ` · in `.
    const filed = label.lastIndexOf(" · in ");
    const title = drawn(
      filed > 0 ? label.slice(0, filed) : label,
      TITLE_LENGTH,
    );

    found.push({ id, title: title === "" ? "Untitled meeting" : title, date });

    if (found.length === MAX_RECENT) {
      break;
    }
  }

  return found;
}
