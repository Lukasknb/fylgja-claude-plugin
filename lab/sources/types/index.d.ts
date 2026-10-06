declare module "claude-code" {
  interface PluginState {
    "fylgja-lab-sources": {
      /**
       * Counts the times the pane was asked to draw again. The pane reads it
       * while drawing, so a change redraws the pane and nothing else. It
       * holds no record, title or query: those stay in the plugin's memory.
       */
      drawn: number;
    };
  }
}
