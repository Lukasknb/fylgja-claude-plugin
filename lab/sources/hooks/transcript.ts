/**
 * The same ledger, read back from the conversation's own transcript: it
 * holds every tool call with its result, so it also covers what happened
 * before this plugin was loaded and what a resumed conversation brought
 * along. A subagent's reads are not in it; they live in its own transcript.
 */

import type { SessionMessage } from "claude-code";

import { NOTHING } from "./call";
import type { Call } from "./call";
import { emptyTurn } from "./ledger";
import type { Turn } from "./ledger";
import { readingOf } from "./reading";
import { readToolOf } from "./tools";

const MAX_TEXT = 200_000;

/** How many of the newest transcript rows the engine hands back; a full hand means older ones may be missing. */
export const WINDOW = 4096;

function callsOf(message: SessionMessage): Call[] {
  const calls: Call[] = [];

  for (const use of message.toolUses) {
    const tool = readToolOf(use.tool);

    // A call still in flight has no result to read yet.
    if (
      tool === undefined ||
      (use.text === undefined &&
        use.result === undefined &&
        use.isError !== true)
    ) {
      continue;
    }

    let reading = NOTHING;

    if (use.isError !== true) {
      try {
        reading = readingOf(tool, use.input, use.result, use.text);
      } catch {
        reading = NOTHING;
      }
    }

    // The transcript stores a refused call as an errored one; which of the
    // two it was is only known to a plugin that watched the call.
    calls.push({
      useId: use.tool_use_id,
      tool,
      status: use.isError === true ? "failed" : "read",
      agentId: undefined,
      ...reading,
    });
  }

  return calls;
}

/**
 * The conversation as answers, oldest first: a message of the person's (or
 * anything else that is not a tool's result) begins a new one, and what
 * Claude wrote and read until the next belongs to it. Stretches in which
 * Claude wrote nothing are no answers and are left out.
 */
export function turnsOf(messages: readonly SessionMessage[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | undefined;

  for (const message of messages) {
    if (message.role === "user") {
      if ((message.toolResults ?? []).length === 0) {
        current = undefined;
      }

      continue;
    }

    if (current === undefined) {
      current = emptyTurn();
      turns.push(current);
    }

    if (message.text !== "" && current.text.length < MAX_TEXT) {
      current.text += (current.text === "" ? "" : "\n") + message.text;
    }

    current.calls.push(...callsOf(message));

    for (const use of message.toolUses) {
      if (
        typeof use.agentId === "string" &&
        !current.agents.includes(use.agentId)
      ) {
        current.agents.push(use.agentId);
      }
    }
  }

  return turns;
}

/** How a conversation that was summarised to make room begins. */
const CONTINUED = /^\s*This session is being continued from a previous conversation/;

/**
 * Whether the rows handed back reach to the start of the conversation: not
 * when the hand is full, and not when the first rows are the summary an
 * earlier, longer conversation was replaced by.
 */
export function reachesBack(messages: readonly SessionMessage[]): boolean {
  return messages.length < WINDOW && !messages.slice(0, 4).some((message) => CONTINUED.test(message.text));
}
