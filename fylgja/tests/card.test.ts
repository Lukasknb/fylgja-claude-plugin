import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ACCENT, MAX_CARD, MIN_FRAMED } from '../hooks/card'
import { ARMED_NOTE, NOTES } from '../hooks/scribe/view'
import { ACCOUNT, answer, idOf } from './fixtures'
import { band, claude, decision, dev, edit, fact, press, stage, START, turn, verdict } from './scribe-fixtures'

const FILE = 'src/queue/lock.ts'
const WORK = [dev('lock the retry queue with redis'), claude('Done.', edit(FILE))]
const RECORDING = verdict({ records: [decision({ content: 'Use `pg_advisory_lock` for the retry queue, not Redis.' })] })
const ASKING = verdict({
  records: [decision({ detail: '', reason_status: 'not_stated', anchors: [] })],
  question: { form: 'reason', record: 0, options: ['One less service to run', 'Redis was flaky in CI'] },
})
const TOLD = { recall: () => answer({ facts: [fact(1, { anchors: { paths: [{ path: FILE }] } })] }) }
const OTHER_ID = '99999999-0000-4000-8000-000000000009'

type Node = { type: string; props: Record<string, unknown>; children?: (Node | string)[] }

/** The band as the plugin draws it into `columns` cells, as a tree. */
async function card($: Engine, columns = 100, surface: 'terminal' | 'desktop' = 'terminal'): Promise<Node> {
  const ui = await $.ui.mount({
    plugin: 'fylgja',
    component: 'AbovePrompt',
    surface,
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: columns, scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as never)
  const tree = whole((await ui.drawn()) as unknown as Node)

  await ui.unmount()

  return tree
}

/** `node` with props on every element: one drawn with none has none at all. */
function whole(node: Node): Node {
  return {
    type: node.type,
    props: node.props ?? {},
    children: (node.children ?? []).map(child => (typeof child === 'string' ? child : whole(child))),
  }
}

/** Every element of `tree` of one type, in the order it is drawn. */
function all(tree: Node, type: string): Node[] {
  const below = (tree.children ?? []).flatMap(child => (typeof child === 'string' ? [] : all(child, type)))

  return tree.type === type ? [tree, ...below] : below
}

/** The words of one element, with those of everything in it. */
function wordsOf(node: Node | string): string {
  return typeof node === 'string' ? node : (node.children ?? []).map(wordsOf).join('')
}

/**
 * The frame, without what a colour alone would say: what a terminal with no colour still shows.
 *
 * A text's heaviness is read as Claude Code reads it, `bold` as a semibold `weight` that an explicit
 * `weight` outranks, so a surface that spells it either way, or both, draws the same text.
 */
function uncoloured(tree: Node): string {
  const strip = (node: Node | string): unknown => {
    if (typeof node === 'string') {
      return node
    }

    const { color, borderColor, dimColor, borderDimColor, backgroundColor, onPress, onSubmit, bold, weight, ...props } =
      node.props
    const heaviness = weight ?? (bold === true ? 'semibold' : undefined)

    void [color, borderColor, dimColor, borderDimColor, backgroundColor, onPress, onSubmit]

    return {
      type: node.type,
      props: heaviness === undefined ? props : { ...props, weight: heaviness },
      children: (node.children ?? []).map(strip),
    }
  }

  return JSON.stringify(strip(tree))
}

describe('a card that tells', () => {
  test('a receipt is a thin dim frame with a dim name, says how it leaves, and every key in it is dim', async ($, on) => {
    const set = stage(on, { replies: [RECORDING] })

    await $.session.start(START)
    await turn($, set, ...WORK)

    const tree = await card($)
    const [title] = tree.children ?? []

    expect(tree.props).toMatchObject({ borderStyle: 'round', borderDimColor: true, paddingX: 1, width: MAX_CARD })
    expect(tree.props.borderColor, 'no colour of its own on the frame').toBeUndefined()
    expect(all(title as Node, 'Text').map(text => [wordsOf(text), text.props])).toEqual([
      ['ᚠ fylgja', { dimColor: true, bold: true }],
      ['wrote this down', { italic: true, dimColor: true }],
    ])
    expect(all(tree, 'Text').some(text => text.props.inverse === true), 'nothing in it is filled').toBe(false)
    expect(all(tree, 'Text').find(text => wordsOf(text) === NOTES.receipt)?.props).toEqual({
      italic: true,
      dimColor: true,
      wrap: 'wrap',
    })
    expect(all(tree, 'Button').map(key => [key.props.hotkey, key.props.label, key.props.dimColor, key.props.plain])).toEqual([
      ['1', 'Fix', true, true],
      ['2', 'Remove', true, true],
      ['9', 'What is this', true, true],
      ['0', 'OK', true, true],
    ])
  })

  test('its record hangs from its mark, wraps beside it, and what stands in backticks is set apart with the backticks kept', async ($, on) => {
    const set = stage(on, { replies: [RECORDING] })

    await $.session.start(START)
    await turn($, set, ...WORK)

    const tree = await card($)
    const row = (tree.children ?? [])[1] as Node
    const [gutter, body] = row.children as Node[]

    expect(row.props).toEqual({ flexDirection: 'row' })
    expect([wordsOf(gutter as Node), (gutter as Node).props]).toEqual(['✓ ', { color: 'success' }])
    expect((body as Node).props).toEqual({ flexDirection: 'column', flexGrow: 1, flexShrink: 1 })
    expect(all(body as Node, 'Text')[0]?.props).toEqual({ wrap: 'wrap' })
    expect(all(body as Node, 'Text').find(text => wordsOf(text) === '`pg_advisory_lock`')?.props).toEqual({ color: 'suggestion' })
    expect(wordsOf(body as Node)).toBe('Recorded · Use `pg_advisory_lock` for the retry queue, not Redis.')
  })

  test('a tell about an earlier decision is the same calm card, and says it goes with the next prompt', async ($, on) => {
    const set = stage(on, { tools: TOLD })

    await $.session.start(START)
    await turn($, set, ...WORK)

    const tree = await card($)

    expect(tree.props).toMatchObject({ borderStyle: 'round', borderDimColor: true })
    expect(wordsOf((tree.children ?? [])[0] as Node)).toBe('ᚠ fylgjahas a note on this code')
    expect(all(tree, 'Text').some(text => wordsOf(text) === NOTES.told)).toBe(true)
    expect(all(tree, 'Button').every(key => key.props.dimColor === true)).toBe(true)
  })
})

describe('a card that asks', () => {
  test('a question is a heavy frame in the accent, its name filled, and says what doing nothing comes to', async ($, on) => {
    const set = stage(on, { replies: [ASKING] })

    await $.session.start(START)
    await turn($, set, ...WORK)

    const tree = await card($)
    const [title] = tree.children ?? []

    expect(tree.props).toMatchObject({ borderStyle: 'bold', borderColor: ACCENT, paddingX: 1, width: MAX_CARD })
    expect(tree.props.borderDimColor).toBeUndefined()
    expect(all(title as Node, 'Text').map(text => [wordsOf(text), text.props])).toEqual([
      [' ᚠ fylgja asks ', { color: ACCENT, bold: true, inverse: true }],
      ['why was this decided?', { italic: true }],
    ])
    expect(all(tree, 'Text').some(text => wordsOf(text) === NOTES.reason)).toBe(true)
    expect(
      all(tree, 'Button').map(key => [key.props.hotkey, key.props.label, key.props.dimColor === true]),
      'the answers at full strength, what only puts it away dim',
    ).toEqual([
      ['1', 'One less service to run', false],
      ['2', 'Redis was flaky in CI', false],
      ['3', 'Write my own', false],
      ['4', 'No particular reason', false],
      ['9', 'What is this', true],
      ['0', 'Skip', true],
    ])
  })

  test('it is told from a card that tells without any colour: by its frame, its filled name and its words', async ($, on) => {
    const asking = stage(on, { replies: [ASKING] })

    await $.session.start(START)
    await turn($, asking, ...WORK)

    const asks = uncoloured(await card($))

    await press($, 'skip')

    const tells = uncoloured(await card($))

    expect(asks).toMatch('"borderStyle":"bold"')
    expect(asks).toMatch('"inverse":true')
    expect(asks).toMatch('fylgja asks')
    expect(tells).toMatch('"borderStyle":"round"')
    expect(tells).not.toMatch('"inverse":true')
    expect(tells).not.toMatch('asks')
    expect(tells).toMatch('Nothing to do.')
  })

  test('a key pressed once makes a receipt a card that asks: the frame, a filled label with the digit, and what a second press does', async ($, on) => {
    const set = stage(on, { replies: [RECORDING] })

    await $.session.start(START)
    await turn($, set, ...WORK)
    await press($, 'remove:0')

    const tree = await card($)

    expect(tree.props).toMatchObject({ borderStyle: 'bold', borderColor: ACCENT })
    expect(all(tree, 'Text').find(text => wordsOf(text) === ' press 2 ')?.props).toEqual({ color: ACCENT, bold: true, inverse: true })
    expect(all(tree, 'Text').some(text => wordsOf(text) === ARMED_NOTE)).toBe(true)
    expect(all(tree, 'Text').some(text => wordsOf(text) === NOTES.receipt), 'in place of how it leaves').toBe(false)
    expect(all(tree, 'Button').map(key => [key.props.label, key.props.dimColor === true])).toEqual([
      ['Fix', false],
      ['Remove', false],
      ['What is this', true],
      ['OK', true],
    ])
    expect(set.of('amend_memory'), 'and nothing was changed by the one press').toEqual([])

    await set.clock.advance(5000)

    expect((await card($)).props, 'left alone, it is the calm card again').toMatchObject({ borderStyle: 'round', borderDimColor: true })
  })

  test('the account line is one too, and says the plugin stays out until it is answered', async ($, on) => {
    stage(on, { kept: { 'fylgja.account': { user: OTHER_ID, team: OTHER_ID, profile: ACCOUNT.profile.id } } })

    await $.session.start(START)

    const tree = await card($)

    expect(tree.props).toMatchObject({ borderStyle: 'bold', borderColor: ACCENT })
    expect(wordsOf((tree.children ?? [])[0] as Node)).toBe(' ᚠ fylgja asks which account is this?')
    expect(all(tree, 'Text').some(text => /^Until you answer, the plugin stays out/.test(wordsOf(text)))).toBe(true)
    expect(all(tree, 'Button').map(key => [key.props.label, key.props.dimColor === true])).toEqual([
      ['Use this account from now on', false],
      ['Not now', true],
    ])

    await press($, 'account-accept')

    expect(all(await card($), 'Text').some(text => wordsOf(text) === ' press 1 ')).toBe(true)
  })

  test('the field for a fix is one, and takes the keyboard as before', async ($, on) => {
    const set = stage(on, { replies: [RECORDING] })

    await $.session.start(START)
    await turn($, set, ...WORK)
    await press($, 'fix:0')

    const tree = await card($)

    expect(tree.props).toMatchObject({ borderStyle: 'bold', borderColor: ACCENT })
    expect(all(tree, 'Input').map(field => [field.props.key, field.props.autoFocus])).toEqual([['fix-text', true]])
    expect(all(tree, 'Text').some(text => wordsOf(text) === NOTES.field)).toBe(true)
  })
})

/** The keys of a card as a person reads them: the digit and the words, in the order drawn. */
function keysOf(tree: Node): unknown[] {
  return all(tree, 'Button').map(key => [key.props.hotkey, key.props.label])
}

/** The keys of a card that are filled: the digit of each. */
function filledKeys(tree: Node): unknown[] {
  return all(tree, 'Button')
    .filter(key => all(key, 'Text').some(text => text.props.inverse === true))
    .map(key => key.props.hotkey)
}

describe('a key that waits for its second press', () => {
  for (const [name, options, key, hotkey] of [
    ['a question', { replies: [ASKING] }, 'reason:1', '2'],
    ['a receipt', { replies: [RECORDING] }, 'remove:0', '2'],
    ['a tell', { tools: TOLD }, 'knew', '3'],
  ] as const) {
    test(`on ${name}, every key keeps its words and its place, the pressed one is filled, and what a second press does is a line of its own`, async ($, on) => {
      const set = stage(on, options)

      await $.session.start(START)
      await turn($, set, ...WORK)

      const before = await card($)

      await press($, key)

      const during = await card($)
      const lines = during.children as Node[]
      const hint = lines.at(-2) as Node
      const row = lines.at(-1) as Node

      expect(keysOf(during)).toEqual(keysOf(before))
      expect(lines.length, 'as many lines as before').toBe((before.children ?? []).length)
      expect(row.props, 'the row of keys is laid out as it was').toEqual((before.children as Node[]).at(-1)?.props)
      expect(filledKeys(before)).toEqual([])
      expect(filledKeys(during), 'the one that was pressed, and no other').toEqual([hotkey])
      expect(all(all(during, 'Button').find(one => one.props.key === key) as Node, 'Text').map(text => text.props)).toEqual([
        { color: ACCENT, bold: true, inverse: true },
      ])
      expect(wordsOf(hint)).toBe(` press ${hotkey} ${ARMED_NOTE}`)
      expect(all(hint, 'Button'), 'no key stands in that line').toEqual([])
      expect(wordsOf(row), 'and it says nothing among the keys').not.toMatch('again')

      await set.clock.advance(5000)

      expect(JSON.stringify(await card($)), 'left alone, the card is what it was').toBe(JSON.stringify(before))
    })
  }

  test('another key that waits takes the mark and the line with it, and nothing else changes', async ($, on) => {
    const set = stage(on, { replies: [ASKING] })

    await $.session.start(START)
    await turn($, set, ...WORK)

    const before = await card($)

    await press($, 'reason:0')
    await press($, 'no-reason')

    const during = await card($)

    expect(keysOf(during)).toEqual(keysOf(before))
    expect(filledKeys(during)).toEqual(['4'])
    expect(all(during, 'Text').filter(text => /^ press \d $/.test(wordsOf(text))).map(wordsOf)).toEqual([' press 4 '])
    expect(set.of('amend_memory')).toEqual([])
  })

  test('“Write my own” opens the field at once, and Enter saves what was typed, once', async ($, on) => {
    const set = stage(on, { replies: [ASKING] })

    await $.session.start(START)
    await turn($, set, ...WORK)
    await press($, 'reason:0')

    const own = all(await card($), 'Button').find(key => key.props.label === 'Write my own')

    expect(own?.props).toMatchObject({ key: 'other', hotkey: '3' })

    const ui = await band($)

    await ui.press('other')
    await ui.redraw()

    const tree = await card($)

    expect(all(tree, 'Input').map(field => field.props.key)).toEqual(['reason-text'])
    expect(filledKeys(tree), 'the key that waited waits no longer').toEqual([])

    await ui.enter('reason-text', 'Redis kept dropping connections under load')
    await ui.unmount()

    expect(set.of('amend_memory')).toEqual([
      { atom_id: idOf(101), op: 'fix', detail: 'Redis kept dropping connections under load', reason_status: 'stated' },
    ])
    expect(all(await card($), 'Input'), 'and the field is gone').toEqual([])
  })
})

describe('a card in the room it has', () => {
  test('it is as wide as the band and never wider than a card should be', async ($, on) => {
    const set = stage(on, { replies: [RECORDING] })

    await $.session.start(START)
    await turn($, set, ...WORK)

    expect((await card($, 60)).props.width).toBe(60)
    expect((await card($, 100)).props.width).toBe(MAX_CARD)
    expect((await card($, 240)).props.width).toBe(MAX_CARD)
  })

  test('in a narrow band it is drawn without a frame, with everything else it says and every key', async ($, on) => {
    const set = stage(on, { replies: [ASKING] })

    await $.session.start(START)
    await turn($, set, ...WORK)

    const wide = await card($, MIN_FRAMED)
    const narrow = await card($, MIN_FRAMED - 1)

    expect(wide.props.borderStyle).toBe('bold')
    expect(narrow.props).toEqual({ flexDirection: 'column' })
    expect(wordsOf(narrow)).toBe(wordsOf(wide))
    expect(all(narrow, 'Button').map(key => key.props.key)).toEqual(all(wide, 'Button').map(key => key.props.key))
    expect(all(narrow, 'Text').some(text => text.props.inverse === true), 'and still says by its filled name that it asks').toBe(true)
  })

  test('it is drawn the same in the desktop app', async ($, on) => {
    const set = stage(on, { replies: [ASKING] })

    await $.session.start(START)
    await turn($, set, ...WORK)

    expect(uncoloured(await card($, 100, 'desktop'))).toBe(uncoloured(await card($, 100, 'terminal')))
  })

  test('no colour in it is one a theme does not name', async ($, on) => {
    const set = stage(on, { replies: [ASKING, RECORDING] })
    const named = new Set(['warning', 'success', 'suggestion'])
    const colours = (tree: Node): unknown[] =>
      [...all(tree, 'Text'), ...all(tree, 'Box')].flatMap(node => [node.props.color, node.props.borderColor, node.props.backgroundColor])

    await $.session.start(START)
    await turn($, set, ...WORK)

    const asks = colours(await card($))

    await press($, 'skip')

    expect([...asks, ...colours(await card($))].filter(colour => colour !== undefined && !named.has(String(colour)))).toEqual([])
  })
})
