import type { EngineInterface, On } from "claude-code";

import * as Control from "./control";
import type { Host } from "./host";
import { paneOf } from "./pane";
import type { Actions } from "./pane";
import { scopeOf } from "./scope";

/** The one pane this plugin opens. */
const PANE = "fylgja-pulse";

/**
 * The engine calls this plugin makes, each spelled out here once and handed
 * to the plugin's other files as plain functions. Fylgja is only ever read:
 * the tools called are `open`, `get_timeline` and `resolve`.
 */
function hostOf($: EngineInterface): Host {
  return {
    connect: () => $.mcp.connect("fylgja"),
    call: (server, tool, args) => $.mcp.call(server, tool, args),
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
    redraw: () => $.ui.invalidate("ui.render"),
    insert: (text) =>
      $.prompt.fill({ text, mode: "insert" }).then((filled) => filled.isFilled),
  };
}

/**
 * What each button does. Every one returns at once: what it starts is not
 * waited for, and a failure ends in a line in the pane, never in a throw.
 */
function actionsOf(host: Host, pulse: Control.Pulse): Actions {
  const quietly = (work: Promise<void>): void => {
    void work.catch(() => undefined);
  };

  return {
    move: (dx, dy) => Control.move(host, pulse, dx, dy),
    resize: (by) => quietly(Control.resize(host, pulse, by)),
    lane: (shown) => Control.lane(host, pulse, shown),
    flip: () => quietly(Control.flip(host, pulse)),
    plain: () => Control.plain(host, pulse),
    stepIn: () => quietly(Control.stepIn(host, pulse)),
    stepUp: () => quietly(Control.stepUp(host, pulse)),
    refresh: () => quietly(Control.refresh(host, pulse)),
    insert: (text) => quietly(Control.insert(host, pulse, text)),
  };
}

/**
 * `/pulse [project | org/repo]`: a picture of where the work has been.
 *
 * A pane with a heatmap (the project's children down the side, days or
 * weeks across, each cell how much happened) and, on a key, a constellation
 * of the same part of the tree (size is how much is filed, brightness how
 * recent). A cursor walks the picture; what is under it is listed below.
 *
 * It draws only after the person types the command or presses a key in the
 * pane. It reads Fylgja and writes nothing, adds nothing to what Claude
 * reads, and the only thing it ever puts anywhere is a reference at the
 * cursor of the prompt box when the person presses the button for it, which
 * submits nothing. Everything is counted by where it is filed in the
 * project tree; nothing is counted, grouped or ranked by person.
 */
export function register(on: On): void {
  const pulse = Control.create();

  on("session.start", async ($, e, next) => {
    const started = await next(e);

    try {
      await $.command.register({
        name: "pulse",
        description:
          "Fylgja: a picture of where the work has been, as a heatmap and a constellation",
        argumentHint: "[project name | org/repo]",
      });
    } catch {
      // Already registered by an earlier load of this plugin.
    }

    return started;
  }).catch(($, e, next) => next(e));

  on("command.run", { command: "pulse" }, async ($, e) => {
    const opened = await $.ui.open({ id: PANE, title: "Pulse", focus: true });

    if (!opened.isPlaced) {
      return { text: "Pulse has no room for its pane here." };
    }

    // Started, not waited for: the command answers at once and the pane
    // shows the picture when Fylgja has answered.
    void Control.show(hostOf($), pulse, scopeOf(e.args)).catch(() => undefined);

    return {
      text: "Pulse is open: h j k l move the cursor, w and n change the window, v switches the view.",
    };
  }).catch(($, e, next) => next(e));

  on("ui.render", { component: "Pane", requestId: PANE }, ($, e) => {
    const els = $.ui.resolve(e);

    // The width decides whether six weeks fit a day to a column; a surface
    // that reports none gets the width of a plain terminal.
    const width = Number.isFinite(e.props.bodyColumns)
      ? e.props.bodyColumns
      : 80;

    pulse.columns = Math.max(24, Math.min(160, Math.floor(width)));

    return paneOf(
      {
        Box: els.Box,
        Text: els.Text,
        Button: els.Button,
        Link: els.Link,
        // Each only on a surface that draws it. The table hands out every
        // name, and one the surface lacks draws nothing, so the surface is
        // asked, not the table.
        Raster:
          e.surface === "terminal" && "Raster" in els ? els.Raster : undefined,
        Svg:
          (e.surface === "desktop" ||
            e.surface === "vscode" ||
            e.surface === "mobile") &&
          "Svg" in els
            ? els.Svg
            : undefined,
      },
      pulse,
      pulse.columns,
      actionsOf(hostOf($), pulse),
    );
  });
}
