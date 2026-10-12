import { describe, expect, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

import { markOf, RUNE } from '../hooks/companion'
import { OFF_STATUS } from '../hooks/scribe/scribe'
import { ACCOUNT, CONNECTED, idOf, NEEDS_SIGN_IN } from './fixtures'
import {
  carded,
  claude,
  decision,
  dev,
  edit,
  EMPTY,
  finish,
  MARK,
  NOTHING,
  press,
  pressTwice,
  QUIET,
  send,
  shown,
  stage,
  START,
  step,
  turn,
  typing,
  verdict,
} from './scribe-fixtures'
import type { Stage } from './scribe-fixtures'

const READING = `${EMPTY}ᚠ· fylgja is reading`
const kept = (count: number): string => `${QUIET} · ${count} kept`

const FILE = 'src/queue/lock.ts'
const WORK = [dev('lock the retry queue with redis'), claude('Done.', edit(FILE))]
const MORE = [dev('forget the lock altogether, the queue is single-consumer now'), claude('Done.', edit(FILE))]
const FIRST = decision({ content: 'Use a Redis lock for the retry queue.', detail: 'Redis is already there.', anchors: [{ path: FILE }] })
const RECORDING = verdict({ records: [FIRST] })
const DROPPING = JSON.stringify({ outcome: 'act', records: [], withdraw: [idOf(101)] })
const OTHER_ID = '99999999-0000-4000-8000-000000000009'

const BAND = {
  plugin: 'fylgja',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

/** Every line under the prompt that held the mark's rune: there must never be one. */
const runes = (set: Stage): string[] => set.statuses.filter((line): line is string => line !== undefined && line.includes(RUNE))

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

describe('the mark above the prompt', () => {
  test('it rests there once the account is the pinned one: one dim line under what is drawn beneath, and no key', async ($, on) => {
    const set = stage(on)

    await $.session.start(START)

    const ui = await $.ui.mount(BAND as never)
    const drawing = JSON.stringify(await ui.drawn())

    expect(await ui.find({ type: 'Text', text: 'engine: AbovePrompt' }), 'what is beneath is passed on as it came').toBeDefined()
    expect((await ui.find({ type: 'Text', text: MARK }))?.props).toEqual({ dimColor: true })
    expect(drawing, 'nothing to press, type into or follow').not.toMatch(/"type":"(?:Button|Input|Link)"/)
    expect(drawing).not.toMatch(/onPress|hotkey|autoFocus|color"/)

    await ui.unmount()
    await set.clock.advance(60_000)

    expect(await shown($)).toBe(QUIET)
    expect(set.statuses, 'the line under the prompt is not the mark’s: cleared at the start, and left alone').toEqual([undefined])
    expect([set.calls, set.asked, set.toasts], 'nothing was asked, read or written for it').toEqual([[], [], []])
  })

  test('it is drawn in the desktop app too, and nowhere else', async ($, on) => {
    stage(on)

    await $.session.start(START)

    const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)

    expect((await desktop.find({ type: 'Text', text: MARK }))?.props).toEqual({ dimColor: true })

    await desktop.unmount()
  })

  test('a survey has the band to itself, and an agent’s transcript is not the mark’s', async ($, on) => {
    stage(on)

    await $.session.start(START)

    for (const props of [
      { ...BAND.props, hasSurvey: true },
      { ...BAND.props, view: { agentId: 'agent-1' } },
    ]) {
      const ui = await $.ui.mount({ ...BAND, props } as never)

      expect(JSON.stringify(await ui.drawn())).not.toMatch(RUNE)

      await ui.unmount()
    }
  })

  test('it does not show while Fylgja does not say which account is signed in', async ($, on) => {
    const set = stage(on, { replies: [RECORDING], whoami: () => Promise.reject(new Error('refused')) })

    await $.session.start(START)

    expect(await shown($)).toBe(EMPTY)

    await turn($, set, ...WORK)

    expect(await shown($), 'nor when the line that said why has gone').toBe(EMPTY)
  })

  test('it does not show while another account is signed in than the pinned one, and comes once that one is accepted', async ($, on) => {
    const set = stage(on, {
      replies: [RECORDING],
      kept: { 'fylgja.account': { user: OTHER_ID, team: OTHER_ID, profile: ACCOUNT.profile.id } },
    })

    await $.session.start(START)

    expect(await shown($)).toMatch('Fylgja is signed in as another account')

    await press($, 'account-later')
    await turn($, set, ...WORK)

    expect(await shown($), 'put off, the band is empty: the mark does not vouch for this account').toBe(EMPTY)
  })

  test('the other account accepted, the mark comes', async ($, on) => {
    stage(on, { kept: { 'fylgja.account': { user: OTHER_ID, team: OTHER_ID, profile: ACCOUNT.profile.id } } })

    await $.session.start(START)
    await pressTwice($, 'account-accept')

    expect(await shown($)).toBe(QUIET)
  })

  test('it does not show while Fylgja is connected outside the plugin', async ($, on) => {
    const set = stage(on, { replies: [RECORDING], connect: () => ({ isConnected: true, server: 'fylgja' }) })

    await $.session.start(START)

    expect(await shown($)).toBe(EMPTY)

    await turn($, set, ...WORK)

    expect(await shown($)).toBe(EMPTY)
  })

  test('it goes when the person has to sign in, and comes back only when the account is known again', async ($, on) => {
    let isSignedIn = true
    const set = stage(on, { connect: () => (isSignedIn ? CONNECTED : NEEDS_SIGN_IN) })

    await $.session.start(START)

    expect(await shown($)).toBe(QUIET)

    isSignedIn = false
    await step($, 0, [])

    expect(set.statuses.at(-1)).toBe('sign in with /mcp')
    expect(await shown($)).toBe(EMPTY)

    isSignedIn = true
    await set.clock.advance(5000)

    expect(set.statuses.at(-1)).toBeUndefined()
    expect(await shown($), 'signed in, as nobody the plugin has asked about yet').toBe(EMPTY)

    await step($, 1, [])

    expect(await shown($)).toBe(QUIET)
  })

  test('a session that starts signed out never shows it', async ($, on) => {
    const set = stage(on, { connect: () => NEEDS_SIGN_IN })

    await $.session.start(START)
    await turn($, set, ...WORK)

    expect(await shown($)).toBe(EMPTY)
  })

  test('it leaves when Fylgja is no longer connected, and returns when it is', async ($, on) => {
    let isUp = true

    stage(on, { connect: () => (isUp ? CONNECTED : { isConnected: false, reason: 'disabled' }) })

    await $.session.start(START)
    isUp = false
    await step($, 0, [])

    expect(await shown($)).toBe(EMPTY)

    isUp = true
    await step($, 1, [])

    expect(await shown($)).toBe(QUIET)
  })

  test('the line under the prompt never holds it, whatever the mark says', async ($, on) => {
    const set = stage(on, { replies: [RECORDING] })

    await $.session.start(START)
    await set.clock.advance(1000)
    await turn($, set, ...WORK)
    await pressTwice($, 'remove:0')
    await $.classic.SessionStart({ source: 'clear' })

    expect(runes(set)).toEqual([])
    expect(set.statuses.filter(line => line !== undefined)).toEqual([])
  })
})

describe('the mark while Scribe reads', () => {
  test('it says so from the moment the look begins, and stops when the look has written its record', async ($, on) => {
    const set = stage(on, { replies: [slowly(5000, () => RECORDING)] })

    await $.session.start(START)

    const { ended } = await looking($, set, 1000)

    expect(await shown($)).toBe(READING)

    await set.clock.advance(5000)
    await ended

    expect(await shown($), 'the receipt has the band').toMatch('✓ Recorded')

    await press($, 'ok')

    expect(await shown($)).toBe(kept(1))
  })

  test('a look that finds nothing leaves it at rest', async ($, on) => {
    const set = stage(on, { replies: [slowly(5000, () => NOTHING)] })

    await $.session.start(START)

    const { ended } = await looking($, set, 1000)

    expect(await shown($)).toBe(READING)

    await set.clock.advance(5000)
    await ended

    expect(await shown($)).toBe(QUIET)
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

      expect(await shown($)).toBe(READING)

      await set.clock.advance(120_000)
      await ended

      expect(await shown($)).toBe(QUIET)
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

    expect(await shown($)).toBe(READING)

    await set.clock.advance(120_000)
    await ended

    expect(await shown($)).toBe(QUIET)
  })

  test('a conversation that starts over under a look stops it saying so, and the look’s late end changes nothing', async ($, on) => {
    const set = stage(on, { replies: [slowly(20_000, () => RECORDING)] })

    await $.session.start(START)

    const { ended } = await looking($, set, 1000)

    expect(await shown($)).toBe(READING)

    await $.classic.SessionStart({ source: 'clear' })

    expect(await shown($), 'at rest in the conversation that begins').toBe(QUIET)

    await set.clock.advance(60_000)
    await ended

    expect(await shown($)).toBe(QUIET)
    expect(set.of('remember'), 'what the look came to belonged to the conversation before').toEqual([])
  })
})

describe('the mark counts what Scribe wrote in the session and still stands', () => {
  test('one record, then two, then one again when one is removed with its key', async ($, on) => {
    const second = verdict({ records: [decision()] })
    const set = stage(on, { replies: [RECORDING, second] })

    await $.session.start(START)
    await turn($, set, ...WORK)

    expect(await shown($), 'the receipt comes first').toMatch('✓ Recorded')

    await set.clock.advance(60_000)

    expect(await shown($), 'and the mark is back when the receipt has gone').toBe(kept(1))

    await turn($, set, dev('and use postgres advisory locks for the job queue'), claude('Done.', edit(FILE)))
    await pressTwice($, 'remove:0')

    expect(set.of('amend_memory')).toMatchObject([{ op: 'remove' }])
    expect(await shown($)).toBe(kept(1))
  })

  test('a record Scribe took back is not counted, and counts again once it is put back', async ($, on) => {
    const set = stage(on, { replies: [RECORDING, DROPPING, NOTHING] })

    await $.session.start(START)
    await turn($, set, ...WORK)
    await set.clock.advance(60_000)

    expect(await shown($)).toBe(kept(1))

    await turn($, set, ...MORE)

    expect(await shown($)).toMatch('[1 Put back]')

    await pressTwice($, 'putback:0')

    expect(await shown($)).toMatch('✓ Restored')

    await press($, 'ok')

    expect(await shown($)).toBe(kept(1))
  })

  test('taken back and left so, nothing is counted', async ($, on) => {
    const set = stage(on, { replies: [RECORDING, DROPPING] })

    await $.session.start(START)
    await turn($, set, ...WORK)
    await set.clock.advance(60_000)
    await turn($, set, ...MORE)
    await press($, 'ok')

    expect(await shown($)).toBe(QUIET)
  })

  test('a conversation that starts over counts from nothing', async ($, on) => {
    const set = stage(on, { replies: [RECORDING] })

    await $.session.start(START)
    await turn($, set, ...WORK)
    await $.classic.SessionStart({ source: 'clear' })

    expect(await shown($)).toBe(QUIET)
  })
})

describe('the mark and what else is shown', () => {
  test('the band’s own lines are drawn in its place, and it returns when the band is empty', async ($, on) => {
    const set = stage(on, { replies: [RECORDING] })

    await $.session.start(START)
    await turn($, set, ...WORK)

    expect(await shown($), 'the card, which carries the name itself, and no mark under it').toBe(
      carded('✓ Recorded · Use a Redis lock for the retry queue. [1 Fix] [2 Remove] [9 What is this] [0 OK]'),
    )

    await press($, 'ok')

    expect(await shown($)).toBe(kept(1))
  })

  test('a notice under the prompt and the mark above it do not touch each other', async ($, on) => {
    const set = stage(on, {
      replies: [RECORDING],
      refused: { recall: 'fylgja: $.mcp.call(plugin:fylgja:fylgja, recall) refused: not granted' },
    })

    await $.session.start(START)
    await turn($, set, ...WORK)

    expect(set.statuses.at(-1)).toBe(OFF_STATUS)
    expect(await shown($), 'Scribe is off; the plugin still draws, so the mark rests').toBe(QUIET)

    await send($, 'and again')

    expect(set.statuses.at(-1)).toBeUndefined()
    expect(await shown($)).toBe(QUIET)
  })

  test('with Scribe turned off it rests, and says nothing of reading or of records', async ($, on) => {
    const set = stage(on, { replies: [RECORDING], kept: { 'scribe.off': true } })

    await $.session.start(START)
    await set.clock.advance(1000)
    await turn($, set, ...WORK)
    await turn($, set, ...MORE)

    expect(set.asked).toEqual([])
    expect(await shown($)).toBe(QUIET)
  })
})

describe('the mark while the person is typing', () => {
  test('its line does not come up over a box that holds text; it comes once the box is empty', async ($, on) => {
    const set = stage(on)

    await typing($, set, 'half a thought')
    await $.session.start(START)

    expect(await shown($)).toBe(EMPTY)

    await step($, 0, [])

    expect(await shown($), 'nor at a later step').toBe(EMPTY)

    await typing($, set, '')

    expect(await shown($)).toBe(QUIET)
  })

  test('a line that is up stays while they type, and changes its words where it stands', async ($, on) => {
    const set = stage(on, { replies: [slowly(5000, () => NOTHING)] })

    await $.session.start(START)

    const { ended } = await looking($, set, 0)

    await typing($, set, 'the next prompt, half typed')

    expect(await shown($)).toBe(READING)

    await set.clock.advance(5000)
    await ended

    expect(await shown($), 'it does not go on saying it reads because they are typing').toBe(QUIET)
  })

  test('it goes at once, typing or not, when the account is no longer the pinned one’s to vouch for', async ($, on) => {
    let isSignedIn = true
    const set = stage(on, { connect: () => (isSignedIn ? CONNECTED : NEEDS_SIGN_IN) })

    await $.session.start(START)
    await typing($, set, 'half a thought')

    expect(await shown($)).toBe(QUIET)

    isSignedIn = false
    await step($, 0, [])

    expect(await shown($)).toBe(EMPTY)
  })
})
