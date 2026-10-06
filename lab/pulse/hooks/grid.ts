/**
 * The heatmap as numbers: which rows, which columns, and what falls in each
 * cell.
 *
 * Rows are places in the project tree and nothing else. An entry is counted
 * under the project it is filed in; who wrote it, who was in the meeting or
 * who ran the session is never read, kept or grouped by.
 */

import type { Picture } from "./picture";
import { drawn } from "./plain";
import { LANES } from "./timeline";
import type { Entry, Lane } from "./timeline";

export type Unit = "day" | "week";

/** One lane, or all of them together. */
export type Shown = Lane | "all";

export type Row = {
  key: string;
  /** The row's name, safe to draw. */
  name: string;
  /** What `open` takes to step into this row: a project's id or its exact name. Null for a row that is no project. */
  ref: string | null;
  /** How much is filed under it in all, when the outline says. */
  filed: number | null;
  lastActivity: string | null;
};

export type Column = { startDay: number; endDay: number };

export type Cell = { counts: Record<Lane, number>; entries: Entry[] };

export type Grid = {
  unit: Unit;
  rows: Row[];
  /** Rows left out because the picture has room for only so many. */
  hidden: number;
  columns: Column[];
  /** `cells[row][column]`. */
  cells: Cell[][];
  /** The largest count any cell shows for the lane, or lanes, in view. */
  max: number;
  /** The largest count of one lane in one cell. */
  maxOfLane: number;
};

const MAX_NAME = 40;
const HERE = "(filed here)";
const ELSEWHERE = "(elsewhere)";
const UNFILED = "(unfiled)";

/** How many entries a cell shows for what is in view. */
export function valueOf(cell: Cell, shown: Shown): number {
  return shown === "all"
    ? LANES.reduce((sum, lane) => sum + cell.counts[lane], 0)
    : cell.counts[shown];
}

/** The lane a cell holds most of; the earlier lane wins a tie. */
export function busiestOf(cell: Cell): Lane {
  return LANES.reduce(
    (best, lane) => (cell.counts[lane] > cell.counts[best] ? lane : best),
    "meeting" as Lane,
  );
}

function isUnder(path: readonly string[], above: readonly string[]): boolean {
  return (
    path.length >= above.length && above.every((name, at) => path[at] === name)
  );
}

/**
 * The row an entry belongs to.
 *
 * In a project's picture that is the child the entry is filed under: the
 * name that follows the project's own path. An entry filed on the project
 * itself has a row of its own, and so has one whose place does not lie
 * under the project or names no child the outline lists. Elsewhere it is
 * the top of the entry's path, or the project a session line names.
 */
function rowOf(entry: Entry, picture: Picture): Row {
  const outline = picture.outline;

  if (outline === null) {
    const name = entry.path?.[0] ?? entry.place;

    return name === null || name === undefined
      ? {
          key: "unfiled",
          name: UNFILED,
          ref: null,
          filed: null,
          lastActivity: null,
        }
      : {
          key: `name:${name}`,
          name: drawn(name, MAX_NAME),
          ref: name,
          filed: null,
          lastActivity: null,
        };
  }

  if (
    entry.path === null ||
    (entry.path.length === outline.path.length &&
      isUnder(entry.path, outline.path))
  ) {
    return {
      key: "here",
      name: HERE,
      ref: null,
      filed: null,
      lastActivity: null,
    };
  }

  const kid = isUnder(entry.path, outline.path)
    ? outline.kids.find((one) => one.name === entry.path?.[outline.path.length])
    : undefined;

  return kid === undefined
    ? {
        key: "elsewhere",
        name: ELSEWHERE,
        ref: null,
        filed: null,
        lastActivity: null,
      }
    : {
        key: kid.id,
        name: drawn(kid.name, MAX_NAME),
        ref: kid.id,
        filed: kid.filed,
        lastActivity: kid.lastActivity,
      };
}

/** The columns of a window of `days` days ending on `untilDay`: one per day, or one per seven days from its start. */
export function columnsOf(
  untilDay: number,
  days: number,
  unit: Unit,
): Column[] {
  const since = untilDay - days + 1;
  const step = unit === "day" ? 1 : 7;
  const columns: Column[] = [];

  for (let start = since; start <= untilDay; start += step) {
    columns.push({
      startDay: start,
      endDay: Math.min(start + step - 1, untilDay),
    });
  }

  return columns;
}

/**
 * The heatmap of `picture` over its last `days` days.
 *
 * In a project's picture every child has a row, the quiet ones too: a row
 * with nothing in it is part of what the picture says. Rows are ordered by
 * how much happened in the window, then by when they were last active, then
 * by name; past `maxRows` the quietest are left out and counted.
 */
export function gridOf(
  picture: Picture,
  days: number,
  unit: Unit,
  shown: Shown,
  maxRows: number,
): Grid {
  const columns = columnsOf(picture.untilDay, days, unit);
  const since = picture.untilDay - days + 1;
  const step = unit === "day" ? 1 : 7;
  const rows = new Map<string, Row>();
  const cells = new Map<string, Cell[]>();
  const blank = (): Cell[] =>
    columns.map(() => ({
      counts: { meeting: 0, session: 0, decision: 0, other: 0 },
      entries: [],
    }));

  for (const kid of picture.outline?.kids ?? []) {
    rows.set(kid.id, {
      key: kid.id,
      name: drawn(kid.name, MAX_NAME),
      ref: kid.id,
      filed: kid.filed,
      lastActivity: kid.lastActivity,
    });
    cells.set(kid.id, blank());
  }

  for (const entry of picture.entries) {
    if (entry.day < since) {
      continue;
    }

    // The server dates an entry in its own time zone, which can be a day
    // ahead of the clock here: such an entry belongs in the newest column,
    // not outside the picture.
    const day = Math.min(entry.day, picture.untilDay);
    const row = rowOf(entry, picture);

    if (!rows.has(row.key)) {
      rows.set(row.key, row);
      cells.set(row.key, blank());
    }

    const cell = cells.get(row.key)?.[Math.floor((day - since) / step)];

    if (cell !== undefined) {
      cell.counts[entry.lane] += 1;
      cell.entries.push(entry);
    }
  }

  const total = (key: string): number =>
    (cells.get(key) ?? []).reduce((sum, cell) => sum + valueOf(cell, shown), 0);
  const ordered = [...rows.values()].sort(
    (a, b) =>
      Number(b.ref !== null) - Number(a.ref !== null) ||
      total(b.key) - total(a.key) ||
      (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "") ||
      a.name.localeCompare(b.name),
  );
  const kept = ordered.slice(0, Math.max(1, maxRows));
  const table = kept.map((row) => cells.get(row.key) ?? blank());
  const flat = table.flat();

  return {
    unit,
    rows: kept,
    hidden: ordered.length - kept.length,
    columns,
    cells: table,
    max: Math.max(0, ...flat.map((cell) => valueOf(cell, shown))),
    maxOfLane: Math.max(
      0,
      ...flat.flatMap((cell) => LANES.map((lane) => cell.counts[lane])),
    ),
  };
}

/** How strongly a count is drawn, 0 (nothing) to 4, against the largest count in view. */
export function levelOf(count: number, max: number): number {
  return count <= 0 || max <= 0
    ? 0
    : Math.max(1, Math.min(4, Math.ceil((count / max) * 4)));
}
