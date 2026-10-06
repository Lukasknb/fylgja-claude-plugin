import { describe, expect, test } from 'claude-code/testing'

import {
  hit,
  hits,
  idOf,
  linesOf,
  NEEDS_SIGN_IN,
  PANE,
  paneProps,
  pick,
  PRICING,
  RETRO,
  scene,
  SESSION,
  SURFACES,
  token,
} from './fixtures'

const FOUND = [
  hit('session', 'Retro tooling', idOf(13)),
  hit('atom', 'A fact', idOf(11)),
  hit('meeting', 'Retro planning', idOf(10)),
]

describe('/pick', () => {
  test('is a command the session offers, and registering it asks Fylgja nothing', async ($, on) => {
    const started = scene(on)

    expect(await $.session.start(SESSION)).toEqual({ cwd: '/work/repo' })
    await started.clock.advance(60_000)

    expect(started.commands).toEqual([
      {
        name: 'pick',
        description: 'Find a Fylgja meeting, session, note or project and put its reference in the prompt',
        argumentHint: '[part of a title]',
      },
    ])
    expect([started.calls, started.reads(), started.panes, started.forbidden]).toEqual([[], 0, [], []])
  })

  for (const surface of SURFACES) {
    test(`on ${surface}: alone it opens a pane with a field and the most recent meetings`, async ($, on) => {
      const started = scene(on)

      expect(await pick($)).toEqual({})
      await started.clock.settle()

      const ui = await $.ui.mount({ ...PANE, surface, props: paneProps() })

      expect(started.panes).toEqual(['open fylgja-pick focused escapable'])
      expect((await ui.find({ type: 'Input' }))?.props).toMatchObject({
        key: 'query',
        value: '',
        autoFocus: true,
      })
      expect(await linesOf(ui)).toEqual([
        '1: ◉ Engineering Retrospective 2026-10-05',
        '2: ◉ Pricing sync 2026-10-02',
        '3: ◉ Standup 2026-10-01',
      ])
      expect(started.searched()).toEqual([])
    })

    test(`on ${surface}: with a query it searches at once, and a row puts the reference at the cursor`, async ($, on) => {
      const started = scene(on, { search: query => hits(FOUND, query) })

      started.box.text = 'ask about  please'
      started.box.cursor = 10
      await pick($, 'retro')
      await started.clock.settle()

      const ui = await $.ui.mount({ ...PANE, surface, props: paneProps() })

      expect(started.searched(), 'typed and entered: there is no more typing to wait for').toEqual(['retro'])
      expect((await ui.find({ type: 'Input' }))?.props.value).toBe('retro')
      expect(await linesOf(ui)).toEqual(['1: ⌁ Retro tooling 2026-09-30', '2: ◉ Retro planning 2026-09-30'])

      await ui.press({ key: 'pick-2' })

      const reference = token('meeting', 'Retro planning', idOf(10))

      expect(started.fills.map(fill => [fill.text, fill.mode])).toEqual([[`${reference} `, 'insert']])
      expect(started.fills[0]?.decorations).toEqual([
        { start: 0, end: 9, dimColor: true },
        { start: 9, end: reference.indexOf('|'), bold: true },
        {
          start: reference.indexOf('|'),
          end: reference.length,
          dimColor: true,
        },
      ])
      expect(started.box.text, 'what was typed stays on either side').toBe(`ask about ${reference}  please`)
      expect(started.panes.at(-1)).toBe('close fylgja-pick')
    })
  }

  test('typing in the field searches only once the typing has paused', async ($, on) => {
    const started = scene(on, { search: query => hits(FOUND, query) })

    await pick($)
    await started.clock.settle()

    const ui = await $.ui.mount({
      ...PANE,
      surface: 'terminal',
      props: paneProps(),
    })

    await ui.input({ key: 'query', text: 'p', kind: 'change' })
    await started.clock.advance(60_000)

    expect(started.searched(), 'one letter narrows the recent meetings').toEqual([])
    expect(await linesOf(ui)).toEqual([
      '1: ◉ Engineering Retrospective 2026-10-05',
      '2: ◉ Pricing sync 2026-10-02',
      '3: ◉ Standup 2026-10-01',
    ])

    await ui.input({ key: 'query', text: 'pr', kind: 'change' })
    await started.clock.advance(300)
    await ui.input({ key: 'query', text: 'pri', kind: 'change' })
    await started.clock.advance(399)

    expect(started.searched()).toEqual([])
    expect((await ui.find({ type: 'Input' }))?.props.value, 'the field keeps what was typed').toBe('pri')
    expect(await linesOf(ui), 'unnumbered while the answer is on its way').toEqual(['◉ Pricing sync 2026-10-02'])

    await started.clock.advance(1)

    expect(started.searched()).toEqual(['pri'])
  })

  test('Enter in the field searches now, and once the answer is there chooses the first record', async ($, on) => {
    const started = scene(on, { search: query => hits(FOUND, query) })

    await pick($)
    await started.clock.settle()

    const ui = await $.ui.mount({
      ...PANE,
      surface: 'terminal',
      props: paneProps(),
    })

    await ui.input({ key: 'query', text: 'retro', kind: 'change' })
    await ui.input({ key: 'query', text: 'retro' })
    await started.clock.settle()

    expect(started.searched(), 'not waited for').toEqual(['retro'])
    expect(started.fills).toEqual([])

    await ui.input({ key: 'query', text: 'retro' })

    expect(started.fills.map(fill => fill.text)).toEqual([`${token('session', 'Retro tooling', idOf(13))} `])
    expect(started.panes.at(-1)).toBe('close fylgja-pick')
  })

  test('Enter on an empty field chooses the most recent meeting', async ($, on) => {
    const started = scene(on)

    await pick($)
    await started.clock.settle()

    const ui = await $.ui.mount({
      ...PANE,
      surface: 'terminal',
      props: paneProps(),
    })

    await ui.input({ key: 'query', text: '' })

    expect(started.fills.map(fill => fill.text)).toEqual([`${token('meeting', RETRO.title, RETRO.id)} `])
  })

  test('signed out, the pane says so in one line and offers nothing to choose', async ($, on) => {
    const started = scene(on, { connect: () => NEEDS_SIGN_IN })

    await pick($, 'retro')
    await started.clock.advance(60_000)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface, props: paneProps() })

      expect(await ui.find({ text: 'Fylgja: sign in with /mcp' })).toBeDefined()
      expect(await ui.findAll({ type: 'Button' })).toEqual([])
      await ui.unmount()
    }

    expect(started.calls).toEqual([])
  })

  test('a prompt box that refuses the write keeps the pane open and says so', async ($, on) => {
    const started = scene(on, { isFilled: false })

    await pick($)
    await started.clock.settle()

    const ui = await $.ui.mount({
      ...PANE,
      surface: 'terminal',
      props: paneProps(),
    })

    await ui.press({ key: 'pick-2' })

    expect(started.fills.map(fill => fill.text)).toEqual([`${token('meeting', PRICING.title, PRICING.id)} `])
    expect(await ui.find({ text: 'the prompt box did not take it; try again' })).toBeDefined()
    expect(started.panes).toEqual(['open fylgja-pick focused escapable'])
  })

  test('where no pane can be placed, the command says so and asks Fylgja nothing', async ($, on) => {
    const started = scene(on, { isPlaced: false })

    expect(await pick($, 'retro')).toEqual({
      text: 'Fylgja: there is no room for the picker here.',
    })
    await started.clock.advance(60_000)

    expect(started.calls).toEqual([])
  })

  test('a phone, which draws no fields, gets the list without one', async ($, on) => {
    const started = scene(on)

    await pick($)
    await started.clock.settle()

    const ui = await $.ui.mount({
      ...PANE,
      surface: 'mobile',
      props: paneProps(40),
    })

    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    expect((await linesOf(ui)).length).toBe(3)
  })
})
