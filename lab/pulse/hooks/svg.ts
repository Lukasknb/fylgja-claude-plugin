/**
 * Draws the heatmap and the constellation as SVG, for the surfaces that
 * have no character raster.
 *
 * An SVG cannot name a key of the person's theme, so the colours are fixed
 * mid-tones that stand apart from a light and from a dark background alike,
 * and how much there is of something is opacity, which blends with whichever
 * background is behind it. Where the surface tells the drawing which scheme
 * is in use, the text and the cursor's outline follow it.
 *
 * Every word that came from a record is escaped here, after it was made
 * safe to draw where it was read.
 */

import { shortOf } from "./days";
import { busiestOf, levelOf, valueOf } from "./grid";
import type { Cell, Grid, Shown } from "./grid";
import { namedOf } from "./draw-stars";
import type { Sky } from "./stars";
import { LANES } from "./timeline";
import { clip, countsOf, spanOf } from "./words";
import type { Lane } from "./timeline";

/** The most characters an `Svg` element takes. */
const MAX_SOURCE = 131_072;

export const SVG_COLORS: Readonly<Record<Lane | "star", string>> = {
  meeting: "#2f7fd6",
  session: "#d9730d",
  decision: "#9b5de5",
  other: "#8a8a8a",
  star: "#c96a2a",
};

const STYLE =
  "<style>text{font:12px ui-sans-serif,system-ui,sans-serif;fill:#767676}.c{fill:none;stroke:#767676;stroke-width:2}" +
  "@media (prefers-color-scheme:dark){text{fill:#c8c8c8}.c{stroke:#c8c8c8}}" +
  "@media (prefers-color-scheme:light){text{fill:#4a4a4a}.c{stroke:#4a4a4a}}</style>";

const OPACITY = ["0", "0.3", "0.55", "0.8", "1"];

export function escaped(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type Drawing = {
  source: string;
  width: number;
  height: number;
  alt: string;
};

function wrap(
  body: string,
  width: number,
  height: number,
  isDimmed: boolean,
): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `${STYLE}<g${isDimmed ? ' opacity="0.35"' : ""}>${body}</g></svg>`
  );
}

function heatBody(
  grid: Grid,
  shown: Shown,
  cursor: { row: number; column: number },
  hasTitles: boolean,
): { body: string; width: number; height: number } {
  const label = 160;
  const count = Math.max(1, grid.columns.length);
  const step = Math.max(10, Math.min(30, Math.floor(560 / count)));
  const size = step - 2;
  const line = 20;
  const top = 22;
  const parts: string[] = [];
  let free = label;

  grid.columns.forEach((column, c) => {
    const x = label + c * step;

    if (x >= free) {
      parts.push(`<text x="${x}" y="13">${shortOf(column.startDay)}</text>`);
      free = x + 40;
    }
  });

  grid.rows.forEach((row, r) => {
    const y = top + r * line;
    const isAt = r === cursor.row;

    parts.push(
      `<text x="0" y="${y + 13}"${isAt ? ' font-weight="bold"' : ""}>${isAt ? "▸ " : ""}${escaped(clip(row.name, 22))}</text>`,
    );

    (grid.cells[r] ?? []).forEach((cell, c) => {
      const x = label + c * step;
      const value = valueOf(cell, shown);
      const title = hasTitles
        ? `<title>${escaped(`${row.name} · ${spanOf(grid.columns[c] ?? { startDay: 0, endDay: 0 })} · ${countsOf(cell)}`)}</title>`
        : "";

      if (value === 0) {
        parts.push(
          `<rect x="${x}" y="${y}" width="${size}" height="${line - 4}" fill="#8a8a8a" fill-opacity="0.12"/>`,
        );
      } else if (
        shown === "all" &&
        size >= 15 &&
        LANES.slice(0, 3).some((lane) => cell.counts[lane] > 0)
      ) {
        // Wide enough to show the three kinds of work side by side.
        const bar = Math.floor(size / 3);
        const bars = LANES.slice(0, 3)
          .map((lane, n) =>
            cell.counts[lane] === 0
              ? ""
              : `<rect x="${x + n * bar}" y="${y}" width="${bar - 1}" height="${line - 4}" fill="${SVG_COLORS[lane]}" fill-opacity="${OPACITY[levelOf(cell.counts[lane], grid.maxOfLane)]}"/>`,
          )
          .join("");

        parts.push(
          `<g>${title}<rect x="${x}" y="${y}" width="${size}" height="${line - 4}" fill-opacity="0"/>${bars}</g>`,
        );
      } else {
        const lane = shown === "all" ? busiestOf(cell) : shown;

        parts.push(
          `<rect x="${x}" y="${y}" width="${size}" height="${line - 4}" fill="${SVG_COLORS[lane]}" fill-opacity="${OPACITY[levelOf(value, grid.max)]}">${title}</rect>`,
        );
      }

      if (isAt && c === cursor.column) {
        parts.push(
          `<rect class="c" x="${x - 1}" y="${y - 1}" width="${size + 2}" height="${line - 2}"/>`,
        );
      }
    });
  });

  return {
    body: parts.join(""),
    width: label + count * step,
    height: top + Math.max(1, grid.rows.length) * line + 4,
  };
}

/**
 * The heatmap as an SVG, or undefined when it would not fit in one.
 *
 * Each cell with something in it carries a title the surface shows on
 * hover; they are the first thing left out when the drawing would be too
 * long.
 */
export function heatSvg(
  grid: Grid,
  shown: Shown,
  cursor: { row: number; column: number },
  isDimmed: boolean,
): Drawing | undefined {
  for (const hasTitles of [true, false]) {
    const { body, width, height } = heatBody(grid, shown, cursor, hasTitles);
    const source = wrap(body, width, height, isDimmed);

    if (source.length <= MAX_SOURCE) {
      const row = grid.rows[cursor.row];
      const cell = grid.cells[cursor.row]?.[cursor.column];

      return {
        source,
        width,
        height,
        alt:
          `Heatmap of ${grid.rows.length} rows over ${grid.columns.length} ${grid.unit}s.` +
          (row !== undefined && cell !== undefined
            ? ` Cursor on ${row.name}: ${countsOf(cell)}.`
            : ""),
      };
    }
  }

  return undefined;
}

/**
 * The constellation as an SVG, or undefined when it would not fit in one.
 * Size is the circle's radius, brightness its opacity; the largest nodes
 * and the one under the cursor are named, every node has a hover title.
 */
export function starSvg(
  sky: Sky,
  cursor: number,
  isDimmed: boolean,
): Drawing | undefined {
  const width = 720;
  const height = 440;
  const largest = Math.max(1, ...sky.stars.map((star) => star.size));
  const named = namedOf(sky);
  const parts: string[] = [];
  const labels: string[] = [];
  const px = (x: number): number => Math.round(40 + x * (width - 80));
  const py = (y: number): number => Math.round(30 + y * (height - 70));

  // A faint line from each node to the one it hangs under, drawn first so
  // every node lies over its lines.
  for (const star of sky.stars) {
    const above = sky.stars.find((one) => one.key === star.under);

    if (above !== undefined) {
      parts.push(
        `<line x1="${px(above.x)}" y1="${py(above.y)}" x2="${px(star.x)}" y2="${py(star.y)}" stroke="#8a8a8a" stroke-opacity="0.45"/>`,
      );
    }
  }

  [...sky.stars.keys()]
    .sort((a, b) => (sky.stars[b]?.size ?? 0) - (sky.stars[a]?.size ?? 0))
    .forEach((n) => {
      const star = sky.stars[n];

      if (star === undefined) {
        return;
      }

      const x = px(star.x);
      const y = py(star.y);
      const radius = Math.round(4 + 30 * Math.sqrt(star.size / largest));
      const facts = `${star.name} · ${star.size} ${sky.isBySize ? "filed" : "in the window"} · last active ${star.lastActivity ?? "never"}`;

      parts.push(
        `<circle cx="${x}" cy="${y}" r="${radius}" fill="${SVG_COLORS.star}" fill-opacity="${OPACITY[star.glow + 1]}"><title>${escaped(facts)}</title></circle>`,
      );

      if (n === cursor) {
        labels.push(
          `<circle class="c" cx="${x}" cy="${y}" r="${radius + 3}"/>`,
        );
      }

      if (n === cursor || named.has(star.key)) {
        labels.push(
          `<text x="${x}" y="${y + radius + 14}" text-anchor="middle"${n === cursor ? ' font-weight="bold"' : ""}>${escaped(clip(star.name, 24))}</text>`,
        );
      }
    });

  const source = wrap(
    parts.join("") + labels.join(""),
    width,
    height,
    isDimmed,
  );
  const at = sky.stars[cursor];

  return source.length > MAX_SOURCE
    ? undefined
    : {
        source,
        width,
        height,
        alt:
          `Constellation of ${sky.stars.length} places.` +
          (at === undefined ? "" : ` Cursor on ${at.name}.`),
      };
}
