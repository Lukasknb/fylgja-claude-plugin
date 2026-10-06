/**
 * What an expanded row shows, read out of the record as `get_meeting` or
 * `open` answers it. Like the rows, every string is made safe to draw here.
 */

import { unfence } from "./fence";
import { drawn } from "./plain";
import { childListing, linkOf } from "./records";
import type { Row } from "./records";
import { ask, isProblem, isRecord } from "./server";
import type { Answer, Problem } from "./server";
import type { Host } from "./host";

export type Detail = {
  /** The record's first lines, one paragraph each, at most three. */
  lines: string[];
  /** One line of counts (`3 decisions · 2 commitments`), or empty. */
  counts: string;
  /** A project's projects one level down. */
  children: Row[];
  link: string | undefined;
  /** The server said it cut the record, or there are more children than it sent. */
  isCut: boolean;
};

/** A row's detail while it is asked for, once it is known, or why it is not. */
export type DetailState = "loading" | Detail | Problem;

export function isDetail(state: DetailState | undefined): state is Detail {
  return typeof state === "object" && "lines" in state;
}

const LINE_MAX = 300;
const LINES_MAX = 3;

function count(value: unknown, one: string, many: string): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return `${value.length} ${value.length === 1 ? one : many}`;
}

function line(value: unknown): string[] {
  const text = typeof value === "string" ? drawn(value, LINE_MAX) : "";

  return text === "" ? [] : [text];
}

function meetingDetail(
  payload: Record<string, unknown>,
  id: string,
): Detail | undefined {
  const counts = [
    count(payload.decisions, "decision", "decisions"),
    count(payload.action_items, "commitment", "commitments"),
  ].filter((part) => part !== undefined);

  const lines = line(payload.summary);

  if (lines.length === 0 && counts.length === 0) {
    return undefined;
  }

  return {
    lines,
    counts: counts.join(" · "),
    children: [],
    link: linkOf(payload.link, id),
    isCut: payload.truncated === true,
  };
}

function projectDetail(
  payload: Record<string, unknown>,
  id: string,
): Detail | undefined {
  const children = childListing(payload);

  if (children === undefined) {
    return undefined;
  }

  const counts = isRecord(payload.counts) ? payload.counts : {};
  const meetings =
    typeof counts.meetings === "number"
      ? `${counts.meetings} meetings`
      : undefined;
  const last =
    typeof counts.last_activity === "string"
      ? `last activity ${drawn(counts.last_activity, 10)}`
      : undefined;

  return {
    lines: line(payload.definition),
    counts: [meetings, last].filter((part) => part !== undefined).join(" · "),
    children: children.rows,
    link: linkOf(payload.link, id),
    isCut: children.isCut,
  };
}

/** The fields a JSON record of any other kind may say itself in, in the order tried. */
const SAYS = [
  "summary",
  "what",
  "content",
  "definition",
  "rationale",
  "role",
  "organization",
] as const;

function otherDetail(
  payload: Record<string, unknown>,
  id: string,
): Detail | undefined {
  const lines = SAYS.flatMap((field) => line(payload[field])).slice(
    0,
    LINES_MAX,
  );

  if (lines.length === 0) {
    return undefined;
  }

  return {
    lines,
    counts: "",
    children: [],
    link: linkOf(payload.link, id),
    isCut: payload.truncated === true,
  };
}

/**
 * The first lines of a record that arrives as text (a session, a note, a
 * document): its own sentences, without the title, the line of facts under
 * it, the section headings and the line saying where it is filed.
 */
function textDetail(text: string, id: string): Detail | undefined {
  const { body, link } = unfence(text);

  const lines = body
    .split("\n")
    .map((row) => row.trim())
    .filter(
      (row) =>
        row !== "" &&
        !/^(#|\*\*[^*]+:\*\*|Filed under|_|\[truncated:)/.test(row),
    )
    .map((row) =>
      drawn(row.replace(/^[-*] /, "").replaceAll("**", ""), LINE_MAX),
    )
    .filter((row) => row !== "")
    .slice(0, LINES_MAX);

  if (lines.length === 0) {
    return undefined;
  }

  return {
    lines,
    counts: "",
    children: [],
    link: linkOf(link, id),
    isCut: body.includes("[truncated:"),
  };
}

function detailOf(row: Row, answer: Answer): DetailState {
  if (isProblem(answer)) {
    return answer;
  }

  if (answer.kind === "text") {
    return textDetail(answer.text, row.id) ?? { kind: "failed" };
  }

  const { payload } = answer;

  const detail =
    row.kind === "meeting"
      ? meetingDetail(payload, row.id)
      : (projectDetail(payload, row.id) ?? otherDetail(payload, row.id));

  return detail ?? { kind: "failed" };
}

/** Reads one record for its expanded row: a meeting section by section, anything else through `open`. */
export async function loadDetail(host: Host, row: Row): Promise<DetailState> {
  const answer =
    row.kind === "meeting"
      ? await ask(host, "get_meeting", {
          meeting_id: row.id,
          include: ["summary", "decisions", "action_items"],
        })
      : await ask(host, "open", { ref: row.id });

  return detailOf(row, answer);
}
