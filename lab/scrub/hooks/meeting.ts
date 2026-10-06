/**
 * Reading what `get_meeting` answered into the few plain values the
 * timeline draws. Every text is made safe to draw here, once, so nothing
 * downstream holds the server's own strings.
 */

import { isRecord } from "./payload";
import { drawn } from "./plain";

/** One transcript row. Short names, because a few hundred of them travel to the drawing thread as data. */
export type Line = {
  /** The row's position in the transcript: its order, and the handle a quote is found by. */
  p: number;
  /** When the row starts, in seconds from the start of the meeting. */
  t: number;
  /** Which speaker, as an index into the meeting's list of speakers. */
  s: number;
  /** What was said, at most 200 characters. */
  x: string;
};

/** A moment the meeting recorded something at: a decision or a commitment. */
export type Mark = {
  kind: "decision" | "commitment";
  what: string;
  /** The transcript row it was made at, when the server recorded one. */
  p: number | null;
  /** The moment in seconds, when the server recorded one. */
  t: number | null;
};

export type Head = { id: string; title: string; date: string };

const TEXT_LENGTH = 200;
const SPEAKER_LENGTH = 16;
const WHAT_LENGTH = 90;
const TITLE_LENGTH = 80;

/** No more speakers than this get a name and a colour of their own; the rest share the last. */
export const MAX_SPEAKERS = 12;
/** No more decisions and commitments than this are kept per kind. */
export const MAX_MARKS = 20;

const OTHERS = "others";

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** The meeting's id, title and date, or undefined when the answer is not a meeting. */
export function headOf(payload: Record<string, unknown>): Head | undefined {
  if (
    typeof payload.id !== "string" ||
    !/^[0-9a-fA-F-]{36}$/.test(payload.id)
  ) {
    return undefined;
  }

  const title =
    typeof payload.title === "string" ? drawn(payload.title, TITLE_LENGTH) : "";
  const date =
    typeof payload.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.date)
      ? payload.date
      : "";

  return {
    id: payload.id.toLowerCase(),
    title: title === "" ? "Untitled meeting" : title,
    date,
  };
}

/** The name a speaker tag is shown under. A bare number is a voice nobody has named yet. */
function speakerName(tag: unknown): string {
  const name = typeof tag === "string" ? drawn(tag, SPEAKER_LENGTH) : "";

  if (name === "") {
    return "unknown";
  }

  return /^\d+$/.test(name) ? `voice ${name}` : name;
}

function speakerIndex(speakers: string[], name: string): number {
  const known = speakers.indexOf(name);

  if (known >= 0) {
    return known;
  }

  if (speakers.length < MAX_SPEAKERS - 1) {
    return speakers.push(name) - 1;
  }

  const shared = speakers.indexOf(OTHERS);

  return shared >= 0 ? shared : speakers.push(OTHERS) - 1;
}

/**
 * The transcript rows of the answer, in transcript order. A speaker met for
 * the first time is added to `speakers`, so a speaker keeps one index, and
 * with it one colour, across every window of the meeting.
 *
 * A row without a whole position, a moment and a text is left out.
 */
export function linesOf(
  payload: Record<string, unknown>,
  speakers: string[],
): Line[] {
  const rows = Array.isArray(payload.transcript_window)
    ? payload.transcript_window
    : [];
  const lines: Line[] = [];

  for (const row of rows.slice(0, 80)) {
    if (!isRecord(row)) {
      continue;
    }

    const p = count(row.position);
    const t = count(row.start_seconds);

    if (
      p === null ||
      !Number.isInteger(p) ||
      t === null ||
      typeof row.text !== "string"
    ) {
      continue;
    }

    lines.push({
      p,
      t,
      s: speakerIndex(speakers, speakerName(row.speaker_tag)),
      x: drawn(row.text, TEXT_LENGTH),
    });
  }

  return lines
    .sort((a, b) => a.p - b.p)
    .filter((line, at, all) => at === 0 || all[at - 1]?.p !== line.p);
}

function marksIn(list: unknown, kind: Mark["kind"]): Mark[] {
  const marks: Mark[] = [];

  for (const item of Array.isArray(list) ? list.slice(0, MAX_MARKS) : []) {
    if (!isRecord(item) || typeof item.what !== "string") {
      continue;
    }

    const what = drawn(item.what, WHAT_LENGTH);
    const p = count(item.position) ?? count(item.segment_position);

    if (what !== "") {
      marks.push({
        kind,
        what,
        p: p !== null && Number.isInteger(p) ? p : null,
        t: count(item.start_seconds) ?? count(item.at_seconds),
      });
    }
  }

  return marks;
}

/**
 * The meeting's decisions, then its commitments. Where the server recorded
 * the transcript row or the moment one was made at, it is kept; where it
 * did not, the mark has no place on the timeline and is only listed.
 */
export function marksOf(payload: Record<string, unknown>): Mark[] {
  return [
    ...marksIn(payload.decisions, "decision"),
    ...marksIn(payload.action_items, "commitment"),
  ];
}
