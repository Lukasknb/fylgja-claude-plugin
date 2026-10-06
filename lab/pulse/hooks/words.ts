/**
 * The few things the picture says in words, the same wherever they are said.
 */

import { isoOf } from './days'
import type { Cell, Column } from './grid'
import { LANES } from './timeline'
import type { Lane } from './timeline'

const WORDS: Readonly<Record<Lane, [string, string]>> = {
  meeting: ['meeting', 'meetings'],
  session: ['session', 'sessions'],
  decision: ['decision', 'decisions'],
  other: ['other entry', 'other entries'],
}

/** What a cell holds: `2 meetings, 1 session`, or `nothing`. */
export function countsOf(cell: Cell): string {
  const parts = LANES.filter(lane => cell.counts[lane] > 0).map(
    lane => `${cell.counts[lane]} ${WORDS[lane][cell.counts[lane] === 1 ? 0 : 1]}`,
  )

  return parts.length === 0 ? 'nothing' : parts.join(', ')
}

/** The days a column covers. */
export function spanOf(column: Column): string {
  return column.startDay === column.endDay ? isoOf(column.startDay) : `${isoOf(column.startDay)} to ${isoOf(column.endDay)}`
}

/** A window's length as a person says it. */
export function windowOf(days: number): string {
  return days <= 14 ? '2 weeks' : days <= 42 ? '6 weeks' : 'a quarter'
}

/** The first `max` characters of `text`, never half of one. */
export function clip(text: string, max: number): string {
  const chars = Array.from(text)

  return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join('')}…`
}
