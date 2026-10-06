/**
 * What the hooks hand the interactive timeline to draw: plain data, already
 * safe to draw, small enough to travel whole (well under the 100,000
 * characters a surface module's props may hold).
 */

import type { Line, Mark } from "./meeting";
import type { Scrub } from "./scrub";

export type View = {
  id: string;
  title: string;
  date: string;
  /** The loaded rows, one run in transcript order. */
  lines: Line[];
  speakers: string[];
  marks: Mark[];
  /** The latest moment seen so far, in seconds. */
  end: number;
  isAtStart: boolean;
  isAtEnd: boolean;
  /** Whether a read is under way. */
  isBusy: boolean;
  /** One plain line for the person, or the empty string. */
  note: string;
  /** Where the hooks send the playhead; `n` changes with every send. */
  goto: { p: number; n: number } | null;
  /** The room the pane had when this was drawn, used until the surface has measured the region itself. */
  columns: number;
  rows: number;
};

/** What the interactive timeline tells the hooks. Only numbers travel: the hooks find every text themselves. */
export type Ask =
  | { ask: "more"; side: "before" | "after" }
  | { ask: "seek"; seconds: number }
  | { ask: "jump"; mark: number }
  | { ask: "quote"; p: number };

export function viewOf(scrub: Scrub, columns: number, rows: number): View {
  return {
    id: scrub.head?.id ?? "",
    title: scrub.head?.title ?? "",
    date: scrub.head?.date ?? "",
    lines: scrub.lines,
    speakers: scrub.speakers,
    marks: scrub.marks,
    end: scrub.end,
    isAtStart: scrub.isAtStart,
    isAtEnd: scrub.isAtEnd,
    isBusy: scrub.busy.before || scrub.busy.after || scrub.busy.seek,
    note: scrub.note,
    goto: scrub.goto ?? null,
    columns,
    rows,
  };
}

function whole(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * What a message from the timeline asks for, or undefined for anything
 * else. The message was written by code on another thread, so it is read
 * as input: a known word and plain numbers, nothing more.
 */
export function askOf(data: unknown): Ask | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  const message = data as Record<string, unknown>;

  if (
    message.ask === "more" &&
    (message.side === "before" || message.side === "after")
  ) {
    return { ask: "more", side: message.side };
  }

  const seconds = whole(message.seconds);

  if (message.ask === "seek" && seconds !== undefined) {
    return { ask: "seek", seconds };
  }

  const mark = whole(message.mark);

  if (message.ask === "jump" && mark !== undefined && Number.isInteger(mark)) {
    return { ask: "jump", mark };
  }

  const p = whole(message.p);

  if (message.ask === "quote" && p !== undefined && Number.isInteger(p)) {
    return { ask: "quote", p };
  }

  return undefined;
}
