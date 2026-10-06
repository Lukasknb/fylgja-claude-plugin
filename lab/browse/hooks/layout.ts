/**
 * How many body rows each thing takes, decided before anything is drawn, so
 * the list is cut to exactly what the site can show. Every line drawn is one
 * row: text is wrapped here, never by the surface.
 */

import { isDetail } from "./detail";
import type { DetailState } from "./detail";
import type { Row } from "./records";
import { TABS } from "./model";
import { tokenKindOf } from "./reference";

/** How far an expanded row's detail is set in from the row. */
export const INDENT = 2;

const TEXT_ROWS_MAX = 3;
const CHILDREN_MAX = 6;

/** The width the three actions need to stand on one line. */
const ACTIONS_WIDTH = 44;

function width(text: string): number {
  return Array.from(text).length;
}

/** `text` cut to `max` characters, the cut marked. */
export function fit(text: string, max: number): string {
  const chars = Array.from(text);

  return chars.length <= max
    ? text
    : `${chars.slice(0, Math.max(1, max - 1)).join("")}…`;
}

/**
 * `paragraphs` broken at spaces into rows of at most `columns` characters,
 * at most `max` rows; the last row ends in `…` when text was left out.
 */
export function wrap(
  paragraphs: readonly string[],
  columns: number,
  max: number,
): string[] {
  const room = Math.max(8, columns);
  const rows: string[] = [];
  let isShort = false;

  for (const paragraph of paragraphs) {
    let row = "";

    for (const word of paragraph.split(" ")) {
      const next = row === "" ? word : `${row} ${word}`;

      if (width(next) <= room) {
        row = next;
      } else {
        if (row !== "") {
          rows.push(row);
        }

        row = fit(word, room);
      }
    }

    if (row !== "") {
      rows.push(row);
    }
  }

  if (rows.length > max) {
    isShort = true;
    rows.length = max;
  }

  const last = rows.at(-1);

  if (isShort && last !== undefined) {
    rows[rows.length - 1] = `${fit(last, room - 1).replace(/…$/, "")}…`;
  }

  return rows;
}

/** What an expanded row shows under itself, row by row. */
export type DetailPlan = {
  texts: { text: string; isDim: boolean }[];
  children: Row[];
  /** The link that opens the record in the app, when the server gave one. */
  link: string | undefined;
  /** Whether this kind of record has a reference the prompt box can take. */
  canInsert: boolean;
  /** Whether the actions stand on one line or, in a narrow site, on two. */
  actionRows: 1 | 2;
  /** How many body rows all of it takes. */
  rows: number;
};

const PROBLEM_TEXT = {
  "signed-out": "sign in with /mcp to read this",
  "rate-limited": "rate limited: try again shortly",
  off: "Fylgja is not connected",
  failed: "this record could not be read",
} as const;

export function detailPlan(
  row: Row,
  state: DetailState | undefined,
  columns: number,
): DetailPlan {
  const inner = Math.max(8, columns - INDENT);
  const texts: DetailPlan["texts"] = [];
  let children: Row[] = [];

  if (state === undefined || state === "loading") {
    texts.push({ text: "reading…", isDim: true });
  } else if (!isDetail(state)) {
    texts.push({ text: PROBLEM_TEXT[state.kind], isDim: true });
  } else {
    texts.push(
      ...wrap(state.lines, inner, TEXT_ROWS_MAX).map((text) => ({
        text,
        isDim: false,
      })),
    );

    if (state.counts !== "") {
      texts.push({ text: fit(state.counts, inner), isDim: true });
    }

    children = state.children.slice(0, CHILDREN_MAX);

    const left = state.children.length - children.length;

    if (left > 0 || state.isCut) {
      texts.push({
        text:
          left > 0
            ? `and ${left} more: step in to list them`
            : "cut short by the server",
        isDim: true,
      });
    }
  }

  const actionRows = inner >= ACTIONS_WIDTH ? 1 : 2;

  return {
    texts,
    children,
    link: (isDetail(state) ? state.link : undefined) ?? row.link,
    canInsert: tokenKindOf(row.kind) !== undefined,
    actionRows,
    rows: texts.length + children.length + actionRows,
  };
}

/** How many rows the tabs take: one, or more where the site is too narrow for them side by side. */
export function tabRows(columns: number): { rows: number; isShort: boolean } {
  // A tab is drawn as its hotkey, a colon, a space and its label, with one column between tabs.
  const across = (pick: "label" | "short"): number =>
    TABS.reduce((sum, tab) => sum + 3 + tab[pick].length, 0) + TABS.length - 1;

  if (across("label") <= columns) {
    return { rows: 1, isShort: false };
  }

  return {
    rows: Math.max(1, Math.ceil(across("short") / Math.max(1, columns))),
    isShort: true,
  };
}

/** The rows `[top, end)` that fit in `room` body rows, when row `i` takes `cost(i)` of them. */
export function windowOf(
  count: number,
  top: number,
  room: number,
  cost: (index: number) => number,
): { top: number; end: number } {
  const first = Math.max(0, Math.min(top, count - 1));
  let used = 0;
  let end = first;

  while (end < count && (end === first || used + cost(end) <= room)) {
    used += cost(end);
    end += 1;
  }

  return { top: first, end };
}

/**
 * The first row to draw so that row `index` is in view, moved as little as
 * possible from `top`.
 */
export function reveal(
  count: number,
  top: number,
  room: number,
  cost: (index: number) => number,
  index: number,
): number {
  let first = Math.max(0, Math.min(top, index));

  while (first < index && windowOf(count, first, room, cost).end <= index) {
    first += 1;
  }

  return first;
}
