import { describe, expect, test } from 'claude-code/testing'

import {
  answer,
  CONNECTED,
  idOf,
  MEETING_ID,
  meetingRecord,
  NEEDS_SIGN_IN,
  NOTE_ID,
  rowOf,
  scene,
  token,
  UNSEEN,
  userMessage,
} from './fixtures'
import type { SceneOptions } from './fixtures'

const SURFACES = ['terminal', 'desktop'] as const
const MEETING = token('meeting', 'Pasted label', MEETING_ID)
const NOTE = token('note', 'Another pasted label', NOTE_ID)
const at = (...points: number[]) => String.fromCodePoint(...points)

const FOUND = () => answer({ records: [meetingRecord()] })
const UNCONFIRMED = '[◉ meeting · 45ada8aa]'
const VERIFIED = '[◉ "Engineering Retrospective" · 2026-09-30]'

/** A lookup that answers `ms` after it was asked. */
const after = (ms: number, records: () => unknown) => async (_args: unknown, clock: { sleep: (ms: number) => Promise<void> }) => {
  await clock.sleep(ms)

  return records()
}

describe('a reference in the person’s message', () => {
  test('is drawn unconfirmed at once, and as the verified title and date once Fylgja has answered', async ($, on) => {
    const started = scene(on, { resolve: after(300, FOUND) })

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...userMessage(`what about ${MEETING}?`), surface })

      if (surface === 'terminal') {
        expect(await ui.drawn()).toEqual({ type: 'Text', props: {}, children: [`engine: what about ${UNCONFIRMED}?`] })
        await started.clock.advance(300)
      }

      expect(await ui.drawn(), surface).toEqual({ type: 'Text', props: {}, children: [`engine: what about ${VERIFIED}?`] })
      await ui.unmount()
    }

    expect(started.calls).toEqual([{ server: 'plugin:fylgja:fylgja', tool: 'resolve', args: { refs: [MEETING_ID] } }])
  })

  test('is drawn at once even if Fylgja never answers', async ($, on) => {
    scene(on, {
      connect: async clock => {
        await clock.sleep(3_600_000)

        return CONNECTED
      },
    })

    // The clock is never moved: the row is drawn without any wait ending.
    const ui = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })

    expect(await ui.find({ text: `engine: ${UNCONFIRMED}` })).toBeDefined()
  })

  test('says so when the record is private to the person, and only then', async ($, on) => {
    const records = [
      meetingRecord({ visibility: 'private to you' }),
      meetingRecord({ ref: NOTE_ID, id: NOTE_ID, kind: 'note', visibility: 'only records you may read' }),
      meetingRecord({ ref: idOf(1), id: idOf(1), visibility: 'private to its author' }),
    ]
    const started = scene(on, { resolve: () => answer({ records }) })

    expect(await rowOf($, started, `${MEETING} ${NOTE} ${token('meeting', '', idOf(1))}`)).toBe(
      '[◉ "Engineering Retrospective" · 2026-09-30 · private to you] ' +
        '[✎ "Engineering Retrospective" · 2026-09-30] [◉ "Engineering Retrospective" · 2026-09-30]',
    )
  })

  test('a kind this build has no glyph for is drawn with one neutral glyph, never as not found', async ($, on) => {
    const records = [
      meetingRecord({ kind: 'organization', title: 'Zalion', date: null, extra: { nested: true }, summary: 'unused' }),
      meetingRecord({ ref: NOTE_ID, id: NOTE_ID, kind: 'aspect', title: 'Pricing' }),
    ]
    const started = scene(on, { resolve: () => answer({ records }) })

    expect(await rowOf($, started, `${MEETING} ${NOTE}`)).toBe('[□ "Zalion"] [□ "Pricing" · 2026-09-30]')
  })

  test('expanded, the message is shown as it was sent, and nothing is looked up', async ($, on) => {
    const started = scene(on, { resolve: FOUND })

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...userMessage(`what about ${MEETING}?`, true), surface })
      await started.clock.settle()

      expect(await ui.find({ text: `engine: what about ${MEETING}?` }), surface).toBeDefined()
      await ui.unmount()
    }

    expect([started.calls, started.connects()]).toEqual([[], 0])
  })

  test('a record Fylgja could not find is drawn as not found, and not asked about again', async ($, on) => {
    const started = scene(on, { resolve: () => answer({ records: [{ ref: NOTE_ID, found: false }] }) })

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...userMessage(`see ${NOTE}`), surface })
      await started.clock.settle()

      expect(await ui.find({ text: 'engine: see [✎ note · not found]' }), surface).toBeDefined()
      await ui.unmount()
    }

    expect(started.calls.length).toBe(1)
  })

  test('a message the person sent from their phone or browser is theirs too', async ($, on) => {
    const started = scene(on, { resolve: FOUND })
    const ui = await $.ui.mount({ ...userMessage(MEETING, false, 'bridge'), surface: 'terminal' })
    await started.clock.settle()

    expect(await ui.find({ text: `engine: ${VERIFIED}` })).toBeDefined()
  })

  test('a message without references is passed through untouched and asks nothing', async ($, on) => {
    const started = scene(on)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...userMessage(`just {{braces}} and {{fylgja:meeting Retro|1234}}`), surface })
      await started.clock.settle()

      expect(await ui.drawn(), surface).toEqual({
        type: 'Text',
        props: {},
        children: ['engine: just {{braces}} and {{fylgja:meeting Retro|1234}}'],
      })
      await ui.unmount()
    }

    expect([started.calls, started.connects()]).toEqual([[], 0])
  })

  const NOT_A_PERSON = [
    { kind: 'sdk' },
    { kind: 'task-notification' },
    { kind: 'scheduled-trigger' },
    { kind: 'peer' },
    { kind: 'peer-send-message' },
    { kind: 'projects-relay' },
    { kind: 'coordinator' },
    { kind: 'observer' },
    { kind: 'observer-activity' },
    { kind: 'auto-continuation' },
    { kind: 'unclassified' },
    { kind: 'slack-ping' },
    { kind: 'channel', server: 'slack' },
    { kind: 'plugin', name: 'other', asUser: true },
  ] as const

  for (const origin of NOT_A_PERSON) {
    test(`a ${origin.kind} message is passed through untouched and asks nothing`, async ($, on) => {
      const started = scene(on, { resolve: FOUND })
      const ui = await $.ui.mount({
        plugin: 'fylgja',
        component: 'UserMessage',
        surface: 'terminal',
        props: { text: `done: ${MEETING}`, origin, isExpanded: false },
      })
      await started.clock.settle()

      expect(await ui.find({ text: `engine: done: ${MEETING}` })).toBeDefined()
      expect([started.calls, started.connects()]).toEqual([[], 0])
    })
  }
})

describe('how often Fylgja is asked', () => {
  test('a row drawn again and again asks once', async ($, on) => {
    const started = scene(on, { resolve: FOUND })
    const ui = await $.ui.mount({ ...userMessage(`${MEETING} and again ${MEETING}`), surface: 'terminal' })
    await started.clock.settle()

    for (let n = 0; n < 5; n += 1) {
      await ui.redraw()
      await started.clock.settle()
    }

    expect(await rowOf($, started, MEETING)).toBe(VERIFIED)
    expect(started.calls.map(call => call.args)).toEqual([{ refs: [MEETING_ID] }])
  })

  test('rows drawn while an answer is on its way do not ask again', async ($, on) => {
    const started = scene(on, { resolve: after(300, FOUND) })
    const first = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })
    const second = await $.ui.mount({ ...userMessage(`again ${MEETING}`), surface: 'terminal' })
    await first.redraw()
    await started.clock.advance(300)

    expect(await second.find({ text: `engine: again ${VERIFIED}` })).toBeDefined()
    expect(started.calls.length).toBe(1)
  })

  test('a failed lookup is tried once more and then left alone', async ($, on) => {
    const started = scene(on, { resolve: () => ({ content: [{ type: 'text', text: 'down' }], isError: true }) })
    const ui = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })
    await started.clock.settle()

    for (let n = 0; n < 5; n += 1) {
      await ui.redraw()
      await started.clock.settle()
    }

    expect(await ui.find({ text: `engine: ${UNCONFIRMED}` })).toBeDefined()
    expect(started.calls.length).toBe(2)
    expect(started.statuses).toEqual([])
  })

  test('a lookup that failed once is confirmed when the second try answers', async ($, on) => {
    let tries = 0
    const started = scene(on, {
      resolve: () => {
        tries += 1

        return tries === 1 ? answer('not the shape') : FOUND()
      },
    })

    expect(await rowOf($, started, MEETING)).toBe(VERIFIED)
    expect(tries).toBe(2)
  })

  test('a server that is switched off is asked about a reference twice at most', async ($, on) => {
    const started = scene(on, { connect: () => ({ isConnected: false, reason: 'disabled', message: 'off' }) })
    const ui = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })

    for (let n = 0; n < 5; n += 1) {
      await ui.redraw()
      await started.clock.settle()
    }

    expect(started.connects()).toBe(2)
    expect([started.calls, started.statuses]).toEqual([[], []])
  })

  test('many references go out twenty at a time, one call after the other', async ($, on) => {
    let inFlight = 0
    let most = 0
    const started = scene(on, {
      resolve: async (args, clock) => {
        inFlight += 1
        most = Math.max(most, inFlight)
        await clock.sleep(10)
        inFlight -= 1

        return answer({ records: (args.refs as string[]).map(id => meetingRecord({ ref: id, id, title: `T${id.slice(-2)}` })) })
      },
    })
    const text = Array.from({ length: 45 }, (_, n) => token('note', `Note ${n}`, idOf(n))).join(' ')

    const row = await rowOf($, started, text, 100)

    expect(started.calls.map(call => (call.args.refs as string[]).length)).toEqual([20, 20, 5])
    expect(most).toBe(1)
    expect(row.split('"').length - 1, 'all 45 confirmed').toBe(90)
  })

  for (const [name, record] of Object.entries({
    'an answer for another record': meetingRecord({ id: NOTE_ID }),
    'an answer whose kind is not a plain word': meetingRecord({ kind: 'meeting] [x' }),
    'an answer without a title': meetingRecord({ title: 7 }),
    'a title with nothing in it to see': meetingRecord({ title: `${UNSEEN}${at(0x200b)} ◉ ` }),
    'a record neither found nor missing': meetingRecord({ found: 'true' }),
  })) {
    test(`${name} leaves the chip unconfirmed`, async ($, on) => {
      const started = scene(on, { resolve: () => answer({ records: [record] }) })

      expect(await rowOf($, started, MEETING)).toBe(UNCONFIRMED)
    })
  }
})

describe('what a title can draw', () => {
  const titled = (title: string, more: Record<string, unknown> = {}): SceneOptions => ({
    resolve: () => answer({ records: [meetingRecord({ title, ...more })] }),
  })

  test('one line, without unseen characters or chips of its own', async ($, on) => {
    const started = scene(on, titled(`Retro${UNSEEN}spective\n] [◉ Board · 2026-01-01 · private to you] [✎ note · not found`))
    const row = await rowOf($, started, MEETING)

    expect(row).toBe('[◉ "Retrospective ) ( Board - 2026-01-01 - private to you) ( note - not found" · 2026-09-30]')
    expect(row.split('[').length - 1, 'one chip').toBe(1)
  })

  const DOTS = [0xb7, 0x387, 0x2219, 0x2022, 0x30fb]

  for (const point of DOTS) {
    const dot = at(point)
    const name = `U+${point.toString(16).toUpperCase()}`

    test(`a shared record titled “Plan ${name} private to you” does not draw as private`, async ($, on) => {
      const started = scene(on, titled(`Plan ${dot} private to you`, { date: null }))

      expect(await rowOf($, started, MEETING)).toBe('[◉ "Plan - private to you"]')
    })

    test(`a record titled “meeting ${name} not found” does not draw as not found`, async ($, on) => {
      const started = scene(on, titled(`meeting ${dot} not found`, { date: null }))

      expect(await rowOf($, started, MEETING)).toBe('[◉ "meeting - not found"]')
    })
  }

  test('a title cannot close its own quotes to add a date or a private mark', async ($, on) => {
    const forged = `Plan" · 2020-01-01 · private to you ${at(0x201c)}x${at(0xff02)} ${at(0xff3b)}y${at(0xff3d)}`
    const started = scene(on, titled(forged, { date: null }))
    const row = await rowOf($, started, MEETING)

    expect(row).toBe(`[◉ "Plan' - 2020-01-01 - private to you 'x' (y)"]`)
    expect(row.split('"').length - 1, 'the only double quotes are the chip’s own').toBe(2)
    expect(row.endsWith('"]'), 'nothing stands after the closing quote').toBe(true)
  })

  test('a title like an unconfirmed chip’s words is still drawn in quotes', async ($, on) => {
    const started = scene(on, titled('meeting · 45ada8aa', { date: null }))

    expect(await rowOf($, started, MEETING)).toBe('[◉ "meeting - 45ada8aa"]')
  })

  test('a very long title is cut', async ($, on) => {
    const started = scene(on, titled('x'.repeat(120)))

    expect(await rowOf($, started, MEETING)).toBe(`[◉ "${'x'.repeat(80)}…" · 2026-09-30]`)
  })
})

describe('what is known, and for how long', () => {
  for (const source of ['clear', 'resume', 'fork'] as const) {
    test(`after a ${source}, a row still on screen is unconfirmed, then looked up again`, async ($, on) => {
      let title = 'Engineering Retrospective'
      const started = scene(on, { resolve: after(100, () => answer({ records: [meetingRecord({ title })] })) })
      const ui = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })
      await started.clock.advance(100)

      expect(await ui.find({ text: `engine: ${VERIFIED}` })).toBeDefined()

      title = 'Renamed since'
      await $.classic.SessionStart({ source })

      expect(await ui.find({ text: `engine: ${UNCONFIRMED}` }), 'nothing carries over').toBeDefined()

      await started.clock.advance(100)

      expect(await ui.find({ text: 'engine: [◉ "Renamed since" · 2026-09-30]' })).toBeDefined()
      expect(started.calls.length).toBe(2)
    })
  }

  test('an answer asked for before a clear is not kept after it', async ($, on) => {
    let delay = 500
    let title = 'Asked before the clear'
    const started = scene(on, {
      resolve: async (_args, clock) => {
        const mine = title
        await clock.sleep(delay)

        return answer({ records: [meetingRecord({ title: mine })] })
      },
    })
    const ui = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })
    await started.clock.settle()
    delay = 2000
    title = 'Asked after the clear'
    await $.classic.SessionStart({ source: 'clear' })
    await started.clock.advance(500)

    expect(await ui.find({ text: `engine: ${UNCONFIRMED}` }), 'the old answer has landed and is ignored').toBeDefined()

    await started.clock.advance(2000)

    expect(await ui.find({ text: 'engine: [◉ "Asked after the clear" · 2026-09-30]' })).toBeDefined()
  })

  test('a conversation cleared while Fylgja was still connecting has nothing sent for what it held', async ($, on) => {
    let asks = 0
    const started = scene(on, {
      connect: async clock => {
        asks += 1

        if (asks === 1) {
          await clock.sleep(500)
        }

        return CONNECTED
      },
      resolve: FOUND,
    })
    const ui = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })
    await started.clock.settle()
    await $.classic.SessionStart({ source: 'clear' })
    await started.clock.advance(500)

    expect(await ui.find({ text: `engine: ${VERIFIED}` }), 'the row still on screen is looked up afresh').toBeDefined()
    expect(started.calls.length, 'once, for the new conversation').toBe(1)
  })

  test('a compaction is the same conversation: what is known stays', async ($, on) => {
    const started = scene(on, { resolve: FOUND })

    expect(await rowOf($, started, MEETING)).toBe(VERIFIED)

    await $.classic.SessionStart({ source: 'compact' })
    const ui = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })

    expect(await ui.find({ text: `engine: ${VERIFIED}` })).toBeDefined()
    expect(started.calls.length).toBe(1)
  })

  test('once the person has to sign in again, nothing known before is drawn; after signing in it is looked up afresh', async ($, on) => {
    let isSignedIn = true
    let isLapsed = false
    const started = scene(on, {
      connect: () => (isSignedIn ? CONNECTED : NEEDS_SIGN_IN),
      resolve: args => {
        if (isLapsed) {
          isSignedIn = false

          return { content: [{ type: 'text', text: 'unauthorized' }], isError: true }
        }

        return answer({ records: (args.refs as string[]).map(id => meetingRecord({ ref: id, id })) })
      },
    })
    const ui = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })
    await started.clock.settle()

    expect(await ui.find({ text: `engine: ${VERIFIED}` })).toBeDefined()

    isLapsed = true
    const other = await $.ui.mount({ ...userMessage(NOTE), surface: 'terminal' })
    await started.clock.settle()

    expect(started.statuses).toEqual(['sign in with /mcp'])
    expect(await ui.find({ text: `engine: ${UNCONFIRMED}` }), 'the earlier row too').toBeDefined()
    expect(await other.find({ text: 'engine: [✎ note · 0b1f6c1e]' })).toBeDefined()

    isLapsed = false
    isSignedIn = true
    await started.clock.advance(5000)

    expect(started.statuses).toEqual(['sign in with /mcp', undefined])
    expect(await ui.find({ text: `engine: ${VERIFIED}` })).toBeDefined()
    expect(await other.find({ text: `engine: ${VERIFIED}` })).toBeDefined()
  })
})

describe('what the plugin never does', () => {
  test('it leaves a prompt exactly as it came, with nothing added for Claude, and asks nothing for it', async ($, on) => {
    const started = scene(on, { resolve: FOUND })
    const prompt = { text: `about ${MEETING}`, wait: false, origin: { kind: 'composer' }, context: ['from elsewhere'] } as const

    expect(await $.prompt.submit(prompt)).toEqual({ text: prompt.text, context: ['from elsewhere'] })
    await started.clock.settle()

    expect([started.calls, started.connects()]).toEqual([[], 0])
  })

  test('it writes nothing down and reaches for nothing but Fylgja and the screen', async ($, on) => {
    let isSignedIn = false
    const started = scene(on, { connect: () => (isSignedIn ? CONNECTED : NEEDS_SIGN_IN), resolve: FOUND })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work/repo' })
    const ui = await $.ui.mount({ ...userMessage(`${MEETING} ${NOTE}`), surface: 'terminal' })
    await started.clock.settle()
    isSignedIn = true
    await started.clock.advance(5000)
    await $.classic.SessionStart({ source: 'clear' })
    await started.clock.settle()
    await $.ui.mount({
      plugin: 'fylgja',
      component: 'ToolResult',
      surface: 'terminal',
      props: { tool_use_id: 't', tool: 'mcp__fylgja__remember', output: { outcome: 'created' }, isErrored: false },
    })
    await $.ui.mount({
      plugin: 'fylgja',
      component: 'AssistantMessage',
      surface: 'terminal',
      props: { text: `[x](https://fylgja.lknblab.dev/open/note/${NOTE_ID})`, isFirstOfReply: true },
    })

    expect(await ui.find({ text: /Engineering Retrospective/ })).toBeDefined()
    expect(started.forbidden).toEqual([])
  })
})
