/**
 * What the pane does when the person acts on it: which answer the list
 * needs, when it is asked for, and what becomes of the answer.
 *
 * Fylgja's `search` is billed per call and limited per minute, so a typed
 * query waits out a pause before it is sent, an answer already held is never
 * asked for again, and an answer nobody is waiting for any more is kept for
 * later instead of shown.
 */

import type { Tab } from "../types";

import { isDetail, loadDetail } from "./detail";
import { unfence } from "./fence";
import type { Host } from "./host";
import { detailPlan, reveal, windowOf } from "./layout";
import type { Model } from "./model";
import {
  childListing,
  projectListing,
  searchListing,
  timelineListing,
} from "./records";
import type { Listing, Row } from "./records";
import { referenceOf } from "./reference";
import { ask, isProblem } from "./server";
import type { Answer } from "./server";

/** How long typing has to rest before the query is sent. */
export const PAUSE_MS = 450;

/** The fewest characters worth a search. */
export const QUERY_MIN = 2;

const QUERY_MAX = 200;
const ANSWERS_MAX = 16;
const DETAILS_MAX = 40;

/** The kinds a search hit may have and still be listed under Notes. */
const NOTE_KINDS = new Set(["note", "document"]);

/** The kinds `search` narrows to on the server; every other tab is narrowed here. */
const SEARCHED_BY_KIND = new Set<Tab>(["meeting", "session", "project"]);

type Plan =
  | {
      /** What the answer is kept under. Two views that need the same answer share one. */
      source: string;
      tool: string;
      args: Record<string, unknown>;
      read: (answer: Answer) => Listing | undefined;
      /** Which of the answer's rows this tab lists. */
      keep: (row: Row) => boolean;
    }
  | { hint: string };

function queryOf(model: Model): string {
  const query = model.view.query.trim();

  return Array.from(query).length >= QUERY_MIN ? query : "";
}

function json(read: (payload: Record<string, unknown>) => Listing | undefined) {
  return (answer: Answer): Listing | undefined =>
    answer.kind === "json" ? read(answer.payload) : undefined;
}

function planOf(model: Model): Plan {
  const { tab } = model.view;
  const query = queryOf(model);

  if (query !== "") {
    const kind = SEARCHED_BY_KIND.has(tab) ? tab : undefined;

    return {
      source: `search:${kind ?? ""}:${query}`,
      tool: "search",
      args: { query, limit: 20, ...(kind === undefined ? {} : { kind }) },
      read: json(searchListing),
      // The server's search has no filter for notes, so that tab keeps the notes of an unfiltered search.
      keep: (row) => tab !== "note" || NOTE_KINDS.has(row.kind),
    };
  }

  if (tab === "project") {
    const inside = model.scope.at(-1);

    return inside === undefined
      ? {
          source: "projects",
          tool: "get_project",
          args: { limit: 200 },
          read: json(projectListing),
          keep: () => true,
        }
      : {
          source: `outline:${inside.id}`,
          tool: "open",
          args: { ref: inside.id },
          read: json(childListing),
          keep: () => true,
        };
  }

  if (tab === "note") {
    return { hint: `type ${QUERY_MIN} characters to search notes` };
  }

  return {
    source: "timeline",
    tool: "get_timeline",
    args: { limit: 100 },
    read: (answer) =>
      answer.kind === "text"
        ? timelineListing(unfence(answer.text).body)
        : undefined,
    keep: (row) => tab === "recent" || row.kind === tab,
  };
}

function keepBounded<V>(
  map: Map<string, V>,
  key: string,
  value: V,
  max: number,
): void {
  map.delete(key);
  map.set(key, value);

  for (const oldest of map.keys()) {
    if (map.size <= max) {
      break;
    }

    map.delete(oldest);
  }
}

function rowsOf(model: Model): Row[] {
  return model.shown?.listing.rows ?? [];
}

function costOf(model: Model): (index: number) => number {
  const rows = rowsOf(model);

  return (index) => {
    const row = rows[index];

    return row !== undefined && row.id === model.view.expanded
      ? 1 + detailPlan(row, model.details.get(row.id), model.columns).rows
      : 1;
  };
}

/** The rows `[top, end)` drawn now. */
export function windowNow(model: Model): { top: number; end: number } {
  return windowOf(rowsOf(model).length, model.top, model.room, costOf(model));
}

function bringIntoView(model: Model, id: string | null | undefined): void {
  const index = rowsOf(model).findIndex((row) => row.id === id);

  if (index >= 0) {
    model.top = reveal(
      rowsOf(model).length,
      model.top,
      model.room,
      costOf(model),
      index,
    );
  }
}

function save(host: Host, model: Model): void {
  host.saveView(model.view);
}

/** Asks for the expanded row's detail unless it is known or being asked for. */
function wantDetail(host: Host, model: Model): void {
  const row = rowsOf(model).find((one) => one.id === model.view.expanded);

  if (row === undefined) {
    return;
  }

  const known = model.details.get(row.id);

  if (known === "loading" || isDetail(known)) {
    return;
  }

  keepBounded(model.details, row.id, "loading", DETAILS_MAX);

  void loadDetail(host, row)
    .catch(() => ({ kind: "failed" }) as const)
    .then((detail) => {
      // Asked for before the conversation was cleared: not this one's to keep.
      if (model.details.get(row.id) !== "loading") {
        return;
      }

      keepBounded(model.details, row.id, detail, DETAILS_MAX);
      bringIntoView(model, model.view.expanded);
      host.redraw();
    });
}

function show(
  host: Host,
  model: Model,
  plan: Exclude<Plan, { hint: string }>,
  listing: Listing,
): void {
  const isSameList =
    model.shown?.source === plan.source && model.shown.tab === model.view.tab;

  model.shown = {
    source: plan.source,
    tab: model.view.tab,
    listing: { ...listing, rows: listing.rows.filter(plan.keep) },
  };
  model.loading = undefined;
  model.isStale = false;
  model.problem = undefined;
  model.hint = undefined;

  if (!isSameList) {
    model.top = 0;
    model.cursor = undefined;
  }

  bringIntoView(model, model.view.expanded);
  wantDetail(host, model);
}

async function load(
  host: Host,
  model: Model,
  plan: Exclude<Plan, { hint: string }>,
): Promise<void> {
  model.asked += 1;
  const turn = model.asked;
  const answer = await ask(host, plan.tool, plan.args);
  const listing = isProblem(answer) ? undefined : plan.read(answer);

  // Paid for, so kept, even when the person has typed on since.
  if (listing !== undefined) {
    keepBounded(model.answers, plan.source, listing, ANSWERS_MAX);
  }

  if (turn !== model.asked || model.loading !== plan.source) {
    return;
  }

  if (listing === undefined) {
    // The rows of the answer before stay, dimmed, under the one line that says why.
    model.loading = undefined;
    model.isStale = model.shown !== undefined;
    model.problem = isProblem(answer) ? answer : { kind: "failed" };
  } else {
    show(host, model, plan, listing);
  }

  host.redraw();
}

/**
 * Makes the list answer what the pane now asks: at once from an answer
 * already held, otherwise from the server, now or after the typing pause.
 *
 * @param isTyping the question came from a keystroke, so it waits out the
 *   pause and whatever is on screen stays there meanwhile
 * @param isFresh an answer already held is asked for again
 */
export function refresh(
  host: Host,
  model: Model,
  isTyping: boolean,
  isFresh = false,
): void {
  const plan = planOf(model);

  model.timer?.cancel();
  model.timer = undefined;
  // An answer still on its way is for a question no longer asked.
  model.asked += 1;
  model.loading = undefined;
  model.said = undefined;

  if ("hint" in plan) {
    model.hint = plan.hint;
    model.problem = undefined;
    // Typing never empties the list: the last rows stay, dimmed.
    model.isStale = isTyping && model.shown !== undefined;
    model.shown = model.isStale ? model.shown : undefined;
    host.redraw();

    return;
  }

  const held = isFresh ? undefined : model.answers.get(plan.source);

  if (held !== undefined) {
    show(host, model, plan, held);
    host.redraw();

    return;
  }

  model.loading = plan.source;
  model.hint = undefined;

  const send = (): void => {
    model.timer = undefined;
    void load(host, model, plan).catch(() => undefined);
  };

  if (isTyping) {
    model.timer = host.after(PAUSE_MS, send);
  } else {
    send();
  }

  host.redraw();
}

/** Reads back what the pane was showing, once per load of this module. */
export async function hydrate(host: Host, model: Model): Promise<void> {
  if (model.isHydrated) {
    return;
  }

  model.isHydrated = true;
  model.view = await host.loadView().catch(() => model.view);
}

/**
 * `/fylgja`, optionally with something to search for: opens the pane where
 * it was left, or the compact version above the prompt when no pane can be
 * placed. Lists that cost nothing are read again; a search already answered
 * is not.
 */
export async function opened(
  host: Host,
  model: Model,
  args: string,
): Promise<void> {
  await hydrate(host, model);

  const query = args.trim().slice(0, QUERY_MAX);

  if (query !== "") {
    model.view = { ...model.view, query, expanded: null };
    model.scope = [];
    save(host, model);
  }

  model.isBand = !(await host.open().catch(() => false));
  refresh(host, model, false, queryOf(model) === "");
}

/** A keystroke in the search field. */
export function typed(
  host: Host,
  model: Model,
  value: string,
  isSubmitted: boolean,
): void {
  model.view = { ...model.view, query: value.slice(0, QUERY_MAX) };

  if (queryOf(model) !== "") {
    model.scope = [];
  }

  save(host, model);
  refresh(host, model, !isSubmitted);

  const length = Array.from(value.trim()).length;

  if (length > 0 && length < QUERY_MIN) {
    model.said = `type ${QUERY_MIN} characters to search`;
  }
}

export function tabPicked(host: Host, model: Model, tab: Tab): void {
  model.view = { ...model.view, tab, expanded: null };
  model.scope = [];
  save(host, model);
  refresh(host, model, false);
}

/** Expands `id` in place, or collapses it when it is the expanded row. One row is expanded at a time. */
export function toggled(
  host: Host,
  model: Model,
  id: string | undefined,
): void {
  const target =
    id ??
    model.view.expanded ??
    model.cursor ??
    rowsOf(model)[windowNow(model).top]?.id;

  if (target === undefined) {
    return;
  }

  model.view = {
    ...model.view,
    expanded: model.view.expanded === target ? null : target,
  };
  model.cursor = target;
  model.said = undefined;
  save(host, model);
  bringIntoView(model, target);
  wantDetail(host, model);
  host.redraw();
}

/** Steps into a project: the list becomes the projects under it. */
export function steppedInto(host: Host, model: Model, project: Row): void {
  model.scope = [...model.scope, { id: project.id, name: project.title }];
  model.view = { query: "", tab: "project", expanded: null };
  save(host, model);
  refresh(host, model, false);
}

export function steppedBack(host: Host, model: Model): void {
  model.scope = model.scope.slice(0, -1);
  model.view = { ...model.view, expanded: null };
  save(host, model);
  refresh(host, model, false);
}

/** Moves the list by `by` rows, as the wheel, the page keys and the page buttons ask. */
export function scrolled(host: Host, model: Model, by: number): void {
  const last = Math.max(0, rowsOf(model).length - 1);
  const top = Math.max(0, Math.min(last, model.top + by));

  if (top !== model.top) {
    model.top = top;
    host.redraw();
  }
}

export function paged(host: Host, model: Model, direction: 1 | -1): void {
  const { top, end } = windowNow(model);

  scrolled(host, model, direction * Math.max(1, end - top));
}

/**
 * The focus ring landed on a row. When that row is the first or last one
 * drawn and the list goes on, the list moves by one, so the arrows walk the
 * whole list and not only the rows that fit.
 */
export function rowFocused(host: Host, model: Model, id: string): void {
  const rows = rowsOf(model);
  const index = rows.findIndex((row) => row.id === id);
  const { top, end } = windowNow(model);

  model.cursor = id;

  if (index < 0) {
    return;
  }

  if (index === top && top > 0) {
    scrolled(host, model, -1);
  } else if (index === end - 1 && end < rows.length) {
    scrolled(host, model, 1);
  }
}

/** Puts the expanded record's reference into the prompt box. The person sends it, or does not. */
export async function referenceInserted(
  host: Host,
  model: Model,
): Promise<void> {
  const row = rowsOf(model).find((one) => one.id === model.view.expanded);
  const reference = row === undefined ? undefined : referenceOf(row);

  if (reference === undefined) {
    model.said = "this kind of record has no reference";
  } else {
    const isIn = await host.insert(`${reference} `).catch(() => false);

    model.said = isIn
      ? "reference put in the prompt box"
      : "the prompt box did not take it";
  }

  host.redraw();
}

/** Copies the expanded record's link, for where a link cannot be clicked. Says so when there is none. */
export async function linkCopied(host: Host, model: Model): Promise<void> {
  const row = rowsOf(model).find((one) => one.id === model.view.expanded);
  const detail = row === undefined ? undefined : model.details.get(row.id);
  const link = (isDetail(detail) ? detail.link : undefined) ?? row?.link;

  if (link === undefined) {
    model.said = "this server gives no app link";
  } else {
    model.said = (await host.copy(link).catch(() => false))
      ? "link copied"
      : "the link could not be copied: click it";
  }

  host.redraw();
}

/** Whether the pane has a list, is waiting for one, or has said why there is none. */
export function hasAnything(model: Model): boolean {
  return (
    model.shown !== undefined ||
    model.loading !== undefined ||
    model.problem !== undefined ||
    model.hint !== undefined
  );
}
