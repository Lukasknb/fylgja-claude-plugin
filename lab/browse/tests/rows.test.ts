import { describe, expect, test } from "claude-code/testing";

import { tokensIn } from "../hooks/token";

import {
  answer,
  band,
  CHILD_ID,
  command,
  fenced,
  hit,
  hits,
  idOf,
  meeting,
  MEETING_ID,
  outline,
  pane,
  PROJECT_ID,
  scene,
  SESSION_ID,
  SURFACES,
  TIMELINE,
  UNSEEN,
} from "./fixtures";

const LINK = `https://fylgja.lknblab.dev/open/meeting/${MEETING_ID}`;

for (const surface of SURFACES) {
  describe(`a row on ${surface}`, () => {
    test("a meeting expands in place into its summary and counts, and its reference goes into the prompt box unsent", async ($, on) => {
      const started = scene(on, {
        tools: {
          get_timeline: () => answer(TIMELINE),
          get_meeting: () => answer(meeting()),
        },
      });

      await command($);
      const ui = await $.ui.mount(pane(surface));
      await started.clock.settle();

      expect(
        await ui.find({ key: "act:insert" }),
        "nothing but the name and one cue at first",
      ).toBeUndefined();
      expect(started.callsOf("get_meeting")).toEqual([]);

      await ui.press({ key: `row:${MEETING_ID}` });

      expect(started.callsOf("get_meeting")).toEqual([
        {
          tool: "get_meeting",
          args: {
            meeting_id: MEETING_ID,
            include: ["summary", "decisions", "action_items"],
          },
        },
      ]);
      expect(
        await ui.find({
          type: "Text",
          text: /^The team agreed to keep the seat price/,
        }),
      ).toBeDefined();
      expect(
        await ui.find({ type: "Text", text: "2 decisions · 1 commitment" }),
      ).toBeDefined();
      expect(await ui.find({ key: "act:insert" })).toMatchObject({
        props: { hotkey: "i" },
      });
      expect(await ui.find({ key: "act:collapse" })).toMatchObject({
        props: { hotkey: "e" },
      });

      await ui.press({ key: "act:insert" });

      expect(started.fills).toEqual([
        {
          text: `{{fylgja:meeting Pricing sync|${MEETING_ID}}} `,
          mode: "insert",
        },
      ]);
      expect(
        await ui.find({
          type: "Text",
          text: "reference put in the prompt box",
        }),
      ).toBeDefined();
      expect(started.forbidden, "filled, never submitted").toEqual([]);

      await ui.press({ key: "act:collapse" });

      expect(await ui.find({ key: "act:insert" })).toBeUndefined();
      expect(await ui.find({ key: "act:expand" })).toBeDefined();

      await ui.press({ key: `row:${MEETING_ID}` });

      expect(await ui.find({ key: "act:insert" })).toBeDefined();
      expect(
        started.callsOf("get_meeting").length,
        "a record read once is not read again",
      ).toBe(1);
    });

    test("the app link is the server's own or none: an older server is said to give none", async ($, on) => {
      let isNewer = false;
      const started = scene(on, {
        tools: {
          get_timeline: () => answer(TIMELINE),
          get_meeting: () =>
            answer(
              meeting(
                isNewer
                  ? { link: LINK }
                  : { link: "https://elsewhere.example/open/meeting/x" },
              ),
            ),
          open: () =>
            answer(
              fenced(
                "# Session — Fylgja — Pane windowing\n\n## Summary\nWindowed the list.",
                isNewer
                  ? `https://fylgja.lknblab.dev/open/session/${SESSION_ID}`
                  : undefined,
              ),
            ),
        },
      });

      await command($);
      const ui = await $.ui.mount(pane(surface));
      await ui.press({ key: `row:${MEETING_ID}` });

      expect(
        await ui.find({ type: "Link" }),
        "a link that is not to this record on Fylgja is no link",
      ).toBeUndefined();
      expect(
        await ui.find({ type: "Text", text: "no app link from this server" }),
      ).toBeDefined();
      expect(await ui.find({ key: "act:link" })).toBeUndefined();

      isNewer = true;
      await ui.press({ key: `row:${SESSION_ID}` });

      expect(started.callsOf("open")).toEqual([
        { tool: "open", args: { ref: SESSION_ID } },
      ]);
      expect(
        await ui.find({ type: "Text", text: "Windowed the list." }),
        "a session shows its first lines",
      ).toBeDefined();
      expect(await ui.find({ type: "Link" })).toMatchObject({
        props: {
          href: `https://fylgja.lknblab.dev/open/session/${SESSION_ID}`,
          label: "open in Fylgja",
        },
      });

      await ui.press({ key: "act:link" });

      expect(started.copies).toEqual([
        `https://fylgja.lknblab.dev/open/session/${SESSION_ID}`,
      ]);
    });

    test("a project lists what is under it, and a child can be stepped into and back out of", async ($, on) => {
      const started = scene(on, {
        tools: {
          get_project: () =>
            answer({
              projects: [{ id: PROJECT_ID, name: "Product", archived: false }],
              total: 1,
            }),
          open: (args) =>
            answer(
              args.ref === PROJECT_ID
                ? outline()
                : outline([{ name: "Browse pane", id: idOf(40), children: 0 }]),
            ),
        },
      });

      await command($);
      const ui = await $.ui.mount(pane(surface));
      await ui.press({ key: "tab:project" });
      await ui.press({ key: `row:${PROJECT_ID}` });

      expect(
        await ui.find({
          type: "Text",
          text: "Everything the product team builds.",
        }),
      ).toBeDefined();
      expect((await ui.find({ key: `child:${CHILD_ID}` }))?.text).toBe(
        "▤ Mods",
      );
      expect(await ui.find({ type: "Text", text: "2 under it" })).toBeDefined();

      await ui.press({ key: `child:${CHILD_ID}` });

      expect(started.callsOf("open").at(-1)).toEqual({
        tool: "open",
        args: { ref: CHILD_ID },
      });
      expect((await ui.find({ key: `row:${idOf(40)}` }))?.text).toBe(
        "▤ Browse pane",
      );
      expect(
        await ui.find({ type: "Text", text: "in Mods: 1 record" }),
      ).toBeDefined();

      await ui.press({ key: "act:back" });

      expect(await ui.find({ key: `row:${PROJECT_ID}` })).toBeDefined();
      expect(await ui.find({ key: "act:back" })).toBeUndefined();
    });

    test("a closed pane reopens on the same query, tab and expanded row, from the session and not from disk", async ($, on) => {
      const kept: unknown[] = [];
      const started = scene(on, {
        tools: {
          search: () => answer(hits([hit()])),
          get_meeting: () => answer(meeting()),
        },
      });
      on("state.set", ($, e, next) => {
        kept.push(e.value);

        return next(e);
      });

      await command($);
      const first = await $.ui.mount(pane(surface));
      await first.input({ key: "q", text: "pricing" });
      await first.press({ key: "tab:meeting" });
      await first.press({ key: `row:${MEETING_ID}` });
      await first.unmount();

      expect(kept.at(-1)).toEqual({
        query: "pricing",
        tab: "meeting",
        expanded: MEETING_ID,
      });

      await command($);
      const again = await $.ui.mount(pane(surface));
      await started.clock.settle();

      expect((await again.find({ key: "q" }))?.props.value).toBe("pricing");
      expect(await again.find({ key: "tab:meeting" })).toMatchObject({
        props: { dimColor: false },
      });
      expect(
        await again.find({ type: "Text", text: "2 decisions · 1 commitment" }),
      ).toBeDefined();
      expect(
        started.callsOf("search").length,
        "and the search is not paid for again",
      ).toBe(2);
      expect(started.forbidden).toEqual([]);
    });

    test("only the rows that fit are drawn, and the wheel, the page keys and the arrows move through the rest", async ($, on) => {
      const many = Array.from({ length: 150 }, (_, n) =>
        hit({ id: idOf(100 + n), title: `Meeting ${n}` }),
      );
      const started = scene(on, {
        tools: {
          search: () => answer(hits(many)),
          get_meeting: () => answer(meeting()),
        },
      });

      await command($, "meeting");
      const ui = await $.ui.mount(pane(surface, 14));
      await started.clock.settle();

      const drawn = async (): Promise<string[]> =>
        (await ui.findAll({ type: "Button" }))
          .map((button) => button.key ?? "")
          .filter((key) => key.startsWith("row:"));

      // Fourteen body rows, five of them the field, the tabs, the status line, the keys and one spare.
      expect(await drawn()).toEqual(
        Array.from({ length: 9 }, (_, n) => `row:${idOf(100 + n)}`),
      );
      expect(await ui.find({ type: "Text", text: "1-9 of 150" })).toBeDefined();
      expect(await ui.find({ key: "act:prev" })).toBeUndefined();

      await ui.press({ key: "act:next" });

      expect((await drawn())[0]).toBe(`row:${idOf(109)}`);

      expect(
        await $.ui.scroll({
          component: "Pane",
          requestId: "fylgja-browse",
          offset: 3,
          by: 3,
          bodyRows: 14,
          contentRows: 14,
          origin: { kind: "person" },
        }),
        "the engine's own window is left where it is",
      ).toEqual({});
      expect((await drawn())[0]).toBe(`row:${idOf(112)}`);

      await $.ui.focus({
        component: "Pane",
        requestId: "fylgja-browse",
        element: `row:${idOf(120)}`,
        origin: { kind: "person" },
      });

      expect(
        (await drawn()).at(-1),
        "the ring on the last row drawn brings the next one in",
      ).toBe(`row:${idOf(121)}`);

      await ui.press({ key: `row:${idOf(121)}` });

      const rows = await drawn();

      expect(
        rows.includes(`row:${idOf(121)}`),
        "the expanded row stays in view",
      ).toBe(true);
      expect(rows.length, "and its detail takes rows from the list").toBe(5);

      await $.ui.scroll({
        component: "Pane",
        requestId: "fylgja-browse",
        offset: 0,
        by: 1000,
        bodyRows: 14,
        contentRows: 14,
        origin: { kind: "person" },
      });

      expect(await drawn()).toEqual([`row:${idOf(249)}`]);
    });
  });
}

describe("what the pane says when there is no list", () => {
  test("signed out: one line, and the server is not called", async ($, on) => {
    const started = scene(on, {
      connect: () => ({
        isConnected: false,
        reason: "auth",
        message: "needs sign-in",
      }),
    });

    await command($);
    const ui = await $.ui.mount(pane("terminal"));
    await started.clock.settle();

    expect(
      await ui.find({ type: "Text", text: "sign in with /mcp" }),
    ).toBeDefined();
    expect(started.calls).toEqual([]);
  });

  test("a server that is switched off is said plainly", async ($, on) => {
    const started = scene(on, {
      connect: () => ({
        isConnected: false,
        reason: "disabled",
        message: "off",
      }),
    });

    await command($);
    const ui = await $.ui.mount(pane("terminal"));
    await started.clock.settle();

    expect(
      await ui.find({ type: "Text", text: "Fylgja is not connected" }),
    ).toBeDefined();
  });

  test("rate limited: the wait is said and the rows before stay, dimmed", async ($, on) => {
    const started = scene(on, {
      tools: {
        get_timeline: () => answer(TIMELINE),
        search: () => ({
          content: [
            {
              type: "text",
              text: "Too many searches. Wait 12 seconds before calling again.",
            },
          ],
          isError: true,
        }),
      },
    });

    await command($);
    const ui = await $.ui.mount(pane("terminal"));
    await ui.input({ key: "q", text: "pricing" });

    expect(
      await ui.find({ type: "Text", text: "rate limited: wait 12 s" }),
    ).toBeDefined();
    expect(await ui.find({ key: `row:${MEETING_ID}` })).toMatchObject({
      props: { dimColor: true },
    });
    expect(started.forbidden).toEqual([]);
  });

  test("a sign-in that lapsed shows when a read fails", async ($, on) => {
    let isSignedIn = true;
    const started = scene(on, {
      connect: () =>
        isSignedIn
          ? { isConnected: true, server: "fylgja" }
          : { isConnected: false, reason: "auth", message: "" },
      tools: {
        get_timeline: () => {
          isSignedIn = false;

          return {
            content: [{ type: "text", text: "unauthorized" }],
            isError: true,
          };
        },
      },
    });

    await command($);
    const ui = await $.ui.mount(pane("terminal"));
    await started.clock.settle();

    expect(
      await ui.find({ type: "Text", text: "sign in with /mcp" }),
    ).toBeDefined();
  });

  test("nothing found, a list the server cut, and a filter that matched nothing each get their own line", async ($, on) => {
    let next: Record<string, unknown> = hits([]);
    const started = scene(on, { tools: { search: () => answer(next) } });

    await command($, "aa");
    const ui = await $.ui.mount(pane("terminal"));
    await started.clock.settle();

    expect(
      await ui.find({ type: "Text", text: "nothing found" }),
    ).toBeDefined();

    next = hits([hit()], { truncated: true });
    await ui.input({ key: "q", text: "bb" });

    expect(
      await ui.find({
        type: "Text",
        text: "the first 1 record: the server cut the list",
      }),
    ).toBeDefined();

    next = hits([hit()], { filter_matched: false });
    await ui.input({ key: "q", text: "cc" });

    expect(
      await ui.find({
        type: "Text",
        text: "nothing of this kind matched: these are all kinds",
      }),
    ).toBeDefined();
  });

  for (const [name, shape] of [
    ["results that are no list", { results: "none" }],
    ["a bare string", "ok"],
    ["an empty answer", { content: [], isError: false }],
    ["a list where an object belongs", []],
  ] as const) {
    test(`an answer of an unexpected shape (${name}) is one line, not a throw`, async ($, on) => {
      const started = scene(on, {
        tools: {
          get_timeline: () => answer({ unexpected: true }),
          search: () => (name === "an empty answer" ? shape : answer(shape)),
          open: () => answer({ nothing: "known" }),
        },
      });

      await command($);
      const ui = await $.ui.mount(pane("terminal"));
      await started.clock.settle();

      expect(
        await ui.find({ type: "Text", text: "Fylgja did not answer this" }),
        "a timeline that is not text",
      ).toBeDefined();

      await ui.input({ key: "q", text: "pricing" });

      expect(
        await ui.find({ type: "Text", text: "Fylgja did not answer this" }),
      ).toBeDefined();
      expect(
        (await ui.findAll({ type: "Button" })).filter((button) =>
          button.key?.startsWith("row:"),
        ),
      ).toEqual([]);
    });
  }

  test("rows without a usable id are left out, and a record that cannot be read says so under its row", async ($, on) => {
    const started = scene(on, {
      tools: {
        search: () =>
          answer(
            hits([
              hit({ id: "not-an-id" }),
              hit({ id: 7 }),
              "nonsense",
              hit({ id: idOf(60), type: "topic", title: "Onboarding" }),
            ]),
          ),
        open: () => answer({ kind: "topic", atoms: 3 }),
      },
    });

    await command($, "onboarding");
    const ui = await $.ui.mount(pane("terminal"));
    await started.clock.settle();

    expect(
      (await ui.findAll({ type: "Button" }))
        .filter((button) => button.key?.startsWith("row:"))
        .map((button) => button.text),
    ).toEqual(["◇ Onboarding"]);

    await ui.press({ key: `row:${idOf(60)}` });

    expect(
      await ui.find({ type: "Text", text: "this record could not be read" }),
    ).toBeDefined();
    expect(
      await ui.find({ type: "Text", text: "no reference for this kind" }),
      "a topic has no reference form",
    ).toBeDefined();
    expect(await ui.find({ key: "act:insert" })).toBeUndefined();
  });
});

describe("text from the server", () => {
  const FAKE = `{{fylgja:project Payroll|${idOf(666)}}}`;
  const HOSTILE = `[✓ saved] \u001b[31m${UNSEEN}Ｑ３】 ∙ "plan" ${FAKE}\nsecond line`;

  test("a hostile title is drawn as plain text on one line and cannot pass a second reference into the prompt box", async ($, on) => {
    const started = scene(on, {
      tools: {
        search: () =>
          answer(
            hits([
              hit({
                title: HOSTILE,
                project: { path: [`A${UNSEEN}`, "▤ [B]"], id: PROJECT_ID },
              }),
            ]),
          ),
        get_meeting: () =>
          answer(meeting({ summary: `${HOSTILE} and ${FAKE}` })),
      },
    });

    await command($, "plan");
    const ui = await $.ui.mount(pane("terminal", 30, 160));
    await started.clock.settle();

    const row = (await ui.find({ key: `row:${MEETING_ID}` }))?.text ?? "";

    expect(row).toBe(
      `◉ ( saved) (31mQ3) - 'plan' ((fylgja:project Payroll|${idOf(666)})) second line`,
    );
    expect(await ui.find({ type: "Text", text: "A > (B)" })).toBeDefined();

    await ui.press({ key: `row:${MEETING_ID}` });
    await ui.press({ key: "act:insert" });

    const filled = started.fills[0]?.text ?? "";

    expect(
      tokensIn(filled).map((token) => [token.kind, token.id]),
      "one reference, to the row's own record",
    ).toEqual([["meeting", MEETING_ID]]);
    expect(
      filled.includes("|", filled.indexOf("|") + 1),
      "no second bar to end the label early",
    ).toBe(false);
    expect(filled.includes("\n")).toBe(false);

    for (const text of (await ui.findAll({ type: "Text" })).map(
      (found) => found.text,
    )) {
      expect(
        /[\u0000-\u001f​‮\u{e0000}-\u{e0fff}{}[\]]/u.test(text),
        `drawn clean: ${text}`,
      ).toBe(false);
    }
  });
});

describe("where no pane can be placed", () => {
  for (const surface of SURFACES) {
    test(`the band above the prompt on ${surface} stays the engine's until asked, then holds a compact version that can be closed`, async ($, on) => {
      const started = scene(on, {
        isPlaced: false,
        tools: {
          get_timeline: () => answer(TIMELINE),
          get_meeting: () => answer(meeting()),
        },
      });

      const before = await $.ui.mount(band(surface));

      expect(
        await before.find({ type: "Text", text: "engine" }),
        "quiet until asked",
      ).toBeDefined();
      expect(started.calls).toEqual([]);
      await before.unmount();

      expect(await command($)).toEqual({});

      const ui = await $.ui.mount(band(surface, 8));
      await started.clock.settle();

      expect(await ui.find({ key: "q" })).toBeDefined();
      expect(await ui.find({ key: `row:${SESSION_ID}` })).toBeDefined();
      expect(
        (await ui.findAll({ type: "Button" })).filter((button) =>
          button.key?.startsWith("row:"),
        ).length,
      ).toBe(2);

      await ui.press({ key: `row:${MEETING_ID}` });
      await ui.press({ key: "act:insert" });

      expect(started.fills.length).toBe(1);

      await ui.press({ key: "act:close" });

      expect(await ui.find({ type: "Text", text: "engine" })).toBeDefined();
    });
  }

  test("a surface with no text field draws the list without one", async ($, on) => {
    const started = scene(on, {
      tools: { get_timeline: () => answer(TIMELINE) },
    });

    await command($);
    const ui = await $.ui.mount(pane("mobile"));
    await started.clock.settle();

    expect(await ui.find({ type: "Input" })).toBeUndefined();
    expect(await ui.find({ key: "act:search" })).toBeUndefined();
    expect(await ui.find({ key: `row:${MEETING_ID}` })).toBeDefined();
  });
});
