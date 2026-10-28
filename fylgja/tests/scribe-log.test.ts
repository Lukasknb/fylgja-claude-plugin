import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import * as Journal from '../hooks/scribe/journal'
import type { Groups } from '../hooks/scribe/journal'
import * as Ledger from '../hooks/scribe/ledger'
import { LEGENDS } from '../hooks/listing'
import type { Row } from '../hooks/scribe/delta'
import type { Written } from '../hooks/scribe/types'
import { answer, endedBy, idOf } from './fixtures'
import { frame, pane } from './window-fixtures'
import { claude, decision, dev, edit, fact, finish, NOTHING, press, pressTwice, QUIET, send, SESSION_ID, shown, stage, START, turn, verdict } from './scribe-fixtures'
import type { Asked, Stage, StageOptions } from './scribe-fixtures'

// Claude Code loads the plugin afresh, with nothing it held, after
// /reload-plugins, when it starts it again after losing its copy, on
// `claude --resume` and `--continue`, and when a conversation is moved to the
// background from the agents view and opened again: there it goes on in a
// background job that resumed it as a fork, under an id of its own. The
// session's start is how the plugin hears of each. A second `session.start`
// on the same stage is such a load: everything the plugin held is dropped,
// and only the store stays.

const FILE = 'src/queue/lock.ts'
/** The last tool call of the conversation: what a fork of it carries over with its rows. */
const TIE = 'toolu_01A2b3C4d5E6f7'
const WORK = [dev('lock the retry queue with redis, and cap the retries'), claude('Done.', { ...edit(FILE), tool_use_id: TIE })]
const LOCK = decision({ content: 'Use a Redis lock for the retry queue.', detail: 'Redis is already there.', alternatives: [], anchors: [{ path: FILE, symbol: 'acquire' }] })
const CAP = decision({ content: 'Cap retries at five.', detail: 'A sixth never succeeded.', alternatives: ['retry forever'], anchors: [{ path: FILE }] })

const FIRST = idOf(101)
const SECOND = idOf(102)
const THIRD = idOf(103)

/** The background job's own id for the conversation it goes on with. */
const JOB = idOf(901)

const BOTH = [
  ' ᚠ fylgja  | kept in this session | 2 kept',
  '▸ ◆ Decision · Cap retries at five.',
  'Why: A sixth never succeeded.',
  'Rejected: retry forever',
  `In: ${FILE}`,
  '  ◆ Decision · Use a Redis lock for the retry queue.',
  LEGENDS.list,
]

const COMMAND = {
  command: 'fylgja-kept',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
} as never

/** The keys of the conversation `conv`'s log, one a load that wrote to it. */
const entriesOf = (set: Stage, conv: string): string[] => [...set.kept.keys()].filter(key => key.startsWith(`${Journal.PREFIX}${conv}.`))

/** What the log of `conv` reads as, from the store as it stands. */
function foldedOf(set: Stage, conv: string): Journal.Folded {
  return Journal.fold(entriesOf(set, conv).flatMap(key => Journal.segmentOf(set.kept.get(key)) ?? []))
}

/** A session in which Scribe kept the lock and then the cap; the conversation's id is what `id` says when read. */
async function kept($: Engine, on: On, id: () => string, options: StageOptions = {}, work: readonly Row[] = WORK): Promise<Stage> {
  frame(on)
  const set = stage(on, { replies: [verdict({ records: [LOCK, CAP] })], sessionId: id, ...options })

  await $.session.start(START)
  await turn($, set, ...work)
  // The receipt is put away, where it is the one thing on show.
  await press($, 'ok').catch(() => undefined)
  await set.clock.settle()

  return set
}

/** Presses a two-press key of the band while Fylgja does not answer the change it makes: it waits past the call's own time. */
async function pressTwiceSlowly($: Engine, set: Stage, key: string): Promise<void> {
  await press($, key)

  const pressing = press($, key)

  await set.clock.settle()
  await set.clock.advance(60_000)
  await pressing
}

/** The plugin loaded afresh for the conversation: what it held is gone, and the store stays. */
async function reloaded($: Engine, set: Stage): Promise<void> {
  await set.clock.settle()
  await $.session.start(START)
  await set.clock.settle()
}

/** The rows the window of what was kept lists, opened by its command. */
async function listed($: Engine): Promise<string[]> {
  await $.command.run(COMMAND)

  const ui = await pane($)
  const lines = await ui.lines()

  await ui.unmount()

  return lines
}

/** An error answer of Fylgja's, in its own opening words. */
const failed = (text: string): unknown => ({ content: [{ type: 'text', text }], isError: true })

const NOT_FOUND = failed('record not found: nothing under that id')

/** How `open` answers for the records `held` names, as Fylgja holds them now; any other is not found. */
function openOf(held: Readonly<Record<string, { content: string; reason: string; alternatives: string[] }>>) {
  return (args: Record<string, unknown>): unknown => {
    const id = String(args.ref)
    const one = held[id]

    return one === undefined
      ? NOT_FOUND
      : answer({
          kind: 'atom',
          focus: {
            atom: { id, type: 'decision', content: one.content },
            decision: { reason: one.reason, reason_status: 'stated', alternatives: one.alternatives },
          },
        })
  }
}

/** The two records of `kept`, as Fylgja holds them when nobody changed them. */
const AS_KEPT = {
  [FIRST]: { content: 'Use a Redis lock for the retry queue.', reason: 'Redis is already there.', alternatives: [] },
  [SECOND]: { content: 'Cap retries at five.', reason: 'A sixth never succeeded.', alternatives: ['retry forever'] },
}

/** A record as a session holds it. */
function written(id: string, content: string, more: Partial<Written> = {}): Written {
  return { id, kind: 'decision', content, reasonStatus: 'stated', outcome: 'created', replaced: null, detail: 'Because.', alternatives: [], anchors: [{ path: FILE }], repo: 'acme/web', ...more }
}

/** The parts of a log other than its records, as a session that did nothing else holds them. */
function groupsOf(more: Partial<Groups> = {}): Groups {
  return {
    recorded: [],
    asked: [],
    gone: [],
    band: { pending: [], told: [], asked: [], questions: 0, unanswered: 0, doubted: [] },
    deferred: [],
    cursor: { consumed: 2, mark: null, seam: null, hasPrompt: false, hasActed: false, compactions: 0, hasCompacted: false, isOwed: false, prompts: [] },
    work: {
      commits: [],
      toAttach: [],
      index: { named: [], hasStaged: false, whole: false, isAway: false },
      created: [],
      edited: [],
      editedRepos: [],
      changedPlaces: [],
      commitsToPair: [],
      agentRepo: null,
      own: [],
      takesScope: true,
      filesIn: [],
    },
    places: [],
    counts: { dropped: 0, lost: [], letGo: 0, unplaced: 0, wakes: 0, wakeTimes: [], denied: [] },
    reports: { reporters: [], handled: [] },
    ...more,
  }
}

/** An entry of a conversation's log as another load would have written it: one line holding `records` as of `at`, then `lines`. */
function entry(conv: string, writer: string, at: number, records: readonly Written[], lines: readonly string[] = []): Journal.Segment {
  const { patch } = Journal.next(Journal.emptyBook(), { records: [...records], groups: groupsOf() }, at, true)

  return { conv, writer, at, tie: null, seed: null, count: 0, lines: [JSON.stringify(patch), ...lines] }
}

describe('a reload goes on where the conversation was', () => {
  test('the records are listed again whole, with their reason, what was ruled out and their files, and nothing is asked of Fylgja for it', async ($, on) => {
    const set = await kept($, on, () => SESSION_ID)

    expect(await shown($)).toBe(`${QUIET} · 2 kept`)

    const calls = set.calls.length

    await reloaded($, set)

    expect(await shown($)).toBe(`${QUIET} · 2 kept`)
    expect(await listed($)).toEqual(BOTH)
    expect(set.calls.slice(calls).filter(call => call.tool !== 'recall'), 'no record is asked for again').toEqual([])
  })

  test('the records stay Scribe’s own: a later turn rewrites one in place and takes the other back, as if no load had come between', async ($, on) => {
    const REWORDED = { ...CAP, content: 'Cap retries at six.', updates: SECOND }
    const set = await kept($, on, () => SESSION_ID, {
      replies: [verdict({ records: [LOCK, CAP] }), JSON.stringify({ outcome: 'act', records: [REWORDED], withdraw: [FIRST], tells: [], question: null })],
    })

    await reloaded($, set)
    await turn($, set, dev('six retries, and no lock after all'), claude('Changed.', edit(FILE)))

    expect(set.of('amend_memory')).toEqual([
      { atom_id: FIRST, op: 'remove' },
      expect.objectContaining({ atom_id: SECOND, op: 'fix', content: 'Cap retries at six.' }),
    ])
    expect(set.of('remember'), 'nothing is written twice').toHaveLength(2)
  })

  test('a record removed before a reload can be put back after it, whole: its files go with it', async ($, on) => {
    const set = await kept($, on, () => SESSION_ID)

    await reloaded($, set)
    await $.command.run(COMMAND)

    const removing = await pane($)

    await removing.press(`row:${SECOND}`)
    await removing.press(`remove:${SECOND}`)
    await removing.press(`remove:${SECOND}`)
    await removing.unmount()
    await reloaded($, set)

    expect(await listed($)).toContain('  ◆ Decision · Cap retries at five. · removed')

    const ui = await pane($)

    await ui.press(`row:${SECOND}`)
    await ui.press(`putback:${SECOND}`)
    await ui.press(`putback:${SECOND}`)
    await ui.unmount()

    expect(set.of('remember').at(-1)).toMatchObject({ content: 'Cap retries at five.', anchors: [{ path: FILE }], alternatives: ['retry forever'] })
  })

  test('a decision that waited for its code still waits after a reload, and is given it by the code written then', async ($, on) => {
    const WAITING = decision({ content: 'Retry from an outbox table.', detail: 'It commits with the import.', anchors: [] })
    const later = JSON.stringify({ outcome: 'act', records: [], anchor: [{ id: FIRST, paths: [FILE] }] })
    const set = await kept(
      $,
      on,
      () => SESSION_ID,
      {
        replies: [verdict({ records: [WAITING] }), later],
        tools: {
          open: openOf({ [FIRST]: { content: 'Retry from an outbox table.', reason: 'It commits with the import.', alternatives: [] } }),
          recall: args => answer({ facts: typeof args.query === 'string' ? [fact(101, { content: 'Retry from an outbox table.', anchors: [] })] : [] }),
        },
      },
      [dev(`retry from an outbox table, the plan says why ${'x'.repeat(240)}`), claude('Planned.')],
    )

    expect(await listed($)).toContain(`In: ${Ledger.NO_CODE}`)

    await reloaded($, set)

    expect(await listed($)).toContain(`In: ${Ledger.NO_CODE}`)

    await turn($, set, dev('now write the outbox'), claude('Written.', edit(FILE)))

    expect(set.of('amend_memory')).toEqual([{ atom_id: FIRST, op: 'fix', anchors: [{ path: FILE }] }])
    expect(await listed($)).toContain(`In: ${FILE}`)
  })
})

describe('what was waiting survives a reload', () => {
  const UNEXPLAINED = decision({ detail: '', reason_status: 'not_stated', alternatives: ['Redis with Redlock'] })
  const ASKING = verdict({ records: [UNEXPLAINED], question: { form: 'reason', record: 0, options: ['One less service to run', 'Redis was flaky in CI'] } })

  test('a question nobody answered yet comes up again, and its answer is saved to its record', async ($, on) => {
    const set = await kept($, on, () => SESSION_ID, { replies: [ASKING] })

    expect(await shown($)).toMatch('? Why: Use Postgres advisory locks')

    await reloaded($, set)

    expect(await shown($), 'the same question, untouched').toMatch('? Why: Use Postgres advisory locks')

    await pressTwice($, 'reason:0')

    expect(set.of('amend_memory')).toEqual([{ atom_id: FIRST, op: 'fix', detail: 'One less service to run', reason_status: 'stated' }])
    expect(await shown($)).toMatch('Reason saved')

    await reloaded($, set)

    expect(await shown($), 'and answered, it does not come back').toBe(`${QUIET} · 1 kept`)
  })

  test('a change Fylgja could not make is still tried at the next turn’s end', async ($, on) => {
    let isDown = false
    const set = await kept($, on, () => SESSION_ID, {
      replies: [ASKING, NOTHING],
      tools: { amend_memory: args => (isDown ? new Promise<never>(() => undefined) : answer({ atom_id: args.atom_id, outcome: 'fixed' })) },
    })

    isDown = true

    await press($, 'reason:1')

    const pressing = press($, 'reason:1')

    // Fylgja does not answer: the change waits past the call's own time.
    await set.clock.settle()
    await set.clock.advance(60_000)
    await pressing

    expect(set.of('amend_memory')).toHaveLength(1)

    isDown = false
    await reloaded($, set)
    await turn($, set, dev('carry on'), claude('Done.', edit(FILE)))

    expect(set.of('amend_memory').at(-1), 'tried once more, as it was').toEqual({ atom_id: FIRST, op: 'fix', detail: 'Redis was flaky in CI', reason_status: 'stated' })

    // Sent: the log says so at once, and a load after it sends nothing again.
    const sent = set.of('amend_memory').length

    await reloaded($, set)
    await turn($, set, dev('and on'), claude('Done.', edit(FILE)))

    expect(set.of('amend_memory')).toHaveLength(sent)
  })

  test('a record waiting to be written that Fylgja already holds counts as done: nothing is shown, and it is not sent again', async ($, on) => {
    frame(on)
    const draft = { kind: 'decision', content: 'Cap retries at five.', detail: 'A sixth never succeeded.', alternatives: [], anchors: [{ path: FILE }], triggers: [], reasonStatus: 'stated', supersedes: null, repo: 'acme/web', updates: null }
    const { patch } = Journal.next(Journal.emptyBook(), { records: [], groups: groupsOf({ deferred: [{ draft } as never] }) }, 1, true)
    const set = stage(on, {
      kept: { [Journal.keyOf(SESSION_ID, 'earlierld') ?? '']: { conv: SESSION_ID, writer: 'earlierld', at: 1, tie: null, seed: null, count: 0, lines: [JSON.stringify(patch)] } },
      tools: { remember: () => answer({ atom_id: SECOND, outcome: 'duplicate' }) },
    })

    // Long after it was written: no load of it still runs.
    await set.clock.advance(Journal.LIVE_MS + 1000)
    set.rows.push(...WORK)
    await $.session.start(START)
    await turn($, set, dev(`go on ${'x'.repeat(240)}`), claude('Done.', edit(FILE)))
    await set.clock.settle()

    expect(set.of('remember')).toHaveLength(1)
    expect(await shown($)).toBe(QUIET)
    expect(foldedOf(set, SESSION_ID).groups.deferred, 'done with, in the log too').toEqual([])

    await reloaded($, set)
    await turn($, set, dev(`and on ${'x'.repeat(240)}`), claude('Done.', edit(FILE)))

    expect(set.of('remember')).toHaveLength(1)
  })
})

describe('a reload neither reads a turn twice nor skips one', () => {
  test('a turn that ended after the reload is read from where the last look stopped: what was recorded before is not recorded again', async ($, on) => {
    const again = (asked: Asked): string => (asked.prompt.includes('lock the retry queue') ? verdict({ records: [LOCK] }) : NOTHING)
    const set = await kept($, on, () => SESSION_ID, { replies: [verdict({ records: [LOCK] }), again] })

    // The next prompt is sent, and the plugin is loaded again while Claude works on it.
    await send($, 'and log every retry at warn')
    set.rows.push(dev('and log every retry at warn'))
    await reloaded($, set)
    await finish($, set, claude('Logged them, and the change is long enough to be read as a turn of its own.', edit(FILE)))

    expect(set.asked).toHaveLength(2)
    expect(set.asked[1]?.prompt, 'the developer’s prompt is told as theirs').toMatch('[developer] and log every retry at warn')
    expect(set.asked[1]?.prompt, 'the turn read before the reload is not read again').not.toMatch('lock the retry queue')
    expect(set.of('remember')).toHaveLength(1)
  })

  test('a quiet turn left for the next look is read by it, after a reload too', async ($, on) => {
    const set = stage(on)

    await $.session.start(START)
    await turn($, set, dev('thanks'), claude('Welcome.'))
    await reloaded($, set)
    await turn($, set, dev(`use postgres for the queue lock ${'x'.repeat(240)}`), claude('Postgres.', edit(FILE)))

    expect(set.asked).toHaveLength(1)
    expect(set.asked[0]?.prompt).toMatch('[developer] thanks')
  })
})

describe('a background job that goes on with the conversation as a fork', () => {
  test('picks up what it kept, under its own id from then on, and goes on with it as Scribe’s own', async ($, on) => {
    let id = SESSION_ID
    const REWORDED = { ...CAP, content: 'Cap retries at six.', updates: SECOND }
    const set = await kept($, on, () => id, { replies: [verdict({ records: [LOCK, CAP] }), verdict({ records: [REWORDED] })] })

    id = JOB
    await reloaded($, set)

    expect(await shown($)).toBe(`${QUIET} · 2 kept`)
    expect(await listed($)).toEqual(BOTH)
    expect(foldedOf(set, JOB).records.map(one => one.id), 'a job started again later finds them by its own id').toEqual([FIRST, SECOND])
    expect(foldedOf(set, SESSION_ID).records.map(one => one.id), 'and the conversation it went on from keeps its own').toEqual([FIRST, SECOND])

    await turn($, set, dev('six retries'), claude('Changed.', edit(FILE)))

    expect(set.of('amend_memory')).toEqual([expect.objectContaining({ atom_id: SECOND, op: 'fix', content: 'Cap retries at six.' })])
    expect(foldedOf(set, JOB).records.at(-1)?.content).toBe('Cap retries at six.')
    expect(foldedOf(set, SESSION_ID).records.at(-1)?.content, 'what the job changed is its own').toBe('Cap retries at five.')
  })

  test('the question the conversation was asking, and a change it had still to send, stay that conversation’s: the job neither asks nor sends them', async ($, on) => {
    let id = SESSION_ID
    let isDown = true
    const UNEXPLAINED = decision({ detail: '', reason_status: 'not_stated', alternatives: ['Redis with Redlock'] })
    const set = await kept($, on, () => id, {
      replies: [verdict({ records: [UNEXPLAINED, CAP], question: { form: 'reason', record: 0, options: ['One less service to run'] } }), NOTHING],
      tools: { amend_memory: args => (isDown ? new Promise<never>(() => undefined) : answer({ atom_id: args.atom_id, outcome: 'fixed' })) },
    })

    // The question's answer cannot reach Fylgja: it waits to be sent at the next turn's end.
    await pressTwiceSlowly($, set, 'reason:0')
    expect(set.of('amend_memory')).toHaveLength(1)

    isDown = false
    id = JOB
    await reloaded($, set)

    expect(await shown($), 'no question in the job').toBe(`${QUIET} · 2 kept`)

    await turn($, set, dev(`carry on with the job ${'x'.repeat(240)}`), claude('Done.', edit(FILE)))

    expect(set.of('amend_memory'), 'nor what its parent had still to send').toHaveLength(1)
  })

  test('a job whose start reads the id of the conversation it resumed, and its own after, keeps the list through the change', async ($, on) => {
    let id = SESSION_ID
    const set = await kept($, on, () => id, { replies: [verdict({ records: [LOCK, CAP] }), NOTHING] })

    await reloaded($, set)

    expect(await shown($)).toBe(`${QUIET} · 2 kept`)

    id = JOB
    await turn($, set, dev('and on'), claude('Sure.'))

    expect(await shown($)).toBe(`${QUIET} · 2 kept`)
    expect((await listed($))[0]).toBe(' ᚠ fylgja  | kept in this session | 2 kept')
  })

  test('one that kept records before any tool call is found by its rows alone', async ($, on) => {
    let id = SESSION_ID
    const set = await kept($, on, () => id, {}, [dev('lock the retry queue with redis, and cap the retries'), claude('Done.', edit(FILE))])

    id = JOB
    await reloaded($, set)

    expect(await shown($)).toBe(`${QUIET} · 2 kept`)
  })

  test('a fork of a fork picks up the nearest one alone: what that one let go stays gone', async ($, on) => {
    let id = SESSION_ID
    const LOG = decision({ content: 'Log every retry at warn.', detail: 'They were invisible.', anchors: [{ path: FILE }] })
    const set = await kept($, on, () => id, { replies: [verdict({ records: [LOCK, CAP] }), verdict({ records: [LOG] })] })

    await set.clock.advance(1000)
    id = JOB
    await reloaded($, set)
    await $.command.run(COMMAND)

    const ui = await pane($)

    await ui.press(`row:${FIRST}`)
    await ui.press(`remove:${FIRST}`)
    await ui.press(`remove:${FIRST}`)
    await ui.unmount()
    await turn($, set, dev('and log every retry'), claude('Done.', { ...edit(FILE), tool_use_id: 'toolu_02' }))
    await press($, 'ok')
    await set.clock.advance(1000)

    expect(foldedOf(set, JOB).records.map(one => one.id)).toEqual([SECOND, THIRD])

    id = idOf(906)
    await reloaded($, set)

    expect(await shown($)).toBe(`${QUIET} · 2 kept`)
    expect((await listed($)).filter(line => line.includes('◆')), 'the one it removed can be put back still').toEqual([
      '▸ ◆ Decision · Log every retry at warn.',
      '  ◆ Decision · Cap retries at five.',
      '  ◆ Decision · Use a Redis lock for the retry queue. · removed',
    ])
  })

  test('a conversation that has its own log keeps it, though a sibling forked from the same one wrote later', async ($, on) => {
    let id = SESSION_ID
    const LOG = decision({ content: 'Log every retry at warn.', detail: 'They were invisible.', anchors: [{ path: FILE }] })
    const set = await kept($, on, () => id, { replies: [verdict({ records: [LOCK, CAP] }), NOTHING, verdict({ records: [LOG] })] })
    const before = [...set.rows]
    const B = idOf(907)
    const A = idOf(908)

    // B goes on from it, takes the lock out, and goes on talking.
    await set.clock.advance(1000)
    id = B
    await reloaded($, set)
    await $.command.run(COMMAND)

    const ui = await pane($)

    await ui.press(`row:${FIRST}`)
    await ui.press(`remove:${FIRST}`)
    await ui.press(`remove:${FIRST}`)
    await ui.unmount()
    await turn($, set, dev('b goes its own way'), claude('Sure.', { ...edit(FILE), tool_use_id: 'toolu_b' }))
    await set.clock.settle()

    const ofB = [...set.rows]

    // A goes on from the same one, later, and keeps one more.
    await set.clock.advance(1000)
    set.rows.splice(0, set.rows.length, ...before)
    id = A
    await reloaded($, set)
    await turn($, set, dev('and log every retry'), claude('Done.', { ...edit(FILE), tool_use_id: 'toolu_02' }))
    await press($, 'ok')
    await set.clock.settle()

    expect(foldedOf(set, A).records.map(one => one.id)).toEqual([FIRST, SECOND, THIRD])

    // B is loaded again: its own log, not A's.
    await set.clock.advance(1000)
    set.rows.splice(0, set.rows.length, ...ofB)
    id = B
    await reloaded($, set)

    expect(await shown($)).toBe(`${QUIET} · 1 kept`)
    expect(foldedOf(set, B).records.map(one => one.id), 'and its own is not written over').toEqual([SECOND])
  })

  test('a load for a conversation whose rows hold none of its tool calls picks up nothing', async ($, on) => {
    let id = SESSION_ID
    const set = await kept($, on, () => id)

    id = idOf(905)
    set.rows.splice(0, set.rows.length, dev('another conversation'), claude('Sure.', { ...edit(FILE), tool_use_id: 'toolu_other' }))
    await reloaded($, set)

    expect(await listed($)).toContain(Ledger.QUIET.empty)
  })
})

describe('two loads writing one conversation', () => {
  test('each writes an entry of its own: one written beside this load’s is never written over, and a later load reads both', async ($, on) => {
    const set = await kept($, on, () => SESSION_ID, { replies: [verdict({ records: [LOCK] }), verdict({ records: [CAP] })] })
    const now = set.clock.now()
    // Another process on the same conversation keeps a record of its own, and takes the lock out, after this one wrote.
    const theirs = entry(SESSION_ID, 'otherload', now + 10, [written(THIRD, 'Log every retry at warn.')], [
      JSON.stringify({ at: now + 20, tombs: [{ id: FIRST, at: now + 20 }] }),
    ])
    const key = Journal.keyOf(SESSION_ID, 'otherload') ?? ''

    set.kept.set(key, theirs)
    await set.clock.advance(100)
    await turn($, set, dev('and cap the retries'), claude('Done.', edit(FILE)))
    await set.clock.settle()

    expect(set.kept.get(key), 'theirs is as they wrote it').toEqual(theirs)

    await reloaded($, set)

    expect((await listed($)).filter(line => line.includes('◆'))).toEqual(['▸ ◆ Decision · Cap retries at five.', '  ◆ Decision · Log every retry at warn.'])
  })

  test('a load lets go of the entries it picked up once its own holds all of them, but only those no load wrote lately', async ($, on) => {
    const set = await kept($, on, () => SESSION_ID)
    const one = new Set(set.kept.keys())

    // A second window, a moment later: the first may still run, and what it wrote stays beside the second's.
    await reloaded($, set)

    const two = new Set(set.kept.keys())

    expect([...one].filter(key => !two.has(key)), 'nothing of the first is let go').toEqual([])
    expect(two.size, 'the second load writes its own').toBe(one.size + 1)

    // Long after, nothing has written either: the next load lets both go for its own.
    await set.clock.advance(Journal.LIVE_MS + 1000)
    await reloaded($, set)

    expect(set.kept.size, 'one load’s worth again').toBe(one.size)

    await reloaded($, set)

    expect(await listed($), 'and what was kept reads whole').toEqual(BOTH)
  })
})

describe('a log that does not read whole', () => {
  test('a line that is no JSON, a line with no time and a record that is not one are passed over, and the rest stands', async ($, on) => {
    frame(on)
    const good = entry(SESSION_ID, 'goodload', 1000, [written(FIRST, 'Use a Redis lock for the retry queue.')])
    const mixed = JSON.stringify({ at: 2000, recs: [{ id: 'not-an-id', content: 'Nothing.' }, { ...written(SECOND, 'Cap retries at five.'), at: 2000, since: 2000 }] })
    const set = stage(on, {
      kept: {
        [Journal.keyOf(SESSION_ID, 'goodload') ?? '']: { ...good, lines: ['{"at": 1500, "recs": [', ...good.lines, '{"recs":[]}', mixed, '42'] },
        [Journal.keyOf(SESSION_ID, 'brokenld') ?? '']: 'not an entry at all',
      },
    })

    set.rows.push(...WORK)
    await $.session.start(START)
    await set.clock.settle()

    expect(await shown($)).toBe(`${QUIET} · 2 kept`)
    expect((await listed($)).filter(line => line.includes('◆'))).toEqual(['▸ ◆ Decision · Cap retries at five.', '  ◆ Decision · Use a Redis lock for the retry queue.'])
  })
})

describe('a conversation that is another one', () => {
  test('after /clear the window lists nothing, though the id read from the session is still the one before', async ($, on) => {
    const set = await kept($, on, () => SESSION_ID)

    await endedBy($, 'clear')

    expect(await listed($)).toContain(Ledger.QUIET.empty)

    await turn($, set, dev('something else entirely, and long enough to be worth a look of its own'), claude('Sure.', edit(FILE)))
    await set.clock.settle()

    expect(foldedOf(set, SESSION_ID).records.map(one => one.id), 'the cleared conversation keeps its own log').toEqual([FIRST, SECOND])
  })

  test('after /clear, a later load of the cleared-to conversation lists nothing either', async ($, on) => {
    let id = SESSION_ID
    const set = await kept($, on, () => id)

    id = idOf(902)
    set.rows.splice(0, set.rows.length)
    await endedBy($, 'clear', SESSION_ID)
    set.rows.push(dev('something else'), claude('Sure.', { ...edit(FILE), tool_use_id: 'toolu_03' }))
    await reloaded($, set)

    expect(await listed($)).toContain(Ledger.QUIET.empty)
  })

  test('a resume into another conversation lists that conversation’s own records, and a resume back lists these again', async ($, on) => {
    const OTHER = idOf(910)
    let id = SESSION_ID
    await kept($, on, () => id, {
      kept: { [Journal.keyOf(OTHER, 'otherload') ?? '']: entry(OTHER, 'otherload', 1, [written(THIRD, 'Log every retry at warn.')]) },
    })

    id = OTHER
    await endedBy($, 'resume', SESSION_ID)

    expect((await listed($)).filter(line => line.includes('◆'))).toEqual(['▸ ◆ Decision · Log every retry at warn.'])

    id = SESSION_ID
    await endedBy($, 'resume', OTHER)

    expect((await listed($))[0]).toBe(' ᚠ fylgja  | kept in this session | 2 kept')
  })

  for (const source of ['resume', 'fork'] as const) {
    test(`a ${source} into a conversation with no log of its own lists nothing, though its rows hold the tool call`, async ($, on) => {
      let id = SESSION_ID

      await kept($, on, () => id)
      id = idOf(904)

      // A branch has no end of its own: it is seen by its id, as the window is opened.
      if (source === 'resume') {
        await endedBy($, source, SESSION_ID)
      }

      expect(await listed($)).toContain(Ledger.QUIET.empty)
    })
  }
})

describe('the log is kept within bounds', () => {
  test(`conversations past the newest ${Journal.MAX_KEPT}, or not written for thirty days, are let go, and so is what the plugin kept before the log`, async ($, on) => {
    frame(on)
    const now = 100 * 24 * 3_600_000
    const many = Array.from({ length: 40 }, (_, at) => idOf(400 + at))
    const stale = idOf(499)
    const kept: Record<string, unknown> = {
      'scribe.list.whatever': { id: 'whatever', records: [] },
      'scribe.lists': ['whatever'],
      [Journal.INDEX]: [...many, stale].map((conv, at) => ({ conv, at: conv === stale ? now - Journal.MAX_AGE_MS - 1 : now - Journal.LIVE_MS - 1000 * (40 - at), chars: 100, tie: null, seed: null, count: 0 })),
    }

    for (const conv of [...many, stale]) {
      kept[Journal.keyOf(conv, 'someload') ?? ''] = entry(conv, 'someload', 1, [written(idOf(600), 'Something.')])
    }

    let id = SESSION_ID
    const set = stage(on, { kept, sessionId: () => id })

    await set.clock.set(now)
    set.rows.push(...WORK)
    await $.session.start(START)
    await turn($, set, dev('keep going'), claude('Done.', edit(FILE)))
    await set.clock.settle()

    expect(Object.keys(kept).filter(key => key.startsWith('scribe.list')).filter(key => set.kept.has(key)), 'what the plugin kept before the log').toEqual([])

    // Each conversation is opened again: one that was kept lists its record, one let go lists nothing.
    const kinds = async (conv: string): Promise<string[]> => {
      id = conv
      await endedBy($, 'resume', SESSION_ID)

      return (await listed($)).filter(line => line.includes('◆'))
    }

    expect(await kinds(idOf(400 + 40 - Journal.MAX_KEPT)), 'the oldest of the newest kept').toEqual(['▸ ◆ Decision · Something.'])
    expect(await kinds(idOf(439))).toEqual(['▸ ◆ Decision · Something.'])
    expect(await kinds(idOf(400 + 40 - Journal.MAX_KEPT - 1)), 'the newest one past them').toEqual([])
    expect(await kinds(stale), 'not written for thirty days').toEqual([])
  })

  test(`a long session’s entry is written again as one line past ${Journal.MAX_LINES} lines, and reads the same`, async ($, on) => {
    const set = await kept($, on, () => SESSION_ID, { replies: [verdict({ records: [LOCK, CAP] }), NOTHING] })

    for (let n = 0; n < Journal.MAX_LINES + 5; n += 1) {
      await turn($, set, dev(`step ${n} ${'x'.repeat(240)}`), claude('Done.', edit(FILE)))
      await set.clock.advance(60_000)
    }

    await reloaded($, set)

    expect(await listed($)).toEqual(BOTH)
  })
})

describe('a record picked up from the log is as Fylgja holds it before Scribe changes it', () => {
  test('reworded and given places elsewhere since: the rewrite keeps Fylgja’s places and adds its own', async ($, on) => {
    const MOVED = { ...CAP, content: 'Cap retries at six.', anchors: [{ path: FILE }, { path: 'src/queue/backoff.ts' }], updates: SECOND }
    const set = await kept($, on, () => SESSION_ID, {
      replies: [verdict({ records: [LOCK, CAP] }), verdict({ records: [MOVED] })],
      tools: {
        open: openOf({ ...AS_KEPT, [SECOND]: { content: 'Cap retries at five, then alert.', reason: 'A sixth never succeeded.', alternatives: [] } }),
        recall: args =>
          answer({ facts: Array.isArray(args.paths) && args.paths.includes(FILE) ? [fact(102, { content: 'Cap retries at five, then alert.', anchors: [{ path: FILE }, { path: 'src/queue/retry.ts' }] })] : [] }),
      },
    })

    await reloaded($, set)
    await turn($, set, dev('six retries, and back off'), claude('Changed.', edit(FILE), edit('src/queue/backoff.ts')))

    expect(set.of('open').map(args => args.ref), 'asked once, before the change').toEqual([SECOND])
    expect(set.of('amend_memory')).toEqual([
      expect.objectContaining({
        atom_id: SECOND,
        content: 'Cap retries at six.',
        anchors: [{ path: FILE }, { path: 'src/queue/retry.ts' }, { path: 'src/queue/backoff.ts' }],
      }),
    ])
  })

  test('scoped to a customer elsewhere since: the rewrite keeps Fylgja’s scope and its card says for whom', async ($, on) => {
    const MOVED = { ...CAP, content: 'Cap retries at six.', updates: SECOND }
    const asKept = openOf(AS_KEPT)
    const set = await kept($, on, () => SESSION_ID, {
      replies: [verdict({ records: [LOCK, CAP] }), verdict({ records: [MOVED] })],
      tools: {
        open: args => {
          const answered = asKept(args) as { content: { text: string }[] }
          const payload = JSON.parse(answered.content[0]?.text ?? '{}') as { focus?: { atom?: Record<string, unknown> } }

          return args.ref === SECOND && payload.focus?.atom !== undefined
            ? answer({ ...payload, focus: { ...payload.focus, atom: { ...payload.focus.atom, applies_to: ['Northwind'] } } })
            : answered
        },
      },
    })

    await reloaded($, set)
    await turn($, set, dev('six retries'), claude('Changed.', edit(FILE)))

    expect('applies_to' in (set.of('amend_memory')[0] ?? {}), 'none named: its scope is left as it is').toBe(false)
    expect(await shown($)).toMatch('For: Northwind')
  })

  test('places Fylgja could not be asked for are never sent: the rewrite changes the words alone', async ($, on) => {
    const MOVED = { ...CAP, content: 'Cap retries at six.', anchors: [{ path: FILE }, { path: 'src/queue/backoff.ts' }], updates: SECOND }
    const set = await kept($, on, () => SESSION_ID, { replies: [verdict({ records: [LOCK, CAP] }), verdict({ records: [MOVED] })], tools: { open: openOf(AS_KEPT) } })

    await reloaded($, set)
    await turn($, set, dev('six retries, and back off'), claude('Changed.', edit(FILE), edit('src/queue/backoff.ts')))

    expect(set.of('amend_memory')).toEqual([expect.objectContaining({ atom_id: SECOND, content: 'Cap retries at six.' })])
    expect(set.of('amend_memory')[0]).not.toHaveProperty('anchors')
  })

  test('one Fylgja no longer has is let go before anything is sent, and stays gone after the next load', async ($, on) => {
    const set = await kept($, on, () => SESSION_ID, {
      replies: [verdict({ records: [LOCK, CAP] }), JSON.stringify({ outcome: 'act', records: [], withdraw: [FIRST], tells: [], question: null })],
      tools: { open: openOf({ [SECOND]: { content: 'Cap retries at five.', reason: 'A sixth never succeeded.', alternatives: ['retry forever'] } }) },
    })

    await reloaded($, set)
    await turn($, set, dev('no lock after all'), claude('Changed.', edit(FILE)))

    expect(set.of('amend_memory'), 'nothing sent for it').toEqual([])
    expect(await shown($)).toBe(`${QUIET} · 1 kept`)

    await reloaded($, set)

    expect(await shown($)).toBe(`${QUIET} · 1 kept`)
  })

  test('a change Fylgja turns down because the record is not there lets the record go, from the log too', async ($, on) => {
    const set = await kept($, on, () => SESSION_ID, {
      replies: [verdict({ records: [LOCK, CAP] }), verdict({ records: [{ ...CAP, content: 'Cap retries at six.', updates: SECOND }] })],
      tools: { amend_memory: () => NOT_FOUND },
    })

    await turn($, set, dev('six retries'), claude('Changed.', edit(FILE)))

    expect(set.of('amend_memory')).toHaveLength(1)
    expect(await shown($)).toBe(`${QUIET} · 1 kept`)

    await reloaded($, set)

    expect(await shown($)).toBe(`${QUIET} · 1 kept`)
    expect(foldedOf(set, SESSION_ID).records.map(one => one.id)).toEqual([FIRST])
  })
})

describe('a load at an awkward moment', () => {
  test('loaded again while a write is on its way: the write lands, and the load after it has everything', async ($, on) => {
    const set = await kept($, on, () => SESSION_ID, { replies: [verdict({ records: [LOCK] }), verdict({ records: [CAP] })] })

    await turn($, set, dev('and cap the retries'), claude('Done.', edit(FILE)))
    // No moment for the write to land before the load.
    await $.session.start(START)
    await reloaded($, set)

    expect((await listed($)).filter(line => line.includes('◆'))).toEqual(['▸ ◆ Decision · Cap retries at five.', '  ◆ Decision · Use a Redis lock for the retry queue.'])
  })

  test('a fork in the session right after a load, before any turn ended, is still the conversation loaded for: its records, not its question', async ($, on) => {
    const UNEXPLAINED = decision({ detail: '', reason_status: 'not_stated', alternatives: ['Redis with Redlock'] })
    let id = SESSION_ID
    const set = await kept($, on, () => id, {
      replies: [verdict({ records: [UNEXPLAINED], question: { form: 'reason', record: 0, options: ['One less service to run'] } })],
    })

    await reloaded($, set)

    expect(await shown($)).toMatch('? Why')

    // A branch has no end of its own: it is seen by its id, as the window is opened.
    id = idOf(920)

    expect((await listed($))[0]).toBe(' ᚠ fylgja  | kept in this session | 1 kept')
    expect(await shown($)).toBe(`${QUIET} · 1 kept`)
  })

  test('a resume right after a load, before any turn ended, picks up the conversation it goes into', async ($, on) => {
    const OTHER = idOf(921)
    let id = SESSION_ID
    const set = await kept($, on, () => id, {
      kept: { [Journal.keyOf(OTHER, 'otherload') ?? '']: entry(OTHER, 'otherload', 1, [written(THIRD, 'Log every retry at warn.')]) },
    })

    await reloaded($, set)
    id = OTHER
    await endedBy($, 'resume', SESSION_ID)

    expect((await listed($)).filter(line => line.includes('◆'))).toEqual(['▸ ◆ Decision · Log every retry at warn.'])
  })
})

describe('what the log costs', () => {
  test('a turn’s end writes the store once, and a long session keeps it small', async ($, on) => {
    const set = await kept($, on, () => SESSION_ID, { replies: [verdict({ records: [LOCK, CAP] }), NOTHING] })
    // A turn after the first: the conversation is in the index already.
    await turn($, set, dev(`warm up ${'x'.repeat(240)}`), claude('Done.', edit('src/warm.ts')))
    await set.clock.settle()

    // Each write of the store puts a new value under its key.
    const before = new Map(set.kept)

    await finish($, set, claude(`a turn with a change ${'x'.repeat(240)}`, edit('src/one.ts')))
    await set.clock.settle()

    expect([...set.kept].filter(([key, value]) => before.get(key) !== value).map(([key]) => key.split('.').slice(0, 2).join('.')), 'one entry, and no index').toEqual(['scribe.log'])

    for (let n = 0; n < 60; n += 1) {
      await turn($, set, dev(`step ${n} ${'x'.repeat(240)}`), claude('Done.', edit(`src/area${n}/file${n}.ts`)))
      await set.clock.advance(70_000)
    }

    const size = JSON.stringify(Object.fromEntries(set.kept)).length

    expect(size).toBeLessThan(Journal.MAX_SEGMENT_CHARS * 2)
  })

  test('no prompt is kept in the store as it was typed', async ($, on) => {
    const set = await kept($, on, () => SESSION_ID)

    expect(JSON.stringify([...set.kept])).not.toContain('lock the retry queue with redis')
  })
})
