/**
 * The few engine calls the map makes, bound once per hook from that hook's
 * `$` and handed to the plugin's other files as plain functions.
 */
export type Host = {
  /** `$.mcp.connect('fylgja')`. */
  connect: () => Promise<Connection>
  /** `$.mcp.call`: one read on the session's own Fylgja connection. */
  call: (server: string, tool: string, args: Record<string, unknown>) => Promise<unknown>
  /** `$.ui.invalidate('ui.render')`: the pane and the band are drawn again. */
  redraw: () => void
  /** `$.clock.after`: calls `fn` once after `ms` milliseconds unless cancelled. */
  after: (ms: number, fn: () => void) => { cancel: () => void }
  /** `$.prompt.fill` in insert mode: puts text into the prompt box at the cursor. It never submits. */
  fill: (text: string) => void
}

export type Connection = { isConnected: true; server: string } | { isConnected: false; reason: string }
