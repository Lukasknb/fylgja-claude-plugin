/**
 * The aside as it is drawn: the question, where it stands, the answer, and
 * the records it rests on. The same tree on every surface; the one element
 * a surface may lack, the text field, is left out there.
 */

import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import { shownOf } from './asides'
import type { Asides, Outcome, Turn } from './asides'
import { glyphOf } from './glyphs'
import type { Hit, Source } from './retrieve'

/** What the pane's controls do. Each is bound to the engine where the hooks are registered. */
export type Actions = {
  /** A question typed into the pane's field. */
  ask: (question: string) => void
  /** The same question again, with a second and wider search: only ever on the person's press. */
  widen: (turn: Turn) => void
  /** Shows the aside `by` places away. */
  step: (by: number) => void
  /** The next question typed starts a thread of its own. */
  fresh: () => void
  /** Puts one record's reference into the prompt box. */
  insert: (hit: Hit) => void
  /** Puts a one-line pointer to the aside's records into the prompt box. */
  hand: (turn: Turn) => void
  /** Keeps what is typed in the field, so a redraw does not wipe it. */
  draft: (text: string) => void
  /** Takes the band down, where the band stands in for the pane. */
  close: (() => void) | undefined
}

type Kit = Elements[RenderSurface]

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/** The one line for an aside that has not ended in an answer, or undefined when it has. */
export function lineOf(turn: Turn): string | undefined {
  if (turn.phase === 'searching') {
    return 'Searching Fylgja (one search)…'
  }

  if (turn.phase === 'reading') {
    return `Reading ${plural(turn.reading, 'record')}…`
  }

  if (turn.phase === 'answering') {
    return `Read ${plural(turn.reading, 'record')}. Asking the small model…`
  }

  return turn.outcome === undefined ? 'Nothing came of this question.' : outcomeLine(turn.outcome)
}

function outcomeLine(outcome: Outcome): string | undefined {
  switch (outcome.kind) {
    case 'answered':
      return undefined
    case 'uncited':
      return 'Nothing found in what I read.'
    case 'model-silent':
      return outcome.why === 'rate-limited'
        ? 'The model is rate limited and did not answer. This is what the search found.'
        : outcome.why === 'timed-out'
          ? 'The model took too long and was stopped. This is what the search found.'
          : 'The model did not answer. This is what the search found.'
    case 'no-hits':
      return 'No record matched.'
    case 'signed-out':
      return 'Fylgja needs sign-in: type /mcp.'
    case 'offline':
      return 'Fylgja is not connected in this session.'
    case 'rate-limited':
      return outcome.seconds === null
        ? 'Fylgja is rate limited. Try again in a minute.'
        : `Fylgja is rate limited. Try again in ${plural(outcome.seconds, 'second')}.`
    case 'failed':
      return 'Fylgja did not answer.'
    case 'unexpected':
      return 'Fylgja answered in a shape this version does not read.'
  }
}

function sourceRow(kit: Kit, turn: Turn, source: Source, n: number, actions: Actions): RenderElement {
  const { Box, Text, Button, Link } = kit
  const isCited = turn.outcome?.kind === 'answered' && turn.outcome.cited.includes(n)
  const notes = [
    source.date,
    turn.outcome?.kind === 'answered' && !isCited ? 'not cited' : null,
    source.isRead ? null : 'search excerpt only',
    source.isCut ? 'cut' : null,
  ].filter((note): note is string => note !== null)

  return Box({
    key: `source-${turn.id}-${n}`,
    flexDirection: 'column',
    children: [
      Text({
        children: [
          Text({
            bold: isCited,
            children: [`[${n}] ${glyphOf(source.kind)} ${source.title}`],
          }),
          Text({
            dimColor: true,
            children: [notes.map(note => `  ${note}`).join('')],
          }),
        ],
      }),
      Box({
        flexDirection: 'row',
        columnGap: 2,
        paddingLeft: 4,
        children: [
          source.link === null ? null : Link({ href: source.link, label: 'Open in Fylgja' }),
          Button({
            key: `insert-${turn.id}-${n}`,
            label: 'Put reference in prompt',
            plain: true,
            onPress: () => actions.insert(source),
          }),
        ],
      }),
    ],
  })
}

function sourcesOf(kit: Kit, turn: Turn, actions: Actions): RenderElement[] {
  const { Box, Text } = kit

  if (turn.sources.length === 0 && turn.others.length === 0) {
    return []
  }

  const heading =
    turn.outcome?.kind === 'answered'
      ? 'Sources: the records I read, listed by the search, not by the answer'
      : `What I read (${plural(turn.sources.length, 'record')})`

  return [
    Box({
      flexDirection: 'column',
      children: [
        Text({ dimColor: true, children: [heading] }),
        ...turn.sources.map((source, at) => sourceRow(kit, turn, source, at + 1, actions)),
        turn.others.length === 0
          ? null
          : Text({
              dimColor: true,
              children: [`Also matched, not read (${turn.others.length}):`],
            }),
        ...turn.others.map(hit =>
          Text({
            dimColor: true,
            wrap: 'truncate-end',
            children: [`    ${glyphOf(hit.kind)} ${hit.title}${hit.date === null ? '' : `  ${hit.date}`}`],
          }),
        ),
      ],
    }),
  ]
}

function bodyOf(kit: Kit, turn: Turn): RenderElement[] {
  const { Text, Markdown } = kit
  const line = lineOf(turn)
  const isWaiting = turn.phase !== 'done'
  const parts: RenderElement[] = []

  if (line !== undefined) {
    parts.push(Text({ color: isWaiting ? 'suggestion' : 'warning', children: [line] }))
  }

  if (turn.outcome?.kind === 'answered') {
    parts.push(Markdown({ key: `answer-${turn.id}`, text: turn.outcome.text }))

    if (turn.outcome.dropped > 0) {
      parts.push(
        Text({
          dimColor: true,
          children: [`${plural(turn.outcome.dropped, 'sentence')} without a source left out.`],
        }),
      )
    }
  }

  if (turn.phase === 'done' && turn.isCut) {
    parts.push(
      Text({
        dimColor: true,
        children: ['Some records were cut at the read cap; what was cut was not read.'],
      }),
    )
  }

  return parts
}

/**
 * The whole drawing.
 *
 * Everything shown that came from the server passed the sanitiser when it
 * was read; the answer passed it when it was checked. The list of sources
 * is built from what this plugin retrieved and never from the answer.
 */
export function draw(kit: Kit, asides: Asides, actions: Actions): RenderElement {
  const { Box, Text, Button } = kit
  const turn = shownOf(asides)
  const isDone = turn?.phase === 'done'
  const hasRecords = isDone && turn.sources.length > 0
  const follows = turn !== undefined && !asides.isFresh && turn.outcome?.kind === 'answered'

  const head = Box({
    flexDirection: 'row',
    columnGap: 2,
    children: [
      Text({
        bold: true,
        children: [turn === undefined ? 'Aside' : `Aside ${asides.shown + 1} of ${asides.turns.length}`],
      }),
      asides.shown > 0
        ? Button({
            key: 'older',
            label: '‹ older',
            plain: true,
            onPress: () => actions.step(-1),
          })
        : null,
      asides.shown < asides.turns.length - 1
        ? Button({
            key: 'newer',
            label: 'newer ›',
            plain: true,
            onPress: () => actions.step(1),
          })
        : null,
      actions.close === undefined
        ? null
        : Button({
            key: 'close',
            label: 'close',
            plain: true,
            role: 'dismiss',
            onPress: actions.close,
          }),
    ],
  })

  const question =
    turn === undefined
      ? [
          Text({
            dimColor: true,
            children: ['Ask Fylgja a side question. It never reaches the main conversation.'],
          }),
        ]
      : [
          Text({
            children: [Text({ dimColor: true, children: ['Q  '] }), Text({ bold: true, children: [turn.question] })],
          }),
          turn.earlier === undefined
            ? null
            : Text({
                dimColor: true,
                children: [`   follows: ${turn.earlier.question}`],
              }),
        ]

  const buttons = Box({
    flexDirection: 'row',
    columnGap: 2,
    flexWrap: 'wrap',
    children: [
      hasRecords
        ? Button({
            key: 'hand',
            label: 'Hand to Claude',
            onPress: () => actions.hand(turn),
          })
        : null,
      isDone && !turn.isWide && (turn.sources.length > 0 || turn.outcome?.kind === 'no-hits')
        ? Button({
            key: 'widen',
            label: 'Widen (one more search)',
            plain: true,
            onPress: () => actions.widen(turn),
          })
        : null,
      follows
        ? Button({
            key: 'fresh',
            label: 'New thread',
            plain: true,
            onPress: actions.fresh,
          })
        : null,
    ],
  })

  const field =
    'Input' in kit
      ? kit.Input({
          key: 'ask',
          label: follows ? 'Follow up' : 'Ask',
          placeholder: follows ? 'a question that follows this one' : 'a new question',
          value: asides.draft,
          submitLabel: 'ask',
          onInput: value => actions.draft(value),
          onSubmit: value => actions.ask(value),
        })
      : Text({ dimColor: true, children: ['Ask with /aside <question>.'] })

  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [
      Box({ flexDirection: 'column', children: [head, ...question] }),
      ...(turn === undefined ? [] : [...bodyOf(kit, turn), ...sourcesOf(kit, turn, actions)]),
      buttons,
      asides.notice === undefined ? null : Text({ color: 'warning', children: [asides.notice] }),
      field,
    ],
  })
}
