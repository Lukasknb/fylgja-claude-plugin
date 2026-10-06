import { describe, expect, test } from 'claude-code/testing'

import { fenced, getMeeting, MEETING_ID, moments, pane, scene, scrub, SURFACES } from './fixtures'

const RETRO = {
  title: 'Engineering Retrospective',
  rows: 130,
  decisions: [{ id: 'd1', what: 'Freeze the schema', start_seconds: 400 }, { id: 'd2', what: 'No moment' }],
}

/**
 * Makes the interactive timeline fail as it can on a real surface: laid
 * out over a region so wide that its drawing passes what a surface module
 * may draw. The engine tells the plugin and draws the pane again.
 */
async function fault(ui: { resize: (size: { columns: number; rows: number }) => Promise<void> }): Promise<void> {
  await ui.resize({ columns: 300_000, rows: 24 }).catch(() => undefined)
}

for (const surface of SURFACES) {
  describe(`the plain pane on ${surface}, after the interactive timeline failed there`, () => {
    test('shows the rows, a still strip, and buttons that move by a row or a window and read ahead', async ($, on) => {
      const started = scene(on, { tool: (tool, args) => getMeeting(RETRO, args) })
      await scrub($, started, MEETING_ID)
      const ui = await $.ui.mount(pane(surface))
      await fault(ui)
      const focus = async (): Promise<string> => ((await ui.find({ type: 'Text', text: /^▶ / }))?.text ?? '').replace(/\s+/g, ' ')

      expect(await ui.find({ type: 'Client' }), 'the timeline that failed is left out').toBeUndefined()
      expect((await ui.find({ type: surface === 'terminal' ? 'Raster' : 'Svg' }))?.type).toBe(surface === 'terminal' ? 'Raster' : 'Svg')
      expect(await focus()).toBe('▶ 00:00 voice 0 line 0')

      await ui.press({ key: 'on' })
      expect(await focus()).toBe('▶ 00:05 voice 1 line 1')
      await ui.press({ key: 'later' })
      expect(await focus()).toBe('▶ 01:45 voice 0 line 21')
      expect(moments(started), 'still far enough from the edge').toEqual([0, 95])
      await ui.press({ key: 'later' })
      expect(await focus(), 'the loaded edge').toBe('▶ 03:10 voice 2 line 38')
      expect(moments(started)).toEqual([0, 95, 190])
      await ui.press({ key: 'later' })
      expect(await focus()).toBe('▶ 04:45 voice 0 line 57')
      await ui.press({ key: 'earlier' })
      await ui.press({ key: 'back' })
      expect(await focus()).toBe('▶ 03:00 voice 0 line 36')
    })

    test('quotes the row at the playhead and goes to a decision that has a moment', async ($, on) => {
      const started = scene(on, { tool: (tool, args) => getMeeting(RETRO, args) })
      await scrub($, started, MEETING_ID)
      const ui = await $.ui.mount(pane(surface))
      await fault(ui)

      expect((await ui.find({ key: 'mark-0' }))?.text).toBe('◆ Freeze the schema')
      expect(await ui.find({ key: 'mark-1' }), 'no button for a decision with nowhere to go').toBeUndefined()

      await ui.press({ key: 'mark-0' })
      expect(((await ui.find({ type: 'Text', text: /^▶ / }))?.text ?? '').replace(/\s+/g, ' ')).toBe('▶ 06:40 voice 2 line 80')

      await ui.press({ key: 'quote' })
      expect(started.fills).toEqual([
        { text: `"line 80" — voice 2, {{fylgja:meeting Engineering Retrospective|${MEETING_ID}}} at 06:40 `, mode: 'insert' },
      ])
      expect(started.forbidden).toEqual([])
    })
  })
}

describe('the strip as a picture', () => {
  test('on the terminal it is two rows of cells as wide as the pane: bands and playhead, then marks', async ($, on) => {
    const started = scene(on, { tool: (tool, args) => getMeeting(RETRO, args) })
    await scrub($, started, `--plain ${MEETING_ID}`)
    const ui = await $.ui.mount(pane('terminal', 60, 24))
    const raster = (await ui.find({ type: 'Raster' }))?.props as { columns: number; rows: number; cells: string }
    const bytes = Uint8Array.from(atob(raster.cells), char => char.charCodeAt(0))
    const words = new DataView(bytes.buffer)
    const glyph = (cell: number): string => String.fromCodePoint(words.getUint32(cell * 12, true))

    expect([raster.columns, raster.rows, bytes.length]).toEqual([60, 2, 60 * 2 * 12])
    expect(glyph(0), 'the playhead is on the first row').toBe('┃')
    expect(glyph(5), 'a loaded stretch').toBe('▆')
    expect(glyph(59), 'the decision at 06:40 is past what is loaded').toBe('┄')
    expect(glyph(60 + 59), 'and marked under the bar').toBe('◆')
    expect(glyph(60 + 5)).toBe(' ')
  })

  test('on the desktop it is a vector image holding shapes only, with words for where it cannot be seen', async ($, on) => {
    const started = scene(on, { tool: (tool, args) => getMeeting({ ...RETRO, title: '<script>alert(1)</script>' }, args) })
    await scrub($, started, `--plain ${MEETING_ID}`)
    const ui = await $.ui.mount(pane('desktop'))
    const svg = (await ui.find({ type: 'Svg' }))?.props as { source: string; alt: string }

    expect(svg.alt).toBe('Timeline: playhead at 00:00 of at least 06:40')
    expect(svg.source).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 600 28"/)
    expect(/script|text|line \d|alert/.test(svg.source), 'no text of the meeting is in the image').toBe(false)
  })
})

for (const surface of ['vscode', 'mobile'] as const) {
  test(`a surface without surface modules (${surface}) gets the plain pane from the start`, async ($, on) => {
    const started = scene(on, { tool: (tool, args) => getMeeting(RETRO, args) })
    await scrub($, started, MEETING_ID)
    const ui = await $.ui.mount({ ...pane('desktop'), surface })

    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect((await ui.find({ type: 'Svg' }))?.type).toBe('Svg')
    expect((await ui.find({ key: 'later' }))?.type).toBe('Button')
  })
}

describe('/scrub alone', () => {
  const TIMELINE = [
    '# Sessions — everything (since 2026-09-22)',
    '',
    '1 sessions, newest first. Use open(<id>) to read one.',
    '',
    '- [2026-10-05] **Fix the stitcher** — Backend',
    '  id: 11111111-1111-4111-8111-111111111111 · repo: /work · branch: main · duration: — · outcome: done',
    '',
    '# Recent meetings',
    '',
    `- 2026-10-05 · meeting · Pricing [sync] · v2 · in Product > Pricing (id: ${MEETING_ID})`,
    '- 2026-10-04 · meeting · Standup (id: 22222222-2222-4222-8222-222222222222)',
    `- 2026-10-04 · meeting · Pricing again (id: ${MEETING_ID})`,
    '- 2026-10-03 · decision · Not a meeting (id: 33333333-3333-4333-8333-333333333333)',
    '- 2026-10-02 · meeting · No id here',
    '',
    '# Changes to the project tree',
  ].join('\n')

  for (const surface of SURFACES) {
    test(`lists the recent meetings on ${surface}; picking one opens it`, async ($, on) => {
      const started = scene(on, { tool: (tool, args) => (tool === 'get_timeline' ? fenced(TIMELINE) : getMeeting(RETRO, args)) })

      expect(await scrub($, started)).toEqual({})
      const ui = await $.ui.mount(pane(surface))

      expect(started.calls).toEqual([{ server: 'plugin:fylgja-lab-scrub:fylgja', tool: 'get_timeline', args: { limit: 50 } }])
      expect((await ui.findAll({ type: 'Button' })).map(button => button.text)).toEqual([
        '2026-10-05  Pricing (sync) - v2',
        '2026-10-04  Standup',
      ])

      await ui.press({ key: `pick-${MEETING_ID}` })
      await started.clock.settle()

      expect(started.calls[1]?.args.meeting_id).toBe(MEETING_ID)
      expect((await ui.find({ in: 'timeline', type: 'Text', text: /^▶ / }))?.text.replace(/\s+/g, ' ')).toBe('▶ 00:00 voice 0 line 0')
    })
  }

  test('with no meetings in the answer, or an answer that is not a list, it says so in one line', async ($, on) => {
    let body = '# Recent meetings\n\nNothing in the last 14 days.'
    const started = scene(on, { tool: () => fenced(body) })

    await scrub($, started)
    let ui = await $.ui.mount(pane('terminal'))
    expect((await ui.find({ type: 'Text' }))?.text).toBe('No recent meetings found. Give one: /scrub <reference, link or id>.')
    await ui.unmount()

    body = ''
    await scrub($, started)
    ui = await $.ui.mount(pane('terminal'))
    expect((await ui.find({ type: 'Text' }))?.text).toBe('Fylgja did not answer. Try again in a moment.')
  })
})
