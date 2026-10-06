import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  BACKEND,
  BILLING,
  billingState,
  elementsOf,
  ENGINEERING,
  idOf,
  linesOf,
  NAVIGATOR,
  organisation,
  pane,
  PERSONAL,
  scene,
  SESSION,
  ZALION,
} from './fixtures'
import type { Scene } from './fixtures'

const DWELL = 180

/** Types `/map args`, lets the first reads finish, and mounts the pane on a terminal. */
async function opened($: Engine, started: Scene, args = '', columns = 120) {
  await $.session.start(SESSION)
  await $.command.run({ command: 'map', args } as never)
  await started.clock.settle()

  return $.ui.mount({ ...pane(columns), surface: 'terminal' })
}

type Mounted = Awaited<ReturnType<typeof opened>>

async function screen(ui: Mounted): Promise<string[]> {
  return linesOf(await ui.drawn({ in: NAVIGATOR }))
}

function opens(started: Scene, detail = false): string[] {
  return started.calls
    .filter(call => call.tool === 'open' && call.args.detail === detail)
    .map(call => String(call.args.ref))
}

describe('/map', () => {
  test('opens the pane on the top of the tree, each row a name and one recency mark', async ($, on) => {
    const started = scene(on)
    const ui = await opened($, started)
    const lines = await screen(ui)

    expect(started.opened()).toBe(1)
    expect(lines[0]).toBe('Fylgja')
    expect(lines[1]).toMatch(/^▪ Zalion +●$/)
    expect(lines[2]).toMatch(/^▪ Personal +·$/)
    expect(started.calls[0]).toEqual({ tool: 'get_project', args: { limit: 200 } })
  })

  test('answers the command with no text, so nothing is added to what Claude reads', async ($, on) => {
    const started = scene(on)

    await $.session.start(SESSION)

    expect(await $.command.run({ command: 'map', args: 'Billing' } as never)).toEqual({})
    await started.clock.settle()
    expect(started.submitted).toEqual([])
  })

  test('the recency mark says fresh, this month or quiet, and counts stay out of the rows', async ($, on) => {
    const started = scene(on)
    const ui = await opened($, started)

    await ui.key({ key: 'right' })
    await started.clock.settle()
    const level = await screen(ui)

    await ui.key({ key: 'right' })
    await started.clock.settle()
    const lines = await screen(ui)

    expect(level.find(line => /Engineering/.test(line))).toMatch(/^▪ Engineering +●$/)
    expect(level.find(line => /^▪ Sales/.test(line))).toMatch(/^▪ Sales +○$/)
    expect(lines).toContain('▫ Billing                       ·')
    expect(lines.filter(line => /^[▪▫] /.test(line)).every(line => !/\d/.test(line))).toBe(true)
  })

  test('arrow keys move through the levels and the breadcrumb follows', async ($, on) => {
    const started = scene(on)
    const ui = await opened($, started)

    await ui.key({ key: 'right' })
    await started.clock.settle()
    expect((await screen(ui))[0]).toBe('Fylgja › Zalion')

    await ui.key({ key: 'down' })
    await started.clock.advance(DWELL)
    expect(await screen(ui)).toContain('Customers and deals.')

    await ui.key({ key: 'up' })
    await ui.key({ key: 'right' })
    await started.clock.settle()
    expect((await screen(ui))[0]).toBe('Fylgja › Zalion › Engineering')

    await ui.key({ key: 'down' })
    await ui.key({ key: 'left' })
    expect((await screen(ui))[0]).toBe('Fylgja › Zalion')

    // Coming back into a level finds the row that was highlighted there.
    await ui.key({ key: 'right' })
    const inverse = elementsOf(await ui.drawn({ in: NAVIGATOR }), 'Text').filter(text => text.props.inverse === true)

    expect(linesOf(inverse[0])[0]).toMatch(/Billing/)

    await ui.key({ key: '~' })
    expect((await screen(ui))[0]).toBe('Fylgja')
  })

  test('a row with nothing under it is not entered', async ($, on) => {
    const started = scene(on)
    const ui = await opened($, started)

    await ui.key({ key: 'down' })
    await ui.key({ key: 'right' })
    await started.clock.settle()

    expect((await screen(ui))[0]).toBe('Fylgja')
  })

  test('a level that is not known yet shows as loading and fills in when it arrives', async ($, on) => {
    const started = scene(on)
    const ui = await opened($, started)

    await ui.key({ key: 'right' })
    await started.clock.settle()
    // Straight on into Engineering, before its outline was read ahead.
    const before = opens(started).length
    await ui.key({ key: 'right' })

    expect(opens(started).slice(before)).toEqual([ENGINEERING])
    await started.clock.settle()
    expect(await screen(ui)).toContain('▫ Backend                       ●')
  })

  test('the highlighted project is read ahead after a short rest, so moving right asks nothing', async ($, on) => {
    const started = scene(on)
    const ui = await opened($, started)

    await ui.key({ key: 'right' })
    await started.clock.advance(DWELL - 1)
    expect(opens(started)).not.toContain(ENGINEERING)

    await started.clock.advance(1)
    expect(opens(started)).toContain(ENGINEERING)

    const asked = started.calls.length
    await ui.key({ key: 'right' })

    expect(await screen(ui)).toContain('▫ Backend                       ●')
    expect(started.calls.length).toBe(asked)
  })

  test('holding an arrow key down reads nothing along the way', async ($, on) => {
    const projects = organisation()

    for (let n = 0; n < 12; n += 1) {
      projects.push({ id: idOf(100 + n), name: `Area ${n}`, parent: ZALION, band: 'workstream' })
    }

    const started = scene(on, { projects })
    const ui = await opened($, started)

    await ui.key({ key: 'right' })
    await started.clock.settle()
    const asked = started.calls.length

    for (let n = 0; n < 10; n += 1) {
      await ui.key({ key: 'down' })
      await started.clock.advance(50)
    }

    expect(started.calls.length).toBe(asked)
    await started.clock.advance(DWELL)
    expect(started.calls.length).toBe(asked + 1)
  })

  test('typing letters jumps to the row whose name starts with them', async ($, on) => {
    const started = scene(on)
    const ui = await opened($, started)

    await ui.key({ key: 'right' })
    await started.clock.settle()
    await ui.key({ key: 's' })

    const lines = await screen(ui)

    expect(lines).toContain('Sales')
    expect(lines[lines.length - 1]).toBe('jump: s')

    // No row starts with "se", so the second letter starts another name.
    await ui.key({ key: 'e' })
    await started.clock.advance(DWELL)
    expect(await screen(ui)).toContain('Everything that is built.')
  })

  test('the preview shows the definition and the counts of the highlighted project', async ($, on) => {
    const started = scene(on)
    const ui = await opened($, started)
    const lines = await screen(ui)

    expect(lines).toContain('The whole company.')
    expect(lines).toContain('132 statements, 14 meetings, 9 active weeks')
    expect(lines).toContain('orientation, active')
  })

  test('what holds now is read only when asked for, and risks and commitments open from their counts', async ($, on) => {
    const started = scene(on, { states: { [BILLING]: billingState() } })
    const ui = await opened($, started, 'Billing')

    await started.clock.advance(DWELL)
    expect(opens(started, true)).toEqual([])

    await ui.key({ key: ' ' })
    await started.clock.settle()

    let lines = await screen(ui)

    expect(opens(started, true)).toEqual([BILLING])
    expect(lines).toContain('Which plan is the default? → Team, monthly (2026-09-12)')
    expect(lines).toContain('▸ 1 open risk  (1)')
    expect(lines).toContain('▸ 2 open commitments  (2)')
    expect(lines).toContain('2026-09-20 Invoices are sent on the first of the month.')
    expect(lines.join('\n')).not.toMatch(/Austria|pricing sheet/)

    await ui.key({ key: '1' })
    await ui.key({ key: '2' })
    lines = await screen(ui)

    expect(lines).toContain('  The tax rules for Austria are not implemented.')
    expect(lines).toContain('  Send the pricing sheet to finance (due 2026-10-14)')
    expect(opens(started, true)).toEqual([BILLING])
  })

  test('proposed changes are a dim count and nothing can be accepted, rejected or changed from here', async ($, on) => {
    const started = scene(on, { states: { [BILLING]: billingState() } })
    const ui = await opened($, started, 'Billing')

    await ui.key({ key: ' ' })
    await started.clock.advance(DWELL)
    await started.clock.settle()

    const tree = await ui.drawn({ in: NAVIGATOR })
    const proposed = elementsOf(tree, 'Text').find(text => /proposed/.test(linesOf(text)[0] ?? ''))

    expect(linesOf(proposed)[0]).toBe('1 change is proposed here; review in Fylgja')
    expect(proposed?.props.dimColor).toBe(true)
    expect(elementsOf(tree, 'Button')).toEqual([])
    expect(linesOf(await ui.drawn()).filter(line => /accept|reject/i.test(line))).toEqual([])
    expect(new Set(started.calls.map(call => call.tool))).toEqual(new Set(['get_project', 'open']))
    expect(started.forbidden).toEqual([])
  })

  test('/map with a name goes to that project, highlighted in its parent level', async ($, on) => {
    const started = scene(on)
    const ui = await opened($, started, 'billing')
    const lines = await screen(ui)

    expect(lines[0]).toBe('Fylgja › Zalion › Engineering')
    expect(lines).toContain('Invoices and plans.')
    expect(lines).toContain('1 fine-grained below, not listed: Invoice parser')
  })

  test('/map with a pasted reference goes to the project it names by id', async ($, on) => {
    const started = scene(on)
    const ui = await opened($, started, `{{fylgja:project Some old name|${BACKEND}}}`)

    expect((await screen(ui))[0]).toBe('Fylgja › Zalion › Engineering')
    expect(await screen(ui)).toContain('The API and its workers.')
  })

  test('/map with a name nobody has says so in one line and stays where it was', async ($, on) => {
    const started = scene(on)
    const ui = await opened($, started, 'Nonexistent')

    expect(linesOf(await ui.drawn())[0]).toBe("No project called 'Nonexistent' could be read.")
    expect((await screen(ui))[0]).toBe('Fylgja')
  })

  test('a level with more children than one page reads the further pages', async ($, on) => {
    const projects = organisation()

    for (let n = 0; n < 7; n += 1) {
      projects.push({ id: idOf(200 + n), name: `Team ${n}`, parent: PERSONAL, band: 'workstream' })
    }

    const started = scene(on, { projects, pageSize: 3 })
    const ui = await opened($, started)

    await ui.key({ key: 'down' })
    await ui.key({ key: 'right' })
    await started.clock.settle()

    expect((await screen(ui)).filter(line => /^▫ Team \d/.test(line)).length).toBe(7)
    expect(
      started.calls
        .filter(call => call.args.ref === PERSONAL && call.args.cursor !== undefined)
        .map(call => call.args.cursor),
    ).toEqual(['3', '6'])
  })
})

describe('actions on the highlighted project', () => {
  test('Enter puts its reference into the prompt box at the cursor and submits nothing', async ($, on) => {
    const started = scene(on)
    const ui = await opened($, started, 'Billing')

    await ui.key({ key: 'return' })

    expect(started.fills).toEqual([{ text: `{{fylgja:project Billing|${BILLING}}} `, mode: 'insert' }])
    expect(started.submitted).toEqual([])
  })

  test('the colon key only fills the prompt box with the place, for the person to go on typing', async ($, on) => {
    const started = scene(on)
    const ui = await opened($, started, 'Billing')
    const asked = started.calls.length

    await ui.key({ key: ':' })

    expect(started.fills).toEqual([{ text: 'in Zalion / Engineering / Billing: ', mode: 'insert' }])
    expect(started.submitted).toEqual([])
    expect(started.calls.length).toBe(asked)
  })

  test('the two buttons under the navigator do the same for whoever cannot use the keys', async ($, on) => {
    const started = scene(on)
    const ui = await opened($, started)

    await ui.key({ key: 'right' })
    await ui.press({ key: 'act-reference' })
    await ui.press({ key: 'act-scope' })

    expect(started.fills).toEqual([
      { text: `{{fylgja:project Engineering|${ENGINEERING}}} `, mode: 'insert' },
      { text: 'in Zalion / Engineering: ', mode: 'insert' },
    ])
  })

  test('a link opens the project in the Fylgja app when the server gives one, and only its own', async ($, on) => {
    const link = `https://fylgja.lknblab.dev/open/project/${ZALION}`
    const projects = organisation().map(project =>
      project.id === ZALION
        ? { ...project, link }
        : project.id === PERSONAL
          ? { ...project, link: `https://fylgja.lknblab.dev.evil.example/open/project/${PERSONAL}` }
          : project,
    )
    const started = scene(on, { projects })
    const ui = await opened($, started)

    expect(elementsOf(await ui.drawn({ in: NAVIGATOR }), 'Link').map(one => one.props)).toEqual([
      { href: link, label: 'open in Fylgja' },
    ])

    await ui.key({ key: 'down' })
    expect(elementsOf(await ui.drawn({ in: NAVIGATOR }), 'Link')).toEqual([])
  })

  test('a click highlights a row, a second click enters it, and a click in the parent column goes back up', async ($, on) => {
    const started = scene(on)
    const ui = await opened($, started)

    await ui.pointer({ type: 'down', x: 30, y: 2, button: 'left' })
    expect(await screen(ui)).toContain('Not the company.')

    await ui.pointer({ type: 'down', x: 30, y: 1, button: 'left' })
    await ui.pointer({ type: 'down', x: 30, y: 1, button: 'left' })
    await started.clock.settle()
    expect((await screen(ui))[0]).toBe('Fylgja › Zalion')

    await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left' })
    expect((await screen(ui))[0]).toBe('Fylgja')
    expect(await screen(ui)).toContain('Not the company.')
  })
})
