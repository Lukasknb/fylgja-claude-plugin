import { atom, read, update } from "claude-code";
import type { EngineInterface, On, PluginOptions } from "claude-code";

import { withMarks } from "./citations";
import * as Ledger from "./ledger";
import { FYLGJA_HOST } from "./links";
import { createState, drawPane } from "./pane";
import type { PaneState } from "./pane";
import { reachesBack, turnsOf } from "./transcript";
import { answersIn } from "./view";
import { observe } from "./watch";

const PANE = "fylgja-sources";

/**
 * Bumped whenever the pane has something new to show. The pane reads it
 * while drawing, so it alone is drawn again; the replies in the transcript
 * are left as they are.
 */
const DRAWN = atom({ plugin: "fylgja-lab-sources", key: "drawn" } as const, 0);

/** Whether the transcript is being read, and whether the last try failed. */
type ReadBack = { isRunning: boolean; hasFailed: boolean };

async function redraw($: EngineInterface): Promise<void> {
  try {
    await update($, DRAWN, (count) => count + 1);
  } catch {
    // A pane that cannot be drawn again keeps what it shows.
  }
}

/**
 * Reads the conversation's transcript into the ledger: what was read before
 * the plugin watched, and whether the conversation can be seen whole. When
 * that becomes known, the replies on screen are drawn again so that their
 * citations can be judged.
 */
async function readBack(
  $: EngineInterface,
  ledger: Ledger.Ledger,
  back: ReadBack,
): Promise<void> {
  if (back.isRunning) {
    return;
  }

  back.isRunning = true;

  const epoch = ledger.epoch;
  const before = ledger.coverage;

  try {
    const messages = await $.session.messages();

    // A refusal, or an empty hand although the plugin watched Claude at
    // work, is no transcript: nothing is concluded from it.
    const hasWatched = ledger.turns.length > 0 || ledger.open.calls.length > 0;
    const isBelievable = Array.isArray(messages) && (messages.length > 0 || !hasWatched);

    if (!isBelievable) {
      back.hasFailed = true;
    } else if (epoch === ledger.epoch) {
      // A conversation that started over meanwhile is not this one.
      Ledger.takeIn(ledger, turnsOf(messages), reachesBack(messages));
      back.hasFailed = false;
    }
  } catch {
    back.hasFailed = true;
  } finally {
    back.isRunning = false;
  }

  if (ledger.coverage !== before) {
    $.ui.invalidate("ui.render");
  }

  await redraw($);
}

/** Asks whether Fylgja needs sign-in, for the one line the pane says about it. */
async function checkSignIn($: EngineInterface, pane: PaneState): Promise<void> {
  let needsSignIn = false;

  try {
    const connection = await $.mcp.connect("fylgja");

    needsSignIn = !connection.isConnected && connection.reason === "auth";
  } catch {
    needsSignIn = false;
  }

  if (needsSignIn !== pane.needsSignIn) {
    pane.needsSignIn = needsSignIn;
    await redraw($);
  }
}

/** Puts a reference at the cursor of the prompt box. It is never sent: the person presses Enter. */
async function fill(
  $: EngineInterface,
  pane: PaneState,
  reference: string,
): Promise<void> {
  let isFilled = false;

  try {
    isFilled = (await $.prompt.fill({ text: `${reference} `, mode: "insert" }))
      .isFilled;
  } catch {
    isFilled = false;
  }

  pane.notice = isFilled
    ? undefined
    : "The prompt box could not take the reference just now.";
  await redraw($);
}

/** The one line shown after an answer that used Fylgja: counts only, never a title. */
function summaryOf(turn: Ledger.Turn): string | undefined {
  const records = Ledger.recordsOpened(turn.calls);

  if (records > 0) {
    return `${records} ${records === 1 ? "record" : "records"} read · /sources`;
  }

  return turn.calls.some((call) => call.status === "read")
    ? "Fylgja was searched, no record opened · /sources"
    : undefined;
}

/**
 * "What did Claude base that on?" The plugin watches Claude's Fylgja reads
 * complete, keeps in memory which records came back, and shows them when
 * the person types /sources.
 *
 * It watches and draws, nothing more. A read is passed on exactly as Claude
 * made it and its result handed back exactly as it came; nothing is added
 * to what Claude reads, no prompt is seen or made to wait, and Fylgja's tool
 * rows stay Claude Code's own.
 */
export function register(on: On, options: PluginOptions): void {
  const ledger = Ledger.create();
  const pane = createState();
  const back: ReadBack = { isRunning: false, hasFailed: false };
  const marksCitations = options.markUnreadCitations !== false;
  const saysSummary = options.turnSummary === true;

  // The pattern is `READ_TOOL` of ./tools, written out so the hook is
  // limited to Fylgja's reads where the engine can see it.
  on(
    "tool.call",
    {
      tool: /^mcp__(?:plugin_fylgja(?:[-_]lab[-_]sources)?_fylgja|fylgja)__(?:search|open|get_meeting|get_project|get_timeline|get_commitments|recall|resolve)$/,
    },
    async ($, e, next) => {
      let answer;

      try {
        answer = await next(e);
      } catch (error) {
        // The call gave Claude nothing; it fails for Claude as it would have.
        observe(ledger, e, undefined);
        throw error;
      }

      observe(ledger, e, answer);

      return answer;
    },
  ).catch(($, e, next) => next(e));

  on("turn.complete", async ($, e, next) => {
    const result = await next(e);

    // A subagent's run ends here too; only Claude's own answer closes one.
    if (e.agentId !== undefined) {
      return result;
    }

    const line = summaryOf(Ledger.seal(ledger, e.answer));

    // Not waited for: an open pane follows the new answer when it can.
    void redraw($);

    return saysSummary && e.reason === "answer" && line !== undefined
      ? { ...result, text: line }
      : result;
  }).catch(($, e, next) => next(e));

  on("session.start", async ($, e, next) => {
    // Not waited for: the session starts whether or not the transcript reads.
    void readBack($, ledger, back);

    try {
      await $.command.register({
        name: "sources",
        description: "Show which Fylgja records the last answer rests on",
        argumentHint: "[all]",
      });
    } catch {
      // Without the command the plugin still watches and marks.
    }

    return next(e);
  }).catch(($, e, next) => next(e));

  // A cleared, resumed or branched conversation is another conversation:
  // everything held is dropped, titles included, and it is read afresh.
  on(
    "classic.SessionStart",
    { source: ["clear", "resume", "fork"] },
    ($, e, next) => {
      Ledger.clear(ledger);
      pane.unfolded.clear();
      pane.notice = undefined;
      $.ui.invalidate("ui.render");
      void readBack($, ledger, back);

      return next(e);
    },
  ).catch(($, e, next) => next(e));

  on("command.run", { command: "sources" }, async ($, e) => {
    pane.mode = /^\s*all\b/i.test(e.args) ? "all" : "last";
    pane.unfolded.clear();
    pane.notice = undefined;
    back.hasFailed = false;
    Ledger.renew(ledger);

    await readBack($, ledger, back);
    void checkSignIn($, pane);

    const opened = await $.ui.open({ id: PANE, title: "Sources", focus: true });

    // The line is fixed words: a command's output may be read by Claude.
    return opened.isPlaced
      ? {}
      : { text: "Sources: there is no room to show the pane here." };
  }).catch(() => ({ text: "Sources could not be shown." }));

  on("ui.render", { component: "Pane" }, async ($, e, next) => {
    if (e.requestId !== PANE) {
      return next(e);
    }

    await read($, DRAWN);

    // A pane that outlived a reload of the plugin is filled again.
    if (ledger.history === undefined && !back.hasFailed) {
      void readBack($, ledger, back);
    }

    const { Box, Text, Button, Link } = $.ui.resolve(e);

    return drawPane(
      { Box, Text, Button, Link },
      pane,
      answersIn(ledger),
      ledger.coverage,
      {
        show: (mode) => {
          pane.mode = mode;
          pane.notice = undefined;
          void redraw($);
        },
        toggle: (answer) => {
          if (!pane.unfolded.delete(answer)) {
            pane.unfolded.add(answer);
          }

          void redraw($);
        },
        insert: (reference) => {
          void fill($, pane, reference);
        },
      },
    );
  });

  on("ui.render", { component: "AssistantMessage" }, ($, e, next) => {
    if (
      !marksCitations ||
      e.props.isSummary === true ||
      !e.props.text.includes(`https://${FYLGJA_HOST}/open/`)
    ) {
      return next(e);
    }

    // Until the conversation has been looked through, nothing can be called
    // unread. The look is started, never waited for; the reply is drawn now.
    if (ledger.coverage === "unknown" && !back.hasFailed) {
      void readBack($, ledger, back);
    }

    const text =
      ledger.coverage === "whole"
        ? withMarks(e.props.text, (id) => ledger.returned.has(id))
        : undefined;

    return text === undefined
      ? next(e)
      : next({ ...e, props: { ...e.props, text } });
  });
}
