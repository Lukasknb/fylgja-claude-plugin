/**
 * What one picture is drawn from, and the reads that fetch it.
 *
 * A window is fetched once and held. A wider window fetches only the days
 * that are missing; a narrower one fetches nothing. Reads are bounded: a
 * window the server cannot give whole is split in two a few times, and what
 * is still incomplete after that is said so on the picture.
 */

import { askJson, askText } from "./answer";
import { dayAt, isoOf } from "./days";
import type { Host } from "./host";
import { outlineOf } from "./outline";
import type { Child, Outline } from "./outline";
import type { Scope } from "./scope";
import { keyOf, readTimeline } from "./timeline";
import type { Entry } from "./timeline";

/** The most entries one `get_timeline` call returns. */
const PAGE = 100;

/** How many `get_timeline` calls one fetch may make while splitting a window that came back incomplete. */
const MAX_TIMELINE_CALLS = 7;

/** No picture holds more entries than this; the oldest go first. */
export const MAX_ENTRIES = 800;

/** How many children have their own children fetched for the constellation, largest first. */
export const MAX_MOON_PARENTS = 6;

/** How many of one child's children the constellation keeps. */
const MAX_MOONS = 8;

export type Picture = {
  scope: Scope;
  /** The project and its children, for a project's picture. */
  outline: Outline | null;
  /** Newest first. */
  entries: Entry[];
  /** The first day the entries cover. */
  sinceDay: number;
  /** The day the entries were last fetched on: the right edge of the window. */
  untilDay: number;
  /** Whether entries the window should hold are known or suspected to be missing. */
  isCut: boolean;
  /** Lines of the server's text that could not be read. */
  unread: number;
  /** The children of children, by the child's id; fetched only for the constellation. */
  moons: Map<string, Child[]>;
  /** Whether the children of children were asked for. */
  hasMoons: boolean;
};

export type Fetched =
  | { ok: true; picture: Picture }
  | { ok: false; why: "sign-in" | "off" | "project" | "timeline" };

type Span = {
  entries: Entry[];
  /** The unreadable lines, each once however often a split window returned it. */
  unread: Set<string>;
  isCut: boolean;
  hasFailed: boolean;
};
type Reader = (window: Record<string, unknown>) => Promise<string | undefined>;

function merged(lists: readonly (readonly Entry[])[]): Entry[] {
  const seen = new Set<string>();
  const all: Entry[] = [];

  for (const list of lists) {
    for (const entry of list) {
      const key = keyOf(entry);

      if (!seen.has(key)) {
        seen.add(key);
        all.push(entry);
      }
    }
  }

  return all.sort((a, b) => b.day - a.day);
}

/**
 * The entries from `since` to `until` (to now when `until` is null).
 *
 * When the server says it left entries out, the days are split in two and
 * each half is asked for, as long as calls remain; the server caps each kind
 * of entry separately, so paging by the oldest date seen would skip entries.
 * Recent activity lists at most a page of meetings without saying more
 * exist, so a full page of them counts as incomplete too.
 */
async function spanOf(
  read: Reader,
  scope: Scope,
  since: number,
  until: number | null,
  today: number,
  budget: { left: number },
): Promise<Span> {
  if (budget.left <= 0) {
    return { entries: [], unread: new Set(), isCut: true, hasFailed: false };
  }

  budget.left -= 1;

  const text = await read({
    since: isoOf(since),
    // The end of the day: a bare date would end the window at its first moment.
    ...(until === null ? {} : { until: `${isoOf(until)}T23:59:59` }),
    limit: PAGE,
  });

  if (text === undefined) {
    return { entries: [], unread: new Set(), isCut: true, hasFailed: true };
  }

  const got = readTimeline(text);
  const isFullPage =
    scope.kind === "all" &&
    got.entries.filter((entry) => entry.lane === "meeting").length >= PAGE;
  const isCut = got.isCut || isFullPage;
  const end = until ?? today;

  if (!isCut || since >= end || budget.left < 2) {
    return {
      entries: got.entries,
      unread: new Set(got.unread),
      isCut,
      hasFailed: false,
    };
  }

  const middle = Math.floor((since + end) / 2);
  const newer = await spanOf(read, scope, middle + 1, until, today, budget);
  const older = await spanOf(read, scope, since, middle, today, budget);

  return {
    entries: merged([got.entries, newer.entries, older.entries]),
    unread: new Set([...got.unread, ...newer.unread, ...older.unread]),
    isCut: newer.isCut || older.isCut,
    hasFailed: false,
  };
}

/** Whether `known` already covers the last `days` days as of `today`. */
export function covers(
  known: Picture | undefined,
  days: number,
  today: number,
): boolean {
  return (
    known !== undefined &&
    known.untilDay === today &&
    known.sinceDay <= today - days + 1
  );
}

/**
 * The picture for `scope` over the last `days` days: `known` extended back
 * when it was fetched today, a fresh one otherwise.
 */
export async function fetchPicture(
  host: Host,
  scope: Scope,
  days: number,
  known?: Picture,
): Promise<Fetched> {
  const connection = await host
    .connect()
    .catch(() => ({ isConnected: false as const, reason: "failed" }));

  if (!connection.isConnected) {
    return { ok: false, why: connection.reason === "auth" ? "sign-in" : "off" };
  }

  const server = connection.server;
  const today = dayAt(await host.now());
  const since = today - days + 1;
  let outline = known?.outline ?? null;

  if (scope.kind === "project" && outline === null) {
    outline =
      outlineOf(
        await askJson(host, server, "open", { ref: scope.ref, detail: false }),
      ) ?? null;

    if (outline === null) {
      return { ok: false, why: "project" };
    }
  }

  if (known !== undefined && covers(known, days, today)) {
    return { ok: true, picture: known };
  }

  const where =
    outline !== null
      ? { project_name: outline.id }
      : scope.kind === "repo"
        ? { repo: scope.repo }
        : {};
  const read: Reader = (window) =>
    askText(host, server, "get_timeline", { ...where, ...window });
  const budget = { left: MAX_TIMELINE_CALLS };
  const held =
    known !== undefined && known.untilDay === today ? known : undefined;
  const got = await spanOf(
    read,
    scope,
    since,
    held === undefined ? null : held.sinceDay - 1,
    today,
    budget,
  );

  if (got.hasFailed) {
    // A read that fails outright may be a sign-in that lapsed.
    const again = await host
      .connect()
      .catch(() => ({ isConnected: false as const, reason: "failed" }));

    return {
      ok: false,
      why:
        !again.isConnected && again.reason === "auth" ? "sign-in" : "timeline",
    };
  }

  const all = merged([held?.entries ?? [], got.entries]);

  return {
    ok: true,
    picture: {
      scope,
      outline,
      entries: all.slice(0, MAX_ENTRIES),
      sinceDay: since,
      untilDay: today,
      isCut: got.isCut || (held?.isCut ?? false) || all.length > MAX_ENTRIES,
      unread: got.unread.size + (held?.unread ?? 0),
      moons: held?.moons ?? new Map(),
      hasMoons: held?.hasMoons ?? false,
    },
  };
}

/**
 * Fetches the children of the largest children that have any, one `open`
 * each, for the constellation. A child whose outline cannot be read simply
 * has none shown.
 */
export async function fetchMoons(host: Host, picture: Picture): Promise<void> {
  const outline = picture.outline;

  if (outline === null || picture.hasMoons) {
    return;
  }

  picture.hasMoons = true;

  const connection = await host
    .connect()
    .catch(() => ({ isConnected: false as const, reason: "failed" }));

  if (!connection.isConnected) {
    return;
  }

  const parents = outline.kids
    .filter((kid) => kid.children > 0)
    .sort((a, b) => b.filed - a.filed)
    .slice(0, MAX_MOON_PARENTS);

  for (const parent of parents) {
    const under = outlineOf(
      await askJson(host, connection.server, "open", {
        ref: parent.id,
        detail: false,
      }),
    );

    if (under !== undefined) {
      picture.moons.set(
        parent.id,
        [...under.kids].sort((a, b) => b.filed - a.filed).slice(0, MAX_MOONS),
      );
    }
  }
}
