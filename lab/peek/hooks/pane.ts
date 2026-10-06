import type { RenderElement } from 'claude-code'

import { glyphOf } from './glyphs'
import type { Kit } from './kit'
import type { Failure } from './library'
import type { Actions, Peek } from './peek'
import { markdownSafe } from './plain'
import { isMeeting, isPage, isPerson, isProject } from './record'
import type { Meeting, Page, Person, Project, Rec } from './record'
import { linkOf, referenceOf, refOfLink } from './refs'
import * as View from './view'

/** The most of a note's or session's text the pane draws. */
const MAX_BODY = 30_000

const SAID: Readonly<Record<Failure, string>> = {
  'signed-out': 'Fylgja needs sign-in: type /mcp and pick fylgja, then press Retry.',
  'not-found': 'Not found, or not yours to read.',
  unreachable: 'Fylgja did not answer.',
  unreadable: 'Fylgja answered with something this build cannot show.',
}

function dim(kit: Kit, text: string): RenderElement {
  return kit.Text({ dimColor: true, wrap: 'wrap', children: [text] })
}

function bullet(kit: Kit, text: string, tail = ''): RenderElement {
  const { Text } = kit

  return Text({ wrap: 'wrap', children: [`• ${text}`, ...(tail === '' ? [] : [Text({ dimColor: true, children: [tail] })])] })
}

/**
 * One part of a record under a heading the person can fold away. The
 * heading is a control: a press folds or unfolds what is under it.
 */
function section(kit: Kit, peek: Peek, actions: Actions, name: string, label: string, rows: readonly RenderElement[]): RenderElement {
  const { Box, Button } = kit
  const isFolded = peek.view.folded.has(name)

  return Box({
    flexDirection: 'column',
    children: [
      Button({ key: `fold:${name}`, plain: true, label: `${isFolded ? '▸' : '▾'} ${label}`, onPress: () => actions.toggle(name) }),
      ...(isFolded ? [] : [Box({ flexDirection: 'column', paddingLeft: 2, children: [...rows] })]),
    ],
  })
}

function listed(kit: Kit, items: readonly RenderElement[], whenNone: string): RenderElement[] {
  return items.length > 0 ? [...items] : [dim(kit, whenNone)]
}

function meeting(kit: Kit, peek: Peek, actions: Actions, record: Meeting): RenderElement[] {
  const { Text } = kit
  const part = (name: string, label: string, rows: readonly RenderElement[]) => section(kit, peek, actions, name, label, rows)
  const commitments = record.commitments.map(item =>
    bullet(
      kit,
      item.what,
      [item.owner, item.deadline === null ? null : `due ${item.deadline}`, item.status]
        .filter(piece => piece !== null)
        .map(piece => ` - ${piece}`)
        .join(''),
    ),
  )

  return [
    part(
      'participants',
      record.has.participants ? `Participants (${record.participants.length})` : 'Participants',
      record.has.participants
        ? listed(kit, record.participants.length > 0 ? [Text({ wrap: 'wrap', children: [record.participants.join(', ')] })] : [], 'None recorded.')
        : [dim(kit, 'Not read.')],
    ),
    part('summary', 'Summary', listed(kit, record.summary === null ? [] : [Text({ wrap: 'wrap', children: [record.summary] })], 'No summary.')),
    part('decisions', `Decisions (${record.decisions.length})`, listed(kit, record.decisions.map(what => bullet(kit, what)), 'None.')),
    part('key-points', `Key points (${record.keyPoints.length})`, listed(kit, record.keyPoints.map(point => bullet(kit, point)), 'None.')),
    part(
      'commitments',
      record.has.commitments ? `Commitments (${record.commitments.length})` : 'Commitments',
      record.has.commitments ? listed(kit, commitments, 'None.') : [dim(kit, 'Not read.')],
    ),
  ]
}

function project(kit: Kit, actions: Actions, record: Project): RenderElement[] {
  const { Box, Text, Button } = kit
  const standing = [record.meetings === null ? null : `${record.meetings} meetings`, record.date === null ? null : `last activity ${record.date}`].filter(
    piece => piece !== null,
  )

  return [
    ...(record.definition === null ? [] : [Text({ wrap: 'wrap', children: [record.definition] })]),
    ...(standing.length === 0 ? [] : [dim(kit, standing.join(' · '))]),
    Text({ bold: true, children: [record.children.length > 0 ? 'Under it' : 'Nothing is filed under it.'] }),
    // One level: a press on a child shows that child, and Back steps out again.
    ...record.children.map(child =>
      Box({
        flexDirection: 'row',
        columnGap: 1,
        children: [
          Button({ key: `child:${child.id}`, plain: true, label: `▸ ${child.name}`, onPress: () => actions.open({ id: child.id, kind: 'project' }) }),
          dim(kit, [child.under > 0 ? `${child.under} under it` : null, child.lastActivity].filter(piece => piece !== null).join(' · ')),
        ],
      }),
    ),
    ...(record.hasMore ? [dim(kit, 'More is filed under it than is listed here.')] : []),
  ]
}

/**
 * A note's or session's text as markdown. A link in it to another Fylgja
 * record is answered by the pane itself (a press shows that record); every
 * other link is drawn as its label and its address in the open.
 */
function page(kit: Kit, actions: Actions, record: Page): RenderElement[] {
  const kept = new Set<string>()
  const text = markdownSafe(record.body, MAX_BODY, target => {
    const ref = refOfLink(target)
    const link = ref === undefined ? undefined : linkOf(ref.kind, ref.id)

    if (link !== undefined) {
      kept.add(link)
    }

    return link
  })

  if (text.trim() === '') {
    return [dim(kit, 'Nothing is written in it.')]
  }

  const press =
    kept.size === 0
      ? {}
      : {
          pressableLinks: [...kept].slice(0, 256),
          onLinkPress: (link: { href: string }) => {
            const ref = refOfLink(link.href)

            if (ref !== undefined) {
              actions.open({ id: ref.id, kind: ref.kind })
            }
          },
        }

  return [kit.Markdown({ key: 'peek-body', text, ...press })]
}

function person(kit: Kit, record: Person): RenderElement[] {
  const standing = [record.role, record.organization].filter(piece => piece !== null)

  return [
    ...(standing.length === 0 ? [] : [kit.Text({ wrap: 'wrap', children: [standing.join(' - ')] })]),
    ...(record.interactions.length === 0 ? [] : [kit.Text({ bold: true, children: ['Lately'] })]),
    ...record.interactions.map(item => bullet(kit, item.summary, item.date === null ? '' : ` - ${item.date}`)),
  ]
}

function body(kit: Kit, peek: Peek, actions: Actions, record: Rec): RenderElement[] {
  if (isMeeting(record)) {
    return meeting(kit, peek, actions, record)
  }

  if (isProject(record)) {
    return project(kit, actions, record)
  }

  if (isPerson(record)) {
    return person(kit, record)
  }

  return isPage(record) ? page(kit, actions, record) : [dim(kit, `The pane has no view for a ${record.kind} yet.`)]
}

/** The record's own heading: what it is, where it is filed, and the link that opens it in Fylgja. */
function heading(kit: Kit, record: Rec): RenderElement[] {
  const { Text, Link } = kit
  const link = linkOf(record.kind, record.id)
  const facts = [record.kind, record.date, record.path.length > 0 ? record.path.join(' > ') : null, record.scope].filter(piece => piece !== null)

  return [
    ...(link === undefined ? [] : [Link({ href: link, label: 'Open in Fylgja' })]),
    Text({ bold: true, wrap: 'wrap', children: [`${glyphOf(record.kind)} ${record.title}`] }),
    dim(kit, facts.join(' · ')),
    ...(record.isCut ? [dim(kit, 'Fylgja cut this record short; the rest is in the app.')] : []),
  ]
}

/**
 * The peek view: a row of controls, then the record on show or one plain
 * line saying why there is none. The same drawing serves the pane and the
 * band above the prompt.
 */
export function drawPeek(kit: Kit, peek: Peek, actions: Actions): RenderElement {
  const { Box, Text, Button } = kit
  const { view, library } = peek
  const shown = View.current(view)

  if (shown === undefined) {
    return Box({
      flexDirection: 'column',
      paddingX: 1,
      children: [dim(kit, 'Nothing peeked at yet. Type /peek and a reference, a link or an id, or click a Fylgja link in a reply.')],
    })
  }

  const held = library.records.get(shown.id)
  const canBack = view.at > 0
  const canForward = view.at < view.history.length - 1
  // A record has a reference to copy once it was read, and only if its kind can be named in one.
  const canCopy = held?.state === 'ready' && referenceOf(held.record.kind, held.record.title, held.record.id) !== undefined

  const controls = Box({
    flexDirection: 'row',
    columnGap: 1,
    flexWrap: 'wrap',
    children: [
      ...(canBack ? [Button({ key: 'back', label: '← Back', hotkey: 'b', onPress: () => actions.step(-1) })] : []),
      ...(canForward ? [Button({ key: 'forward', label: 'Forward →', hotkey: 'f', onPress: () => actions.step(1) })] : []),
      ...(canCopy ? [Button({ key: 'copy', label: 'Copy reference', hotkey: 'c', variant: 'primary', onPress: () => actions.copy() })] : []),
      ...(held?.state === 'ready' ? [Button({ key: 'refresh', label: 'Refresh', hotkey: 'r', onPress: () => actions.refresh() })] : []),
      ...(held?.state === 'failed' ? [Button({ key: 'retry', label: 'Retry', hotkey: 'r', variant: 'primary', onPress: () => actions.refresh() })] : []),
      Button({ key: 'close', label: 'Close', hotkey: 'x', role: 'dismiss', onPress: () => actions.close() }),
      dim(kit, `${view.at + 1}/${view.history.length}`),
    ],
  })

  const note =
    view.note === undefined
      ? []
      : view.note.is === 'inserted'
        ? [dim(kit, 'The reference is in the prompt box. Nothing was sent.')]
        : [
            dim(kit, 'The prompt box did not take it. Select the reference here:'),
            // Written by this plugin from the record's id and its cleaned title.
            Text({ wrap: 'wrap', children: [view.note.text] }),
          ]

  const record =
    held === undefined || held.state === 'loading'
      ? [dim(kit, `${glyphOf(shown.kind ?? 'record')} Reading from Fylgja…`)]
      : held.state === 'failed'
        ? [Text({ wrap: 'wrap', children: [SAID[held.reason]] })]
        : [...heading(kit, held.record), ...body(kit, peek, actions, held.record)]

  return Box({ flexDirection: 'column', paddingX: 1, rowGap: 0, children: [controls, ...note, ...record] })
}
