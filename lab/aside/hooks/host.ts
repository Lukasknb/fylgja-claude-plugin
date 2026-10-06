/**
 * The few engine calls this plugin makes, bound once per hook from that
 * hook's `$` and handed to the plugin's other files as plain functions.
 */
export type Host = {
  /** `$.mcp.connect('fylgja')`. */
  connect: () => Promise<Connection>
  /** `$.mcp.call`: one read on the session's own Fylgja connection. */
  call: (server: string, tool: string, args: Record<string, unknown>) => Promise<unknown>
  /** `$.model.complete`: one stateless completion by the small model, bounded in tokens and time. */
  complete: (system: string, prompt: string) => Promise<Completion>
  /** `$.prompt.fill` in insert mode: puts text at the cursor of the prompt box. It never submits. */
  insert: (text: string) => Promise<boolean>
  /** `$.ui.invalidate('ui.render')`: the pane is drawn again. */
  redraw: () => void
}

export type Connection = { isConnected: true; server: string } | { isConnected: false; reason: string }

/** What the model call came to: its text, or why there is none. */
export type Completion =
  { isAnswered: true; text: string } | { isAnswered: false; why: 'rate-limited' | 'timed-out' | 'failed' }
