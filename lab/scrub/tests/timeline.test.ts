import { describe, expect, test } from 'claude-code/testing'

import { clockOf, focusOf, getMeeting, heldBy, MEETING_ID, moments, pane, scene, scrub, SERVER, SURFACES, token } from './fixtures'

const RETRO = { title: 'Engineering Retrospective', rows: 130 }

for (const surface of SURFACES) {
  describe(`the timeline on ${surface}`, () => {
    for (const [how, typed] of [
      ['a pasted reference', token('meeting', 'A label somebody pasted', MEETING_ID)],
      ['a link', `https://fylgja.lknblab.dev/open/meeting/${MEETING_ID}`],
      ['an id', MEETING_ID.toUpperCase()],
    ] as const) {
      test(`opens on the first row from ${how}, with one read and one read ahead`, async ($, on) => {
        const started = scene(on, { tool: (tool, args) => getMeeting(RETRO, args) })

        expect(await scrub($, started, typed), 'the command prints nothing for Claude to read').toEqual({})

        const ui = await $.ui.mount(pane(surface))

        expect(started.calls).toEqual([
          {
            server: SERVER,
            tool: 'get_meeting',
            args: { meeting_id: MEETING_ID, include: ['decisions', 'action_items', 'transcript_window'], around_seconds: 0 },
          },
          { server: SERVER, tool: 'get_meeting', args: { meeting_id: MEETING_ID, include: ['transcript_window'], around_seconds: 95 } },
        ])
        expect((await ui.find({ in: 'timeline', type: 'Text', text: /^◉ / }))?.text).toBe('◉ Engineering Retrospective  2026-09-30')
        expect(await focusOf(ui)).toBe('▶ 00:00 voice 0 line 0')
        expect(await clockOf(ui)).toBe('00:00 of at least 03:10 (the end is found by walking there)')
        expect(started.forbidden).toEqual([])
      })
    }

    test('the arrow keys move a row, shift or the brackets ten, and no key reads the server by itself', async ($, on) => {
      const started = scene(on, { tool: (tool, args) => getMeeting(RETRO, args) })
      await scrub($, started, MEETING_ID)
      const ui = await $.ui.mount(pane(surface))
      const reads = started.calls.length

      await ui.key({ key: 'right' })
      expect(await focusOf(ui)).toBe('▶ 00:05 voice 1 line 1')
      await ui.key({ key: 'right', shift: true })
      expect(await focusOf(ui)).toBe('▶ 00:55 voice 2 line 11')
      await ui.key({ key: ']' })
      expect(await focusOf(ui)).toBe('▶ 01:45 voice 0 line 21')
      await ui.key({ key: 'left' })
      await ui.key({ key: '[' })
      expect(await focusOf(ui)).toBe('▶ 00:50 voice 1 line 10')
      await ui.key({ key: 'left', shift: true })
      await ui.key({ key: 'left' })
      expect(await focusOf(ui), 'the first row is an edge').toBe('▶ 00:00 voice 0 line 0')

      expect(started.calls.length, 'thirty-nine rows were loaded and none of this left them').toBe(reads)
    })

    test('walking to the end reads one window per stretch, never one per key, and finds the end by getting there', async ($, on) => {
      const started = scene(on, { tool: (tool, args) => getMeeting(RETRO, args) })
      await scrub($, started, MEETING_ID)
      const ui = await $.ui.mount(pane(surface))

      for (let i = 0; i < 160; i += 1) {
        await ui.key({ key: 'right' })
      }

      expect(await focusOf(ui)).toBe('▶ 10:45 voice 0 line 129')
      expect(await clockOf(ui), 'the last window brought nothing new, so this is the end').toBe('10:45 of 10:45')
      expect(started.calls.length, '160 keys, 8 reads').toBe(8)
      expect(new Set(moments(started)).size, 'no moment is read twice').toBe(8)

      await ui.key({ key: 'home' })
      expect(await focusOf(ui)).toBe('▶ 00:00 voice 0 line 0')
      await ui.key({ key: 'end' })
      expect(await focusOf(ui)).toBe('▶ 10:45 voice 0 line 129')
      expect(started.calls.length).toBe(8)
    })

    test('the next window is asked for before the playhead reaches the loaded edge', async ($, on) => {
      const started = scene(on, { tool: (tool, args) => getMeeting(RETRO, args) })
      await scrub($, started, MEETING_ID)
      const ui = await $.ui.mount(pane(surface))

      // Rows 0 to 38 are loaded. Row 29 is still nine rows from the edge.
      for (let i = 0; i < 29; i += 1) {
        await ui.key({ key: 'right' })
      }

      expect(started.calls.length).toBe(2)
      await ui.key({ key: 'right' })
      expect(await focusOf(ui)).toBe('▶ 02:30 voice 0 line 30')
      expect(moments(started), 'eight rows before the edge the rows after it are read').toEqual([0, 95, 190])
    })

    test('only a bounded stretch of the transcript is held, and walking back reads it again', async ($, on) => {
      const started = scene(on, { tool: (tool, args) => getMeeting({ title: 'Long', rows: 400 }, args) })
      await scrub($, started, MEETING_ID)
      const ui = await $.ui.mount(pane(surface))

      for (let i = 0; i < 300; i += 1) {
        await ui.key({ key: 'right' })
      }

      const held = await heldBy(ui)

      expect(await focusOf(ui)).toBe('▶ 25:00 voice 0 line 300')
      expect(held.length).toBe(200)
      expect(held[0]?.p).toBeGreaterThan(100)

      const reads = started.calls.length

      await ui.key({ key: 'home' })
      expect(started.calls.length, 'the edge is not the start of the meeting, so the rows before it are read').toBe(reads + 1)
    })

    test('play steps through the rows at a readable pace, faster on the speed key, and stops on the same key', async ($, on) => {
      const started = scene(on, {
        tool: (tool, args) =>
          getMeeting({ ...RETRO, text: i => (i === 2 ? 'a much longer thing to say, which takes a reader a little while to get through' : `line ${i}`) }, args),
      })
      await scrub($, started, MEETING_ID)
      const ui = await $.ui.mount(pane(surface))

      await ui.advance(5000)
      expect(await focusOf(ui), 'nothing moves until asked').toBe('▶ 00:00 voice 0 line 0')

      await ui.key({ key: ' ' })
      expect((await ui.find({ in: 'timeline', key: 'play' }))?.text).toBe('pause')
      await ui.advance(1000)
      expect(await focusOf(ui)).toBe('▶ 00:00 voice 0 line 0')
      await ui.advance(200)
      expect(await focusOf(ui)).toBe('▶ 00:05 voice 1 line 1')
      await ui.advance(1200)
      expect(await focusOf(ui)).toMatch(/^▶ 00:10 voice 2 a much longer thing/)
      await ui.advance(1200)
      expect(await focusOf(ui), 'a longer row is held longer').toMatch(/^▶ 00:10 voice 2/)
      await ui.advance(3200)
      expect(await focusOf(ui)).toBe('▶ 00:15 voice 0 line 3')

      await ui.key({ key: 's' })
      await ui.advance(600)
      expect(await focusOf(ui), 'twice as fast').toBe('▶ 00:20 voice 1 line 4')

      await ui.key({ key: ' ' })
      await ui.advance(10_000)
      expect(await focusOf(ui), 'paused').toBe('▶ 00:20 voice 1 line 4')
      expect((await ui.find({ in: 'timeline', key: 'play' }))?.text).toBe('play')
    })

    test('play reads ahead as it goes and stops by itself at the end of the meeting', async ($, on) => {
      const started = scene(on, { tool: (tool, args) => getMeeting({ title: 'Short', rows: 50 }, args) })
      await scrub($, started, MEETING_ID)
      const ui = await $.ui.mount(pane(surface))

      await ui.press({ key: 'play' })
      await ui.press({ key: 'speed' })
      await ui.press({ key: 'speed' })

      for (let i = 0; i < 80; i += 1) {
        await ui.advance(400)
      }

      expect(await focusOf(ui)).toBe('▶ 04:05 voice 1 line 49')
      expect(await clockOf(ui)).toBe('04:05 of 04:05  4×')
      expect((await ui.find({ in: 'timeline', key: 'play' }))?.text).toBe('play')
      expect(started.calls.length, 'four windows for fifty rows').toBe(4)
    })

    test('the quote key fills the prompt box with the row, who said it, the reference and the moment, and submits nothing', async ($, on) => {
      const started = scene(on, { tool: (tool, args) => getMeeting(RETRO, args) })
      await scrub($, started, MEETING_ID)
      const ui = await $.ui.mount(pane(surface))

      await ui.key({ key: 'right', shift: true })
      await ui.key({ key: 'q' })

      expect(started.fills).toEqual([
        { text: `"line 10" — voice 1, {{fylgja:meeting Engineering Retrospective|${MEETING_ID}}} at 00:50 `, mode: 'insert' },
      ])

      await ui.key({ key: 'right' })
      await ui.press({ key: 'quote' })

      expect(await ui.find({ in: 'timeline', text: /prompt box/ }), 'nothing to say when it worked').toBeUndefined()
      expect(started.fills[1]?.text).toBe(`"line 11" — voice 2, {{fylgja:meeting Engineering Retrospective|${MEETING_ID}}} at 00:55 `)
      expect(started.forbidden, 'never submitted').toEqual([])
    })

    test('a click on a transcript row puts the playhead there; a click or a drag on the bar moves it through what is loaded', async ($, on) => {
      const started = scene(on, { tool: (tool, args) => getMeeting(RETRO, args) })
      await scrub($, started, MEETING_ID)
      const ui = await $.ui.mount(pane(surface))
      const reads = started.calls.length

      // The bar is 100 cells for the 190 seconds seen so far. Cell 50 is 01:35.
      await ui.pointer({ type: 'down', x: 50, y: 2, button: 'left' })
      await ui.pointer({ type: 'up', x: 50, y: 2, button: 'left' })
      expect(await focusOf(ui)).toBe('▶ 01:35 voice 1 line 19')

      await ui.pointer({ type: 'down', x: 50, y: 2, button: 'left' })
      await ui.pointer({ type: 'move', x: 20, y: 9, button: 'left' })
      expect(await focusOf(ui), 'the playhead follows the drag, off the bar too').toBe('▶ 00:40 voice 2 line 8')
      await ui.pointer({ type: 'move', x: -30, y: 2, button: 'left' })
      await ui.pointer({ type: 'up', x: -30, y: 2, button: 'left' })
      expect(await focusOf(ui), 'past the left edge is the start').toBe('▶ 00:00 voice 0 line 0')

      await ui.pointer({ type: 'move', x: 80, y: 2 })
      expect(await focusOf(ui), 'a pointer that only passes over moves nothing').toBe('▶ 00:00 voice 0 line 0')

      // The transcript starts on row 6; the row at the playhead takes three rows of it.
      await ui.key({ key: 'right', shift: true })
      const below = await ui.find({ in: 'timeline', text: /line 13$/ })
      expect(below).toBeDefined()
      await ui.pointer({ type: 'down', x: 30, y: 6 + 7 + 3 + 2, button: 'left' })
      expect(await focusOf(ui)).toBe('▶ 01:05 voice 1 line 13')

      expect(started.calls.length, 'all of it within what was loaded').toBe(reads)
    })
  })
}
