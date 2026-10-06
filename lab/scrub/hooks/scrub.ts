/**
 * What the pane knows about the meeting being scrubbed: the part of its
 * transcript loaded so far, the marks on it, and what is still under way.
 * Held in memory only, bounded, and dropped with the next meeting.
 */

import type { Head, Line, Mark } from "./meeting";
import type { Recent } from "./recent";

/**
 * No more transcript rows than this are held. One run of rows that follow
 * each other is kept; rows far from where the person is reading give way.
 */
export const MAX_LINES = 200;

export type Side = "before" | "after";

export type Scrub = {
  /** Counts meetings opened. An answer that arrives for an earlier one is dropped. */
  epoch: number;
  /** What the pane shows: nothing asked yet, the list of recent meetings, or a meeting. */
  phase: "idle" | "picking" | "meeting";
  /** One plain line for the person, or the empty string. */
  note: string;
  recent: Recent[];
  head: Head | undefined;
  /** The loaded rows: one run in transcript order. */
  lines: Line[];
  speakers: string[];
  marks: Mark[];
  /** The latest moment seen in any window, in seconds: the right edge of the timeline until the end is found. */
  end: number;
  /** Whether the loaded run begins with the meeting's first row. */
  isAtStart: boolean;
  /** Whether a walk past the last loaded row found nothing more, so that row ends the meeting. */
  isAtEnd: boolean;
  /** Which reads are under way. */
  busy: { before: boolean; after: boolean; seek: boolean };
  /** Reads that failed since the last one that worked. After two, no more are started until the person asks again. */
  failures: number;
  /** Where the hooks last sent the playhead, and a number that changes with every such send. */
  goto: { p: number; n: number } | undefined;
  /** The playhead as the plain pane keeps it, by row position. */
  at: number;
  /** Whether the plain pane is drawn instead of the interactive timeline: it failed, or the person asked. */
  isPlain: boolean;
  /** Whether the interactive timeline has failed since this plugin loaded. It is not tried again until a reload. */
  hasFaulted: boolean;
  /** The name the server is called under once connected. */
  server: string | undefined;
};

export function create(): Scrub {
  return {
    epoch: 0,
    phase: "idle",
    note: "",
    recent: [],
    head: undefined,
    lines: [],
    speakers: [],
    marks: [],
    end: 0,
    isAtStart: false,
    isAtEnd: false,
    busy: { before: false, after: false, seek: false },
    failures: 0,
    goto: undefined,
    at: 0,
    isPlain: false,
    hasFaulted: false,
    server: undefined,
  };
}

/** Drops everything known about the last meeting and starts a new epoch. */
export function startOver(scrub: Scrub, phase: Scrub["phase"]): void {
  scrub.epoch += 1;
  scrub.phase = phase;
  scrub.note = "";
  scrub.recent = [];
  scrub.head = undefined;
  scrub.lines = [];
  scrub.speakers = [];
  scrub.marks = [];
  scrub.end = 0;
  scrub.isAtStart = false;
  scrub.isAtEnd = false;
  scrub.busy = { before: false, after: false, seek: false };
  scrub.failures = 0;
  scrub.goto = undefined;
  scrub.at = 0;
}

/** Sends the playhead to the row at `p`, on the interactive timeline and the plain pane alike. */
export function send(scrub: Scrub, p: number): void {
  scrub.goto = { p, n: (scrub.goto?.n ?? 0) + 1 };
  scrub.at = p;
}

/** The loaded row nearest to a moment, or undefined while nothing is loaded. */
export function nearest(scrub: Scrub, seconds: number): Line | undefined {
  let best: Line | undefined;

  for (const line of scrub.lines) {
    if (
      best === undefined ||
      Math.abs(line.t - seconds) < Math.abs(best.t - seconds)
    ) {
      best = line;
    }
  }

  return best;
}

/**
 * Adds a window of rows to the loaded run and says how many were new.
 *
 * A window that overlaps the run or touches its edge extends it. One that
 * lies apart replaces it when `mayReplace` (the person jumped there) and is
 * ignored otherwise, so the run never has a gap. Past the bound, rows give
 * way on the side away from `toward`.
 */
export function merge(
  scrub: Scrub,
  window: readonly Line[],
  toward: Side,
  mayReplace: boolean,
): number {
  const first = scrub.lines[0];
  const last = scrub.lines.at(-1);
  const windowFirst = window[0];
  const windowLast = window.at(-1);

  if (windowFirst === undefined || windowLast === undefined) {
    return 0;
  }

  for (const line of window) {
    scrub.end = Math.max(scrub.end, line.t);
  }

  const isApart =
    first !== undefined &&
    last !== undefined &&
    (windowFirst.p > last.p + 1 || windowLast.p < first.p - 1);

  if (first === undefined || last === undefined || isApart) {
    if (isApart && !mayReplace) {
      return 0;
    }

    scrub.lines = [...window];
    scrub.isAtStart = windowFirst.p === 0;
    scrub.isAtEnd = false;

    return window.length;
  }

  const before = window.filter((line) => line.p < first.p);
  const after = window.filter((line) => line.p > last.p);
  let lines = [...before, ...scrub.lines, ...after];

  if (lines.length > MAX_LINES) {
    if (toward === "after") {
      lines = lines.slice(lines.length - MAX_LINES);
    } else {
      lines = lines.slice(0, MAX_LINES);
      scrub.isAtEnd = false;
    }
  }

  scrub.lines = lines;
  scrub.isAtStart = lines[0]?.p === 0;

  return before.length + after.length;
}
