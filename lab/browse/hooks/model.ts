import type { Tab, View } from "../types";

import type { DetailState } from "./detail";
import type { Listing } from "./records";
import type { Problem } from "./server";

/** The pane's id, and the `requestId` its drawing is asked for under. */
export const PANE = "fylgja-browse";

export const TABS: readonly {
  tab: Tab;
  hotkey: string;
  label: string;
  short: string;
}[] = [
  { tab: "recent", hotkey: "1", label: "Recent", short: "Rec" },
  { tab: "meeting", hotkey: "2", label: "Meetings", short: "Meet" },
  { tab: "session", hotkey: "3", label: "Sessions", short: "Sess" },
  { tab: "note", hotkey: "4", label: "Notes", short: "Note" },
  { tab: "project", hotkey: "5", label: "Projects", short: "Proj" },
];

export const INITIAL_VIEW: View = { query: "", tab: "recent", expanded: null };

/** The list on screen: which answer it came from, for which tab, and its rows. */
export type Shown = {
  source: string;
  tab: Tab;
  listing: Listing;
};

/**
 * Everything the pane draws from. Records live here, in the module's
 * memory, and nowhere else; only `view` is also kept by the session.
 */
export type Model = {
  /** Whether `view` has been read back from the session since this module loaded. */
  isHydrated: boolean;
  view: View;
  /** The projects stepped into, outermost first. Empty at the top of the tree. */
  scope: { id: string; name: string }[];
  shown: Shown | undefined;
  /** The answer the pane is waiting for, when it is. The rows on screen are then the previous ones. */
  loading: string | undefined;
  /** The rows on screen answer an earlier question and nothing newer is being asked. */
  isStale: boolean;
  /** Why the last read gave nothing. */
  problem: Problem | undefined;
  /** One line said instead of a list: what to do to get one. */
  hint: string | undefined;
  /** What the last action came to, until the next one. */
  said: string | undefined;
  /** The index of the first row drawn. */
  top: number;
  /** The row the focus ring was last on. */
  cursor: string | undefined;
  /** How many body rows the list and an expanded row's detail may take, as last drawn. */
  room: number;
  /** How many columns the site is wide, as last drawn. */
  columns: number;
  /** Answers by source, oldest first, so a tab pressed again asks nothing. */
  answers: Map<string, Listing>;
  details: Map<string, DetailState>;
  /** Counts reads started; an answer to an earlier one than the latest is out of date. */
  asked: number;
  /** The pause before a typed query is sent. */
  timer: { cancel: () => void } | undefined;
  /** Whether the compact version above the prompt stands in for a pane that could not be placed. */
  isBand: boolean;
  /** The `requestId` of the site last drawn in, for moving the focus there. */
  site: string;
};

export function create(): Model {
  return {
    isHydrated: false,
    view: INITIAL_VIEW,
    scope: [],
    shown: undefined,
    loading: undefined,
    isStale: false,
    problem: undefined,
    hint: undefined,
    said: undefined,
    top: 0,
    cursor: undefined,
    room: 12,
    columns: 60,
    answers: new Map(),
    details: new Map(),
    asked: 0,
    timer: undefined,
    isBand: false,
    site: PANE,
  };
}

/** Forgets every record and what was on screen; the pane's own seat is kept. */
export function startOver(model: Model): void {
  model.timer?.cancel();
  Object.assign(model, create(), { isBand: model.isBand, site: model.site });
}
