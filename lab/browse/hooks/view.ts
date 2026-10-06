/**
 * The pane's drawing: a search field, the tabs, one line that says how
 * things stand, the rows that fit, and the keys. The same tree is drawn
 * docked, inline and, where no pane can be placed, above the prompt.
 *
 * Every line is one body row and the list is cut to the rows the site has,
 * so the tree is never taller than the site: the arrows then move the focus
 * ring from control to control instead of scrolling.
 */

import type { Elements, RenderElement } from "claude-code";

import type { Tab } from "../types";

import { windowNow } from "./browse";
import { glyphOf } from "./glyphs";
import { detailPlan, fit, INDENT, tabRows } from "./layout";
import type { Model } from "./model";
import { TABS } from "./model";
import type { Row } from "./records";

/** The elements the drawing uses. A surface without text fields hands no `Input`. */
export type Kit = Pick<
  Elements["terminal"],
  "Box" | "Text" | "Button" | "Link"
> & {
  Input: Elements["terminal"]["Input"] | undefined;
};

/** What the controls do, bound to the hook that drew them. */
export type Actions = {
  typed: (value: string, isSubmitted: boolean) => void;
  tab: (tab: Tab) => void;
  toggle: (id: string | undefined) => void;
  stepInto: (project: Row) => void;
  back: () => void;
  page: (direction: 1 | -1) => void;
  insert: () => void;
  copyLink: () => void;
  focusSearch: () => void;
  /** Takes the compact version above the prompt away; a pane is closed by its own chord. */
  close: () => void;
};

/** The width of a date as drawn, `YYYY-MM-DD`. */
const DATE_WIDTH = 10;

/**
 * The body rows everything but the list takes: the field, the tabs, the
 * status line, the keys, and one spare so a surface that draws the field a
 * row taller still shows the whole tree.
 */
export function chromeRows(columns: number): number {
  return 1 + tabRows(columns).rows + 1 + 1 + 1;
}

function status(model: Model): { text: string; isWarning: boolean } {
  const { problem, shown } = model;

  if (problem !== undefined) {
    const text = {
      "signed-out": "sign in with /mcp",
      "rate-limited":
        problem.kind === "rate-limited" && problem.seconds !== undefined
          ? `rate limited: wait ${problem.seconds} s`
          : "rate limited: try again shortly",
      off: "Fylgja is not connected",
      failed: "Fylgja did not answer this",
    }[problem.kind];

    return { text, isWarning: true };
  }

  if (model.loading !== undefined) {
    return {
      text: model.loading.startsWith("search:") ? "searching…" : "reading…",
      isWarning: false,
    };
  }

  const said = model.said ?? model.hint;

  if (said !== undefined) {
    return { text: said, isWarning: false };
  }

  if (shown === undefined) {
    return { text: "", isWarning: false };
  }

  const { rows, isCut, isUnfiltered } = shown.listing;
  const where =
    model.scope.length === 0
      ? ""
      : `in ${model.scope.map((step) => step.name).join(" > ")}: `;

  if (rows.length === 0) {
    const nothing =
      shown.source === "timeline"
        ? "nothing in the last two weeks"
        : "nothing found";

    return { text: `${where}${nothing}`, isWarning: false };
  }

  if (isUnfiltered) {
    return {
      text: "nothing of this kind matched: these are all kinds",
      isWarning: false,
    };
  }

  const counted = `${rows.length} ${rows.length === 1 ? "record" : "records"}`;

  return {
    text: isCut
      ? `${where}the first ${counted}: the server cut the list`
      : `${where}${counted}`,
    isWarning: false,
  };
}

function rowLine(
  kit: Kit,
  row: Row,
  columns: number,
  isDim: boolean,
  key: string,
  onPress: () => void,
): RenderElement {
  const { Box, Text, Button } = kit;
  const dateWidth = row.date === "" ? 0 : DATE_WIDTH + 1;
  const title = fit(row.title, Math.max(8, columns - 2 - dateWidth));
  const left = columns - 2 - Array.from(title).length - dateWidth - 1;

  return Box({
    key: `line:${key}`,
    flexDirection: "row",
    columnGap: 1,
    children: [
      Button({
        key,
        plain: true,
        dimColor: isDim,
        label: `${glyphOf(row.kind)} ${title}`,
        onPress,
      }),
      row.date === "" ? null : Text({ dimColor: true, children: [row.date] }),
      // The cue is drawn whole or not at all.
      row.path !== "" && Array.from(row.path).length <= left
        ? Text({ dimColor: true, children: [row.path] })
        : null,
    ],
  });
}

function detailBox(
  kit: Kit,
  model: Model,
  row: Row,
  actions: Actions,
): RenderElement {
  const { Box, Text, Button, Link } = kit;
  const plan = detailPlan(row, model.details.get(row.id), model.columns);
  const inner = Math.max(8, model.columns - INDENT);

  const insert = plan.canInsert
    ? Button({
        key: "act:insert",
        plain: true,
        hotkey: "i",
        label: "insert",
        onPress: () => actions.insert(),
      })
    : Text({ dimColor: true, children: ["no reference for this kind"] });

  const open =
    plan.link === undefined
      ? [Text({ dimColor: true, children: ["no app link from this server"] })]
      : [
          Text({
            children: [Link({ href: plan.link, label: "open in Fylgja" })],
          }),
          Button({
            key: "act:link",
            plain: true,
            hotkey: "o",
            label: "copy link",
            onPress: () => actions.copyLink(),
          }),
        ];

  const line = (key: string, children: RenderElement[]): RenderElement =>
    Box({ key, flexDirection: "row", columnGap: 2, children });

  return Box({
    key: `detail:${row.id}`,
    flexDirection: "column",
    paddingLeft: INDENT,
    children: [
      ...plan.texts.map((text) =>
        Text({
          dimColor: text.isDim,
          wrap: "truncate-end",
          children: [text.text],
        }),
      ),
      ...plan.children.map((child) =>
        rowLine(kit, child, inner, false, `child:${child.id}`, () =>
          actions.stepInto(child),
        ),
      ),
      ...(plan.actionRows === 1
        ? [line("acts", [insert, ...open])]
        : [line("acts", [insert]), line("acts-link", open)]),
    ],
  });
}

function keys(
  kit: Kit,
  model: Model,
  actions: Actions,
  top: number,
  end: number,
): RenderElement {
  const { Box, Text, Button } = kit;
  const count = model.shown?.listing.rows.length ?? 0;
  const isExpanded = model.view.expanded !== null;

  const key = (
    hotkey: string,
    label: string,
    onPress: () => void,
  ): RenderElement =>
    Button({
      key: `act:${label}`,
      plain: true,
      dimColor: true,
      hotkey,
      label,
      onPress,
    });

  return Box({
    key: "keys",
    flexDirection: "row",
    columnGap: 2,
    children: [
      kit.Input === undefined
        ? null
        : key("s", "search", () => actions.focusSearch()),
      count === 0
        ? null
        : key("e", isExpanded ? "collapse" : "expand", () =>
            actions.toggle(undefined),
          ),
      model.scope.length === 0 ? null : key("b", "back", () => actions.back()),
      top > 0 ? key("p", "prev", () => actions.page(-1)) : null,
      end < count ? key("n", "next", () => actions.page(1)) : null,
      end - top < count && model.columns >= 56
        ? Text({ dimColor: true, children: [`${top + 1}-${end} of ${count}`] })
        : null,
      model.isBand
        ? Button({
            key: "act:close",
            plain: true,
            dimColor: true,
            hotkey: "x",
            label: "close",
            role: "dismiss",
            onPress: () => actions.close(),
          })
        : null,
    ],
  });
}

/** The whole tree, for a site `model.columns` wide with `model.room` rows for the list. */
export function draw(kit: Kit, model: Model, actions: Actions): RenderElement {
  const { Box, Text, Button, Input } = kit;
  const rows = model.shown?.listing.rows ?? [];
  const { top, end } = windowNow(model);
  const isDim = model.loading !== undefined || model.isStale;
  const line = status(model);
  const tabs = tabRows(model.columns);

  return Box({
    flexDirection: "column",
    children: [
      Input === undefined
        ? Text({
            dimColor: true,
            children: [
              "search needs a text field, which this surface has none of",
            ],
          })
        : Input({
            key: "q",
            label: "Search",
            placeholder: "meetings, sessions, notes, projects",
            // Handed back on every drawing: a field drawn without it would lose what was typed.
            value: model.view.query,
            submitLabel: "search now",
            autoFocus: true,
            onInput: (value) => actions.typed(value, false),
            onSubmit: (value) => actions.typed(value, true),
          }),
      Box({
        key: "tabs",
        flexDirection: "row",
        flexWrap: "wrap",
        columnGap: 1,
        children: TABS.map((tab) =>
          Button({
            key: `tab:${tab.tab}`,
            plain: true,
            hotkey: tab.hotkey,
            dimColor: tab.tab !== model.view.tab,
            label: tabs.isShort ? tab.short : tab.label,
            onPress: () => actions.tab(tab.tab),
          }),
        ),
      }),
      Text({
        dimColor: !line.isWarning,
        ...(line.isWarning ? { color: "warning" } : {}),
        wrap: "truncate-end",
        children: [line.text === "" ? " " : line.text],
      }),
      ...rows
        .slice(top, end)
        .flatMap((row) => [
          rowLine(kit, row, model.columns, isDim, `row:${row.id}`, () =>
            actions.toggle(row.id),
          ),
          ...(row.id === model.view.expanded
            ? [detailBox(kit, model, row, actions)]
            : []),
        ]),
      keys(kit, model, actions, top, end),
    ],
  });
}
