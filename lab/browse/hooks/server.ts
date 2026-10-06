/**
 * One read on Fylgja's server, and what came of it in the few words the
 * pane can act on. Nothing the server said in an error is kept or shown.
 */

import type { Host } from "./host";

/** Why a read gave nothing to show. */
export type Problem =
  | { kind: "signed-out" }
  | { kind: "rate-limited"; seconds: number | undefined }
  /** The server is switched off, not approved or unreachable. */
  | { kind: "off" }
  /** The server answered with an error, or with something this build cannot read. */
  | { kind: "failed" };

export type Answer =
  | { kind: "json"; payload: Record<string, unknown> }
  | { kind: "text"; text: string }
  | Problem;

export function isProblem(answer: Answer): answer is Problem {
  return answer.kind !== "json" && answer.kind !== "text";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsed(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);

    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function textOf(blocks: unknown): string {
  if (!Array.isArray(blocks)) {
    return "";
  }

  return blocks
    .map((block) =>
      isRecord(block) && block.type === "text" && typeof block.text === "string"
        ? block.text
        : "",
    )
    .join("");
}

/**
 * The server's limit says how long to wait; only that number is read from
 * its error text.
 */
function limitOf(text: string): Problem | undefined {
  const wait = /\bwait (\d{1,4}) seconds?\b/i.exec(text);

  if (wait !== null) {
    return { kind: "rate-limited", seconds: Number(wait[1]) };
  }

  return /rate limit|too many/i.test(text)
    ? { kind: "rate-limited", seconds: undefined }
    : undefined;
}

/**
 * What a tool result holds: the structured result when there is one, else
 * the text blocks read as JSON, else the text as it is. A text tool's
 * structured result is its text under the one key `result`.
 */
function read(result: unknown): Answer {
  if (!isRecord(result)) {
    return { kind: "failed" };
  }

  const structured = result.structuredContent;

  if (isRecord(structured)) {
    const keys = Object.keys(structured);

    if (keys.length === 1 && typeof structured.result === "string") {
      return { kind: "text", text: structured.result };
    }

    return { kind: "json", payload: structured };
  }

  const text = textOf(result.content);
  const payload = parsed(text);

  if (payload !== undefined) {
    return { kind: "json", payload };
  }

  return text.trim() === "" ? { kind: "failed" } : { kind: "text", text };
}

async function connectionOf(host: Host): Promise<{ server: string } | Problem> {
  try {
    const connection = await host.connect();

    if (connection.isConnected) {
      return { server: connection.server };
    }

    return connection.reason === "auth"
      ? { kind: "signed-out" }
      : { kind: "off" };
  } catch {
    return { kind: "off" };
  }
}

/**
 * Calls one read tool. A call that fails is looked at once more through the
 * connection's state, because a sign-in that lapsed shows there and not in
 * the error.
 */
export async function ask(
  host: Host,
  tool: string,
  args: Record<string, unknown>,
): Promise<Answer> {
  const connection = await connectionOf(host);

  if ("kind" in connection) {
    return connection;
  }

  let result: unknown;

  try {
    result = await host.call(connection.server, tool, args);
  } catch {
    const after = await connectionOf(host);

    return "kind" in after ? after : { kind: "failed" };
  }

  if (isRecord(result) && result.isError === true) {
    const limit = limitOf(textOf(result.content));

    if (limit !== undefined) {
      return limit;
    }

    const after = await connectionOf(host);

    return "kind" in after ? after : { kind: "failed" };
  }

  return read(result);
}
