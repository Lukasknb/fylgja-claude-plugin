import { describe, expect, test } from 'claude-code/testing'

import { answer, aside, hit, idOf, linesOf, pane, PLUGIN, reply, scene, shown } from './fixtures'

const QUESTION = 'what did we decide about retries?'
const MEETING_READ = { include: ['summary', 'decisions', 'key_points'] }

const BAND = {
  plugin: PLUGIN,
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

describe('a follow-up in the pane', () => {
  test('is one more search, and carries the earlier question, answer and cited records, nothing else', async ($, on) => {
    let searches = 0
    const started = scene(on, {
      search: () => {
        searches += 1

        return answer({
          results: searches === 1 ? [hit(1), hit(2), hit(3)] : [hit(2), hit(5)],
        })
      },
      model: request =>
        reply(request.prompt.includes('Earlier question') ? 'Bob owns it [2].' : 'Capped at three [2].'),
    })

    await aside($, QUESTION)
    await started.clock.settle()

    const ui = await pane($)

    expect((await ui.find({ type: 'Input', key: 'ask' }))?.props.label).toBe('Follow up')

    await ui.input({ key: 'ask', text: 'who owns it?', kind: 'change' })
    await ui.input({ key: 'ask', text: 'who owns it?' })
    await started.clock.settle()

    expect(started.callsOf('search').map(call => call.args)).toEqual([
      { query: QUESTION, limit: 8 },
      { query: `${QUESTION} who owns it?`, limit: 8 },
    ])
    expect(
      started.callsOf('get_meeting').map(call => call.args.meeting_id),
      'the record the first answer cited is taken along, not read again',
    ).toEqual([idOf(1), idOf(2), idOf(3), idOf(5)])

    const prompt = started.asked[1]?.prompt ?? ''

    expect(prompt).toMatch('Question: who owns it?')
    expect(prompt).toMatch(`Earlier question: ${QUESTION}`)
    expect(prompt).toMatch('Earlier answer: Capped at three [2].')
    expect(prompt).toMatch('<record n="1" kind="meeting" title="Record 2"')
    expect(prompt).toMatch('<record n="2" kind="meeting" title="Record 5"')
    expect(prompt, 'records the first answer did not cite are not carried').not.toMatch('Record 1')

    const drawn = linesOf(await ui.drawn())

    expect(drawn).toMatch('Aside 2 of 2')
    expect(drawn).toMatch('Q  who owns it?')
    expect(drawn).toMatch(`follows: ${QUESTION}`)
    expect(drawn).toMatch('Bob owns it [2].')
    expect(drawn).toMatch('[2] ◉ Record 5')
    expect((await ui.find({ type: 'Input', key: 'ask' }))?.props.value, 'the field is empty again').toBe('')
    expect(started.forbidden).toEqual([])
  })

  test('after "New thread" the next question follows nothing', async ($, on) => {
    const started = scene(on)

    await aside($, QUESTION)
    await started.clock.settle()

    const ui = await pane($)
    await ui.press({ key: 'fresh' })

    expect((await ui.find({ type: 'Input', key: 'ask' }))?.props.label).toBe('Ask')

    await ui.input({ key: 'ask', text: 'who owns billing?' })
    await started.clock.settle()

    expect(started.callsOf('search')[1]?.args).toEqual({
      query: 'who owns billing?',
      limit: 8,
    })
    expect(started.asked[1]?.prompt).not.toMatch('Earlier')
    expect(started.callsOf('get_meeting'), 'nothing is carried: all three hits are read again').toHaveLength(6)
    expect(linesOf(await ui.drawn())).not.toMatch('follows:')
  })

  test('what is typed survives a redraw, and an empty question asks nothing', async ($, on) => {
    const started = scene(on, {
      model: async (request, clock) => {
        await clock.sleep(100)

        return reply('So [1].')
      },
    })

    await aside($, QUESTION)
    await started.clock.settle()

    const ui = await pane($)
    await ui.input({ key: 'ask', text: 'half a quest', kind: 'change' })
    await started.clock.advance(100)

    expect((await ui.find({ type: 'Input', key: 'ask' }))?.props.value).toBe('half a quest')

    await ui.input({ key: 'ask', text: '   ' })
    await started.clock.settle()

    expect(started.callsOf('search')).toHaveLength(1)
  })

  test('/aside typed again starts a thread of its own', async ($, on) => {
    const started = scene(on)

    await aside($, QUESTION)
    await started.clock.settle()
    await aside($, 'who owns billing?')
    await started.clock.settle()

    expect(started.callsOf('search')[1]?.args).toEqual({
      query: 'who owns billing?',
      limit: 8,
    })
    expect(started.asked[1]?.prompt).not.toMatch('Earlier')
  })
})

describe('this session’s asides', () => {
  test('can be walked back and forth', async ($, on) => {
    const started = scene(on, {
      model: request => reply(`${request.prompt.split('\n')[0]} [1].`),
    })

    await aside($, 'first question')
    await started.clock.settle()
    await aside($, 'second question')
    await started.clock.settle()

    const ui = await pane($)

    expect(linesOf(await ui.drawn())).toMatch('Aside 2 of 2')
    expect(await ui.find({ key: 'newer' })).toBeUndefined()

    await ui.press({ key: 'older' })

    const first = linesOf(await ui.drawn())

    expect(first).toMatch('Aside 1 of 2')
    expect(first).toMatch('Question: first question [1].')
    expect(await ui.find({ key: 'older' })).toBeUndefined()

    await ui.press({ key: 'newer' })

    expect(linesOf(await ui.drawn())).toMatch('Question: second question [1].')
    expect(started.callsOf('search'), 'walking the history searches nothing').toHaveLength(2)
  })

  test('are bounded: the oldest go first', async ($, on) => {
    const started = scene(on)

    for (let n = 1; n <= 23; n += 1) {
      await aside($, `question ${n}`)
      await started.clock.settle()
    }

    const ui = await pane($)

    expect(linesOf(await ui.drawn())).toMatch('Aside 20 of 20')

    for (let n = 0; n < 19; n += 1) {
      await ui.press({ key: 'older' })
    }

    expect(linesOf(await ui.drawn())).toMatch('Q  question 4')
  })
})

describe('the search', () => {
  test('is made exactly once per question, however the pane is drawn and walked', async ($, on) => {
    const started = scene(on)

    await aside($, QUESTION)
    await started.clock.settle()

    for (const surface of ['terminal', 'desktop', 'terminal'] as const) {
      await shown($, surface)
    }

    const ui = await pane($)
    await ui.press({ key: 'hand' })
    await ui.press({ key: 'insert-1-2' })
    await started.clock.advance(120_000)

    expect(started.callsOf('search')).toHaveLength(1)
    expect(started.asked).toHaveLength(1)
  })

  test('is widened only when the person presses for it: one more search, more records read', async ($, on) => {
    const many = Array.from({ length: 12 }, (_, n) => hit(n + 1))
    const started = scene(on, {
      search: args => answer({ results: many.slice(0, Number(args.limit)) }),
      model: () => reply('NONE'),
    })

    await aside($, QUESTION)
    await started.clock.settle()

    const ui = await pane($)

    expect(linesOf(await ui.drawn())).toMatch('What I read (4 records)')

    await ui.press({ key: 'widen' })
    await started.clock.settle()

    expect(started.callsOf('search').map(call => call.args)).toEqual([
      { query: QUESTION, limit: 8 },
      { query: QUESTION, limit: 20 },
    ])

    const drawn = linesOf(await ui.drawn())

    expect(drawn).toMatch('What I read (8 records)')
    expect(drawn).toMatch('Also matched, not read (4):')
    expect(await ui.find({ key: 'widen' }), 'a widened aside is not widened again').toBeUndefined()
  })
})

describe('the prompt box', () => {
  test('gets a reference at the cursor on a press, and is never sent', async ($, on) => {
    const link = `https://fylgja.lknblab.dev/open/topic/${idOf(3)}`
    const started = scene(on, {
      search: () =>
        answer({
          results: [
            hit(1),
            hit(2, { type: 'topic', title: 'Retries' }),
            hit(3, { type: 'topic', title: 'Billing', link }),
          ],
        }),
      model: () => reply('Capped at three [1]. Owned by Bob [3].'),
    })

    await aside($, QUESTION)
    await started.clock.settle()

    const ui = await pane($)
    await ui.press({ key: 'insert-1-1' })
    await ui.press({ key: 'insert-1-2' })
    await ui.press({ key: 'insert-1-3' })
    await ui.press({ key: 'hand' })

    expect(started.fills).toEqual([
      { text: `{{fylgja:meeting Record 1|${idOf(1)}}} `, mode: 'insert' },
      { text: `Fylgja topic ${idOf(2)} `, mode: 'insert' },
      { text: `${link} `, mode: 'insert' },
      {
        text: `See these Fylgja records: {{fylgja:meeting Record 1|${idOf(1)}}} ${link} `,
        mode: 'insert',
      },
    ])
    expect(
      started.fills.some(fill => /Capped|Bob/.test(fill.text)),
      'the answer itself is never handed over',
    ).toBe(false)
    expect(started.forbidden).toEqual([])
  })

  test('hands over everything that was read when nothing was cited', async ($, on) => {
    const started = scene(on, { model: () => reply('NONE') })

    await aside($, QUESTION)
    await started.clock.settle()

    const ui = await pane($)
    await ui.press({ key: 'hand' })

    expect(started.fills[0]?.text).toBe(
      `See these Fylgja records: ${[1, 2, 3].map(n => `{{fylgja:meeting Record ${n}|${idOf(n)}}}`).join(' ')} `,
    )
  })

  test('that cannot take the text is said in the pane', async ($, on) => {
    const started = scene(on, { isFilled: false })

    await aside($, QUESTION)
    await started.clock.settle()

    const ui = await pane($)
    await ui.press({ key: 'hand' })

    expect(linesOf(await ui.drawn())).toMatch('The prompt box is not free right now. Nothing was put in it.')
    expect(started.forbidden).toEqual([])
  })
})

describe('where no pane can be placed', () => {
  test('the band above the prompt shows the aside, until the person closes it', async ($, on) => {
    const started = scene(on, { isPlaced: false })

    await aside($, QUESTION)
    await started.clock.settle()

    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await $.ui.mount({ ...BAND, surface })
      const drawn = linesOf(await band.drawn())

      expect(drawn, surface).toMatch('Record one says so [1].')
      expect(drawn, surface).toMatch('[1] ◉ Record 1')
      await band.unmount()
    }

    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await band.press({ key: 'close' })

    expect(linesOf(await band.drawn())).toBe('engine: AbovePrompt')
    expect(started.callsOf('search')).toHaveLength(1)
  })

  test('the band is left to Claude Code while the pane is placed', async ($, on) => {
    const started = scene(on)

    await aside($, QUESTION)
    await started.clock.settle()

    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })

    expect(linesOf(await band.drawn())).toBe('engine: AbovePrompt')
    expect(await (await pane($)).find({ key: 'close' }), 'the pane has the engine’s own close mark').toBeUndefined()
  })
})

describe('a read by id that names the record', () => {
  test('uses the read the hit names, and the id the hit names for it', async ($, on) => {
    const started = scene(on, {
      search: () =>
        answer({
          results: [
            hit(1, { type: 'atom', resource: { tool: 'open', id: idOf(40) } }),
            hit(2, { resource: undefined }),
            hit(3, {
              type: 'session',
              resource: { tool: 'restructure', id: 'drop table' },
            }),
          ],
        }),
    })

    await aside($, QUESTION)
    await started.clock.settle()

    expect(started.calls.slice(1), 'only the two read tools are ever called').toEqual([
      { tool: 'open', args: { ref: idOf(40) } },
      { tool: 'get_meeting', args: { meeting_id: idOf(2), ...MEETING_READ } },
      { tool: 'open', args: { ref: idOf(3) } },
    ])
  })
})
