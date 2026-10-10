/**
 * The few engine calls this plugin makes, bound once per hook from that
 * hook's `$` and handed to the plugin's other files.
 */
export type Host = {
  /** `$.mcp.connect('fylgja')`. */
  connect: () => Promise<Connection>
  /**
   * `$.mcp.call`: one tool call on the session's own Fylgja connection.
   * Rejects, and starts nothing, unless the hook this host was made in is
   * still being waited on (see `live.ts`).
   */
  call: (server: string, tool: string, args: Record<string, unknown>) => Promise<unknown>
  /** Whether a call to Fylgja may be started now: the hook this host was made in is being waited on. */
  isLive: () => boolean
  /** `$.ui.status`: the plugin's one line under the prompt; undefined removes it. */
  status: (text: string | undefined) => void
  /** `$.ui.invalidate('ui.render')`: the rows this plugin draws are drawn again. */
  redraw: () => void
  /** `$.clock.every`: calls `fn` every `ms` milliseconds until cancelled. */
  every: (ms: number, fn: () => void) => { cancel: () => void }
  /** `$.session.cwd`: the directory the session runs in. */
  cwd: () => Promise<string>
  /** Whether a file is at `path` (`$.fs.stat`). */
  exists: (path: string) => Promise<boolean>
  /** `$.fs.read`: a file's text; rejects when it cannot be read. */
  read: (path: string) => Promise<string>
  /** The text of the plugin's own `.mcp.json`. */
  declared: () => Promise<string>
  /** `$.clock.now`. */
  now: () => Promise<number>
  /** `$.clock.after`: calls `fn` once, `ms` milliseconds on. */
  after: (ms: number, fn: () => void) => { cancel: () => void }
  /** `$.store.get`: a value kept on this machine. */
  stored: (key: string) => Promise<unknown>
  /** `$.store.set`. */
  store: (key: string, value: unknown) => Promise<void>
}

export type Connection =
  | { isConnected: true; server: string }
  | { isConnected: false; reason: string }
