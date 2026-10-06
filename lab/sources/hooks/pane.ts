/**
 * Drawing the sources pane. Everything a record or a reply holds passes the
 * sanitiser on its way in; the words around it are fixed.
 */

import type { Elements, RenderElement } from "claude-code";

import { BACKED, glyphOf, UNBACKED } from "./glyphs";
import type { Coverage } from "./ledger";
import { drawn } from "./plain";
import type { Answer, Judged, Row, Standing } from "./view";

/** The elements the pane is made of: the four every surface draws. */
export type Kit = Pick<Elements["mobile"], "Box" | "Text" | "Button" | "Link">;

/** What the pane shows, apart from the ledger itself. */
export type PaneState = {
  /** The last answer alone, or every answer folded. */
  mode: "last" | "all";
  /** The answers shown unfolded in the list of all, by number. */
  unfolded: Set<number>;
  /** One line about the last thing the person did in the pane that could not be done. */
  notice: string | undefined;
  needsSignIn: boolean;
};

/** What a press in the pane asks for. */
export type Actions = {
  show: (mode: PaneState["mode"]) => void;
  toggle: (answer: number) => void;
  /** Puts a reference into the prompt box. */
  insert: (reference: string) => void;
};

export const SIGN_IN_LINE = "Fylgja needs sign-in: type /mcp";

const MAX_TITLE = 120;
const MAX_ROWS = 40;
const MAX_ANSWERS = 60;

const STANDING: Readonly<Record<Standing, string>> = {
  opened: "read in this session",
  subagent: "read by a subagent in this session",
  returned: "returned by a search or a list, not opened",
  unread: "not read in this session",
  unsure: "not seen, but this session cannot be looked through to its start",
};

export function createState(): PaneState {
  return {
    mode: "last",
    unfolded: new Set(),
    notice: undefined,
    needsSignIn: false,
  };
}

/** A record's title as drawn; a record without one is named by its kind and the start of its id. */
function nameOf(kind: string, title: string, id: string | undefined): string {
  const safe = drawn(title, MAX_TITLE);

  return safe !== ""
    ? safe
    : `${kind}${id === undefined ? "" : ` ${id.slice(0, 8)}`}`;
}

function rowOf(
  kit: Kit,
  row: Row,
  key: string,
  actions: Actions,
): RenderElement {
  const { Box, Text, Button, Link } = kit;
  const { seen, reference } = row;
  const date = seen.date === undefined ? "" : drawn(seen.date, 10);
  const project =
    seen.project === undefined ? "" : drawn(seen.project, MAX_TITLE);
  const how = project === "" ? row.reached : `${row.reached}, in ${project}`;

  return Box({
    key,
    flexDirection: "column",
    children: [
      Box({
        flexDirection: "row",
        children: [
          Text({ children: [`${glyphOf(seen.kind)} `] }),
          Text({
            bold: true,
            wrap: "truncate-end",
            children: [nameOf(seen.kind, seen.title, seen.id)],
          }),
          ...(date === ""
            ? []
            : [Text({ dimColor: true, children: [`  ${date}`] })]),
        ],
      }),
      Box({
        flexDirection: "row",
        flexWrap: "wrap",
        columnGap: 2,
        marginLeft: 2,
        children: [
          Text({ dimColor: true, children: [how] }),
          ...(seen.link === undefined
            ? []
            : [Link({ href: seen.link, label: "Open in Fylgja" })]),
          ...(reference === undefined
            ? []
            : [
                Button({
                  key: `ref-${key}`,
                  label: "Put reference in prompt",
                  plain: true,
                  onPress: () => actions.insert(reference),
                }),
              ]),
        ],
      }),
    ],
  });
}

function rowsOf(
  kit: Kit,
  rows: readonly Row[],
  key: string,
  actions: Actions,
): RenderElement[] {
  const shown = rows
    .slice(0, MAX_ROWS)
    .map((row, at) => rowOf(kit, row, `${key}-${at}`, actions));

  return rows.length <= MAX_ROWS
    ? shown
    : [
        ...shown,
        kit.Text({
          dimColor: true,
          children: [`… and ${rows.length - MAX_ROWS} more`],
        }),
      ];
}

function citationOf(kit: Kit, cited: Judged, key: string): RenderElement {
  const { Box, Text } = kit;
  const isBacked = cited.standing !== "unread" && cited.standing !== "unsure";

  return Box({
    key,
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 1,
    children: [
      Text({
        color: isBacked
          ? "success"
          : cited.standing === "unread"
            ? "warning"
            : "inactive",
        children: [isBacked ? BACKED : UNBACKED],
      }),
      Text({
        wrap: "truncate-end",
        children: [
          `${glyphOf(cited.kind)} ${nameOf(cited.kind, cited.title, cited.id)}`,
        ],
      }),
      Text({ dimColor: isBacked, children: [STANDING[cited.standing]] }),
    ],
  });
}

function answerOf(kit: Kit, answer: Answer, actions: Actions): RenderElement[] {
  const { Text } = kit;
  const key = `a${answer.number}`;
  const parts: RenderElement[] = [];

  if (answer.rows.length === 0 && answer.helperRows.length === 0) {
    parts.push(
      Text({
        dimColor: true,
        children: ["Nothing was opened in Fylgja for this answer."],
      }),
    );
  }

  parts.push(...rowsOf(kit, answer.rows, key, actions));

  if (answer.helperRows.length > 0) {
    parts.push(
      Text({
        dimColor: true,
        children: ["Read by a subagent, not by Claude itself:"],
      }),
    );
    parts.push(...rowsOf(kit, answer.helperRows, `${key}-sub`, actions));
  }

  parts.push(
    ...answer.notes.map((note) => Text({ dimColor: true, children: [note] })),
  );

  if (answer.citations.length > 0) {
    parts.push(Text({ children: ["Cited in the answer:"] }));
    parts.push(
      ...answer.citations
        .slice(0, MAX_ROWS)
        .map((cited, at) => citationOf(kit, cited, `${key}-c${at}`)),
    );

    if (answer.citations.some((cited) => cited.standing === "unread")) {
      parts.push(
        Text({
          dimColor: true,
          children: [
            `${UNBACKED} says only that no Fylgja read of this session returned the record. Claude may hold it from earlier context.`,
          ],
        }),
      );
    }
  }

  return parts;
}

function coverageLine(coverage: Coverage): string | undefined {
  switch (coverage) {
    case "whole":
      return undefined;
    case "partial":
      return "This conversation is longer than can be looked back through: what was read early on may be missing.";
    case "unknown":
      return "What was read earlier in this conversation is not known yet.";
  }
}

/**
 * The pane: the last answer's sources, or every answer newest first, each
 * folded to one line of counts until pressed.
 *
 * @param answers every answer of the conversation, oldest first
 */
export function drawPane(
  kit: Kit,
  state: PaneState,
  answers: readonly Answer[],
  coverage: Coverage,
  actions: Actions,
): RenderElement {
  const { Box, Text, Button } = kit;
  const isLast = state.mode === "last";
  const last = answers.at(-1);
  const body: RenderElement[] = [];

  if (last === undefined) {
    body.push(
      Text({
        dimColor: true,
        children: ["Claude has not answered in this conversation yet."],
      }),
    );
  } else if (isLast) {
    body.push(...answerOf(kit, last, actions));
  } else {
    for (const answer of answers.slice(-MAX_ANSWERS).reverse()) {
      const isOpen = state.unfolded.has(answer.number);

      body.push(
        Button({
          key: `fold-${answer.number}`,
          label: `${isOpen ? "▾" : "▸"} ${answer.summary}`,
          plain: true,
          onPress: () => actions.toggle(answer.number),
        }),
      );

      if (isOpen) {
        body.push(
          Box({
            flexDirection: "column",
            marginLeft: 2,
            children: answerOf(kit, answer, actions),
          }),
        );
      }
    }
  }

  const footer = coverageLine(coverage);

  return Box({
    flexDirection: "column",
    children: [
      Box({
        flexDirection: "row",
        flexWrap: "wrap",
        columnGap: 2,
        children: [
          Text({
            bold: true,
            children: [
              isLast
                ? "Sources of the last answer"
                : "Sources of every answer, newest first",
            ],
          }),
          Button({
            key: "mode",
            label: isLast ? "Show every answer" : "Show the last answer",
            plain: true,
            dimColor: true,
            onPress: () => actions.show(isLast ? "all" : "last"),
          }),
        ],
      }),
      ...(state.needsSignIn
        ? [Text({ color: "warning", children: [SIGN_IN_LINE] })]
        : []),
      ...(state.notice === undefined
        ? []
        : [Text({ dimColor: true, children: [state.notice] })]),
      ...body,
      ...(footer === undefined
        ? []
        : [Text({ dimColor: true, children: [footer] })]),
    ],
  });
}
