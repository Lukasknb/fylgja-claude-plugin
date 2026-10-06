import { describe, expect, test } from "claude-code/testing";

import { answer, answered, hit, idOf, linkTo, meeting, PLUGIN, read, reply, rowText, said, scene, searchResult, SURFACES, used, wrote } from "./fixtures";

const SESSION = { surface: "terminal", isInteractive: true, cwd: "/work/repo" } as const;
const F = "mcp__plugin_fylgja_fylgja__";

const READ = linkTo("meeting", idOf(1));
const HIT = linkTo("session", idOf(2));
const GHOST = linkTo("meeting", idOf(77));
const OTHER = linkTo("decision", idOf(78));

describe("a citation in a reply", () => {
  test("is marked when no read of the session returned the record, and left alone when one did", async ($, on) => {
    const started = scene(on);
    await $.session.start(SESSION);
    await read($, started, "t1", `${F}search`, { query: "pricing" }, answered(searchResult([hit(1, "meeting", "Pricing sync"), hit(2, "session", "Tiers")])));
    await read($, started, "t2", `${F}get_meeting`, { meeting_id: idOf(1) }, answered(meeting(1, "Pricing sync")));

    const text = `Opened: [the sync](${READ}). Only found: [tiers](${HIT}). Neither: [the board call](${GHOST}), [◆ a decision](${OTHER}), and bare ${GHOST}.\n\n- again [the board call](${GHOST})`;
    const marked = `Opened: [the sync](${READ}). Only found: [tiers](${HIT}). Neither: [the board call](${GHOST}) ◌, [◆ a decision](${OTHER}) ◌, and bare ${GHOST} ◌.\n\n- again [the board call](${GHOST}) ◌`;

    for (const surface of SURFACES) {
      expect(await rowText($, text, surface), surface).toBe(marked);
      // A reply drawn again from its marked text is not marked twice.
      expect(await rowText($, marked, surface), surface).toBe(marked);
    }

    expect(started.forbidden).toEqual([]);
  });

  test("a record a subagent read is backed; a read that failed or was refused backs nothing", async ($, on) => {
    const started = scene(on);
    await $.session.start(SESSION);
    await read($, started, "s1", `${F}get_meeting`, { meeting_id: idOf(1) }, answered(meeting(1, "Pricing sync")), "agent-7");
    await read($, started, "t1", `${F}open`, { ref: idOf(77) }, { ref: 1, isError: true, result: `no record ${idOf(77)}`, text: `no record ${idOf(77)}` });
    await read($, started, "t2", `${F}open`, { ref: idOf(78) }, { deny: `not allowed: ${idOf(78)}` });

    expect(await rowText($, `[a](${READ}) [b](${GHOST}) [c](${OTHER})`)).toBe(`[a](${READ}) [b](${GHOST}) ◌ [c](${OTHER}) ◌`);
  });

  test("a reply drawn before the conversation was looked through is marked once it has been", async ($, on) => {
    const started = scene(on, [said("What did we decide?"), wrote("", [used("h1", `${F}get_meeting`, { meeting_id: idOf(1) }, answered(meeting(1, "Pricing sync")))])]);
    const text = `[the sync](${READ}) and [the board call](${GHOST})`;

    // No session start: the plugin has read nothing back yet when the reply is first drawn.
    const ui = await $.ui.mount({ ...reply(text), surface: "terminal" });

    expect((await ui.find({ type: "Text" }))?.text).toBe(`engine: [the sync](${READ}) and [the board call](${GHOST}) ◌`);
    expect(started.transcript.reads).toBe(1);
  });

  test("a link that only looks like Fylgja's, an image, and a reply without links are never touched", async ($, on) => {
    scene(on);
    await $.session.start(SESSION);
    const path = `/open/meeting/${idOf(77)}`;
    const text = [
      `[a](https://fylgja.lknblab.dev@evil.example${path})`,
      `[b](https://fylgja.lknblab.dev.evil.example${path})`,
      `[c](https://evil.example/fylgja.lknblab.dev${path})`,
      `[d](https://fylgja.lknblab.dev:8443${path})`,
      `[e](https://user@fylgja.lknblab.dev${path})`,
      `[f](http://fylgja.lknblab.dev${path})`,
      `[g](https://fylgja-lknblab.dev${path})`,
      `[h](https://fylgja.lknblab.dev${path}/../../elsewhere)`,
      `[i](https://fylgja.lknblab.dev/open/meeting/1234)`,
      `![shot](https://fylgja.lknblab.dev${path})`,
      `https://fylgja.lknblab.dev${path}/more`,
      `https://fylgja.lknblab.dev${path}?x=1`,
      `xhttps://fylgja.lknblab.dev${path}`,
      "and plain words.",
    ].join(" ");

    for (const surface of SURFACES) {
      expect(await rowText($, text, surface), surface).toBe(text);
    }
  });

  test("the summary a long conversation was replaced by is not judged", async ($, on) => {
    scene(on);
    await $.session.start(SESSION);
    const text = `Earlier: [the board call](${GHOST})`;
    const ui = await $.ui.mount({ ...reply(text, { isSummary: true }), surface: "terminal" });

    expect((await ui.find({ type: "Text" }))?.text).toBe(`engine: ${text}`);
  });

  test("a reply made of brackets is drawn without delay", async ($, on) => {
    scene(on);
    await $.session.start(SESSION);
    const text = `${"[".repeat(30_000)}${"[x".repeat(15_000)}[the board call](${GHOST})`;
    const before = performance.now();

    expect((await rowText($, text)).endsWith(`[the board call](${GHOST}) ◌`)).toBe(true);
    expect(performance.now() - before < 1000).toBe(true);
  });

  test("switched off in the settings, no reply is ever changed", { options: { markUnreadCitations: false } }, async ($, on) => {
    const started = scene(on);
    await $.session.start(SESSION);
    await answer($, "Hello.");
    const text = `[the board call](${GHOST}) and bare ${GHOST}`;

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, component: "AssistantMessage", props: { text, isFirstOfReply: true }, surface });

      expect(await ui.drawn(), surface).toEqual({ type: "Text", props: {}, children: [`engine: ${text}`] });
      await ui.unmount();
    }

    expect(started.forbidden).toEqual([]);
  });
});

describe("the line after an answer", () => {
  const research = async ($: Parameters<typeof read>[0], started: Parameters<typeof read>[1]) => {
    await read($, started, "t1", `${F}search`, { query: "pricing" }, answered(searchResult([hit(1, "meeting", "Secret merger"), hit(2, "session", "Tiers")])));
    await read($, started, "t2", `${F}get_meeting`, { meeting_id: idOf(1) }, answered(meeting(1, "Secret merger")));
    await read($, started, "t3", `${F}get_meeting`, { meeting_id: idOf(1), include: ["decisions"] }, answered(meeting(1, "Secret merger")));
    await read($, started, "t4", `${F}open`, { ref: idOf(2) }, answered({ kind: "session", id: idOf(2), title: "Tiers" }));
    await read($, started, "t5", `${F}open`, { ref: idOf(3) }, { ref: 1, isError: true, result: "record not found", text: "record not found" });
    await read($, started, "s1", `${F}get_meeting`, { meeting_id: idOf(9) }, answered(meeting(9, "By a subagent")), "agent-7");
  };

  test("is not shown unless the person asked for it: the answer goes through as it came", async ($, on) => {
    const started = scene(on);
    await $.session.start(SESSION);
    await research($, started);

    expect(await answer($, "We raised the price.")).toEqual({ text: "We raised the price." });
  });

  test("asked for, it counts the records Claude itself read, and names none", { options: { turnSummary: true } }, async ($, on) => {
    const started = scene(on);
    await $.session.start(SESSION);
    await research($, started);

    // A subagent's run ending says nothing.
    expect(await answer($, "Report.", { agentId: "agent-7" })).toEqual({ text: "Report." });
    expect(await answer($, "We raised the price.")).toEqual({ text: "2 records read · /sources" });
    // The next answer used nothing: no line.
    expect(await answer($, "You are welcome.")).toEqual({ text: "You are welcome." });

    await read($, started, "t6", `${F}get_meeting`, { meeting_id: idOf(1) }, answered(meeting(1, "Secret merger")));
    expect(await answer($, "Once more.")).toEqual({ text: "1 record read · /sources" });

    await read($, started, "t7", `${F}search`, { query: "unicorn" }, answered(searchResult([])));
    expect(await answer($, "Nothing on that.")).toEqual({ text: "Fylgja was searched, no record opened · /sources" });

    await read($, started, "t8", `${F}open`, { ref: idOf(3) }, { deny: "no" });
    expect(await answer($, "Could not look.")).toEqual({ text: "Could not look." });

    // An interrupted turn gets no line, and its reads do not spill into the next answer.
    await read($, started, "t9", `${F}get_meeting`, { meeting_id: idOf(1) }, answered(meeting(1, "Secret merger")));
    expect(await answer($, "", { reason: "aborted", isAborted: true })).toEqual({ text: "" });
    expect(await answer($, "Fresh.")).toEqual({ text: "Fresh." });

    expect(started.forbidden).toEqual([]);
  });
});
