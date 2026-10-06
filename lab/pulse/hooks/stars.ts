/**
 * The constellation as numbers: one node per place in the project tree,
 * its size how much is filed under it, its brightness how recently it was
 * active, and where it sits.
 *
 * Nodes are projects only. Nothing here reads, counts or places people.
 */

import { dayOf } from "./days";
import { gridOf, valueOf } from "./grid";
import type { Child } from "./outline";
import type { Picture } from "./picture";
import { drawn } from "./plain";

export type Star = {
  key: string;
  /** Safe to draw. */
  name: string;
  /** What `open` takes to step into it; null for a node that is no project. */
  ref: string | null;
  /** 0 the project itself, 1 its children, 2 their children. */
  depth: 0 | 1 | 2;
  /** How much is filed under it; in a picture without an outline, how much happened in the window. */
  size: number;
  /** How many children of its own it has, when known. */
  children: number | null;
  lastActivity: string | null;
  /** 0 (quiet for more than a quarter, or never active) to 3 (active in the last week). */
  glow: number;
  /** The key of the node it hangs under; null for the middle, and where there is no middle. */
  under: string | null;
  /** Where it sits, each from 0 to 1 across the picture. */
  x: number;
  y: number;
};

export type Sky = {
  stars: Star[];
  /** Children, or children of children, that exist and are not drawn. */
  unseen: number;
  /** Whether size means records filed in all (true) or entries in the window (false). */
  isBySize: boolean;
};

const MAX_NAME = 40;

/** No more children than this are placed around the centre. */
const MAX_RING = 24;

/** No more children of one child than this are placed around it. */
const MAX_AROUND = 6;

/** How recently `lastActivity` was, as a brightness. */
export function glowOf(lastActivity: string | null, today: number): number {
  const day = lastActivity === null ? undefined : dayOf(lastActivity);

  if (day === undefined) {
    return 0;
  }

  const age = today - day;

  return age <= 7 ? 3 : age <= 30 ? 2 : age <= 90 ? 1 : 0;
}

function starOf(
  child: Child,
  depth: 0 | 1 | 2,
  today: number,
  x: number,
  y: number,
  under: string | null,
): Star {
  return {
    key: child.id,
    name: drawn(child.name, MAX_NAME),
    ref: child.id,
    depth,
    size: child.filed,
    children: child.children,
    lastActivity: child.lastActivity,
    glow: glowOf(child.lastActivity, today),
    under,
    x,
    y,
  };
}

/**
 * Where the n-th of `count` nodes sits on the ring around the centre,
 * starting at the top and going clockwise. A crowded ring alternates
 * between two distances so neighbours do not sit on each other.
 */
function onRing(
  n: number,
  count: number,
): { x: number; y: number; angle: number } {
  const angle = -Math.PI / 2 + (2 * Math.PI * n) / Math.max(1, count);
  const reach = count > 10 && n % 2 === 1 ? 0.2 : 0.3;

  return {
    x: 0.5 + reach * Math.cos(angle),
    y: 0.5 + reach * Math.sin(angle),
    angle,
  };
}

/**
 * The constellation of a picture.
 *
 * For a project: the project in the middle, its children around it with the
 * largest at the top, and the children of the largest children as small
 * nodes on their far side. Without a project (everything recent, or a
 * repository) there are no filed totals to read, so the nodes are the
 * projects that had activity in the window and size is that activity.
 */
export function skyOf(picture: Picture, days: number): Sky {
  const today = picture.untilDay;
  const outline = picture.outline;

  if (outline === null) {
    const grid = gridOf(picture, days, "day", "all", MAX_RING);
    const stars = grid.rows.map((row, n): Star => {
      const cells = grid.cells[n] ?? [];
      const last = cells
        .flatMap((cell) => cell.entries)
        .reduce((best, entry) => (entry.date > best ? entry.date : best), "");
      const spot = onRing(n, grid.rows.length);

      return {
        key: row.key,
        name: row.name,
        ref: row.ref,
        depth: 1,
        size: cells.reduce((sum, cell) => sum + valueOf(cell, "all"), 0),
        children: null,
        under: null,
        lastActivity: last === "" ? null : last,
        glow: glowOf(last === "" ? null : last, today),
        x: spot.x,
        y: spot.y,
      };
    });

    return { stars, unseen: grid.hidden, isBySize: false };
  }

  const ring = [...outline.kids]
    .sort((a, b) => b.filed - a.filed || a.name.localeCompare(b.name))
    .slice(0, MAX_RING);
  const stars: Star[] = [starOf(outline, 0, today, 0.5, 0.5, null)];
  let unseen = outline.kids.length - ring.length + outline.unlisted;

  ring.forEach((kid, n) => {
    const spot = onRing(n, ring.length);

    stars.push(starOf(kid, 1, today, spot.x, spot.y, outline.id));

    const under = picture.moons.get(kid.id);

    if (under === undefined) {
      unseen += kid.children;

      return;
    }

    const around = under.slice(0, MAX_AROUND);
    unseen += Math.max(0, kid.children - around.length);

    around.forEach((moon, m) => {
      // A fan on the side facing away from the centre.
      const angle = spot.angle + (m - (around.length - 1) / 2) * 0.5;

      stars.push(
        starOf(
          moon,
          2,
          today,
          spot.x + 0.17 * Math.cos(angle),
          spot.y + 0.17 * Math.sin(angle),
          kid.id,
        ),
      );
    });
  });

  return { stars, unseen, isBySize: true };
}

/**
 * The node to move the cursor to from `from` in a direction: the nearest
 * one that lies that way, with distance across the direction counted
 * double so the cursor keeps to a line. The same node when none lies there.
 */
export function towards(
  stars: readonly Star[],
  from: number,
  dx: number,
  dy: number,
): number {
  const here = stars[from];

  if (here === undefined) {
    return 0;
  }

  let best = from;
  let bestCost = Infinity;

  stars.forEach((star, n) => {
    const along = (star.x - here.x) * dx + (star.y - here.y) * dy;
    const across =
      Math.abs((star.x - here.x) * dy) + Math.abs((star.y - here.y) * dx);

    if (n !== from && along > 0.001 && along + 2 * across < bestCost) {
      best = n;
      bestCost = along + 2 * across;
    }
  });

  return best;
}
