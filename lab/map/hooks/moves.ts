/**
 * Moving through the tree: each function answers the position after one
 * step, from the position before it and the places known. Nothing here
 * reads or draws.
 */

import { levelOf, pickedRow, ROOT } from './shape'
import type { Place, Position, Row } from './shape'

type Places = Record<string, Place>

function rowsAt(position: Position, places: Places): Row[] {
  return places[levelOf(position)]?.rows ?? []
}

/** Where the highlighted row is among its level's rows; 0 when the level has none. */
export function pickIndex(position: Position, places: Places): number {
  return Math.max(
    0,
    rowsAt(position, places).findIndex(row => row.id === position.pick),
  )
}

/** The highlight moved by `by` rows within the level, stopping at either end. */
export function stepped(position: Position, places: Places, by: number): Position {
  const rows = rowsAt(position, places)
  const to = Math.min(rows.length - 1, Math.max(0, pickIndex(position, places) + by))

  return { ...position, pick: rows[to]?.id ?? '', risksOpen: false, commitmentsOpen: false }
}

/** The highlight on the row with this id. */
export function pickedAt(position: Position, id: string): Position {
  return { ...position, pick: id, risksOpen: false, commitmentsOpen: false }
}

/**
 * One level down, into the highlighted row, with `pick` highlighted there
 * ('' for the first row). A row with nothing under it is not entered.
 */
export function entered(position: Position, places: Places, pick = ''): Position {
  const row = pickedRow(position, places)

  if (row === undefined || row.kids === 0 || position.path.length >= 32) {
    return position
  }

  return { ...position, path: [...position.path, row.id], pick, risksOpen: false, commitmentsOpen: false }
}

/** One level up, with the level that was left highlighted. At the root nothing moves. */
export function left(position: Position): Position {
  if (position.path.length <= 1) {
    return position
  }

  return {
    ...position,
    path: position.path.slice(0, -1),
    pick: levelOf(position),
    risksOpen: false,
    commitmentsOpen: false,
  }
}

/** Back at the top of the tree. */
export function atRoot(position: Position): Position {
  return {
    ...position,
    path: [ROOT],
    pick: position.path[1] ?? position.pick,
    risksOpen: false,
    commitmentsOpen: false,
  }
}

/**
 * The highlight on the first row whose name starts with `typed`, or failing
 * that the first row with a word that does. Undefined when no row matches.
 */
export function jumped(position: Position, places: Places, typed: string): Position | undefined {
  const wanted = typed.toLowerCase()
  const rows = rowsAt(position, places)
  const hit =
    rows.find(row => row.name.toLowerCase().startsWith(wanted)) ??
    rows.find(row =>
      row.name
        .toLowerCase()
        .split(/[\s/_-]+/)
        .some(word => word.startsWith(wanted)),
    )

  return hit === undefined ? undefined : pickedAt(position, hit.id)
}
