/**
 * The plain data the map is made of: what is kept about a place in the
 * project tree, where the person is in it, and what crosses between the
 * hooks module and the navigator's surface module.
 *
 * Every string here was sanitised when the server's answer was read, so the
 * code that draws never handles raw server text.
 */

/** The id of the level above every top-level project. It is not a project. */
export const ROOT = 'root'

export type Band = 'orientation' | 'workstream' | 'technical' | 'other'

/** How lately something was filed under a place: within a week, within a month, or longer ago or never. */
export type Recency = 'fresh' | 'month' | 'quiet'

/** One project as a row in its parent's column. */
export type Row = {
  id: string
  name: string
  band: Band
  recency: Recency
  /** How many projects sit directly under it. Never drawn in a row; it decides whether the row can be entered. */
  kids: number
}

/** One place in the tree with the level beneath it. */
export type Place = {
  id: string
  name: string
  /** Names from the top of the tree down to this place, itself last. */
  path: string[]
  band: Band
  lifecycle: string
  definition: string
  include: string[]
  exclude: string[]
  atoms: number
  meetings: number
  weeks: number
  /** The day of the last activity as `YYYY-MM-DD`, or '' when there was none. */
  last: string
  flags: string[]
  rows: Row[]
  /** Children too fine-grained to list: how many, and a few names. */
  folded: { count: number; names: string[] } | null
  /** Whether more children exist than `rows` holds. */
  hasMore: boolean
  /** The https address that opens this project in the Fylgja app, or '' when the server gave none. */
  link: string
}

/** What is known at a place right now. */
export type Knowledge = {
  /** What holds now: one line per question. A group has no value and heads the lines after it. */
  aspects: { question: string; value: string; date: string; isGroup: boolean }[]
  decisions: { text: string; date: string }[]
  risks: string[]
  commitments: { what: string; deadline: string }[]
  /** How many changes are suggested and not yet reviewed. Shown as a count only. */
  proposed: number
  /** Whether the server cut the answer to fit. */
  isCut: boolean
}

/** Where the person is: the levels from the root down, and the highlighted row of the last one. */
export type Position = {
  /** Ids from `ROOT` down to the level whose rows are listed. */
  path: string[]
  /** The highlighted row of that level, or '' for its first row. */
  pick: string
  /** Whether the preview shows what holds now instead of the definition. */
  showsState: boolean
  risksOpen: boolean
  commitmentsOpen: boolean
}

/** Something that can be read or not: missing means nobody asked yet. */
export type Fetch = 'loading' | 'failed'

/** What the navigator's surface module is handed to draw. */
export type View = {
  /**
   * Counts the times the hooks module moved the person somewhere (a `/map`
   * with a name). The navigator keeps its own position until this changes.
   */
  epoch: number
  position: Position
  places: Record<string, Place>
  knowledge: Record<string, Knowledge>
  /** Places and knowledge that are being read or could not be read, by `o:<id>` and `s:<id>`. */
  fetches: Record<string, Fetch>
  /** One plain line when the tree cannot be read at all, else ''. */
  note: string
  /** Whether top-level areas may exist that the root column does not list. */
  mayMissTops: boolean
  /** How many columns and rows the navigator may fill when the surface has not measured its region. */
  columns: number
  rows: number
}

/** What the navigator posts: where the person now is, and an action they asked for. */
export type Message = {
  epoch: number
  position: Position
  act?: 'reference' | 'scope'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

export function startOf(): Position {
  return { path: [ROOT], pick: '', showsState: false, risksOpen: false, commitmentsOpen: false }
}

/** The level whose rows are listed at `position`. */
export function levelOf(position: Position): string {
  return position.path[position.path.length - 1] ?? ROOT
}

/** The highlighted row at `position`: the picked one while it is listed, else the first. */
export function pickedRow(position: Position, places: Record<string, Place>): Row | undefined {
  const rows = places[levelOf(position)]?.rows ?? []

  return rows.find(row => row.id === position.pick) ?? rows[0]
}
