/**
 * Which tool calls this plugin lets through without a question to the
 * person: its own calls, to Fylgja's own server, of a fixed few tools.
 *
 * Nothing else is touched. Claude's call to the very same tool, any agent's,
 * and this plugin's call to any other tool are decided as they always were.
 */

/** The tools of Fylgja this plugin calls itself. */
export const OWN_TOOLS: readonly string[] = [
  'whoami',
  'recall',
  'search',
  'open',
  'resolve',
  'remember',
  'amend_memory',
  'attach_commit',
]

/** The id the engine gives a call a plugin raised itself. */
const OWN_CALL = 'toolu_plugin_'

/** What a call that was not let through rejects with, as this plugin's files hand it on. */
export const REFUSED = 'refused'

/** A tool call as the permission check is handed it. */
export type Checked = { tool: string; tool_use_id?: string; agentId?: string; ceiling?: string }

/**
 * The name the plugin's own server goes by once the engine has connected it:
 * the plugin's name and the server's as `.mcp.json` declares it.
 */
export const OWN_SERVER = 'plugin:fylgja:fylgja'

/** The start of the name every tool of the plugin's own server goes by. */
const OWN_TOOL = 'mcp__plugin_fylgja_fylgja__'

/**
 * Whether a call being checked is this plugin's own call of one of its
 * listed tools on its own server.
 *
 * All of it must hold: the call was raised by this plugin (the engine names
 * who raised it, and gives such a call an id of its own kind), in no agent's
 * loop, the tool is one of the few listed, it is a tool of the plugin's own
 * server, and that server is the one the engine connected when asked for
 * the plugin's. An organization's limit on the tool is never lifted.
 *
 * Only the plugin's own server counts. Where a server with the same address
 * is configured anywhere else (the person's settings, a repository's
 * `.mcp.json`), the engine runs the two as one under that other entry, with
 * that entry's credentials: a cloned repository could name any account
 * there. Its tools are never let through, and Scribe does not run on it.
 *
 * @param raisedBy the plugin whose hook raised the call, as the engine names it
 * @param server the name the engine last answered for the plugin's own server; undefined when it is not connected
 */
export function isOwnCall(e: Checked, raisedBy: string | undefined, server: string | undefined): boolean {
  const isOurs = raisedBy === 'fylgja' || raisedBy?.startsWith('fylgja@') === true

  return (
    isOurs &&
    server === OWN_SERVER &&
    e.agentId === undefined &&
    e.tool_use_id?.startsWith(OWN_CALL) === true &&
    (e.ceiling === undefined || e.ceiling === 'allow') &&
    e.tool.startsWith(OWN_TOOL) &&
    OWN_TOOLS.includes(e.tool.slice(OWN_TOOL.length))
  )
}

/** What the permission check answers, as much of it as is read here. */
export type Verdict = { decision: 'allow' | 'ask' | 'deny'; reason?: string }

/**
 * The verdict this plugin gives a call being checked: its own call is let
 * through where the engine would have asked, and every other verdict is
 * handed back as it came. A refusal is never turned into anything else.
 */
export function verdictFor<V extends Verdict>(
  verdict: V,
  e: Checked,
  raisedBy: string | undefined,
  server: string | undefined,
): V {
  return verdict.decision === 'ask' && isOwnCall(e, raisedBy, server)
    ? { ...verdict, decision: 'allow', reason: 'Fylgja: the plugin’s own call to its own server' }
    : verdict
}
