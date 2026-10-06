/**
 * The pane, top to bottom: what is shown, the picture, the keys, what is
 * under the cursor, and a dim line for everything the picture leaves out.
 */

import type {
  BoxProps,
  ElementConstructor,
  ButtonProps,
  LinkProps,
  RasterProps,
  RenderElement,
  SvgProps,
  TextProps,
} from "claude-code";

import { cellsOf, runsOf, THEME_KEYS } from "./canvas";
import type { Canvas } from "./canvas";
import {
  atOf,
  gridNow,
  listedOf,
  MAX_LISTED,
  scopeNow,
  skyNow,
  starAt,
  targetOf,
} from "./control";
import type { Pulse } from "./control";
import { heatCanvas, layoutOf } from "./draw-heat";
import { starCanvas } from "./draw-stars";
import { glyphOf } from "./glyphs";
import type { Grid, Shown } from "./grid";
import { drawn } from "./plain";
import { insertOf, referenceOf } from "./reference";
import type { Sky } from "./stars";
import { heatSvg, starSvg } from "./svg";
import type { Drawing } from "./svg";
import { clip, countsOf, spanOf, windowOf } from "./words";

type Make<P> = ElementConstructor<P>;

/** The elements the surface being drawn on has. `Raster` and `Svg` are each there only where the surface draws them. */
export type Elements = {
  Box: Make<BoxProps>;
  Text: Make<TextProps>;
  Button: Make<ButtonProps>;
  Link: Make<LinkProps>;
  Raster: Make<RasterProps> | undefined;
  Svg: Make<SvgProps> | undefined;
};

/** What the pane's buttons do. */
export type Actions = {
  move: (dx: number, dy: number) => void;
  resize: (by: number) => void;
  lane: (shown: Shown) => void;
  flip: () => void;
  plain: () => void;
  stepIn: () => void;
  stepUp: () => void;
  refresh: () => void;
  insert: (text: string) => void;
};

const LANE_KEYS: readonly { shown: Shown; label: string; hotkey: string }[] = [
  { shown: "all", label: "all", hotkey: "a" },
  { shown: "meeting", label: "meetings", hotkey: "m" },
  { shown: "session", label: "sessions", hotkey: "s" },
  { shown: "decision", label: "decisions", hotkey: "d" },
  { shown: "other", label: "other", hotkey: "o" },
];

function scopeLabel(pulse: Pulse): string {
  const scope = scopeNow(pulse);

  if (scope.kind === "all") {
    return "everything recent";
  }

  return scope.kind === "repo"
    ? `sessions in ${drawn(scope.repo, 60)}`
    : scope.label;
}

/** The canvas as rows of text in the theme's own colours; dimmed, every row is. */
function textPicture(
  els: Elements,
  canvas: Canvas,
  isDimmed: boolean,
): RenderElement {
  const { Box, Text } = els;

  return Box({
    key: "picture-text",
    flexDirection: "column",
    children: runsOf(canvas).map((runs) =>
      Text({
        wrap: "truncate-end",
        dimColor: isDimmed,
        children: runs.map((run) =>
          run.ink === "cursor"
            ? Text({ inverse: true, children: [run.text] })
            : Text({ color: THEME_KEYS[run.ink], children: [run.text] }),
        ),
      }),
    ),
  });
}

/**
 * The picture, drawn the best way the surface has: a raster of character
 * cells on the terminal, an SVG where the surface draws those, and rows of
 * block characters when it has neither, when the SVG would be too long, or
 * when the person asked for plain text.
 */
function picture(
  els: Elements,
  pulse: Pulse,
  canvas: Canvas,
  drawing: () => Drawing | undefined,
): RenderElement {
  if (!pulse.isPlain && els.Raster !== undefined) {
    return els.Raster({
      key: "picture",
      columns: canvas.columns,
      rows: canvas.rows,
      cells: cellsOf(canvas, pulse.isLoading),
    });
  }

  const svg = pulse.isPlain || els.Svg === undefined ? undefined : drawing();

  return svg === undefined || els.Svg === undefined
    ? textPicture(els, canvas, pulse.isLoading)
    : els.Svg({
        source: svg.source,
        alt: svg.alt,
        width: svg.width,
        height: svg.height,
        isInteractive: true,
      });
}

function legend(
  els: Elements,
  pulse: Pulse,
  grid: Grid | undefined,
  width: number,
): RenderElement {
  const { Text } = els;

  if (pulse.view === "stars") {
    return Text({
      dimColor: true,
      wrap: "truncate-end",
      children: [
        "size: how much is filed · shade: last active ",
        "█ this week ▓ this month ▒ this quarter ░ longer ago",
      ],
    });
  }

  const isSideBySide =
    grid !== undefined && layoutOf(grid, pulse.shown, width).isSideBySide;

  return Text({
    wrap: "truncate-end",
    children: [
      Text({ color: THEME_KEYS.meeting, children: ["█ meetings "] }),
      Text({ color: THEME_KEYS.session, children: ["█ sessions "] }),
      Text({ color: THEME_KEYS.decision, children: ["█ decisions "] }),
      Text({ color: THEME_KEYS.other, children: ["█ other "] }),
      Text({
        dimColor: true,
        children: [
          pulse.shown !== "all"
            ? "· one lane shown · ░▒▓█ more"
            : isSideBySide
              ? "· side by side in a cell · ░▒▓█ more"
              : "· colour is the busiest lane · ░▒▓█ more",
        ],
      }),
    ],
  });
}

function keys(els: Elements, pulse: Pulse, actions: Actions): RenderElement {
  const { Box, Button } = els;
  const key = (
    label: string,
    hotkey: string,
    onPress: () => void,
    isDim = false,
  ): RenderElement =>
    Button({
      key: `key-${hotkey}`,
      label: `${label} ${hotkey}`,
      hotkey,
      plain: true,
      dimColor: isDim,
      onPress,
    });

  return Box({
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 2,
    children: [
      key("←", "h", () => actions.move(-1, 0)),
      key("↓", "j", () => actions.move(0, 1)),
      key("↑", "k", () => actions.move(0, -1)),
      key("→", "l", () => actions.move(1, 0)),
      key("wider", "w", () => actions.resize(1)),
      key("narrower", "n", () => actions.resize(-1)),
      ...LANE_KEYS.map((one) =>
        key(
          one.label,
          one.hotkey,
          () => actions.lane(one.shown),
          pulse.shown !== one.shown,
        ),
      ),
      key(
        pulse.view === "heat" ? "constellation" : "heatmap",
        "v",
        actions.flip,
      ),
      key("up a level", "u", actions.stepUp),
      key(pulse.isPlain ? "picture" : "plain text", "p", actions.plain),
      key("refresh", "r", actions.refresh),
    ],
  });
}

function stepButton(
  els: Elements,
  pulse: Pulse,
  actions: Actions,
): RenderElement[] {
  const target = targetOf(pulse);

  return target === undefined
    ? []
    : [
        els.Button({
          key: "step",
          label: `Step into ${target.name}`,
          autoFocus: true,
          onPress: actions.stepIn,
        }),
      ];
}

/** What is under the heatmap's cursor: the cell in words, the way into its row, and its entries. */
function cellDetail(
  els: Elements,
  pulse: Pulse,
  grid: Grid,
  actions: Actions,
  width: number,
): RenderElement[] {
  const { Box, Text, Button, Link } = els;
  const at = atOf(pulse, grid);
  const column = grid.columns[at.column];

  if (at.line === undefined || at.cell === undefined || column === undefined) {
    return [];
  }

  const listed = listedOf(pulse, at.cell);
  const rows = listed.slice(0, MAX_LISTED).map((entry, n) => {
    const link = pulse.links.known.get(entry.id) ?? null;
    const put = insertOf(entry);

    return Box({
      key: `entry-${n}`,
      flexDirection: "column",
      children: [
        Box({
          flexDirection: "row",
          columnGap: 1,
          children: [
            Text({
              color: THEME_KEYS[entry.lane],
              children: [glyphOf(entry.lane)],
            }),
            Text({
              wrap: "truncate-end",
              children: [clip(entry.title, Math.max(12, width - 15))],
            }),
            Text({ dimColor: true, children: [entry.date] }),
          ],
        }),
        Box({
          flexDirection: "row",
          columnGap: 2,
          paddingLeft: 2,
          children: [
            ...(link === null
              ? []
              : [Link({ href: link, label: "Open in Fylgja" })]),
            Button({
              key: `put-${n}`,
              label: put.label,
              plain: true,
              onPress: () => actions.insert(put.text),
            }),
          ],
        }),
      ],
    });
  });

  return [
    Text({
      bold: true,
      wrap: "truncate-end",
      children: [`${at.line.name} · ${spanOf(column)} · ${countsOf(at.cell)}`],
    }),
    ...stepButton(els, pulse, actions),
    ...rows,
    ...(listed.length > MAX_LISTED
      ? [
          Text({
            dimColor: true,
            children: [`and ${listed.length - MAX_LISTED} more in this cell`],
          }),
        ]
      : []),
  ];
}

/** What is under the constellation's cursor: the node in words, the way into it, and its reference. */
function starDetail(
  els: Elements,
  pulse: Pulse,
  sky: Sky,
  actions: Actions,
): RenderElement[] {
  const { Text, Button } = els;
  const star = sky.stars[starAt(pulse, sky)];

  if (star === undefined) {
    return [];
  }

  const facts = [
    star.name,
    `${star.size} ${sky.isBySize ? "filed" : "in the window"}`,
    ...(star.children === null ? [] : [`${star.children} below it`]),
    `last active ${star.lastActivity ?? "never"}`,
  ];
  const reference =
    sky.isBySize && star.ref !== null
      ? `${referenceOf("project", star.name, star.ref)} `
      : undefined;

  return [
    Text({ bold: true, wrap: "truncate-end", children: [facts.join(" · ")] }),
    ...stepButton(els, pulse, actions),
    ...(reference === undefined
      ? []
      : [
          Button({
            key: "put-project",
            label: "Put reference in prompt",
            plain: true,
            onPress: () => actions.insert(reference),
          }),
        ]),
  ];
}

/** Everything the picture leaves out or could not read, said plainly. */
function footnotes(
  pulse: Pulse,
  grid: Grid | undefined,
  sky: Sky | undefined,
): string[] {
  const picture = pulse.picture;
  const notes: string[] = [];

  if (picture === null) {
    return notes;
  }

  if (picture.isCut) {
    notes.push(
      "built from a partial result: Fylgja left entries out of this window",
    );
  }

  if (picture.unread > 0) {
    notes.push(
      `${picture.unread} ${picture.unread === 1 ? "line" : "lines"} of the timeline could not be read`,
    );
  }

  if (picture.outline?.isShort === true) {
    notes.push("this project has more children than Fylgja listed");
  }

  if (pulse.view === "heat" && grid !== undefined && grid.hidden > 0) {
    notes.push(
      `${grid.hidden} quieter ${grid.hidden === 1 ? "row" : "rows"} not shown`,
    );
  }

  if (pulse.view === "stars" && sky !== undefined) {
    if (sky.unseen > 0) {
      notes.push(
        `${sky.unseen} further ${sky.unseen === 1 ? "place" : "places"} below these not drawn`,
      );
    }

    if (!sky.isBySize) {
      notes.push(
        "size is activity in the window; step into a project to see what is filed under it",
      );
    }
  }

  return notes;
}

/**
 * The whole pane for what `pulse` holds, `width` cells wide.
 */
export function paneOf(
  els: Elements,
  pulse: Pulse,
  width: number,
  actions: Actions,
): RenderElement {
  const { Box, Text } = els;
  const columns = Math.max(24, Math.min(160, Math.floor(width)));
  const grid = gridNow(pulse);
  const sky = pulse.view === "stars" ? skyNow(pulse) : undefined;
  const title = [
    "Pulse",
    scopeLabel(pulse),
    `last ${windowOf(pulse.days)}`,
    ...(pulse.view === "heat" && grid !== undefined ? [`by ${grid.unit}`] : []),
    ...(pulse.isLoading ? ["loading…"] : []),
  ];
  const body: RenderElement[] = [];

  if (pulse.picture !== null && pulse.view === "heat" && grid !== undefined) {
    const at = atOf(pulse, grid);

    body.push(
      picture(els, pulse, heatCanvas(grid, pulse.shown, at, columns), () =>
        heatSvg(grid, pulse.shown, at, pulse.isLoading),
      ),
      legend(els, pulse, grid, columns),
      keys(els, pulse, actions),
      ...cellDetail(els, pulse, grid, actions, columns),
    );
  } else if (pulse.picture !== null && sky !== undefined) {
    const at = starAt(pulse, sky);
    const rows = Math.max(12, Math.min(22, Math.round(columns / 3.2)));

    body.push(
      picture(els, pulse, starCanvas(sky, at, columns, rows), () =>
        starSvg(sky, at, pulse.isLoading),
      ),
      legend(els, pulse, grid, columns),
      keys(els, pulse, actions),
      ...starDetail(els, pulse, sky, actions),
    );
  } else if (!pulse.isLoading && pulse.note === null) {
    body.push(
      Text({
        dimColor: true,
        children: ["Type /pulse, /pulse <project name> or /pulse <org/repo>."],
      }),
    );
  }

  const notes = footnotes(pulse, grid, sky);

  return Box({
    flexDirection: "column",
    children: [
      Text({ bold: true, wrap: "truncate-end", children: [title.join(" · ")] }),
      ...(pulse.note === null
        ? []
        : [Text({ color: "warning", children: [pulse.note] })]),
      ...body,
      ...(notes.length === 0
        ? []
        : [Text({ dimColor: true, children: [notes.join(" · ")] })]),
    ],
  });
}
