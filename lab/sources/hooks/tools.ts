/**
 * Which tool calls are Fylgja's reads, by the names Claude Code gives them.
 */

/** The tools that read from Fylgja. Its writes are no source of an answer. */
export const READS = [
  "search",
  "open",
  "get_meeting",
  "get_project",
  "get_timeline",
  "get_commitments",
  "recall",
  "resolve",
] as const;

export type ReadTool = (typeof READS)[number];

/**
 * A Fylgja read under each name its server runs as: shipped by the Fylgja
 * plugin (`mcp__plugin_fylgja_fylgja__`), configured by hand as `fylgja`
 * (`mcp__fylgja__`), or started by this plugin's own server entry when no
 * other is present.
 */
export const READ_TOOL =
  /^mcp__(?:plugin_fylgja(?:[-_]lab[-_]sources)?_fylgja|fylgja)__(?:search|open|get_meeting|get_project|get_timeline|get_commitments|recall|resolve)$/;

/** The read `tool` names, or undefined when it is not one of Fylgja's reads. */
export function readToolOf(tool: unknown): ReadTool | undefined {
  if (typeof tool !== "string" || !READ_TOOL.test(tool)) {
    return undefined;
  }

  const name = tool.slice(tool.lastIndexOf("__") + 2);

  return READS.find((read) => read === name);
}
