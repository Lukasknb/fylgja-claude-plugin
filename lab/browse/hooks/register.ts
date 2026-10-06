import { atom, read, update } from "claude-code";
import type { Elements, EngineInterface, On, RenderSurface } from "claude-code";

import * as Browse from "./browse";
import type { Host } from "./host";
import * as Model from "./model";
import { chromeRows, draw } from "./view";
import type { Actions, Kit } from "./view";

/** The most body rows the compact version above the prompt takes, however many it is offered. */
const BAND_ROWS_MAX = 12;

/**
 * What the pane was showing: the one thing the session keeps for this
 * plugin, so a pane closed and opened again, or this module loaded again,
 * comes back to the same query, tab and expanded row.
 */
const view = atom(
  { plugin: "fylgja-lab-browse", key: "view" } as const,
  Model.INITIAL_VIEW,
);

/**
 * The engine calls this plugin makes, each spelled out here once and handed
 * to the plugin's other files as plain functions.
 */
function hostOf($: EngineInterface): Host {
  return {
    connect: () => $.mcp.connect("fylgja"),
    call: (server, tool, args) => $.mcp.call(server, tool, args),
    redraw: () => $.ui.invalidate("ui.render"),
    after: (ms, fn) => $.clock.after(ms, fn),
    insert: async (text) =>
      (await $.prompt.fill({ text, mode: "insert" })).isFilled,
    copy: async (text) => (await $.ui.copy({ text })).isCopied,
    focus: (site, key) =>
      void $.ui.focus({ requestId: site, key }).catch(() => undefined),
    open: async () =>
      (await $.ui.open({ id: Model.PANE, title: "Fylgja", focus: true }))
        .isPlaced,
    loadView: () => read($, view),
    saveView: (value) =>
      void update($, view, () => value).catch(() => undefined),
  };
}

/**
 * The elements the drawing uses, from whichever surface draws. A phone has
 * no text field: asked for one, its table hands back an empty box, so the
 * surface's name decides, not the table.
 */
function kitOf(elements: Elements[RenderSurface], surface: RenderSurface): Kit {
  return {
    Box: elements.Box,
    Text: elements.Text,
    Button: elements.Button,
    Link: elements.Link,
    Input:
      surface !== "mobile" && "Input" in elements ? elements.Input : undefined,
  };
}

function actionsOf(host: Host, model: Model.Model): Actions {
  return {
    typed: (value, isSubmitted) =>
      Browse.typed(host, model, value, isSubmitted),
    tab: (tab) => Browse.tabPicked(host, model, tab),
    toggle: (id) => Browse.toggled(host, model, id),
    stepInto: (project) => Browse.steppedInto(host, model, project),
    back: () => Browse.steppedBack(host, model),
    page: (direction) => Browse.paged(host, model, direction),
    insert: () =>
      void Browse.referenceInserted(host, model).catch(() => undefined),
    copyLink: () => void Browse.linkCopied(host, model).catch(() => undefined),
    focusSearch: () => host.focus(model.site, "q"),
    close: () => {
      model.isBand = false;
      host.redraw();
    },
  };
}

/**
 * `/fylgja`: the knowledge base in a pane beside the conversation.
 *
 * It is for the person at the keyboard only. Nothing here sees a prompt or
 * a tool call, nothing is added to what Claude reads, and no turn is
 * started: the one thing that reaches the prompt box is a reference the
 * person asked for, which they send or delete themselves. It only reads
 * from Fylgja, and only after the person typed the command or worked a
 * control. Records are held in this module's memory and nowhere else.
 */
export function register(on: On): void {
  const model = Model.create();

  on("session.start", async ($, e, next) => {
    // The command runs mid-turn too: the pane is the person's, not the turn's.
    await $.command
      .register({
        name: "fylgja",
        description:
          "Browse and search Fylgja in a pane beside the conversation",
        argumentHint: "[search]",
        immediate: true,
      })
      .catch(() => undefined);

    return next(e);
  }).catch(($, e, next) => next(e));

  // A cleared, resumed or branched conversation is another one: what was
  // listed for the last is dropped, and the session's own state starts over.
  on(
    "classic.SessionStart",
    { source: ["clear", "resume", "fork"] },
    ($, e, next) => {
      Model.startOver(model);
      $.ui.invalidate("ui.render");

      return next(e);
    },
  ).catch(($, e, next) => next(e));

  // Answered here, so no command runs beneath, nothing is printed and no turn starts.
  on("command.run", { command: "fylgja" }, async ($, e) => {
    await Browse.opened(hostOf($), model, e.args);

    return {};
  }).catch(() => ({}));

  on(
    "ui.render",
    { component: "Pane", requestId: "fylgja-browse" },
    async ($, e) => {
      const host = hostOf($);

      await Browse.hydrate(host, model);

      model.site = e.requestId;
      model.columns = Math.max(20, e.props.bodyColumns);
      model.room = Math.max(
        1,
        e.props.scroll.bodyRows - chromeRows(model.columns),
      );

      // A pane that outlived a reload of this module has nothing to show yet.
      if (!Browse.hasAnything(model)) {
        Browse.refresh(host, model, false);
      }

      return draw(kitOf($.ui.resolve(e), e.surface), model, actionsOf(host, model));
    },
  );

  // Only while it stands in for a pane the surface could not place.
  on("ui.render", { component: "AbovePrompt" }, ($, e, next) => {
    if (!model.isBand) {
      return next(e);
    }

    const host = hostOf($);

    model.site = e.requestId;
    model.columns = Math.max(20, e.props.bodyColumns);
    model.room = Math.max(
      1,
      Math.min(e.props.maxRows, BAND_ROWS_MAX) - chromeRows(model.columns),
    );

    return draw(kitOf($.ui.resolve(e), e.surface), model, actionsOf(host, model));
  });

  // The list is this plugin's own window over its rows, so the wheel and the
  // page keys move that window; the engine's, which has nothing to scroll,
  // stays where it is.
  on("ui.scroll", { requestId: "fylgja-browse" }, ($, e, next) => {
    if (e.origin.kind !== "person") {
      return next(e);
    }

    Browse.scrolled(hostOf($), model, e.by);

    return {};
  }).catch(($, e, next) => next(e));

  on("ui.focus", ($, e, next) => {
    if (e.requestId === model.site && e.element?.startsWith("row:") === true) {
      Browse.rowFocused(hostOf($), model, e.element.slice("row:".length));
    }

    return next(e);
  }).catch(($, e, next) => next(e));
}
