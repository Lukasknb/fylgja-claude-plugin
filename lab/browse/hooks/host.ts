import type { View } from "../types";

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
  /** `$.ui.invalidate('ui.render')`: the pane is drawn again. */
  redraw: () => void;
  /** `$.clock.after`: calls `fn` once after `ms` milliseconds unless cancelled. */
  after: (ms: number, fn: () => void) => { cancel: () => void };
  /** `$.prompt.fill` in insert mode: puts `text` at the cursor of the prompt box. It never submits. */
  insert: (text: string) => Promise<boolean>;
  /** `$.ui.copy`: puts `text` on the clipboard; false when the surface has no way to. */
  copy: (text: string) => Promise<boolean>;
  /** `$.ui.focus`: moves the focus ring onto one of this plugin's controls. */
  focus: (site: string, key: string) => void;
  /** `$.ui.open`: asks for the pane; false when the surface places none. */
  open: () => Promise<boolean>;
  /** Reads what the pane was last showing from the session's state. */
  loadView: () => Promise<View>;
  /** Keeps what the pane is showing in the session's state. */
  saveView: (view: View) => void;
};

export type Connection =
  | { isConnected: true; server: string }
  | { isConnected: false; reason: string };
