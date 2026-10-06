/**
 * A grid of character cells a picture is drawn on once and shown two ways:
 * as a terminal `Raster` (one leaf, a colour pair per cell) or as rows of
 * styled text made of the same characters.
 *
 * A cell holds a character and an ink. An ink is a meaning, not a colour:
 * the text rows turn it into a key of the person's theme, the raster into a
 * fixed colour chosen to read on a light and on a dark background alike.
 */

export type Ink =
  | "text"
  | "dim"
  | "meeting"
  | "session"
  | "decision"
  | "other"
  | "star"
  | "cursor";

const INKS: readonly Ink[] = [
  "text",
  "dim",
  "meeting",
  "session",
  "decision",
  "other",
  "star",
  "cursor",
];

export type Canvas = {
  columns: number;
  rows: number;
  /** One code point per cell, row by row. */
  points: Uint32Array;
  /** One ink per cell, as its place in the list of inks. */
  inks: Uint8Array;
};

const SPACE = 0x20;

/** The terminal's own colour, for the raster: whatever the person's theme makes it. */
const DEFAULT = 0x01000000;

/**
 * Raster colours. Each has a luminance between that of a light and a dark
 * terminal background, so it stands at least 3:1 from both; how much there
 * is of something is drawn with shade characters, which blend with whatever
 * background the terminal has.
 */
export const RASTER_COLORS: Readonly<
  Record<Exclude<Ink, "text" | "cursor">, number>
> = {
  dim: 0x8a8a8a,
  meeting: 0x2f7fd6,
  session: 0xd9730d,
  decision: 0x9b5de5,
  other: 0x8a8a8a,
  star: 0xc96a2a,
};

/** The cell under the cursor: white on mid grey, which neither a light nor a dark background is. */
const CURSOR_PAIR = { fg: 0xffffff, bg: 0x767676 };

/** The theme key each ink is drawn with as text, so the rows follow the person's theme. */
export const THEME_KEYS: Readonly<Record<Ink, string | undefined>> = {
  text: undefined,
  dim: "inactive",
  meeting: "suggestion",
  session: "claude",
  decision: "merged",
  other: "inactive",
  star: "claude",
  cursor: undefined,
};

/** The shade for a strength of 1 to 4: light, medium, dark, full. */
export const SHADES: readonly number[] = [
  SPACE,
  0x2591,
  0x2592,
  0x2593,
  0x2588,
];

export function create(columns: number, rows: number): Canvas {
  const size = Math.max(1, columns) * Math.max(1, rows);

  return {
    columns: Math.max(1, columns),
    rows: Math.max(1, rows),
    points: new Uint32Array(size).fill(SPACE),
    inks: new Uint8Array(size),
  };
}

/** Puts one of this plugin's own drawing characters in a cell; outside the canvas nothing happens. */
export function put(
  canvas: Canvas,
  x: number,
  y: number,
  point: number,
  ink: Ink,
): void {
  if (x < 0 || y < 0 || x >= canvas.columns || y >= canvas.rows) {
    return;
  }

  canvas.points[y * canvas.columns + x] = point;
  canvas.inks[y * canvas.columns + x] = INKS.indexOf(ink);
}

/**
 * Whether a character from a record's name can stand in a cell: a raster
 * refuses the whole picture for one character that is not a single column
 * wide. Latin, Greek and Cyrillic letters, digits and plain punctuation
 * are; everything else is drawn as `?`.
 */
function isCellSafe(point: number): boolean {
  return (
    (point >= 0x20 && point <= 0x7e) ||
    (point >= 0xa1 && point <= 0x24f && point !== 0xad) ||
    (point >= 0x391 && point <= 0x3c9 && point !== 0x3a2) ||
    (point >= 0x410 && point <= 0x44f) ||
    point === 0x2026
  );
}

/**
 * Writes text from left to right starting at a cell, at most `max` cells,
 * ending in `…` when it is longer. Returns how many cells it took.
 */
export function write(
  canvas: Canvas,
  x: number,
  y: number,
  text: string,
  ink: Ink,
  max: number,
): number {
  const points = Array.from(text, (char) => char.codePointAt(0) ?? SPACE);
  const room = Math.max(0, Math.min(max, canvas.columns - x));
  const fits = points.length <= room;
  const taken = fits ? points : points.slice(0, Math.max(0, room - 1));

  taken.forEach((point, n) =>
    put(canvas, x + n, y, isCellSafe(point) ? point : 0x3f, ink),
  );

  if (!fits && room > 0) {
    put(canvas, x + taken.length, y, 0x2026, ink);
  }

  return fits ? taken.length : room;
}

function base64Of(bytes: Uint8Array): string {
  let binary = "";

  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }

  return btoa(binary);
}

/**
 * The canvas as a raster's `cells`: base64 of one little-endian
 * `[code point, foreground, background]` triplet of 32-bit words per cell.
 * Dimmed, every ink is drawn in the one grey: an old picture shown while
 * the next is fetched.
 */
export function cellsOf(canvas: Canvas, isDimmed: boolean): string {
  const bytes = new Uint8Array(canvas.points.length * 12);
  const view = new DataView(bytes.buffer);

  canvas.points.forEach((point, n) => {
    const ink = INKS[canvas.inks[n] ?? 0] ?? "text";
    const isCursor = ink === "cursor";
    const fg = isCursor
      ? CURSOR_PAIR.fg
      : ink === "text"
        ? DEFAULT
        : isDimmed
          ? RASTER_COLORS.dim
          : RASTER_COLORS[ink];

    view.setUint32(n * 12, point, true);
    view.setUint32(n * 12 + 4, fg, true);
    view.setUint32(n * 12 + 8, isCursor ? CURSOR_PAIR.bg : DEFAULT, true);
  });

  return base64Of(bytes);
}

export type Run = { text: string; ink: Ink };

/** The canvas as rows of text, each row cut into runs of one ink. */
export function runsOf(canvas: Canvas): Run[][] {
  const rows: Run[][] = [];

  for (let y = 0; y < canvas.rows; y += 1) {
    const runs: Run[] = [];

    for (let x = 0; x < canvas.columns; x += 1) {
      const at = y * canvas.columns + x;
      const point = canvas.points[at] ?? SPACE;
      const own = INKS[canvas.inks[at] ?? 0] ?? "text";
      const before = runs[runs.length - 1]?.ink;
      // A blank cell has no colour of its own and joins the run before it,
      // unless either is the cursor, which is drawn by its background.
      const ink =
        point === SPACE &&
        own !== "cursor" &&
        before !== undefined &&
        before !== "cursor"
          ? before
          : own;
      const last = runs[runs.length - 1];

      if (last !== undefined && last.ink === ink) {
        last.text += String.fromCodePoint(point);
      } else {
        runs.push({ text: String.fromCodePoint(point), ink });
      }
    }

    rows.push(runs);
  }

  return rows;
}
