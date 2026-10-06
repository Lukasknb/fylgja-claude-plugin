import type { RenderElement } from 'claude-code'

import type { Fact } from './facts'
import { glyphOf } from './glyphs'
import { clip, widthOf } from './kit'
import type { Kit } from './kit'
import type { Ref } from './refs'

/** No card is wider than this, borders included. */
const CARD_WIDTH = 48
/** No chip shows more of a title than this. */
const MAX_LABEL = 30
/** The cells between two chips. */
const GAP = 2

/** What a chip says: the record's own title once Fylgja confirmed it, its kind until then. */
function labelOf(ref: Ref, fact: Fact | undefined): string {
  const kind = fact?.state === 'found' ? fact.kind : (ref.kind ?? 'record')
  const glyph = glyphOf(kind)

  if (fact?.state === 'found') {
    return `${glyph} ${clip(fact.title, MAX_LABEL)}`
  }

  return fact?.state === 'missing' ? `${glyph} ${kind} - not found` : `${glyph} ${kind}`
}

/** A path from the top of the project tree in `max` cells, its start dropped first: the end says most. */
function pathIn(path: readonly string[], max: number): string {
  const whole = path.join(' > ')
  const chars = Array.from(whole)

  return chars.length <= max ? whole : `…${chars.slice(chars.length - max + 1).join('')}`
}

function counted(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? '' : 's'}`
}

/** The lines of a record's card, each a text and whether it is drawn dim or bold. */
function cardLines(fact: Fact, kind: string, inner: number): { text: string; style: 'dim' | 'bold' | 'plain' }[] {
  if (fact.state === 'missing') {
    return [
      { text: `${glyphOf(kind)} ${kind}`, style: 'dim' },
      { text: clip('Not found, or not yours to read.', inner), style: 'plain' },
    ]
  }

  const counts = [
    fact.decisions === null ? null : counted(fact.decisions, 'decision'),
    fact.commitments === null ? null : counted(fact.commitments, 'commitment'),
  ].filter(part => part !== null)

  return [
    { text: clip([`${glyphOf(fact.kind)} ${fact.kind}`, fact.date].filter(part => part !== null).join(' · '), inner), style: 'dim' as const },
    { text: clip(fact.title, inner), style: 'bold' as const },
    ...(fact.path.length === 0 ? [] : [{ text: pathIn(fact.path, inner), style: 'plain' as const }]),
    ...(counts.length === 0 ? [] : [{ text: clip(counts.join(' · '), inner), style: 'plain' as const }]),
    { text: clip('click to peek', inner), style: 'dim' as const },
  ]
}

/**
 * The card a chip shows under the pointer. It is part of the drawing from
 * the start, drawn hidden, and the surface reveals it while the pointer is
 * over the chip: no hook runs and nothing is fetched on hover.
 *
 * It sits just above the chip and is placed by the chip's own edge: by the
 * left one, or by the right one when it would run past the row's end. Every
 * line is filled to the card's width so nothing beneath shows through.
 */
function card(kit: Kit, fact: Fact, kind: string, at: number, chipWidth: number, columns: number): RenderElement {
  const { Box, Text } = kit
  const width = Math.max(16, Math.min(CARD_WIDTH, columns))
  const inner = width - 4
  const isRoomRight = at + width <= columns
  const side = isRoomRight ? { left: 0 } : at + chipWidth >= width ? { right: 0 } : { left: -at }

  return Box({
    position: 'absolute',
    bottom: 1,
    ...side,
    width,
    display: 'none',
    hover: { display: 'flex' },
    flexDirection: 'column',
    borderStyle: 'round',
    borderColor: 'suggestion',
    paddingX: 1,
    children: cardLines(fact, kind, inner).map(line =>
      Text({
        wrap: 'truncate-end',
        dimColor: line.style === 'dim',
        bold: line.style === 'bold',
        children: [line.text.padEnd(line.text.length + inner - widthOf(line.text), ' ')],
      }),
    ),
  })
}

/**
 * One line of chips, one per record a row names: a press opens the record
 * in the peek pane, and a chip whose record Fylgja has answered for shows
 * its card under the pointer.
 *
 * Chips that do not fit the row are counted at its end instead of wrapping,
 * which keeps every chip's place known and so every card on screen.
 *
 * @param columns the cells the line may take
 * @param onPeek what a press on a chip does
 */
export function chipsLine(
  kit: Kit,
  refs: readonly Ref[],
  facts: ReadonlyMap<string, Fact>,
  columns: number,
  onPeek: (ref: Ref) => void,
): RenderElement {
  const { Box, Text, Button } = kit
  const chips: RenderElement[] = []
  let at = 0

  for (const ref of refs) {
    const fact = facts.get(ref.id)
    const label = labelOf(ref, fact)
    const width = widthOf(label)

    // Room is kept for the count of what is left out.
    if (chips.length > 0 && at + width > columns - 6) {
      break
    }

    chips.push(
      // The key makes this Box the hover scope its card belongs to.
      Box({
        key: `chip:${ref.id}`,
        flexShrink: 0,
        children: [
          Button({ key: `peek:${ref.id}`, plain: true, dimColor: true, label, onPress: () => onPeek(ref) }),
          ...(fact === undefined ? [] : [card(kit, fact, fact.state === 'found' ? fact.kind : (ref.kind ?? 'record'), at, width, columns)]),
        ],
      }),
    )
    at += width + GAP
  }

  const left = refs.length - chips.length

  return Box({
    flexDirection: 'row',
    columnGap: GAP,
    children: [...chips, ...(left > 0 ? [Text({ dimColor: true, children: [`+${left}`] })] : [])],
  })
}
