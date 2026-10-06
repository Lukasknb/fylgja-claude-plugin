import type { PromptDecoration } from 'claude-code'

/**
 * The engine calls this plugin makes, bound once from a hook's `$` and
 * handed to the plugin's other files as plain functions.
 */
export type Host = {
  /** `$.mcp.connect('fylgja')`. */
  connect: () => Promise<Connection>
  /** `$.mcp.call`: one tool call on the session's own Fylgja connection. */
  call: (server: string, tool: string, args: Record<string, unknown>) => Promise<unknown>
  /** `$.ui.invalidate('ui.render')`: the band and the pane are drawn again. */
  redraw: () => void
  /** `$.clock.after`: calls `fn` once, `ms` milliseconds from now, unless cancelled. */
  after: (ms: number, fn: () => void) => Timer
  /** `$.clock.every`: calls `fn` every `ms` milliseconds until cancelled. */
  every: (ms: number, fn: () => void) => Timer
  /** `$.prompt.read`: the draft and the cursor as they stand. */
  read: () => Promise<Box>
  /** `$.prompt.fill`: writes into the draft; never submits it. */
  fill: (args: Fill) => Promise<{ isFilled: boolean }>
  /** `$.ui.close`: closes the pane of that id. */
  close: (id: string) => Promise<void>
}

export type Timer = { cancel: () => void }

export type Box = { text: string; cursor: number }

export type Fill = {
  text: string
  mode: 'replace' | 'insert'
  decorations?: PromptDecoration[]
}

export type Connection = { isConnected: true; server: string } | { isConnected: false; reason: string }
