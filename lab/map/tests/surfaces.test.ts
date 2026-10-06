import type { Plugin } from 'claude-code/testing'
import { describe, expect, test } from 'claude-code/testing'

import {
  BILLING,
  billingState,
  elementsOf,
  ENGINEERING,
  linesOf,
  NAVIGATOR,
  pane,
  PLUGIN,
  scene,
  SESSION,
} from './fixtures'

const FALLBACK_NOTE =
  'Arrow keys and type-to-jump are not available here. Rows are buttons; each press asks the plugin, so moving is slower.'

/**
 * Another mod seated above the map. `/break` makes it hand the navigator
 * props that are no view, which makes the surface module throw as a real
 * failure on a surface would; `/close-map` closes the map's pane.
 */
const MEDDLER: Plugin = {
  name: 'meddler',
  tier: 'prepend',
  register(on) {
    let isBreaking = false

    on('command.run', { command: 'break' }, () => {
      isBreaking = true

      return {}
    })

    on('command.run', { command: 'close-map' }, async $ => {
      await $.ui.close({ id: 'fylgja-map' })

      return {}
    })

    on('ui.render', { component: 'Pane' }, async ($, e, next) => {
      const tree = structuredClone(await next(e)) as { children?: { type?: string; props?: Record<string, unknown> }[] }

      for (const child of tree.children ?? []) {
        if (isBreaking && child.type === 'Client' && child.props !== undefined) {
          child.props.props = { broken: true }
        }
      }

      return tree as never
    })
  },
}

const BAND = {
  plugin: PLUGIN,
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

describe('the navigator on each surface', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`draws and takes keys on ${surface}`, async ($, on) => {
      const started = scene(on)

      await $.session.start({ ...SESSION, surface })
      await $.command.run({ command: 'map', args: '' } as never)
      await started.clock.settle()
      const ui = await $.ui.mount({ ...pane(120), surface })

      expect(elementsOf(await ui.drawn(), 'Client').length).toBe(1)
      expect(linesOf(await ui.drawn())).toEqual(['reference → prompt', 'ask in this place'])

      await ui.key({ key: 'right' })
      await started.clock.settle()

      expect(linesOf(await ui.drawn({ in: NAVIGATOR }))[0]).toBe('Fylgja › Zalion')
      await ui.unmount()
    })
  }

  for (const columns of [200, 120, 80, 40]) {
    test(`fits ${columns} columns`, async ($, on) => {
      const started = scene(on, { states: { [BILLING]: billingState() } })

      await $.session.start(SESSION)
      await $.command.run({ command: 'map', args: 'Billing' } as never)
      await started.clock.settle()
      const ui = await $.ui.mount({ ...pane(columns, 24), surface: 'terminal' })

      await ui.key({ key: ' ' })
      await started.clock.settle()
      await ui.key({ key: '1' })

      const tree = await ui.drawn({ in: NAVIGATOR })
      const lists = elementsOf(tree, 'Box').filter(
        box => typeof box.props.width === 'number' && typeof box.props.height === 'number',
      )
      const widths = lists.map(box => Number(box.props.width))
      const lines = linesOf(tree)

      // Parent, current and preview from 100 columns; current and preview
      // from 56; below that the list with the preview under it.
      expect(widths.length).toBe(columns >= 100 ? 3 : 2)
      expect(lines[0]).toBe(
        columns >= 56 ? 'Fylgja › Zalion › Engineering' : 'Fylgja › Zalion › Engineering'.slice(0, columns),
      )
      expect(lines.some(line => /^▫ Billing/.test(line))).toBe(true)
      expect(lines.join(' ').replace(/ +/g, ' ')).toContain('The tax rules for Austria are not implemented.')

      if (columns >= 56) {
        expect(widths.reduce((sum, width) => sum + width, 0) + 2 * (widths.length - 1) <= columns).toBe(true)
        expect(widths[widths.length - 1]! <= 96).toBe(true)
      } else {
        expect(widths).toEqual([columns, columns])
      }

      // The breadcrumb, every row and every preview line fit their column.
      for (const box of lists) {
        for (const line of linesOf(box)) {
          expect(Array.from(line).length <= Number(box.props.width), line).toBe(true)
        }
      }

      // The navigator never grows taller than the room the pane gave it.
      expect(lists.every(box => Number(box.props.height) <= 24)).toBe(true)
      expect(lines.length <= 2 + 24 * widths.length).toBe(true)
    })
  }
})

describe('without the navigator', () => {
  test('a surface with no Client element gets buttons, and is told what is lost', async ($, on) => {
    const started = scene(on, { states: { [BILLING]: billingState() } })

    await $.session.start(SESSION)
    await $.command.run({ command: 'map', args: '' } as never)
    await started.clock.settle()
    const ui = await $.ui.mount({ ...pane(120), surface: 'vscode' })

    expect(elementsOf(await ui.drawn(), 'Client')).toEqual([])
    expect(linesOf(await ui.drawn())[0]).toBe(FALLBACK_NOTE)
    expect(linesOf(await ui.drawn())[1]).toBe('Fylgja')

    await ui.press({ key: 'move-into' })
    await started.clock.settle()
    expect(linesOf(await ui.drawn())[1]).toBe('Fylgja › Zalion')

    await ui.press({ key: 'move-into' })
    await started.clock.settle()
    await ui.press({ key: `row-${BILLING}` })
    await started.clock.advance(180)
    expect(linesOf(await ui.drawn())).toContain('Invoices and plans.')

    await ui.press({ key: 'show-state' })
    await started.clock.settle()
    await ui.press({ key: 'show-risks' })
    expect(linesOf(await ui.drawn())).toContain('  The tax rules for Austria are not implemented.')

    await ui.press({ key: 'act-reference' })
    expect(started.fills).toEqual([{ text: `{{fylgja:project Billing|${BILLING}}} `, mode: 'insert' }])

    await ui.press({ key: 'move-up' })
    await ui.press({ key: 'move-top' })
    expect(linesOf(await ui.drawn())[1]).toBe('Fylgja')
  })

  test('draws on mobile, which has no fields and no Client', async ($, on) => {
    const started = scene(on)

    await $.session.start(SESSION)
    await $.command.run({ command: 'map', args: 'Billing' } as never)
    await started.clock.settle()
    const ui = await $.ui.mount({ ...pane(40, 20), surface: 'mobile' })
    const lines = linesOf(await ui.drawn())

    expect(lines[0]).toBe(FALLBACK_NOTE)
    expect(lines.some(line => /^› ▫ Billing/.test(line))).toBe(true)
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(
      `a navigator that fails on ${surface} gives way to the buttons, where the person was`,
      { plugins: [MEDDLER] },
      async ($, on) => {
        const started = scene(on)
        on('command.run', () => ({}))

        await $.session.start(SESSION)
        await $.command.run({ command: 'map', args: '' } as never)
        await started.clock.settle()
        const ui = await $.ui.mount({ ...pane(120), surface })

        await ui.key({ key: 'right' })
        await started.clock.settle()
        await $.command.run({ command: 'break', args: '' } as never)
        await ui.redraw()

        const lines = linesOf(await ui.drawn())

        expect(elementsOf(await ui.drawn(), 'Client')).toEqual([])
        expect(lines[0]).toBe(FALLBACK_NOTE)
        expect(lines[1]).toBe('Fylgja › Zalion')
        expect(lines.some(line => /^› ▪ Engineering/.test(line))).toBe(true)

        await ui.press({ key: 'move-into' })
        await started.clock.settle()
        expect(linesOf(await ui.drawn())[1]).toBe('Fylgja › Zalion › Engineering')
        expect(started.calls.filter(call => call.args.ref === ENGINEERING).length).toBe(1)
      },
    )
  }
})

describe('the line above the prompt', () => {
  test('is not drawn before the map was asked for, nor while the pane is on screen', async ($, on) => {
    const started = scene(on)

    await $.session.start(SESSION)
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })

    expect(linesOf(await band.drawn())).toEqual(['engine'])

    await $.command.run({ command: 'map', args: '' } as never)
    await started.clock.settle()

    expect(linesOf(await band.drawn())).toEqual(['engine'])
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(
      `says where the person is while the pane waits for room on ${surface}, and goes when the pane is drawn or closed`,
      { plugins: [MEDDLER] },
      async ($, on) => {
        const started = scene(on, { isPlaced: false })
        on('command.run', () => ({}))
        on('ui.close', () => ({ value: undefined }) as never)

        await $.session.start(SESSION)
        const band = await $.ui.mount({ ...BAND, surface })

        await $.command.run({ command: 'map', args: 'Billing' } as never)
        await started.clock.settle()

        expect(linesOf(await band.drawn())).toEqual([
          'map  Fylgja › Zalion › Engineering › Billing  ·  the pane waits for a wider window; /map asks again',
          'engine',
        ])

        const ui = await $.ui.mount({ ...pane(120), surface })

        expect(linesOf(await band.drawn())).toEqual(['engine'])
        await ui.unmount()

        await $.command.run({ command: 'map', args: '' } as never)
        await started.clock.settle()
        expect(linesOf(await band.drawn()).length).toBe(2)

        await $.command.run({ command: 'close-map', args: '' } as never)
        expect(linesOf(await band.drawn())).toEqual(['engine'])
      },
    )
  }
})
