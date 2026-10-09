/**
 * Which tool calls this plugin lets through without a question to the
 * person: its own calls, to Fylgja's own server, of a fixed few tools.
 *
 * Nothing else is touched. Claude's call to the very same tool, any agent's,
 * and this plugin's call to any other tool are decided as they always were.
 */

/** The tools of Fylgja this plugin calls itself. */
export const OWN_TOOLS: readonly string[] = ['recall', 'search', 'open', 'resolve', 'remember', 'amend_memory', 'attach_commit']

/** The id the engine gives a call a plugin raised itself. */
const OWN_CALL = 'toolu_plugin_'

/** What a call that was not let through rejects with, as this plugin's files hand it on. */
export const REFUSED = 'refused'

/** A tool call as the permission check is handed it. */
export type Checked = { tool: string; tool_use_id?: string; agentId?: string; ceiling?: string }

/**
 * The start of the name every tool of `server` goes by: `mcp__`, the
 * server's name with everything but letters, digits, `_` and `-` made `_`,
 * and `__`.
 */
export function toolPrefixOf(server: string): string {
  return `mcp__${server.replace(/[^a-zA-Z0-9_-]/g, '_')}__`
}

/**
 * Whether a call being checked is this plugin's own call of one of its
 * listed tools on Fylgja's server.
 *
 * All of it must hold: the call was raised by this plugin (the engine names
 * who raised it, and gives such a call an id of its own kind), in no agent's
 * loop, the tool is one of the few listed, and it is a tool of the server
 * the engine connected for the one this plugin declares. An organization's
 * limit on the tool is never lifted.
 *
 * The server is known by the name `$.mcp.connect` answered for the plugin's
 * own declared server, and by nothing else. That is the plugin's own server,
 * or, where the person already runs the very same endpoint under a name of
 * their own, that one: the engine then runs the two as one and answers with
 * the person's name for it. A server that merely has the same name and
 * points somewhere else is not answered, and its tools are not let through.
 *
 * @param raisedBy the plugin whose hook raised the call, as the engine names it
 * @param server the name the engine last answered for the plugin's own server; undefined when it is not connected
 */
export function isOwnCall(e: Checked, raisedBy: string | undefined, server: string | undefined): boolean {
  const isOurs = raisedBy === 'fylgja' || raisedBy?.startsWith('fylgja@') === true
  const prefix = server === undefined ? undefined : toolPrefixOf(server)

  return (
    isOurs &&
    prefix !== undefined &&
    e.agentId === undefined &&
    e.tool_use_id?.startsWith(OWN_CALL) === true &&
    (e.ceiling === undefined || e.ceiling === 'allow') &&
    e.tool.startsWith(prefix) &&
    OWN_TOOLS.includes(e.tool.slice(prefix.length))
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
