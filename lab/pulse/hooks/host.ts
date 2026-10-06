/**
 * The few engine calls this plugin makes, bound once per hook from that
 * hook's `$` and handed to the plugin's other files as plain functions.
 */
export type Host = {
  /** `$.mcp.connect('fylgja')`. */
  connect: () => Promise<Connection>;
  /** `$.mcp.call`: one read on the session's own Fylgja connection. */
  call: (
    server: string,
    tool: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  /** `$.clock.now`: milliseconds since the epoch. */
  now: () => Promise<number>;
  /** `$.clock.after`: calls `fn` once after `ms` milliseconds unless cancelled. */
  after: (ms: number, fn: () => void) => { cancel: () => void };
  /** `$.ui.invalidate('ui.render')`: the pane is drawn again. */
  redraw: () => void;
  /** `$.prompt.fill` in insert mode: puts text at the cursor of the prompt box and submits nothing. */
  insert: (text: string) => Promise<boolean>;
};

export type Connection =
  | { isConnected: true; server: string }
  | { isConnected: false; reason: string };
