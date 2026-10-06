import { describe, expect, test } from 'claude-code/testing'

import { answer, CONNECTED, MEETING_ID, meetingRecord, NEEDS_SIGN_IN, rowOf, scene, SESSION, token, userMessage } from './fixtures'

const MEETING = token('meeting', 'Standup', MEETING_ID)

describe('sign-in', () => {
  test('a server that needs sign-in is said under the prompt, once, and nothing is looked up', async ($, on) => {
    const started = scene(on, { connect: () => NEEDS_SIGN_IN })

    expect(await $.session.start(SESSION)).toEqual({ cwd: '/work/repo' })
    await started.clock.settle()

    expect(await rowOf($, started, MEETING)).toBe('[◉ meeting · 45ada8aa]')
    expect(started.statuses).toEqual(['sign in with /mcp'])
    expect(started.calls).toEqual([])
  })

  test('the check at session start is not waited for', async ($, on) => {
    const started = scene(on, {
      connect: async clock => {
        await clock.sleep(60_000)

        return NEEDS_SIGN_IN
      },
    })

    expect(await $.session.start(SESSION)).toEqual({ cwd: '/work/repo' })
    expect(started.statuses).toEqual([])

    await started.clock.advance(60_000)

    expect(started.statuses).toEqual(['sign in with /mcp'])
  })

  test('the line goes within seconds of signing in, whatever the person does next, and the asking stops', async ($, on) => {
    let isSignedIn = false
    const started = scene(on, { connect: () => (isSignedIn ? CONNECTED : NEEDS_SIGN_IN) })

    await $.session.start(SESSION)
    await started.clock.advance(12_000)

    expect(started.statuses).toEqual(['sign in with /mcp'])
    expect(started.connects(), 'asked at the start and every five seconds since').toBe(3)

    isSignedIn = true
    await started.clock.advance(2999)

    expect(started.statuses).toEqual(['sign in with /mcp'])

    await started.clock.advance(1)

    expect(started.statuses).toEqual(['sign in with /mcp', undefined])

    const asked = started.connects()
    await started.clock.advance(60_000)

    expect(started.connects(), 'no timer runs once the line is gone').toBe(asked)
  })

  test('a session that starts connected asks once, runs no timer, and clears any line an earlier load left', async ($, on) => {
    const started = scene(on)

    await $.session.start(SESSION)
    await started.clock.advance(60_000)

    expect(started.statuses).toEqual([undefined])
    expect(started.connects()).toBe(1)
  })

  test('a sign-in that lapses mid-session is said when a lookup fails', async ($, on) => {
    let isSignedIn = true
    const started = scene(on, {
      connect: () => (isSignedIn ? CONNECTED : NEEDS_SIGN_IN),
      resolve: () => {
        isSignedIn = false

        return { content: [{ type: 'text', text: 'unauthorized' }], isError: true }
      },
    })

    expect(await rowOf($, started, MEETING)).toBe('[◉ meeting · 45ada8aa]')
    expect(started.statuses).toEqual(['sign in with /mcp'])
  })

  for (const reason of ['disabled', 'failed', 'unapproved', 'policy', 'unlisted']) {
    test(`a server that is ${reason} stays silent`, async ($, on) => {
      const started = scene(on, { connect: () => ({ isConnected: false, reason, message: 'not connected' }) })

      await $.session.start(SESSION)
      await rowOf($, started, MEETING, 60_000)

      expect(started.statuses.filter(status => status !== undefined)).toEqual([])
      expect(started.calls).toEqual([])
    })

    test(`the line goes when the server turns out to be ${reason}, and the asking stops`, async ($, on) => {
      let answerNow: Record<string, unknown> = NEEDS_SIGN_IN
      const started = scene(on, { connect: () => answerNow })

      await $.session.start(SESSION)
      await started.clock.settle()
      answerNow = { isConnected: false, reason, message: 'not connected' }
      await started.clock.advance(5000)

      expect(started.statuses).toEqual(['sign in with /mcp', undefined])

      const asked = started.connects()
      await started.clock.advance(60_000)

      expect(started.connects()).toBe(asked)
    })
  }

  test('a slow answer that sign-in is needed does not overrule a later answer that the server is connected', async ($, on) => {
    let asks = 0
    const started = scene(on, {
      connect: async clock => {
        asks += 1

        if (asks === 1) {
          await clock.sleep(1000)

          return NEEDS_SIGN_IN
        }

        return CONNECTED
      },
      resolve: () => answer({ records: [meetingRecord()] }),
    })

    await $.session.start(SESSION)
    const ui = await $.ui.mount({ ...userMessage(MEETING), surface: 'terminal' })
    await started.clock.settle()

    expect(await ui.find({ text: 'engine: [◉ "Engineering Retrospective" · 2026-09-30]' })).toBeDefined()

    await started.clock.advance(1000)

    expect(started.statuses.filter(status => status !== undefined), 'the late answer raises no line').toEqual([])
    expect(await ui.find({ text: 'engine: [◉ "Engineering Retrospective" · 2026-09-30]' }), 'and wipes no chip').toBeDefined()

    const asked = started.connects()
    await started.clock.advance(60_000)

    expect(started.connects()).toBe(asked)
  })

  test('a server that cannot be asked at all changes nothing', async ($, on) => {
    const started = scene(on, {
      connect: () => {
        throw new Error('no such call')
      },
    })

    expect(await $.session.start(SESSION)).toEqual({ cwd: '/work/repo' })
    expect(await rowOf($, started, MEETING)).toBe('[◉ meeting · 45ada8aa]')
    expect(started.statuses).toEqual([])
  })
})
