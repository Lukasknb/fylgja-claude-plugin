import type { EngineInterface, On } from "claude-code";

import type { Host } from "./host";
import { lineTree, pickerTree, plainTree } from "./panes";
import type { Kit } from "./panes";
import * as Reads from "./reads";
import { meetingIn } from "./reference";
import * as Scrub from "./scrub";
import { askOf, viewOf } from "./view";

const PANE = "fylgja-scrub";
const TIMELINE = "timeline";

/**
 * The engine calls this plugin makes, each spelled out here once and handed
 * to the plugin's other files as plain functions.
 */
function hostOf($: EngineInterface): Host {
  return {
    connect: () => $.mcp.connect("fylgja"),
    call: (server, tool, args) => $.mcp.call(server, tool, args),
    redraw: () => $.ui.invalidate("ui.render"),
    insert: async (text) =>
      (await $.prompt.fill({ text, mode: "insert" })).isFilled,
  };
}

/**
 * `/scrub`: a meeting's transcript as a timeline to move through.
 *
 * Everything here answers something the person did in this plugin's own
 * pane or with its own command. No hook sees a prompt or a tool call, so
 * nothing is added to what Claude reads and nothing is made to wait. Fylgja
 * is only read, over the session's own connection; what is read stays in
 * this module's memory, bounded, and goes when the pane is closed.
 */
export function register(on: On): void {
  const scrub = Scrub.create();
  /** The room the pane last had, for the props handed back to the timeline between drawings. */
  const room = { columns: 80, rows: 22 };

  on("session.start", async ($, e, next) => {
    // A name another plugin already holds is refused; the session starts all the same.
    await $.command
      .register({
        name: "scrub",
        description: "Scrub through a meeting's transcript like a timeline",
        argumentHint: "[--plain] [meeting reference, link or id]",
      })
      .catch(() => undefined);

    return next(e);
  }).catch(($, e, next) => next(e));

  on("command.run", { command: "scrub" }, async ($, e) => {
    const host = hostOf($);

    const typed = e.args.trim();
    const wantsPlain = /^--plain(\s|$)/.test(typed);
    const rest = wantsPlain ? typed.slice("--plain".length).trim() : typed;

    // `--plain` asks for the pane with buttons, for a terminal where the
    // interactive timeline gets no keys or no pointer.
    scrub.isPlain = wantsPlain || scrub.hasFaulted;

    // Started, never waited for: the pane opens at once and fills when Fylgja answers.
    if (rest === "") {
      void Reads.pick(host, scrub).catch(() => undefined);
    } else {
      const meant = meetingIn(rest);

      if ("problem" in meant) {
        Scrub.startOver(scrub, "meeting");
        scrub.note = meant.problem;
      } else {
        void Reads.open(host, scrub, meant.id).catch(() => undefined);
      }
    }

    const opened = await $.ui
      .open({ id: PANE, title: "Scrub", focus: true, rows: 24 })
      .catch(() => undefined);

    $.ui.invalidate("ui.render");

    // No text on success: the pane is the answer, and a command's text is read by Claude.
    return opened?.isPlaced === false
      ? { text: "This surface has no room for the scrub pane." }
      : {};
  }).catch(() => ({}));

  on("ui.render", { component: "Pane", requestId: PANE }, ($, e) => {
    const table = $.ui.resolve(e);
    const kit: Kit = { Box: table.Box, Text: table.Text, Button: table.Button };

    // The still strip is cells on the terminal and a vector image elsewhere.
    // Every table names the cell grid, but only the terminal draws it.
    if (e.surface === "terminal") {
      kit.Raster = $.ui.resolve(e).Raster;
    } else {
      kit.Svg = $.ui.resolve(e).Svg;
    }
    const host = hostOf($);

    room.columns = Math.max(20, Math.min(200, e.props.bodyColumns));
    room.rows = Math.max(12, Math.min(40, e.props.scroll.bodyRows));

    if (scrub.phase === "idle") {
      return lineTree(
        kit,
        "Type /scrub to pick a recent meeting, or /scrub <reference, link or id>.",
      );
    }

    if (scrub.phase === "picking") {
      return pickerTree(
        kit,
        scrub,
        (id) => void Reads.open(host, scrub, id).catch(() => undefined),
      );
    }

    if (scrub.head === undefined || scrub.lines.length === 0) {
      return lineTree(
        kit,
        scrub.note !== "" ? scrub.note : "Opening the meeting…",
      );
    }

    // Keys and the pointer reach a plugin only through a surface module, which two surfaces have.
    if (
      !scrub.isPlain &&
      (e.surface === "terminal" || e.surface === "desktop")
    ) {
      const { Client } = $.ui.resolve(e);

      return Client({
        key: TIMELINE,
        module: "./timeline.ts",
        props: viewOf(scrub, room.columns, room.rows),
        width: room.columns,
        height: room.rows,
      });
    }

    return plainTree(kit, scrub, room.columns, room.rows, {
      move: (by) => Reads.move(host, scrub, by),
      quote: () =>
        void Reads.quote(host, scrub, scrub.at).catch(() => undefined),
      jump: (mark) => {
        scrub.failures = 0;
        void Reads.jump(host, scrub, mark).catch(() => undefined);
      },
    });
  });

  // What the timeline asks for. Each read is started and not waited for; the
  // answer hands the timeline what is known now (a read under way shows as
  // loading), and the pane is drawn again when the read lands.
  on("ui.message", { requestId: PANE, element: TIMELINE }, async ($, e) => {
    const ask = askOf(e.data);
    const host = hostOf($);

    if (ask === undefined || scrub.phase !== "meeting") {
      return {};
    }

    if (ask.ask === "more") {
      void Reads.extend(host, scrub, ask.side).catch(() => undefined);
    } else if (ask.ask === "seek") {
      scrub.failures = 0;
      void Reads.seek(host, scrub, ask.seconds).catch(() => undefined);
    } else if (ask.ask === "jump") {
      scrub.failures = 0;
      void Reads.jump(host, scrub, ask.mark).catch(() => undefined);
    } else {
      scrub.at = ask.p;
      await Reads.quote(host, scrub, ask.p);
    }

    return { props: viewOf(scrub, room.columns, room.rows) };
  }).catch(() => ({}));

  // The interactive timeline failed on this surface. The engine draws the
  // pane again after this, and that drawing is the plain one.
  on("ui.fault", { requestId: PANE }, ($, e, next) => {
    scrub.hasFaulted = true;
    scrub.isPlain = true;

    return next(e);
  }).catch(($, e, next) => next(e));

  // A closed pane keeps nothing of the meeting.
  on("ui.close", { id: PANE }, ($, e, next) => {
    Scrub.startOver(scrub, "idle");

    return next(e);
  }).catch(($, e, next) => next(e));
}
