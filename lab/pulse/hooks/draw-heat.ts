/**
 * Draws the heatmap on a canvas of character cells: a line of dates, a line
 * marking the cursor's column, then one line per row of the grid.
 */

import { create, put, SHADES, write } from "./canvas";
import type { Canvas, Ink } from "./canvas";
import { shortOf } from "./days";
import { busiestOf, levelOf, valueOf } from "./grid";
import type { Cell, Grid, Shown, Unit } from "./grid";
import type { Lane } from "./timeline";

/** The lines above the first row: dates, and the mark over the cursor's column. */
const HEAD_ROWS = 2;

const ROW_MARK = 0x25b8; // ▸
const COLUMN_MARK = 0x25be; // ▾
const EMPTY = 0xb7; // ·

/** The three lanes a wide cell shows side by side, left to right. */
const SIDE_BY_SIDE: readonly Lane[] = ["meeting", "session", "decision"];

/** A cell this wide shows the three lanes side by side, with a gap after them. */
const WIDE = 4;

export type HeatLayout = {
  /** Cells the row names take, the cursor's mark included. */
  labelWidth: number;
  /** Cells one column of the grid takes. */
  cellWidth: number;
  /** Whether a cell shows meetings, sessions and decisions side by side rather than the busiest of them. */
  isSideBySide: boolean;
};

/**
 * Whether a window is drawn a day or a week to a column: two weeks by day,
 * a quarter by week, six weeks by day when the pane is wide enough for 42
 * columns beside the names and by week when it is not.
 */
export function unitFor(days: number, columns: number): Unit {
  return days <= 14 || (days <= 42 && columns - 14 >= days) ? "day" : "week";
}

/** How the grid fits in `columns` cells: how wide the names and each column are. */
export function layoutOf(
  grid: Grid,
  shown: Shown,
  columns: number,
): HeatLayout {
  const longest = Math.max(
    4,
    ...grid.rows.map((row) => Array.from(row.name).length),
  );
  const count = Math.max(1, grid.columns.length);
  // The names give way before the cells do: a column is at least one cell.
  const labelWidth = Math.max(8, Math.min(longest + 2, 22, columns - count));
  const cellWidth = Math.max(
    1,
    Math.min(WIDE, Math.floor((columns - labelWidth) / count)),
  );

  return {
    labelWidth,
    cellWidth,
    isSideBySide: shown === "all" && cellWidth >= WIDE,
  };
}

function drawCell(
  canvas: Canvas,
  x: number,
  y: number,
  cell: Cell,
  grid: Grid,
  shown: Shown,
  layout: HeatLayout,
  isCursor: boolean,
): void {
  const width = layout.cellWidth > 1 ? layout.cellWidth - 1 : 1;
  const value = valueOf(cell, shown);

  if (isCursor) {
    const shade = SHADES[levelOf(value, grid.max)] ?? 0x20;

    for (let n = 0; n < width; n += 1) {
      put(canvas, x + n, y, shade, "cursor");
    }

    return;
  }

  if (value === 0) {
    put(canvas, x + Math.floor((width - 1) / 2), y, EMPTY, "dim");

    return;
  }

  if (
    layout.isSideBySide &&
    SIDE_BY_SIDE.some((lane) => cell.counts[lane] > 0)
  ) {
    SIDE_BY_SIDE.forEach((lane, n) => {
      const level = levelOf(cell.counts[lane], grid.maxOfLane);

      if (level > 0) {
        put(canvas, x + n, y, SHADES[level] ?? 0x20, lane);
      }
    });

    return;
  }

  const ink: Ink = shown === "all" ? busiestOf(cell) : shown;
  const shade = SHADES[levelOf(value, grid.max)] ?? 0x20;

  for (let n = 0; n < width; n += 1) {
    put(canvas, x + n, y, shade, ink);
  }
}

/**
 * The heatmap on a canvas `columns` cells wide.
 *
 * How much happened is the density of the shade (`░▒▓█`), which blends
 * with the terminal's own background; which kind of work it was is the
 * colour, and in a wide cell also the position (meetings, sessions,
 * decisions from left to right). The cursor's cell has a background of its
 * own, its row and column are marked on the axes, and rows with nothing in
 * the window are named in the dim ink.
 */
export function heatCanvas(
  grid: Grid,
  shown: Shown,
  cursor: { row: number; column: number },
  columns: number,
): Canvas {
  const layout = layoutOf(grid, shown, columns);
  const width = Math.min(
    512,
    layout.labelWidth + grid.columns.length * layout.cellWidth,
  );
  const canvas = create(
    width,
    Math.min(256, HEAD_ROWS + Math.max(1, grid.rows.length)),
  );
  let free = layout.labelWidth;

  grid.columns.forEach((column, n) => {
    const x = layout.labelWidth + n * layout.cellWidth;

    // A date where there is room for one, so the axis never runs together.
    if (x >= free && x + 5 <= canvas.columns) {
      write(canvas, x, 0, shortOf(column.startDay), "dim", 5);
      free = x + 6;
    }

    if (n === cursor.column) {
      put(canvas, x, 1, COLUMN_MARK, "text");
    }
  });

  if (grid.rows.length === 0) {
    write(canvas, 1, HEAD_ROWS, "nothing here", "dim", canvas.columns - 1);
  }

  grid.rows.forEach((row, r) => {
    const y = HEAD_ROWS + r;
    const cells = grid.cells[r] ?? [];
    const isQuiet = cells.every((cell) => valueOf(cell, shown) === 0);

    if (r === cursor.row) {
      put(canvas, 0, y, ROW_MARK, "text");
    }

    write(
      canvas,
      1,
      y,
      row.name,
      isQuiet && r !== cursor.row ? "dim" : "text",
      layout.labelWidth - 2,
    );

    cells.forEach((cell, c) => {
      drawCell(
        canvas,
        layout.labelWidth + c * layout.cellWidth,
        y,
        cell,
        grid,
        shown,
        layout,
        r === cursor.row && c === cursor.column,
      );
    });
  });

  return canvas;
}
