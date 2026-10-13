import type { RenderElement } from 'claude-code'

import { ACCENT, FILLED, partOf } from './card'
import type { Acts, Table } from './card'
import { RUNE } from './companion'
import type { Action, Line, View } from './listing'
import { ARMED_NOTE } from './scribe/view'

/**
 * Fylgja's window, drawn into the pane Claude Code frames, places and
 * closes: a title bar of the plugin's own with a rule under it, the field
 * of a view that has one, the rows, and a dim line saying which keys there
 * are. It is one window with a view at a time, what Scribe kept or what a
 * search found, and every view is drawn here, from its description.
 *
 * The title bar says whether the window has the keys, as a window's does:
 * Fylgja's name is filled while it has them and dim while it has not. The
 * selected row has a mark in front and is the one at full strength. Nothing
 * depends on colour alone: the name is filled by inverting it, a removed
 * row says that it is, and a key that waits for its second press is filled
 * where it stands, as a card's is, with the card's own line above the keys
 * saying what the second press does. The window's close mark is the one Claude Code
 * draws on the frame; a second one is not drawn under it.
 *
 * Only the look is decided here. Which rows and keys there are is the
 * view's, and what a key does is its owner's.
 */

/** The pane the window is drawn in, as Claude Code knows it. */
export const PANE = 'fylgja-kept'

/** The views the window has: what Scribe kept in the session, and what a search of Fylgja found. */
export type Which = 'kept' | 'search'

/** The window's title where Claude Code shows one: on its tab, while several panes are open. */
export const TITLES: Readonly<Record<Which, string>> = { kept: 'Fylgja · kept', search: 'Fylgja · search' }

/** What the debug log holds, once a session, when the window's focus ring could not be moved at all. */
export const RINGLESS = 'Fylgja: the focus ring of its window could not be moved here'

/**
 * The filled label in front of what a card says while one of its keys waits
 * for its second press: the key that presses it again. A card names a digit
 * there; the window has none, and its keys are pressed with Enter.
 */
export const ARMED_KEY = ' press enter '

/** The mark in front of the selected row, and what stands there on every other. */
const POINTER = '▸ '
const NO_POINTER = '  '

/** The address of a record's row: what is pressed to bring up its keys, and what the focus ring lands on. */
export function rowKey(id: string): string {
  return `row:${id}`
}

/**
 * A key of a record. One that waits for its second press is drawn where it
 * stood, with the words it had, filled as the armed key of a card is: the
 * same cells, so no key beside it moves.
 */
function actionOf(t: Table, action: Action, act: Acts): RenderElement {
  return t.Button({
    key: action.key,
    label: action.label,
    ...(action.isArmed === true ? { children: [t.Text({ ...FILLED, children: [action.label] })] } : {}),
    onPress: () => act.press(action.key),
  })
}

/**
 * A view's own field, above its rows. It is always there to be typed into
 * once the ring is in it, and it takes the ring as the window takes the keys
 * only while the view says it holds it: Enter is then the field's, and what
 * is typed goes nowhere else.
 */
function fieldOf(t: Table, field: NonNullable<View['field']>, act: Acts): RenderElement {
  return t.Input({
    key: field.key,
    label: field.label,
    value: field.value,
    placeholder: field.placeholder,
    submitLabel: field.submitLabel,
    ...(field.isHeld ? { autoFocus: true as const } : {}),
    onSubmit: value => act.submit(field.key, value),
  })
}

/** One record: its row, which is one key, and under the selected one what it holds and what can be done with it. */
function lineOf(t: Table, line: Line, act: Acts): RenderElement[] {
  const row = t.Button({
    key: rowKey(line.id),
    plain: true,
    ...(line.isSelected && !line.isDim ? {} : { dimColor: true }),
    onPress: () => act.press(rowKey(line.id)),
    children: [
      line.isSelected ? t.Text({ color: ACCENT, bold: true, children: [POINTER] }) : NO_POINTER,
      t.Text({ bold: line.isSelected, children: [`${line.kind} · `] }),
      line.sentence,
      ...(line.tail === '' ? [] : [t.Text({ dimColor: true, children: [` · ${line.tail}`] })]),
    ],
  })
  const trouble = line.trouble === undefined ? [] : [t.Text({ color: 'error', wrap: 'wrap', children: [`! ${line.trouble}`] })]

  if (!line.isSelected) {
    return trouble.length === 0 ? [row] : [row, t.Box({ flexDirection: 'column', paddingLeft: 4, children: trouble })]
  }

  const { field, link } = line
  const keys = [
    ...line.actions.map(action => actionOf(t, action, act)),
    // The record's page is a link, opened as the terminal opens any link: no key of the window goes anywhere.
    ...(link === undefined ? [] : [t.Text({ children: [t.Link({ href: link.href, label: link.label })] })]),
  ]

  return [
    row,
    t.Box({
      flexDirection: 'column',
      paddingLeft: 4,
      children: [
        ...line.detail.map(parts => t.Text({ wrap: 'wrap', children: parts.map(part => partOf(t, part, false)) })),
        ...trouble,
        ...(line.waiting === undefined ? [] : [t.Text({ dimColor: true, italic: true, children: [line.waiting] })]),
        ...(field === undefined
          ? []
          : [
              t.Input({
                key: field.key,
                label: field.label,
                value: field.value,
                placeholder: field.placeholder,
                submitLabel: field.submitLabel,
                // The person pressed the key that opens the field; typing goes there.
                autoFocus: true,
                onSubmit: value => act.submit(field.key, value),
              }),
            ]),
        // What the second press does, on a line of its own above the keys, which stay as they were.
        ...(line.actions.some(action => action.isArmed === true)
          ? [
              t.Box({
                flexDirection: 'row',
                flexWrap: 'wrap',
                columnGap: 1,
                children: [t.Text({ ...FILLED, children: [ARMED_KEY] }), t.Text({ wrap: 'wrap', children: [ARMED_NOTE] })],
              }),
            ]
          : []),
        ...(keys.length === 0 ? [] : [t.Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children: keys })]),
      ],
    }),
  ]
}

/**
 * The window for `shown`, drawn into `columns` cells.
 *
 * @param columns the width the pane has for a tree, as the surface reports it
 * @param isFocused whether the window has the keys
 */
export function windowOf(t: Table, shown: View, columns: number, isFocused: boolean, act: Acts): RenderElement {
  const bar = t.Box({
    flexDirection: 'row',
    justifyContent: 'space-between',
    children: [
      t.Box({
        flexDirection: 'row',
        columnGap: 1,
        children: [
          isFocused
            ? t.Text({ color: ACCENT, bold: true, inverse: true, children: [` ${RUNE} fylgja `] })
            : t.Text({ dimColor: true, bold: true, children: [`${RUNE} fylgja`] }),
          t.Text({ italic: true, ...(isFocused ? {} : { dimColor: true }), children: [shown.name] }),
        ],
      }),
      t.Text({ dimColor: true, children: [shown.count] }),
    ],
  })

  return t.Box({
    flexDirection: 'column',
    width: columns,
    children: [
      bar,
      ...(shown.hasRule ? [t.Text({ dimColor: true, wrap: 'truncate-end', children: ['─'.repeat(Math.max(1, columns))] })] : []),
      ...(shown.field === undefined ? [] : [fieldOf(t, shown.field, act)]),
      ...(shown.quiet === undefined ? [] : [t.Text({ dimColor: true, wrap: 'wrap', children: [shown.quiet] })]),
      ...(shown.action === undefined ? [] : [t.Box({ flexDirection: 'row', children: [actionOf(t, shown.action, act)] })]),
      ...shown.lines.flatMap(line => lineOf(t, line, act)),
      ...(shown.closing === undefined ? [] : [t.Text({ dimColor: true, wrap: 'wrap', children: [shown.closing] })]),
      t.Text({ dimColor: true, italic: true, wrap: 'wrap', children: [shown.legend] }),
    ],
  })
}
