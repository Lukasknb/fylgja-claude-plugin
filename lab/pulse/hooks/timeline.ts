/**
 * Reads the text `get_timeline` answers with, in each of its three shapes
 * (a project's timeline, a repository's sessions, recent activity), into
 * entries.
 *
 * Every line is accounted for: it is an entry, a line known to carry no
 * entry (a heading, a count, the fence around the record), or it is counted
 * as unread. Nothing is dropped without being counted.
 */

import { dayOf } from "./days";
import { drawn } from "./plain";

/** What a cell tells apart: the three kinds of work, and everything else the timeline lists. */
export type Lane = "meeting" | "session" | "decision" | "other";

export const LANES: readonly Lane[] = [
  "meeting",
  "session",
  "decision",
  "other",
];

export type Entry = {
  /** The record's id, lower-cased. */
  id: string;
  /** The day it happened, as the server wrote it. */
  date: string;
  /** The same day as a number. */
  day: number;
  lane: Lane;
  /** The server's word for the kind (`meeting`, `commitment new`, `tree move`), made safe to draw. */
  kind: string;
  /** The entry's label, made safe to draw. */
  title: string;
  /**
   * Where it is filed, from the top of the project tree, exactly as the
   * server wrote the names. Compared with other names from the server and
   * sent back to it; never drawn without being made safe first.
   */
  path: string[] | null;
  /** The project's own name when the line gives only that (a session line). */
  place: string | null;
};

export type Read = {
  entries: Entry[];
  /**
   * The lines that are neither an entry nor a line known to carry none. Kept
   * only to tell a line read twice from two lines; only their number is held.
   */
  unread: string[];
  /** Whether the server said it left entries out, or cut the text. */
  isCut: boolean;
};

const MAX_TITLE = 120;
const MAX_KIND = 24;
const UUID =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

// The `s` flag: a label may hold a line or paragraph separator, which is not
// a line break in the server's text and must not end the label.
const ENTRY = new RegExp(
  `^- (\\d{4}-\\d{2}-\\d{2}) · ([^·]{1,60}?) · (.*) \\(id: (${UUID})\\)$`,
  "s",
);
const SESSION_HEAD = /^- \[(\d{4}-\d{2}-\d{2})\] \*\*(.*)\*\*(?: — (.*))?$/s;
const SESSION_ID = new RegExp(`^\\s+id: (${UUID})(?: · |$)`);
const SESSION_REST = /^\s+produced: /;
const FILED = new RegExp(`^- (${UUID}) · in (.+)$`);
const PLACE_MARK = " · in ";

/** Lines the server writes around the entries, which carry none. */
const FURNITURE: readonly RegExp[] = [
  /^<<<fylgja-record /,
  /^<<<end fylgja-record>>>$/,
  /^#{1,3} /,
  /^The tree is at version \d+/,
  /^No (activity|sessions) recorded for /,
  /^No meetings in this window\.$/,
  /^Nothing moved in this window\.$/,
  /^Where these sessions are filed:$/,
];

/** The count lines, which also say whether older entries were left out. */
const COUNTS = /^(Showing \d+ entries|\d+ sessions), newest first\./;
const MORE = /More entries exist|Older sessions exist/;
const CUT = /^\[truncated: \d+ more chars/;

function laneOf(kind: string): Lane {
  return kind === "meeting" || kind === "session" || kind === "decision"
    ? kind
    : "other";
}

function pathOf(text: string): string[] | null {
  const parts = text.split(" > ").map((part) => part.trim());

  return parts.length > 0 && parts.every((part) => part !== "") ? parts : null;
}

type Pending = {
  date: string;
  day: number;
  title: string;
  place: string | null;
};

/**
 * The entries in `text`, how many lines could not be read, and whether the
 * server said the list is incomplete.
 *
 * An entry line is read from both ends: the date and kind at the front, the
 * id at the back, and the place as the last ` · in ` before the id, which is
 * where the server writes it. The words in between are the label and stay
 * one piece.
 */
export function readTimeline(text: string): Read {
  const entries: Entry[] = [];
  const filed = new Map<string, string[]>();
  const unread: string[] = [];
  let isCut = false;
  let pending: Pending | undefined;

  for (const line of text.split("\n")) {
    if (pending !== undefined) {
      const id = SESSION_ID.exec(line)?.[1];
      const head = pending;
      pending = undefined;

      if (id !== undefined) {
        entries.push({
          id: id.toLowerCase(),
          date: head.date,
          day: head.day,
          lane: "session",
          kind: "session",
          title: head.title,
          path: null,
          place: head.place,
        });

        continue;
      }

      // A session heading without its id line names nothing that can be opened.
      unread.push(head.title);
    }

    if (
      line.trim() === "" ||
      SESSION_REST.test(line) ||
      FURNITURE.some((known) => known.test(line))
    ) {
      continue;
    }

    if (CUT.test(line)) {
      isCut = true;

      continue;
    }

    if (COUNTS.test(line)) {
      isCut = isCut || MORE.test(line);

      continue;
    }

    const entry = ENTRY.exec(line);
    const day = entry?.[1] === undefined ? undefined : dayOf(entry[1]);

    if (entry !== null && day !== undefined) {
      const [, date = "", kind = "", body = "", id = ""] = entry;
      const at = body.lastIndexOf(PLACE_MARK);
      const word = kind.trim().toLowerCase();

      entries.push({
        id: id.toLowerCase(),
        date,
        day,
        lane: laneOf(word),
        kind: drawn(word, MAX_KIND),
        title: drawn(at < 0 ? body : body.slice(0, at), MAX_TITLE),
        path: at < 0 ? null : pathOf(body.slice(at + PLACE_MARK.length)),
        place: null,
      });

      continue;
    }

    const session = SESSION_HEAD.exec(line);
    const sessionDay =
      session?.[1] === undefined ? undefined : dayOf(session[1]);

    if (session !== null && sessionDay !== undefined) {
      pending = {
        date: session[1] ?? "",
        day: sessionDay,
        title: drawn(session[2] ?? "", MAX_TITLE),
        place: session[3]?.trim() || null,
      };

      continue;
    }

    const place = FILED.exec(line);

    if (place !== null) {
      const path = pathOf(place[2] ?? "");

      if (path !== null) {
        filed.set((place[1] ?? "").toLowerCase(), path);

        continue;
      }
    }

    unread.push(line);
  }

  if (pending !== undefined) {
    unread.push(pending.title);
  }

  for (const entry of entries) {
    entry.path ??= filed.get(entry.id) ?? null;
  }

  return { entries, unread, isCut };
}

/** What makes two lines the same entry: fetched twice, it is kept once. */
export function keyOf(entry: Entry): string {
  return `${entry.kind}|${entry.id}|${entry.date}`;
}
