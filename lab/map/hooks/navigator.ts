/**
 * The navigator: the project tree as columns the person moves through with
 * the arrow keys. It runs on the drawing thread, so moving the highlight
 * costs no round trip; it tells the hooks module where the person is, and
 * the hooks module answers with the levels it did not have yet.
 */

import type { ClientKeyEvent, ClientModule, ClientPointerEvent, ClientSurface, RenderElement } from 'claude-code'

import { breadcrumb, emptyLine, GAP, layoutOf, parentLevel, previewLines, rowParts, windowStart } from './draw'
import type { Layout, Line } from './draw'
import { atRoot, entered, jumped, left, pickedAt, pickIndex, stepped } from './moves'
import { levelOf, pickedRow, ROOT } from './shape'
import type { Message, Place, Position, View } from './shape'

/** What the navigator keeps for itself between drawings. */
type Mine = {
  /** The `epoch` of the view this position belongs to. */
  epoch: number
  position: Position
  /** The row last highlighted in each level, so coming back to a level finds it again. */
  picks: Record<string, string>
  /** The letters typed to jump to a row, and when the last one was typed. */
  jump: string
  jumpAt: number
}

/** Letters typed closer together than this spell one name. */
const JUMP_MS = 900

const KEYS_WIDE = 'click, then  ←→ levels  ↑↓ rows  a–z jump  ~ top  space what holds now  ⏎ reference  : ask here'
const KEYS_NARROW = 'click, then ←→ ↑↓ a–z ~ space ⏎ :'

/** The navigator's own position while it belongs to this view, else the one the view names. */
function mineOf(view: View, state: Mine | undefined): Mine {
  return state !== undefined && state.epoch === view.epoch
    ? state
    : { epoch: view.epoch, position: view.position, picks: {}, jump: '', jumpAt: 0 }
}

type Step = { position: Position; act?: 'reference' | 'scope'; jump?: string }

/** What one key does, or undefined when it does nothing here. */
function stepOf(mine: Mine, view: View, event: ClientKeyEvent, now: number): Step | undefined {
  const { position } = mine
  const { places } = view

  if (event.ctrl === true || event.meta === true) {
    return undefined
  }

  switch (event.key) {
    case 'up':
      return { position: stepped(position, places, -1) }
    case 'down':
      return { position: stepped(position, places, 1) }
    case 'pageup':
      return { position: stepped(position, places, -10) }
    case 'pagedown':
      return { position: stepped(position, places, 10) }
    case 'home':
      return { position: stepped(position, places, -100_000) }
    case 'end':
      return { position: stepped(position, places, 100_000) }
    case 'right': {
      const row = pickedRow(position, places)

      return { position: entered(position, places, row === undefined ? '' : (mine.picks[row.id] ?? '')) }
    }
    case 'left':
      return { position: left(position) }
    case '~':
      return { position: atRoot(position) }
    case ' ':
    case 'space':
      return { position: { ...position, showsState: !position.showsState } }
    case '1':
      return { position: { ...position, showsState: true, risksOpen: !position.risksOpen } }
    case '2':
      return { position: { ...position, showsState: true, commitmentsOpen: !position.commitmentsOpen } }
    case 'return':
    case 'enter':
      return { position, act: 'reference' }
    case ':':
      return { position, act: 'scope' }
    case 'backspace':
      return { position, jump: '' }
    default:
      break
  }

  if (!/^\p{L}$/u.test(event.key)) {
    return undefined
  }

  // Letters typed in quick succession spell the start of a name; a letter
  // that fits no row starts over as the first letter of another.
  const typed = (now - mine.jumpAt < JUMP_MS ? mine.jump : '') + event.key
  const hit = jumped(position, places, typed)

  if (hit !== undefined) {
    return { position: hit, jump: typed }
  }

  const again = jumped(position, places, event.key)

  return again === undefined ? { position, jump: '' } : { position: again, jump: event.key }
}

/** The row under a click, as a step: a row of the parent column goes up to it, a row of the current one is highlighted, and entered when it already was. */
function clickOf(mine: Mine, view: View, event: ClientPointerEvent, layout: Layout, room: number): Step | undefined {
  if (event.type !== 'down' || event.button !== 'left' || event.y < 1 || event.y > room) {
    return undefined
  }

  const { position } = mine
  const { places } = view
  const inParent = layout.parent > 0 && event.x < layout.parent
  const currentLeft = layout.parent > 0 ? layout.parent + GAP : 0

  if (inParent) {
    const up = left(position)
    const rows = places[levelOf(up)]?.rows ?? []
    const row = rows[windowStart(rows.length, pickIndex(up, places), room) + event.y - 1]

    return position.path.length > 1 && row !== undefined ? { position: pickedAt(up, row.id) } : undefined
  }

  if (event.x < currentLeft || event.x >= currentLeft + layout.current) {
    return undefined
  }

  const rows = places[levelOf(position)]?.rows ?? []
  const row = rows[windowStart(rows.length, pickIndex(position, places), room) + event.y - 1]

  if (row === undefined) {
    return undefined
  }

  return row.id === pickedRow(position, places)?.id
    ? { position: entered(position, places, mine.picks[row.id] ?? '') }
    : { position: pickedAt(position, row.id) }
}

type Elements = ClientSurface['elements']

/** One level as a column of rows, `room` rows tall. */
function listOf(
  elements: Elements,
  view: View,
  level: string,
  pick: string,
  width: number,
  room: number,
  isCurrent: boolean,
): RenderElement {
  const { Box, Text } = elements
  const place: Place | undefined = view.places[level]
  const rows = place?.rows ?? []
  const at = Math.max(
    0,
    rows.findIndex(row => row.id === pick),
  )
  const start = windowStart(rows.length, at, room)
  const lines: RenderElement[] = rows.slice(start, start + room).map((row, index) => {
    const parts = rowParts(row, width)
    const isPick = start + index === at
    const mark =
      row.recency === 'fresh'
        ? Text({ color: 'success', children: [parts.mark] })
        : Text({ dimColor: true, children: [parts.mark] })
    const children = [Text({ dimColor: true, children: [parts.band] }), parts.name, mark]

    if (isPick && isCurrent) {
      return Text({ wrap: 'truncate-end', inverse: true, children })
    }

    return isPick ? Text({ wrap: 'truncate-end', bold: true, children }) : Text({ wrap: 'truncate-end', children })
  })

  if (rows.length === 0) {
    lines.push(
      Text({ dimColor: true, wrap: 'truncate-end', children: [emptyLine(level, place, view.fetches[`o:${level}`])] }),
    )
  } else if (view.fetches[`o:${level}`] === 'loading' && lines.length < room) {
    lines.push(Text({ dimColor: true, children: ['loading…'] }))
  }

  return Box({ flexDirection: 'column', width, height: room, flexShrink: 0, overflow: 'hidden', children: lines })
}

function lineOf(elements: Elements, line: Line): RenderElement {
  const { Text } = elements
  const children = [line.text === '' ? ' ' : line.text]

  switch (line.tone) {
    case 'bold':
      return Text({ bold: true, wrap: 'truncate-end', children })
    case 'dim':
      return Text({ dimColor: true, wrap: 'truncate-end', children })
    case 'good':
      return Text({ color: 'success', wrap: 'truncate-end', children })
    case 'warn':
      return Text({ color: 'warning', wrap: 'truncate-end', children })
    default:
      return Text({ wrap: 'truncate-end', children })
  }
}

const Navigator: ClientModule<View, Mine> = (view, surface) => {
  const { Box, Text, Link } = surface.elements
  const mine = mineOf(view, surface.state)
  const { position } = mine
  const columns = surface.columns > 0 ? surface.columns : view.columns
  const layout = layoutOf(columns)
  const body = Math.max(4, view.rows - 2)
  // Stacked, the list takes only the rows it has, up to half the room, and
  // the preview gets the rest.
  const listed = view.places[levelOf(position)]?.rows.length ?? 0
  const room = layout.isStacked ? Math.max(1, Math.min(Math.floor(body / 2), listed)) : body

  const take = (step: Step | undefined, now: number): void => {
    if (step === undefined) {
      return
    }

    const level = levelOf(step.position)
    const next: Mine = {
      epoch: mine.epoch,
      position: step.position,
      picks: step.position.pick === '' ? mine.picks : { ...mine.picks, [level]: step.position.pick },
      jump: step.jump ?? '',
      jumpAt: step.jump === undefined ? 0 : now,
    }
    const message: Message = { epoch: mine.epoch, position: step.position }

    surface.setState(next)
    surface.post(step.act === undefined ? message : { ...message, act: step.act })
  }

  // Set again on every drawing, so each listener steps from the position
  // that is on screen.
  surface.onKey(event => take(stepOf(mine, view, event, performance.now()), performance.now()))
  surface.onPointer(event => take(clickOf(mine, view, event, layout, room), performance.now()))

  const level = levelOf(position)
  const above = parentLevel(position)
  const picked = pickedRow(position, view.places)
  const link = picked === undefined ? '' : (view.places[picked.id]?.link ?? '')
  const previewRoom = layout.isStacked ? Math.max(2, body - room) : room
  const preview = previewLines({ ...view, position }, layout.preview, link === '' ? previewRoom : previewRoom - 1).map(
    line => lineOf(surface.elements, line),
  )

  if (link !== '') {
    preview.push(Link({ href: link, label: 'open in Fylgja' }))
  }

  if (level === ROOT && view.mayMissTops && preview.length < previewRoom) {
    preview.push(
      Text({
        dimColor: true,
        wrap: 'truncate-end',
        children: ['Areas may be missing here: /map <name> goes to any project.'],
      }),
    )
  }

  const previewBox = Box({
    flexDirection: 'column',
    width: layout.preview,
    height: previewRoom,
    flexShrink: 0,
    overflow: 'hidden',
    children: preview,
  })
  const lists = [
    ...(layout.parent > 0 && above !== undefined
      ? [listOf(surface.elements, view, above, level, layout.parent, room, false)]
      : []),
    ...(layout.parent > 0 && above === undefined ? [Box({ width: layout.parent, height: room, flexShrink: 0 })] : []),
    listOf(surface.elements, view, level, picked?.id ?? '', layout.current, room, true),
  ]
  const isJumping = mine.jump !== '' && performance.now() - mine.jumpAt < JUMP_MS
  const keys = columns >= 100 ? KEYS_WIDE : KEYS_NARROW

  return Box({
    flexDirection: 'column',
    children: [
      Text({ bold: true, wrap: 'truncate-end', children: [breadcrumb(position, view.places, columns)] }),
      layout.isStacked
        ? Box({ flexDirection: 'column', children: [...lists, previewBox] })
        : Box({ flexDirection: 'row', columnGap: GAP, children: [...lists, previewBox] }),
      Text({ dimColor: true, wrap: 'truncate-end', children: [isJumping ? `jump: ${mine.jump}` : keys] }),
    ],
  })
}

export default Navigator
