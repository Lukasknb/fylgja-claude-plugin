/** Which list the pane shows: the recent activity, or one kind of record. */
export type Tab = 'recent' | 'meeting' | 'session' | 'note' | 'project'

/**
 * What the pane was showing, kept by the session so a closed pane reopens
 * where it was left: the text in the search field, the tab, and the id of
 * the one row that is expanded.
 */
export type View = {
  query: string
  tab: Tab
  expanded: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'fylgja-lab-browse': { view: View }
  }
}
