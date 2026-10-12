import { describe, expect, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

import { markOf, RUNE } from '../hooks/companion'
import { OFF_STATUS } from '../hooks/scribe/scribe'
import { TWIN_STATUS, UNSAID_STATUS } from '../hooks/session'
import { ACCOUNT, CONNECTED, idOf, MARK, NEEDS_SIGN_IN, scene, SESSION } from './fixtures'
import {
  claude,
  decision,
  dev,
  edit,
  finish,
  NOTHING,
  press,
  pressTwice,
  send,
  shown,
  stage,
  START,
  step,
  turn,
  verdict,
} from './scribe-fixtures'
import type { Stage } from './scribe-fixtures'

const READING = 'ᚠ· fylgja is reading'
const kept = (count: number): string => `ᚠ fylgja · ${count} kept`

const FILE = 'src/queue/lock.ts'
const WORK = [dev('lock the retry queue with redis'), claude('Done.', edit(FILE))]
const MORE = [dev('forget the lock altogether, the queue is single-consumer now'), claude('Done.', edit(FILE))]
const FIRST = decision({ content: 'Use a Redis lock for the retry queue.', detail: 'Redis is already there.', anchors: [{ path: FILE }] })
const RECORDING = verdict({ records: [FIRST] })
const DROPPING = JSON.stringify({ outcome: 'act', records: [], withdraw: [idOf(101)] })
const OTHER_ID = '99999999-0000-4000-8000-000000000009'

/** Every time the line under the prompt was the mark's, whatever the mark said. */
const marks = (set: { statuses: (string | undefined)[] }): string[] =>
  set.statuses.filter((line): line is string => line !== undefined && line.startsWith(RUNE))

/** A reply of Scribe's model that takes `ms` of the test's clock and then ends as `ending` does. */
const slowly =
  (ms: number, ending: () => string | undefined) =>
  async (asked: unknown, clock: MockClock): Promise<string | undefined> => {
    await clock.sleep(ms)

    return ending()
  }

/**
 * A turn whose look is left under way: the prompt is sent, the turn ends,
 * and the test's clock has moved `ms` into the model's answer.
 */
async function looking($: Engine, set: Stage, ms: number): Promise<{ ended: Promise<void> }> {
  // A look is under way from the moment it began, which the clock must be able to say.
  await set.clock.advance(1000)
  await send($, WORK[0]?.text ?? '')

  const ended = finish($, set, ...WORK)

  await set.clock.advance(ms)

  return { ended }
}

describe('the mark as it reads', () => {
  test('at rest, while Scribe reads, and with what the session kept', () => {
    expect(markOf(undefined)).toBe('ᚠ fylgja')
    expect(markOf({ isReading: false, kept: 0 })).toBe('ᚠ fylgja')
    expect(markOf({ isReading: true, kept: 0 })).toBe('ᚠ· fylgja is reading')
    expect(markOf({ isReading: false, kept: 2 })).toBe('ᚠ fylgja · 2 kept')
    expect(markOf({ isReading: true, kept: 2 }), 'reading is said before the count').toBe('ᚠ· fylgja is reading')
    expect(RUNE.codePointAt(0)).toBe(0x16a0)
  })
})

describe('the mark under the prompt', () => {
  test('it rests there once the account is the pinned one, and nothing was asked, read or written for it', async ($, on) => {
    const started = scene(on)

    await $.session.start(SESSION)
    await started.clock.advance(60_000)

    expect(started.statuses.at(-1)).toBe(MARK)
    expect(marks(started), 'written once, and by no timer').toEqual([MARK])
    expect([started.calls, started.forbidden, started.whoamis(), started.connects()]).toEqual([[], [], 1, 1])
  })

  test('a step or a turn in which nothing changes does not write it again', async ($, on) => {
    const set = stage(on)

    await $.session.start(START)
    await step($, 0, [])
    await turn($, set, dev('ok'), claude('Fine.'))
    await step($, 1, [])

    expect(marks(set)).toEqual([MARK])
  })

  test('it does not show while Fylgja does not say which account is signed in', async ($, on) => {
    const set = stage(on, { replies: [RECORDING], whoami: () => Promise.reject(new Error('refused')) })

    await $.session.start(START)

    expect(set.statuses.at(-1)).toBe(UNSAID_STATUS)

    await turn($, set, ...WORK)

    expect(marks(set)).toEqual([])
    expect(set.statuses.at(-1), 'nor when the line that said why has gone').toBeUndefined()
  })

  test('it does not show while another account is signed in than the pinned one, and comes once that one is accepted', async ($, on) => {
    const set = stage(on, {
      replies: [RECORDING],
      kept: { 'fylgja.account': { user: OTHER_ID, team: OTHER_ID, profile: ACCOUNT.profile.id } },
    })

    await $.session.start(START)
    await turn($, set, ...WORK)
    await send($, 'and again')

    expect(marks(set)).toEqual([])
    expect(set.statuses.at(-1)).toBeUndefined()

    await pressTwice($, 'account-accept')

    expect(set.statuses.at(-1)).toBe(MARK)
  })

  test('it does not show while Fylgja is connected outside the plugin', async ($, on) => {
    const set = stage(on, { replies: [RECORDING], connect: () => ({ isConnected: true, server: 'fylgja' }) })

    await $.session.start(START)

    expect(set.statuses.at(-1)).toBe(TWIN_STATUS)

    await turn($, set, ...WORK)

    expect(marks(set)).toEqual([])
    expect(set.statuses.at(-1), 'nor when the line that said why has gone').toBeUndefined()
  })

  test('it gives way to the sign-in line, and comes back only when the account is known again', async ($, on) => {
    let isSignedIn = true
    const set = stage(on, { connect: () => (isSignedIn ? CONNECTED : NEEDS_SIGN_IN) })

    await $.session.start(START)

    expect(set.statuses.at(-1)).toBe(MARK)

    isSignedIn = false
    await step($, 0, [])

    expect(set.statuses.at(-1)).toBe('sign in with /mcp')

    isSignedIn = true
    await set.clock.advance(5000)

    expect(set.statuses.at(-1), 'signed in, as nobody the plugin has asked about yet').toBeUndefined()

    await step($, 1, [])

    expect(set.statuses.at(-1)).toBe(MARK)
  })

  test('a session that starts signed out never shows it', async ($, on) => {
    const set = stage(on, { connect: () => NEEDS_SIGN_IN })

    await $.session.start(START)
    await turn($, set, ...WORK)

    expect(set.statuses.filter(line => line !== undefined)).toEqual(['sign in with /mcp'])
  })

  test('it leaves when Fylgja is no longer connected, and returns when it is', async ($, on) => {
    let isUp = true
    const set = stage(on, { connect: () => (isUp ? CONNECTED : { isConnected: false, reason: 'disabled' }) })

    await $.session.start(START)
    isUp = false
    await step($, 0, [])

    expect(set.statuses.at(-1)).toBeUndefined()

    isUp = true
    await step($, 1, [])

    expect(set.statuses.at(-1)).toBe(MARK)
  })
})

describe('the mark while Scribe reads', () => {
  test('it says so from the moment the look begins, and stops when the look has written its record', async ($, on) => {
    const set = stage(on, { replies: [slowly(5000, () => RECORDING)] })

    await $.session.start(START)

    const { ended } = await looking($, set, 1000)

    expect(set.statuses.at(-1)).toBe(READING)

    await set.clock.advance(5000)
    await ended

    expect(set.statuses.at(-1)).toBe(kept(1))
    expect(marks(set), 'the record was written within the look, so its end shows the count at once').toEqual([
      MARK,
      READING,
      kept(1),
    ])
  })

  test('a look that finds nothing leaves it at rest', async ($, on) => {
    const set = stage(on, { replies: [slowly(5000, () => NOTHING)] })

    await $.session.start(START)

    const { ended } = await looking($, set, 1000)

    expect(set.statuses.at(-1)).toBe(READING)

    await set.clock.advance(5000)
    await ended

    expect(set.statuses.at(-1)).toBe(MARK)
  })

  const FAILING: [string, number, () => string | undefined][] = [
    ['whose model gives no answer', 5000, () => undefined],
    ['whose model answers what is no verdict', 5000, () => 'not a verdict at all'],
    [
      'whose model fails',
      5000,
      () => {
        throw new Error('model down')
      },
    ],
    ['that runs out of time', 25_000, () => undefined],
  ]

  for (const [what, ms, ending] of FAILING) {
    test(`a look ${what} stops it saying so all the same`, async ($, on) => {
      const set = stage(on, { replies: [slowly(ms, ending), slowly(ms, ending), slowly(ms, ending), slowly(ms, ending)] })

      await $.session.start(START)

      const { ended } = await looking($, set, 1000)

      expect(set.statuses.at(-1)).toBe(READING)

      await set.clock.advance(120_000)
      await ended

      expect(set.statuses.at(-1)).toBe(MARK)
      expect(set.of('remember')).toEqual([])
    })
  }

  test('a look whose write Fylgja fails stops it saying so, and nothing is counted', async ($, on) => {
    const set = stage(on, {
      replies: [slowly(5000, () => RECORDING)],
      tools: {
        remember: () => {
          throw new Error('connect ECONNREFUSED')
        },
      },
    })

    await $.session.start(START)

    const { ended } = await looking($, set, 1000)

    expect(set.statuses.at(-1)).toBe(READING)

    await set.clock.advance(120_000)
    await ended

    expect(set.statuses.at(-1)).toBe(MARK)
  })

  test('a conversation that starts over under a look stops it saying so, and the look’s late end changes nothing', async ($, on) => {
    const set = stage(on, { replies: [slowly(20_000, () => RECORDING)] })

    await $.session.start(START)

    const { ended } = await looking($, set, 1000)

    expect(set.statuses.at(-1)).toBe(READING)

    await $.classic.SessionStart({ source: 'clear' })

    expect(set.statuses.at(-1), 'at rest in the conversation that begins').toBe(MARK)

    await set.clock.advance(60_000)
    await ended

    expect(set.statuses.at(-1)).toBe(MARK)
    expect(set.of('remember'), 'what the look came to belonged to the conversation before').toEqual([])
  })
})

describe('the mark counts what Scribe wrote in the session and still stands', () => {
  test('one record, then two, then one again when one is removed with its key', async ($, on) => {
    const second = verdict({ records: [decision()] })
    const set = stage(on, { replies: [RECORDING, second] })

    await $.session.start(START)
    await turn($, set, ...WORK)

    expect(set.statuses.at(-1)).toBe(kept(1))

    await set.clock.advance(60_000)
    await turn($, set, dev('and use postgres advisory locks for the job queue'), claude('Done.', edit(FILE)))

    expect(set.statuses.at(-1)).toBe(kept(2))

    await pressTwice($, 'remove:0')

    expect(set.of('amend_memory')).toMatchObject([{ op: 'remove' }])
    expect(set.statuses.at(-1)).toBe(kept(1))
  })

  test('a record Scribe took back is not counted, and counts again once it is put back', async ($, on) => {
    const set = stage(on, { replies: [RECORDING, DROPPING, NOTHING] })

    await $.session.start(START)
    await turn($, set, ...WORK)

    expect(set.statuses.at(-1)).toBe(kept(1))

    await set.clock.advance(60_000)
    await turn($, set, ...MORE)

    expect(await shown($)).toMatch('[1 Put back]')
    expect(set.statuses.at(-1)).toBe(MARK)

    await press($, 'putback:0')

    expect(set.statuses.at(-1), 'one press puts nothing back').toBe(MARK)

    await press($, 'putback:0')

    expect(set.statuses.at(-1)).toBe(kept(1))
  })

  test('a conversation that starts over counts from nothing', async ($, on) => {
    const set = stage(on, { replies: [RECORDING] })

    await $.session.start(START)
    await turn($, set, ...WORK)

    expect(set.statuses.at(-1)).toBe(kept(1))

    await $.classic.SessionStart({ source: 'clear' })

    expect(set.statuses.at(-1)).toBe(MARK)
  })
})

describe('the mark and the other lines under the prompt', () => {
  test('a line of Scribe’s is shown in its place, and the mark is back when that line is taken away', async ($, on) => {
    const set = stage(on, {
      replies: [RECORDING],
      refused: { recall: 'fylgja: $.mcp.call(plugin:fylgja:fylgja, recall) refused: not granted' },
    })

    await $.session.start(START)

    expect(set.statuses.at(-1)).toBe(MARK)

    await turn($, set, ...WORK)

    expect(set.statuses.at(-1)).toBe(OFF_STATUS)

    await step($, 0, [])

    expect(set.statuses.at(-1), 'the mark does not write over it').toBe(OFF_STATUS)

    await send($, 'and again')

    expect(set.statuses.at(-1)).toBe(MARK)
  })

  test('with Scribe turned off it rests, and says nothing of reading or of records', async ($, on) => {
    const set = stage(on, { replies: [RECORDING], kept: { 'scribe.off': true } })

    await $.session.start(START)
    await set.clock.advance(1000)
    await turn($, set, ...WORK)
    await turn($, set, ...MORE)

    expect(set.asked).toEqual([])
    expect(marks(set)).toEqual([MARK])
  })
})
