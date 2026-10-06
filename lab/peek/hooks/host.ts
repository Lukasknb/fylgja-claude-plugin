/**
 * The engine calls this plugin makes, bound once per hook from that hook's
 * `$` and handed to the plugin's other files as plain functions.
 */
export type Host = {
  /** `$.mcp.connect('fylgja')`. */
  connect: () => Promise<Connection>
  /** `$.mcp.call`: one read on the session's own Fylgja connection. */
  call: (server: string, tool: string, args: Record<string, unknown>) => Promise<unknown>
  /** `$.ui.invalidate('ui.render')`: what this plugin draws is drawn again. */
  redraw: () => void
  /** `$.ui.open` for the peek pane; resolves to whether the surface placed it. */
  openPane: (wantsFocus: boolean) => Promise<boolean>
  /** `$.ui.close` for the peek pane. */
  closePane: () => Promise<void>
  /** `$.prompt.fill` at the cursor. It fills the box and submits nothing; resolves to whether it was filled. */
  insert: (text: string) => Promise<boolean>
}

export type Connection = { isConnected: true; server: string } | { isConnected: false; reason: string }
