/**
 * The timeline as a still picture, for where no interactive timeline is
 * drawn: a strip of cells in the terminal, a small vector image elsewhere.
 * One slice of time per cell, coloured by who was speaking.
 */

import { clock } from "./quote";
import type { Scrub } from "./scrub";

/** One colour per speaker: mid-tone, so each reads on a dark and on a light theme. */
const COLOURS = [
  0x3b82f6, 0xd97706, 0x10b981, 0xdb2777, 0x8b5cf6, 0x0891b2, 0xdc2626,
  0x65a30d,
];
const GREY = 0x808080;
const AMBER = 0xd97706;
/** A cell colour that means "the terminal's own default". */
const DEFAULT = 0x01000000;

export type Cell = {
  /** Who was speaking in this slice of time, or -1 where nothing is loaded. */
  speaker: number;
  isPlayhead: boolean;
  /** Whether a decision or a commitment was made in this slice. */
  isMarked: boolean;
};

/** The loaded part of the meeting laid out over `columns` cells, from the start to the latest moment seen. */
export function cellsOf(scrub: Scrub, columns: number): Cell[] {
  const end = Math.max(1, scrub.end);
  const cellOf = (seconds: number): number =>
    Math.min(columns - 1, Math.max(0, Math.floor((seconds / end) * columns)));
  const cells: Cell[] = Array.from({ length: columns }, () => ({
    speaker: -1,
    isPlayhead: false,
    isMarked: false,
  }));

  scrub.lines.forEach((line, i) => {
    const from = cellOf(line.t);
    const next = scrub.lines[i + 1];
    const to = next === undefined ? from : Math.max(from, cellOf(next.t) - 1);

    for (let at = from; at <= to; at += 1) {
      const cell = cells[at];

      if (cell !== undefined) {
        cell.speaker = line.s;
      }
    }

    const own = cells[from];

    if (own !== undefined && line.p === scrub.at) {
      own.isPlayhead = true;
    }
  });

  for (const mark of scrub.marks) {
    const moment = mark.t ?? scrub.lines.find((line) => line.p === mark.p)?.t;
    const cell = moment === undefined ? undefined : cells[cellOf(moment)];

    if (cell !== undefined) {
      cell.isMarked = true;
    }
  }

  return cells;
}

function colourOf(speaker: number): number {
  return COLOURS[speaker % COLOURS.length] ?? GREY;
}

/**
 * The strip as terminal cells, two rows: the speakers' bands with the
 * playhead, and the marks under them. Packed the way a cell grid is
 * handed over: three little-endian 32-bit numbers per cell (character,
 * foreground, background), base64.
 */
export function rasterOf(cells: readonly Cell[]): string {
  const bytes = new Uint8Array(cells.length * 2 * 12);
  const data = new DataView(bytes.buffer);
  const put = (at: number, char: string, colour: number): void => {
    data.setUint32(at * 12, char.codePointAt(0) ?? 0x20, true);
    data.setUint32(at * 12 + 4, colour, true);
    data.setUint32(at * 12 + 8, DEFAULT, true);
  };

  cells.forEach((cell, i) => {
    if (cell.isPlayhead) {
      put(i, "┃", DEFAULT);
    } else if (cell.speaker < 0) {
      put(i, "┄", GREY);
    } else {
      put(i, "▆", colourOf(cell.speaker));
    }

    put(cells.length + i, cell.isMarked ? "◆" : " ", AMBER);
  });

  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function hex(colour: number): string {
  return `#${colour.toString(16).padStart(6, "0")}`;
}

/** The strip as a vector image. It holds shapes and colours only: no text from any record. */
export function svgOf(cells: readonly Cell[]): string {
  const unit = 6;
  const shapes: string[] = [];

  cells.forEach((cell, i) => {
    const x = i * unit;

    shapes.push(
      cell.speaker < 0
        ? `<rect x="${x}" y="9" width="${unit}" height="2" fill="${hex(GREY)}" opacity="0.5"/>`
        : `<rect x="${x}" y="4" width="${unit}" height="12" fill="${hex(colourOf(cell.speaker))}"/>`,
    );

    if (cell.isMarked) {
      shapes.push(
        `<path d="M${x + 3} 18 l3 4 l-3 4 l-3 -4 z" fill="${hex(AMBER)}"/>`,
      );
    }

    if (cell.isPlayhead) {
      shapes.push(
        `<rect x="${x + 2}" y="0" width="2" height="20" fill="${hex(GREY)}"/>`,
      );
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cells.length * unit} 28" width="${cells.length * unit}" height="28">${shapes.join("")}</svg>`;
}

/** What the picture shows, in words, for where it cannot be seen. */
export function altOf(scrub: Scrub): string {
  const now = scrub.lines.find((line) => line.p === scrub.at);

  return `Timeline: playhead at ${clock(now?.t ?? 0)} of ${scrub.isAtEnd ? "" : "at least "}${clock(scrub.end)}`;
}
