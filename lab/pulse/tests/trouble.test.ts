import { describe, expect, test } from 'claude-code/testing'

import { tokensInForTest } from './token'
import {
  cellsOf,
  CONNECTED,
  fenced,
  idOf,
  json,
  line,
  linesOf,
  listed,
  NEEDS_SIGN_IN,
  pane,
  PLATFORM_LINES,
  platformOutline,
  platformTools,
  pulse,
  rowNames,
  scene,
  timeline,
  UNSEEN,
} from './fixtures'

describe('signed out', () => {
  test('says so in one line in the pane, asks Fylgja nothing, and shows no picture', async ($, on) => {
    const started = scene(on, { connect: () => NEEDS_SIGN_IN, tools: platformTools() })

    await pulse($, started, 'Platform')

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount(pane(surface))

      expect(await ui.find({ text: 'Fylgja needs sign-in: run /mcp, then /pulse again.' }), surface).toBeDefined()
      expect(await ui.find({ type: 'Raster' })).toBeUndefined()
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      await ui.unmount()
    }

    expect(started.calls).toEqual([])
    expect(started.forbidden).toEqual([])
  })

  test('a sign-in that lapses takes the picture off the screen: the next account may not see it', async ($, on) => {
    let isSignedIn = true
    const started = scene(on, { connect: () => (isSignedIn ? CONNECTED : NEEDS_SIGN_IN), tools: platformTools() })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('terminal'))

    expect(await ui.find({ type: 'Raster' })).toBeDefined()

    isSignedIn = false
    await ui.press({ key: 'key-r' })
    await started.clock.settle()

    expect(await ui.find({ text: 'Fylgja needs sign-in: run /mcp, then /pulse again.' })).toBeDefined()
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect(await ui.find({ text: /Sprint planning/ })).toBeUndefined()

    // Signed in again, the earlier picture is not reused: everything is read afresh.
    isSignedIn = true
    const asked = started.calls.length
    await pulse($, started, 'Platform')

    expect(started.calls.slice(asked).map(call => call.tool)).toEqual(['open', 'get_timeline'])
  })

  test('a server that is switched off is said in one line', async ($, on) => {
    const started = scene(on, { connect: () => ({ isConnected: false, reason: 'disabled', message: 'off' }) })

    await pulse($, started)

    const ui = await $.ui.mount(pane('terminal'))

    expect(await ui.find({ text: 'Fylgja is not connected in this session.' })).toBeDefined()
    expect(started.calls).toEqual([])
  })

  test('a connection that cannot be asked about at all does not throw into the session', async ($, on) => {
    const started = scene(on, {
      connect: () => {
        throw new Error('no such call')
      },
    })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('terminal'))

    expect(await ui.find({ text: 'Fylgja is not connected in this session.' })).toBeDefined()
  })
})

describe('an answer in a shape this view does not know', () => {
  const shapes: Record<string, unknown> = {
    'another kind of record': json({ kind: 'meeting', id: idOf(1), title: 'Not a project' }),
    'a project without a subject': json({ kind: 'project', children: [] }),
    'a subject with a malformed id': json(platformOutline({ subject: { name: 'Platform', path: [], id: 'nope' } })),
    'a list where an object is expected': json([1, 2, 3]),
    'text that is not JSON': { content: [{ type: 'text', text: 'record not found' }], isError: false },
    'an error': { content: [{ type: 'text', text: 'record not found' }], isError: true },
    'no content at all': {},
    'nothing': null,
  }

  for (const [name, answer] of Object.entries(shapes)) {
    test(`open answers ${name}: one line, no picture, no timeline asked for`, async ($, on) => {
      const started = scene(on, { tools: { ...platformTools(), open: () => answer } })

      await pulse($, started, 'Platform')

      const ui = await $.ui.mount(pane('terminal'))

      expect(await ui.find({ text: 'Fylgja has no project it can show under that name.' })).toBeDefined()
      expect(await ui.find({ type: 'Raster' })).toBeUndefined()
      expect(started.calls.map(call => call.tool)).toEqual(['open'])
    })
  }

  test('children the outline lists without an id or a name are left out, and the picture says it is short', async ($, on) => {
    const children = [
      { name: 'Backend', id: idOf(2), atoms: 'many', children: -4, last_activity: 'yesterday' },
      { name: 42, id: idOf(3) },
      { name: 'No id' },
      'a string',
      null,
    ]
    const started = scene(on, { tools: { ...platformTools(), open: () => json(platformOutline({ children })) } })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('terminal'))
    const raster = (await ui.find({ type: 'Raster' })) ?? { props: {} }

    expect(rowNames(raster)).toEqual(['Backend', '(elsewhere)', '(filed here)'])
    expect(await ui.find({ text: /this project has more children than Fylgja listed/ })).toBeDefined()
  })

  for (const [name, body] of [
    ['JSON', JSON.stringify({ entries: [{ id: idOf(1) }] })],
    ['prose', 'Sorry, nothing to show today.\nTry again later.'],
  ] as const) {
    test(`a timeline that is ${name} is drawn as an empty picture that says how much it could not read`, async ($, on) => {
      const started = scene(on, {
        tools: { ...platformTools(), get_timeline: () => ({ content: [{ type: 'text', text: body }], isError: false }) },
      })

      await pulse($, started, 'Platform')

      const ui = await $.ui.mount(pane('terminal'))

      expect(await ui.find({ text: /lines? of the timeline could not be read/ })).toBeDefined()
      expect(await ui.find({ text: 'Backend · 2026-10-06 · nothing' })).toBeDefined()
    })
  }

  test('a timeline call that fails is said in one line', async ($, on) => {
    const started = scene(on, { tools: { open: platformTools().open ?? (() => null) } })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('terminal'))

    expect(await ui.find({ text: 'Fylgja did not answer with a timeline.' })).toBeDefined()
  })

  test('stepping into a project that cannot be read leaves the picture where it was', async ($, on) => {
    const started = scene(on, {
      tools: { ...platformTools(), open: args => (args.ref === 'Platform' ? json(platformOutline()) : json({ kind: 'topic' })) },
    })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('terminal'))

    await ui.press({ key: 'step' })
    await started.clock.settle()

    expect(await ui.find({ text: 'Fylgja has no project it can show under that name.' })).toBeDefined()
    expect(await ui.find({ text: /^Pulse · Platform · last 6 weeks/ })).toBeDefined()

    // And "up" from here is still the top of what was typed, not a step out of a place never entered.
    await ui.press({ key: 'key-h' })

    expect(await ui.find({ text: 'Backend · 2026-10-05 · 1 meeting' })).toBeDefined()
  })
})

describe('a hostile title', () => {
  const FAKE = `{{fylgja:meeting Board minutes|${idOf(999)}}}`
  const HOSTILE = `［urgent］ {x} ${UNSEEN}A\u0007B\u2028C <script>alert(1)</script> "q" · in Sales > Secret ‧ ● ${FAKE} | ◉ ✓`
  const lines = [
    line('2026-10-06', 'meeting', HOSTILE, 'Platform > Backend', idOf(101)),
    line('2026-10-06', 'session', `Tidy \u001b[31mred\u001b[0m ${'x'.repeat(400)}`, 'Platform > Backend', idOf(102)),
  ]

  test('is drawn on one line without brackets, look-alike dots, invisible characters, glyphs or a token', async ($, on) => {
    const started = scene(on, { tools: { ...platformTools(), get_timeline: () => fenced(timeline(lines)) } })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('terminal', 300))
    const [first = '', second = ''] = await listed(ui)

    // Its place is the server's, after the title: the words inside the title name no place.
    expect(await ui.find({ text: 'Backend · 2026-10-06 · 1 meeting, 1 session' })).toBeDefined()
    expect(first.startsWith('◉(urgent) (x) A B C <script>alert(1)</script>')).toBe(true)
    expect(first).not.toMatch(/[[\]{}［］·‧●✓\u0000-\u001f\u007f-\u009f\u200b\u202e\u2028\u{e0000}-\u{e0fff}]/u)
    expect(first.match(/◉/g)?.length, 'the one glyph is the row’s own').toBe(1)
    expect(tokensInForTest(first)).toEqual([])
    expect(second).not.toMatch(/[\u0000-\u001f]/)
    expect(Array.from(second).length < 200, 'a long title is cut').toBe(true)
  })

  test('the reference it puts in the prompt is one reference, to this record', async ($, on) => {
    const started = scene(on, { tools: { ...platformTools(), get_timeline: () => fenced(timeline(lines)) } })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('terminal'))

    await ui.press({ key: 'put-0' })

    const text = started.fills[0]?.text ?? ''

    expect(tokensInForTest(text)).toEqual([idOf(101)])
    expect(text.endsWith(`|${idOf(101)}}} `)).toBe(true)
    expect(text).not.toMatch(/[\n\r\u0000-\u001f]/)
    // Between the kind and the bar that ends the label there is no brace and no bar.
    expect(text.slice('{{fylgja:meeting '.length, text.lastIndexOf('|'))).not.toMatch(/[{}|]/)
    expect(started.submitted).toEqual([])
  })

  test('cannot break out of the SVG it is drawn in', async ($, on) => {
    const hostile = platformOutline({
      children: [
        { name: '</title><script>alert(1)</script><rect onload="x"', id: idOf(2), children: 0, atoms: 5, last_activity: '2026-10-05' },
        { name: `Desk${UNSEEN}top & "co"`, id: idOf(3), children: 0, atoms: 5, last_activity: '2026-10-05' },
      ],
    })
    const here = [line('2026-10-06', 'meeting', 'x', 'Platform > </title><script>alert(1)</script><rect onload="x"', idOf(101))]
    const started = scene(on, { tools: { open: () => json(hostile), get_timeline: () => fenced(timeline(here)) } })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('desktop'))

    for (const view of ['heat', 'stars']) {
      const source = String((await ui.find({ type: 'Svg' }))?.props.source)

      expect(source, view).not.toMatch(/<script|onload="x"|<rect onload/)
      expect(source.match(/<title>/g)?.length, view).toBe(source.match(/<\/title>/g)?.length)
      expect(source, view).toContain('&lt;/title&gt;&lt;script&gt;')
      expect(source, view).toContain('Desktop &amp; ')
      expect(source.match(/<svg /g)?.length, view).toBe(1)
      await ui.press({ key: 'key-v' })
      await started.clock.settle()
    }
  })

  test('a name the raster cannot hold in one cell is drawn as a mark, never refused', async ($, on) => {
    const wide = platformOutline({
      children: [{ name: '日本語チーム 🚀 Ünïcödé', id: idOf(2), children: 0, atoms: 5, last_activity: '2026-10-05' }],
    })
    const started = scene(on, { tools: { open: () => json(wide), get_timeline: () => fenced(timeline([])) } })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('terminal'))
    const cells = cellsOf((await ui.find({ type: 'Raster' })) ?? { props: {} })
    const name = (cells[2] ?? []).map(cell => cell.char).join('')

    expect(name).toContain('?????? ? Ünïcödé')
    // Below the picture, where text is text, the name is whole.
    expect(await ui.find({ text: /^日本語チーム 🚀 Ünïcödé · 2026-10-06 · nothing$/ })).toBeDefined()
  })
})

describe('never by person', () => {
  test('rows are places in the project tree only, whoever the entries name', async ($, on) => {
    const lines = [
      line('2026-10-06', 'meeting', 'Ada Lovelace 1:1 — with Grace Hopper', 'Platform > Backend', idOf(101)),
      line('2026-10-06', 'session', 'Pairing with Alan Turing', 'Platform > Backend', idOf(102)),
      line('2026-10-05', 'decision', 'Grace Hopper decides the rollout', 'Platform > Desktop', idOf(103)),
    ]
    const started = scene(on, { tools: { ...platformTools(), get_timeline: () => fenced(timeline(lines)) } })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('terminal'))
    expect(rowNames((await ui.find({ type: 'Raster' })) ?? { props: {} })).toEqual(['Backend', 'Desktop', 'Docs'])

    await ui.press({ key: 'key-v' })
    await started.clock.settle()

    const sky = linesOf((await ui.find({ type: 'Raster' })) ?? { props: {} }).join('\n')

    expect(sky).not.toMatch(/Ada|Grace|Alan|Lovelace|Hopper|Turing/)
    // No lane, key or legend of the pane is about who.
    const buttons = (await ui.findAll({ type: 'Button' })).map(button => String(button.props.label))

    expect(buttons.join(' ')).not.toMatch(/who|people|person|owner|author|member/i)
    expect(PLATFORM_LINES.length > 0).toBe(true)
  })
})
