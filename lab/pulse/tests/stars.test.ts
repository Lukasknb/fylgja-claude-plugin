import { describe, expect, test } from 'claude-code/testing'

import { RASTER_COLORS } from '../hooks/canvas'
import {
  API,
  BACKEND,
  backendOutline,
  cellsOf,
  DESKTOP,
  fenced,
  idOf,
  json,
  linesOf,
  pane,
  PLATFORM_LINES,
  platformOutline,
  platformTools,
  pulse,
  scene,
  timeline,
} from './fixtures'

/** How many cells of each shade a raster holds. */
function shades(raster: { props: Record<string, unknown> }): Record<string, number> {
  const counts: Record<string, number> = { '░': 0, '▒': 0, '▓': 0, '█': 0 }

  for (const cell of cellsOf(raster).flat()) {
    if (cell.char in counts && cell.fg === RASTER_COLORS.star) {
      counts[cell.char] = (counts[cell.char] ?? 0) + 1
    }
  }

  return counts
}

describe('the constellation', () => {
  test('v draws the same subtree as nodes: size is what is filed, shade is how recent', async ($, on) => {
    const started = scene(on, { tools: platformTools() })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('terminal'))

    await ui.press({ key: 'key-v' })
    await started.clock.settle()

    const raster = (await ui.find({ type: 'Raster' })) ?? { props: {} }
    const rows = linesOf(raster)
    const counts = shades(raster)

    // Only the child that has children is opened for them; nothing else is asked.
    expect(started.calls.slice(2)).toEqual([{ tool: 'open', args: { ref: BACKEND, detail: false } }])
    // The cursor starts on the project itself, between brackets and named.
    expect(rows.some(row => /\[█+\] Platform/.test(row))).toBe(true)
    expect(await ui.find({ text: 'Platform · 120 filed · 3 below it · last active 2026-10-05' })).toBeDefined()
    // Active this week: full. A month ago: the third shade. Half a year ago: the lightest.
    expect(rows.some(row => /█+ Backend/.test(row))).toBe(true)
    expect(rows.some(row => /▓+ Desktop/.test(row))).toBe(true)
    expect(rows.some(row => /░+ Docs/.test(row))).toBe(true)
    // Docs holds 2 records and Desktop 30: the quiet corner is the smaller node.
    expect((counts['░'] ?? 0) < (counts['▓'] ?? 0) && (counts['▓'] ?? 0) < (counts['█'] ?? 0)).toBe(true)
    // The child's child is drawn too.
    expect(rows.some(row => /█+ API/.test(row))).toBe(true)
  })

  test('the cursor walks the nodes, and Enter steps into the one it is on', async ($, on) => {
    const started = scene(on, { tools: platformTools() })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('terminal'))

    await ui.press({ key: 'key-v' })
    await started.clock.settle()

    // The project in the middle is where the picture already is: no way in.
    expect(await ui.find({ key: 'step' })).toBeUndefined()

    await ui.press({ key: 'key-k' })

    expect(await ui.find({ text: 'Backend · 80 filed · 1 below it · last active 2026-10-05' })).toBeDefined()
    expect((await ui.find({ key: 'step' }))?.props.label).toBe('Step into Backend')

    await ui.press({ key: 'key-k' })

    expect(await ui.find({ text: 'API · 40 filed · 0 below it · last active 2026-10-01' })).toBeDefined()

    await ui.press({ key: 'put-project' })

    expect(started.fills).toEqual([{ text: `{{fylgja:project API|${API}}} `, mode: 'insert' }])

    await ui.press({ key: 'key-j' })
    await ui.press({ key: 'key-j' })
    await ui.press({ key: 'key-l' })

    expect(await ui.find({ text: 'Desktop · 30 filed · 0 below it · last active 2026-09-10' })).toBeDefined()

    const asked = started.calls.length

    await ui.press({ key: 'step' })
    await started.clock.settle()

    expect(started.calls.slice(asked).map(call => [call.tool, call.args.ref ?? call.args.project_name])).toEqual([
      ['open', DESKTOP],
      ['get_timeline', DESKTOP],
    ])
  })

  test('only the largest few are named until the cursor is on a node', async ($, on) => {
    const kids = Array.from({ length: 9 }, (_, n) => ({
      name: `Area ${n + 1}`,
      id: idOf(20 + n),
      band: 'technical',
      children: 0,
      atoms: 90 - n * 10,
      last_activity: '2026-10-01',
    }))
    const started = scene(on, {
      tools: { open: () => json(platformOutline({ children: kids })), get_timeline: () => fenced(timeline(PLATFORM_LINES)) },
    })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('terminal', 120))

    await ui.press({ key: 'key-v' })
    await started.clock.settle()

    const names = (): Promise<string[]> =>
      ui.find({ type: 'Raster' }).then(raster =>
        linesOf(raster ?? { props: {} })
          .join('\n')
          .match(/Area \d|Platform/g) ?? [],
      )

    expect((await names()).sort()).toEqual(['Area 1', 'Area 2', 'Area 3', 'Area 4', 'Platform'])
    // No child has children, so nothing more was asked for.
    expect(started.calls.length).toBe(2)
  })

  test('children of children are fetched for a few of the largest only, and the rest are said to be undrawn', async ($, on) => {
    const kids = Array.from({ length: 9 }, (_, n) => ({
      name: `Area ${n + 1}`,
      id: idOf(20 + n),
      band: 'technical',
      children: 2,
      atoms: 90 - n * 10,
      last_activity: '2026-10-01',
    }))
    const started = scene(on, {
      tools: {
        open: args => json(args.ref === 'Platform' ? platformOutline({ children: kids }) : backendOutline()),
        get_timeline: () => fenced(timeline(PLATFORM_LINES)),
      },
    })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('terminal', 120))

    await ui.press({ key: 'key-v' })
    await started.clock.settle()

    expect(started.calls.slice(2).map(call => call.args.ref)).toEqual(kids.slice(0, 6).map(kid => kid.id))
    // Six children show one of their two, three show none of theirs.
    expect(await ui.find({ text: /12 further places below these not drawn/ })).toBeDefined()

    await ui.press({ key: 'key-v' })
    await ui.press({ key: 'key-v' })
    await started.clock.settle()

    expect(started.calls.length, 'asked once, however often the view is switched').toBe(8)
  })

  test('the desktop draws the constellation as an SVG with a title on every node', async ($, on) => {
    const started = scene(on, { tools: platformTools() })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('desktop'))

    await ui.press({ key: 'key-v' })
    await started.clock.settle()

    const svg = await ui.find({ type: 'Svg' })
    const source = String(svg?.props.source)

    expect(String(svg?.props.alt)).toBe('Constellation of 5 places. Cursor on Platform.')
    expect(source.match(/<circle cx/g)?.length).toBe(5)
    expect(source).toContain('<title>Docs · 2 filed · last active 2026-03-01</title>')
    // Quiet for half a year: the faintest; active this week: solid.
    expect(source).toMatch(/fill-opacity="0.3"><title>Docs/)
    expect(source).toMatch(/fill-opacity="1"><title>Backend/)
  })
})
