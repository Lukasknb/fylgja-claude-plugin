import { describe, expect, test } from 'claude-code/testing'

import { tokensIn } from '../hooks/token'
import {
  BAND,
  bandProps,
  hit,
  hits,
  idOf,
  key,
  linesOf,
  NEEDS_SIGN_IN,
  paste,
  PRICING,
  RETRO,
  scene,
  SESSION,
  STANDUP,
  SURFACES,
  timeline,
  token,
  type,
  UNSEEN,
} from './fixtures'

const ENGINE = { type: 'Text', props: {}, children: ['engine'] }

const RECENT = [
  '› 1: ◉ Engineering Retrospective 2026-10-05',
  '1: ◉ Pricing sync 2026-10-02'.replace('1:', '2:'),
  '3: ◉ Standup 2026-10-01',
]

const FOUND = [
  hit('meeting', 'Retro planning', idOf(10)),
  hit('atom', 'A fact about retros', idOf(11)),
  hit('person', 'Reto', idOf(12)),
  hit('session', 'Retro tooling', idOf(13)),
  hit('topic', 'Retros', idOf(14)),
  hit('note', 'Retro notes', idOf(15), null),
  hit('project', 'Retro', idOf(16)),
]

describe('the list above the prompt', () => {
  for (const surface of SURFACES) {
    test(`on ${surface}: nothing until a trigger is typed, then the most recent meetings`, async ($, on) => {
      const started = scene(on)

      await $.session.start(SESSION)
      const ui = await $.ui.mount({ ...BAND, surface, props: bandProps() })

      await type($, started, 'see what we said in ')
      await started.clock.advance(60_000)

      expect(await ui.drawn(), 'closed, the band is Claude Code’s own').toEqual(ENGINE)
      expect([started.calls, started.reads()]).toEqual([[], 0])

      await type($, started, '@@')

      expect(started.calls, 'the keystroke itself asked nothing').toEqual([])

      await started.clock.settle()

      expect(started.calls.map(call => [call.tool, call.args])).toEqual([['get_timeline', {}]])
      expect(await linesOf(ui)).toEqual(RECENT)
      expect(started.forbidden).toEqual([])
    })

    test(`on ${surface}: a search waits for the typing to pause, and lists only what a reference can name`, async ($, on) => {
      const started = scene(on, { search: query => hits(FOUND, query) })
      const ui = await $.ui.mount({ ...BAND, surface, props: bandProps() })

      await type($, started, '{{')
      await started.clock.settle()
      await type($, started, 'r')
      await started.clock.advance(60_000)

      expect(started.searched(), 'one letter is never searched').toEqual([])
      expect(await linesOf(ui), 'it narrows the recent meetings instead').toEqual([
        '› ◉ Engineering Retrospective 2026-10-05',
        '◉ Pricing sync 2026-10-02',
      ])

      await type($, started, 'e')
      await started.clock.advance(300)
      await type($, started, 't')
      await started.clock.advance(399)

      expect(started.searched(), 'each key starts the wait again').toEqual([])
      expect(await linesOf(ui), 'a first guess from the recent meetings meanwhile').toEqual([
        '› ◉ Engineering Retrospective 2026-10-05',
      ])

      await started.clock.advance(1)

      expect(started.calls.at(-1)).toEqual({
        tool: 'search',
        args: { query: 'ret', limit: 20 },
        at: 60_700,
      })
      expect(started.searched()).toEqual(['ret'])
      expect(await linesOf(ui)).toEqual([
        '› ◉ Retro planning 2026-09-30',
        '⌁ Retro tooling 2026-09-30',
        '✎ Retro notes',
        '▤ Retro 2026-09-30',
      ])
    })
  }

  test('a search the person typed past is never sent, and two searches are never close together', async ($, on) => {
    const started = scene(on, {
      search: async (query, clock) => {
        await clock.sleep(2000)

        return hits([hit('meeting', `About ${query}`, idOf(20))], query)
      },
    })
    const ui = await $.ui.mount({
      ...BAND,
      surface: 'terminal',
      props: bandProps(),
    })

    await type($, started, '@@ab')
    await started.clock.advance(600)
    await type($, started, 'c')
    await started.clock.advance(600)
    await type($, started, 'd')
    await started.clock.advance(1100)

    expect(started.searched(), 'one search at a time: the next waits for the answer').toEqual(['ab'])

    await started.clock.advance(100)

    expect(started.searched(), '"abc" was typed past while it waited').toEqual(['ab', 'abcd'])

    await started.clock.advance(2000)

    expect(await linesOf(ui)).toEqual(['› 1: ◉ About abcd 2026-09-30'])

    await type($, started, 'e')
    await started.clock.advance(60_000)

    const times = started.calls.filter(call => call.tool === 'search').map(call => call.at)

    expect(started.searched()).toEqual(['ab', 'abcd', 'abcde'])
    expect(times.every((at, index) => index === 0 || at - (times[index - 1] ?? 0) >= 1100)).toBe(true)
  })

  test('an answer is kept: deleting a letter and typing it again asks nothing', async ($, on) => {
    const started = scene(on, {
      search: query => hits([hit('meeting', `About ${query}`, idOf(20))], query),
    })
    const ui = await $.ui.mount({
      ...BAND,
      surface: 'terminal',
      props: bandProps(),
    })

    await type($, started, '@@ret')
    await started.clock.advance(400)
    await key($, started, { key: 'backspace' })
    await type($, started, 't')

    expect(await linesOf(ui), 'at once, with no wait').toEqual(['› 1: ◉ About ret 2026-09-30'])

    await started.clock.advance(60_000)

    expect(started.searched()).toEqual(['ret'])
  })

  test('a paste opens the list as typing does, and a pasted reference opens nothing', async ($, on) => {
    const started = scene(on, { search: query => hits(FOUND, query) })
    const ui = await $.ui.mount({
      ...BAND,
      surface: 'terminal',
      props: bandProps(),
    })
    const pasted = token('meeting', 'Standup', idOf(3))

    const box = await paste($, started, `${pasted} `)
    await started.clock.advance(60_000)

    expect(await ui.drawn()).toEqual(ENGINE)
    expect(started.calls).toEqual([])
    expect(box.decorations?.map(run => box.text.slice(run.start, run.end))).toEqual([
      '{{fylgja:',
      'meeting Standup',
      `|${idOf(3)}}}`,
    ])

    await paste($, started, '@@retro')
    await started.clock.advance(400)

    expect(started.searched()).toEqual(['retro'])
    expect((await linesOf(ui))[0]).toBe('› 1: ◉ Retro planning 2026-09-30')
  })
})

describe('choosing', () => {
  test('a digit after @@ puts the reference in place of the trigger, painted, the cursor after it', async ($, on) => {
    const started = scene(on)
    const ui = await $.ui.mount({
      ...BAND,
      surface: 'terminal',
      props: bandProps(),
    })

    await type($, started, 'compare with @@')
    await started.clock.settle()
    const box = await type($, started, '2')
    const reference = token('meeting', 'Pricing sync', PRICING.id)

    expect(box.text).toBe(`compare with ${reference} `)
    expect(box.cursor).toBe(box.text.length)
    expect(box.decorations).toEqual([
      { start: 13, end: 22, dimColor: true },
      { start: 22, end: 13 + reference.indexOf('|'), bold: true },
      {
        start: 13 + reference.indexOf('|'),
        end: 13 + reference.length,
        dimColor: true,
      },
    ])
    expect(box.text.slice(22, 13 + reference.indexOf('|'))).toBe('meeting Pricing sync')
    expect(await ui.drawn(), 'and the list is gone').toEqual(ENGINE)
    expect(started.fills, 'the answer to the key carries the new draft: nothing is written a second time').toEqual([])

    const later = await type($, started, 'and tell me')

    expect(later.decorations?.length, 'the paint stays on later edits').toBe(3)
    expect(started.searched()).toEqual([])
  })

  test('a digit chooses from a search’s answer, and only once the answer is on screen', async ($, on) => {
    const started = scene(on, { search: query => hits(FOUND, query) })

    await type($, started, '@@ret')
    const early = await type($, started, '4')

    expect(early.text, 'typed ahead of the answer, a digit is part of the query').toBe('@@ret4')

    await key($, started, { key: 'backspace' })
    await started.clock.advance(400)
    const box = await type($, started, '4')

    expect(box.text).toBe(`${token('project', 'Retro', idOf(16))} `)
    expect(started.searched()).toEqual(['ret'])
  })

  test('after {{ a digit is a letter like any other, so a title with a number can be searched', async ($, on) => {
    const started = scene(on, {
      search: query => hits([hit('meeting', 'Q3 planning', idOf(30))], query),
    })
    const ui = await $.ui.mount({
      ...BAND,
      surface: 'terminal',
      props: bandProps(),
    })

    await type($, started, '{{')
    await started.clock.settle()

    expect((await linesOf(ui))[1], 'no number is shown where no digit chooses').toBe('◉ Pricing sync 2026-10-02')

    await type($, started, '2')
    await type($, started, 'q3')
    await key($, started, { key: 'backspace' })
    await key($, started, { key: 'backspace' })
    await key($, started, { key: 'backspace' })
    await type($, started, 'q3')
    await started.clock.advance(400)

    expect(started.box.text).toBe('{{q3')
    expect(started.searched()).toEqual(['q3'])
    expect(await linesOf(ui)).toEqual(['› ◉ Q3 planning 2026-09-30'])
  })

  test('Down and Up move the highlight; Tab or Enter chooses the highlighted record; all four are consumed', async ($, on) => {
    const started = scene(on)
    const ui = await $.ui.mount({
      ...BAND,
      surface: 'terminal',
      props: bandProps(),
    })

    await type($, started, 'a {{')
    await started.clock.settle()
    const reached = started.edits()

    await key($, started, { key: 'down' })
    await key($, started, { key: 'down' })

    expect(await linesOf(ui)).toEqual([
      '◉ Engineering Retrospective 2026-10-05',
      '◉ Pricing sync 2026-10-02',
      '› ◉ Standup 2026-10-01',
    ])

    await key($, started, { key: 'down' })
    await key($, started, { key: 'up' })

    expect((await linesOf(ui))[2], 'around the ends').toBe('› ◉ Standup 2026-10-01')

    const box = await key($, started, { key: 'tab' })

    expect(box.text).toBe(`a ${token('meeting', 'Standup', STANDUP.id)} `)
    expect(box.cursor).toBe(box.text.length)
    expect(box.decorations?.length).toBe(3)
    expect(started.edits(), 'none of the five keys reached the composer').toBe(reached)

    await type($, started, 'and @@')
    const entered = await key($, started, { key: 'return' })

    expect(entered.text.endsWith(`and ${token('meeting', 'Engineering Retrospective', RETRO.id)} `)).toBe(true)
  })

  test('with no list open, Tab, Enter, the arrows and Escape are the composer’s as before', async ($, on) => {
    const started = scene(on)

    await type($, started, 'hello')

    for (const name of ['tab', 'return', 'up', 'down', 'escape']) {
      await key($, started, { key: name })
    }

    expect(started.edits()).toBe(10)
    expect(started.box.text).toBe('hello')

    await type($, started, ' @@')
    await started.clock.settle()
    const reached = started.edits()

    await key($, started, { key: 'return', shift: true })
    await key($, started, { key: 'left' })

    expect(started.edits(), 'a line break and a cursor move are not the list’s').toBe(reached + 2)
  })

  test('a click on a row replaces the trigger through the prompt’s own calls', async ($, on) => {
    const started = scene(on)
    const ui = await $.ui.mount({
      ...BAND,
      surface: 'desktop',
      props: bandProps(),
    })

    await type($, started, 'see @@')
    await started.clock.settle()
    await type($, started, 'pri')

    expect(await linesOf(ui)).toEqual(['› ◉ Pricing sync 2026-10-02'])

    await ui.press({ key: 'pick-1' })

    const reference = token('meeting', 'Pricing sync', PRICING.id)

    expect(started.fills.map(fill => [fill.text, fill.mode])).toEqual([[`see ${reference} `, 'replace']])
    expect(started.fills[0]?.decorations?.length).toBe(3)
    expect(started.box).toEqual({
      text: `see ${reference} `,
      cursor: `see ${reference} `.length,
    })
    expect(await ui.drawn()).toEqual(ENGINE)
    expect(started.searched(), 'the search that was waiting is not sent').toEqual([])
  })

  test('a click when the draft has moved on puts the reference in at the cursor instead', async ($, on) => {
    const started = scene(on)
    const ui = await $.ui.mount({
      ...BAND,
      surface: 'terminal',
      props: bandProps(),
    })

    await type($, started, '@@')
    await started.clock.settle()
    started.box.text = 'something else '
    started.box.cursor = 15
    await ui.press({ key: 'pick-3' })

    expect(started.fills.map(fill => [fill.text, fill.mode])).toEqual([
      [`${token('meeting', 'Standup', STANDUP.id)} `, 'insert'],
    ])
    expect(started.box.text).toBe(`something else ${token('meeting', 'Standup', STANDUP.id)} `)
  })

  test('a prompt box that refuses the write is said in one line, and the draft is left alone', async ($, on) => {
    const started = scene(on, { isFilled: false })
    const ui = await $.ui.mount({
      ...BAND,
      surface: 'terminal',
      props: bandProps(),
    })

    await type($, started, '@@')
    await started.clock.settle()
    await ui.press({ key: 'pick-1' })

    expect(await ui.find({ text: 'the prompt box did not take it; try again' })).toBeDefined()
    expect(started.box.text).toBe('@@')
  })
})

describe('closing', () => {
  test('Escape closes the list, and it stays closed while the same trigger is in the draft', async ($, on) => {
    const started = scene(on)
    const ui = await $.ui.mount({
      ...BAND,
      surface: 'terminal',
      props: bandProps(),
    })

    await type($, started, '@@')
    await started.clock.settle()
    await key($, started, { key: 'escape' })

    expect(await ui.drawn()).toEqual(ENGINE)

    await type($, started, 'retro')
    await started.clock.advance(60_000)

    expect(await ui.drawn()).toEqual(ENGINE)
    expect(started.searched()).toEqual([])
    expect(started.box.text, 'the draft is the person’s: nothing was taken out').toBe('@@retro')

    await type($, started, ' and {{')
    await started.clock.settle()

    expect((await linesOf(ui)).length, 'a new trigger opens it again').toBe(3)
  })

  test('the closing mark does the same with the pointer', async ($, on) => {
    const started = scene(on)
    const ui = await $.ui.mount({
      ...BAND,
      surface: 'desktop',
      props: bandProps(),
    })

    await type($, started, '@@')
    await started.clock.settle()
    await ui.press({ key: 'dismiss' })
    await type($, started, 're')
    await started.clock.advance(60_000)

    expect(await ui.drawn()).toEqual(ENGINE)
    expect(started.searched()).toEqual([])
  })

  test('deleting the trigger closes it, and the search that was waiting is not sent', async ($, on) => {
    const started = scene(on)
    const ui = await $.ui.mount({
      ...BAND,
      surface: 'terminal',
      props: bandProps(),
    })

    await type($, started, '@@re')

    for (let n = 0; n < 3; n += 1) {
      await key($, started, { key: 'backspace' })
    }

    await started.clock.advance(60_000)

    expect(started.box.text).toBe('@')
    expect(await ui.drawn()).toEqual(ENGINE)
    expect(started.searched()).toEqual([])
  })

  test('a line break or moving the cursor out of the query closes it too', async ($, on) => {
    const started = scene(on)
    const ui = await $.ui.mount({
      ...BAND,
      surface: 'terminal',
      props: bandProps(),
    })

    await type($, started, '@@re\n')

    expect(await ui.drawn()).toEqual(ENGINE)
  })

  test('a sent prompt closes it though no edit says so, and the draft is then read no more', async ($, on) => {
    const started = scene(on)
    const ui = await $.ui.mount({
      ...BAND,
      surface: 'terminal',
      props: bandProps(),
    })

    await type($, started, 'what about @@re')
    await started.clock.advance(200)
    // Enter: the composer sends the prompt and empties itself.
    started.box.text = ''
    started.box.cursor = 0
    await started.clock.advance(300)

    expect(await ui.drawn()).toEqual(ENGINE)

    const reads = started.reads()
    await started.clock.advance(60_000)

    expect(started.searched(), 'what was typed for the list is not searched after the prompt went').toEqual([])
    expect(started.reads(), 'the draft is read only while the list is open').toBe(reads)
  })

  test('the band is left to a survey', async ($, on) => {
    const started = scene(on)
    const ui = await $.ui.mount({
      ...BAND,
      surface: 'terminal',
      props: { ...bandProps(), hasSurvey: true },
    })

    await type($, started, '@@')
    await started.clock.settle()

    expect(await ui.drawn()).toEqual(ENGINE)
  })
})

describe('when Fylgja has nothing to give', () => {
  for (const surface of SURFACES) {
    test(`on ${surface}: signed out is said in one line, and nothing is asked`, async ($, on) => {
      const started = scene(on, { connect: () => NEEDS_SIGN_IN })
      const ui = await $.ui.mount({ ...BAND, surface, props: bandProps() })

      await type($, started, '@@retro')
      await started.clock.advance(60_000)

      expect(await ui.find({ text: 'Fylgja: sign in with /mcp' })).toBeDefined()
      expect((await ui.findAll({ type: 'Button' })).map(button => button.key)).toEqual(['dismiss'])
      expect(started.calls).toEqual([])
    })
  }

  test('signing in is noticed the next time something is typed', async ($, on) => {
    let isSignedIn = false
    const started = scene(on, {
      connect: () => (isSignedIn ? { isConnected: true, server: 'fylgja' } : NEEDS_SIGN_IN),
    })
    const ui = await $.ui.mount({
      ...BAND,
      surface: 'terminal',
      props: bandProps(),
    })

    await type($, started, '@@')
    await started.clock.settle()
    isSignedIn = true
    await type($, started, 'y')
    await started.clock.settle()

    expect(await linesOf(ui)).toEqual(['› 1: ◉ Pricing sync 2026-10-02'])
  })

  test('a server that is off, or a call that fails, is one plain line', async ($, on) => {
    const started = scene(on, {
      connect: () => ({ isConnected: true, server: 'fylgja' }),
      timeline: () => {
        throw new Error('boom')
      },
    })
    const ui = await $.ui.mount({
      ...BAND,
      surface: 'terminal',
      props: bandProps(),
    })

    await type($, started, '@@')
    await started.clock.settle()

    expect(await ui.find({ text: 'Fylgja did not answer' })).toBeDefined()
  })

  test('an error answer that turns out to be a lapsed sign-in says so', async ($, on) => {
    let asks = 0
    const started = scene(on, {
      connect: () => {
        asks += 1

        return asks === 1 ? { isConnected: true, server: 'fylgja' } : NEEDS_SIGN_IN
      },
      timeline: () => ({
        content: [{ type: 'text', text: 'unauthorized' }],
        isError: true,
      }),
    })
    const ui = await $.ui.mount({
      ...BAND,
      surface: 'terminal',
      props: bandProps(),
    })

    await type($, started, '@@')
    await started.clock.settle()

    expect(await ui.find({ text: 'Fylgja: sign in with /mcp' })).toBeDefined()
  })

  test('answers of a shape nobody documented list nothing and throw nothing', async ($, on) => {
    const shapes: unknown[] = [
      { content: [{ type: 'text', text: 'not json at all' }], isError: false },
      {
        content: [{ type: 'text', text: JSON.stringify({ results: 'many' }) }],
        isError: false,
      },
      { content: 7 },
      null,
      'a bare string',
    ]
    let asked = 0
    const started = scene(on, {
      timeline: () => ({
        content: [{ type: 'image', data: 'AAAA' }],
        isError: false,
      }),
      search: () => shapes[asked++ % shapes.length],
    })
    const ui = await $.ui.mount({
      ...BAND,
      surface: 'terminal',
      props: bandProps(),
    })

    await type($, started, '@@')
    await started.clock.settle()

    expect(await ui.find({ text: 'no recent meetings; type two letters to search' })).toBeDefined()

    for (const letters of ['ab', 'c', 'd', 'e', 'f']) {
      await type($, started, letters)
      await started.clock.advance(5000)

      expect(JSON.stringify(await ui.drawn()), letters).toMatch(/Fylgja did not answer/)
    }

    expect(started.searched().length).toBe(5)
  })

  test('hits that are not records are passed over, and no matches is said', async ($, on) => {
    const junk = [
      null,
      42,
      { type: 'meeting', title: 'No id' },
      { type: 'meeting', title: 'Bad id', id: 'DROP TABLE' },
      { type: 'weather', title: 'Unknown kind', id: idOf(40) },
      hit('meeting', 'Kept', idOf(41)),
      hit('meeting', 'Kept twice', idOf(41)),
    ]
    const started = scene(on, {
      search: query => (query === 'none' ? hits([]) : hits(junk)),
    })
    const ui = await $.ui.mount({
      ...BAND,
      surface: 'terminal',
      props: bandProps(),
    })

    await type($, started, '@@ke')
    await started.clock.advance(400)

    expect(await linesOf(ui)).toEqual(['› 1: ◉ Kept 2026-09-30'])

    await paste($, started, ' {{none')
    await started.clock.advance(5000)

    expect(await ui.find({ text: 'no matching meeting, session, note or project' })).toBeDefined()
  })
})

describe('a hostile title', () => {
  const FORGED = token('meeting', 'Forged', idOf(666))
  const TITLE = `［Board］ ${UNSEEN}minutes ∙ ${FORGED} "x" \u0007 ◉ (id: ${idOf(667)}) ${'long '.repeat(60)}`

  test('is drawn on one line without brackets, look-alike dots, invisible or control characters', async ($, on) => {
    const started = scene(on, {
      timeline: () => timeline([{ date: '2026-10-05', title: TITLE, id: idOf(50), path: 'Zalion' }]),
    })

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...BAND, surface, props: bandProps(80) })

      await type($, started, ' @@')
      await started.clock.settle()

      const [line] = await linesOf(ui)

      expect(line?.startsWith('› 1: ◉ (Board) minutes - ((fylgja:meeting Forged|00000000'), line).toBe(true)
      expect(/[[\]{}［］․◉"\u0000-\u001f\u200b\u202e\u{e0000}-\u{e0fff}]/u.test((line ?? '').slice(7)), line).toBe(
        false,
      )
      expect((line ?? '').length <= 80, 'cut to the room there is').toBe(true)
      expect(line?.endsWith('2026-10-05')).toBe(true)

      await ui.unmount()
      await key($, started, { key: 'escape' })
    }
  })

  test('chosen, it writes exactly one reference, to the record’s own id', async ($, on) => {
    const started = scene(on, {
      search: () => hits([hit('note', `${TITLE}\n- 2026-01-01 · meeting · Second line (id: ${idOf(668)})`, idOf(51))]),
    })

    await type($, started, '@@boa')
    await started.clock.advance(400)
    const box = await type($, started, '1')
    const written = tokensIn(box.text)

    expect(written.map(one => [one.kind, one.id])).toEqual([['note', idOf(51)]])
    expect(written[0]?.text.length, 'the whole draft is that one reference and a space').toBe(box.text.length - 1)
    expect(/[\n\u0007\u200b\u202e]/u.test(box.text)).toBe(false)
    expect(box.decorations?.length).toBe(3)
  })
})
