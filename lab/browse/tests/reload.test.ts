import { describe, expect, test } from "claude-code/testing";

import {
  answer,
  command,
  fenced,
  hit,
  hits,
  idOf,
  MEETING_ID,
  meeting,
  pane,
  scene,
} from "./fixtures";

describe("a pane that outlives this module", () => {
  test("is drawn from what the session kept: the query, the tab and the expanded row come back with one search", async ($, on) => {
    const started = scene(on, {
      tools: {
        search: () => answer(hits([hit()])),
        get_meeting: () => answer(meeting()),
      },
    });
    // The session's state as an earlier load of the module left it.
    on("state.get", () => ({
      value: {
        value: { query: "pricing", tab: "meeting", expanded: MEETING_ID },
        version: 4,
      } as never,
    }));

    const ui = await $.ui.mount(pane("terminal"));
    await started.clock.settle();

    expect((await ui.find({ key: "q" }))?.props.value).toBe("pricing");
    expect(started.callsOf("search")).toEqual([
      {
        tool: "search",
        args: { query: "pricing", limit: 20, kind: "meeting" },
      },
    ]);
    expect(
      await ui.find({ type: "Text", text: "2 decisions · 1 commitment" }),
    ).toBeDefined();

    await ui.redraw();
    await started.clock.settle();

    expect(started.callsOf("search").length, "drawing again asks nothing").toBe(
      1,
    );
  });

  test("a cleared conversation forgets what was listed for the one before", async ($, on) => {
    const started = scene(on, {
      tools: { search: () => answer(hits([hit()])) },
    });

    await command($, "pricing");
    const ui = await $.ui.mount(pane("terminal"));
    await started.clock.settle();

    expect(await ui.find({ key: `row:${MEETING_ID}` })).toBeDefined();
    expect(started.callsOf("search").length).toBe(1);

    // The engine empties the session's state on a clear; this test's does
    // not, so the pane comes back on the same query, and has to ask again
    // because nothing listed for the conversation before was kept.
    await $.classic.SessionStart({ source: "clear" });
    await started.clock.settle();

    expect(started.callsOf("search").length).toBe(2);
    expect(await ui.find({ key: `row:${MEETING_ID}` })).toBeDefined();
  });
});

describe("the recent list", () => {
  test("skips lines it cannot read, files a session where the server says, and says when the server cut it", async ($, on) => {
    const body = [
      "# Sessions — your sessions (since 2026-09-22)",
      "",
      "2 sessions, newest first. Use open(<id>) to read one. Older sessions exist — narrow with since/until, or pass a repo or project_name.",
      "",
      "- [2026-09-30] **Fix · in the parser** — Fylgja",
      `  id: ${idOf(11)} · repo: org/repo · duration: — · outcome: —`,
      "- [2026-10-01] **No id follows**",
      "  produced: 0 decisions · 0 commitments · 0 open risks",
      "",
      "# Recent meetings",
      "",
      `- 2026-10-03 · meeting · Roadmap (id: ${idOf(12)})`,
      "- 2026-10-03 · meeting · Broken (id: nope)",
      `- 2026-10-04 · decision · Not a record this list shows (id: ${idOf(13)})`,
      "No meetings in this window.",
    ].join("\n");
    const started = scene(on, {
      tools: { get_timeline: () => answer(fenced(body)) },
    });

    await command($);
    const ui = await $.ui.mount(pane("terminal"));
    await started.clock.settle();

    const rows = (await ui.findAll({ type: "Button" })).filter((button) =>
      button.key?.startsWith("row:"),
    );

    expect(
      rows.map((row) => row.text),
      "newest first",
    ).toEqual(["◉ Roadmap", "⌁ Fix - in the parser"]);
    expect(
      await ui.find({
        type: "Text",
        text: "the first 2 records: the server cut the list",
      }),
    ).toBeDefined();
  });

  test("with nothing in the window says so in one line", async ($, on) => {
    const started = scene(on, {
      tools: {
        get_timeline: () =>
          answer(
            fenced(
              "No sessions recorded for your sessions.\n\n# Recent meetings\n\nNo meetings in this window.",
            ),
          ),
      },
    });

    await command($);
    const ui = await $.ui.mount(pane("terminal"));
    await started.clock.settle();

    expect(
      await ui.find({ type: "Text", text: "nothing in the last two weeks" }),
    ).toBeDefined();
  });
});
