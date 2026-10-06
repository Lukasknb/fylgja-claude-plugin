import type { On, PluginOptions } from "claude-code";
import { describe, expect, test } from "claude-code/testing";

import { register } from "../hooks/register";
import { READ_TOOL, READS } from "../hooks/tools";
import { callOf } from "../hooks/watch";
import {
  answered,
  fenced,
  hit,
  idOf,
  meeting,
  PREFIXES,
  read,
  scene,
  searchResult,
  sessionText,
} from "./fixtures";

type Handler = (...args: unknown[]) => unknown;
type Hooked = {
  event: string;
  matcher: unknown;
  handler: Handler;
  caught: Handler | undefined;
};

/** Every hook the plugin registers, as it names them, with the functions themselves. */
function hooked(options: PluginOptions = {}): Hooked[] {
  const seen: Hooked[] = [];
  const on = (event: string, ...rest: unknown[]) => {
    const entry: Hooked = {
      event,
      matcher: rest.length === 2 ? rest[0] : undefined,
      handler: rest.at(-1) as Handler,
      caught: undefined,
    };

    seen.push(entry);

    return {
      catch: (handler: Handler) => {
        entry.caught = handler;
      },
    };
  };

  register(on as unknown as On, options);

  return seen;
}

function toolHook(): Hooked {
  const hook = hooked().find((entry) => entry.event === "tool.call");

  if (hook === undefined) {
    throw new Error("the plugin hooks no tool call");
  }

  return hook;
}

/** An engine the hook must not touch: any use of it fails the test. */
const UNTOUCHABLE = new Proxy(
  {},
  {
    get: (_, name) => {
      throw new Error(`the tool hook used $.${String(name)}`);
    },
  },
);

/** A result that cannot be looked into: reading any part of it throws. */
function sealed(): Record<string, unknown> {
  const fail = (): never => {
    throw new Error("not to be read");
  };

  return Object.defineProperties(
    {},
    {
      deny: { get: fail, enumerable: true },
      isError: { get: fail, enumerable: true },
      result: { get: fail, enumerable: true },
      text: { get: fail, enumerable: true },
    },
  );
}

/** A result whose stored record throws when read, under an answer that looks fine. */
function poisoned(): Record<string, unknown> {
  const result = Object.defineProperty({}, "content", {
    get: () => {
      throw new Error("not to be read");
    },
    enumerable: true,
  });

  return { ref: 3, result };
}

const circular: Record<string, unknown> = { ref: 4, result: {} };
(circular.result as Record<string, unknown>).self = circular;

const ANSWERS: readonly (readonly [string, unknown])[] = [
  [
    "a search with hits",
    answered(
      searchResult([
        hit(1, "meeting", "Pricing sync"),
        hit(2, "session", "Tiers"),
      ]),
    ),
  ],
  ["a meeting", answered(meeting(1, "Pricing sync"))],
  ["a session sent as text", fenced(sessionText(2, "Tiers"))],
  [
    "a structured result",
    {
      ref: 1,
      result: { structuredContent: meeting(1, "Pricing sync"), content: [] },
      text: "{}",
    },
  ],
  ["a bare string", { ref: 1, result: "plain words", text: "plain words" }],
  [
    "an error from the tool",
    {
      ref: 2,
      isError: true,
      result: "record not found",
      text: "record not found",
    },
  ],
  ["a refusal", { deny: "the person said no" }],
  ["a result with nothing in it", { ref: 5, result: null }],
  ["a result that is not an object", "just text"],
  ["no result at all", undefined],
  [
    "a result of the wrong shape",
    {
      ref: 6,
      result: { results: "many", records: 7, id: { id: 1 }, title: ["x"] },
      text: "][",
    },
  ],
  ["a result that points at itself", circular],
  ["a result that throws when its record is read", poisoned()],
  ["a result that throws when anything of it is read", sealed()],
  ["a frozen result", Object.freeze(answered(meeting(1, "Pricing sync")))],
  [
    "a very long result",
    { ref: 9, result: null, text: `${idOf(1)} `.repeat(40_000) },
  ],
];

describe("Claude's Fylgja read, as the plugin watches it", () => {
  for (const [name, given] of ANSWERS) {
    test(`${name} is handed back as the very object that came, the call passed on as made`, async () => {
      const { handler } = toolHook();

      for (const prefix of PREFIXES) {
        for (const agentId of [undefined, "agent-1"]) {
          const e = Object.freeze({
            tool: `${prefix}open`,
            tool_use_id: "toolu_1",
            ref: idOf(1),
            ...(agentId === undefined ? {} : { agentId }),
          });
          const passed: unknown[] = [];
          const next = (input: unknown) => {
            passed.push(input);

            return Promise.resolve(given);
          };

          const returned = await handler(UNTOUCHABLE, e, next);

          expect(returned === given, `${prefix} ${String(agentId)}`).toBe(true);
          // Passed on once, and as the same object: nothing added, nothing rewritten.
          expect(passed.length).toBe(1);
          expect(passed[0] === e).toBe(true);
        }
      }
    });
  }

  test("a tool that throws still throws the same error, and is not run twice", async () => {
    const { handler, caught } = toolHook();
    const failure = new Error("the server went away");
    let runs = 0;
    const next = () => {
      runs += 1;

      return Promise.reject(failure);
    };

    let thrown: unknown;

    try {
      await handler(
        UNTOUCHABLE,
        { tool: "mcp__fylgja__search", tool_use_id: "toolu_1", query: "x" },
        next,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown === failure).toBe(true);
    expect(runs).toBe(1);
    expect(caught).toBeDefined();
  });

  test("when the hook itself fails, what the tool answered stands", async () => {
    const { caught } = toolHook();
    const given = answered(meeting(1, "Pricing sync"));
    const e = {
      tool: "mcp__fylgja__get_meeting",
      tool_use_id: "toolu_1",
      meeting_id: idOf(1),
    };
    const passed: unknown[] = [];
    // In a `.catch`, `next` replays what the failed hook's call settled to.
    const replay = (input: unknown) => {
      passed.push(input);

      return Promise.resolve(given);
    };

    expect((await caught?.(UNTOUCHABLE, e, replay)) === given).toBe(true);
    expect(passed[0] === e).toBe(true);
  });

  test("through the engine, Claude gets exactly what the tool gave and the tool gets exactly what Claude sent", async ($, on) => {
    const started = scene(on);

    for (const prefix of PREFIXES) {
      const given = answered(searchResult([hit(1, "meeting", "Pricing sync")]));
      const args = { query: "pricing", project: "Pricing", limit: 5 };
      started.ran.length = 0;

      const got = await read(
        $,
        started,
        "toolu_1",
        `${prefix}search`,
        args,
        given,
      );

      expect(got, prefix).toEqual(given);
      expect(started.ran, prefix).toEqual([
        { tool: `${prefix}search`, tool_use_id: "toolu_1", ...args },
      ]);
    }

    // An error and a refusal reach Claude as they are, too.
    const failed = {
      ref: 2,
      isError: true,
      result: "record not found",
      text: "record not found",
    };
    expect(
      await read(
        $,
        started,
        "toolu_2",
        "mcp__fylgja__open",
        { ref: idOf(9) },
        failed,
      ),
    ).toEqual(failed);
    expect(
      await read(
        $,
        started,
        "toolu_3",
        "mcp__fylgja__open",
        { ref: idOf(9) },
        { deny: "no" },
      ),
    ).toEqual({ deny: "no" });

    // Watching asks the engine for nothing: no transcript read, no pane, no prompt.
    expect([
      started.transcript.reads,
      started.opened,
      started.fills,
      started.submitted,
      started.forbidden,
    ]).toEqual([0, [], [], [], []]);
  });
});

describe("what the plugin hooks", () => {
  test("a tool call only when it is one of Fylgja's reads, under each name its server runs as", () => {
    const { matcher } = toolHook();
    const tool = (matcher as { tool: RegExp }).tool;

    expect(Object.keys(matcher as object)).toEqual(["tool"]);
    expect(tool.source).toBe(READ_TOOL.source);

    for (const prefix of PREFIXES) {
      for (const name of READS) {
        expect(tool.test(prefix + name), prefix + name).toBe(true);
      }

      for (const write of [
        "remember",
        "save_knowledge",
        "restructure",
        "review_suggestion",
        "push_document",
        "search_all",
      ]) {
        expect(tool.test(prefix + write), prefix + write).toBe(false);
      }
    }

    for (const other of [
      "Bash",
      "Read",
      "mcp__notes__search",
      "xmcp__fylgja__search",
      "mcp__fylgja__search ",
      "mcp__plugin_evil_fylgja__open",
    ]) {
      expect(tool.test(other), other).toBe(false);
    }
  });

  test("no prompt on its way to Claude, no permission check, and nothing that rewrites the conversation", () => {
    const settings: PluginOptions[] = [
      {},
      { markUnreadCitations: false, turnSummary: true },
    ];

    for (const options of settings) {
      const hooks = hooked(options);

      expect(hooks.map((hook) => hook.event)).toEqual([
        "tool.call",
        "turn.complete",
        "session.start",
        "classic.SessionStart",
        "command.run",
        "ui.render",
        "ui.render",
      ]);
      expect(
        hooks
          .filter((hook) => hook.event === "ui.render")
          .map((hook) => (hook.matcher as { component: string }).component),
      ).toEqual(["Pane", "AssistantMessage"]);
      // Every hook that stands in the way of something lets it through when it fails.
      expect(
        hooks
          .filter((hook) => hook.event !== "ui.render")
          .every((hook) => hook.caught !== undefined),
      ).toBe(true);
    }
  });
});

describe("how a read is recorded", () => {
  const e = { tool: "mcp__fylgja__get_meeting", tool_use_id: "toolu_1", meeting_id: idOf(1) };

  test("only an answered read counts as read, and only it says what came back", () => {
    const real = answered(meeting(1, "Pricing sync"));

    expect(callOf(e, real)).toMatchObject({ status: "read", record: { id: idOf(1), title: "Pricing sync" }, ids: [idOf(1), idOf(501)] });

    const empty = { record: undefined, hits: [], ids: [], listed: undefined, query: undefined };

    // A tool that threw, one that reported an error, and a refusal: nothing read, nothing kept of the text.
    expect(callOf(e, undefined)).toMatchObject({ status: "failed", ...empty });
    expect(callOf(e, { ...real, isError: true })).toMatchObject({ status: "failed", ...empty });
    expect(callOf(e, { deny: `no: ${idOf(1)}` })).toMatchObject({ status: "denied", ...empty });
    expect(callOf(e, { ...real, deny: "refused after it ran" })).toMatchObject({ status: "denied", ...empty });
  });

  test("the loop that made the call is kept with it, and another server's tool is no call of Fylgja's", () => {
    expect(callOf(e, answered(meeting(1, "Pricing sync")))?.agentId).toBeUndefined();
    expect(callOf({ ...e, agentId: "agent-7" }, answered(meeting(1, "Pricing sync")))?.agentId).toBe("agent-7");
    expect(callOf({ ...e, tool: "mcp__notes__get_meeting" }, answered(meeting(1, "Pricing sync")))).toBeUndefined();
    expect(callOf({ ...e, tool: "mcp__fylgja__remember" }, { result: { outcome: "created" } })).toBeUndefined();
  });
});
