import type { RenderElement } from 'claude-code'

import { ACCENT, FILLED, partOf } from './card'
import type { Acts, Table } from './card'
import { RUNE } from './companion'
import { ARMED_NOTE } from './scribe/ledger'
import type { Action, Line, View } from './scribe/ledger'

/**
 * The window of what Scribe kept, drawn into the pane Claude Code frames,
 * places and closes: a title bar of the plugin's own with a rule under it,
 * the rows, and a dim line saying which keys there are.
 *
 * The title bar says whether the window has the keys, as a window's does:
 * Fylgja's name is filled while it has them and dim while it has not. The
 * selected row has a mark in front and is the one at full strength. Nothing
 * depends on colour alone: the name is filled by inverting it, a removed
 * row says that it is, and a key that waits for its second press is filled
 * where it stands, as a card's is, with a line above the keys saying what
 * the second press does. The window's close mark is the one Claude Code
 * draws on the frame; a second one is not drawn under it.
 *
 * Only the look is decided here. Which rows and keys there are is the
 * ledger's, and what a key does is Scribe's.
 */

/** The pane the window is drawn in, as Claude Code knows it. */
export const PANE = 'fylgja-kept'

/** The window's title where Claude Code shows one: on its tab, while several panes are open. */
export const TITLE = 'Fylgja · kept'

/** What the debug log holds, once a session, when the window's focus ring could not be moved at all. */
export const RINGLESS = 'Fylgja: the focus ring of the window of what was kept could not be moved here'

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

/** One record: its row, which is one key, and under the selected one what it holds and what can be done with it. */
function lineOf(t: Table, line: Line, act: Acts): RenderElement[] {
  const row = t.Button({
    key: rowKey(line.id),
    plain: true,
    ...(line.isSelected && !line.isGone ? {} : { dimColor: true }),
    onPress: () => act.press(rowKey(line.id)),
    children: [
      line.isSelected ? t.Text({ color: ACCENT, bold: true, children: [POINTER] }) : NO_POINTER,
      t.Text({ bold: line.isSelected, children: [`${line.kind} · `] }),
      line.sentence,
      ...(line.outcome === '' ? [] : [t.Text({ dimColor: true, children: [` · ${line.outcome}`] })]),
    ],
  })
  const trouble = line.trouble === undefined ? [] : [t.Text({ color: 'error', wrap: 'wrap', children: [`! ${line.trouble}`] })]

  if (!line.isSelected) {
    return trouble.length === 0 ? [row] : [row, t.Box({ flexDirection: 'column', paddingLeft: 4, children: trouble })]
  }

  const { field } = line
  const keys = line.actions.map(action => actionOf(t, action, act))

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
        ...(line.actions.some(action => action.isArmed === true) ? [t.Text({ color: ACCENT, wrap: 'wrap', children: [ARMED_NOTE] })] : []),
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
export function ledgerOf(t: Table, shown: View, columns: number, isFocused: boolean, act: Acts): RenderElement {
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
          t.Text({ italic: true, ...(isFocused ? {} : { dimColor: true }), children: ['kept in this session'] }),
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
      ...(shown.quiet === undefined ? [] : [t.Text({ dimColor: true, wrap: 'wrap', children: [shown.quiet] })]),
      ...shown.lines.flatMap(line => lineOf(t, line, act)),
      t.Text({ dimColor: true, italic: true, wrap: 'wrap', children: [shown.legend] }),
    ],
  })
}
