/**
 * Which tool calls this plugin lets through without a question to the
 * person: its own calls, to Fylgja's own server, of a fixed few tools.
 *
 * Nothing else is touched. Claude's call to the very same tool, any agent's,
 * and this plugin's call to any other tool are decided as they always were.
 */

/** The tools of Fylgja this plugin calls itself. */
export const OWN_TOOLS: readonly string[] = ['recall', 'search', 'open', 'resolve', 'remember', 'amend_memory', 'attach_commit']

/** The name the tools of the plugin's own server go by. */
const OWN_SERVER = 'mcp__plugin_fylgja_fylgja__'

/** The id the engine gives a call a plugin raised itself. */
const OWN_CALL = 'toolu_plugin_'

/** A tool call as the permission check is handed it. */
export type Checked = { tool: string; tool_use_id?: string; agentId?: string; ceiling?: string }

/**
 * Whether a call being checked is this plugin's own call of one of its
 * listed tools on its own server.
 *
 * All of it must hold: the call was raised by this plugin (the engine names
 * who raised it, and gives such a call an id of its own kind), in no agent's
 * loop, the tool is on the server this plugin ships, and it is one of the
 * few listed. An organization's limit on the tool is never lifted.
 *
 * @param raisedBy the plugin whose hook raised the call, as the engine names it
 */
export function isOwnCall(e: Checked, raisedBy: string | undefined): boolean {
  const isOurs = raisedBy === 'fylgja' || raisedBy?.startsWith('fylgja@') === true

  return (
    isOurs &&
    e.agentId === undefined &&
    e.tool_use_id?.startsWith(OWN_CALL) === true &&
    (e.ceiling === undefined || e.ceiling === 'allow') &&
    e.tool.startsWith(OWN_SERVER) &&
    OWN_TOOLS.includes(e.tool.slice(OWN_SERVER.length))
  )
}
