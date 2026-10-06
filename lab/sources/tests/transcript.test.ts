import type { SessionMessage } from "claude-code";
import { describe, expect, test } from "claude-code/testing";

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
  results,
  rowText,
  said,
  scene,
  searchResult,
  sessionText,
  sources,
  used,
  wordsOf,
  wrote,
} from "./fixtures";

const SESSION = {
  surface: "terminal",
  isInteractive: true,
  cwd: "/work/repo",
} as const;
const F = "mcp__fylgja__";

const CITING = `See [the sync](${linkTo("meeting", idOf(1))}) and [the board call](${linkTo("meeting", idOf(77))}).`;

/** A conversation as the transcript holds it: one researched answer, then one from memory. */
function earlier(): SessionMessage[] {
  return [
    said("What did we decide on pricing?"),
    wrote("Let me look.", [
      used(
        "h1",
        `${F}search`,
        { query: "pricing" },
        answered(
          searchResult([
            hit(1, "meeting", "Pricing sync"),
            hit(3, "meeting", "Old sync"),
          ]),
        ),
      ),
    ]),
    results("h1"),
    wrote("", [
      used(
        "h2",
        `${F}get_meeting`,
        { meeting_id: idOf(1) },
        answered(meeting(1, "Pricing sync")),
      ),
      used("h3", `${F}open`, { ref: idOf(2) }, fenced(sessionText(2, "Tiers"))),
      {
        tool_use_id: "h4",
        tool: `${F}open`,
        input: { ref: idOf(9) },
        result: "record not found",
        text: "record not found",
        isError: true,
      },
      {
        tool_use_id: "h5",
        tool: "Bash",
        input: { command: "ls" },
        result: { stdout: idOf(55) },
        text: idOf(55),
      },
    ]),
    results("h2", "h3", "h4", "h5"),
    wrote(CITING),
    said("And who owns it?"),
    wrote("Ada does."),
  ];
}

const FIRST_ANSWER = [
  "◉ ",
  "Pricing sync",
  "  2026-09-30",
  "found by a search (2 hits)",
  "[Put reference in prompt]",
  "⌁ ",
  "Tiers",
  "  2026-10-01",
  "opened directly, in Product > Pricing",
  "[Put reference in prompt]",
  "searched “pricing” — 2 hits, 1 not opened",
  "1 read failed — nothing came back",
  "Cited in the answer:",
  "✓",
  "◉ Pricing sync",
  "read in this session",
  "◌",
  "◉ the board call",
  "not read in this session",
].join("\n");

describe("what happened before the plugin watched", () => {
  test("is read back from the transcript: the same rows, with nothing seen at the hook", async ($, on) => {
    scene(on, earlier());
    await $.session.start(SESSION);
    await sources($, "all");

    const ui = await mountPane($);

    expect(await wordsOf(ui)).toContain(
      "[▸ Answer 2 — nothing opened]\n[▸ Answer 1 — 2 records, 1 of 2 citations not read]",
    );

    await ui.press({ key: "fold-1" });

    expect(await wordsOf(ui)).toContain(FIRST_ANSWER);
  });

  test("a resumed conversation brings its reads along, and the person's own /sources is no answer", async ($, on) => {
    const started = scene(on);
    await $.session.start(SESSION);
    started.transcript.messages = [...earlier().slice(0, 6), said("/sources")];
    await $.classic.SessionStart({ source: "resume" });
    await sources($);

    expect(await wordsOf(await mountPane($))).toContain(FIRST_ANSWER);
    // The citation of a record read before the resume is backed; the other is marked.
    expect(await rowText($, CITING)).toBe(
      `See [the sync](${linkTo("meeting", idOf(1))}) and [the board call](${linkTo("meeting", idOf(77))}) ◌.`,
    );
  });

  test("answers watched after it follow it, each once, however often the transcript is read again", async ($, on) => {
    const started = scene(on, earlier());
    await $.session.start(SESSION);

    const kickoff = answered(meeting(5, "Kickoff"));
    await read(
      $,
      started,
      "t1",
      `${F}get_meeting`,
      { meeting_id: idOf(5) },
      kickoff,
    );
    await answer($, "It started in September.");

    // By now the transcript holds the watched answer too.
    started.transcript.messages = [
      ...earlier(),
      said("When did it start?"),
      wrote("", [
        used("t1", `${F}get_meeting`, { meeting_id: idOf(5) }, kickoff),
      ]),
      results("t1"),
      wrote("It started in September."),
      said("/sources all"),
    ];

    await sources($, "all");
    await sources($, "all");

    expect(await wordsOf(await mountPane($))).toBe(
      [
        "Sources of every answer, newest first",
        "[Show the last answer]",
        "[▸ Answer 3 — 1 record]",
        "[▸ Answer 2 — nothing opened]",
        "[▸ Answer 1 — 2 records, 1 of 2 citations not read]",
      ].join("\n"),
    );
  });

  test("a call still in flight, and another server's tool, are no reads", async ($, on) => {
    scene(on, [
      said("Look it up."),
      wrote("", [
        {
          tool_use_id: "h1",
          tool: `${F}get_meeting`,
          input: { meeting_id: idOf(1) },
        },
        used(
          "h2",
          "mcp__notes__open",
          { ref: idOf(2) },
          answered(meeting(2, "Not Fylgja")),
        ),
      ]),
    ]);
    await $.session.start(SESSION);
    await sources($);

    expect(await wordsOf(await mountPane($))).toBe(
      [
        "Sources of the last answer",
        "[Show every answer]",
        "Nothing was opened in Fylgja for this answer.",
      ].join("\n"),
    );
  });
});

describe("when the conversation starts over", () => {
  for (const source of ["clear", "resume", "fork"] as const) {
    test(`after a ${source}, nothing held before is shown or counted`, async ($, on) => {
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
      await answer($, CITING);

      expect(await rowText($, CITING)).toContain(
        `[the sync](${linkTo("meeting", idOf(1))}) and`,
      );

      started.transcript.messages = [];
      await $.classic.SessionStart({ source });
      await sources($, "all");

      expect(await wordsOf(await mountPane($))).toBe(
        [
          "Sources of every answer, newest first",
          "[Show the last answer]",
          "Claude has not answered in this conversation yet.",
        ].join("\n"),
      );
      // The record read before is no longer known: its citation is marked like any other.
      expect(await rowText($, CITING)).toBe(
        `See [the sync](${linkTo("meeting", idOf(1))}) ◌ and [the board call](${linkTo("meeting", idOf(77))}) ◌.`,
      );
    });
  }
});

describe("when the conversation cannot be seen whole", () => {
  const cases: readonly (readonly [
    string,
    () => SessionMessage[] | undefined,
    string,
  ])[] = [
    [
      // The plugin watched an answer, yet is handed no transcript at all:
      // that is no transcript, and nothing is concluded from it.
      "the transcript comes back empty although an answer was watched",
      () => undefined,
      "What was read earlier in this conversation is not known yet.",
    ],
    [
      "the transcript is longer than is handed back",
      () =>
        Array.from({ length: 4096 }, (_, n) =>
          n % 2 === 0 ? said("more") : wrote("more"),
        ),
      "This conversation is longer than can be looked back through: what was read early on may be missing.",
    ],
    [
      "the conversation begins with the summary of a longer one",
      () => [
        said(
          "This session is being continued from a previous conversation that ran out of context.",
        ),
        wrote("Understood."),
      ],
      "This conversation is longer than can be looked back through: what was read early on may be missing.",
    ],
  ];

  for (const [name, messages, line] of cases) {
    test(`${name}: nothing is called unread, in the pane or in a reply`, async ($, on) => {
      const transcript = messages();
      const started = scene(on, transcript ?? []);

      if (transcript !== undefined) {
        await $.session.start(SESSION);
      }

      await read(
        $,
        started,
        "t1",
        `${F}get_meeting`,
        { meeting_id: idOf(1) },
        answered(meeting(1, "Pricing sync")),
      );
      await answer($, CITING);
      await sources($);

      const words = await wordsOf(await mountPane($));

      // What the plugin watched is shown all the same.
      expect(words).toContain(
        "◉ \nPricing sync\n  2026-09-30\nopened directly",
      );
      expect(words).toContain("✓\n◉ Pricing sync\nread in this session");
      expect(words).toContain(
        "◌\n◉ the board call\nnot seen, but this session cannot be looked through to its start",
      );
      expect(words).not.toContain("not read in this session");
      expect(words.endsWith(line)).toBe(true);
      expect(await rowText($, CITING)).toBe(CITING);
    });
  }
});
