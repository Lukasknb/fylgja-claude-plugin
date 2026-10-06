/**
 * The interactive timeline: a surface module. It runs on the drawing
 * thread, without the engine interface, and answers keys and the pointer at
 * once from its own local state. It reaches the hooks only by posting a
 * small message (more rows wanted, a far moment to load, a quote to place).
 *
 * It imports nothing at run time, so the one file is all a surface has to
 * load. The types below are erased before it runs.
 */

import type {
  ClientKeyEvent,
  ClientModule,
  ClientPointerEvent,
  ClientSurface,
  RenderElement,
} from "claude-code";

import type { Line } from "./meeting";
import type { Ask, View } from "./view";

type State = {
  /** Which meeting this state belongs to. A new meeting in the same pane starts fresh. */
  id: string;
  /** The playhead, by row position. */
  at: number;
  /** The last send from the hooks (`goto.n`) the playhead has followed. */
  followed: number;
  isPlaying: boolean;
  speed: number;
  isListOpen: boolean;
  /** While the pointer is held over a part of the bar that is not loaded: the moment it points at. */
  ghost: number | null;
};

type Surface = ClientSurface<State>;

/** Rows from a loaded edge at which the next window is asked for, before the playhead gets there. */
const NEAR = 8;
/** Rows a big step moves. */
const BIG = 10;
/** Playback checks whether to move on this often, in milliseconds. */
const TICK = 200;
const SPEEDS = [1, 2, 4];
/** After this many moves, a request for more rows that brought none is made again. */
const ASK_AGAIN = 10;
/** During playback, beats to wait for rows that were asked for before asking again: five seconds. */
const ASK_AGAIN_TICKS = 25;

/** Rows of the region above the transcript: title, clock, bar, marks, scale, note. */
const HEAD_ROWS = 6;
const BAR_FIRST_ROW = 2;
const BAR_LAST_ROW = 4;
/** Rows the row at the playhead may take when its text wraps. */
const FOCUS_ROWS = 3;

/** One colour per speaker: mid-tone, so each reads on a dark and on a light theme. */
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

/**
 * What the listeners and the playback timer read. They are set up before
 * the values they need exist, so they read the latest from here instead of
 * closing over one drawing's values. One pane draws one timeline, so one
 * record is enough.
 */
const live: {
  view: View | undefined;
  state: State | undefined;
  /** Stops the playback timer, while one runs. */
  stop: (() => void) | undefined;
  /** Milliseconds the row at the playhead has been shown during playback. */
  held: number;
  /** How many times the playhead has moved. */
  moves: number;
  /** The last request for more rows, and the move count when it was made. */
  asked: { key: string; moves: number } | undefined;
  isDragging: boolean;
  /** Beats of playback spent on the last loaded row, waiting for the rows after it. */
  waiting: number;
  /** Which transcript row each drawn row of the region shows. */
  rowAt: Map<number, number>;
  columns: number;
} = {
  view: undefined,
  state: undefined,
  stop: undefined,
  held: 0,
  moves: 0,
  asked: undefined,
  isDragging: false,
  waiting: 0,
  rowAt: new Map(),
  columns: 0,
};

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const tail = `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

  return hours > 0 ? `${hours}:${tail}` : tail;
}

function indexOf(lines: readonly Line[], p: number): number {
  let best = 0;

  for (let i = 0; i < lines.length; i += 1) {
    if (
      Math.abs((lines[i]?.p ?? 0) - p) < Math.abs((lines[best]?.p ?? 0) - p)
    ) {
      best = i;
    }
  }

  return best;
}

/** The row that starts nearest to a moment. */
function nearestTo(lines: readonly Line[], seconds: number): Line | undefined {
  let best = lines[0];

  for (const line of lines) {
    if (best === undefined || Math.abs(line.t - seconds) < Math.abs(best.t - seconds)) {
      best = line;
    }
  }

  return best;
}

function post(surface: Surface, ask: Ask): void {
  surface.post(ask);
}

function set(surface: Surface, next: State): void {
  live.state = next;
  surface.setState(next);
}

/**
 * Asks the hooks for the next window once the playhead is near a loaded
 * edge that is not an end of the meeting. Asked once per edge; again only
 * if many moves later the edge is still where it was, which means the
 * request was lost.
 */
function wantMore(surface: Surface): void {
  const view = live.view;
  const state = live.state;
  const first = view?.lines[0];
  const last = view?.lines.at(-1);

  if (
    view === undefined ||
    state === undefined ||
    first === undefined ||
    last === undefined
  ) {
    return;
  }

  const index = indexOf(view.lines, state.at);
  const side =
    !view.isAtEnd && view.lines.length - 1 - index <= NEAR
      ? "after"
      : !view.isAtStart && index <= NEAR
        ? "before"
        : undefined;

  if (side === undefined) {
    return;
  }

  const key = `${view.id}:${side}:${side === "after" ? last.p : first.p}`;

  if (live.asked?.key === key && live.moves - live.asked.moves < ASK_AGAIN) {
    return;
  }

  live.asked = { key, moves: live.moves };
  post(surface, { ask: "more", side });
}

/** Puts the playhead on the loaded row nearest to position `p`. */
function moveTo(surface: Surface, p: number, more: Partial<State> = {}): void {
  const view = live.view;
  const state = live.state;

  if (view === undefined || state === undefined || view.lines.length === 0) {
    return;
  }

  const row = view.lines[indexOf(view.lines, p)];

  live.held = 0;
  live.moves += 1;
  set(surface, { ...state, ghost: null, ...more, at: row?.p ?? state.at });
  wantMore(surface);
}

function step(surface: Surface, by: number): void {
  const view = live.view;
  const state = live.state;

  if (view === undefined || state === undefined) {
    return;
  }

  const index = Math.min(
    view.lines.length - 1,
    Math.max(0, indexOf(view.lines, state.at) + by),
  );

  moveTo(surface, view.lines[index]?.p ?? state.at);
}

/** The moment a mark sits at: its own, or that of the row it was made at when that row is loaded. */
function momentOf(view: View, index: number): number | undefined {
  const mark = view.marks[index];

  if (mark === undefined) {
    return undefined;
  }

  return mark.t ?? view.lines.find((line) => line.p === mark.p)?.t;
}

/** Goes to a mark: at once when its row is loaded, through the hooks when it has to be read first. */
function goToMark(surface: Surface, index: number): void {
  const view = live.view;
  const state = live.state;
  const mark = view?.marks[index];

  if (
    view === undefined ||
    state === undefined ||
    mark === undefined ||
    (mark.p === null && mark.t === null)
  ) {
    return;
  }

  const first = view.lines[0];
  const last = view.lines.at(-1);
  const row =
    mark.p !== null
      ? view.lines.find((line) => line.p === mark.p)
      : mark.t !== null &&
          first !== undefined &&
          last !== undefined &&
          mark.t >= first.t &&
          mark.t <= last.t
        ? nearestTo(view.lines, mark.t)
        : undefined;

  if (row !== undefined) {
    moveTo(surface, row.p, { isListOpen: false });

    return;
  }

  set(surface, { ...state, isListOpen: false });
  post(surface, { ask: "jump", mark: index });
}

/** Goes to the nearest decision after (`by` 1) or before (`by` -1) the playhead. */
function nextDecision(surface: Surface, by: 1 | -1): void {
  const view = live.view;
  const state = live.state;
  const now = view?.lines[indexOf(view.lines, state?.at ?? 0)]?.t;

  if (view === undefined || now === undefined) {
    return;
  }

  let best: { index: number; moment: number } | undefined;

  view.marks.forEach((mark, index) => {
    const moment = momentOf(view, index);

    if (
      mark.kind !== "decision" ||
      moment === undefined ||
      (moment - now) * by <= 0
    ) {
      return;
    }

    if (best === undefined || (moment - best.moment) * by < 0) {
      best = { index, moment };
    }
  });

  if (best !== undefined) {
    goToMark(surface, best.index);
  }
}

function stopPlaying(surface: Surface): void {
  live.stop?.();
  live.stop = undefined;

  if (live.state?.isPlaying === true) {
    set(surface, { ...live.state, isPlaying: false });
  }
}

/** How long a row is shown during playback at normal speed: longer for longer text. */
function dwell(line: Line | undefined): number {
  return Math.min(6000, Math.max(1200, 700 + (line?.x.length ?? 0) * 45));
}

/** One beat of playback: moves on once the row has been shown long enough, and stops at the meeting's end. */
function tick(surface: Surface): void {
  const view = live.view;
  const state = live.state;

  if (view === undefined || state === undefined || !state.isPlaying) {
    return;
  }

  const index = indexOf(view.lines, state.at);

  live.held += TICK;

  if (live.held < dwell(view.lines[index]) / state.speed) {
    return;
  }

  if (index < view.lines.length - 1) {
    live.waiting = 0;
    step(surface, 1);
  } else if (view.isAtEnd) {
    stopPlaying(surface);
  } else {
    // The next window is on its way; the row stays until it is here. If it
    // has not come after a good while, the request was lost: ask once more.
    live.waiting += 1;

    if (live.waiting % ASK_AGAIN_TICKS === 0) {
      live.asked = undefined;
    }

    wantMore(surface);
  }
}

function togglePlaying(surface: Surface): void {
  const state = live.state;

  if (state === undefined) {
    return;
  }

  if (state.isPlaying) {
    stopPlaying(surface);

    return;
  }

  live.held = 0;
  live.stop?.();
  live.stop = surface.every(TICK, () => tick(surface));
  set(surface, { ...state, isPlaying: true });
}

function nextSpeed(surface: Surface): void {
  const state = live.state;

  if (state !== undefined) {
    set(surface, {
      ...state,
      speed: SPEEDS[(SPEEDS.indexOf(state.speed) + 1) % SPEEDS.length] ?? 1,
    });
  }
}

function toggleList(surface: Surface): void {
  if (live.state !== undefined) {
    set(surface, { ...live.state, isListOpen: !live.state.isListOpen });
  }
}

function quote(surface: Surface): void {
  if (live.state !== undefined && (live.view?.lines.length ?? 0) > 0) {
    post(surface, { ask: "quote", p: live.state.at });
  }
}

function onKey(surface: Surface, event: ClientKeyEvent): void {
  const state = live.state;
  const view = live.view;

  if (state === undefined || view === undefined) {
    return;
  }

  if (state.isListOpen && /^[1-9]$/.test(event.key)) {
    goToMark(surface, Number(event.key) - 1);

    return;
  }

  switch (event.key) {
    case "left":
      return step(surface, event.shift === true ? -BIG : -1);
    case "right":
      return step(surface, event.shift === true ? BIG : 1);
    case "[":
    case "pageup":
      return step(surface, -BIG);
    case "]":
    case "pagedown":
      return step(surface, BIG);
    case "home":
      return moveTo(surface, view.lines[0]?.p ?? state.at);
    case "end":
      return moveTo(surface, view.lines.at(-1)?.p ?? state.at);
    case "n":
      return nextDecision(surface, 1);
    case "p":
      return nextDecision(surface, -1);
    case " ":
    case "space":
      return togglePlaying(surface);
    case "s":
      return nextSpeed(surface);
    case "d":
      return toggleList(surface);
    case "q":
    case "return":
      return quote(surface);
    default:
  }
}

/**
 * The pointer over the bar: within what is loaded the playhead follows it
 * at once; over a part not loaded yet a ghost mark follows it, and letting
 * go asks the hooks to load that moment.
 */
function scrub(surface: Surface, event: ClientPointerEvent): void {
  const view = live.view;
  const state = live.state;
  const first = view?.lines[0];
  const last = view?.lines.at(-1);

  if (
    view === undefined ||
    state === undefined ||
    first === undefined ||
    last === undefined ||
    live.columns < 1
  ) {
    return;
  }

  const x = Math.min(live.columns, Math.max(0, event.fine?.x ?? event.x + 0.5));
  const seconds = (x / live.columns) * Math.max(1, view.end);
  const cell = Math.max(1, view.end) / live.columns;

  if (seconds >= first.t - cell && seconds <= last.t + cell) {
    moveTo(surface, nearestTo(view.lines, seconds)?.p ?? first.p);
  } else {
    set(surface, { ...state, ghost: seconds });
  }
}

function onPointer(surface: Surface, event: ClientPointerEvent): void {
  const state = live.state;

  if (state === undefined) {
    return;
  }

  if (event.type === "down") {
    if (event.y >= BAR_FIRST_ROW && event.y <= BAR_LAST_ROW) {
      live.isDragging = true;
      scrub(surface, event);
    } else if (!state.isListOpen && live.rowAt.has(event.y)) {
      moveTo(surface, live.rowAt.get(event.y) ?? state.at);
    }

    return;
  }

  if (event.type === "move" && live.isDragging) {
    scrub(surface, event);

    return;
  }

  if (event.type === "up" && live.isDragging) {
    live.isDragging = false;

    if (state.ghost !== null) {
      post(surface, { ask: "seek", seconds: state.ghost });
      set(surface, { ...state, ghost: null });
    }
  }
}

/** The state for this drawing: fresh for a new meeting, and following the hooks when they sent the playhead somewhere. */
function stateFor(view: View, kept: State | undefined): State {
  let state =
    kept !== undefined && kept.id === view.id
      ? kept
      : {
          id: view.id,
          at: view.lines[0]?.p ?? 0,
          followed: 0,
          isPlaying: false,
          speed: 1,
          isListOpen: false,
          ghost: null,
        };

  if (view.goto !== null && view.goto.n !== state.followed) {
    state = { ...state, at: view.goto.p, followed: view.goto.n };
  }

  const row = view.lines[indexOf(view.lines, state.at)];

  return row !== undefined && row.p !== state.at
    ? { ...state, at: row.p }
    : state;
}

function isView(props: unknown): props is View {
  const view = props as Partial<View> | null;

  return (
    typeof view === "object" &&
    view !== null &&
    Array.isArray(view.lines) &&
    Array.isArray(view.marks)
  );
}

function colourOf(speaker: number): string {
  return COLOURS[speaker % COLOURS.length] ?? "text";
}

/** Breaks text into at most `rows` lines of `width` characters, at spaces where it can. */
function wrapped(text: string, width: number, rows: number): string[] {
  const out: string[] = [];
  let rest = text;

  while (rest.length > 0 && out.length < rows) {
    if (rest.length <= width) {
      out.push(rest);
      rest = "";
    } else if (out.length === rows - 1) {
      out.push(`${rest.slice(0, Math.max(1, width - 1))}…`);
      rest = "";
    } else {
      const space = rest.lastIndexOf(" ", width);
      const cut = space > width / 2 ? space : width;

      out.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
  }

  return out;
}

const Timeline: ClientModule = (props, base) => {
  const surface = base as Surface;
  const { Box, Text, Button } = surface.elements;

  if (!isView(props)) {
    return Text({ dimColor: true, children: ["Nothing to show."] });
  }

  const view = props;

  if (surface.state === undefined || surface.state.id !== view.id) {
    // A new timeline, or a new meeting in the same one: nothing of the last carries over.
    live.stop?.();
    live.stop = undefined;
    live.asked = undefined;
    live.isDragging = false;
    live.held = 0;
  }

  const state = stateFor(view, surface.state);
  const columns = Math.max(
    20,
    surface.columns > 0 ? surface.columns : view.columns,
  );
  const rows = Math.max(
    HEAD_ROWS + FOCUS_ROWS + 1,
    surface.rows > 0 ? surface.rows : view.rows,
  );

  live.view = view;
  live.state = state;
  live.columns = columns;
  live.rowAt = new Map();
  surface.onKey((event) => onKey(surface, event));
  surface.onPointer((event) => onPointer(surface, event));

  const index = indexOf(view.lines, state.at);
  const now = view.lines[index];
  const end = Math.max(1, view.end);
  const cellOf = (seconds: number): number =>
    Math.min(columns - 1, Math.max(0, Math.floor((seconds / end) * columns)));

  // The bar: one cell per slice of time, coloured by who was speaking, dotted where nothing is loaded.
  const band: number[] = new Array<number>(columns).fill(-1);

  view.lines.forEach((line, i) => {
    const from = cellOf(line.t);
    const next = view.lines[i + 1];
    const to = next === undefined ? from : Math.max(from, cellOf(next.t) - 1);

    for (let cell = from; cell <= to; cell += 1) {
      band[cell] = line.s;
    }
  });

  const head = now === undefined ? -1 : cellOf(now.t);
  const ghost = state.ghost === null ? -1 : cellOf(state.ghost);
  const bar: RenderElement[] = [];

  for (let cell = 0; cell < columns;) {
    if (cell === head || cell === ghost) {
      bar.push(
        Text({
          color: "claude",
          bold: true,
          children: [cell === head ? "┃" : "┆"],
        }),
      );
      cell += 1;

      continue;
    }

    let stop = cell + 1;

    while (
      stop < columns &&
      band[stop] === band[cell] &&
      stop !== head &&
      stop !== ghost
    ) {
      stop += 1;
    }

    const speaker = band[cell] ?? -1;

    bar.push(
      speaker < 0
        ? Text({ dimColor: true, children: ["┄".repeat(stop - cell)] })
        : Text({
            color: colourOf(speaker),
            children: ["▆".repeat(stop - cell)],
          }),
    );
    cell = stop;
  }

  // Under the bar: a mark wherever a decision or a commitment has a place in time.
  const signs: string[] = new Array<string>(columns).fill(" ");

  view.marks.forEach((mark, i) => {
    const moment = momentOf(view, i);

    if (
      moment !== undefined &&
      (mark.kind === "decision" || signs[cellOf(moment)] === " ")
    ) {
      signs[cellOf(moment)] = mark.kind === "decision" ? "◆" : "▸";
    }
  });

  // The scale: a time every quarter of the bar, and the latest moment seen at its right end.
  const scale: string[] = new Array<string>(columns).fill(" ");
  const write = (at: number, text: string): void => {
    for (let i = 0; i < text.length && at + i < columns; i += 1) {
      scale[at + i] = text[i] ?? " ";
    }
  };
  const endLabel = `${view.isAtEnd ? "" : "≥"}${clock(view.end)}`;

  for (const quarter of [0, 1, 2, 3]) {
    const at = Math.floor((quarter * columns) / 4);

    if (at + 8 < columns - endLabel.length) {
      write(at, `╵${clock((at / columns) * end)}`);
    }
  }

  write(columns - endLabel.length, endLabel);

  const playing = state.isPlaying
    ? `▶ ${state.speed}×`
    : state.speed === 1
      ? ""
      : `${state.speed}×`;
  const where = view.isAtEnd
    ? ` of ${clock(view.end)}`
    : ` of at least ${clock(view.end)} (the end is found by walking there)`;
  const hint = state.isListOpen
    ? "press a number to go there, d to close"
    : "←→ row  ⇧←→ or [ ] ten rows  n p decision  space play  s speed  q quote  d list  click or drag the bar";
  const noteLine =
    view.note !== "" ? view.note : view.isBusy ? "loading…" : hint;

  const lineOf = (
    line: Line,
    text: string,
    isFocus: boolean,
    showsHead: boolean,
  ): RenderElement =>
    Text({
      wrap: "truncate-end",
      bold: isFocus,
      children: [
        Text({
          color: "claude",
          children: [isFocus && showsHead ? "▶ " : "  "],
        }),
        Text({
          dimColor: true,
          children: [showsHead ? clock(line.t).padStart(7) : " ".repeat(7)],
        }),
        " ",
        Text({
          color: colourOf(line.s),
          children: [
            showsHead
              ? (view.speakers[line.s] ?? "unknown").slice(0, 10).padEnd(10)
              : " ".repeat(10),
          ],
        }),
        " ",
        text,
      ],
    });

  const blank = (): RenderElement => Text({ children: [" "] });
  const body: RenderElement[] = [];
  const room = rows - HEAD_ROWS - 1;
  const textWidth = Math.max(10, columns - 22);

  if (state.isListOpen) {
    view.marks.slice(0, Math.max(1, Math.min(9, room))).forEach((mark, i) => {
      const moment = momentOf(view, i);
      const sign = mark.kind === "decision" ? "◆" : "▸";
      const canGo = mark.p !== null || mark.t !== null;
      const when =
        moment !== undefined
          ? clock(moment)
          : canGo
            ? "not loaded yet"
            : "moment not recorded";
      const label = `${i + 1} ${sign} ${mark.what.slice(0, Math.max(10, columns - 30))} · ${when}`;

      body.push(
        canGo
          ? Button({
              key: `mark-${i}`,
              label,
              plain: true,
              onPress: () => goToMark(surface, i),
            })
          : Text({ dimColor: true, wrap: "truncate-end", children: [label] }),
      );
    });

    if (view.marks.length === 0) {
      body.push(
        Text({
          dimColor: true,
          children: [
            "No decisions or commitments were recorded for this meeting.",
          ],
        }),
      );
    }
  } else if (now === undefined) {
    body.push(
      Text({
        dimColor: true,
        children: [
          view.isBusy ? "Loading the transcript…" : "No transcript rows.",
        ],
      }),
    );
  } else {
    const before = Math.floor((room - FOCUS_ROWS) / 2);
    const after = room - FOCUS_ROWS - before;
    let y = HEAD_ROWS;

    for (let i = index - before; i < index; i += 1) {
      const line = view.lines[i];

      if (line !== undefined) {
        live.rowAt.set(y, line.p);
      }

      body.push(
        line === undefined ? blank() : lineOf(line, line.x, false, true),
      );
      y += 1;
    }

    const parts = wrapped(now.x, textWidth, FOCUS_ROWS);

    for (let i = 0; i < FOCUS_ROWS; i += 1) {
      const part = parts[i];

      body.push(
        part === undefined ? blank() : lineOf(now, part, true, i === 0),
      );
      y += 1;
    }

    for (let i = index + 1; i <= index + after; i += 1) {
      const line = view.lines[i];

      if (line !== undefined) {
        live.rowAt.set(y, line.p);
      }

      body.push(
        line === undefined ? blank() : lineOf(line, line.x, false, true),
      );
      y += 1;
    }
  }

  const decisions = view.marks.filter(
    (mark) => mark.kind === "decision",
  ).length;

  return Box({
    flexDirection: "column",
    children: [
      Text({
        wrap: "truncate-end",
        children: [
          Text({ bold: true, children: [`◉ ${view.title}`] }),
          Text({ dimColor: true, children: [`  ${view.date}`] }),
        ],
      }),
      Text({
        wrap: "truncate-end",
        children: [
          Text({
            bold: true,
            children: [now === undefined ? "--:--" : clock(now.t)],
          }),
          Text({ dimColor: true, children: [where] }),
          ...(playing === ""
            ? []
            : [Text({ color: "claude", children: [`  ${playing}`] })]),
        ],
      }),
      Text({ wrap: "truncate-end", children: bar }),
      Text({
        wrap: "truncate-end",
        color: "warning",
        children: [signs.join("")],
      }),
      Text({
        wrap: "truncate-end",
        dimColor: true,
        children: [scale.join("")],
      }),
      view.note === ""
        ? Text({ wrap: "truncate-end", dimColor: true, children: [noteLine] })
        : Text({ wrap: "truncate-end", color: "warning", children: [noteLine] }),
      Box({
        flexDirection: "column",
        height: room,
        overflow: "hidden",
        children: body,
      }),
      Box({
        flexDirection: "row",
        columnGap: 2,
        children: [
          Button({
            key: "play",
            label: state.isPlaying ? "pause" : "play",
            onPress: () => togglePlaying(surface),
          }),
          Button({
            key: "speed",
            label: `speed ${state.speed}×`,
            onPress: () => nextSpeed(surface),
          }),
          Button({
            key: "quote",
            label: "quote this row",
            onPress: () => quote(surface),
          }),
          Button({
            key: "list",
            label: state.isListOpen
              ? "back to the transcript"
              : `decisions (${decisions})`,
            onPress: () => toggleList(surface),
          }),
        ],
      }),
    ],
  });
};

export default Timeline;
