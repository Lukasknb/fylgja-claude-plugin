import { describe, expect, test } from 'claude-code/testing'

import { RASTER_COLORS } from '../hooks/canvas'
import { SVG_COLORS } from '../hooks/svg'
import { fenced, linesOf, pane, PLATFORM_LINES, platformTools, pulse, scene, timeline } from './fixtures'

describe('the picture on each surface', () => {
  test('the terminal draws a raster within its limits and no SVG', async ($, on) => {
    const started = scene(on, { tools: platformTools() })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('terminal', 160))
    const raster = await ui.find({ type: 'Raster' })

    expect(raster?.key).toBe('picture')
    expect(Number(raster?.props.columns) <= 512 && Number(raster?.props.rows) <= 256).toBe(true)
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    // The surface's own table accepted the whole tree.
    expect((await ui.drawn()).type).toBe('Box')
  })

  test('the desktop draws an interactive SVG with a hover title per busy cell, and no raster', async ($, on) => {
    const started = scene(on, { tools: platformTools() })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('desktop'))
    const svg = await ui.find({ type: 'Svg' })
    const source = String(svg?.props.source)

    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect((await ui.drawn()).type).toBe('Box')
    expect(svg?.props.isInteractive).toBe(true)
    expect(String(svg?.props.alt)).toBe(
      'Heatmap of 4 rows over 42 days. Cursor on Backend: 1 meeting, 1 session, 1 decision.',
    )
    expect(source.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(source.length <= 131_072).toBe(true)
    expect(source).toContain('<title>Backend · 2026-10-05 · 1 meeting</title>')
    expect(source).toContain(`fill="${SVG_COLORS.session}"`)
    // Intensity is opacity, so it blends with a light and a dark page alike; the text follows the scheme where told.
    expect(source).toContain('fill-opacity="1"')
    expect(source).toContain('prefers-color-scheme:dark')
    expect(source).not.toMatch(/<script|onload=|onclick=|href=/)
  })

  test('the same keys work on the desktop: the cursor moves and the cell is listed', async ($, on) => {
    const started = scene(on, { tools: platformTools() })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('desktop'))

    await ui.press({ key: 'key-h' })

    expect(await ui.find({ text: 'Backend · 2026-10-05 · 1 meeting' })).toBeDefined()
    expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toContain('Cursor on Backend: 1 meeting.')

    await ui.press({ key: 'put-0' })

    expect(started.fills.map(fill => fill.mode)).toEqual(['insert'])
  })

  test('the desktop dims the old picture while the next is fetched', async ($, on) => {
    let isSlow = false
    const started = scene(on, {
      tools: {
        ...platformTools(),
        get_timeline: async (args, clock) => {
          if (isSlow) {
            await clock.sleep(1000)
          }

          return fenced(timeline(PLATFORM_LINES))
        },
      },
    })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('desktop'))

    expect(String((await ui.find({ type: 'Svg' }))?.props.source)).not.toContain('<g opacity="0.35">')

    isSlow = true
    await ui.press({ key: 'key-w' })

    expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('<g opacity="0.35">')

    await started.clock.advance(1000)

    expect(String((await ui.find({ type: 'Svg' }))?.props.source)).not.toContain('<g opacity="0.35">')
  })

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    test(`plain text on ${surface}: rows of block characters in the theme's own colours`, async ($, on) => {
      const started = scene(on, { tools: platformTools() })

      await pulse($, started, 'Platform')

      const ui = await $.ui.mount(pane(surface, 100))

      await ui.press({ key: 'key-p' })

      const rows = (await ui.find({ key: 'picture-text' }))?.children as { children: { props?: Record<string, unknown>; children: string[] }[] }[]
      const runs = rows.flatMap(row => row.children)
      const colors = new Set(runs.map(run => run.props?.color).filter(color => color !== undefined))

      expect(await ui.find({ type: 'Raster' })).toBeUndefined()
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(rows.length).toBe(6)
      // Theme keys, never fixed colours: the rows follow the person's theme.
      expect([...colors].sort()).toEqual(['claude', 'inactive', 'merged', 'suggestion'])
      expect(runs.filter(run => run.props?.inverse === true).map(run => run.children.join(''))).toEqual(['█'])
      expect(rows[2]?.children.map(run => run.children.join('')).join('')).toMatch(/^▸Backend +·+/)

      await ui.press({ key: 'key-p' })

      expect(await ui.find({ key: 'picture-text' })).toBeUndefined()
      expect(await ui.find({ type: surface === 'terminal' ? 'Raster' : 'Svg' })).toBeDefined()
    })
  }

  test('a wide terminal shows meetings, sessions and decisions side by side in a cell', async ($, on) => {
    const started = scene(on, { tools: platformTools() })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('terminal', 100))

    await ui.press({ key: 'key-n' })

    const rows = linesOf((await ui.find({ type: 'Raster' })) ?? { props: {} })

    expect(await ui.find({ text: /by day$/ })).toBeDefined()
    expect(await ui.find({ text: /side by side in a cell/ })).toBeDefined()
    // 2026-10-05 in Backend: a meeting in the first of the three places, nothing in the other two.
    expect(rows[2]).toMatch(/█ {3}\S*$/)
  })
})

function luminance(color: number): number {
  const channel = (value: number): number => {
    const part = value / 255

    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4
  }

  return 0.2126 * channel((color >> 16) & 255) + 0.7152 * channel((color >> 8) & 255) + 0.0722 * channel(color & 255)
}

function contrast(a: number, b: number): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]

  return (light + 0.05) / (dark + 0.05)
}

describe('the fixed colours', () => {
  test('each stands at least 3:1 from a white and from a dark background', () => {
    const colors = [...Object.values(RASTER_COLORS), ...Object.values(SVG_COLORS).map(hex => Number.parseInt(hex.slice(1), 16))]

    for (const color of colors) {
      expect(contrast(color, 0xffffff) >= 3, `#${color.toString(16)} on white`).toBe(true)
      expect(contrast(color, 0x1e1e1e) >= 3, `#${color.toString(16)} on dark`).toBe(true)
    }
  })
})
