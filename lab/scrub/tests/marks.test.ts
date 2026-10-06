import { describe, expect, test } from 'claude-code/testing'

import { clockOf, focusOf, getMeeting, MEETING_ID, moments, pane, scene, scrub, SURFACES } from './fixtures'

/** A meeting whose decisions carry the moment they were made at, as a server that records it would send them. */
const PLACED = {
  title: 'Pricing sync',
  rows: 200,
  decisions: [
    { id: 'd1', what: 'Ship the annual plan first', decided_at: '2026-09-30', start_seconds: 60 },
    { id: 'd2', what: 'Drop the free tier', decided_at: '2026-09-30', start_seconds: 600 },
    { id: 'd3', what: 'Revisit in March', decided_at: '2026-09-30' },
  ],
  action_items: [{ id: 'a1', what: 'Draft the price page', status: 'open', position: 150 }],
}

for (const surface of SURFACES) {
  describe(`decisions and commitments on ${surface}`, () => {
    test('are marked on the bar where their moment is known, and n and p go from one decision to the next', async ($, on) => {
      const started = scene(on, { tool: (tool, args) => getMeeting(PLACED, args) })
      await scrub($, started, MEETING_ID)
      const ui = await $.ui.mount(pane(surface))
      const signs = await ui.find({ in: 'timeline', type: 'Text', text: /◆/ })

      // The second decision was made at 10:00, so the bar spans at least that: 100 cells for 600 seconds.
      expect(await clockOf(ui)).toBe('00:00 of at least 10:00 (the end is found by walking there)')
      expect([...(signs?.text ?? '')].flatMap((sign, cell) => (sign === ' ' ? [] : [`${sign}${cell}`]))).toEqual(['◆10', '◆99'])
      expect(await ui.find({ in: 'timeline', type: 'Text', text: /^┄+$/ }), 'what is not loaded is drawn as such').toBeDefined()

      await ui.key({ key: 'n' })
      expect(await focusOf(ui)).toBe('▶ 01:00 voice 0 line 12')
      expect(started.calls.length, 'that row was loaded').toBe(2)

      await ui.key({ key: 'n' })
      expect(await focusOf(ui), 'the next one is far off: its window is read, once').toBe('▶ 10:00 voice 0 line 120')
      expect(moments(started)).toEqual([0, 95, 600, 695])

      await ui.key({ key: 'n' })
      expect(await focusOf(ui), 'there is no decision after it').toBe('▶ 10:00 voice 0 line 120')

      await ui.key({ key: 'p' })
      expect(await focusOf(ui)).toBe('▶ 01:00 voice 0 line 12')
    })

    test('the list goes to a decision by number or by its button, and says which have no recorded moment', async ($, on) => {
      const started = scene(on, { tool: (tool, args) => getMeeting(PLACED, args) })
      await scrub($, started, MEETING_ID)
      const ui = await $.ui.mount(pane(surface))

      expect((await ui.find({ in: 'timeline', key: 'list' }))?.text).toBe('decisions (3)')
      await ui.key({ key: 'd' })

      expect((await ui.find({ in: 'timeline', key: 'mark-0' }))?.text).toBe('1 ◆ Ship the annual plan first · 01:00')
      expect((await ui.find({ in: 'timeline', key: 'mark-1' }))?.text).toBe('2 ◆ Drop the free tier · 10:00')
      expect((await ui.find({ in: 'timeline', text: /^3 ◆/ }))?.text).toBe('3 ◆ Revisit in March · moment not recorded')
      expect(await ui.find({ in: 'timeline', key: 'mark-2' }), 'nothing to press where there is nowhere to go').toBeUndefined()
      expect((await ui.find({ in: 'timeline', key: 'mark-3' }))?.text).toBe('4 ▸ Draft the price page · not loaded yet')

      await ui.key({ key: '2' })
      expect(await focusOf(ui)).toBe('▶ 10:00 voice 0 line 120')

      await ui.press({ key: 'list' })
      await ui.press({ key: 'mark-0' })
      expect(await focusOf(ui)).toBe('▶ 01:00 voice 0 line 12')

      await ui.key({ key: '3' })
      expect(await focusOf(ui), 'a digit means nothing while the list is closed').toBe('▶ 01:00 voice 0 line 12')
    })

    test('a commitment known only by its row is closed in on with a few reads', async ($, on) => {
      const started = scene(on, { tool: (tool, args) => getMeeting(PLACED, args) })
      await scrub($, started, MEETING_ID)
      const ui = await $.ui.mount(pane(surface))

      await ui.key({ key: 'd' })
      await ui.key({ key: '4' })

      expect(await focusOf(ui)).toBe('▶ 12:30 voice 0 line 150')
      expect(started.calls.length, 'the first two, one guess that landed, one read ahead').toBe(4)
    })

    test('after a jump, a click on a part of the bar that is not loaded reads that moment when the button comes up', async ($, on) => {
      const started = scene(on, { tool: (tool, args) => getMeeting(PLACED, args) })
      await scrub($, started, MEETING_ID)
      const ui = await $.ui.mount(pane(surface))

      await ui.key({ key: 'n' })
      await ui.key({ key: 'n' })
      expect(await clockOf(ui)).toBe('10:00 of at least 13:10 (the end is found by walking there)')

      const reads = started.calls.length

      // 790 seconds over 100 cells: cell 10 is about 01:23, which was dropped when the run moved.
      await ui.pointer({ type: 'down', x: 10, y: 2, button: 'left' })
      expect(await ui.find({ in: 'timeline', type: 'Text', text: /^┆$/ }), 'a ghost mark shows where it will go').toBeDefined()
      expect(started.calls.length, 'nothing is read while the button is held').toBe(reads)
      await ui.pointer({ type: 'move', x: 12, y: 2, button: 'left' })
      await ui.pointer({ type: 'up', x: 12, y: 2, button: 'left' })

      expect(started.calls.length, 'one read for the moment, one ahead').toBe(reads + 2)
      expect(await focusOf(ui)).toBe('▶ 01:40 voice 2 line 20')
    })
  })
}
