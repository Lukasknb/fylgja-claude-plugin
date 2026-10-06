/**
 * Draws the constellation on a canvas of character cells.
 */

import { create, put, SHADES, write } from "./canvas";
import type { Canvas } from "./canvas";
import type { Sky, Star } from "./stars";

/** How many of the largest nodes are named on the picture; the rest are named when the cursor is on them. */
export const NAMED = 5;

const MAX_LABEL = 16;

/** A character cell is about twice as tall as it is wide; a node is drawn half as many rows as columns. */
const widthOf = (star: Star, largest: number): number =>
  largest <= 0 ? 1 : 1 + Math.round(6 * Math.sqrt(star.size / largest));

/** The keys of the nodes that are named on the picture: the largest few. */
export function namedOf(sky: Sky): Set<string> {
  return new Set(
    [...sky.stars]
      .sort((a, b) => b.size - a.size)
      .slice(0, NAMED)
      .map((star) => star.key),
  );
}

/**
 * The constellation on a canvas `columns` by `rows` cells.
 *
 * A node is a filled oval: its width grows with the square root of what is
 * filed under it, and its shade is how recently it was active, from full
 * (the last week) to light (quiet for more than a quarter). The largest
 * nodes are drawn first so a small one is never hidden under a large one.
 * The node under the cursor stands between brackets and is always named.
 */
export function starCanvas(
  sky: Sky,
  cursor: number,
  columns: number,
  rows: number,
): Canvas {
  const canvas = create(Math.min(512, columns), Math.min(256, rows));
  const largest = Math.max(0, ...sky.stars.map((star) => star.size));
  const named = namedOf(sky);
  const order = sky.stars
    .map((star, n) => ({ star, n }))
    .sort((a, b) => b.star.size - a.star.size);
  // A margin keeps a node at the edge on the canvas.
  const cx = (star: Star): number =>
    2 + Math.round(star.x * (canvas.columns - 5));
  const cy = (star: Star): number => 1 + Math.round(star.y * (canvas.rows - 4));

  if (sky.stars.length === 0) {
    write(canvas, 1, 0, "nothing here", "dim", canvas.columns - 1);

    return canvas;
  }

  for (const { star } of order) {
    const width = widthOf(star, largest);
    const height = Math.max(1, Math.round(width / 2));
    const shade = SHADES[star.glow + 1] ?? 0x2591;

    for (let dy = 0; dy < height; dy += 1) {
      for (let dx = 0; dx < width; dx += 1) {
        const u = width === 1 ? 0 : (dx - (width - 1) / 2) / (width / 2);
        const v = height === 1 ? 0 : (dy - (height - 1) / 2) / (height / 2);

        if (u * u + v * v <= 1) {
          put(
            canvas,
            cx(star) - Math.floor(width / 2) + dx,
            cy(star) - Math.floor(height / 2) + dy,
            shade,
            "star",
          );
        }
      }
    }
  }

  // Names go on last, the cursor's last of all, so nothing is drawn over them.
  const labelled = order.filter(
    ({ star, n }) => n !== cursor && named.has(star.key),
  );
  const pointed = order.filter(({ n }) => n === cursor);

  for (const { star, n } of [...labelled, ...pointed]) {
    const width = widthOf(star, largest);
    const left = cx(star) - Math.floor(width / 2);
    const length = Math.min(MAX_LABEL, Array.from(star.name).length);
    // Beside the node, on its middle row: rows are scarce and a name under
    // a node would sit on the node below it. Left of it at the right edge.
    const gap = n === cursor ? 2 : 1;
    const right = left + width + gap;
    const x =
      right + length <= canvas.columns
        ? right
        : Math.max(0, left - gap - length);

    if (n === cursor) {
      put(canvas, left - 1, cy(star), 0x5b, "text");
      put(canvas, left + width, cy(star), 0x5d, "text");
    }

    write(canvas, x, cy(star), star.name, n === cursor ? "text" : "dim", MAX_LABEL);
  }

  return canvas;
}
