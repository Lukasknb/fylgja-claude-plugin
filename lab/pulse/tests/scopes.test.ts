import { describe, expect, test } from 'claude-code/testing'

import { scopeOf } from '../hooks/scope'
import { fenced, idOf, line, linesOf, listed, pane, PANE, platformTools, PLATFORM, pulse, rowNames, scene, SESSION } from './fixtures'

/** Recent activity as the server writes it with no project or repository named. */
const ACTIVITY = [
  '# Sessions — your sessions (since 2026-08-26)',
  '',
  '2 sessions, newest first. Use open(<id>) to read one.',
  '',
  '- [2026-10-05] **Fix the queue worker** — API',
  `  id: ${idOf(301)} · repo: org/api · branch: main · duration: — · outcome: merged`,
  '  produced: 1 decisions · 0 commitments · 2 open risks',
  '- [2026-10-01] **Scratch work**',
  `  id: ${idOf(302)} · duration: — · outcome: —`,
  '  produced: 0 decisions · 0 commitments · 0 open risks',
  '',
  'Where these sessions are filed:',
  `- ${idOf(301)} · in Platform > Backend > API`,
  '',
  '# Recent meetings',
  '',
  line('2026-10-06', 'meeting', 'Pricing sync', 'Sales > Pricing', idOf(303)),
  line('2026-10-05', 'meeting', 'Platform weekly', 'Platform', idOf(304)),
  line('2026-10-02', 'meeting', 'Standup', null, idOf(305)),
  '',
  '# Changes to the project tree',
  '',
  line('2026-10-03', 'tree move', 'Pricing moved under Sales', 'Sales', idOf(306)),
  '',
  'The tree is at version 12: pass since=v12 to see what changes next.',
].join('\n')

describe('/pulse with nothing after it', () => {
  test('one read; the rows are the top-level projects that had activity', async ($, on) => {
    const started = scene(on, { tools: { ...platformTools(), get_timeline: () => fenced(ACTIVITY) } })

    await pulse($, started)

    expect(started.calls).toEqual([{ tool: 'get_timeline', args: { since: '2026-08-26', limit: 100 } }])

    const ui = await $.ui.mount(pane('terminal'))

    expect(await ui.find({ text: /^Pulse · everything recent · last 6 weeks · by day$/ })).toBeDefined()
    // A session is counted where the server says it is filed; one filed nowhere is not guessed at.
    expect(rowNames((await ui.find({ type: 'Raster' })) ?? { props: {} })).toEqual(['Platform', 'Sales', '(unfiled)'])
    expect(await ui.find({ text: /could not be read/ })).toBeUndefined()

    await ui.press({ key: 'key-h' })

    expect(await ui.find({ text: 'Platform · 2026-10-05 · 1 meeting, 1 session' })).toBeDefined()
    expect(await listed(ui)).toEqual([
      expect.stringContaining('⌁Fix the queue worker2026-10-05'),
      expect.stringContaining('◉Platform weekly2026-10-05'),
    ])
  })

  test('Enter steps into a top-level project by its name, and u comes back', async ($, on) => {
    const started = scene(on, {
      tools: { ...platformTools(), get_timeline: args => fenced(args.project_name === undefined ? ACTIVITY : '') },
    })

    await pulse($, started)

    const ui = await $.ui.mount(pane('terminal'))

    await ui.press({ key: 'step' })
    await started.clock.settle()

    expect(started.calls.slice(1).map(call => [call.tool, call.args.ref ?? call.args.project_name])).toEqual([
      ['open', 'Platform'],
      ['get_timeline', PLATFORM],
    ])
    expect(await ui.find({ text: /^Pulse · Platform · / })).toBeDefined()

    await ui.press({ key: 'key-u' })
    await started.clock.settle()

    expect(await ui.find({ text: /^Pulse · everything recent · / })).toBeDefined()

    await ui.press({ key: 'key-u' })

    expect(await ui.find({ text: 'This is the top.' })).toBeDefined()
    expect(started.calls.length).toBe(3)
  })

  test('its constellation is built from the window alone and says so', async ($, on) => {
    const started = scene(on, { tools: { get_timeline: () => fenced(ACTIVITY) } })

    await pulse($, started)

    const ui = await $.ui.mount(pane('terminal'))

    await ui.press({ key: 'key-v' })
    await started.clock.settle()

    const sky = linesOf((await ui.find({ type: 'Raster' })) ?? { props: {} }).join('\n')

    expect(sky).toMatch(/\[█+\] Platform/)
    expect(sky).toContain('Sales')
    expect(await ui.find({ text: 'Platform · 2 in the window · last active 2026-10-05' })).toBeDefined()
    expect(await ui.find({ text: /size is activity in the window; step into a project/ })).toBeDefined()
    expect(started.calls.length, 'no outline is read for it').toBe(1)
  })

  test('a full page of meetings counts as cut, since the server does not say when it left meetings out', async ($, on) => {
    const many = Array.from({ length: 100 }, (_, n) => line('2026-10-06', 'meeting', `Meeting ${n}`, 'Sales', idOf(1000 + n)))
    const started = scene(on, { tools: { get_timeline: () => fenced(['# Recent meetings', '', ...many].join('\n')) } })

    await pulse($, started)

    const ui = await $.ui.mount(pane('terminal'))

    expect(started.calls.length > 1 && started.calls.length <= 7).toBe(true)
    expect(await ui.find({ text: /built from a partial result/ })).toBeDefined()
    expect(await ui.find({ text: 'and 94 more in this cell' })).toBeDefined()
  })
})

describe('/pulse on a repository', () => {
  test('reads that repository’s sessions and rows them by the project each is filed under', async ($, on) => {
    const sessions = ACTIVITY.split('\n').slice(0, 10).join('\n')
    const started = scene(on, { tools: { get_timeline: () => fenced(sessions) } })

    await pulse($, started, 'org/api')

    expect(started.calls).toEqual([{ tool: 'get_timeline', args: { repo: 'org/api', since: '2026-08-26', limit: 100 } }])

    const ui = await $.ui.mount(pane('terminal'))

    expect(await ui.find({ text: /^Pulse · sessions in org\/api · last 6 weeks/ })).toBeDefined()
    expect(rowNames((await ui.find({ type: 'Raster' })) ?? { props: {} })).toEqual(['API', '(unfiled)'])
  })
})

describe('what follows /pulse', () => {
  test('nothing, a repository, a pasted project reference, or a project name', () => {
    expect(scopeOf('   ')).toEqual({ kind: 'all' })
    expect(scopeOf('org/repo')).toEqual({ kind: 'repo', repo: 'org/repo' })
    expect(scopeOf('~/dev/thing')).toEqual({ kind: 'repo', repo: '~/dev/thing' })
    expect(scopeOf('./here')).toEqual({ kind: 'repo', repo: './here' })
    expect(scopeOf(`{{fylgja:project Platform|${PLATFORM.toUpperCase()}}}`)).toEqual({
      kind: 'project',
      ref: PLATFORM,
      label: 'project',
    })
    // A project's name may hold a slash among words; only a bare org/repo is a repository.
    expect(scopeOf('Sales / Pricing')).toEqual({ kind: 'project', ref: 'Sales / Pricing', label: 'Sales / Pricing' })
    expect(scopeOf('[Platform]').kind).toBe('project')
    expect((scopeOf('x'.repeat(500)) as { ref: string }).ref.length).toBe(200)
  })
})

describe('quiet until asked', () => {
  test('a session that starts asks Fylgja nothing and opens nothing', async ($, on) => {
    const started = scene(on, { tools: platformTools() })

    await $.session.start(SESSION)
    await started.clock.advance(60_000)

    expect([started.calls, started.opened, started.fills, started.forbidden]).toEqual([[], [], [], []])
  })

  test('the pane says what to type until the command has run', async ($, on) => {
    const started = scene(on, { tools: platformTools() })

    await $.session.start(SESSION)

    const ui = await $.ui.mount(pane('terminal'))

    expect(await ui.find({ text: 'Type /pulse, /pulse <project name> or /pulse <org/repo>.' })).toBeDefined()
    expect(started.calls).toEqual([])
  })

  test('another plugin’s pane is left to the engine', async ($, on) => {
    scene(on, { tools: platformTools() })

    const ui = await $.ui.mount({ ...pane('terminal'), requestId: `${PANE}-other` })

    expect(await ui.drawn()).toEqual({ type: 'Text', props: {}, children: ['engine'] })
  })

  test('a pane the surface cannot place is said in the command’s own line, and Fylgja is not asked', async ($, on) => {
    const started = scene(on, { tools: platformTools(), canPlace: false })

    await $.session.start(SESSION)

    expect(await $.command.run({ command: 'pulse', args: 'Platform' } as never)).toEqual({
      text: 'Pulse has no room for its pane here.',
    })
    expect(started.calls).toEqual([])
  })
})

describe('edges of the window and the tree', () => {
  test('an entry the server dates a day ahead of the clock here is in the newest column, not outside the picture', async ($, on) => {
    const lines = [line('2026-10-07', 'meeting', 'Dated tomorrow, by a server east of here', 'Platform > Backend', idOf(401))]
    const started = scene(on, { tools: { ...platformTools(), get_timeline: () => fenced(`Showing 1 entries, newest first.\n\n${lines[0]}`) } })

    await pulse($, started, 'Platform')

    const ui = await $.ui.mount(pane('terminal'))

    expect(await ui.find({ text: 'Backend · 2026-10-06 · 1 meeting' })).toBeDefined()
    expect((await listed(ui))[0]).toContain('2026-10-07')
  })

  test('u at the project that was typed goes to the project above it, by name', async ($, on) => {
    const started = scene(on, { tools: platformTools() })

    await pulse($, started, '00000000-0000-4000-8000-000000000002')

    const ui = await $.ui.mount(pane('terminal'))

    expect(await ui.find({ text: /^Pulse · Backend · / })).toBeDefined()

    await ui.press({ key: 'key-u' })
    await started.clock.settle()

    expect(started.calls.slice(2).map(call => [call.tool, call.args.ref ?? call.args.project_name])).toEqual([
      ['open', 'Platform'],
      ['get_timeline', PLATFORM],
    ])
    expect(await ui.find({ text: /^Pulse · Platform · / })).toBeDefined()
  })
})
