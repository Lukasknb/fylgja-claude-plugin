/**
 * What the pane holds while it is open, and everything a key does to it.
 *
 * All of it lives in the running plugin's memory and nowhere else: bounded,
 * gone with the process, and dropped when Fylgja asks for sign-in, because
 * the next account may not be allowed to see what this one saw.
 */

import { unitFor } from "./draw-heat";
import { gridOf } from "./grid";
import type { Cell, Grid, Row, Shown } from "./grid";
import type { Host } from "./host";
import * as Links from "./links";
import { fetchMoons, fetchPicture } from "./picture";
import type { Fetched, Picture } from "./picture";
import { drawn } from "./plain";
import { scopeKey } from "./scope";
import type { Scope } from "./scope";
import { skyOf, towards } from "./stars";
import type { Sky, Star } from "./stars";
import type { Entry } from "./timeline";

/** The windows a person steps through with the widen and narrow keys, in days. */
export const WINDOWS: readonly number[] = [14, 42, 91];

/** The most rows a heatmap shows. */
export const MAX_ROWS = 14;

/** The most entries listed under the picture for one cell. */
export const MAX_LISTED = 6;

/** How many scopes' pictures are held; the one not looked at for longest goes first. */
const MAX_HELD = 8;

/** How long the cursor rests on a cell before its entries' links are asked for. */
export const LINK_REST_MS = 500;

const NOTES: Readonly<Record<Exclude<Fetched, { ok: true }>["why"], string>> = {
  "sign-in": "Fylgja needs sign-in: run /mcp, then /pulse again.",
  off: "Fylgja is not connected in this session.",
  project: "Fylgja has no project it can show under that name.",
  timeline: "Fylgja did not answer with a timeline.",
};

export type Pulse = {
  /** The scopes stepped through; the last one is on screen. */
  trail: Scope[];
  /** The window, in days. */
  days: number;
  shown: Shown;
  view: "heat" | "stars";
  /** Whether the picture is drawn as plain text whatever the surface offers. */
  isPlain: boolean;
  /** The heatmap's cursor: a row by its key, and a day. */
  cursor: { rowKey: string | null; day: number };
  /** The constellation's cursor: a node by its key. */
  starKey: string | null;
  /** What is on screen. While the next is fetched it stays, dimmed. */
  picture: Picture | null;
  isLoading: boolean;
  /** One plain line said in the pane: sign-in, a failure, a key that could do nothing. */
  note: string | null;
  /** Counts the fetches started, so an answer that arrives late is not drawn over a newer one. */
  loads: number;
  held: Map<string, Picture>;
  links: Links.Links;
  linkTimer: { cancel: () => void } | undefined;
  /** How wide the pane was when last drawn, in cells: whether six weeks fit by day depends on it. */
  columns: number;
};

export function create(): Pulse {
  return {
    trail: [{ kind: "all" }],
    days: 42,
    shown: "all",
    view: "heat",
    isPlain: false,
    cursor: { rowKey: null, day: 0 },
    starKey: null,
    picture: null,
    isLoading: false,
    note: null,
    loads: 0,
    held: new Map(),
    links: Links.create(),
    linkTimer: undefined,
    columns: 80,
  };
}

export function scopeNow(pulse: Pulse): Scope {
  return pulse.trail[pulse.trail.length - 1] ?? { kind: "all" };
}

/** The heatmap of what is on screen, as the pane draws it. */
export function gridNow(pulse: Pulse): Grid | undefined {
  return pulse.picture === null
    ? undefined
    : gridOf(
        pulse.picture,
        pulse.days,
        unitFor(pulse.days, pulse.columns),
        pulse.shown,
        MAX_ROWS,
      );
}

/** The constellation of what is on screen. */
export function skyNow(pulse: Pulse): Sky | undefined {
  return pulse.picture === null ? undefined : skyOf(pulse.picture, pulse.days);
}

export type At = {
  row: number;
  column: number;
  cell: Cell | undefined;
  line: Row | undefined;
};

/** Where the heatmap's cursor is on `grid`: the first row and the newest column when it names neither. */
export function atOf(pulse: Pulse, grid: Grid): At {
  const found = grid.rows.findIndex((row) => row.key === pulse.cursor.rowKey);
  const row = found < 0 ? 0 : found;
  const within = grid.columns.findIndex(
    (one) => pulse.cursor.day >= one.startDay && pulse.cursor.day <= one.endDay,
  );
  const column = within < 0 ? Math.max(0, grid.columns.length - 1) : within;

  return { row, column, cell: grid.cells[row]?.[column], line: grid.rows[row] };
}

/** Which node the constellation's cursor is on: the first when it names none. */
export function starAt(pulse: Pulse, sky: Sky): number {
  return Math.max(
    0,
    sky.stars.findIndex((star) => star.key === pulse.starKey),
  );
}

/** The entries listed under the picture: the cursor's cell, the lane in view, newest first. */
export function listedOf(pulse: Pulse, cell: Cell | undefined): Entry[] {
  return (cell?.entries ?? []).filter(
    (entry) => pulse.shown === "all" || entry.lane === pulse.shown,
  );
}

function hold(pulse: Pulse, picture: Picture): void {
  const key = scopeKey(picture.scope);

  pulse.held.delete(key);
  pulse.held.set(key, picture);

  for (const oldest of pulse.held.keys()) {
    if (pulse.held.size <= MAX_HELD) {
      break;
    }

    pulse.held.delete(oldest);
  }
}

function forget(pulse: Pulse): void {
  pulse.held.clear();
  pulse.picture = null;
  pulse.links = Links.create();
}

/**
 * Asks for the links of the entries under the cursor once it has rested
 * there, so walking across the picture asks for nothing.
 */
function wantLinks(host: Host, pulse: Pulse): void {
  pulse.linkTimer?.cancel();
  pulse.linkTimer = undefined;

  const grid = pulse.view === "heat" ? gridNow(pulse) : undefined;
  const ids =
    grid === undefined
      ? []
      : listedOf(pulse, atOf(pulse, grid).cell)
          .slice(0, MAX_LISTED)
          .map((entry) => entry.id);

  if (pulse.links.isOff || ids.every((id) => pulse.links.known.has(id))) {
    return;
  }

  pulse.linkTimer = host.after(LINK_REST_MS, () => {
    void Links.learn(host, pulse.links, ids)
      .then((hasLearned) => {
        if (hasLearned) {
          host.redraw();
        }
      })
      .catch(() => undefined);
  });
}

/**
 * Fetches the picture for a scope and window, then puts it on screen.
 *
 * Until it arrives, what is on screen stays exactly as it was, dimmed: the
 * scope, the window and the cursor change only once the new picture is
 * there. A fetch that fails changes nothing but the one line that says why.
 */
async function load(
  host: Host,
  pulse: Pulse,
  want: { trail: Scope[]; days: number },
): Promise<void> {
  const scope = want.trail[want.trail.length - 1] ?? { kind: "all" };
  const turn = (pulse.loads += 1);

  if (pulse.picture === null) {
    // Nothing on screen to keep: the heading names what is being fetched.
    pulse.trail = want.trail;
    pulse.days = want.days;
  }

  pulse.isLoading = true;
  pulse.note = null;
  host.redraw();

  const fetched = await fetchPicture(
    host,
    scope,
    want.days,
    pulse.held.get(scopeKey(scope)),
  ).catch((): Fetched => ({ ok: false, why: "timeline" }));

  if (turn !== pulse.loads) {
    return;
  }

  if (!fetched.ok) {
    pulse.isLoading = false;
    pulse.note = NOTES[fetched.why];

    if (fetched.why === "sign-in") {
      forget(pulse);
    }

    host.redraw();

    return;
  }

  const picture = fetched.picture;

  if (scope.kind === "project" && picture.outline !== null) {
    scope.label = drawn(picture.outline.name, 60);
  }

  if (pulse.view === "stars") {
    await fetchMoons(host, picture).catch(() => undefined);

    if (turn !== pulse.loads) {
      return;
    }
  }

  hold(pulse, picture);

  // The cursor stays where it is when the same scope is drawn again, wider
  // or afresh; another scope starts at its first row and newest column.
  if (
    pulse.picture === null ||
    scopeKey(pulse.picture.scope) !== scopeKey(picture.scope)
  ) {
    pulse.cursor = { rowKey: null, day: picture.untilDay };
    pulse.starKey = null;
  }

  pulse.trail = want.trail;
  pulse.days = want.days;
  pulse.picture = picture;
  pulse.isLoading = false;
  host.redraw();
  wantLinks(host, pulse);
}

/** `/pulse` was typed: this scope, fetched afresh, with nothing stepped through. */
export function show(host: Host, pulse: Pulse, scope: Scope): Promise<void> {
  pulse.held.delete(scopeKey(scope));

  return load(host, pulse, { trail: [scope], days: pulse.days });
}

/** Moves the cursor one cell, or one node, in a direction. Nothing is fetched. */
export function move(host: Host, pulse: Pulse, dx: number, dy: number): void {
  pulse.note = null;

  if (pulse.view === "stars") {
    const sky = skyNow(pulse);

    if (sky !== undefined) {
      pulse.starKey =
        sky.stars[towards(sky.stars, starAt(pulse, sky), dx, dy)]?.key ?? null;
    }
  } else {
    const grid = gridNow(pulse);

    if (grid !== undefined && grid.columns.length > 0) {
      const at = atOf(pulse, grid);
      const row = Math.max(0, Math.min(grid.rows.length - 1, at.row + dy));
      const column = Math.max(
        0,
        Math.min(grid.columns.length - 1, at.column + dx),
      );

      pulse.cursor = {
        rowKey: grid.rows[row]?.key ?? null,
        day: grid.columns[column]?.endDay ?? pulse.cursor.day,
      };
    }
  }

  host.redraw();
  wantLinks(host, pulse);
}

/**
 * Widens (`by` 1) or narrows (`by` -1) the window. A narrower window is
 * drawn at once from what is on screen; a wider one fetches only the days
 * never fetched, and none when they are all held.
 */
export function resize(host: Host, pulse: Pulse, by: number): Promise<void> {
  const at = WINDOWS.indexOf(pulse.days);
  const next =
    WINDOWS[Math.max(0, Math.min(WINDOWS.length - 1, (at < 0 ? 1 : at) + by))] ??
    pulse.days;
  const picture = pulse.picture;

  if (next === pulse.days) {
    return Promise.resolve();
  }

  if (picture !== null && next < pulse.days && !pulse.isLoading) {
    pulse.days = next;
    pulse.note = null;
    pulse.cursor.day = Math.max(pulse.cursor.day, picture.untilDay - next + 1);
    host.redraw();
    wantLinks(host, pulse);

    return Promise.resolve();
  }

  return load(host, pulse, { trail: pulse.trail, days: next });
}

/** Shows one lane, or all of them. */
export function lane(host: Host, pulse: Pulse, shown: Shown): void {
  pulse.shown = shown;
  pulse.note = null;
  host.redraw();
  wantLinks(host, pulse);
}

/**
 * Switches between the heatmap and the constellation. The first time a
 * project's constellation is shown, the children of its largest children
 * are fetched for it.
 */
export async function flip(host: Host, pulse: Pulse): Promise<void> {
  pulse.view = pulse.view === "heat" ? "stars" : "heat";
  pulse.note = null;

  const picture = pulse.picture;

  if (
    pulse.view === "stars" &&
    picture !== null &&
    picture.outline !== null &&
    !picture.hasMoons
  ) {
    const turn = (pulse.loads += 1);

    pulse.isLoading = true;
    host.redraw();
    await fetchMoons(host, picture).catch(() => undefined);

    if (turn !== pulse.loads) {
      return;
    }

    pulse.isLoading = false;
  }

  host.redraw();
  wantLinks(host, pulse);
}

/** Draws the picture as plain text, or as the surface draws pictures. */
export function plain(host: Host, pulse: Pulse): void {
  pulse.isPlain = !pulse.isPlain;
  host.redraw();
}

/** The project the cursor is on, as something to step into; undefined when it is on none. */
export function targetOf(
  pulse: Pulse,
): { ref: string; name: string } | undefined {
  let on: Row | Star | undefined;

  if (pulse.view === "stars") {
    const sky = skyNow(pulse);
    const star = sky?.stars[sky === undefined ? 0 : starAt(pulse, sky)];

    // The node in the middle is the project already on screen.
    on = star?.depth === 0 ? undefined : star;
  } else {
    const grid = gridNow(pulse);

    on = grid === undefined ? undefined : atOf(pulse, grid).line;
  }

  return on === undefined || on.ref === null
    ? undefined
    : { ref: on.ref, name: on.name };
}

/** Steps the whole picture into the project the cursor is on. */
export function stepIn(host: Host, pulse: Pulse): Promise<void> {
  const target = targetOf(pulse);

  if (target === undefined) {
    pulse.note = "The cursor is not on a project to step into.";
    host.redraw();

    return Promise.resolve();
  }

  return load(host, pulse, {
    trail: [
      ...pulse.trail,
      { kind: "project", ref: target.ref, label: target.name },
    ],
    days: pulse.days,
  });
}

/**
 * Steps back up: to where the person stepped in from, or, at the scope
 * `/pulse` was typed with, to the project above it and at last to
 * everything recent.
 */
export function stepUp(host: Host, pulse: Pulse): Promise<void> {
  const scope = scopeNow(pulse);
  const above = pulse.picture?.outline?.path ?? [];
  const parent = above[above.length - 2];
  let trail: Scope[];

  if (pulse.trail.length > 1) {
    trail = pulse.trail.slice(0, -1);
  } else if (scope.kind === "project" && parent !== undefined) {
    trail = [{ kind: "project", ref: parent, label: drawn(parent, 60) }];
  } else if (scope.kind !== "all") {
    trail = [{ kind: "all" }];
  } else {
    pulse.note = "This is the top.";
    host.redraw();

    return Promise.resolve();
  }

  return load(host, pulse, { trail, days: pulse.days });
}

/** Fetches the scope on screen afresh. */
export function refresh(host: Host, pulse: Pulse): Promise<void> {
  pulse.held.delete(scopeKey(scopeNow(pulse)));

  return load(host, pulse, { trail: pulse.trail, days: pulse.days });
}

/** Puts text at the cursor of the prompt box. Nothing is submitted. */
export async function insert(
  host: Host,
  pulse: Pulse,
  text: string,
): Promise<void> {
  const isFilled = await host.insert(text).catch(() => false);

  pulse.note = isFilled ? null : "The prompt box is not taking text right now.";
  host.redraw();
}
