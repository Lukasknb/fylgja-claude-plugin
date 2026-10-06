/**
 * Drawing a list of records, one line each: the kind's glyph and the title
 * on a Button that chooses it, then the date, dimmed.
 *
 * Every element used here (Box, Text, Button) is drawn by the terminal and
 * by the Desktop app alike.
 */

import type { Elements, RenderElement } from 'claude-code'

import type { Candidate } from './candidate'
import { glyphOf } from './glyphs'
import { drawn } from './plain'

export type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export type RowOptions = {
  /** Cells the row may take. */
  width: number
  /** The row a choosing key takes: drawn at full strength behind a mark, the others dimmed. */
  highlight: number | undefined
  /** Whether each row shows its number, the key that chooses it. */
  isNumbered: boolean
  /** Whether the first row ends in a mark that closes the list. */
  onDismiss: (() => void) | undefined
  onChoose: (candidate: Candidate) => void
}

/** The fewest cells a title is given, however narrow the place. */
const MIN_TITLE = 8

function row(kit: Kit, candidate: Candidate, index: number, options: RowOptions): RenderElement {
  const { Box, Text, Button } = kit
  const hasMark = options.highlight !== undefined
  const isHighlighted = options.highlight === index
  const date = candidate.date === undefined ? '' : drawn(candidate.date, 10)
  // Beside the title on the line: the mark, the number, the glyph, the date, the closing mark, and the gaps.
  const beside =
    (hasMark ? 2 : 0) + (options.isNumbered ? 3 : 0) + 2 + (date === '' ? 0 : 11) + (options.onDismiss ? 2 : 0) + 1
  const title = drawn(candidate.title, Math.max(MIN_TITLE, options.width - beside)) || 'untitled'
  const cells: RenderElement[] = []

  if (hasMark) {
    cells.push(Text({ color: 'suggestion', children: [isHighlighted ? '›' : ' '] }))
  }

  cells.push(
    Button({
      key: `pick-${index + 1}`,
      label: `${glyphOf(candidate.kind)} ${title}`,
      plain: true,
      dimColor: hasMark && !isHighlighted,
      ...(options.isNumbered ? { hotkey: String(index + 1) } : {}),
      onPress: () => options.onChoose(candidate),
    }),
  )

  if (date !== '') {
    cells.push(Text({ dimColor: true, children: [date] }))
  }

  if (index === 0 && options.onDismiss !== undefined) {
    cells.push(dismissButton(kit, options.onDismiss))
  }

  return Box({
    key: `row-${index + 1}`,
    flexDirection: 'row',
    columnGap: 1,
    children: cells,
  })
}

function dismissButton(kit: Kit, onDismiss: () => void): RenderElement {
  return kit.Button({
    key: 'dismiss',
    label: '×',
    plain: true,
    dimColor: true,
    role: 'dismiss',
    onPress: onDismiss,
  })
}

/** The rows for `candidates`, in order. */
export function rowsOf(kit: Kit, candidates: readonly Candidate[], options: RowOptions): RenderElement[] {
  return candidates.map((candidate, index) => row(kit, candidate, index, options))
}

/** One dimmed line said in the list's place, with the closing mark when the list can be closed. */
export function lineOf(kit: Kit, text: string, onDismiss: (() => void) | undefined): RenderElement {
  const line = kit.Text({ dimColor: true, children: [drawn(text, 120)] })

  return onDismiss === undefined
    ? line
    : kit.Box({
        key: 'line',
        flexDirection: 'row',
        columnGap: 1,
        children: [line, dismissButton(kit, onDismiss)],
      })
}
