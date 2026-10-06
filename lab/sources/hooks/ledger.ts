/**
 * What Claude read from Fylgja in this conversation. Held in the running
 * plugin only, bounded, and dropped whole when the conversation is cleared,
 * resumed or branched. Titles and search queries never leave this memory
 * except to be drawn.
 */

import type { Call, Hit } from "./call";

const MAX_TURNS = 200;
const MAX_CALLS = 300;
const MAX_HELPER_CALLS = 600;
const MAX_RETURNED = 20_000;
const MAX_KNOWN = 4000;
const MAX_TEXT = 200_000;

/** One answer: the reads Claude made on the way to it, and what it then wrote. */
export type Turn = {
  /** Claude's own Fylgja reads, in the order they completed. */
  calls: Call[];
  /** What Claude wrote, as far as known. */
  text: string;
  /** The subagents tied to this answer: started by it, or reading while it was under way. */
  agents: string[];
};

/**
 * Whether everything this conversation read from Fylgja is known: `whole`
 * once the transcript was read through, `partial` when it does not reach
 * back to the start or more was read than is kept, `unknown` before that.
 * Only `whole` lets anything be called "not read".
 */
export type Coverage = "unknown" | "whole" | "partial";

export type Ledger = {
  /**
   * The answers given before the plugin started watching, oldest first, as
   * the transcript had them then; undefined until it has been read.
   */
  history: Turn[] | undefined;
  /** The answers given since the plugin started watching, oldest first. */
  turns: Turn[];
  /** The reads made since the last answer. */
  open: Turn;
  /** The reads subagents made, in the order they completed. */
  helpers: Call[];
  /** Every record id a successful read returned, whoever made it. */
  returned: Set<string>;
  /** The latest title seen for a record id. */
  known: Map<string, Hit>;
  coverage: Coverage;
  /** Counts the times everything was dropped; work begun before a drop is not kept. */
  epoch: number;
};

export function emptyTurn(): Turn {
  return { calls: [], text: "", agents: [] };
}

export function create(): Ledger {
  return {
    history: undefined,
    turns: [],
    open: emptyTurn(),
    helpers: [],
    returned: new Set(),
    known: new Map(),
    coverage: "unknown",
    epoch: 0,
  };
}

/** Forgets everything: a conversation that starts over is read afresh. */
export function clear(ledger: Ledger): void {
  ledger.epoch += 1;
  ledger.history = undefined;
  ledger.turns = [];
  ledger.open = emptyTurn();
  ledger.helpers = [];
  ledger.returned.clear();
  ledger.known.clear();
  ledger.coverage = "unknown";
}

function know(ledger: Ledger, hit: Hit): void {
  // A record seen again moves to the newest end; the oldest go first.
  ledger.known.delete(hit.id);
  ledger.known.set(hit.id, hit);

  for (const id of ledger.known.keys()) {
    if (ledger.known.size <= MAX_KNOWN) {
      break;
    }

    ledger.known.delete(id);
  }
}

/**
 * Takes what a read returned into what is known about the conversation. A
 * read that failed or was not allowed returned nothing, and adds nothing.
 */
export function absorb(ledger: Ledger, call: Call): void {
  if (call.status !== "read") {
    return;
  }

  for (const id of call.ids) {
    if (ledger.returned.has(id)) {
      continue;
    }

    if (ledger.returned.size >= MAX_RETURNED) {
      // More was read than is kept: from here on, "not read" cannot be said.
      ledger.coverage = "partial";
      break;
    }

    ledger.returned.add(id);
  }

  for (const hit of call.hits) {
    know(ledger, hit);
  }

  if (call.record?.id !== undefined && call.record.title !== "") {
    know(ledger, { ...call.record, id: call.record.id });
  }
}

function put(calls: Call[], call: Call, max: number): void {
  const at = calls.findIndex((held) => held.useId === call.useId);

  if (at === -1) {
    calls.push(call);
  } else {
    calls[at] = call;
  }

  calls.splice(0, Math.max(0, calls.length - max));
}

/**
 * Every answer known, oldest first: those from before the plugin watched,
 * those it watched, and the one under way once Claude has read for it.
 */
export function answersOf(ledger: Ledger): Turn[] {
  const underWay = ledger.open.calls.length > 0 ? [ledger.open] : [];

  return [...(ledger.history ?? []), ...ledger.turns, ...underWay];
}

/**
 * Records one read as it completed.
 *
 * A subagent's read is kept apart from Claude's own: Claude did not read
 * that record, it read what the subagent reported. The subagent is tied to
 * the answer under way when it first read, which is the answer that started
 * it unless it ran on in the background.
 */
export function note(ledger: Ledger, call: Call): void {
  const agentId = call.agentId;

  if (agentId === undefined) {
    put(ledger.open.calls, call, MAX_CALLS);
  } else {
    put(ledger.helpers, call, MAX_HELPER_CALLS);

    if (
      ![...answersOf(ledger), ledger.open].some((turn) =>
        turn.agents.includes(agentId),
      )
    ) {
      ledger.open.agents.push(agentId);
    }
  }

  absorb(ledger, call);
}

/**
 * Takes in the conversation as its transcript has it.
 *
 * Every read in it counts as returned, whenever this is called. The answers
 * themselves are taken once, the first time: they are the history from
 * before the plugin watched, and what it watched since is its own to tell.
 * Should the plugin already have watched some of what the transcript holds,
 * that part is left to it.
 *
 * @param isWhole false when the transcript may not reach back to the start
 */
export function takeIn(
  ledger: Ledger,
  transcript: readonly Turn[],
  isWhole: boolean,
): void {
  for (const turn of transcript) {
    for (const call of turn.calls) {
      absorb(ledger, call);
    }
  }

  if (ledger.coverage === "unknown") {
    ledger.coverage = isWhole ? "whole" : "partial";
  }

  if (ledger.history !== undefined) {
    return;
  }

  const watched = new Set(
    [...ledger.turns, ledger.open].flatMap((turn) =>
      turn.calls.map((call) => call.useId),
    ),
  );
  const firstWatched = transcript.findIndex((turn) =>
    turn.calls.some((call) => watched.has(call.useId)),
  );
  const before =
    firstWatched === -1
      ? Math.max(0, transcript.length - ledger.turns.length)
      : firstWatched;

  ledger.history = transcript.slice(0, before).slice(-MAX_TURNS);
}

/**
 * Lets the next transcript read replace the history, as long as the plugin
 * has watched nothing itself: until then the transcript is all there is,
 * and a later read of it is the better one.
 */
export function renew(ledger: Ledger): void {
  if (ledger.turns.length === 0 && ledger.open.calls.length === 0) {
    ledger.history = undefined;
  }
}

/** Closes the answer under way with what Claude wrote, and gives it back. */
export function seal(ledger: Ledger, answer: string): Turn {
  const turn = { ...ledger.open, text: answer.slice(0, MAX_TEXT) };

  ledger.turns.push(turn);
  ledger.turns.splice(0, Math.max(0, ledger.turns.length - MAX_TURNS));
  ledger.open = emptyTurn();

  return turn;
}

/** How many distinct records a run of reads opened. */
export function recordsOpened(calls: readonly Call[]): number {
  const opened = new Set<string>();

  for (const call of calls) {
    if (call.status === "read" && call.record !== undefined) {
      opened.add(call.record.id ?? `${call.record.kind} ${call.record.title}`);
    }
  }

  return opened.size;
}
