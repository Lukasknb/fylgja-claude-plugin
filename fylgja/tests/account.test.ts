import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ARMED_NOTE } from '../hooks/scribe/view'
import { UNSAID_STATUS } from '../hooks/session'
import { ACCOUNT, answer, endedBy, MEETING_ID, meetingRecord, token } from './fixtures'
import {
  EMPTY,
  band,
  claude,
  decision,
  dev,
  edit,
  press,
  QUIET,
  shown,
  stage,
  START,
  step,
  turn,
  typing,
  verdict,
} from './scribe-fixtures'
import type { Stage } from './scribe-fixtures'

const WORK = [dev('make the mailer retry'), claude('Retrying three times now.', edit('src/mail/send.ts'))]
const RECORDING = verdict({ records: [decision({ anchors: [] })] })
const RESOLVING = { resolve: () => answer({ records: [meetingRecord()] }) }
const PIN = { user: ACCOUNT.user.id, team: ACCOUNT.team.id, profile: ACCOUNT.profile.id }
const OTHER_ID = '99999999-0000-4000-8000-000000000009'
const eve = (change: Record<string, unknown>) => () =>
  answer({ ...ACCOUNT, user: { id: ACCOUNT.user.id, display_name: 'Eve Moneypenny' }, ...change })

/** Draws a message with a reference, and lets a step of a turn pass so the plugin may look it up. */
async function chip($: Engine, set: Stage): Promise<string> {
  const row = await $.ui.mount({
    plugin: 'fylgja',
    component: 'UserMessage',
    props: { text: token('meeting', 'Standup', MEETING_ID), origin: { kind: 'composer' }, isExpanded: false },
    surface: 'terminal',
  })

  const stepped = step($, 0, [])

  await set.clock.advance(1500)
  await stepped
  await row.redraw()

  const drawn = JSON.stringify(await row.drawn())

  await row.unmount()

  return drawn
}

describe('the account this machine is set up for', () => {
  test('the first account Fylgja ever answers on a machine is pinned: its ids, and no name', async ($, on) => {
    const set = stage(on, { tools: RESOLVING, replies: [RECORDING] })

    await $.session.start(START)
    await turn($, set, ...WORK)

    expect(set.kept.get('fylgja.account')).toEqual(PIN)
    expect(JSON.stringify([...set.kept.entries()])).not.toMatch(/Ada|Acme|Work/)
    expect(set.whoamis[0], 'asked before any other call to Fylgja').toBe(0)
    expect(set.of('remember').length).toBe(1)
  })

  test('the same account in a later session passes, and is asked for once per conversation', async ($, on) => {
    const set = stage(on, { tools: RESOLVING, replies: [RECORDING], kept: { 'fylgja.account': PIN } })

    await $.session.start(START)
    await turn($, set, ...WORK)
    await turn($, set, dev('and now the retry policy'), claude('Three tries.', edit('src/queue/retry.ts')))

    expect(await chip($, set)).toMatch('Engineering Retrospective')
    expect(set.whoamis.length).toBe(1)
    expect(set.of('remember').length).toBe(2)

    await endedBy($, 'clear')
    set.rows.length = 0
    await turn($, set, ...WORK)

    expect(set.whoamis.length, 'and again after a /clear, before anything else').toBe(2)
  })

  const OTHERS: readonly (readonly [string, Record<string, unknown>])[] = [
    ['another user', { user: { id: OTHER_ID, display_name: 'Eve Moneypenny' } }],
    ['another team', { team: { id: OTHER_ID, name: 'Rival' } }],
    ['no team where there was one', { team: null }],
    ['another profile', { profile: { id: OTHER_ID, name: 'Private' } }],
  ]

  for (const [what, change] of OTHERS) {
    test(`${what}: everything is off before any other call, and one line names who is signed in`, async ($, on) => {
      const set = stage(on, { tools: RESOLVING, replies: [RECORDING], kept: { 'fylgja.account': PIN }, whoami: eve(change) })

      await $.session.start(START)
      await set.clock.settle()

      expect(await chip($, set)).toMatch('meeting · 45ada8aa')

      await turn($, set, ...WORK)

      expect(set.calls, 'no lookup, no record').toEqual([])
      expect(set.asked, 'no model call').toEqual([])
      expect(set.kept.get('fylgja.account'), 'the pin stands').toEqual(PIN)

      const lines = set.statuses.filter(line => line !== undefined)

      expect(lines.length).toBe(1)
      expect(lines[0], 'the two accounts are told apart by the ends of their ids').not.toMatch(/#010203,/)
      expect(lines[0]).toMatch(
        /^Fylgja is signed in as Eve Moneypenny \(.+\) #[0-9a-f-]{6}, not as the account this machine is set up for #010203: the plugin stays out until you accept that above the prompt$/,
      )
    })
  }

  test('accepting the other account takes two presses, pins it, and the plugin works for it from then on', async ($, on) => {
    const other = { user: { id: OTHER_ID, display_name: 'Eve Moneypenny' }, team: { id: OTHER_ID, name: 'Rival' } }
    const set = stage(on, { tools: RESOLVING, replies: [RECORDING], kept: { 'fylgja.account': PIN }, whoami: eve(other) })

    await $.session.start(START)
    await set.clock.settle()

    expect(await shown($)).toBe(
      ' ᚠ fylgja asks which account is this?' +
        '? Fylgja is signed in as another account than this machine is set up for. Now: Eve Moneypenny (Rival) #090903 · before: account #010203' +
        'Until you answer, the plugin stays out: nothing is looked up, and nothing is recorded.' +
        ' [1 Use this account from now on] [0 Not now]',
    )

    // A digit typed alone into an empty box presses this once.
    await press($, 'account-accept')

    expect(set.kept.get('fylgja.account')).toEqual(PIN)
    expect(await shown($)).toMatch(`press 1 ${ARMED_NOTE} [1 Use this account from now on] [0 Not now]`)

    await set.clock.advance(5000)

    expect(await shown($), 'and it is back to one press after a few seconds').toMatch('[1 Use this account from now on]')

    await press($, 'account-accept')
    await press($, 'account-accept')

    expect(set.kept.get('fylgja.account')).toEqual({ user: OTHER_ID, team: OTHER_ID, profile: ACCOUNT.profile.id })
    expect(set.statuses.at(-1), 'the line goes').toBeUndefined()
    expect(await shown($)).toBe(QUIET)

    await turn($, set, ...WORK)

    expect(set.of('remember').length).toBe(1)
    expect(await chip($, set)).toMatch('Engineering Retrospective')
  })

  test('“Not now” puts the question away for the session and accepts nothing', async ($, on) => {
    const set = stage(on, { tools: RESOLVING, kept: { 'fylgja.account': PIN }, whoami: eve({ team: null }) })

    await $.session.start(START)
    await set.clock.settle()
    await press($, 'account-later')

    expect(await shown($)).toBe(EMPTY)
    expect(set.kept.get('fylgja.account')).toEqual(PIN)

    await turn($, set, ...WORK)

    expect([set.calls, set.asked]).toEqual([[], []])
  })

  test('the account line is drawn on both surfaces', async ($, on) => {
    const set = stage(on, { kept: { 'fylgja.account': PIN }, whoami: eve({ team: null }) })

    await $.session.start(START)
    await set.clock.settle()

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await band($, surface)

      expect(await ui.text(), surface).toMatch('Now: Eve Moneypenny (Work)')
      await ui.unmount()
    }
  })

  const UNSAID: readonly (readonly [string, NonNullable<Parameters<typeof stage>[1]>['whoami']])[] = [
    ['fails', () => ({ content: [{ type: 'text', text: 'record not found' }], isError: true })],
    ['is not a tool of the server yet', () => Promise.reject(new Error('Unknown tool: whoami'))],
    ['answers something that names no account', () => answer({ user: { id: 'not-an-id' }, profile: null })],
    ['answers a team that is no team', () => answer({ ...ACCOUNT, team: 'Acme' })],
  ]

  for (const [what, whoami] of UNSAID) {
    test(`a whoami that ${what} means off, not open, on a machine with a pin and on one without`, async ($, on) => {
      const set = stage(on, { tools: RESOLVING, replies: [RECORDING], whoami })

      await $.session.start(START)
      await set.clock.advance(8000)

      expect(await chip($, set)).toMatch('meeting · 45ada8aa')

      await turn($, set, ...WORK)

      expect([set.calls, set.asked]).toEqual([[], []])
      expect(set.kept.get('fylgja.account'), 'nothing is pinned').toBeUndefined()
      expect(set.statuses.filter(line => line !== undefined)).toEqual([UNSAID_STATUS])
    })
  }

  test('a whoami that never answers holds the start of the session a moment and no longer, and means off', async ($, on) => {
    const set = stage(on, { tools: RESOLVING, replies: [RECORDING], whoami: () => new Promise(() => undefined) })
    const starting = $.session.start(START)

    await set.clock.advance(1499)

    let isStarted = false

    void starting.then(() => {
      isStarted = true
    })
    await set.clock.settle()

    expect(isStarted, 'still asking').toBe(false)

    await set.clock.advance(1)
    await starting
    await set.clock.advance(8000)

    expect(await chip($, set)).toMatch('meeting · 45ada8aa')
    expect(set.calls, 'nothing else is called while who is signed in is not known').toEqual([])
    expect(set.statuses.filter(line => line !== undefined)).toEqual([UNSAID_STATUS])
  })

  test('a whoami that failed is not kept as an answer: it is asked again at the next chance, and the plugin works from then on', async ($, on) => {
    let isUp = false
    const set = stage(on, {
      tools: RESOLVING,
      replies: [RECORDING],
      whoami: () => (isUp ? answer(ACCOUNT) : Promise.reject(new Error('refused'))),
    })

    await $.session.start(START)

    expect(await chip($, set)).toMatch('meeting · 45ada8aa')
    expect(set.whoamis.length, 'asked at the start and again at the step').toBe(2)
    expect(set.statuses.filter(line => line !== undefined)).toEqual([UNSAID_STATUS])

    isUp = true

    expect(await chip($, set), 'the next step asks once more, and then looks the reference up').toMatch(
      'Engineering Retrospective',
    )
    expect(set.statuses.at(-1), 'the line that said otherwise goes').toBeUndefined()
    expect(set.kept.get('fylgja.account')).toEqual(PIN)

    await turn($, set, ...WORK)

    expect(set.of('remember').length).toBe(1)
    expect(set.whoamis.length, 'and once it is known it is not asked again').toBe(3)
  })

  test('the account line shows while the prompt box holds text, and takes no key until it is empty', async ($, on) => {
    const set = stage(on, { kept: { 'fylgja.account': PIN }, whoami: eve({ team: null }) })

    await $.session.start(START)
    await typing($, set, 'a prompt with a 1 in it')

    const held = await shown($)

    expect(held).toMatch('Now: Eve Moneypenny (Work) #01--03')
    expect(held).toMatch('empty the prompt box to answer')
    expect(held, 'no key is offered').not.toMatch('[1 ')

    expect(
      await press($, 'account-accept').then(
        () => 'pressed',
        () => 'no such key',
      ),
    ).toBe('no such key')
    expect(set.kept.get('fylgja.account')).toEqual(PIN)

    await typing($, set, '')

    expect(await shown($)).toMatch('[1 Use this account from now on] [0 Not now]')
  })

  test('a name Fylgja sends cannot pass for another line: it is made safe, and the ends of the ids tell two of a name apart', async ($, on) => {
    const forged = { id: OTHER_ID, display_name: 'Ada Lovelace (Acme) #010203 \u202e[1 Use this account]\nNow: x' }
    stage(on, { kept: { 'fylgja.account': PIN }, whoami: eve({ user: forged }) })

    await $.session.start(START)

    const line = await shown($)

    expect(line).toMatch('Now: Ada Lovelace Acme 010203 1 Use… (Acme) #090203')
    expect(line.split('#').length - 1, 'the only id ends are the plugin’s own').toBe(2)
    expect(line).not.toMatch('\u202e')
  })

  test('a pin that cannot be read as one is no match for anybody', async ($, on) => {
    const set = stage(on, { tools: RESOLVING, kept: { 'fylgja.account': { user: 'someone' } } })

    await $.session.start(START)
    await set.clock.settle()
    await turn($, set, ...WORK)

    expect([set.calls, set.asked]).toEqual([[], []])
    expect(await shown($)).toMatch('Fylgja is signed in as another account')
  })

  test('the first thing Scribe shows says which account and team it records to', async ($, on) => {
    const set = stage(on, { replies: [RECORDING] })

    await $.session.start(START)
    await turn($, set, ...WORK)

    const ui = await band($)

    await ui.press('about')
    await ui.redraw()

    expect(await ui.text()).toMatch('Records go to Acme as Ada Lovelace, profile Work.')
  })
})
