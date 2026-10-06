import { describe, expect, test } from 'claude-code/testing'

import { idOf, json, pane, platformTools, pulse, scene } from './fixtures'

const LINK = `https://fylgja.lknblab.dev/open/meeting/${idOf(101)}`

/** `resolve` as a server that has it answers: each id with its record, the link included. */
function resolving(links: Record<string, string>) {
  return (args: Record<string, unknown>) =>
    json({
      records: (args.refs as string[]).map(ref => ({ ref, found: true, id: ref, kind: 'meeting', title: 'T', link: links[ref] })),
    })
}

describe('"Open in Fylgja"', () => {
  test('appears once the cursor has rested on a cell, for the entries the server gives a link for', async ($, on) => {
    const started = scene(on, { tools: { ...platformTools(), resolve: resolving({ [idOf(101)]: LINK }) } })

    await pulse($, started, 'Platform')
    // The cursor rests on the newest cell of the first row.
    await started.clock.advance(500)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount(pane(surface))
      const links = await ui.findAll({ type: 'Link' })

      expect(links.map(link => [link.props.href, link.props.label]), surface).toEqual([[LINK, 'Open in Fylgja']])
      await ui.unmount()
    }

    expect(started.calls.filter(call => call.tool === 'resolve')).toEqual([
      { tool: 'resolve', args: { refs: [idOf(101), idOf(102), idOf(103)] } },
    ])
  })

  test('walking across the picture asks for nothing; only where the cursor rests is asked about, once', async ($, on) => {
    const started = scene(on, { tools: { ...platformTools(), resolve: resolving({}) } })

    await pulse($, started, 'Platform')
    // The cursor rests on the newest cell of the first row.
    await started.clock.advance(500)

    const ui = await $.ui.mount(pane('terminal'))
    const asked = (): number => started.calls.filter(call => call.tool === 'resolve').length

    expect(asked()).toBe(1)

    await ui.press({ key: 'key-h' })
    await started.clock.advance(100)
    await ui.press({ key: 'key-l' })
    await started.clock.advance(100)
    await ui.press({ key: 'key-h' })
    await started.clock.advance(499)

    expect(asked(), 'not yet rested').toBe(1)

    await started.clock.advance(1)

    expect(asked()).toBe(2)
    expect(started.calls[started.calls.length - 1]?.args).toEqual({ refs: [idOf(104)] })

    await ui.press({ key: 'key-l' })
    await ui.press({ key: 'key-h' })
    await started.clock.advance(5000)

    expect(asked(), 'what is known is not asked again').toBe(2)
  })

  test('a server without resolve is asked once, and no entry offers a link', async ($, on) => {
    const started = scene(on, { tools: platformTools() })

    await pulse($, started, 'Platform')
    // The cursor rests on the newest cell of the first row.
    await started.clock.advance(500)

    const ui = await $.ui.mount(pane('terminal'))

    await ui.press({ key: 'key-h' })
    await started.clock.advance(5000)
    await ui.press({ key: 'key-j' })
    await ui.press({ key: 'key-k' })
    await ui.press({ key: 'key-l' })
    await started.clock.advance(5000)

    expect(started.calls.filter(call => call.tool === 'resolve').length).toBe(1)
    expect(await ui.findAll({ type: 'Link' })).toEqual([])
    // The entries are still listed, with their reference button.
    expect(await ui.find({ key: 'put-0' })).toBeDefined()
  })

  const forged: Record<string, string> = {
    'another host': `https://evil.example/open/meeting/${idOf(101)}`,
    'a look-alike host': `https://fylgja.lknblab.dev.evil.example/open/meeting/${idOf(101)}`,
    'a user part': `https://fylgja.lknblab.dev@evil.example/open/meeting/${idOf(101)}`,
    'plain http': `http://fylgja.lknblab.dev/open/meeting/${idOf(101)}`,
    'another scheme': `javascript:alert(1)//fylgja.lknblab.dev/open/meeting/${idOf(101)}`,
    'another record': `https://fylgja.lknblab.dev/open/meeting/${idOf(999)}`,
    'a path that climbs out': `https://fylgja.lknblab.dev/open/meeting/${idOf(101)}/../../admin`,
    'a query': `https://fylgja.lknblab.dev/open/meeting/${idOf(101)}?next=https://evil.example`,
  }

  for (const [name, link] of Object.entries(forged)) {
    test(`a link with ${name} is not offered`, async ($, on) => {
      const started = scene(on, { tools: { ...platformTools(), resolve: resolving({ [idOf(101)]: link }) } })

      await pulse($, started, 'Platform')
    // The cursor rests on the newest cell of the first row.
    await started.clock.advance(500)

      const ui = await $.ui.mount(pane('desktop'))

      expect(started.calls.some(call => call.tool === 'resolve')).toBe(true)
      expect(await ui.findAll({ type: 'Link' })).toEqual([])
    })
  }

  test('a record the server says it did not find gets no link, whatever else the answer holds', async ($, on) => {
    const started = scene(on, {
      tools: {
        ...platformTools(),
        resolve: () => json({ records: [{ ref: idOf(101), found: false, link: LINK }, 'junk', null, { ref: 7 }] }),
      },
    })

    await pulse($, started, 'Platform')
    // The cursor rests on the newest cell of the first row.
    await started.clock.advance(500)

    const ui = await $.ui.mount(pane('terminal'))

    expect(await ui.findAll({ type: 'Link' })).toEqual([])
  })
})
