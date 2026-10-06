/**
 * Watching one Fylgja read complete. Everything here only reads the call
 * and its result, and nothing here can fail the call: whatever goes wrong
 * while looking, the call is at most recorded with less.
 */

import { NOTHING } from "./call";
import type { Call, Reading, Status } from "./call";
import * as Ledger from "./ledger";
import { isRecord } from "./payload";
import { readingOf } from "./reading";
import { readToolOf } from "./tools";

/**
 * How a call ended, from what the engine answered for it: a refusal (the
 * person's, a rule's or another plugin's) is `denied`; an error the tool
 * reported, or no answer at all, is `failed`; anything else was read.
 */
export function statusOf(answer: unknown): Status {
  if (!isRecord(answer)) {
    return "failed";
  }

  if (answer.deny !== undefined) {
    return "denied";
  }

  return answer.isError === true ? "failed" : "read";
}

/**
 * The call as the ledger keeps it, or undefined when it is not one of
 * Fylgja's reads.
 *
 * @param e the call as the engine raised it: the tool, its id, the loop it
 *   ran in, and the tool's arguments beside them
 * @param answer what the engine answered; undefined when it answered nothing
 */
export function callOf(
  e: Record<string, unknown>,
  answer: unknown,
): Call | undefined {
  const tool = readToolOf(e.tool);

  if (tool === undefined || typeof e.tool_use_id !== "string") {
    return undefined;
  }

  const status = statusOf(answer);
  let reading: Reading = NOTHING;

  if (status === "read" && isRecord(answer)) {
    try {
      reading = readingOf(
        tool,
        e,
        answer.result,
        typeof answer.text === "string" ? answer.text : undefined,
      );
    } catch {
      // A result that cannot be looked into was still read by Claude: the
      // call is kept, with nothing said about what it held.
      reading = NOTHING;
    }
  }

  return {
    useId: e.tool_use_id,
    tool,
    status,
    agentId: typeof e.agentId === "string" ? e.agentId : undefined,
    ...reading,
  };
}

/** Records the call in the ledger. Never throws. */
export function observe(
  ledger: Ledger.Ledger,
  e: Record<string, unknown>,
  answer: unknown,
): void {
  try {
    const call = callOf(e, answer);

    if (call !== undefined) {
      Ledger.note(ledger, call);
    }
  } catch {
    // Nothing can be said about this call; the ledger goes without it.
  }
}
