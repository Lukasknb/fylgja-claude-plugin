/**
 * Reading the results Fylgja sends as text: markdown between two fence
 * lines. The layout is prose the server may change, so everything here is a
 * best effort that claims nothing when a line is not where it used to be.
 */

import type { Seen } from "./call";
import { linkOf, RECORD_LINK, UUID } from "./links";

const OPEN = "<<<fylgja-record";
const CLOSE = "<<<end fylgja-record>>>";
const FILED = "Filed under: ";
const MAX_LINE = 400;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SESSION_ID = new RegExp(`\\*\\*Session id:\\*\\* (${UUID})`);
const LISTED = new RegExp(`(?:\\(id: |^[ \\t]*id: )(${UUID})`, "gm");
const LINKS = new RegExp(RECORD_LINK, "g");

/**
 * The markdown between the fence lines, or undefined when `raw` is not a
 * fenced record. A result cut short of its closing line is read to its end.
 */
export function bodyOf(raw: string): string | undefined {
  const start = raw.indexOf(OPEN);

  if (start === -1) {
    return undefined;
  }

  const firstLineEnd = raw.indexOf("\n", start);

  if (firstLineEnd === -1) {
    return undefined;
  }

  const end = raw.lastIndexOf(CLOSE);

  return raw.slice(firstLineEnd + 1, end > firstLineEnd ? end : undefined);
}

function headingOf(body: string): string | undefined {
  return /^# (.+)$/m.exec(body)?.[1]?.trim();
}

function sessionOf(rest: string): Pick<Seen, "kind" | "title" | "date"> {
  const parts = rest.split(" — ");
  const last = parts.at(-1);
  const date = last !== undefined && DATE.test(last) ? last : undefined;
  // `<project> — <what was worked on> — <date>`: the middle is the title.
  const middle = parts
    .slice(1, date === undefined ? undefined : -1)
    .join(" — ");

  return {
    kind: "session",
    title: middle === "" ? (parts[0] ?? rest) : middle,
    date,
  };
}

/**
 * Where the record lives in the project tree: the path on its
 * `Filed under:` line, without the id and the organization that follow it.
 * The line is cut to a sane length first and taken apart by plain search,
 * so no line, however long, takes long to read.
 */
function filedUnder(body: string): string | undefined {
  const start = body.startsWith(FILED) ? 0 : body.indexOf(`\n${FILED}`) + 1;

  if (start === 0 && !body.startsWith(FILED)) {
    return undefined;
  }

  const lineEnd = body.indexOf("\n", start);
  const line = body.slice(start + FILED.length, lineEnd === -1 ? undefined : lineEnd).slice(0, MAX_LINE);
  const ends = [line.indexOf(" (project id: "), line.indexOf(" · about ")].filter((at) => at !== -1);
  const path = line.slice(0, ends.length === 0 ? undefined : Math.min(...ends)).trim();

  return path === "" ? undefined : path;
}

/** The address of the record `id`, when the text holds one for it. */
function linkIn(body: string, id: string | undefined): string | undefined {
  for (const match of body.matchAll(LINKS)) {
    const link = linkOf(match[0], id);

    if (link !== undefined) {
      return link;
    }
  }

  return undefined;
}

/**
 * The one record a fenced text is about: a session, a note, a document, or
 * a project's status. Undefined when the text is a list, or has no heading.
 *
 * @param askedId the id the call asked for, used when the text names none
 */
export function recordOfText(
  body: string,
  askedId: string | undefined,
): Seen | undefined {
  const heading = headingOf(body);

  if (
    heading === undefined ||
    /^(?:Timeline|Sessions|Recent meetings|Changes to the project tree)\b/.test(
      heading,
    )
  ) {
    return undefined;
  }

  const session = /^Session — (.+)$/.exec(heading)?.[1];
  const status = /^Status — (.+)$/.exec(heading)?.[1];
  const kindLine = /\*\*Kind:\*\* ([a-z_]+)/.exec(body)?.[1];

  const named: Pick<Seen, "kind" | "title" | "date"> =
    session !== undefined
      ? sessionOf(session)
      : status !== undefined
        ? { kind: "project", title: status, date: undefined }
        : {
            kind: kindLine === "note" ? "note" : "document",
            title: heading,
            date: undefined,
          };

  const id =
    session === undefined
      ? askedId
      : (SESSION_ID.exec(body)?.[1]?.toLowerCase() ?? askedId);
  const filed = filedUnder(body);

  return {
    ...named,
    // A project's status is asked for by name: the text carries no id for it.
    id: status === undefined ? id : undefined,
    date: named.date ?? /\*\*Date:\*\* (\d{4}-\d{2}-\d{2})/.exec(body)?.[1],
    project: filed,
    link: status === undefined ? linkIn(body, id) : undefined,
  };
}

/** How many entries a listing names: its lines that end in, or begin with, a record's id. */
export function entriesIn(body: string): number {
  return new Set(
    [...body.matchAll(LISTED)].map((match) => match[1]?.toLowerCase()),
  ).size;
}
