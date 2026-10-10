import { describe, expect, test } from 'claude-code/testing'

import { briefly, called, close, DETACHED, open } from '../hooks/live'
import {
  answer,
  asked,
  idOf,
  meetingRecord,
  MEETING_ID,
  NEEDS_SIGN_IN,
  CONNECTED,
  scene,
  SESSION,
  step,
  token,
  userMessage,
} from './fixtures'

const MEETING = token('meeting', 'Standup', MEETING_ID)
const FOUND = () => answer({ records: [meetingRecord()] })

describe('a call to Fylgja is started only in a hook that is being waited on', () => {
  test('inside an open hook the call is started; outside one, or once it has handed back, nothing is', async () => {
    let started = 0
    const start = (): Promise<string> => {
      started += 1

      return Promise.resolve('answered')
    }
    const live = open()

    expect(await called(live, start)).toBe('answered')

    close(live)

    expect(await called(live, start).catch((error: Error) => error.message)).toBe(DETACHED)
    expect(await called(undefined, start).catch((error: Error) => error.message)).toBe(DETACHED)
    expect(started, 'the two refused calls were never begun').toBe(1)
  })

  test('a short wait ends with the work or with the time, whichever comes first, and never fails', async () => {
    const timers: (() => void)[] = []
    const after = (_ms: number, fn: () => void) => {
      timers.push(fn)

      return { cancel: () => undefined }
    }
    let isOver = false
    const waiting = briefly(after, new Promise(() => undefined), 1500).then(() => {
      isOver = true
    })

    await Promise.resolve()

    expect(isOver).toBe(false)

    timers[0]?.()
    await waiting

    expect(isOver).toBe(true)

    await briefly(after, Promise.reject(new Error('down')), 1500)
  })

  test('drawing a row, typing, sending a prompt and the timer of the sign-in line call nothing on Fylgja', async ($, on) => {
    let isSignedIn = false
    const started = scene(on, { connect: () => (isSignedIn ? CONNECTED : NEEDS_SIGN_IN), resolve: FOUND })

    await $.session.start(SESSION)
    isSignedIn = true

    const ui = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })

    for (let n = 0; n < 3; n += 1) {
      await ui.redraw()
      await started.clock.advance(5000)
    }

    await $.prompt.submit({ text: `about ${MEETING}`, wait: false, origin: { kind: 'composer' } })
    await started.clock.advance(60_000)

    expect(started.statuses, 'the timer took the sign-in line down').toEqual(['sign in with /mcp', undefined])
    expect([started.calls, started.whoamis()], 'and nobody called Fylgja').toEqual([[], 0])
    expect(await ui.find({ text: 'engine: [◉ meeting · 45ada8aa]' }), 'the reference waits').toBeDefined()

    await asked($, started)

    expect(started.whoamis(), 'the first step of a turn asks who is signed in').toBe(1)
    expect(
      started.calls.map(call => call.tool),
      'and then about the reference',
    ).toEqual(['resolve'])
    expect(await ui.find({ text: 'engine: [◉ "Engineering Retrospective" · 2026-09-30]' })).toBeDefined()
  })

  test('references wait in line and are asked about by the hooks that follow; a hook that has handed back starts nothing more', async ($, on) => {
    const started = scene(on, {
      resolve: async (args, clock) => {
        await clock.sleep(1000)

        return answer({ records: (args.refs as string[]).map(id => meetingRecord({ ref: id, id, title: `T${id.slice(-2)}` })) })
      },
    })
    const text = Array.from({ length: 45 }, (_, n) => token('note', `Note ${n}`, idOf(n))).join(' ')
    const ui = await $.ui.mount({ ...userMessage(text), surface: 'terminal' })
    const first = step($)

    await started.clock.advance(1500)
    await first

    expect(started.calls.length, 'one batch answered, the second on its way when the step handed back').toBe(2)

    await started.clock.advance(60_000)

    expect(started.calls.length, 'and the third is not started from what the step left behind').toBe(2)

    await asked($, started, 1000)

    expect(started.calls.map(call => (call.args.refs as string[]).length)).toEqual([20, 20, 5])

    const row = String((await ui.find({ type: 'Text' }))?.children?.[0])

    expect(row.split('"').length - 1, 'all 45 confirmed').toBe(90)
  })
})
