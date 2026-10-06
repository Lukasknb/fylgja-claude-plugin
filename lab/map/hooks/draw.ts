/**
 * What the map shows, as plain lines of text: the same whether the
 * navigator's surface module draws them or the button fallback does.
 */

import { pickedRow, ROOT } from './shape'
import type { Band, Fetch, Knowledge, Place, Position, Recency, Row } from './shape'

export type Tone = 'plain' | 'dim' | 'bold' | 'good' | 'warn'
export type Line = { text: string; tone: Tone }

/** The one cue a row carries beside its name: how lately something was filed there. */
export const RECENCY_MARK: Readonly<Record<Recency, string>> = { fresh: '●', month: '○', quiet: '·' }

/** The mark before a row's name that tells its band. */
export const BAND_MARK: Readonly<Record<Band, string>> = {
  orientation: '▪',
  workstream: '▫',
  technical: '-',
  other: ' ',
}

/** The gap between two columns. */
export const GAP = 2

export type Layout = {
  /** The width of the parent column; 0 when it is not shown. */
  parent: number
  current: number
  /** The width of the preview; with `isStacked` it sits under the list. */
  preview: number
  isStacked: boolean
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * How the room is shared. Three columns from 100 cells (parent, current,
 * preview), two from 56 (current, preview), and below that one column with a
 * short preview under it. The preview never grows past a readable line.
 */
export function layoutOf(columns: number): Layout {
  if (columns >= 100) {
    const parent = clamp(Math.floor(columns * 0.2), 18, 30)
    const current = clamp(Math.floor(columns * 0.28), 26, 44)

    return { parent, current, preview: Math.min(96, columns - parent - current - 2 * GAP), isStacked: false }
  }

  if (columns >= 56) {
    const current = clamp(Math.floor(columns * 0.42), 24, 38)

    return { parent: 0, current, preview: columns - current - GAP, isStacked: false }
  }

  const width = Math.max(16, columns)

  return { parent: 0, current: width, preview: width, isStacked: true }
}

function cells(text: string): number {
  return Array.from(text).length
}

/** `text` in exactly `width` cells: cut with an ellipsis, or padded with spaces. */
export function fit(text: string, width: number): string {
  const chars = Array.from(text)

  if (chars.length <= width) {
    return text + ' '.repeat(width - chars.length)
  }

  return width <= 1 ? '…'.repeat(Math.max(0, width)) : `${chars.slice(0, width - 1).join('')}…`
}

/** The parts of one row at `width` cells: the band mark, the name, the recency mark. */
export function rowParts(row: Row, width: number): { band: string; name: string; mark: string } {
  return {
    band: `${BAND_MARK[row.band]} `,
    name: fit(row.name, Math.max(1, width - 4)),
    mark: ` ${RECENCY_MARK[row.recency]}`,
  }
}

/** The first row shown of `count` when `room` rows fit and row `at` must be among them. */
export function windowStart(count: number, at: number, room: number): number {
  return count <= room ? 0 : clamp(at - Math.floor(room / 2), 0, count - room)
}

/** `text` broken into lines of at most `width` cells, at most `max` lines, the last ending in an ellipsis when cut. */
export function wrapped(text: string, width: number, max: number): string[] {
  const room = Math.max(8, width)
  const lines: string[] = []
  let line = ''

  for (const word of text.split(' ')) {
    let rest = word

    while (cells(rest) > room) {
      if (line !== '') {
        lines.push(line)
        line = ''
      }

      lines.push(Array.from(rest).slice(0, room).join(''))
      rest = Array.from(rest).slice(room).join('')
    }

    if (line !== '' && cells(line) + 1 + cells(rest) > room) {
      lines.push(line)
      line = rest
    } else {
      line = line === '' ? rest : `${line} ${rest}`
    }
  }

  if (line !== '') {
    lines.push(line)
  }

  if (lines.length <= max) {
    return lines
  }

  const kept = lines.slice(0, Math.max(1, max))
  const last = kept[kept.length - 1] ?? ''
  kept[kept.length - 1] = `${Array.from(last)
    .slice(0, room - 1)
    .join('')}…`

  return kept
}

function nameOf(id: string, parent: string | undefined, places: Record<string, Place>): string {
  if (id === ROOT) {
    return 'Fylgja'
  }

  return places[id]?.name ?? places[parent ?? ROOT]?.rows.find(row => row.id === id)?.name ?? '…'
}

/** The names of the levels the person went down, from the top. */
export function crumbs(position: Position, places: Record<string, Place>): string[] {
  return position.path.map((id, at) => nameOf(id, position.path[at - 1], places))
}

/** Where the person is, on one line of at most `width` cells; the nearest levels are kept when it is cut. */
export function breadcrumb(position: Position, places: Record<string, Place>, width: number): string {
  const whole = crumbs(position, places).join(' › ')
  const chars = Array.from(whole)

  return chars.length <= width ? whole : `…${chars.slice(chars.length - Math.max(1, width - 1)).join('')}`
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function push(lines: Line[], tone: Tone, text: string, width: number, max: number, indent = ''): void {
  for (const line of wrapped(text, width - indent.length, max)) {
    lines.push({ text: indent + line, tone })
  }
}

function definitionLines(place: Place, known: Knowledge | undefined, width: number): Line[] {
  const lines: Line[] = []

  if (place.definition === '') {
    lines.push({ text: 'No definition yet.', tone: 'dim' })
  } else {
    push(lines, 'plain', place.definition, width, 6)
  }

  lines.push({ text: '', tone: 'plain' })
  push(
    lines,
    'plain',
    `${plural(place.atoms, 'statement', 'statements')}, ${plural(place.meetings, 'meeting', 'meetings')}, ${plural(place.weeks, 'active week', 'active weeks')}`,
    width,
    2,
  )
  lines.push({ text: place.last === '' ? 'no activity yet' : `last activity ${place.last}`, tone: 'dim' })

  if (place.include.length > 0) {
    push(lines, 'dim', `takes in: ${place.include.join(', ')}`, width, 2)
  }

  if (place.exclude.length > 0) {
    push(lines, 'dim', `leaves out: ${place.exclude.join(', ')}`, width, 2)
  }

  if (place.flags.length > 0) {
    push(lines, 'dim', `flags: ${place.flags.join(', ')}`, width, 1)
  }

  if (place.rows.length > 0 || place.hasMore) {
    lines.push({ text: `${place.rows.length}${place.hasMore ? ' or more' : ''} below`, tone: 'dim' })
  }

  if (place.folded !== null) {
    push(
      lines,
      'dim',
      `${place.folded.count} fine-grained below, not listed: ${place.folded.names.join(', ')}`,
      width,
      2,
    )
  }

  if (known !== undefined && known.proposed > 0) {
    push(
      lines,
      'dim',
      `${plural(known.proposed, 'change is', 'changes are')} proposed here; review in Fylgja`,
      width,
      2,
    )
  }

  return lines
}

function knowledgeLines(known: Knowledge, position: Position, width: number): Line[] {
  const lines: Line[] = [{ text: 'What holds now', tone: 'dim' }]

  for (const aspect of known.aspects) {
    if (aspect.isGroup) {
      lines.push({ text: fit(aspect.question, width).trimEnd(), tone: 'dim' })
    } else {
      push(
        lines,
        'plain',
        `${aspect.question} → ${aspect.value}${aspect.date === '' ? '' : ` (${aspect.date})`}`,
        width,
        3,
      )
    }
  }

  if (known.aspects.length === 0) {
    lines.push({ text: 'Nothing is recorded as holding here yet.', tone: 'dim' })
  }

  lines.push({ text: '', tone: 'plain' })
  lines.push({
    text: `${position.risksOpen ? '▾' : '▸'} ${plural(known.risks.length, 'open risk', 'open risks')}  (1)`,
    tone: known.risks.length > 0 ? 'warn' : 'dim',
  })

  if (position.risksOpen) {
    for (const risk of known.risks) {
      push(lines, 'plain', risk, width, 3, '  ')
    }
  }

  lines.push({
    text: `${position.commitmentsOpen ? '▾' : '▸'} ${plural(known.commitments.length, 'open commitment', 'open commitments')}  (2)`,
    tone: known.commitments.length > 0 ? 'plain' : 'dim',
  })

  if (position.commitmentsOpen) {
    for (const item of known.commitments) {
      push(lines, 'plain', `${item.what}${item.deadline === '' ? '' : ` (due ${item.deadline})`}`, width, 3, '  ')
    }
  }

  if (known.decisions.length > 0) {
    lines.push({ text: '', tone: 'plain' })
    lines.push({ text: 'Recent decisions', tone: 'dim' })

    for (const decision of known.decisions.slice(0, 3)) {
      push(lines, 'plain', `${decision.date === '' ? '' : `${decision.date} `}${decision.text}`, width, 3)
    }
  }

  if (known.proposed > 0) {
    push(
      lines,
      'dim',
      `${plural(known.proposed, 'change is', 'changes are')} proposed here; review in Fylgja`,
      width,
      2,
    )
  }

  if (known.isCut) {
    lines.push({ text: 'Cut to fit; Fylgja has the rest.', tone: 'dim' })
  }

  return lines
}

function waiting(fetch: Fetch | undefined, what: string): Line {
  return {
    text: fetch === 'failed' ? `${what} could not be read.` : fetch === 'loading' ? 'loading…' : '…',
    tone: 'dim',
  }
}

export type PreviewInput = {
  position: Position
  places: Record<string, Place>
  knowledge: Record<string, Knowledge>
  fetches: Record<string, Fetch>
}

/**
 * The preview of the highlighted project in at most `room` lines of `width`
 * cells: its name, then either its definition and counts or, when asked,
 * what holds there now. What has not arrived yet says so in its place.
 */
export function previewLines(input: PreviewInput, width: number, room: number): Line[] {
  const { position, places, knowledge, fetches } = input
  const row = pickedRow(position, places)

  if (row === undefined) {
    return []
  }

  const place = places[row.id]
  const known = knowledge[row.id]
  const lines: Line[] = [{ text: fit(row.name, width).trimEnd(), tone: 'bold' }]

  if (place !== undefined) {
    const kind = [place.band === 'other' ? '' : place.band, place.lifecycle].filter(part => part !== '').join(', ')

    if (kind !== '') {
      lines.push({ text: kind, tone: 'dim' })
    }
  }

  lines.push({ text: '', tone: 'plain' })

  if (position.showsState) {
    lines.push(
      ...(known === undefined
        ? [waiting(fetches[`s:${row.id}`], 'What holds here')]
        : knowledgeLines(known, position, width)),
    )
  } else {
    lines.push(
      ...(place === undefined
        ? [waiting(fetches[`o:${row.id}`], 'This project')]
        : definitionLines(place, known, width)),
    )
  }

  if (lines.length <= room) {
    return lines
  }

  return [...lines.slice(0, Math.max(1, room - 1)), { text: '… more in Fylgja', tone: 'dim' }]
}

/** What the list of a level says in place of rows when it has none. */
export function emptyLine(level: string, place: Place | undefined, fetch: Fetch | undefined): string {
  if (fetch === 'failed') {
    return 'could not be read'
  }

  if (place === undefined || fetch === 'loading') {
    return 'loading…'
  }

  if (level === ROOT) {
    return 'no projects found'
  }

  return place.folded !== null ? `${place.folded.count} fine-grained, not listed` : 'nothing below'
}

/** The level whose rows the parent column lists, or undefined at the root. */
export function parentLevel(position: Position): string | undefined {
  return position.path.length > 1 ? position.path[position.path.length - 2] : undefined
}
