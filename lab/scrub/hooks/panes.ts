/**
 * What the pane draws when it is not the interactive timeline: one plain
 * line, the list of recent meetings to pick from, and the plain view of a
 * meeting with buttons, for a surface where the interactive timeline is
 * not available or failed.
 */

import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  RasterProps,
  RenderElement,
  SvgProps,
  TextProps,
} from "claude-code";

import { clock } from "./quote";
import type { Scrub } from "./scrub";
import { altOf, cellsOf, rasterOf, svgOf } from "./strip";

/** The elements this file draws with. A surface has either the cell grid or the vector image, or neither. */
export type Kit = {
  Box: ElementConstructor<BoxProps>;
  Text: ElementConstructor<TextProps>;
  Button: ElementConstructor<ButtonProps>;
  Raster?: ElementConstructor<RasterProps>;
  Svg?: ElementConstructor<SvgProps>;
};

/** What the plain view's buttons do. */
export type Actions = {
  move: (by: number) => void;
  quote: () => void;
  jump: (mark: number) => void;
};

/** Rows one press of "earlier" or "later" moves: half of what one read brings. */
const WINDOW = 20;
/** One colour per speaker, the same as on the interactive timeline. */
const COLOURS = [
  "#3b82f6",
  "#d97706",
  "#10b981",
  "#db2777",
  "#8b5cf6",
  "#0891b2",
  "#dc2626",
  "#65a30d",
];
const MAX_MARK_BUTTONS = 6;

export function lineTree(kit: Kit, text: string): RenderElement {
  return kit.Text({ dimColor: true, children: [text] });
}

/** The recent meetings, one button each; a digit picks one while the pane has the keys. */
export function pickerTree(
  kit: Kit,
  scrub: Scrub,
  onPick: (id: string) => void,
): RenderElement {
  const { Box, Text, Button } = kit;

  if (scrub.recent.length === 0) {
    return lineTree(
      kit,
      scrub.note !== "" ? scrub.note : "Looking for recent meetings…",
    );
  }

  return Box({
    flexDirection: "column",
    children: [
      Text({
        dimColor: true,
        children: ["Recent meetings. Pick one to scrub through:"],
      }),
      ...scrub.recent.map((meeting, i) =>
        Button({
          key: `pick-${meeting.id}`,
          label: `${meeting.date}  ${meeting.title}`,
          hotkey: String(i + 1),
          plain: true,
          onPress: () => onPick(meeting.id),
        }),
      ),
    ],
  });
}

function stripTree(
  kit: Kit,
  scrub: Scrub,
  columns: number,
): RenderElement | undefined {
  const cells = cellsOf(scrub, Math.min(columns, 200));

  if (kit.Raster !== undefined) {
    return kit.Raster({
      key: "strip",
      columns: cells.length,
      rows: 2,
      cells: rasterOf(cells),
    });
  }

  return kit.Svg === undefined
    ? undefined
    : kit.Svg({ source: svgOf(cells), alt: altOf(scrub), height: 28 });
}

/**
 * A meeting without the interactive timeline: the strip as a still picture,
 * the rows around the playhead, and buttons to move by a row or by a window,
 * to quote the row at the playhead and to go to a decision.
 */
export function plainTree(
  kit: Kit,
  scrub: Scrub,
  columns: number,
  rows: number,
  actions: Actions,
): RenderElement {
  const { Box, Text, Button } = kit;
  const found = scrub.lines.findIndex((line) => line.p === scrub.at);
  const index = found < 0 ? 0 : found;
  const now = scrub.lines[index];
  const strip = stripTree(kit, scrub, columns);
  const room = Math.max(3, rows - 8);
  const from = Math.max(0, index - Math.floor(room / 2));
  const where = scrub.isAtEnd
    ? clock(scrub.end)
    : `at least ${clock(scrub.end)} (the end is found by walking there)`;
  const isBusy = scrub.busy.before || scrub.busy.after || scrub.busy.seek;
  const marks = scrub.marks
    .map((mark, i) => ({ mark, i }))
    .filter(({ mark }) => mark.p !== null || mark.t !== null)
    .slice(0, MAX_MARK_BUTTONS);

  return Box({
    flexDirection: "column",
    children: [
      Text({
        wrap: "truncate-end",
        children: [
          Text({ bold: true, children: [`◉ ${scrub.head?.title ?? ""}`] }),
          Text({ dimColor: true, children: [`  ${scrub.head?.date ?? ""}`] }),
        ],
      }),
      Text({
        wrap: "truncate-end",
        children: [
          Text({ bold: true, children: [clock(now?.t ?? 0)] }),
          Text({ dimColor: true, children: [` of ${where}`] }),
        ],
      }),
      ...(strip === undefined ? [] : [strip]),
      ...(scrub.note !== "" || isBusy
        ? [
            Text({
              color: "warning",
              children: [scrub.note !== "" ? scrub.note : "loading…"],
            }),
          ]
        : []),
      ...scrub.lines.slice(from, from + room).map((line) =>
        Text({
          wrap: line.p === scrub.at ? "wrap" : "truncate-end",
          bold: line.p === scrub.at,
          children: [
            Text({
              color: "claude",
              children: [line.p === scrub.at ? "▶ " : "  "],
            }),
            Text({ dimColor: true, children: [clock(line.t).padStart(7)] }),
            " ",
            Text({
              color: COLOURS[line.s % COLOURS.length] ?? "text",
              children: [
                (scrub.speakers[line.s] ?? "unknown").slice(0, 10).padEnd(10),
              ],
            }),
            " ",
            line.x,
          ],
        }),
      ),
      Box({
        flexDirection: "row",
        columnGap: 2,
        children: [
          Button({
            key: "earlier",
            label: "earlier",
            onPress: () => actions.move(-WINDOW),
          }),
          Button({
            key: "back",
            label: "row back",
            onPress: () => actions.move(-1),
          }),
          Button({
            key: "on",
            label: "row on",
            onPress: () => actions.move(1),
          }),
          Button({
            key: "later",
            label: "later",
            onPress: () => actions.move(WINDOW),
          }),
          Button({
            key: "quote",
            label: "quote this row",
            onPress: () => actions.quote(),
          }),
        ],
      }),
      ...marks.map(({ mark, i }) =>
        Button({
          key: `mark-${i}`,
          label: `${mark.kind === "decision" ? "◆" : "▸"} ${mark.what.slice(0, Math.max(10, columns - 12))}`,
          plain: true,
          onPress: () => actions.jump(i),
        }),
      ),
    ],
  });
}
