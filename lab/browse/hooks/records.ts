/**
 * The rows of the list, read out of what Fylgja's tools answer. Every piece
 * of text is made safe to draw here, once, so nothing downstream handles the
 * server's own words; only an id and a kind ever decide what happens next.
 */

import { drawn } from "./plain";
import { isRecord } from "./server";

/** One record as the list shows it. Every string is already safe to draw. */
export type Row = {
  /** The record's id, lower-cased. */
  id: string;
  /** `meeting`, `session`, `note`, `project`, or another kind the server names. */
  kind: string;
  title: string;
  /** `YYYY-MM-DD`, or empty when the record carries no date. */
  date: string;
  /**
   * The one cue drawn dim after the date when it fits: where the record is
   * filed (the project path joined with ` > `), or for a project in a list
   * what the list knows about it (`archived`, how many projects are under it).
   */
  path: string;
  /** The link that opens the record in the Fylgja app, when the server gave one. */
  link: string | undefined;
};

/** One answer's rows, and what has to be said about them. */
export type Listing = {
  rows: Row[];
  /** The server said it cut the answer short. */
  isCut: boolean;
  /** A filter matched nothing and the server answered unfiltered. */
  isUnfiltered: boolean;
};

const TITLE_MAX = 120;
const PATH_MAX = 80;
const ROWS_MAX = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}/;

/** The host records are opened on: the one this plugin's server entry names. */
const APP_HOST = "fylgja.lknblab.dev";

/** A record id in the one spelling used as a key, or undefined when `value` is not one. */
export function idOf(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const id = value.trim().toLowerCase();

  return UUID.test(id) ? id : undefined;
}

function kindOf(value: unknown): string {
  return typeof value === "string" && /^[a-z][a-z_ ]{0,23}$/.test(value)
    ? value
    : "record";
}

function dateOf(value: unknown): string {
  return typeof value === "string" && DATE.test(value)
    ? value.slice(0, 10)
    : "";
}

function pathOf(project: unknown): string {
  if (!isRecord(project) || !Array.isArray(project.path)) {
    return "";
  }

  const names = project.path.filter(
    (name): name is string => typeof name === "string",
  );

  return drawn(names.join(" > "), PATH_MAX);
}

/**
 * The server's link to a record, when it is one: an https address on
 * Fylgja's own host that ends in this record's id. Anything else is no link;
 * none is ever made up here.
 */
export function linkOf(value: unknown, id: string): string | undefined {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !URL.canParse(value)
  ) {
    return undefined;
  }

  const url = new URL(value);
  const isRecordPage =
    /^\/open\/[a-z]+\/[0-9a-f-]{36}$/.test(url.pathname) &&
    url.pathname.endsWith(`/${id}`);

  return url.protocol === "https:" && url.hostname === APP_HOST && isRecordPage
    ? url.href
    : undefined;
}

/** `rows` without a second row for the same record, at most as many as the list ever holds. */
function distinct(rows: readonly (Row | undefined)[]): Row[] {
  const seen = new Set<string>();
  const kept: Row[] = [];

  for (const row of rows) {
    if (row !== undefined && !seen.has(row.id) && kept.length < ROWS_MAX) {
      seen.add(row.id);
      kept.push(row);
    }
  }

  return kept;
}

function hitOf(hit: unknown): Row | undefined {
  if (!isRecord(hit)) {
    return undefined;
  }

  const id = idOf(hit.id);

  if (id === undefined) {
    return undefined;
  }

  return {
    id,
    kind: kindOf(hit.type),
    title:
      drawn(typeof hit.title === "string" ? hit.title : "", TITLE_MAX) ||
      "untitled",
    date: dateOf(hit.date),
    path: pathOf(hit.project),
    link: linkOf(hit.link, id),
  };
}

/** The hits of `search`, or undefined when the answer is not a search result. */
export function searchListing(
  payload: Record<string, unknown>,
): Listing | undefined {
  if (!Array.isArray(payload.results)) {
    return undefined;
  }

  return {
    rows: distinct(payload.results.map(hitOf)),
    isCut: payload.truncated === true,
    isUnfiltered: payload.filter_matched === false,
  };
}

/** The projects `get_project` lists when asked without a name. */
export function projectListing(
  payload: Record<string, unknown>,
): Listing | undefined {
  if (!Array.isArray(payload.projects)) {
    return undefined;
  }

  const rows = payload.projects.map((project): Row | undefined => {
    const id = isRecord(project) ? idOf(project.id) : undefined;

    if (!isRecord(project) || id === undefined) {
      return undefined;
    }

    return {
      id,
      kind: "project",
      title:
        drawn(
          typeof project.name === "string" ? project.name : "",
          TITLE_MAX,
        ) || "unnamed",
      date: "",
      path: project.archived === true ? "archived" : "",
      link: linkOf(project.link, id),
    };
  });

  const kept = distinct(rows);
  const total = typeof payload.total === "number" ? payload.total : kept.length;

  return {
    rows: kept,
    isCut: payload.truncated === true || total > kept.length,
    isUnfiltered: false,
  };
}

/**
 * The projects one level under a project, from its outline as `open`
 * answers it, or undefined when the answer is not an outline.
 */
export function childListing(
  payload: Record<string, unknown>,
): Listing | undefined {
  if (!Array.isArray(payload.children)) {
    return undefined;
  }

  const rows = payload.children.map((child): Row | undefined => {
    const id = isRecord(child) ? idOf(child.id) : undefined;

    if (!isRecord(child) || id === undefined) {
      return undefined;
    }

    const under =
      typeof child.children === "number" && child.children > 0
        ? `${child.children} under it`
        : "";

    return {
      id,
      kind: "project",
      title:
        drawn(typeof child.name === "string" ? child.name : "", TITLE_MAX) ||
        "unnamed",
      date: dateOf(child.last_activity),
      path: under,
      link: undefined,
    };
  });

  const hasMore =
    typeof payload.next_cursor === "string" && payload.next_cursor !== "";

  return {
    rows: distinct(rows),
    isCut: hasMore || payload.truncated === true,
    isUnfiltered: false,
  };
}

const SESSION_HEAD = /^- \[(\d{4}-\d{2}-\d{2})\] \*\*(.*)\*\*(?: — (.*))?$/;
const SESSION_ID = /^\s+id: ([0-9a-fA-F-]{36})\b/;
const FILED = /^- ([0-9a-fA-F-]{36}) · in (.+)$/;
const MEETING =
  /^- (\d{4}-\d{2}-\d{2}) · meeting · (.*) \(id: ([0-9a-fA-F-]{36})\)$/;
const PLACE = " · in ";

/**
 * The sessions and meetings in the text `get_timeline` answers when asked
 * for everything recent, newest first. A line that does not read as one of
 * the two is skipped: the text is prose the server may reword.
 */
export function timelineListing(body: string): Listing {
  const lines = body.split("\n");
  const rows: Row[] = [];
  const filed = new Map<string, string>();

  for (const [at, line] of lines.entries()) {
    const session = SESSION_HEAD.exec(line);
    const sessionId =
      session === null
        ? undefined
        : idOf(SESSION_ID.exec(lines[at + 1] ?? "")?.[1]);

    if (session !== null && sessionId !== undefined) {
      rows.push({
        id: sessionId,
        kind: "session",
        title: drawn(session[2] ?? "", TITLE_MAX) || "untitled",
        date: session[1] ?? "",
        path: drawn(session[3] ?? "", PATH_MAX),
        link: undefined,
      });

      continue;
    }

    const place = FILED.exec(line);
    const placedId = idOf(place?.[1]);

    if (place !== null && placedId !== undefined) {
      filed.set(placedId, drawn(place[2] ?? "", PATH_MAX));

      continue;
    }

    const meeting = MEETING.exec(line);
    const meetingId = idOf(meeting?.[3]);

    if (meeting !== null && meetingId !== undefined) {
      const label = meeting[2] ?? "";
      const split = label.lastIndexOf(PLACE);

      rows.push({
        id: meetingId,
        kind: "meeting",
        title:
          drawn(split < 0 ? label : label.slice(0, split), TITLE_MAX) ||
          "untitled",
        date: meeting[1] ?? "",
        path:
          split < 0 ? "" : drawn(label.slice(split + PLACE.length), PATH_MAX),
        link: undefined,
      });
    }
  }

  const placed = rows.map((row) => ({
    ...row,
    path: filed.get(row.id) ?? row.path,
  }));
  // Stable: records of one day keep the order the server gave them.
  const newestFirst = distinct(placed).sort((a, b) =>
    a.date === b.date ? 0 : a.date < b.date ? 1 : -1,
  );

  return {
    rows: newestFirst,
    isCut:
      body.includes("[truncated:") || body.includes("Older sessions exist"),
    isUnfiltered: false,
  };
}
