import { describe, expect, test } from "claude-code/testing";

import {
  answer,
  command,
  hit,
  hits,
  idOf,
  MEETING_ID,
  NOTE_ID,
  pane,
  PROJECT_ID,
  scene,
  SESSION_ID,
  SURFACES,
  TIMELINE,
} from "./fixtures";

const SESSION = {
  surface: "terminal",
  isInteractive: true,
  cwd: "/work/repo",
} as const;

for (const surface of SURFACES) {
  describe(`/fylgja on ${surface}`, () => {
    test("is a command that runs mid-turn, prints nothing, and opens a focused pane on the last two weeks", async ($, on) => {
      const started = scene(on, {
        tools: { get_timeline: () => answer(TIMELINE) },
      });
      await $.session.start(SESSION);

      expect(started.registered).toMatchObject([{ name: "fylgja", immediate: true }]);
      expect(started.calls, "nothing is read before the person asks").toEqual(
        [],
      );

      expect(await command($), "no line in the transcript, no turn").toEqual(
        {},
      );
      expect(started.opens).toMatchObject([
        { id: "fylgja-browse", focus: true },
      ]);

      const ui = await $.ui.mount(pane(surface));
      await started.clock.settle();

      expect(started.calls).toEqual([
        { tool: "get_timeline", args: { limit: 100 } },
      ]);
      expect((await ui.find({ key: `row:${SESSION_ID}` }))?.text).toBe(
        "⌁ Pane windowing",
      );
      expect((await ui.find({ key: `row:${MEETING_ID}` }))?.text).toBe(
        "◉ Pricing sync",
      );
      expect(await ui.find({ type: "Text", text: "2026-10-02" })).toBeDefined();
      expect(
        await ui.find({ type: "Text", text: "Sales > Pricing" }),
        "where it is filed, dimmed",
      ).toMatchObject({
        props: { dimColor: true },
      });
      expect(await ui.find({ type: "Text", text: "Product > Mods" })).toBeDefined();
      expect(await ui.find({ type: "Text", text: "2 records" })).toBeDefined();
      expect(started.forbidden).toEqual([]);
    });

    test("typing searches once the typing rests, and the rows before stay, dimmed, until the answer is in", async ($, on) => {
      const started = scene(on, {
        tools: {
          get_timeline: () => answer(TIMELINE),
          search: async (args, clock) => {
            await clock.sleep(300);

            return answer(
              hits([
                hit({ id: idOf(7), title: `About ${String(args.query)}` }),
              ]),
            );
          },
        },
      });

      await command($);
      const ui = await $.ui.mount(pane(surface));
      await started.clock.settle();

      await ui.input({ key: "q", text: "p", kind: "change" });
      await started.clock.advance(2000);

      expect(
        started.callsOf("search"),
        "one character is not worth a billed search",
      ).toEqual([]);
      expect(
        await ui.find({ key: `row:${MEETING_ID}` }),
        "and empties nothing",
      ).toBeDefined();

      await ui.input({ key: "q", text: "pr", kind: "change" });
      await started.clock.advance(300);
      await ui.input({ key: "q", text: "pri", kind: "change" });
      await started.clock.advance(449);

      expect(
        started.callsOf("search"),
        "nothing is sent while the person types",
      ).toEqual([]);
      expect(
        (await ui.find({ key: "q" }))?.props.value,
        "the field keeps what was typed",
      ).toBe("pri");
      expect(await ui.find({ key: `row:${MEETING_ID}` })).toMatchObject({
        props: { dimColor: true },
      });

      await started.clock.advance(1);

      expect(started.callsOf("search")).toEqual([
        { tool: "search", args: { query: "pri", limit: 20 } },
      ]);
      expect(await ui.find({ type: "Text", text: "searching…" })).toBeDefined();
      expect(
        await ui.find({ key: `row:${MEETING_ID}` }),
        "still the rows before",
      ).toBeDefined();

      await started.clock.advance(300);

      expect((await ui.find({ key: `row:${idOf(7)}` }))?.text).toBe(
        "◉ About pri",
      );
      expect(await ui.find({ key: `row:${idOf(7)}` })).toMatchObject({
        props: { dimColor: false },
      });
      expect(await ui.find({ key: `row:${MEETING_ID}` })).toBeUndefined();
    });

    test("an answer to a query the person has typed past is not shown", async ($, on) => {
      const started = scene(on, {
        tools: {
          get_timeline: () => answer(TIMELINE),
          search: async (args, clock) => {
            await clock.sleep(args.query === "slow" ? 5000 : 10);

            return answer(
              hits([
                hit({
                  id: idOf(args.query === "slow" ? 8 : 9),
                  title: String(args.query),
                }),
              ]),
            );
          },
        },
      });

      await command($);
      const ui = await $.ui.mount(pane(surface));
      await ui.input({ key: "q", text: "slow" });
      await started.clock.advance(100);
      await ui.input({ key: "q", text: "fast" });
      await started.clock.advance(10);

      expect(await ui.find({ key: `row:${idOf(9)}` })).toBeDefined();

      await started.clock.advance(6000);

      expect(
        await ui.find({ key: `row:${idOf(9)}` }),
        "the late answer changes nothing",
      ).toBeDefined();
      expect(await ui.find({ key: `row:${idOf(8)}` })).toBeUndefined();

      await ui.input({ key: "q", text: "slow" });

      expect(
        await ui.find({ key: `row:${idOf(8)}` }),
        "but it was paid for, so it is kept",
      ).toBeDefined();
      expect(started.callsOf("search").length).toBe(2);
    });

    test("the tabs narrow the search on the server, list projects by themselves, and ask nothing twice", async ($, on) => {
      const started = scene(on, {
        tools: {
          get_timeline: () => answer(TIMELINE),
          get_project: () =>
            answer({
              projects: [{ id: PROJECT_ID, name: "Product", archived: false }],
              total: 1,
            }),
          search: (args) =>
            answer(
              hits(
                args.kind === undefined
                  ? [
                      hit(),
                      hit({
                        id: NOTE_ID,
                        type: "note",
                        title: "Pricing notes",
                      }),
                    ]
                  : [
                      hit({
                        id: idOf(20),
                        type: args.kind,
                        title: `A ${String(args.kind)}`,
                      }),
                    ],
              ),
            ),
        },
      });

      await command($, "pricing");
      const ui = await $.ui.mount(pane(surface));
      await started.clock.settle();

      expect(
        started.callsOf("search"),
        "what follows the command is searched at once",
      ).toEqual([{ tool: "search", args: { query: "pricing", limit: 20 } }]);
      expect(await ui.find({ key: "tab:recent" })).toMatchObject({
        props: { hotkey: "1", dimColor: false },
      });
      expect(await ui.find({ key: "tab:meeting" })).toMatchObject({
        props: { hotkey: "2", dimColor: true },
      });

      await ui.press({ key: "tab:meeting" });
      await ui.press({ key: "tab:session" });
      await ui.press({ key: "tab:project" });

      expect(started.callsOf("search").map((call) => call.args.kind)).toEqual([
        undefined,
        "meeting",
        "session",
        "project",
      ]);
      expect((await ui.find({ key: `row:${idOf(20)}` }))?.text).toBe(
        "▤ A project",
      );

      await ui.press({ key: "tab:note" });

      expect(
        await ui.find({ key: `row:${NOTE_ID}` }),
        "notes are kept from the unnarrowed answer",
      ).toBeDefined();
      expect(await ui.find({ key: `row:${MEETING_ID}` })).toBeUndefined();

      await ui.press({ key: "tab:meeting" });
      await ui.press({ key: "tab:recent" });

      expect(
        started.callsOf("search").length,
        "an answer already held is not paid for again",
      ).toBe(4);

      await ui.input({ key: "q", text: "" });
      await ui.press({ key: "tab:project" });

      expect(started.callsOf("get_project")).toEqual([
        { tool: "get_project", args: { limit: 200 } },
      ]);
      expect((await ui.find({ key: `row:${PROJECT_ID}` }))?.text).toBe(
        "▤ Product",
      );

      await ui.press({ key: "tab:meeting" });

      expect(
        await ui.find({ key: `row:${MEETING_ID}` }),
        "with nothing typed, the recent meetings",
      ).toBeDefined();
      expect(await ui.find({ key: `row:${SESSION_ID}` })).toBeUndefined();

      await ui.press({ key: "tab:note" });

      expect(
        await ui.find({ type: "Text", text: "type 2 characters to search notes" }),
      ).toBeDefined();
    });
  });
}
