/**
 * The ledger as the pane shows it: per answer, the records opened and how
 * each was reached, what else was looked at, and how every record the
 * answer cites stands against what was read.
 */

import type { Call, Seen } from "./call";
import { citedIn } from "./citations";
import { answersOf } from "./ledger";
import type { Ledger, Turn } from "./ledger";
import { drawn } from "./plain";
import { referenceOf } from "./reference";

const MAX_QUERY = 60;

/** One record that was opened. */
export type Row = {
  seen: Seen;
  /** How the reader came to it, in fixed words and counts. */
  reached: string;
  /** The reference to put in the prompt box, when one can be made. */
  reference: string | undefined;
};

/**
 * How a cited record stands: `opened` by Claude, opened by a `subagent`,
 * `returned` by a search or a list without being opened, `unread` when no
 * read of this session returned it, `unsure` when the session cannot be
 * looked through to its start.
 */
export type Standing = "opened" | "subagent" | "returned" | "unread" | "unsure";

export type Judged = {
  kind: string;
  id: string;
  /** The record's own title when a read returned it, else the words Claude put on the link. */
  title: string;
  link: string;
  standing: Standing;
};

export type Answer = {
  /** Its place among the answers, from 1. */
  number: number;
  rows: Row[];
  /** The records subagents opened for this answer. */
  helperRows: Row[];
  /** What else was looked at, one line each, safe to draw. */
  notes: string[];
  citations: Judged[];
  /** The answer in one line of counts, for when it is shown folded. */
  summary: string;
};

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * How a record was come by: the first earlier read that named it. A search
 * says how many hits it had; a record nothing named before it was opened
 * directly, from an id Claude already held or the person pasted.
 */
function reachedOf(seen: Seen, earlier: readonly Call[]): string {
  if (seen.id === undefined) {
    return "opened by name";
  }

  for (const call of earlier) {
    if (
      call.status !== "read" ||
      call.record?.id === seen.id ||
      !call.ids.includes(seen.id)
    ) {
      continue;
    }

    switch (call.tool) {
      case "search":
        return `found by a search (${plural(call.hits.length, "hit")})`;
      case "get_timeline":
        return "listed in the timeline";
      case "get_commitments":
        return "named by a commitment";
      case "get_project":
        return "listed under a project";
      case "recall":
        return "named by a recalled note";
      case "open":
      case "get_meeting":
        return "linked from another record";
      case "resolve":
        // Looking a reference up shows that the id was already held.
        continue;
    }
  }

  return "opened directly";
}

function rowsOf(calls: readonly Call[], earlier: readonly Call[]): Row[] {
  const rows = new Map<string, Row>();

  calls.forEach((call, at) => {
    if (call.status !== "read" || call.record === undefined) {
      return;
    }

    const key = call.record.id ?? `${call.record.kind} ${call.record.title}`;

    // A record opened twice for one answer is one source.
    if (!rows.has(key)) {
      rows.set(key, {
        seen: call.record,
        reached: reachedOf(call.record, [...earlier, ...calls.slice(0, at)]),
        reference: referenceOf(call.record),
      });
    }
  });

  return [...rows.values()];
}

const LISTS: Readonly<Record<string, (count: number) => string>> = {
  get_timeline: (count) =>
    `the timeline (${plural(count, "entry", "entries")})`,
  get_commitments: (count) => plural(count, "commitment"),
  recall: (count) => plural(count, "recalled note"),
  get_project: (count) => `the list of ${plural(count, "project")}`,
  resolve: (count) => `${plural(count, "reference")} looked up`,
};

function notesOf(
  calls: readonly Call[],
  opened: ReadonlySet<string>,
): string[] {
  const notes: string[] = [];
  const lists: string[] = [];
  let unrecognised = 0;

  for (const call of calls) {
    if (call.status !== "read") {
      continue;
    }

    if (call.tool === "search") {
      const unopened = call.hits.filter((hit) => !opened.has(hit.id)).length;
      const query =
        call.query === undefined ? "" : ` “${drawn(call.query, MAX_QUERY)}”`;

      if (call.hits.length === 0) {
        notes.push(`searched${query} — nothing found`);
      } else if (unopened > 0) {
        notes.push(
          `searched${query} — ${plural(call.hits.length, "hit")}, ${unopened} not opened`,
        );
      }
    } else if (call.listed !== undefined && call.record === undefined) {
      lists.push(
        LISTS[call.tool]?.(call.listed) ??
          plural(call.listed, "entry", "entries"),
      );
    } else if (call.record === undefined) {
      unrecognised += 1;
    }
  }

  if (lists.length > 0) {
    notes.push(`also read: ${lists.join(", ")}`);
  }

  if (unrecognised > 0) {
    notes.push(
      `${plural(unrecognised, "read")} returned something this view cannot name`,
    );
  }

  const failed = calls.filter((call) => call.status === "failed").length;
  const denied = calls.filter((call) => call.status === "denied").length;

  if (failed > 0) {
    notes.push(`${plural(failed, "read")} failed — nothing came back`);
  }

  if (denied > 0) {
    notes.push(`${plural(denied, "read")} not allowed — nothing came back`);
  }

  return notes;
}

function idsOpened(calls: readonly Call[]): Set<string> {
  const ids = new Set<string>();

  for (const call of calls) {
    if (call.status === "read" && call.record?.id !== undefined) {
      ids.add(call.record.id);
    }
  }

  return ids;
}

function summaryOf(
  number: number,
  rows: number,
  helperRows: number,
  citations: readonly Judged[],
): string {
  const parts = [
    rows + helperRows === 0
      ? "nothing opened"
      : plural(rows + helperRows, "record"),
  ];
  const unread = citations.filter(
    (cited) => cited.standing === "unread",
  ).length;

  if (citations.length > 0) {
    parts.push(
      unread === 0
        ? `${plural(citations.length, "citation")}`
        : `${unread} of ${plural(citations.length, "citation")} not read`,
    );
  }

  return `Answer ${number} — ${parts.join(", ")}`;
}

/** Every answer of the conversation, oldest first. */
export function answersIn(ledger: Ledger): Answer[] {
  const turns: readonly Turn[] = answersOf(ledger);
  const own = turns.flatMap((turn) => turn.calls);
  const openedByClaude = idsOpened(own);
  const openedByHelpers = idsOpened(ledger.helpers);
  const opened = new Set([...openedByClaude, ...openedByHelpers]);
  const earlier: Call[] = [];

  return turns.map((turn, at) => {
    const rows = rowsOf(turn.calls, earlier);

    earlier.push(...turn.calls);

    const helpers = ledger.helpers.filter(
      (call) =>
        call.agentId !== undefined && turn.agents.includes(call.agentId),
    );
    const helperRows = rowsOf(helpers, earlier);

    const citations = citedIn(turn.text).map((cited): Judged => {
      const standing: Standing = openedByClaude.has(cited.id)
        ? "opened"
        : openedByHelpers.has(cited.id)
          ? "subagent"
          : ledger.returned.has(cited.id)
            ? "returned"
            : ledger.coverage === "whole"
              ? "unread"
              : "unsure";

      return {
        kind: cited.kind,
        id: cited.id,
        title: ledger.known.get(cited.id)?.title ?? cited.label,
        link: cited.link,
        standing,
      };
    });

    return {
      number: at + 1,
      rows,
      helperRows,
      notes: [
        ...notesOf(turn.calls, opened),
        ...notesOf(helpers, opened).map((note) => `subagent: ${note}`),
      ],
      citations,
      summary: summaryOf(at + 1, rows.length, helperRows.length, citations),
    };
  });
}
