/**
 * The few engine calls this plugin makes, bound once per hook from that
 * hook's `$` and handed to the plugin's other files.
 */
export type Host = {
  /** `$.mcp.connect('fylgja')`. */
  connect: () => Promise<Connection>
  /** `$.mcp.call`: one tool call on the session's own Fylgja connection. */
  call: (server: string, tool: string, args: Record<string, unknown>) => Promise<unknown>
  /** `$.ui.status`: the plugin's one line under the prompt; undefined removes it. */
  status: (text: string | undefined) => void
  /** `$.ui.invalidate('ui.render')`: the rows this plugin draws are drawn again. */
  redraw: () => void
  /** `$.clock.every`: calls `fn` every `ms` milliseconds until cancelled. */
  every: (ms: number, fn: () => void) => { cancel: () => void }
}

export type Connection =
  | { isConnected: true; server: string }
  | { isConnected: false; reason: string }
