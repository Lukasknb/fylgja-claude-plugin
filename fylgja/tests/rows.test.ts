import { describe, expect, test } from 'claude-code/testing'

import {
  answer,
  CONNECTED,
  engineDrew,
  idOf,
  MEETING_ID,
  meetingRecord,
  NEEDS_SIGN_IN,
  NOTE_ID,
  asked,
  endedBy,
  rowOf,
  step,
  scene,
  SESSION,
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
/** A lookup that answers with the meeting under the title it has when asked. */
const FOUND_AS = (title: () => string) => () => answer({ records: [meetingRecord({ title: title() })] })
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
        expect(await ui.drawn()).toEqual(engineDrew(`engine: what about ${UNCONFIRMED}?`))
        await asked($, started, 300)
      }

      expect(await ui.drawn(), surface).toEqual(engineDrew(`engine: what about ${VERIFIED}?`))
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
      meetingRecord({ kind: 'organization', title: 'Northwind', date: null, extra: { nested: true }, summary: 'unused' }),
      meetingRecord({ ref: NOTE_ID, id: NOTE_ID, kind: 'aspect', title: 'Pricing' }),
    ]
    const started = scene(on, { resolve: () => answer({ records }) })

    expect(await rowOf($, started, `${MEETING} ${NOTE}`)).toBe('[□ "Northwind"] [□ "Pricing" · 2026-09-30]')
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
      await asked($, started)

      expect(await ui.find({ text: 'engine: see [✎ note · not found]' }), surface).toBeDefined()
      await ui.unmount()
    }

    expect(started.calls.length).toBe(1)
  })

  test('a message the person sent from their phone or browser is theirs too', async ($, on) => {
    const started = scene(on, { resolve: FOUND })
    const ui = await $.ui.mount({ ...userMessage(MEETING, false, 'bridge'), surface: 'terminal' })
    await asked($, started)

    expect(await ui.find({ text: `engine: ${VERIFIED}` })).toBeDefined()
  })

  test('a message without references is passed through untouched and asks nothing', async ($, on) => {
    const started = scene(on)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...userMessage(`just {{braces}} and {{fylgja:meeting Retro|1234}}`), surface })
      await started.clock.settle()

      expect(await ui.drawn(), surface).toEqual(engineDrew('engine: just {{braces}} and {{fylgja:meeting Retro|1234}}'))
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
    await asked($, started)

    for (let n = 0; n < 5; n += 1) {
      await ui.redraw()
      await asked($, started)
    }

    expect(await rowOf($, started, MEETING)).toBe(VERIFIED)
    expect(started.calls.map(call => call.args)).toEqual([{ refs: [MEETING_ID] }])
  })

  test('rows drawn while an answer is on its way do not ask again', async ($, on) => {
    const started = scene(on, { resolve: after(300, FOUND) })
    const first = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })
    const second = await $.ui.mount({ ...userMessage(`again ${MEETING}`), surface: 'terminal' })
    await first.redraw()
    await asked($, started, 300)

    expect(await second.find({ text: `engine: again ${VERIFIED}` })).toBeDefined()
    expect(started.calls.length).toBe(1)
  })

  test('a failed lookup is tried once more and then left alone', async ($, on) => {
    const started = scene(on, { resolve: () => ({ content: [{ type: 'text', text: 'down' }], isError: true }) })
    const ui = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })
    await asked($, started)

    for (let n = 0; n < 5; n += 1) {
      await ui.redraw()
      await asked($, started)
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

    const ui = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })
    await asked($, started)

    expect(await ui.find({ text: `engine: ${UNCONFIRMED}` }), 'after the try that failed').toBeDefined()

    await asked($, started)

    expect(await ui.find({ text: `engine: ${VERIFIED}` }), 'the next step asks once more').toBeDefined()
    expect(tries).toBe(2)
  })

  test('a server that is switched off is never called: the reference waits, and nothing is said', async ($, on) => {
    let isOff = true
    const started = scene(on, {
      connect: () => (isOff ? { isConnected: false, reason: 'disabled', message: 'off' } : CONNECTED),
      resolve: FOUND,
    })
    const ui = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })

    for (let n = 0; n < 5; n += 1) {
      await ui.redraw()
      await asked($, started)
    }

    expect([started.calls, started.statuses]).toEqual([[], []])

    isOff = false
    await asked($, started)

    expect(
      await ui.find({ text: `engine: ${VERIFIED}` }),
      'waiting was not failing: it is asked once the server is on',
    ).toBeDefined()
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
      let id = idOf(1)
      const started = scene(on, { resolve: after(100, () => answer({ records: [meetingRecord({ title })] })), sessionId: () => id })
      await $.session.start(SESSION)
      const ui = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })
      await asked($, started, 100)

      expect(await ui.find({ text: `engine: ${VERIFIED}` })).toBeDefined()

      title = 'Renamed since'
      id = idOf(2)

      // A branch has no end of its own: it is seen by its id, as the next prompt is sent.
      if (source === 'fork') {
        await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
      } else {
        await endedBy($, source, idOf(1))
      }

      expect(await ui.find({ text: `engine: ${UNCONFIRMED}` }), 'nothing carries over').toBeDefined()

      await asked($, started, 100)

      expect(await ui.find({ text: 'engine: [◉ "Renamed since" · 2026-09-30]' })).toBeDefined()
      expect(started.calls.length).toBe(2)
    })
  }

  // A conversation whose end the plugin did not hear (a branch has none)
  // is told by its id, which changes all the same.
  for (const what of ['a clear', 'a branch'] as const) {
    test(`after ${what} Claude Code says nothing of, the changed id alone starts over: the row is unconfirmed, then looked up again`, async ($, on) => {
      let id = idOf(1)
      let title = 'Engineering Retrospective'
      const started = scene(on, { resolve: FOUND_AS(() => title), sessionId: () => id })
      await $.session.start(SESSION)
      const ui = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })
      await asked($, started)

      expect(await ui.find({ text: `engine: ${VERIFIED}` })).toBeDefined()

      title = 'Renamed since'
      id = what === 'a clear' ? idOf(2) : idOf(3)
      await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })

      expect(await ui.find({ text: `engine: ${UNCONFIRMED}` }), 'nothing carries over').toBeDefined()

      await asked($, started)

      expect(await ui.find({ text: 'engine: [◉ "Renamed since" · 2026-09-30]' })).toBeDefined()
      expect(started.calls.length).toBe(2)
    })
  }

  test('the end and the changed id start over once, whichever is seen first', async ($, on) => {
    let id = idOf(1)
    const started = scene(on, { resolve: FOUND, sessionId: () => id })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })
    await asked($, started)

    // The end first: it starts over and the row is looked up again, and the prompt after it finds the id it knows.
    id = idOf(2)
    await endedBy($, 'clear', idOf(1))

    expect(await ui.find({ text: `engine: ${UNCONFIRMED}` }), 'started over').toBeDefined()

    await asked($, started)

    expect(await ui.find({ text: `engine: ${VERIFIED}` }), 'looked up again').toBeDefined()
    expect(started.calls.length).toBe(2)

    await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
    await asked($, started)

    expect(await ui.find({ text: `engine: ${VERIFIED}` }), 'what the new conversation knows stays').toBeDefined()
    expect(started.calls.length).toBe(2)

    // The id first: the prompt starts over, and the end of the one before that comes after it drops nothing the new conversation learned.
    id = idOf(3)
    await $.prompt.submit({ text: 'and on', wait: false, origin: { kind: 'composer' } })

    expect(await ui.find({ text: `engine: ${UNCONFIRMED}` }), 'started over').toBeDefined()

    await asked($, started)

    expect(started.calls.length).toBe(3)

    await endedBy($, 'clear', idOf(2))
    await asked($, started)

    expect(await ui.find({ text: `engine: ${VERIFIED}` }), 'what the new conversation knows stays').toBeDefined()
    expect(started.calls.length).toBe(3)
  })

  test('an end that comes before the id the session reads has moved on starts over once', async ($, on) => {
    let id = idOf(1)
    const started = scene(on, { resolve: FOUND, sessionId: () => id })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })
    await asked($, started)

    await endedBy($, 'clear', idOf(1))

    expect(await ui.find({ text: `engine: ${UNCONFIRMED}` }), 'started over').toBeDefined()

    await asked($, started)

    expect(started.calls.length).toBe(2)

    // The session still reads the id it had: that is the conversation just left, not another one.
    await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
    await asked($, started)

    expect(await ui.find({ text: `engine: ${VERIFIED}` }), 'what the new conversation knows stays').toBeDefined()

    id = idOf(2)
    await $.prompt.submit({ text: 'and on', wait: false, origin: { kind: 'composer' } })
    await asked($, started)

    expect(await ui.find({ text: `engine: ${VERIFIED}` }), 'nor once the id has caught up').toBeDefined()
    expect(started.calls.length).toBe(2)
  })

  test('a resume back to the conversation before, seen by its id alone, starts over again', async ($, on) => {
    let id = idOf(1)
    const started = scene(on, { resolve: FOUND, sessionId: () => id })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })
    await asked($, started)

    for (const [next, calls] of [[idOf(2), 2], [idOf(1), 3]] as const) {
      id = next
      await $.prompt.submit({ text: 'where were we', wait: false, origin: { kind: 'composer' } })

      expect(await ui.find({ text: `engine: ${UNCONFIRMED}` }), `started over for ${next}`).toBeDefined()

      await asked($, started)

      expect(started.calls.length).toBe(calls)
    }
  })

  test('the end of one conversation, then a return to it seen by its id alone, starts over each time', async ($, on) => {
    let id = idOf(1)
    const started = scene(on, { resolve: FOUND, sessionId: () => id })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })
    await asked($, started)

    id = idOf(2)
    await endedBy($, 'resume', idOf(1))

    expect(await ui.find({ text: `engine: ${UNCONFIRMED}` })).toBeDefined()

    await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
    await asked($, started)

    expect(started.calls.length).toBe(2)

    id = idOf(1)
    await $.prompt.submit({ text: 'back again', wait: false, origin: { kind: 'composer' } })

    expect(await ui.find({ text: `engine: ${UNCONFIRMED}` }), 'started over for the one before').toBeDefined()

    await asked($, started)

    expect(started.calls.length).toBe(3)
  })

  test('an id that cannot be read starts nothing over and holds no prompt back; the next one read does', async ($, on) => {
    let id = idOf(1)
    let isReadable = true
    const started = scene(on, {
      resolve: FOUND,
      sessionId: () => {
        if (!isReadable) {
          throw new Error('no id today')
        }

        return id
      },
    })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })
    await asked($, started)

    id = idOf(2)
    isReadable = false

    expect(await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })).toMatchObject({ text: 'next' })
    expect(await ui.find({ text: `engine: ${VERIFIED}` })).toBeDefined()

    isReadable = true
    await $.prompt.submit({ text: 'and on', wait: false, origin: { kind: 'composer' } })

    expect(await ui.find({ text: `engine: ${UNCONFIRMED}` }), 'started over').toBeDefined()
  })

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
    const before = step($)
    await started.clock.settle()
    delay = 2000
    title = 'Asked after the clear'
    const cleared = endedBy($, 'clear')
    await started.clock.advance(500)

    expect(await ui.find({ text: `engine: ${UNCONFIRMED}` }), 'the old answer has landed and is ignored').toBeDefined()

    // The hooks hand back after their short wait; what they asked is still on its way.
    await started.clock.advance(1500)
    await before
    await cleared
    await started.clock.advance(1000)

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
    const before = step($)
    await started.clock.settle()
    const cleared = endedBy($, 'clear')
    await started.clock.advance(500)
    await before
    await cleared
    await asked($, started)

    expect(await ui.find({ text: `engine: ${VERIFIED}` }), 'the row still on screen is looked up afresh').toBeDefined()
    expect(started.calls.length, 'once, for the new conversation').toBe(1)
  })

  test('a compaction is the same conversation: what is known stays', async ($, on) => {
    const started = scene(on, { resolve: FOUND })

    on('session.compact', () => ({ messages: [{ role: 'user', text: 'This session is being continued from a previous conversation.', toolUses: [] }] }) as never)

    expect(await rowOf($, started, MEETING)).toBe(VERIFIED)

    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hello', toolUses: [] }] } as never)
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
    await asked($, started)

    expect(await ui.find({ text: `engine: ${VERIFIED}` })).toBeDefined()

    isLapsed = true
    const other = await $.ui.mount({ ...userMessage(NOTE), surface: 'terminal' })
    await asked($, started)

    expect(started.statuses).toEqual(['sign in with /mcp'])
    expect(await ui.find({ text: `engine: ${UNCONFIRMED}` }), 'the earlier row too').toBeDefined()
    expect(await other.find({ text: 'engine: [✎ note · 0b1f6c1e]' })).toBeDefined()

    isLapsed = false
    isSignedIn = true
    await started.clock.advance(5000)

    expect(started.statuses).toEqual(['sign in with /mcp', undefined])
    expect(started.calls.length, 'the timer that takes the line down calls nothing on Fylgja').toBe(2)

    await asked($, started)

    expect(await ui.find({ text: `engine: ${VERIFIED}` })).toBeDefined()
    expect(await other.find({ text: `engine: ${VERIFIED}` })).toBeDefined()
  })
})

describe('what the plugin never does', () => {
  test('it leaves a prompt with a reference written out exactly as it came, with nothing added for Claude, and asks nothing for it', async ($, on) => {
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
    await asked($, started)
    isSignedIn = true
    await started.clock.advance(5000)
    await endedBy($, 'clear')
    await asked($, started)
    await asked($, started)
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
