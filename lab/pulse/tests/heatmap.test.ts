import { describe, expect, test } from "claude-code/testing";

import { RASTER_COLORS } from "../hooks/canvas";
import {
  BACKEND,
  cellsOf,
  fenced,
  idOf,
  json,
  linesOf,
  pane,
  PLATFORM,
  PLATFORM_LINES,
  platformOutline,
  platformTools,
  pulse,
  scene,
  timeline,
  line,
  listed,
  rowNames,
} from "./fixtures";

describe("/pulse on a project", () => {
  test("opens a focused pane, reads the project once and its window once, and draws the heatmap", async ($, on) => {
    const started = scene(on, { tools: platformTools() });

    await pulse($, started, "Platform");

    expect(started.opened).toEqual([
      { id: "fylgja-pulse", title: "Pulse", focus: true },
    ]);
    expect(started.calls).toEqual([
      { tool: "open", args: { ref: "Platform", detail: false } },
      // Six weeks ending today, asked for by the project's id.
      {
        tool: "get_timeline",
        args: { project_name: PLATFORM, since: "2026-08-26", limit: 100 },
      },
    ]);

    const ui = await $.ui.mount(pane("terminal"));
    const raster = await ui.find({ type: "Raster" });
    const rows = linesOf(raster ?? { props: {} });

    expect(
      await ui.find({ text: /^Pulse · Platform · last 6 weeks · by day$/ }),
    ).toBeDefined();
    // The busiest child first, the quiet child still there, and the project's own entries in a row of their own.
    expect(rowNames(raster ?? { props: {} })).toEqual([
      "Backend",
      "Desktop",
      "Docs",
      "(filed here)",
    ]);
    // The cursor starts on the first row and the newest day.
    expect(rows[2]?.startsWith("▸Backend")).toBe(true);
    expect(
      await ui.find({
        text: "Backend · 2026-10-06 · 1 meeting, 1 session, 1 decision",
      }),
    ).toBeDefined();
    expect(started.forbidden).toEqual([]);
    expect(started.submitted).toEqual([]);
  });

  test("a cell is as dark as it is busy and coloured by the kind of work in it", async ($, on) => {
    const started = scene(on, { tools: platformTools() });

    await pulse($, started, "Platform");

    const ui = await $.ui.mount(pane("terminal"));
    const cells = cellsOf((await ui.find({ type: "Raster" })) ?? { props: {} });
    const backend = cells[2] ?? [];
    const desktop = cells[3] ?? [];
    const docs = cells[4] ?? [];
    const inked = (row: typeof backend, color: number) =>
      row.filter((cell) => cell.fg === color && cell.char !== " ");

    // 2026-10-05, one meeting in Backend: one cell in the meeting colour.
    expect(inked(backend, RASTER_COLORS.meeting).length).toBe(1);
    // 2026-09-30, a commitment: neither meeting, session nor decision.
    expect(
      inked(backend, RASTER_COLORS.other).filter((cell) => cell.char !== "·")
        .length,
    ).toBe(1);
    expect(inked(desktop, RASTER_COLORS.session).length).toBe(1);
    // A quiet child has a row of empty cells, not no row.
    expect(docs.filter((cell) => cell.char === "·").length).toBe(42);
    expect(docs.some((cell) => "░▒▓█".includes(cell.char))).toBe(false);
    // Every cell that is not the cursor sits on the terminal's own background.
    expect(cells.flat().filter((cell) => cell.bg !== 0x01000000).length).toBe(
      1,
    );
  });

  test("h j k l move the cursor without asking Fylgja anything, and the cell under it is listed", async ($, on) => {
    const started = scene(on, { tools: platformTools() });

    await pulse($, started, "Platform");

    const ui = await $.ui.mount(pane("terminal"));
    const asked = started.calls.length;

    await ui.press({ key: "key-h" });

    expect(
      await ui.find({ text: "Backend · 2026-10-05 · 1 meeting" }),
    ).toBeDefined();
    expect((await ui.find({ key: "entry-0" }))?.text).toMatch(
      /◉.*Incident review.*2026-10-05/,
    );

    await ui.press({ key: "key-j" });

    expect(
      await ui.find({ text: "Desktop · 2026-10-05 · nothing" }),
    ).toBeDefined();
    expect(await ui.find({ key: "entry-0" })).toBeUndefined();

    await ui.press({ key: "key-k" });
    await ui.press({ key: "key-l" });

    expect(
      await ui.find({
        text: "Backend · 2026-10-06 · 1 meeting, 1 session, 1 decision",
      }),
    ).toBeDefined();
    expect(
      await listed(ui),
    ).toEqual([
      expect.stringContaining("◉Sprint planning2026-10-06"),
      expect.stringContaining("⌁Fix the queue worker2026-10-06"),
      expect.stringContaining("◆Keep Postgres for the queue2026-10-06"),
    ]);

    // The edges hold the cursor.
    await ui.press({ key: "key-l" });
    await ui.press({ key: "key-k" });

    expect(
      await ui.find({
        text: "Backend · 2026-10-06 · 1 meeting, 1 session, 1 decision",
      }),
    ).toBeDefined();
    expect(started.calls.length).toBe(asked);
  });

  test("one lane at a time: the picture and the list show only that kind of work", async ($, on) => {
    const started = scene(on, { tools: platformTools() });

    await pulse($, started, "Platform");

    const ui = await $.ui.mount(pane("terminal"));

    await ui.press({ key: "key-s" });

    const cells = cellsOf((await ui.find({ type: "Raster" })) ?? { props: {} });
    const shaded = cells
      .flat()
      .filter((cell) => "░▒▓█".includes(cell.char) && cell.bg === 0x01000000);

    expect(
      shaded.length > 0 &&
        shaded.every((cell) => cell.fg === RASTER_COLORS.session),
    ).toBe(true);
    expect(
      await ui.find({
        text: "Backend · 2026-10-06 · 1 meeting, 1 session, 1 decision",
      }),
    ).toBeDefined();
    expect((await listed(ui)).length).toBe(1);

    await ui.press({ key: "key-a" });

    expect((await listed(ui)).length).toBe(3);
  });

  test('"Put reference in prompt" fills the prompt box at the cursor and submits nothing', async ($, on) => {
    const started = scene(on, { tools: platformTools() });

    await pulse($, started, "Platform");

    const ui = await $.ui.mount(pane("terminal"));

    expect((await ui.find({ key: "put-0" }))?.props.label).toBe(
      "Put reference in prompt",
    );

    await ui.press({ key: "put-0" });
    await ui.press({ key: "put-2" });

    expect(started.fills).toEqual([
      {
        text: `{{fylgja:meeting Sprint planning|${idOf(101)}}} `,
        mode: "insert",
      },
      // A decision has no reference of that form: its id, which `open` reads.
      { text: `decision ${idOf(103)} `, mode: "insert" },
    ]);
    expect(started.submitted).toEqual([]);
  });

  test("a prompt box that takes no text is said in one line", async ($, on) => {
    const started = scene(on, { tools: platformTools(), canFill: false });

    await pulse($, started, "Platform");

    const ui = await $.ui.mount(pane("terminal"));

    await ui.press({ key: "put-0" });

    expect(
      await ui.find({ text: "The prompt box is not taking text right now." }),
    ).toBeDefined();
  });

  test("Enter on the row steps the picture into that child, and u steps back without fetching again", async ($, on) => {
    const started = scene(on, { tools: platformTools() });

    await pulse($, started, "Platform");

    const ui = await $.ui.mount(pane("terminal"));
    const step = await ui.find({ key: "step" });

    expect([step?.props.label, step?.props.autoFocus]).toEqual([
      "Step into Backend",
      true,
    ]);

    await ui.press({ key: "step" });
    await started.clock.settle();

    expect(started.calls.slice(2)).toEqual([
      { tool: "open", args: { ref: BACKEND, detail: false } },
      {
        tool: "get_timeline",
        args: { project_name: BACKEND, since: "2026-08-26", limit: 100 },
      },
    ]);
    expect(
      await ui.find({ text: /^Pulse · Backend · last 6 weeks/ }),
    ).toBeDefined();

    await ui.press({ key: "key-u" });
    await started.clock.settle();

    expect(
      await ui.find({ text: /^Pulse · Platform · last 6 weeks/ }),
    ).toBeDefined();
    expect(
      started.calls.length,
      "the picture stepped out of is still held",
    ).toBe(4);
  });

  test("a row that is no project offers no way in", async ($, on) => {
    const started = scene(on, { tools: platformTools() });

    await pulse($, started, "Platform");

    const ui = await $.ui.mount(pane("terminal"));

    for (let n = 0; n < 3; n += 1) {
      await ui.press({ key: "key-j" });
    }

    expect(
      await ui.find({ text: /^\(filed here\) · 2026-10-06 · nothing$/ }),
    ).toBeDefined();
    expect(await ui.find({ key: "step" })).toBeUndefined();
  });
});

describe("the window", () => {
  test("wider fetches only the days not held, narrower fetches nothing", async ($, on) => {
    const started = scene(on, { tools: platformTools() });

    await pulse($, started, "Platform");

    const ui = await $.ui.mount(pane("terminal"));

    await ui.press({ key: "key-w" });
    await started.clock.settle();

    expect(
      await ui.find({ text: /^Pulse · Platform · last a quarter · by week$/ }),
    ).toBeDefined();
    expect(started.calls.slice(2)).toEqual([
      // From 91 days back up to the day before the six weeks already held.
      {
        tool: "get_timeline",
        args: {
          project_name: PLATFORM,
          since: "2026-07-08",
          until: "2026-08-25T23:59:59",
          limit: 100,
        },
      },
    ]);

    await ui.press({ key: "key-n" });
    await ui.press({ key: "key-n" });
    await started.clock.settle();

    expect(
      await ui.find({ text: /^Pulse · Platform · last 2 weeks · by day$/ }),
    ).toBeDefined();

    await ui.press({ key: "key-w" });
    await ui.press({ key: "key-w" });
    await started.clock.settle();

    expect(
      await ui.find({ text: /^Pulse · Platform · last a quarter · by week$/ }),
    ).toBeDefined();
    expect(started.calls.length, "everything asked for once").toBe(3);
  });

  test("a quarter is drawn by week, and a week cell lists the whole week", async ($, on) => {
    const started = scene(on, { tools: platformTools() });

    await pulse($, started, "Platform");

    const ui = await $.ui.mount(pane("terminal"));

    await ui.press({ key: "key-w" });
    await started.clock.settle();

    expect(
      await ui.find({
        text: "Backend · 2026-09-30 to 2026-10-06 · 2 meetings, 1 session, 1 decision, 1 other entry",
      }),
    ).toBeDefined();
  });

  test("six weeks are drawn by week in a pane too narrow for 42 columns", async ($, on) => {
    const started = scene(on, { tools: platformTools() });

    await pulse($, started, "Platform");

    const ui = await $.ui.mount(pane("terminal", 44));
    const raster = await ui.find({ type: "Raster" });

    expect(await ui.find({ text: /by week$/ })).toBeDefined();
    expect(Number(raster?.props.columns) <= 44).toBe(true);
  });

  test("while the wider window is fetched the old picture stays, dimmed, and says it is loading", async ($, on) => {
    let isSlow = false;
    const started = scene(on, {
      tools: {
        ...platformTools(),
        get_timeline: async (args, clock) => {
          if (isSlow) {
            await clock.sleep(3000);
          }

          return fenced(timeline(PLATFORM_LINES));
        },
      },
    });

    await pulse($, started, "Platform");

    const ui = await $.ui.mount(pane("terminal"));
    const before = linesOf(
      (await ui.find({ type: "Raster" })) ?? { props: {} },
    );

    isSlow = true;
    await ui.press({ key: "key-w" });

    const during = (await ui.find({ type: "Raster" })) ?? { props: {} };
    const inks = new Set(
      cellsOf(during)
        .flat()
        .filter((cell) => cell.bg === 0x01000000 && cell.fg !== 0x01000000)
        .map((cell) => cell.fg),
    );

    expect(await ui.find({ text: /loading…$/ })).toBeDefined();
    expect(linesOf(during), "the same picture").toEqual(before);
    expect([...inks], "in one grey").toEqual([RASTER_COLORS.dim]);

    await started.clock.advance(3000);

    expect(await ui.find({ text: /loading…$/ })).toBeUndefined();
    expect(await ui.find({ text: /by week$/ })).toBeDefined();
  });

  test("a wider window that cannot be fetched leaves the picture and the window as they were", async ($, on) => {
    let isDown = false;
    const started = scene(on, {
      tools: {
        ...platformTools(),
        get_timeline: () =>
          isDown
            ? { content: [{ type: "text", text: "boom" }], isError: true }
            : fenced(timeline(PLATFORM_LINES)),
      },
    });

    await pulse($, started, "Platform");

    const ui = await $.ui.mount(pane("terminal"));

    isDown = true;
    await ui.press({ key: "key-w" });
    await started.clock.settle();

    expect(
      await ui.find({ text: "Fylgja did not answer with a timeline." }),
    ).toBeDefined();
    expect(
      await ui.find({ text: /^Pulse · Platform · last 6 weeks · by day$/ }),
    ).toBeDefined();
    expect(await ui.find({ text: /partial result/ })).toBeUndefined();
  });
});

describe("a result that is cut, partial or unreadable", () => {
  test("a window the server cut is split and asked for in halves", async ($, on) => {
    const started = scene(on, {
      tools: {
        ...platformTools(),
        // Only the whole window is too much; each half comes back complete.
        get_timeline: (args) =>
          fenced(
            args.until === undefined && args.since === "2026-08-26"
              ? timeline(PLATFORM_LINES.slice(0, 2), true)
              : timeline(
                  args.until === undefined
                    ? PLATFORM_LINES.slice(0, 5)
                    : PLATFORM_LINES.slice(5),
                ),
          ),
      },
    });

    await pulse($, started, "Platform");

    expect(
      started.calls.slice(1).map((call) => [call.args.since, call.args.until]),
    ).toEqual([
      ["2026-08-26", undefined],
      ["2026-09-16", undefined],
      ["2026-08-26", "2026-09-15T23:59:59"],
    ]);

    const ui = await $.ui.mount(pane("terminal"));

    await ui.press({ key: "key-w" });
    await started.clock.settle();

    // All seven entries, each once, and nothing said about a cut.
    expect(
      await ui.find({
        text: "Backend · 2026-09-30 to 2026-10-06 · 2 meetings, 1 session, 1 decision, 1 other entry",
      }),
    ).toBeDefined();
    expect(await ui.find({ text: /partial result/ })).toBeUndefined();
  });

  test("a window that stays cut after the calls allowed is drawn and says it is partial", async ($, on) => {
    const started = scene(on, {
      tools: {
        ...platformTools(),
        get_timeline: () => fenced(timeline(PLATFORM_LINES, true)),
      },
    });

    await pulse($, started, "Platform");

    const timelines = started.calls.filter(
      (call) => call.tool === "get_timeline",
    );
    const ui = await $.ui.mount(pane("terminal"));

    expect(timelines.length <= 7, `asked ${timelines.length} times`).toBe(true);
    expect(
      await ui.find({
        text: /built from a partial result: Fylgja left entries out of this window/,
      }),
    ).toBeDefined();
    expect(
      await ui.find({
        text: "Backend · 2026-10-06 · 1 meeting, 1 session, 1 decision",
      }),
    ).toBeDefined();
  });

  test("text the server cut at its size limit counts as partial, and the half line is counted, not drawn", async ($, on) => {
    const cut = `${timeline(PLATFORM_LINES.slice(0, 3)).split("\n").slice(0, 7).join("\n")}\n- 2026-10-05 · meeting · Incident rev\n[truncated: 812 more chars — ask for a section]`;
    const started = scene(on, {
      tools: { ...platformTools(), get_timeline: () => fenced(cut) },
    });

    await pulse($, started, "Platform");

    const ui = await $.ui.mount(pane("terminal"));

    expect(
      await ui.find({ text: /built from a partial result/ }),
    ).toBeDefined();
    expect(
      await ui.find({ text: /1 line of the timeline could not be read/ }),
    ).toBeDefined();
  });

  test("lines that are not entries are counted in the footer and the rest is drawn", async ($, on) => {
    const lines = [
      ...PLATFORM_LINES.slice(0, 2),
      "- 2026-10-04 · meeting · No id at the end · in Platform > Backend",
      "- 2026-13-45 · meeting · Not a date · in Platform > Backend (id: " +
        idOf(900) +
        ")",
      "* something the server never wrote before",
    ];
    const started = scene(on, {
      tools: {
        ...platformTools(),
        get_timeline: () => fenced(timeline(lines)),
      },
    });

    await pulse($, started, "Platform");

    const ui = await $.ui.mount(pane("terminal"));

    expect(
      await ui.find({ text: "Backend · 2026-10-06 · 1 meeting, 1 session" }),
    ).toBeDefined();
    expect(
      await ui.find({ text: /3 lines of the timeline could not be read/ }),
    ).toBeDefined();
  });

  test("an entry filed where the outline lists no child is shown apart, never under a child", async ($, on) => {
    const lines = [
      line(
        "2026-10-06",
        "meeting",
        "Somewhere new",
        "Platform > Mobile",
        idOf(201),
      ),
      line(
        "2026-10-06",
        "meeting",
        "Not under here at all",
        "Sales > Backend",
        idOf(202),
      ),
    ];
    const started = scene(on, {
      tools: {
        ...platformTools(),
        get_timeline: () => fenced(timeline(lines)),
      },
    });

    await pulse($, started, "Platform");

    const ui = await $.ui.mount(pane("terminal"));
    const raster = await ui.find({ type: "Raster" });

    expect(rowNames(raster ?? { props: {} })).toEqual([
      "Backend",
      "Desktop",
      "Docs",
      "(elsewhere)",
    ]);
    expect(
      await ui.find({ text: "Backend · 2026-10-06 · nothing" }),
    ).toBeDefined();
  });

  test("a project with more children than the server listed says so", async ($, on) => {
    const started = scene(on, {
      tools: {
        ...platformTools(),
        open: () => json(platformOutline({ next_cursor: "abc" })),
      },
    });

    await pulse($, started, "Platform");

    const ui = await $.ui.mount(pane("terminal"));

    expect(
      await ui.find({
        text: /this project has more children than Fylgja listed/,
      }),
    ).toBeDefined();
  });
});
