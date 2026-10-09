import { describe, expect, test } from 'claude-code/testing'

import { TWIN_STATUS } from '../hooks/session'
import { answer, CONNECTED, MEETING_ID, meetingRecord, NEEDS_SIGN_IN, rowOf, scene, SESSION, token } from './fixtures'

const MEETING = token('meeting', 'Standup', MEETING_ID)
const RESOLVING = { resolve: () => answer({ records: [meetingRecord()] }) }
const SUBMIT = { text: 'go on', wait: false, origin: { kind: 'composer' } } as const

describe('Fylgja set up outside the plugin as well', () => {
  for (const theirs of ['fylgja', 'kb']) {
    test(`connected as “${theirs}”: no reference is looked up there, its chip claims nothing, and one line says why`, async ($, on) => {
      // The same address in the person's settings or a repository's `.mcp.json`: the engine answers that entry.
      const started = scene(on, { ...RESOLVING, connect: () => ({ isConnected: true, server: theirs }) })

      await $.session.start(SESSION)
      await started.clock.settle()

      expect(await rowOf($, started, MEETING, 1000)).toBe('[◉ meeting · 45ada8aa]')
      expect(await rowOf($, started, MEETING, 60_000)).toBe('[◉ meeting · 45ada8aa]')
      expect(started.calls, 'the id of a pasted reference goes nowhere').toEqual([])
      expect(
        started.statuses.filter(line => line !== undefined),
        'said once, however often the server is asked',
      ).toEqual([TWIN_STATUS])
      expect(started.forbidden).toEqual([])
    })
  }

  test('the line goes with the next prompt and does not come back while nothing changes', async ($, on) => {
    const started = scene(on, { ...RESOLVING, connect: () => ({ isConnected: true, server: 'kb' }) })

    await $.session.start(SESSION)
    await started.clock.settle()
    await $.prompt.submit(SUBMIT)
    await rowOf($, started, MEETING, 60_000)
    await $.prompt.submit(SUBMIT)

    expect(started.statuses.slice(1)).toEqual([TWIN_STATUS, undefined])
    expect(started.calls).toEqual([])
  })

  test('it never takes the sign-in line down, and the sign-in line never takes it for its own', async ($, on) => {
    let connection: Record<string, unknown> = NEEDS_SIGN_IN
    const started = scene(on, { ...RESOLVING, connect: () => connection })

    await $.session.start(SESSION)
    await started.clock.settle()

    expect(started.statuses.at(-1)).toBe('sign in with /mcp')

    // Signed in, and what answers is an entry outside the plugin.
    connection = { isConnected: true, server: 'kb' }
    await started.clock.advance(5000)

    expect(started.statuses.at(-1)).toBe(TWIN_STATUS)
    expect(started.statuses.filter(line => line === TWIN_STATUS).length).toBe(1)

    // Signed out again: the sign-in line is up, and a prompt does not take it down.
    connection = NEEDS_SIGN_IN
    await rowOf($, started, MEETING, 0)
    await started.clock.settle()

    expect(started.statuses.at(-1)).toBe('sign in with /mcp')

    await $.prompt.submit(SUBMIT)

    expect(started.statuses.at(-1)).toBe('sign in with /mcp')
    expect(started.calls).toEqual([])
  })

  test('with the plugin’s own connection a reference is looked up as ever, and nothing is said', async ($, on) => {
    const started = scene(on, { ...RESOLVING, connect: () => CONNECTED })

    await $.session.start(SESSION)

    expect(await rowOf($, started, MEETING, 1000)).toBe('[◉ "Engineering Retrospective" · 2026-09-30]')
    expect(started.calls.map(call => call.tool)).toEqual(['resolve'])
    expect(started.statuses.filter(line => line !== undefined)).toEqual([])
  })
})
