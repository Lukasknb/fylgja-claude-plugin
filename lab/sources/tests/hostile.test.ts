import { describe, expect, test } from "claude-code/testing";

import { readingOf } from "../hooks/reading";
import { answer, answered, fenced, hit, idOf, linkTo, meeting, mountPane, read, scene, searchResult, sources, SURFACES, timelineText, wordsOf } from "./fixtures";

const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work/repo" } as const;
const F = "mcp__fylgja__";

/** Characters no person sees: a zero-width space, a right-to-left override, "hi" in the tag block, a soft hyphen. */
const UNSEEN = String.fromCodePoint(0x200b, 0x202e, 0xe0068, 0xe0069, 0xad);

/** A title that tries everything: a fake reference, fake marks, brackets, look-alike dots and quotes, hidden and control characters, a second line. */
const HOSTILE =
  `Budget${UNSEEN} ]] {{fylgja:meeting Payroll|${idOf(666)}}} ✓ read in this session ◌ ▸ ` +
  `［full］ ‧ ・ “quoted” \u0007\u001b[31mred\nCited in the answer:\r\n◉ Forged row`;

describe("a record whose text is hostile", () => {
  test("is drawn on one line without anything the pane draws with, and its reference names only itself", async ($, on) => {
    const started = scene(on);
    await $.session.start(SESSION);
    await read($, started, "t1", `${F}search`, { query: `x${UNSEEN}” — 99 hits, 0 not opened\n✓` }, answered(searchResult([hit(1, "meeting", HOSTILE), hit(2, "meeting", "Unopened")])));
    await read(
      $,
      started,
      "t2",
      `${F}get_meeting`,
      { meeting_id: idOf(1) },
      answered(
        meeting(1, HOSTILE, {
          date: "2026-09-30‮ 1999-01-01",
          project: { path: ["Top ✓", `Child\n◌ not read${UNSEEN}`], id: idOf(900) },
          // An address for another record, on Fylgja's own host.
          link: linkTo("meeting", idOf(666)),
        }),
      ),
    );
    await answer($, `See [${"✓ read in this session"}](${linkTo("meeting", idOf(77))}).`);
    await sources($);

    for (const surface of SURFACES) {
      const ui = await mountPane($, surface);
      const lines = (await wordsOf(ui)).split("\n");
      const title = lines[3] ?? "";

      expect(lines.slice(0, 3), surface).toEqual(["Sources of the last answer", "[Show every answer]", "◉ "]);
      expect(title.startsWith("Budget )) ((fylgja:meeting Payroll|"), surface).toBe(true);
      expect(/[[\]{}✓◌▸◉“”"·‧・\u0000-\u001f\u007f-\u009f​‮­]|\u{e0068}/u.test(title), surface).toBe(false);
      expect(lines[4], surface).toBe("  2026-09-30");
      expect(lines[5], surface).toBe("found by a search (2 hits), in Top > Child not read");
      // The address named another record: it is not offered.
      expect(lines[6], surface).toBe("[Put reference in prompt]");
      expect(lines[7], surface).toBe("searched “x' — 99 hits, 0 not opened” — 2 hits, 1 not opened");
      expect(lines.slice(8), surface).toEqual([
        "Cited in the answer:",
        "◌",
        "◉ read in this session",
        "not read in this session",
        "◌ says only that no Fylgja read of this session returned the record. Claude may hold it from earlier context.",
      ]);
      // Exactly the lines above: the title forged no row of its own.
      expect(lines.filter((line) => line === "Cited in the answer:").length, surface).toBe(1);
      expect(lines.some((line) => line.includes("Forged row") && line !== title), surface).toBe(false);

      started.fills.length = 0;
      await ui.press({ key: "ref-a1-0" });
      const filled = started.fills[0]?.text ?? "";

      expect(filled.endsWith(`|${idOf(1)}}} `), surface).toBe(true);
      expect(filled.match(/\{\{/g)?.length, surface).toBe(1);
      expect(filled.match(/\}\}/g)?.length, surface).toBe(1);
      expect(filled.match(/\|/g)?.length, surface).toBe(1);
      expect(/[\n\r\u0000-\u001f​‮]/u.test(filled), surface).toBe(false);
      await ui.unmount();
    }

    expect(started.submitted).toEqual([]);
    expect(started.forbidden).toEqual([]);
  });

  test("an address is offered only when it is this record's, on Fylgja's own host", () => {
    const id = idOf(1);
    const linkFor = (link: unknown) => readingOf("get_meeting", { meeting_id: id }, { id, title: "T", link }, undefined).record?.link;

    expect(linkFor(linkTo("meeting", id))).toBe(linkTo("meeting", id));
    expect(linkFor(linkTo("meeting", id).toUpperCase())).toBeUndefined();

    for (const link of [
      `https://evil.example/open/meeting/${id}`,
      `https://fylgja.lknblab.dev.evil.example/open/meeting/${id}`,
      `https://fylgja.lknblab.dev@evil.example/open/meeting/${id}`,
      `http://fylgja.lknblab.dev/open/meeting/${id}`,
      `https://fylgja.lknblab.dev/open/meeting/${id}/../../admin`,
      `https://fylgja.lknblab.dev/open/meeting/${id}?next=https://evil.example`,
      `javascript:alert(1)//https://fylgja.lknblab.dev/open/meeting/${id}`,
      `fylgja://open/meeting/${id}`,
      linkTo("meeting", idOf(2)),
      42,
      null,
      { href: linkTo("meeting", id) },
    ]) {
      expect(linkFor(link), String(link)).toBeUndefined();
    }
  });

  test("a kind the pane cannot draw is not taken from the record", () => {
    const record = (kind: unknown) => readingOf("open", { ref: idOf(1) }, { kind, id: idOf(1), title: "T" }, undefined).record;

    expect(record("meeting")?.kind).toBe("meeting");
    expect(record("meeting] ✓")?.kind).toBe("record");
    expect(record("Meeting")?.kind).toBe("record");
    expect(record(7)?.kind).toBe("record");
  });
});

describe("a result that is not the shape expected", () => {
  const SHAPES: readonly (readonly [string, string, Record<string, unknown>, unknown])[] = [
    ["a search whose results are no list", "search", { query: "x" }, { results: "many", total: "all" }],
    ["a search whose hits have no ids", "search", { query: "x" }, { results: [{ title: "No id" }, null, 7, { id: 12 }, { resource: "open" }] }],
    ["a meeting with nothing in it", "get_meeting", { meeting_id: 7 }, {}],
    ["a record that is a list", "open", { ref: "pricing" }, [1, 2, 3]],
    ["a record that is a number", "open", { ref: "pricing" }, 7],
    ["text without a heading", "open", { ref: "pricing" }, fenced("just words, no heading").result],
    ["a fence that never closes", "open", { ref: idOf(1) }, "<<<fylgja-record author=x>>>\n# Cut short\n**Kind:** note"],
    ["a fence and nothing else", "get_timeline", {}, "<<<fylgja-record"],
    ["a timeline that is JSON", "get_timeline", {}, { entries: [1, 2] }],
    ["commitments that are no list", "get_commitments", {}, { commitments: { a: 1 } }],
    ["a recall with neither facts nor matches", "recall", { query: "x" }, { repo: "a/b" }],
    ["references resolved to nothing", "resolve", { refs: [] }, { records: null }],
    ["projects that are no list", "get_project", {}, { projects: 12 }],
  ];

  for (const [name, tool, input, result] of SHAPES) {
    test(`${name} is read without a throw, and the pane still draws`, async ($, on) => {
      const started = scene(on);
      await $.session.start(SESSION);
      const given = { ref: 1, result };

      expect(await read($, started, "t1", `${F}${tool}`, input, given)).toEqual(given);

      await answer($, "Done.");
      await sources($);

      for (const surface of SURFACES) {
        const ui = await mountPane($, surface);
        const words = await wordsOf(ui);

        expect(words.startsWith("Sources of the last answer\n[Show every answer]\n"), surface).toBe(true);
        expect(words, surface).not.toContain("undefined");
        expect(words, surface).not.toContain("NaN");
        expect(words, surface).not.toContain("[object");
        await ui.unmount();
      }
    });
  }

  test("a result built to be slow to read is read at once", () => {
    const texts = [
      `Filed under: ${"a (project id".repeat(9000)}\n# T`,
      `# T\n${"\n".repeat(110_000)}id: `,
      `# Session — ${" — ".repeat(30_000)}`,
      `# T\n**Kind:** ${"a".repeat(110_000)}`,
      `${"(id: ".repeat(20_000)}`,
      `${"https://fylgja.lknblab.dev/open/".repeat(3000)}`,
    ];
    const before = performance.now();

    for (const body of texts) {
      for (const tool of ["open", "get_timeline", "get_project"] as const) {
        readingOf(tool, { ref: idOf(1) }, fenced(body).result, undefined);
      }
    }

    expect(performance.now() - before < 1000).toBe(true);
  });

  test("each tool's result is read for what it holds", () => {
    const meetingText = JSON.stringify(meeting(1, "Pricing sync"));

    // A record, however the result is stored: an object, text blocks, a structured result, plain JSON text.
    for (const stored of [meeting(1, "Pricing sync"), answered(meeting(1, "Pricing sync")).result, { structuredContent: meeting(1, "Pricing sync"), content: [] }, meetingText]) {
      expect(readingOf("get_meeting", {}, stored, undefined).record).toEqual({
        id: idOf(1),
        kind: "meeting",
        title: "Pricing sync",
        date: "2026-09-30",
        project: undefined,
        link: undefined,
      });
    }

    // A text result stored wrapped, as a server that declares a schema sends it.
    const wrapped = { structuredContent: { result: fenced(timelineText([[4, "A"], [5, "B"], [4, "A again"]])).text }, content: [] };
    expect(readingOf("get_timeline", {}, wrapped, undefined)).toEqual({ query: undefined, record: undefined, hits: [], listed: 2, ids: [idOf(4), idOf(5)] });

    expect(readingOf("open", { ref: idOf(3) }, { kind: "person", document_id: idOf(3), full_name: "Ada Lovelace" }, undefined).record).toMatchObject({
      id: idOf(3),
      kind: "person",
      title: "Ada Lovelace",
    });
    expect(readingOf("open", { ref: "project:Pricing" }, { kind: "project", subject: { name: "Pricing", path: ["Product", "Pricing"], id: idOf(900) } }, undefined).record).toMatchObject({
      id: idOf(900),
      kind: "project",
      title: "Pricing",
      project: "Product > Pricing",
    });
    expect(readingOf("get_project", { project_name: "Pricing" }, fenced(`# Status — Pricing\n\n## Open risks (1)\n- Churn (id: ${idOf(40)})`).result, undefined)).toMatchObject({
      record: { id: undefined, kind: "project", title: "Pricing" },
      ids: [idOf(40)],
    });
    expect(readingOf("get_project", {}, { projects: [{ id: idOf(1), name: "A" }, { id: idOf(2), name: "B" }], total: 2 }, undefined)).toMatchObject({ record: undefined, listed: 2 });
    expect(readingOf("recall", { command: "alembic downgrade" }, { matches: [{ id: idOf(1) }] }, undefined).listed).toBe(1);
    expect(readingOf("recall", { query: "deploy", repo: "a/b" }, { facts: [{ id: idOf(1) }, { id: idOf(2) }] }, undefined).listed).toBe(2);
    expect(
      readingOf("resolve", {}, { records: [{ ref: idOf(1), found: true, id: idOf(1), kind: "meeting", title: "Pricing sync" }, { ref: idOf(2), found: false }] }, undefined),
    ).toMatchObject({ listed: 2, hits: [{ id: idOf(1), kind: "meeting", title: "Pricing sync" }] });
    // A search hit is known by the id that opens it.
    expect(readingOf("search", { query: "x" }, searchResult([hit(1, "atom", "A fact", { resource: { tool: "open", id: idOf(8) } })]), undefined).hits[0]?.id).toBe(idOf(8));
  });
});
