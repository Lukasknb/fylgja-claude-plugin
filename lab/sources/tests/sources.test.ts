import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import { SIGN_IN_LINE } from "../hooks/pane";
import {
  answer,
  answered,
  fenced,
  hit,
  idOf,
  linkTo,
  meeting,
  mountPane,
  read,
  scene,
  searchResult,
  sessionText,
  sources,
  SURFACES,
  timelineText,
  wordsOf,
} from "./fixtures";
import type { Scene } from "./fixtures";

const SESSION = {
  surface: "terminal",
  isInteractive: true,
  cwd: "/work/repo",
} as const;
const F = "mcp__plugin_fylgja_fylgja__";

const NOTE = [
  "# Pricing notes",
  "",
  "**Kind:** note · **Origin:** desktop · **Status:** current · **Project:** Pricing",
  "",
  "## Tiers",
  "Three.",
].join("\n");

/** Claude researches a question the way it does: search, open a hit, look at the timeline, open from it, open one directly. */
async function research($: Engine, started: Scene): Promise<void> {
  const hits = [
    hit(1, "meeting", "Pricing sync"),
    hit(2, "session", "Tiers"),
    hit(3, "meeting", "Old sync"),
  ];

  await read(
    $,
    started,
    "t1",
    `${F}search`,
    { query: "pricing decision" },
    answered(searchResult(hits)),
  );
  await read(
    $,
    started,
    "t2",
    `${F}get_meeting`,
    { meeting_id: idOf(1) },
    answered(meeting(1, "Pricing sync", { link: linkTo("meeting", idOf(1)) })),
  );
  await read(
    $,
    started,
    "t3",
    `${F}get_timeline`,
    { project_name: "Pricing" },
    fenced(
      timelineText([
        [4, "Roadmap review"],
        [5, "Kickoff"],
      ]),
    ),
  );
  await read(
    $,
    started,
    "t4",
    `${F}open`,
    { ref: idOf(4) },
    answered({
      kind: "meeting",
      id: idOf(4),
      title: "Roadmap review",
      date: "2026-09-12",
      project: { path: ["Product", "Roadmap"], id: idOf(901) },
    }),
  );
  await read(
    $,
    started,
    "t5",
    `${F}open`,
    { ref: idOf(2) },
    fenced(sessionText(2, "Tiers")),
  );
  await read(
    $,
    started,
    "t6",
    `${F}open`,
    { ref: `{{fylgja:note Pricing notes|${idOf(6)}}}` },
    fenced(NOTE),
  );
  await read(
    $,
    started,
    "t7",
    `${F}get_commitments`,
    { owner: "me" },
    answered({
      commitments: [
        { id: idOf(30), what: "Ship" },
        { id: idOf(31), what: "Tell" },
      ],
    }),
  );
}

const ANSWER =
  `We raised the price in [the sync](${linkTo("meeting", idOf(1))}), planned at [the kickoff](${linkTo("meeting", idOf(5))}), ` +
  `and confirmed in [the board call](${linkTo("meeting", idOf(77))}).`;

describe("/sources after an answer that used Fylgja", () => {
  test("lists the records Claude opened, in the order read, each with how it was reached", async ($, on) => {
    const started = scene(on);
    await $.session.start(SESSION);
    await research($, started);
    await answer($, ANSWER);

    expect(await sources($)).toEqual({});
    expect(started.opened).toEqual(["fylgja-sources"]);

    for (const surface of SURFACES) {
      const ui = await mountPane($, surface);
      const words = await wordsOf(ui);

      expect(words, surface).toBe(
        [
          "Sources of the last answer",
          "[Show every answer]",
          "◉ ",
          "Pricing sync",
          "  2026-09-30",
          "found by a search (3 hits)",
          `<Open in Fylgja → ${linkTo("meeting", idOf(1))}>`,
          "[Put reference in prompt]",
          "◉ ",
          "Roadmap review",
          "  2026-09-12",
          "listed in the timeline, in Product > Roadmap",
          "[Put reference in prompt]",
          "⌁ ",
          "Tiers",
          "  2026-10-01",
          "found by a search (3 hits), in Product > Pricing",
          "[Put reference in prompt]",
          "✎ ",
          "Pricing notes",
          "opened directly",
          "[Put reference in prompt]",
          "searched “pricing decision” — 3 hits, 1 not opened",
          "also read: the timeline (2 entries), 2 commitments",
          "Cited in the answer:",
          "✓",
          "◉ Pricing sync",
          "read in this session",
          "✓",
          "◉ the kickoff",
          "returned by a search or a list, not opened",
          "◌",
          "◉ the board call",
          "not read in this session",
          "◌ says only that no Fylgja read of this session returned the record. Claude may hold it from earlier context.",
        ].join("\n"),
      );
      await ui.unmount();
    }

    expect(started.forbidden).toEqual([]);
  });

  test("“Put reference in prompt” fills the prompt box at the cursor and sends nothing", async ($, on) => {
    const started = scene(on);
    await $.session.start(SESSION);
    await research($, started);
    await answer($, ANSWER);
    await sources($);

    for (const surface of SURFACES) {
      started.fills.length = 0;
      const ui = await mountPane($, surface);

      await ui.press({ key: "ref-a1-0" });
      await ui.press({ key: "ref-a1-2" });

      expect(started.fills, surface).toEqual([
        { text: `{{fylgja:meeting Pricing sync|${idOf(1)}}} `, mode: "insert" },
        { text: `{{fylgja:session Tiers|${idOf(2)}}} `, mode: "insert" },
      ]);
      expect(await wordsOf(ui), surface).not.toContain("could not take");
      await ui.unmount();
    }

    expect(started.submitted).toEqual([]);
    expect(started.forbidden).toEqual([]);
  });

  test("a prompt box that cannot take the reference is said in one line", async ($, on) => {
    const started = scene(on);
    await $.session.start(SESSION);
    await research($, started);
    await answer($, ANSWER);
    await sources($);
    started.box.isFilled = false;

    const ui = await mountPane($);
    await ui.press({ key: "ref-a1-0" });

    expect(await wordsOf(ui)).toContain(
      "The prompt box could not take the reference just now.",
    );
  });

  test("an answer that read nothing says so, and still judges what it cites", async ($, on) => {
    const started = scene(on);
    await $.session.start(SESSION);
    await research($, started);
    await answer($, "First answer.");
    await answer(
      $,
      `From memory: [the sync](${linkTo("meeting", idOf(1))}) and [a thing](${linkTo("note", idOf(88))}).`,
    );
    await sources($);

    const words = await wordsOf(await mountPane($));

    expect(words).toContain("Nothing was opened in Fylgja for this answer.");
    // Read for an earlier answer of this session: backed.
    expect(words).toContain("✓\n◉ Pricing sync\nread in this session");
    expect(words).toContain("◌\n✎ a thing\nnot read in this session");
    expect(words).not.toContain("Roadmap review");
  });

  test("before any answer, the pane says so", async ($, on) => {
    scene(on);
    await $.session.start(SESSION);
    await sources($);

    expect(await wordsOf(await mountPane($))).toBe(
      [
        "Sources of the last answer",
        "[Show every answer]",
        "Claude has not answered in this conversation yet.",
      ].join("\n"),
    );
  });

  test("with no room for a pane, the command says so in fixed words", async ($, on) => {
    const started = scene(on);
    started.room.isPlaced = false;
    await $.session.start(SESSION);
    await research($, started);
    await answer($, ANSWER);

    expect(await sources($)).toEqual({
      text: "Sources: there is no room to show the pane here.",
    });
  });
});

describe("a pane left open", () => {
  test("follows the next answer", async ($, on) => {
    const started = scene(on);
    await $.session.start(SESSION);
    await answer($, "Hello.");
    await sources($);

    const ui = await mountPane($);

    expect(await wordsOf(ui)).toContain("Nothing was opened in Fylgja for this answer.");

    await read($, started, "t1", `${F}get_meeting`, { meeting_id: idOf(5) }, answered(meeting(5, "Kickoff")));
    await answer($, "It started in September.");

    expect(await wordsOf(ui)).toContain("◉ \nKickoff\n  2026-09-30\nopened directly");
    // Following an answer opens nothing: the one pane is the one the person asked for.
    expect(started.opened).toEqual(["fylgja-sources"]);
  });
});

describe("/sources all", () => {
  test("lists every answer newest first, folded to counts, and unfolds one on a press", async ($, on) => {
    const started = scene(on);
    await $.session.start(SESSION);
    await research($, started);
    await answer($, ANSWER);
    await answer($, "Nothing to add.");
    await read(
      $,
      started,
      "t8",
      `${F}get_meeting`,
      { meeting_id: idOf(5) },
      answered(meeting(5, "Kickoff")),
    );
    await answer($, `See [the kickoff](${linkTo("meeting", idOf(5))}).`);
    await sources($, "all");

    for (const surface of SURFACES) {
      const ui = await mountPane($, surface);

      expect(await wordsOf(ui), surface).toBe(
        [
          "Sources of every answer, newest first",
          "[Show the last answer]",
          "[▸ Answer 3 — 1 record, 1 citation]",
          "[▸ Answer 2 — nothing opened]",
          "[▸ Answer 1 — 4 records, 1 of 3 citations not read]",
        ].join("\n"),
      );

      await ui.press({ key: "fold-3" });
      const unfolded = await wordsOf(ui);

      expect(unfolded, surface).toContain(
        "[▾ Answer 3 — 1 record, 1 citation]\n◉ \nKickoff\n  2026-09-30\nlisted in the timeline\n[Put reference in prompt]",
      );
      expect(unfolded, surface).toContain(
        "[▸ Answer 1 — 4 records, 1 of 3 citations not read]",
      );

      await ui.press({ key: "fold-3" });
      expect(await wordsOf(ui), surface).not.toContain("Kickoff");

      await ui.press({ key: "mode" });
      expect(await wordsOf(ui), surface).toContain(
        "Sources of the last answer",
      );
      await ui.press({ key: "mode" });
      await ui.unmount();
    }
  });
});

describe("a read that gave Claude nothing", () => {
  test("a failed read and a refused one are counted as such, never as read", async ($, on) => {
    const started = scene(on);
    await $.session.start(SESSION);

    // The server answers an error for a record the person may not read.
    await read(
      $,
      started,
      "t1",
      `${F}get_meeting`,
      { meeting_id: idOf(1) },
      {
        ref: 1,
        isError: true,
        result: "record not found",
        text: "record not found",
      },
    );
    // The person refuses the call; the refusal names the record it was for.
    await read(
      $,
      started,
      "t2",
      `${F}open`,
      { ref: idOf(2) },
      { deny: `not allowed: ${idOf(2)} “Secret plans”` },
    );
    // An error whose text looks like a record is still an error.
    await read(
      $,
      started,
      "t3",
      `${F}open`,
      { ref: idOf(3) },
      { ...answered(meeting(3, "Looks real")), isError: true },
    );
    await answer(
      $,
      `As [one](${linkTo("meeting", idOf(1))}), [two](${linkTo("meeting", idOf(2))}) and [three](${linkTo("meeting", idOf(3))}) show.`,
    );
    await sources($);

    const words = await wordsOf(await mountPane($));

    expect(words).toContain("Nothing was opened in Fylgja for this answer.");
    expect(words).toContain("2 reads failed — nothing came back");
    expect(words).toContain("1 read not allowed — nothing came back");
    expect(words).not.toContain("Secret plans");
    expect(words).not.toContain("Looks real");
    expect(words).not.toContain("✓");
    expect(words.match(/not read in this session/g)?.length).toBe(3);
    expect(words).not.toContain("[Put reference in prompt]");
  });

  test("a search that found nothing is said, not hidden", async ($, on) => {
    const started = scene(on);
    await $.session.start(SESSION);
    await read(
      $,
      started,
      "t1",
      `${F}search`,
      { query: "unicorn budget" },
      answered(searchResult([])),
    );
    await answer($, "There is a unicorn budget of 4 million.");
    await sources($);

    const words = await wordsOf(await mountPane($));

    expect(words).toContain("Nothing was opened in Fylgja for this answer.");
    expect(words).toContain("searched “unicorn budget” — nothing found");
  });
});

describe("a subagent's reads", () => {
  test("are kept apart from Claude's own, under the answer that was under way", async ($, on) => {
    const started = scene(on);
    await $.session.start(SESSION);
    await read(
      $,
      started,
      "t1",
      `${F}get_meeting`,
      { meeting_id: idOf(1) },
      answered(meeting(1, "Pricing sync")),
    );
    await read(
      $,
      started,
      "s1",
      `${F}search`,
      { query: "kickoff" },
      answered(searchResult([hit(5, "meeting", "Kickoff")])),
      "agent-7",
    );
    await read(
      $,
      started,
      "s2",
      `${F}get_meeting`,
      { meeting_id: idOf(5) },
      answered(meeting(5, "Kickoff")),
      "agent-7",
    );
    // The subagent's own run ending is no answer of Claude's.
    await answer($, "The kickoff was in September.", { agentId: "agent-7" });
    await answer(
      $,
      `See [the sync](${linkTo("meeting", idOf(1))}) and [the kickoff](${linkTo("meeting", idOf(5))}).`,
    );
    await answer($, "A later answer.");
    await sources($, "all");

    const ui = await mountPane($);

    expect(await wordsOf(ui)).toContain(
      "[▸ Answer 2 — nothing opened]\n[▸ Answer 1 — 2 records, 2 citations]",
    );

    await ui.press({ key: "fold-1" });

    expect(await wordsOf(ui)).toContain(
      [
        "◉ ",
        "Pricing sync",
        "  2026-09-30",
        "opened directly",
        "[Put reference in prompt]",
        "Read by a subagent, not by Claude itself:",
        "◉ ",
        "Kickoff",
        "  2026-09-30",
        "found by a search (1 hit)",
        "[Put reference in prompt]",
        "Cited in the answer:",
        "✓",
        "◉ Pricing sync",
        "read in this session",
        "✓",
        "◉ Kickoff",
        "read by a subagent in this session",
      ].join("\n"),
    );
  });
});

describe("Fylgja signed out or switched off", () => {
  test("sign-in is said in one line in the pane, and nowhere else", async ($, on) => {
    const started = scene(on);
    started.connection.answer = {
      isConnected: false,
      reason: "auth",
      message: "fylgja needs sign-in",
    };
    await $.session.start(SESSION);
    await answer($, "Hello.");
    await sources($);

    for (const surface of SURFACES) {
      const words = await wordsOf(await mountPane($, surface));

      expect(
        words.split("\n").filter((line) => line === SIGN_IN_LINE).length,
        surface,
      ).toBe(1);
      expect(words, surface).toContain(
        "Nothing was opened in Fylgja for this answer.",
      );
    }

    expect(started.forbidden).toEqual([]);
  });

  test("a server that is off, unapproved or unreachable is not mentioned", async ($, on) => {
    const started = scene(on);
    await $.session.start(SESSION);
    await answer($, "Hello.");

    for (const reason of [
      "disabled",
      "unapproved",
      "policy",
      "failed",
      "unlisted",
    ]) {
      started.connection.answer = { isConnected: false, reason, message: "no" };
      await sources($);

      const ui = await mountPane($);

      expect(await wordsOf(ui), reason).toBe(
        [
          "Sources of the last answer",
          "[Show every answer]",
          "Nothing was opened in Fylgja for this answer.",
        ].join("\n"),
      );
      await ui.unmount();
    }
  });
});
