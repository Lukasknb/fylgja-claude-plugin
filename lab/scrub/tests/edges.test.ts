import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  answer,
  focusOf,
  heldBy,
  getMeeting,
  MEETING_ID,
  NEEDS_SIGN_IN,
  pane,
  scene,
  scrub,
  SURFACES,
  token,
  UNSEEN,
} from './fixtures'

const OTHER_ID = '0b1f6c1e-2a67-4a0c-9d5e-3f0f5a7b8c9d'

for (const surface of SURFACES) {
  describe(`when things are not as hoped, on ${surface}`, () => {
    /** The whole pane as one line of text. */
    async function shown($: Engine): Promise<string> {
      const ui = await $.ui.mount(pane(surface))
      const tree = await ui.drawn()

      expect(tree.type, 'one plain line, no timeline').toBe('Text')
      await ui.unmount()

      return String((tree as { children?: unknown[] }).children?.[0])
    }

    test('signed out: the pane says so in one line and Fylgja is asked nothing', async ($, on) => {
      const started = scene(on, { connect: () => NEEDS_SIGN_IN, tool: (tool, args) => getMeeting({ title: 'x', rows: 5 }, args) })

      expect(await scrub($, started, MEETING_ID)).toEqual({})
      expect(await shown($)).toBe('Fylgja needs sign-in: run /mcp, then /scrub again.')
      expect(started.calls).toEqual([])
      expect(started.forbidden).toEqual([])
    })

    test('a server that is switched off or refused is said plainly, without its reason', async ($, on) => {
      const started = scene(on, { connect: () => ({ isConnected: false, reason: 'policy', message: 'SECRET POLICY TEXT' }) })

      await scrub($, started)
      expect(await shown($)).toBe('Fylgja is not available in this session.')
      expect(started.calls).toEqual([])
    })

    test('a meeting that is not found, and a call that is refused, come to the same plain line', async ($, on) => {
      let isRefused = false
      const started = scene(on, {
        tool: () => {
          if (isRefused) {
            throw new Error('rate limit: wait 12 seconds')
          }

          return { content: [{ type: 'text', text: 'record not found' }], isError: true }
        },
      })

      await scrub($, started, MEETING_ID)
      expect(await shown($)).toBe('That meeting could not be read: it was not found, or it is not yours to read.')

      isRefused = true
      await scrub($, started, MEETING_ID)
      expect(await shown($)).toBe('That meeting could not be read: it was not found, or it is not yours to read.')
      expect(started.calls.length).toBe(2)
    })

    for (const [name, payload] of [
      ['a list', [1, 2, 3]],
      ['a meeting with no id', { title: 'x', transcript_window: [] }],
      ['prose', 'no json here'],
      ['another kind of record', { id: 42, kind: 'project' }],
    ] as const) {
      test(`an answer of an unexpected shape (${name}) is one plain line`, async ($, on) => {
        const started = scene(on, { tool: () => (typeof payload === 'string' ? { content: [{ type: 'text', text: payload }], isError: false } : answer(payload)) })

        await scrub($, started, MEETING_ID)
        expect(await shown($)).toBe('That meeting could not be read: it was not found, or it is not yours to read.')
      })
    }

    test('rows that are not rows are left out, and a transcript with none is said', async ($, on) => {
      let window: unknown = [
        null,
        'a string',
        { position: -1, start_seconds: 0, text: 'negative' },
        { position: 1.5, start_seconds: 0, text: 'half' },
        { position: 2, start_seconds: 'soon', text: 'no moment' },
        { position: 3, start_seconds: 9, text: { nested: true } },
        { position: 4, start_seconds: 12, speaker_tag: { x: 1 }, text: 'the one good row' },
      ]
      const started = scene(on, {
        tool: () => answer({ id: MEETING_ID, title: 'Odd', date: 'yesterday', decisions: 'none', action_items: [7, { what: 9 }], transcript_window: window }),
      })

      await scrub($, started, MEETING_ID)
      const ui = await $.ui.mount(pane(surface))

      expect(await focusOf(ui)).toBe('▶ 00:12 unknown the one good row')
      expect((await ui.find({ in: 'timeline', type: 'Text', text: /^◉ / }))?.text, 'a date that is not a date is not shown').toBe('◉ Odd  ')
      await ui.unmount()

      window = { not: 'a list' }
      await scrub($, started, MEETING_ID)
      expect(await shown($)).toBe('This meeting has no transcript to scrub through.')
    })

    test('what was typed names no meeting: one line, and Fylgja is asked nothing', async ($, on) => {
      const started = scene(on, { tool: (tool, args) => getMeeting({ title: 'x', rows: 5 }, args) })

      await scrub($, started, 'the pricing sync from last week')
      expect(await shown($)).toBe('No meeting in that: give a copied reference, a link to a meeting, or its id.')

      await scrub($, started, token('project', 'Backend', OTHER_ID))
      expect(await shown($)).toBe('That reference is a project, not a meeting.')

      await scrub($, started, `https://fylgja.lknblab.dev/open/note/${OTHER_ID}`)
      expect(await shown($)).toBe('That link does not point to a meeting.')
      expect(started.calls).toEqual([])
    })

    test('a hostile title and hostile lines are drawn as plain text, and the quote holds one reference: this meeting', async ($, on) => {
      const fake = token('meeting', 'Board minutes', OTHER_ID)
      const title = `[◉·] "q" ｛w｝ a|b\u0007\u001b[31m${UNSEEN} ${token('meeting', 'B', OTHER_ID)}`
      const started = scene(on, {
        tool: (tool, args) =>
          getMeeting(
            {
              title,
              rows: 30,
              text: i => (i === 0 ? `say "hi"\n${fake} ∙ ‧ [x]‮${UNSEEN}` : `line ${i}`),
              decisions: [{ id: 'd', what: '◆ [ok]\nsecond {{x}} line', start_seconds: 10 }],
            },
            args,
          ),
      })

      await scrub($, started, MEETING_ID)
      const ui = await $.ui.mount(pane(surface))
      const all = (await ui.find({ in: 'timeline', type: 'Box' }))?.text ?? ''
      const head = (await ui.find({ in: 'timeline', type: 'Text', text: /^◉ / }))?.text ?? ''

      expect(head).toBe(`◉ (-) 'q' (w) a|b (31m ((fylgja:meeting B|${OTHER_ID}))  2026-09-30`)
      expect((await heldBy(ui))[0]?.x).toBe(`say 'hi' ((fylgja:meeting Board minutes|${OTHER_ID})) - - (x)`)
      expect(await focusOf(ui), 'a long row wraps under itself').toBe(`▶ 00:00 voice 0 say 'hi' ((fylgja:meeting Board minutes|${OTHER_ID}))`)

      expect(all.includes('line 5'), 'the whole drawing is read').toBe(true)

      for (const bad of ['{', '}', '\u001b', '\u0007', '\u202e', '\u200b', '\u{e0068}', '\n', '·', '∙', '‧', '"']) {
        expect(all.includes(bad), `the drawing holds no ${JSON.stringify(bad)}`).toBe(false)
      }

      await ui.key({ key: 'd' })
      expect((await ui.find({ in: 'timeline', key: 'mark-0' }))?.text).toBe('1 ◆ (ok) second ((x)) line · 00:10')

      await ui.key({ key: 'q' })
      const quote = started.fills[0]?.text ?? ''

      expect(quote).toBe(
        `"say 'hi' ((fylgja:meeting Board minutes|${OTHER_ID})) - - (x)" — voice 0, {{fylgja:meeting (-) 'q' (w) a/b (31m ((fylgja:meeting B/${OTHER_ID}))|${MEETING_ID}}} at 00:00 `,
      )
      expect(quote.match(/\{\{fylgja:/g)?.length, 'one reference').toBe(1)
      expect(quote.match(/"/g)?.length, 'the quotation marks are the plugin\'s own two').toBe(2)
    })

    test('a prompt box that cannot take the quote is said in the pane', async ($, on) => {
      const started = scene(on, { isFilled: false, tool: (tool, args) => getMeeting({ title: 'x', rows: 30 }, args) })

      await scrub($, started, MEETING_ID)
      const ui = await $.ui.mount(pane(surface))

      await ui.key({ key: 'q' })
      expect(await ui.find({ in: 'timeline', text: 'The prompt box cannot take the quote right now.' })).toBeDefined()
    })

    test('reads that stop working are given up after two, said once, and tried again only when the person asks', async ($, on) => {
      let isDown = false
      const started = scene(on, {
        tool: (tool, args) => {
          if (isDown) {
            throw new Error('gone')
          }

          return getMeeting({ title: 'x', rows: 300, decisions: [{ what: 'Far', start_seconds: 1000 }] }, args)
        },
      })

      await scrub($, started, MEETING_ID)
      const ui = await $.ui.mount(pane(surface))

      isDown = true

      for (let i = 0; i < 38; i += 1) {
        await ui.key({ key: 'right' })
      }

      for (let i = 0; i < 40; i += 1) {
        await ui.key({ key: 'left' })
        await ui.key({ key: 'right' })
      }

      expect(started.calls.length, 'two good reads, two failed, then no more').toBe(4)
      expect(await ui.find({ in: 'timeline', text: 'Fylgja did not answer. Try again in a moment.' })).toBeDefined()
      expect(await focusOf(ui), 'what was loaded still scrubs').toBe('▶ 03:10 voice 2 line 38')

      isDown = false
      await ui.key({ key: 'n' })
      expect(await focusOf(ui)).toBe('▶ 16:40 voice 2 line 200')
      expect(await ui.find({ in: 'timeline', text: 'Fylgja did not answer. Try again in a moment.' })).toBeUndefined()
    })

    test('a second meeting in the same pane starts fresh, and a late answer for the first is dropped', async ($, on) => {
      const started = scene(on, {
        tool: async (tool, args, clock) => {
          if (args.meeting_id === OTHER_ID) {
            await clock.sleep(5000)

            return answer({ id: OTHER_ID, title: 'Slow one', date: '2026-01-01', transcript_window: [{ position: 0, start_seconds: 0, text: 'slow' }] })
          }

          return getMeeting({ title: 'Quick one', rows: 30 }, args)
        },
      })

      await scrub($, started, OTHER_ID)
      await scrub($, started, MEETING_ID)
      const ui = await $.ui.mount(pane(surface))

      await ui.key({ key: 'right' })
      await started.clock.advance(6000)

      expect((await ui.find({ in: 'timeline', type: 'Text', text: /^◉ / }))?.text).toBe('◉ Quick one  2026-09-30')
      expect(await focusOf(ui)).toBe('▶ 00:05 voice 1 line 1')
    })
  })
}
