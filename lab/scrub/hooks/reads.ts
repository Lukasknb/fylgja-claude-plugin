/**
 * Every read this plugin makes on Fylgja, and what each does to what the
 * pane knows. Reads are started by something the person did, one per side
 * at a time, and the pane is drawn again when one lands.
 */

import type { Host } from "./host";
import { headOf, linesOf, marksOf } from "./meeting";
import { payloadOf, textOf } from "./payload";
import { quoteOf } from "./quote";
import { recentIn } from "./recent";
import { merge, nearest, send, startOver } from "./scrub";
import type { Scrub, Side } from "./scrub";

/** After this many reads in a row that failed, none is started until the person asks again. */
const MAX_FAILURES = 2;
/** How many windows a jump to a row whose moment is not known may read while closing in on it. */
const MAX_HOPS = 3;
/** Seconds one transcript row is taken to last when nothing loaded says otherwise. */
const SECONDS_PER_ROW = 4;

export const NEEDS_SIGN_IN =
  "Fylgja needs sign-in: run /mcp, then /scrub again.";
export const UNREACHABLE = "Fylgja is not available in this session.";
export const UNREADABLE =
  "That meeting could not be read: it was not found, or it is not yours to read.";
export const NO_ANSWER = "Fylgja did not answer. Try again in a moment.";
export const NO_TRANSCRIPT = "This meeting has no transcript to scrub through.";
export const NO_MEETINGS =
  "No recent meetings found. Give one: /scrub <reference, link or id>.";
export const NO_BOX =
  "The prompt box cannot take the quote right now.";
export const INEXACT =
  "That moment is not loaded exactly; this is the nearest row found.";

/** The server's name once connected. When it is not, the pane's line says why and nothing is read. */
async function serverOf(host: Host, scrub: Scrub): Promise<string | undefined> {
  const connection = await host.connect().catch(() => undefined);

  if (connection?.isConnected === true) {
    scrub.server = connection.server;

    return connection.server;
  }

  scrub.server = undefined;
  scrub.note = connection?.reason === "auth" ? NEEDS_SIGN_IN : UNREACHABLE;

  return undefined;
}

/** One read. A refusal, an error and a lost connection all come back as undefined. */
function ask(
  host: Host,
  server: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return host.call(server, tool, args).catch(() => undefined);
}

/** The transcript rows around a moment, or undefined when the read failed. */
async function windowAt(
  host: Host,
  scrub: Scrub,
  seconds: number,
): Promise<Record<string, unknown> | undefined> {
  if (
    scrub.head === undefined ||
    scrub.server === undefined ||
    scrub.failures >= MAX_FAILURES
  ) {
    return undefined;
  }

  const epoch = scrub.epoch;
  const result = await ask(host, scrub.server, "get_meeting", {
    meeting_id: scrub.head.id,
    include: ["transcript_window"],
    around_seconds: Math.max(0, seconds),
  });
  const payload = payloadOf(result);

  if (epoch !== scrub.epoch) {
    return undefined;
  }

  if (payload === undefined) {
    scrub.failures += 1;
    scrub.note = NO_ANSWER;

    return undefined;
  }

  scrub.failures = 0;
  scrub.note = "";

  return payload;
}

/**
 * Reads the window next to the loaded run on one side. A window that brings
 * nothing new means the run already reaches that end of the meeting: that
 * is the only way the end is ever found, since the meeting's length is not
 * part of what the server answers.
 */
export async function extend(
  host: Host,
  scrub: Scrub,
  side: Side,
): Promise<void> {
  const edge = side === "after" ? scrub.lines.at(-1) : scrub.lines[0];
  const isDone = side === "after" ? scrub.isAtEnd : scrub.isAtStart;

  if (edge === undefined || isDone || scrub.busy[side] || scrub.busy.seek) {
    return;
  }

  scrub.busy[side] = true;
  const epoch = scrub.epoch;
  const payload = await windowAt(host, scrub, edge.t);

  if (epoch !== scrub.epoch) {
    return;
  }

  scrub.busy[side] = false;

  if (payload !== undefined) {
    const window = linesOf(payload, scrub.speakers);
    const added =
      side === "after"
        ? window.filter((line) => line.p > edge.p)
        : window.filter((line) => line.p < edge.p);

    if (added.length === 0) {
      if (side === "after") {
        scrub.isAtEnd = true;
      } else {
        scrub.isAtStart = true;
      }
    } else {
      merge(scrub, added, side, false);
    }
  }

  host.redraw();
}

/**
 * Moves the loaded run to a moment and puts the playhead on the row
 * nearest to it. Says whether the read worked.
 */
async function load(host: Host, scrub: Scrub, seconds: number): Promise<boolean> {
  if (scrub.busy.seek) {
    return false;
  }

  scrub.busy.seek = true;
  const epoch = scrub.epoch;
  const payload = await windowAt(host, scrub, seconds);

  if (epoch !== scrub.epoch) {
    return false;
  }

  scrub.busy.seek = false;

  if (payload !== undefined) {
    merge(scrub, linesOf(payload, scrub.speakers), "after", true);
    const row = nearest(scrub, seconds);

    if (row !== undefined) {
      send(scrub, row.p);
    }
  }

  host.redraw();

  return payload !== undefined;
}

/**
 * Goes to a moment the person pointed at, then reads on past it so that
 * moving forward from there does not wait.
 */
export async function seek(host: Host, scrub: Scrub, seconds: number): Promise<void> {
  if (await load(host, scrub, seconds)) {
    await extend(host, scrub, "after");
  }
}

/** A guess at the moment of a row that is not loaded, from how fast the loaded rows follow each other. */
function guessed(scrub: Scrub, p: number): number {
  const first = scrub.lines[0];
  const last = scrub.lines.at(-1);

  if (first === undefined || last === undefined) {
    return p * SECONDS_PER_ROW;
  }

  const pace = last.p > first.p ? (last.t - first.t) / (last.p - first.p) : SECONDS_PER_ROW;

  return Math.max(0, last.t + (p - last.p) * pace);
}

/**
 * Puts the playhead where a decision or a commitment was made. A recorded
 * moment is read around directly. A recorded row with no moment is closed in
 * on with a few reads, each guessing from the rows the last one brought; if
 * that does not reach it, the nearest row found stands in and the pane says so.
 */
export async function jump(host: Host, scrub: Scrub, index: number): Promise<void> {
  const mark = scrub.marks[index];

  if (mark === undefined || (mark.p === null && mark.t === null)) {
    return;
  }

  const epoch = scrub.epoch;
  const isLoaded = (): boolean => mark.p !== null && scrub.lines.some((line) => line.p === mark.p);
  const hops = mark.t === null ? MAX_HOPS : 1;

  for (let hop = 0; hop < hops && !isLoaded(); hop += 1) {
    const isRead = await load(host, scrub, mark.t ?? guessed(scrub, mark.p ?? 0));

    if (epoch !== scrub.epoch || !isRead) {
      return;
    }
  }

  const isExact = mark.p === null || isLoaded();

  if (mark.p !== null && isExact) {
    send(scrub, mark.p);
  }

  host.redraw();
  await extend(host, scrub, "after");

  if (!isExact && epoch === scrub.epoch) {
    // Said last: a read that works clears the pane's line.
    scrub.note = INEXACT;
    host.redraw();
  }
}

/**
 * Opens a meeting: its title, its decisions and commitments, and the first
 * window of its transcript in one read, then the window after it.
 */
export async function open(
  host: Host,
  scrub: Scrub,
  id: string,
): Promise<void> {
  startOver(scrub, "meeting");
  const epoch = scrub.epoch;
  const server = await serverOf(host, scrub);

  if (epoch !== scrub.epoch) {
    return;
  }

  if (server === undefined) {
    host.redraw();

    return;
  }

  scrub.busy.seek = true;
  const result = await ask(host, server, "get_meeting", {
    meeting_id: id,
    include: ["decisions", "action_items", "transcript_window"],
    around_seconds: 0,
  });

  if (epoch !== scrub.epoch) {
    return;
  }

  scrub.busy.seek = false;
  const payload = payloadOf(result);
  const head = payload === undefined ? undefined : headOf(payload);

  if (payload === undefined || head === undefined) {
    scrub.note = UNREADABLE;
    host.redraw();

    return;
  }

  scrub.head = head;
  scrub.marks = marksOf(payload);

  // A decision made at a known moment shows the meeting went on at least that long.
  for (const mark of scrub.marks) {
    scrub.end = Math.max(scrub.end, mark.t ?? 0);
  }
  merge(scrub, linesOf(payload, scrub.speakers), "after", true);

  const first = scrub.lines[0];

  if (first === undefined) {
    scrub.note = NO_TRANSCRIPT;
  } else {
    send(scrub, first.p);
  }

  host.redraw();
  await extend(host, scrub, "after");
}

/** Lists the most recent meetings for the person to pick one. */
export async function pick(host: Host, scrub: Scrub): Promise<void> {
  startOver(scrub, "picking");
  const epoch = scrub.epoch;
  const server = await serverOf(host, scrub);

  if (epoch !== scrub.epoch) {
    return;
  }

  if (server !== undefined) {
    scrub.busy.seek = true;
    const text = textOf(await ask(host, server, "get_timeline", { limit: 50 }));

    if (epoch !== scrub.epoch) {
      return;
    }

    scrub.busy.seek = false;
    scrub.recent = text === undefined ? [] : recentIn(text);
    scrub.note =
      text === undefined
        ? NO_ANSWER
        : scrub.recent.length === 0
          ? NO_MEETINGS
          : "";
  }

  host.redraw();
}

/** Rows from a loaded edge at which the plain pane reads the next window. */
const NEAR = 8

/**
 * Moves the plain pane's playhead by a number of rows within what is
 * loaded, and reads the next window when that brings it near a loaded edge.
 */
export function move(host: Host, scrub: Scrub, by: number): void {
  const from = scrub.lines.findIndex(line => line.p === scrub.at)
  const index = Math.min(scrub.lines.length - 1, Math.max(0, (from < 0 ? 0 : from) + by))
  const row = scrub.lines[index]

  if (row === undefined) {
    return
  }

  send(scrub, row.p)
  host.redraw()

  if (scrub.lines.length - 1 - index <= NEAR) {
    void extend(host, scrub, 'after').catch(() => undefined)
  } else if (index <= NEAR) {
    void extend(host, scrub, 'before').catch(() => undefined)
  }
}

/**
 * Puts a short quote of the row at `p`, with who said it, the meeting's
 * reference and the moment, at the cursor of the prompt box. The box is
 * filled, never submitted. The text comes from what the hooks loaded
 * themselves; only the row's position is taken from the caller.
 */
export async function quote(host: Host, scrub: Scrub, p: number): Promise<void> {
  const line = scrub.lines.find(one => one.p === p)

  if (scrub.head === undefined || line === undefined) {
    return
  }

  const isPlaced = await host
    .insert(quoteOf(scrub.head, line, scrub.speakers[line.s] ?? 'unknown'))
    .catch(() => false)

  if (!isPlaced) {
    scrub.note = NO_BOX
    host.redraw()
  }
}
