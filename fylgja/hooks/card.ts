import type { Elements, RenderElement } from 'claude-code'

import { RUNE } from './companion'
import { ARMED_NOTE, armedIn } from './scribe/view'
import type { Key, Part, Row, View } from './scribe/view'

/**
 * The card above the prompt: what the band shows, drawn as one framed card
 * in one of two registers that can be told apart without reading.
 *
 * A card that asks is waiting for the person: a heavy frame in Fylgja's
 * amber, its name on a filled label, and a line that says what happens if
 * they do nothing. A card that tells is not waiting: a thin dim frame, a dim
 * name, every key dim, and a line that says how it leaves. A key that was
 * pressed once and waits for its second press makes any card one that asks.
 *
 * Nothing here depends on colour alone. The two frames are different lines,
 * the label is filled by inverting it, and both say in words which they
 * are, so a terminal without colour shows the same two registers.
 *
 * Only the look is decided here. Which keys there are, what they do and
 * when a card comes up is the band's, unchanged.
 */

/**
 * Fylgja's amber, as the person's theme has it: the theme's own amber, so
 * it is read on a light ground as on a dark one. The app's amber is made
 * for a dark ground only.
 */
export const ACCENT = 'warning'

/** A card is never wider than this, however wide the band is. */
export const MAX_CARD = 96

/** Below this width a frame costs more than it gives: the card is drawn without one. */
export const MIN_FRAMED = 44

export type Table = Pick<Elements['terminal'], 'Box' | 'Button' | 'Input' | 'Link' | 'Text'>

/** What the card's controls do: each only notes what was pressed or entered. */
export type Acts = {
  press: (key: string) => void
  submit: (key: string, value: string) => void
}

type Style = { color?: string; dimColor?: boolean; bold?: boolean; italic?: boolean }

function styleOf(part: Part, isAsking: boolean): Style {
  if ('link' in part) {
    return {}
  }

  switch (part.tone) {
    case 'dim':
      return { dimColor: true }
    case 'strong':
      return { bold: true }
    case 'good':
      return { color: 'success' }
    case 'mark':
      return isAsking ? { color: ACCENT, bold: true } : { color: 'success' }
    default:
      return {}
  }
}

/**
 * A record's words with what stands between backticks set apart: the
 * backticks stay, so it is told apart without colour too.
 */
function spans(t: Table, text: string): (RenderElement | string)[] {
  return text
    .split(/(`[^`]+`)/)
    .filter(piece => piece !== '')
    .map(piece => (piece.startsWith('`') && piece.length > 2 ? t.Text({ color: 'suggestion', children: [piece] }) : piece))
}

export function partOf(t: Table, part: Part, isAsking: boolean): RenderElement {
  if ('link' in part) {
    return t.Link({ href: part.link, label: part.label })
  }

  return t.Text({ ...styleOf(part, isAsking), children: part.tone === undefined ? spans(t, part.text) : [part.text] })
}

function keysOf(t: Table, keys: readonly Key[], isAsking: boolean, act: Acts): RenderElement[] {
  return keys.map(key =>
    t.Button({
      key: key.key,
      label: key.label,
      hotkey: key.hotkey,
      plain: true,
      // In a card that only tells, every key is an offer; in one that asks, the keys that put it away are the lesser ones.
      ...((!isAsking || key.tone === 'quiet') && key.isArmed !== true ? { dimColor: true } : {}),
      onPress: () => act.press(key.key),
    }),
  )
}

/**
 * One row of the card. A row that opens with a mark hangs from it: the mark
 * stands in a gutter and the words wrap beside it, never under it. In a
 * card with such a row, every other row keeps the gutter clear.
 */
function rowOf(t: Table, row: Row, hasGutter: boolean, isAsking: boolean, act: Acts): RenderElement {
  const { field } = row

  if (field !== undefined) {
    return t.Input({
      key: field.key,
      label: field.label,
      value: field.value,
      placeholder: field.placeholder,
      submitLabel: field.submitLabel,
      // The person pressed the key that opens the field; typing goes there.
      autoFocus: true,
      onSubmit: value => act.submit(field.key, value),
    })
  }

  const [first, ...rest] = row.parts
  const hangs = first !== undefined && 'tone' in first && first.tone === 'mark'
  const words = hangs ? rest : row.parts
  const keys = keysOf(t, row.keys ?? [], isAsking, act)
  const body = t.Box({
    flexDirection: 'column',
    flexGrow: 1,
    flexShrink: 1,
    children: [
      t.Text({ wrap: 'wrap', children: words.map(part => partOf(t, part, isAsking)) }),
      ...(keys.length === 0 ? [] : [t.Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children: keys })]),
    ],
  })

  if (!hasGutter) {
    return body
  }

  return t.Box({
    flexDirection: 'row',
    children: [hangs && first !== undefined ? partOf(t, first, isAsking) : t.Text({ children: ['  '] }), body],
  })
}

/**
 * The card for `shown`, drawn into `columns` cells.
 *
 * @param columns the width the band has for a tree, as the surface reports it
 */
export function cardOf(t: Table, shown: View, columns: number, act: Acts): RenderElement {
  const armed = armedIn(shown)
  const isAsking = shown.register === 'asks' || armed !== undefined
  const hasGutter = shown.rows.some(row => {
    const [first] = row.parts

    return first !== undefined && 'tone' in first && first.tone === 'mark'
  })
  const title = t.Box({
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 1,
    children: [
      isAsking
        ? t.Text({ color: ACCENT, bold: true, inverse: true, children: [` ${RUNE} fylgja asks `] })
        : t.Text({ dimColor: true, bold: true, children: [`${RUNE} fylgja`] }),
      t.Text({ italic: true, ...(isAsking ? {} : { dimColor: true }), children: [shown.head] }),
    ],
  })
  // What happens next, in words: the second press that is waited for, or what doing nothing comes to.
  const note =
    armed !== undefined
      ? t.Box({
          flexDirection: 'row',
          flexWrap: 'wrap',
          columnGap: 1,
          children: [
            t.Text({ color: ACCENT, bold: true, inverse: true, children: [` press ${armed.hotkey} `] }),
            t.Text({ wrap: 'wrap', children: [ARMED_NOTE] }),
          ],
        })
      : shown.note === undefined
        ? undefined
        : t.Text({ italic: true, dimColor: true, wrap: 'wrap', children: [shown.note] })
  const keys = keysOf(t, shown.keys, isAsking, act)
  const isFramed = columns >= MIN_FRAMED

  return t.Box({
    flexDirection: 'column',
    ...(isFramed
      ? {
          width: Math.min(columns, MAX_CARD),
          borderStyle: isAsking ? 'bold' : 'round',
          paddingX: 1,
          ...(isAsking ? { borderColor: ACCENT } : { borderDimColor: true }),
        }
      : {}),
    children: [
      title,
      ...shown.rows.map(row => rowOf(t, row, hasGutter, isAsking, act)),
      ...(note === undefined ? [] : [note]),
      ...(keys.length === 0 ? [] : [t.Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children: keys })]),
    ],
  })
}
