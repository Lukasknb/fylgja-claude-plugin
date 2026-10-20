import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { verdictFor } from '../hooks/scribe/grant'
import { PREFIX } from '../hooks/scribe/journal'
import { STORE } from '../hooks/scribe/scribe'
import * as Telemetry from '../hooks/telemetry'
import type { Door } from '../hooks/telemetry'
import { SCHEMA } from '../hooks/telemetry-schema'
import { answer, eventsOf, idOf, NEEDS_SIGN_IN } from './fixtures'
import type { Reported } from './fixtures'
import {
  claude,
  decision,
  dev,
  edit,
  fact,
  NOTHING,
  press,
  pressTwice,
  REPO,
  SESSION_ID,
  shown,
  stage,
  START,
  turn,
  verdict,
} from './scribe-fixtures'
import type { Stage } from './scribe-fixtures'
import { frame, pane } from './window-fixtures'

const FILE = 'src/queue/lock.ts'
const TALK = [dev('Use Postgres for the queue lock, redis keeps dropping.'), claude('Done.', edit(FILE))]
const RECORDS = verdict({ records: [decision()] })
const UNEXPLAINED = decision({ detail: '', reason_status: 'not_stated' })
const ASKING = verdict({ records: [UNEXPLAINED], question: { form: 'reason', record: 0, options: ['One less service to run'] } })

/** A turn in which nothing is worth a look: it ends, and what waits is sent. */
const QUIET = [dev('ok'), claude('k')]

const KEPT = { command: 'fylgja-kept', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as never
const searching = (args: string) =>
  ({ command: 'fylgja-search', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as never

/** A tool result that is the server's refusal, in its own words. */
const refusing = (text: string) => ({ content: [{ type: 'text', text }], isError: true })

type Kind = { flag?: true; whole?: readonly [number, number]; oneOf?: readonly string[] }

const KINDS: Readonly<Record<string, Readonly<Record<string, Kind>>>> = SCHEMA.events
const PLAIN = /^[a-z0-9_]{1,32}$/

/** Why `event` would not be taken by the server's list, or undefined when it would. */
function faultOf(event: Reported): string | undefined {
  const keys = KINDS[event.name]

  if (keys === undefined) {
    return `no event is called ${event.name}`
  }

  if (!Number.isInteger(event.at)) {
    return `${event.name} has no time`
  }

  for (const [key, value] of Object.entries(event.props)) {
    const kind = keys[key]
    const fits =
      kind === undefined
        ? false
        : kind.flag === true
          ? typeof value === 'boolean'
          : kind.whole !== undefined
            ? typeof value === 'number' && Number.isInteger(value) && value >= kind.whole[0] && value <= kind.whole[1]
            : typeof value === 'string' && kind.oneOf?.includes(value) === true

    if (!fits) {
      return `${event.name}.${key} does not take ${JSON.stringify(value)}`
    }
  }

  return undefined
}

/** Every event sent so far, each checked against the list as the server would check it. */
function sent(set: Stage, name?: string): Reported[] {
  for (const report of set.reports) {
    expect(new RegExp(`^${SCHEMA.patterns.plugin_version}$`).test(String(report.plugin_version)), 'the plugin’s version').toBe(true)
    expect(new RegExp(`^${SCHEMA.patterns.engine_version}$`).test(String(report.engine_version)), 'the engine’s version').toBe(true)
    expect(new RegExp(`^${SCHEMA.patterns.session}$`).test(String(report.session)), 'the session’s id').toBe(true)
    expect(SCHEMA.surfaces as readonly string[]).toContain(report.surface)
    expect(Object.keys(report).sort()).toEqual(['engine_version', 'events', 'plugin_version', 'session', 'surface'])
    expect(eventsOf(report).length).toBeLessThanOrEqual(SCHEMA.maxBatch)
  }

  const events = set.events()

  expect(events.map(faultOf).filter(fault => fault !== undefined)).toEqual([])

  return name === undefined ? events : events.filter(event => event.name === name)
}

const propsOf = (set: Stage, name: string): Record<string, unknown>[] => sent(set, name).map(event => event.props)

describe('what the plugin may report about itself', () => {
  test('no key of any event takes text: each is a whole number within bounds, a flag, or one word of a short fixed list', () => {
    for (const [name, keys] of Object.entries(KINDS)) {
      expect(name).toMatch(PLAIN)

      for (const [key, kind] of Object.entries(keys)) {
        expect(key, name).toMatch(PLAIN)
        expect(Object.keys(kind), `${name}.${key} is of exactly one kind`).toHaveLength(1)

        if (kind.oneOf !== undefined) {
          expect(kind.oneOf.length, `${name}.${key}`).toBeGreaterThan(0)
          expect(kind.oneOf.length, `${name}.${key}`).toBeLessThanOrEqual(40)
          expect(kind.oneOf.filter(word => !PLAIN.test(word)), `${name}.${key}`).toEqual([])
        } else if (kind.whole !== undefined) {
          expect(kind.whole[0], `${name}.${key}`).toBeGreaterThanOrEqual(0)
          expect(kind.whole[1], `${name}.${key}`).toBeGreaterThanOrEqual(kind.whole[0])
        } else {
          expect(kind.flag, `${name}.${key}`).toBe(true)
        }
      }
    }

    expect(SCHEMA.surfaces.filter(surface => !PLAIN.test(surface))).toEqual([])
  })

  test('a value that is not of its key’s kind is left out before anything is sent, and a number is held to its bounds', async () => {
    const telemetry = Telemetry.create(true)
    const loose = Telemetry.record as (to: Telemetry.Telemetry, name: string, props: Record<string, unknown>) => void
    const calls: Record<string, unknown>[] = []

    loose(telemetry, 'look', {
      ending: '/work/repo/src/queue/lock.ts',
      trigger: 'turn_end',
      steps: 2.4,
      duration_ms: 9e12,
      lookups: -3,
      rows_read: Number.NaN,
      is_whole: 'yes',
      path: 'src/queue/lock.ts',
    })
    await Telemetry.send(telemetry, door(calls))

    expect(eventsOf(calls[0] ?? {})).toMatchObject([
      { name: 'look', props: { trigger: 'turn_end', steps: 2, duration_ms: SCHEMA.events.look.duration_ms.whole[1], lookups: 0 } },
    ])
    expect(Object.keys(eventsOf(calls[0] ?? {})[0]?.props ?? {}).sort()).toEqual(['duration_ms', 'lookups', 'steps', 'trigger'])
  })
})

/** A way to Fylgja that answers as the server does, and keeps what it was sent. */
function door(calls: Record<string, unknown>[], answers: (args: Record<string, unknown>) => unknown = () => answer({ accepted: 1, rejected: 0 })): Door {
  return {
    server: 'plugin:fylgja:fylgja',
    isOpen: () => true,
    call: (server, tool, args) => {
      calls.push(args)

      try {
        return Promise.resolve(answers(args))
      } catch (error) {
        return Promise.reject(error as Error)
      }
    },
    now: () => Promise.resolve(1_800_000_000_000),
    after: () => ({ cancel: () => undefined }),
  }
}

describe('events wait in memory, within a bound, and are sent a batch at a time', () => {
  test('over the bound the oldest are let go and counted, and the count is sent with the next batch', async () => {
    const telemetry = Telemetry.create(true)
    const calls: Record<string, unknown>[] = []

    for (let step = 0; step < Telemetry.MAX_WAITING + 30; step += 1) {
      Telemetry.record(telemetry, 'look', { steps: step % 100 })
    }

    expect(telemetry.waiting).toHaveLength(Telemetry.MAX_WAITING)
    expect(telemetry.dropped).toBe(30)

    await Telemetry.send(telemetry, door(calls))

    const first = eventsOf(calls[0] ?? {})

    expect(first).toHaveLength(SCHEMA.maxBatch)
    expect(first[0]).toMatchObject({ name: 'events_dropped', props: { count: 30 } })
    expect(first[1]?.props, 'the oldest still held comes first').toEqual({ steps: 30 })
    expect(telemetry.waiting).toHaveLength(Telemetry.MAX_WAITING - (SCHEMA.maxBatch - 1))
    expect(telemetry.dropped).toBe(0)

    await Telemetry.send(telemetry, door(calls))

    expect(eventsOf(calls[1] ?? {})).toHaveLength(SCHEMA.maxBatch)
    expect(eventsOf(calls[1] ?? {})[0]?.name).toBe('look')
  })

  test('a batch that did not arrive is gone: it is not sent again, and after three in a row one last batch says so and nothing more is sent', async () => {
    const telemetry = Telemetry.create(true)
    const calls: Record<string, unknown>[] = []
    const failing = door(calls, () => {
      throw new Error('socket hang up')
    })

    for (let round = 0; round < Telemetry.MAX_FAILURES + 2; round += 1) {
      Telemetry.record(telemetry, 'look', { steps: round })
      await Telemetry.send(telemetry, failing)
    }

    expect(calls.map(call => eventsOf(call).map(event => event.name)), 'each batch once, each with only what was new').toEqual([
      ['look'],
      ['look'],
      ['look'],
      ['telemetry_stopped'],
    ])
    expect(calls.slice(0, 3).map(call => eventsOf(call)[0]?.props.steps)).toEqual([0, 1, 2])
    expect(eventsOf(calls[3] ?? {})[0]?.props).toEqual({ reason: 'failing' })
    expect(telemetry.stopped).toBe('failing')
    expect(telemetry.waiting).toEqual([])
  })

  test('a batch that arrived after one that did not starts the count over', async () => {
    const telemetry = Telemetry.create(true)
    const calls: Record<string, unknown>[] = []
    let isDown = true
    const flaky = door(calls, () => (isDown ? refusing('too many mcp mod events requests; try again in 12 s') : answer({ accepted: 1, rejected: 0 })))

    for (const down of [true, true, false, true, true]) {
      isDown = down
      Telemetry.record(telemetry, 'look', {})
      await Telemetry.send(telemetry, flaky)
    }

    expect(calls).toHaveLength(5)
    expect(telemetry.stopped).toBeUndefined()
  })

  const fails = (words: string) => (): never => {
    throw new Error(words)
  }

  for (const [what, answers, why] of [
    ['the server answers that it has no such tool', () => refusing("Unknown tool: 'report_events'"), 'old-server'],
    ['the engine says so for it', fails('no such tool: report_events'), 'old-server'],
    [
      'the call is not let through',
      fails('fylgja: $.mcp.call(plugin:fylgja:fylgja, report_events) refused: the organization does not allow it'),
      'not-let-through',
    ],
  ] as const) {
    test(`when ${what}, it is asked once and never again in the session`, async () => {
      const telemetry = Telemetry.create(true)
      const calls: Record<string, unknown>[] = []

      Telemetry.record(telemetry, 'look', {})
      await Telemetry.send(telemetry, door(calls, answers))
      Telemetry.record(telemetry, 'look', {})
      await Telemetry.send(telemetry, door(calls, answers))

      expect(calls).toHaveLength(1)
      expect(telemetry.stopped).toBe(why)
      expect(telemetry.waiting, 'nothing is held for a server that will not take it').toEqual([])
    })
  }

  test('a hook that is no longer waited on takes nothing from the line, and what it could not start is no failure', async () => {
    const telemetry = Telemetry.create(true)
    const calls: Record<string, unknown>[] = []
    const detached = door(calls, () => {
      throw new Error('detached')
    })

    Telemetry.record(telemetry, 'look', { steps: 1 })
    await Telemetry.send(telemetry, { ...door(calls), isOpen: () => false })

    expect(calls).toEqual([])
    expect(telemetry.waiting).toHaveLength(1)

    for (let round = 0; round < Telemetry.MAX_FAILURES + 1; round += 1) {
      await Telemetry.send(telemetry, detached)
    }

    expect(telemetry.failures).toBe(0)
    expect(telemetry.stopped).toBeUndefined()
    expect(telemetry.waiting.map(event => event.props), 'the look is still in line').toEqual([{ steps: 1 }])

    await Telemetry.send(telemetry, door(calls))

    expect(eventsOf(calls.at(-1) ?? {}).map(event => event.props)).toEqual([{ steps: 1 }])
  })

  test('a failure is reported by its kind, told from its type and the plugin’s own fixed words alone', () => {
    const timedOut = Object.assign(new Error('timed out'), { name: 'TimedOut' })

    expect(
      [timedOut, new Error('detached'), new Error('refused'), new SyntaxError('Unexpected token'), new Error('failed'), new Error('ECONNRESET at /home/ada'), 'x'].map(
        Telemetry.causeOf,
      ),
    ).toEqual(['timeout', 'aborted', 'auth', 'parse', 'network', 'other', 'other'])
  })

  test('signed out, nothing is sent, and what waited goes once Fylgja is back', async () => {
    const telemetry = Telemetry.create(true)
    const calls: Record<string, unknown>[] = []

    Telemetry.record(telemetry, 'look', {})
    await Telemetry.send(telemetry, { ...door(calls), server: undefined })

    expect(calls).toEqual([])

    await Telemetry.send(telemetry, door(calls))

    expect(eventsOf(calls[0] ?? {}).map(event => event.name)).toEqual(['look'])
  })

  test('with the option off nothing is noted and nothing is sent', async () => {
    const telemetry = Telemetry.create(false)
    const calls: Record<string, unknown>[] = []

    Telemetry.record(telemetry, 'look', {})
    await Telemetry.send(telemetry, door(calls))

    expect(telemetry.waiting).toEqual([])
    expect(calls).toEqual([])
  })

  test('a new session has an id of its own, made at random, and starts with nothing waiting', () => {
    const telemetry = Telemetry.create(true)
    const before = telemetry.session

    Telemetry.record(telemetry, 'look', {})
    Telemetry.started(telemetry, 'desktop')

    expect(telemetry.session).not.toBe(before)
    expect(telemetry.session).toMatch(new RegExp(`^${SCHEMA.patterns.session}$`))
    expect(telemetry.surface).toBe('desktop')
    expect(telemetry.waiting).toEqual([])
    expect([Telemetry.surfaceOf('tmux'), Telemetry.surfaceOf(null)]).toEqual(['other', 'none'])
  })

  test('only a version spelled as one is sent as the plugin’s or the engine’s', () => {
    const telemetry = Telemetry.create(true)

    Telemetry.pluginIs(telemetry, '{ "name": "fylgja", "version": "0.3.5" }')
    Telemetry.engineIs(telemetry, '2.1.280-dev')
    expect([telemetry.plugin, telemetry.engine]).toEqual(['0.3.5', '2.1.280-dev'])

    Telemetry.pluginIs(telemetry, '{ "version": "0.3.5 (/home/ada/plugins)" }')
    Telemetry.engineIs(telemetry, '2.1.280-dev.20260920.t101500.sha1a2b3c4')
    expect([telemetry.plugin, telemetry.engine]).toEqual([undefined, undefined])

    Telemetry.pluginIs(telemetry, 'not json')
    expect(telemetry.plugin).toBeUndefined()
  })
})

/** What the session's own text is made of: none of it may be in anything that is sent. */
const PRIVATE = [FILE, 'lock.ts', REPO, 'acme', SESSION_ID, 'Postgres', 'redis', 'advisory', 'One less service', '1a2b3c4', idOf(101), '/work']

function nothingPrivateIn(set: Stage): void {
  const said = JSON.stringify(set.reports)

  expect(PRIVATE.filter(word => said.toLowerCase().includes(word.toLowerCase()))).toEqual([])
}

describe('each event is noted where the thing happens, and sent when the turn ends', () => {
  test('a session that began says where it is drawn, that Fylgja is signed in and that Scribe is on', async ($, on) => {
    const set = stage(on)

    await $.session.start(START)

    expect(set.reports, 'nothing is sent before a turn ends').toEqual([])

    await turn($, set, ...QUIET)

    expect(propsOf(set, 'session_started')).toEqual([{ is_interactive: true, is_signed_in: true, is_scribe_on: true }])
    expect(set.reports[0]).toMatchObject({ plugin_version: '1.2.3', surface: 'terminal' })
    expect(set.reports[0]?.session, 'not Claude Code’s own session id').not.toBe(SESSION_ID)
  })

  test('a look that came to a verdict says what set it off, what it took and what came of its records', async ($, on) => {
    const set = stage(on, { replies: [RECORDS] })

    await $.session.start(START)
    await turn($, set, ...TALK)

    const [look] = propsOf(set, 'look')

    expect(look).toMatchObject({
      trigger: 'turn_end',
      ending: 'verdict',
      is_whole: true,
      steps: 1,
      lookups: 0,
      input_tokens: 10,
      output_tokens: 5,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      rows_read: 2,
      rows_held: 0,
      drafts_proposed: 1,
      drafts_written: 1,
      drafts_refused: 0,
      calls_missed: 0,
    })
    expect(look?.first_refusal_code).toBeUndefined()
    // What is recorded about the files in hand is asked first, then the record is written.
    expect([...new Set(propsOf(set, 'call').map(call => [call.tool, call.outcome, call.is_retry].join(' ')))]).toEqual([
      'recall answered false',
      'remember created false',
    ])
    expect(propsOf(set, 'call').every(call => typeof call.duration_ms === 'number')).toBe(true)
    nothingPrivateIn(set)
  })

  test('a turn with nothing in it for Scribe is a look that the gate ended, with no model asked', async ($, on) => {
    const set = stage(on)

    await $.session.start(START)
    await turn($, set, ...QUIET)

    expect(set.asked).toEqual([])
    expect(propsOf(set, 'look')).toMatchObject([{ trigger: 'turn_end', ending: 'skipped_gate', steps: 0, drafts_proposed: 0 }])
  })

  test('a model that answered nothing readable ends the look as that', async ($, on) => {
    const set = stage(on, { replies: ['I think we should talk about this.'] })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(propsOf(set, 'look')).toMatchObject([{ ending: 'unreadable', is_whole: false, drafts_written: 0 }])
  })

  test('a write Fylgja refused is counted by the refusal’s code, and none of its words', async ($, on) => {
    const set = stage(on, {
      replies: [RECORDS, '"drop"'],
      tools: { remember: () => refusing('refused:status_not_memory — “Use Postgres advisory locks” reads as a status update') },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(propsOf(set, 'call').filter(call => call.tool === 'remember')).toMatchObject([
      { outcome: 'refused', refusal_code: 'status_not_memory' },
    ])
    expect(propsOf(set, 'look')).toMatchObject([{ ending: 'verdict', drafts_written: 0, drafts_refused: 1, first_refusal_code: 'status_not_memory' }])
    nothingPrivateIn(set)
  })

  test('a record the plugin let go itself is counted by why, first reason first, and none of its words', async ($, on) => {
    const work = decision({ about: 'work', content: 'Advisory locks go into a follow-up PR.' })
    const slot = decision({ content: "The stack's L4 keeps Postgres advisory locks." })
    const set = stage(on, { replies: [verdict({ records: [work, slot] }), '{"drop":true}'] })

    await $.session.start(START)
    await turn($, set, dev('split it up'), claude('- L1: the lock\n- L4: its callers', edit(FILE)))

    expect(set.of('remember')).toEqual([])
    expect(propsOf(set, 'look')).toMatchObject([{ ending: 'verdict', drafts_written: 0, drafts_dropped: 2, first_drop_reason: 'about_work' }])
    expect(JSON.stringify(set.reports)).not.toMatch(/follow-up|stack|L4/)
    nothingPrivateIn(set)
  })

  for (const [what, words, code] of [
    ['a code this plugin does not list', 'refused:quota_of_tuesdays — try on a Wednesday', 'other'],
    ['no code at all', 'it could not be done', 'none'],
  ] as const) {
    test(`a refusal with ${what} is counted as such`, async ($, on) => {
      const set = stage(on, { replies: [RECORDS], tools: { remember: () => refusing(words) } })

      await $.session.start(START)
      await turn($, set, ...TALK)

      expect(propsOf(set, 'call').filter(call => call.tool === 'remember')).toMatchObject([{ outcome: 'refused', refusal_code: code }])
      expect(propsOf(set, 'look')).toMatchObject([{ drafts_refused: 1, first_refusal_code: code }])
      expect(JSON.stringify(set.reports)).not.toMatch(/tuesdays|Wednesday/)
    })
  }

  test('a question says that it came up, and by which kind of key it was answered and how long after', async ($, on) => {
    const set = stage(on, { replies: [ASKING, NOTHING] })

    await $.session.start(START)
    await turn($, set, ...TALK)
    expect(await shown($)).toMatch('Why')
    await pressTwice($, 'reason:0')
    await turn($, set, ...QUIET)

    const questions = propsOf(set, 'question')

    expect(questions.map(one => [one.stage, one.form, one.key])).toEqual([
      ['shown', 'reason', undefined],
      ['answered', 'reason', 'option'],
    ])
    expect(typeof questions[1]?.ms_until_answered).toBe('number')
    expect(propsOf(set, 'call').filter(call => call.tool === 'amend_memory')).toMatchObject([{ outcome: 'fixed' }])
    nothingPrivateIn(set)
  })

  for (const [what, answering, key] of [
    ['Skip', ($: Engine) => press($, 'skip'), 'skip'],
    ['“No particular reason”', ($: Engine) => pressTwice($, 'no-reason'), 'no_reason'],
  ] as const) {
    test(`${what} is told from an answer that gave a reason`, async ($, on) => {
      const set = stage(on, { replies: [ASKING, NOTHING] })

      await $.session.start(START)
      await turn($, set, ...TALK)
      expect(await shown($)).toMatch('Why')
      await answering($)
      await turn($, set, ...QUIET)

      expect(propsOf(set, 'question').map(one => [one.stage, one.key])).toEqual([
        ['shown', undefined],
        ['answered', key],
      ])
    })
  }

  test('a question the developer typed past is one that expired', async ($, on) => {
    const set = stage(on, { replies: [ASKING, NOTHING] })

    await $.session.start(START)
    await turn($, set, ...TALK)
    expect(await shown($)).toMatch('Why')
    await turn($, set, ...QUIET)

    expect(propsOf(set, 'question').map(one => [one.stage, one.key])).toEqual([
      ['shown', undefined],
      ['answered', 'expired'],
    ])
  })

  /** A decision Fylgja holds about the file in hand, marked as one whose code changed since it was confirmed. */
  const DOUBTED = {
    ...fact(5, { content: 'Use Redis with Redlock for the job queue.', anchors: [{ path: FILE }] }),
    staleness: 'code_changed',
    code_changed: { sha: '1a2b3c4', at: '2026-10-12T21:00:00Z', paths: [FILE] },
  }

  test('a recorded decision whose code changed is asked about, and the answer is told from the other two', async ($, on) => {
    const set = stage(on, { tools: { recall: () => answer({ repo: REPO, facts: [DOUBTED] }) } })

    await $.session.start(START)
    await turn($, set, ...TALK)
    expect(await shown($)).toMatch('Still true')
    await press($, 'no-longer')
    await press($, 'ok')
    await turn($, set, ...QUIET)

    expect(propsOf(set, 'question').map(one => [one.stage, one.form, one.key])).toEqual([
      ['shown', 'holds', undefined],
      ['answered', 'holds', 'no_longer_holds'],
    ])
    nothingPrivateIn(set)
  })

  test('a question that a rule held back says which rule: here, that this decision was asked about before', async ($, on) => {
    const set = stage(on, { replies: [ASKING, ASKING] })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await turn($, set, dev('Lock the mail queue the very same way, in the same file.'), claude('Done.', edit(FILE)))

    expect(propsOf(set, 'question').filter(one => one.stage === 'held_back')).toEqual([
      { stage: 'held_back', form: 'reason', held_back_by: 'asked_before' },
    ])
    nothingPrivateIn(set)
  })

  test('a commit says by which rule its files were reported, how many went and what Fylgja did with them', async ($, on) => {
    const set = stage(on, {
      replies: [RECORDS],
      tools: { attach_commit: () => answer({ attached: 1, atom_ids: [idOf(101)], flagged: [idOf(7), idOf(8)], flagged_more: 3 }) },
    })

    await $.session.start(START)
    await turn(
      $,
      set,
      ...TALK,
      claude('Committed.', { tool: 'Bash', input: { command: 'git add -A && git commit -m "queue lock"' }, text: '[main 1a2b3c4] queue lock\n 1 file changed' }),
    )

    expect(set.of('attach_commit')).toMatchObject([{ sha: '1a2b3c4', paths: [FILE] }])
    expect(propsOf(set, 'commit')).toEqual([
      { rule: 'count_match', files_sent: 1, is_old_server_fallback: false, is_attached: true, attached: 1, flagged: 5 },
    ])
    nothingPrivateIn(set)
  })

  test('a commit whose count git did not print is reported with no files, and says why', async ($, on) => {
    const set = stage(on, { replies: [RECORDS] })

    await $.session.start(START)
    await turn($, set, ...TALK, claude('Committed.', { tool: 'Bash', input: { command: 'git commit -am chore' }, text: '[main 0a1b2c3] chore' }))

    expect(propsOf(set, 'commit')).toMatchObject([{ rule: 'none_count_unknown', files_sent: 0, is_attached: true }])
  })

  test('a server that does not take a commit’s files is said to be one, once, and the commit is attached without them', async ($, on) => {
    const set = stage(on, {
      replies: [RECORDS],
      tools: {
        attach_commit: args =>
          'paths' in args ? refusing('attach_commit() got an unexpected keyword argument paths') : answer({ attached: 1, atom_ids: [] }),
      },
    })

    await $.session.start(START)
    await turn(
      $,
      set,
      ...TALK,
      claude('Committed.', { tool: 'Bash', input: { command: 'git add -A && git commit -m "queue lock"' }, text: '[main 1a2b3c4] queue lock\n 1 file changed' }),
    )

    expect(propsOf(set, 'commit')).toMatchObject([{ rule: 'count_match', files_sent: 0, is_old_server_fallback: true, is_attached: true }])
    expect(propsOf(set, 'error')).toContainEqual({ component: 'scribe', kind: 'old_server_paths' })
  })

  test('the window asked for with the command, and a search made in it, are noted with how they went and how much was found', async ($, on) => {
    frame(on)

    const hit = (n: number) => ({
      id: idOf(n),
      score: 0.8,
      type: 'atom',
      title: 'Retry queue',
      link: null,
      date: '2026-09-30',
      project: { path: ['Platform', 'Queue'], id: idOf(900) },
      entities: [],
      content_preview: 'Use a Redis lock for the retry queue.',
      people: [],
      parent_id: idOf(800),
      variant_ids: [],
      resource: { tool: 'open', id: idOf(n) },
      aspect_id: null,
      aspect_path: [],
      newer_value: null,
      may_be_replaced_by: [],
    })
    const set = stage(on, { tools: { search: () => answer({ results: [hit(1), hit(2)], query: 'asked', total: 2, filter_matched: true }) } })

    await $.session.start(START)
    await $.command.run(KEPT)
    await $.command.run(searching('retry queue lock'))
    await turn($, set, ...QUIET)

    expect(propsOf(set, 'window')).toEqual([
      { view: 'kept', opened_by: 'command', outcome: 'opened', records_listed: 0 },
      { view: 'search', opened_by: 'command', outcome: 'opened' },
    ])
    expect(propsOf(set, 'search')).toMatchObject([{ asked_by: 'command', outcome: 'found', results: '1_3' }])
    expect(JSON.stringify(set.reports)).not.toMatch(/retry queue|Redis|Platform/i)
  })

  test('the window opened from the mark says so, and a record removed in it is noted as done or as trouble', async ($, on) => {
    frame(on)

    let isDown = false
    const set = stage(on, {
      replies: [verdict({ records: [decision(), decision({ content: 'Keep retries at three for the mail queue.' })] }), NOTHING],
      tools: { amend_memory: args => (isDown ? refusing('Error calling tool') : answer({ atom_id: args.atom_id, outcome: 'removed' })) },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await press($, 'ok')
    await press($, 'kept')

    const ui = await pane($)

    await ui.press(`row:${idOf(102)}`)
    await ui.press(`remove:${idOf(102)}`)
    expect(set.of('amend_memory'), 'the first press only arms the key').toEqual([])
    await ui.press(`remove:${idOf(102)}`)
    isDown = true
    await ui.press(`row:${idOf(101)}`)
    await ui.press(`remove:${idOf(101)}`)
    await ui.press(`remove:${idOf(101)}`)
    await ui.unmount()
    await turn($, set, ...QUIET)

    expect(propsOf(set, 'window')).toEqual([{ view: 'kept', opened_by: 'click', outcome: 'opened', records_listed: 2 }])
    expect(propsOf(set, 'window_action')).toEqual([
      { view: 'kept', action: 'remove', outcome: 'done' },
      { view: 'kept', action: 'remove', outcome: 'trouble' },
    ])
    nothingPrivateIn(set)
  })

  test('a window no surface would place is noted as that', async ($, on) => {
    frame(on, () => 'unplaced')

    const set = stage(on)

    await $.session.start(START)
    await $.command.run(KEPT)
    await turn($, set, ...QUIET)

    expect(propsOf(set, 'window')).toMatchObject([{ view: 'kept', opened_by: 'command', outcome: 'not_placed' }])
  })

  test('a search Fylgja did not answer is one that failed, with nothing found', async ($, on) => {
    frame(on)

    const set = stage(on, { tools: { search: () => refusing('Error calling tool') } })

    await $.session.start(START)
    await $.command.run(searching('retry'))
    await turn($, set, ...QUIET)

    expect(propsOf(set, 'search')).toMatchObject([{ asked_by: 'command', outcome: 'failed', results: 'none' }])
  })

  test('a compaction says how much of the session was carried over it', async ($, on) => {
    const set = stage(on, { replies: [RECORDS, NOTHING] })

    on('session.compact', ($$, e) => ({ messages: e.messages.slice(-1) }) as never)

    await $.session.start(START)
    // A row as the engine holds it: its tool call has the id the engine gave it.
    await turn($, set, TALK[0] as never, claude('Done.', { ...edit(FILE), tool_use_id: 'toolu_1' } as never))
    set.rows.push(dev('and keep the retries at three'), claude('Done.'))

    const done = await $.session.compact({ trigger: 'auto', messages: [...set.rows] } as never)

    set.rows.splice(0, set.rows.length, ...(done.messages as never[]))
    // Until Claude next answers, the context window has no reading.
    set.window.hasReading = false
    await turn($, set, ...QUIET)

    expect(propsOf(set, 'compaction')).toEqual([{ is_scribe_running: true, records_carried: 1 }])
    nothingPrivateIn(set)
  })
})

describe('what an error answer was, and why a wake had no reply', () => {
  for (const [what, words, outcome, code] of [
    ['a refusal by a rule', 'refused:reason_missing — say why', 'refused', 'reason_missing'],
    ['a call over its allowance', 'too many mcp any requests; try again in 12 s. Wait 12 seconds before calling again.', 'rate_limited', undefined],
    ['arguments the tool does not take', 'remember was called with invalid arguments — kind: Input should be gotcha', 'invalid_arguments', undefined],
    ['a record that is not there', 'record not found', 'not_found', undefined],
    ['a failure of the server’s own', "Error calling tool 'remember'", 'server_fault', undefined],
    ['anything else', 'something new', 'refused', 'none'],
  ] as const) {
    test(`${what} is told apart by the words it opens with`, async ($, on) => {
      const set = stage(on, { replies: [RECORDS, '"drop"'], tools: { remember: () => refusing(words) } })

      await $.session.start(START)
      await turn($, set, ...TALK)

      const [call] = propsOf(set, 'call').filter(one => one.tool === 'remember')

      expect(call?.outcome).toBe(outcome)
      expect(call?.refusal_code).toBe(code)
      expect(JSON.stringify(set.reports)).not.toMatch(/say why|mcp any|Input should|something new/)
    })
  }

  test('a wake whose model gave no answer says that was why', async ($, on) => {
    const set = stage(on, { replies: [() => undefined] })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(propsOf(set, 'look')).toMatchObject([{ ending: 'no_reply', no_reply_reason: 'unanswered' }])
  })

  test('Fylgja going away and coming back is noted each time it changes, and only then', async ($, on) => {
    let isOut = false
    const set = stage(on, { connect: () => (isOut ? NEEDS_SIGN_IN : { isConnected: true, server: 'plugin:fylgja:fylgja' }) })

    await $.session.start(START)
    await turn($, set, ...QUIET)
    isOut = true
    await turn($, set, ...QUIET)
    await turn($, set, ...QUIET)
    isOut = false
    await turn($, set, ...QUIET)
    await turn($, set, ...QUIET)

    expect(propsOf(set, 'sign_in').map(one => one.state)).toEqual(['needs_sign_in', 'here'])
  })
})

describe('reporting never stands in Scribe’s way', () => {
  test('an agent’s turn sends nothing: its call would not be the plugin’s own to the permission check', async ($, on) => {
    const set = stage(on)

    await $.session.start(START)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'turn-agent', reason: 'answer', agentId: 'agent-1' } as never)

    expect(set.reports).toEqual([])

    await turn($, set, ...QUIET)

    expect(set.reports).toHaveLength(1)
  })

  test('Claude’s own call of the tool is refused, the plugin’s own is let through, and nothing else changes', () => {
    const SERVER = 'plugin:fylgja:fylgja'
    const own = { tool: 'mcp__plugin_fylgja_fylgja__report_events', tool_use_id: 'toolu_plugin_01' }

    expect(verdictFor({ decision: 'ask' }, own, 'fylgja', SERVER).decision).toBe('allow')
    expect(verdictFor({ decision: 'ask' }, { ...own, tool_use_id: 'toolu_01abc' }, 'engine', SERVER).decision).toBe('deny')
    expect(verdictFor({ decision: 'allow' }, { ...own, tool: 'mcp__fylgja__report_events' }, 'engine', 'fylgja').decision).toBe('deny')
    expect(verdictFor({ decision: 'ask' }, { ...own, agentId: 'agent-1' }, 'fylgja', SERVER).decision).toBe('deny')
    expect(verdictFor({ decision: 'ask' }, { tool: 'mcp__notes__report_events' }, 'engine', SERVER).decision).toBe('ask')
  })

  test('a server without the tool is asked once: nothing more is sent, and Scribe records as before', async ($, on) => {
    const set = stage(on, {
      replies: [RECORDS, verdict({ records: [decision({ content: 'Keep retries at three for the mail queue.' })] })],
      tools: { report_events: () => refusing("Unknown tool: 'report_events'") },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await turn($, set, dev('and keep the retries at three, more only hides outages'), claude('Done.', edit('src/mail/retry.ts')))
    await turn($, set, ...QUIET)

    expect(set.reports).toHaveLength(1)
    expect(set.of('remember')).toHaveLength(2)
    expect(set.statuses.filter(line => line !== undefined), 'Scribe is not switched off for it').toEqual([])
    expect(await shown($)).toMatch('2 kept')
  })

  test('a report the engine does not let through ends the reports, and nothing of Scribe', async ($, on) => {
    const set = stage(on, {
      replies: [RECORDS, verdict({ records: [decision({ content: 'Keep retries at three for the mail queue.' })] })],
      refused: { report_events: 'fylgja: $.mcp.call(plugin:fylgja:fylgja, report_events) refused: not allowed here' },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await turn($, set, dev('and keep the retries at three, more only hides outages'), claude('Done.', edit('src/mail/retry.ts')))

    expect(set.reports).toHaveLength(1)
    expect(set.of('remember')).toHaveLength(2)
    expect(set.statuses.filter(line => line !== undefined)).toEqual([])
  })

  test('signed out, nothing is sent at all', async ($, on) => {
    const set = stage(on, { replies: [RECORDS], connect: () => NEEDS_SIGN_IN })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await turn($, set, ...QUIET)

    expect(set.reports).toEqual([])
    expect(set.calls).toEqual([])
  })

  test('with the option off nothing is sent, the plugin’s manifest is not read, and Scribe records as before', { options: { telemetry: false } }, async ($, on) => {
    const set = stage(on, { replies: [RECORDS] })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await turn($, set, ...QUIET)

    expect(set.reports).toEqual([])
    expect(set.reads.filter(path => path.endsWith('plugin.json'))).toEqual([])
    expect(set.of('remember')).toHaveLength(1)
  })

  test('nothing of it is kept on the machine: what is stored is what Scribe stored before', async ($, on) => {
    const set = stage(on, { replies: [ASKING, NOTHING] })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await press($, 'skip')
    await turn($, set, ...QUIET)

    expect(set.reports.length).toBeGreaterThan(0)
    expect(
      [...set.kept.keys()].filter(key => key !== 'fylgja.account' && !key.startsWith(PREFIX) && !Object.values(STORE).includes(key as never)),
    ).toEqual([])
    expect(JSON.stringify([...set.kept.values()])).not.toMatch(/report_events|session_started|skipped_gate/)
  })
})
