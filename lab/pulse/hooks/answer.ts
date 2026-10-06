import type { Host } from "./host";
import { isRecord, payloadOf } from "./payload";

/**
 * One Fylgja tool's answer as a JSON object, or undefined for every way it
 * can fail: a call that rejects, a result the tool marks as an error, or
 * text that is not the JSON object expected.
 */
export function askJson(
  host: Host,
  server: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  return host.call(server, tool, args).then(payloadOf, () => undefined);
}

function textOf(result: unknown): string | undefined {
  if (typeof result === "string") {
    return result;
  }

  if (
    !isRecord(result) ||
    result.isError === true ||
    !Array.isArray(result.content)
  ) {
    return undefined;
  }

  return result.content
    .map((block) =>
      isRecord(block) && block.type === "text" && typeof block.text === "string"
        ? block.text
        : "",
    )
    .join("");
}

/**
 * One Fylgja tool's answer as text (its text blocks joined), or undefined
 * when the call rejects, the tool reports an error, or it answers with no
 * text blocks at all.
 */
export function askText(
  host: Host,
  server: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<string | undefined> {
  return host.call(server, tool, args).then(textOf, () => undefined);
}
