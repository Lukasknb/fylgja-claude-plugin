/**
 * The map without raw keys: every row and every move is a button. Used
 * where the surface has no `Client` element, and after the navigator's
 * surface module failed.
 */

import type { Elements, RenderElement } from 'claude-code'

import { breadcrumb, emptyLine, GAP, layoutOf, previewLines, rowParts, windowStart } from './draw'
import { atRoot, entered, left, pickedAt, pickIndex } from './moves'
import { levelOf, pickedRow } from './shape'
import type { Position, View } from './shape'

export type FallbackElements = Pick<Elements['mobile'], 'Box' | 'Text' | 'Button' | 'Link'>

/** What is lost without the navigator, said once at the top of the fallback. */
export const FALLBACK_NOTE =
  'Arrow keys and type-to-jump are not available here. Rows are buttons; each press asks the plugin, so moving is slower.'

/**
 * @param go called with the position a pressed button leads to
 */
export function fallbackOf(elements: FallbackElements, view: View, go: (position: Position) => void): RenderElement {
  const { Box, Text, Button, Link } = elements
  const { position, places } = view
  const layout = layoutOf(view.columns)
  const isSideBySide = !layout.isStacked
  const body = Math.max(4, view.rows - 4)
  const room = isSideBySide ? body : Math.max(3, Math.floor(body / 2))
  const level = levelOf(position)
  const place = places[level]
  const rows = place?.rows ?? []
  const picked = pickedRow(position, places)
  const start = windowStart(rows.length, pickIndex(position, places), room)
  const known = picked === undefined ? undefined : view.knowledge[picked.id]
  const link = picked === undefined ? '' : (places[picked.id]?.link ?? '')

  const list: RenderElement[] = rows.slice(start, start + room).map(row => {
    const parts = rowParts(row, layout.current - 2)

    return Button({
      key: `row-${row.id}`,
      label: `${row.id === picked?.id ? '›' : ' '} ${parts.band}${parts.name}${parts.mark}`,
      plain: true,
      onPress: () => go(pickedAt(position, row.id)),
    })
  })

  if (rows.length === 0) {
    list.push(Text({ dimColor: true, children: [emptyLine(level, place, view.fetches[`o:${level}`])] }))
  }

  const moves: RenderElement[] = [
    ...(position.path.length > 1
      ? [
          Button({ key: 'move-up', label: '‹ up', hotkey: 'u', onPress: () => go(left(position)) }),
          Button({ key: 'move-top', label: 'top', hotkey: 't', onPress: () => go(atRoot(position)) }),
        ]
      : []),
    ...(picked !== undefined && picked.kids > 0
      ? [Button({ key: 'move-into', label: 'into ›', hotkey: 'o', onPress: () => go(entered(position, places)) })]
      : []),
    ...(picked !== undefined
      ? [
          Button({
            key: 'show-state',
            label: position.showsState ? 'definition' : 'what holds now',
            hotkey: 'w',
            onPress: () => go({ ...position, showsState: !position.showsState }),
          }),
        ]
      : []),
    ...(position.showsState && known !== undefined
      ? [
          Button({
            key: 'show-risks',
            label: 'risks',
            hotkey: '1',
            onPress: () => go({ ...position, risksOpen: !position.risksOpen }),
          }),
          Button({
            key: 'show-commitments',
            label: 'commitments',
            hotkey: '2',
            onPress: () => go({ ...position, commitmentsOpen: !position.commitmentsOpen }),
          }),
        ]
      : []),
  ]

  const preview: RenderElement[] = previewLines(
    view,
    layout.preview,
    isSideBySide ? room - 1 : Math.max(2, body - room),
  ).map(line =>
    line.tone === 'bold'
      ? Text({ bold: true, wrap: 'truncate-end', children: [line.text] })
      : line.tone === 'dim'
        ? Text({ dimColor: true, wrap: 'truncate-end', children: [line.text === '' ? ' ' : line.text] })
        : line.tone === 'warn'
          ? Text({ color: 'warning', wrap: 'truncate-end', children: [line.text] })
          : Text({ wrap: 'truncate-end', children: [line.text === '' ? ' ' : line.text] }),
  )

  if (link !== '') {
    preview.push(Link({ href: link, label: 'open in Fylgja' }))
  }

  return Box({
    flexDirection: 'column',
    children: [
      Text({ dimColor: true, children: [FALLBACK_NOTE] }),
      Text({ bold: true, wrap: 'truncate-end', children: [breadcrumb(position, places, view.columns)] }),
      ...(moves.length > 0 ? [Box({ flexDirection: 'row', columnGap: GAP, flexWrap: 'wrap', children: moves })] : []),
      Box({
        flexDirection: isSideBySide ? 'row' : 'column',
        columnGap: GAP,
        children: [
          Box({ flexDirection: 'column', width: layout.current, flexShrink: 0, children: list }),
          Box({ flexDirection: 'column', width: layout.preview, flexShrink: 0, children: preview }),
        ],
      }),
    ],
  })
}
