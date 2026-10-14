import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import * as Ledger from '../hooks/scribe/ledger'
import { marksOf, MAX_ROWS, nearest } from '../hooks/scribe/saved'
import { LEGENDS } from '../hooks/listing'
import { answer, idOf } from './fixtures'
import { frame, pane } from './window-fixtures'
import type { Row } from '../hooks/scribe/delta'
import { claude, decision, dev, edit, NOTHING, press, QUIET, SESSION_ID, shown, stage, START, turn, verdict } from './scribe-fixtures'
import type { Stage, StageOptions } from './scribe-fixtures'

// Claude Code loads the plugin afresh, with nothing it held, when it starts
// it again after losing its copy, and when a conversation is moved to the
// background from the agents view and opened again: there it goes on in a
// background job that resumed it as a fork, under an id of its own. The
// session's start is how the plugin hears of either.

const FILE = 'src/queue/lock.ts'
/** The last tool call of the conversation: what a fork of it carries over with its rows. */
const TIE = 'toolu_01A2b3C4d5E6f7'
const WORK = [dev('lock the retry queue with redis, and cap the retries'), claude('Done.', { ...edit(FILE), tool_use_id: TIE })]
const LOCK = decision({ content: 'Use a Redis lock for the retry queue.', detail: 'Redis is already there.', anchors: [{ path: FILE, symbol: 'acquire' }] })
const CAP = decision({ content: 'Cap retries at five.', detail: 'A sixth never succeeded.', alternatives: ['retry forever'], anchors: [{ path: FILE }] })

const FIRST = idOf(101)
const SECOND = idOf(102)
const THIRD = idOf(103)

/** The background job's own id for the conversation it goes on with. */
const JOB = idOf(901)

const CAP_ROW = '▸ ◆ Decision · Cap retries at five.'
const LOCK_ROW = '  ◆ Decision · Use a Redis lock for the retry queue.'

const COMMAND = {
  command: 'fylgja-kept',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
} as never

/** What Fylgja holds of the records, as `open` answers for them; any other id reads as a decision of its own. */
const HELD: Readonly<Record<string, { content: string; reason: string; alternatives: string[] }>> = {
  [FIRST]: { content: 'Use a Redis lock for the retry queue.', reason: 'Redis is already there.', alternatives: [] },
  [SECOND]: { content: 'Cap retries at five.', reason: 'A sixth never succeeded.', alternatives: ['retry forever'] },
  [THIRD]: { content: 'Log every retry at warn.', reason: 'They were invisible.', alternatives: [] },
}

/** An error answer of Fylgja's, in its own opening words. */
const failed = (text: string): unknown => ({ content: [{ type: 'text', text }], isError: true })

const NOT_FOUND = failed('record not found: nothing under that id')
const RATE_LIMITED = failed('too many calls: wait a minute')
const SERVER_FAULT = failed('Error calling tool open: the database went away')

function opened(args: Record<string, unknown>): unknown {
  const id = String(args.ref)
  const held = HELD[id] ?? { content: `Decide number ${id.slice(-3)}.`, reason: 'Because.', alternatives: [] }

  return answer({
    kind: 'atom',
    focus: {
      atom: { id, type: 'decision', content: held.content },
      decision: { reason: held.reason, reason_status: 'stated', alternatives: held.alternatives },
    },
  })
}

/** The key a conversation's records are kept under. */
const keyOf = (id: string): string => `scribe.list.${id}`

type Kept = { id: string; at: number; tie: string | null; seed: string | null; count: number; records: { id: string; kind: string; outcome: string }[] }

/** What is kept for the conversation `id`. */
const entryOf = (set: Stage, id: string): Kept | undefined => set.kept.get(keyOf(id)) as Kept | undefined

/** A session in which Scribe kept the lock and then the cap; the conversation's id is what `id` says when read. */
async function kept($: Engine, on: On, id: () => string, options: StageOptions = {}, work: readonly Row[] = WORK): Promise<Stage> {
  frame(on)
  const set = stage(on, { replies: [verdict({ records: [LOCK, CAP] })], sessionId: id, ...options, tools: { open: opened, ...options.tools } })

  await $.session.start(START)
  await turn($, set, ...work)
  await press($, 'ok')
  await set.clock.settle()

  return set
}

/** The rows the window of what was kept lists, opened by its command. */
async function listed($: Engine): Promise<string[]> {
  await $.command.run(COMMAND)

  const ui = await pane($)
  const lines = await ui.lines()

  await ui.unmount()

  return lines
}

describe('what was kept in a conversation is listed again when the plugin is loaded afresh for it', () => {
  test('started again under the same id: both records are listed again, as Fylgja holds them, and the mark counts them', async ($, on) => {
    const set = await kept($, on, () => SESSION_ID)

    expect(await shown($)).toBe(`${QUIET} · 2 kept`)

    await $.session.start(START)

    expect(set.of('open').map(args => args.ref), 'each asked of Fylgja once').toEqual([FIRST, SECOND])
    expect(await shown($)).toBe(`${QUIET} · 2 kept`)
    expect(await listed($)).toEqual([
      ' ᚠ fylgja  | kept in this session | 2 kept',
      CAP_ROW,
      'Why: A sixth never succeeded.',
      'Rejected: retry forever',
      LOCK_ROW,
      LEGENDS.list,
    ])
  })

  test('moved to the background and opened again: the job goes on under its own id and lists them, and keeps them under that id', async ($, on) => {
    let id = SESSION_ID
    const set = await kept($, on, () => id)

    id = JOB
    await $.session.start(START)

    expect(await shown($)).toBe(`${QUIET} · 2 kept`)
    expect((await listed($)).slice(1, 2)).toEqual([CAP_ROW])

    await set.clock.settle()

    expect(entryOf(set, JOB)?.records.map(one => one.id), 'a job started again later finds them by its own id').toEqual([FIRST, SECOND])
    expect(entryOf(set, SESSION_ID)?.records.map(one => one.id), 'and the conversation it went on from keeps its own').toEqual([FIRST, SECOND])
  })

  test('a job started again under its own id, its rows not read yet, lists them once the window is opened', async ($, on) => {
    let id = SESSION_ID
    const set = await kept($, on, () => id)
    const rows = [...set.rows]

    id = JOB
    set.rows.splice(0, set.rows.length)
    await $.session.start(START)

    expect(set.of('open')).toEqual([])

    set.rows.push(...rows)

    expect((await listed($))[0]).toBe(' ᚠ fylgja  | kept in this session | 2 kept')
  })

  test('the records written after it are listed after the ones picked up, and a later load finds all of them', async ($, on) => {
    const set = await kept($, on, () => SESSION_ID, {
      replies: [verdict({ records: [LOCK, CAP] }), verdict({ records: [decision({ content: 'Log every retry at warn.', detail: 'They were invisible.', anchors: [{ path: FILE }] })] })],
    })

    await $.session.start(START)
    await turn($, set, dev('and log every retry'), claude('Done.', { ...edit(FILE), tool_use_id: 'toolu_02' }))
    await press($, 'ok')
    await set.clock.settle()

    expect(await shown($)).toBe(`${QUIET} · 3 kept`)

    await $.session.start(START)

    expect(set.of('open').map(args => args.ref), 'each is asked of Fylgja again on each load').toEqual([FIRST, SECOND, FIRST, SECOND, THIRD])
    expect(await shown($)).toBe(`${QUIET} · 3 kept`)
    expect((await listed($)).slice(1, 2), 'newest first').toEqual(['▸ ◆ Decision · Log every retry at warn.'])
  })

  test('a record Fylgja no longer has is not listed', async ($, on) => {
    const set = await kept($, on, () => SESSION_ID, { tools: { open: args => (args.ref === FIRST ? NOT_FOUND : opened(args)) } })

    await $.session.start(START)

    expect(set.of('open')).toHaveLength(2)
    expect(await shown($)).toBe(`${QUIET} · 1 kept`)

    await set.clock.settle()

    expect(entryOf(set, SESSION_ID)?.records.map(one => one.id), 'and it is let go here too').toEqual([SECOND])
  })

  test('Fylgja not answering leaves them to be picked up when the window is opened', async ($, on) => {
    let isDown = false
    const set = await kept($, on, () => SESSION_ID, {
      tools: { open: args => (isDown ? new Promise<never>(() => undefined) : opened(args)) },
    })

    isDown = true

    const starting = $.session.start(START)

    await set.clock.advance(60_000)
    await starting

    expect(await shown($), 'nothing listed yet').toBe(QUIET)
    expect(entryOf(set, SESSION_ID)?.records.map(one => one.id), 'and nothing let go').toEqual([FIRST, SECOND])

    isDown = false

    expect((await listed($))[0]).toBe(' ᚠ fylgja  | kept in this session | 2 kept')
  })

  test('no word of a record is kept on this machine: ids and fixed words only', async ($, on) => {
    const set = await kept($, on, () => SESSION_ID)

    expect([...set.kept.keys()].filter(key => key.startsWith('scribe.list')).sort()).toEqual([keyOf(SESSION_ID), 'scribe.lists'])
    const { at, seed, ...rest } = entryOf(set, SESSION_ID) ?? { at: undefined, seed: undefined }

    expect(typeof at).toBe('number')
    expect(seed, 'a hash of the rows, none of their words').toMatch(/^[0-9a-z]{1,16}$/)
    expect(rest).toEqual({
      id: SESSION_ID,
      tie: TIE,
      count: 2,
      records: [
        { id: FIRST, kind: 'decision', outcome: 'created' },
        { id: SECOND, kind: 'decision', outcome: 'created' },
      ],
    })
    expect(set.kept.get('scribe.lists')).toEqual([SESSION_ID])
    expect(JSON.stringify([...set.kept.entries()])).not.toMatch(/Redis|retries|sixth|lock/i)
  })

  test('a record picked up again and removed in the window is not offered to be put back: it is not known whole here', async ($, on) => {
    await kept($, on, () => SESSION_ID)
    await $.session.start(START)
    await $.command.run(COMMAND)

    const ui = await pane($)

    await ui.press(`row:${SECOND}`)
    await ui.press(`remove:${SECOND}`)
    await ui.press(`remove:${SECOND}`)

    expect(await ui.rows()).toEqual(['▸ ◆ Decision · Use a Redis lock for the retry queue.'])

    await ui.unmount()
  })
})

describe('a conversation that is another one starts over all the same', () => {
  test('after /clear, as Claude Code says it, the window lists nothing, and a later load of the cleared conversation neither', async ($, on) => {
    let id = SESSION_ID
    const set = await kept($, on, () => id)

    await $.session.start(START)

    expect(await shown($)).toBe(`${QUIET} · 2 kept`)

    id = idOf(902)
    set.rows.splice(0, set.rows.length)
    await $.classic.SessionStart({ source: 'clear', session_id: id })

    expect(await listed($)).toContain(Ledger.QUIET.empty)

    set.rows.push(dev('something else'), claude('Sure.', { ...edit(FILE), tool_use_id: 'toolu_03' }))
    await $.session.start(START)

    expect(await listed($)).toContain(Ledger.QUIET.empty)
  })

  test('after /clear Claude Code says nothing of, right after a load, the changed id alone empties the window, and the new conversation keeps it so', async ($, on) => {
    let id = SESSION_ID
    const set = await kept($, on, () => id, { replies: [verdict({ records: [LOCK, CAP] }), NOTHING] })

    await $.session.start(START)

    id = idOf(903)
    set.rows.splice(0, set.rows.length)

    expect(await listed($)).toContain(Ledger.QUIET.empty)

    await turn($, set, dev('something else entirely'), claude('Sure.', { ...edit(FILE), tool_use_id: 'toolu_04' }))

    expect(await shown($)).toBe(QUIET)
  })

  for (const source of ['resume', 'fork'] as const) {
    test(`a ${source} into another id in the same process lists nothing, though its rows hold the tool call`, async ($, on) => {
      let id = SESSION_ID
      await kept($, on, () => id)

      id = idOf(904)
      await $.classic.SessionStart({ source, session_id: id })

      expect(await listed($)).toContain(Ledger.QUIET.empty)
    })
  }

  test('a load for a conversation whose rows hold none of its tool calls lists nothing', async ($, on) => {
    let id = SESSION_ID
    const set = await kept($, on, () => id)

    id = idOf(905)
    set.rows.splice(0, set.rows.length, dev('another conversation'), claude('Sure.', { ...edit(FILE), tool_use_id: 'toolu_other' }))
    await $.session.start(START)

    expect(set.of('open')).toEqual([])
    expect(await listed($)).toContain(Ledger.QUIET.empty)
  })
})

describe('picking them up costs no records and no more than its share', () => {
  for (const [what, answered] of [
    ['over its allowance', RATE_LIMITED],
    ['with a fault of its own', SERVER_FAULT],
  ] as const) {
    test(`Fylgja answering ${what} lets go of nothing: they wait, kept on this machine, and come back when it answers`, async ($, on) => {
      let isFailing = false
      const set = await kept($, on, () => SESSION_ID, { tools: { open: args => (isFailing ? answered : opened(args)) } })

      isFailing = true
      await $.session.start(START)
      await set.clock.settle()

      expect(set.of('open')).toHaveLength(2)
      expect(await shown($)).toBe(QUIET)
      expect(entryOf(set, SESSION_ID)?.records.map(one => one.id), 'nothing let go').toEqual([FIRST, SECOND])

      isFailing = false

      expect((await listed($))[0]).toBe(' ᚠ fylgja  | kept in this session | 2 kept')
    })
  }

  test('no more than four records are asked of Fylgja at once', async ($, on) => {
    frame(on)
    const many = Array.from({ length: 10 }, (_, at) => idOf(300 + at))
    let inFlight = 0
    let most = 0
    const set = stage(on, {
      kept: { [keyOf(SESSION_ID)]: { id: SESSION_ID, at: 1, tie: TIE, seed: null, count: 0, records: many.map(id => ({ id, kind: 'decision', outcome: 'created' })) } },
      tools: {
        open: async (args, clock) => {
          inFlight += 1
          most = Math.max(most, inFlight)
          await clock.sleep(100)
          inFlight -= 1

          return opened(args)
        },
      },
    })

    set.rows.push(...WORK)

    const starting = $.session.start(START)

    await set.clock.advance(5_000)
    await starting

    expect(set.of('open')).toHaveLength(10)
    expect(most).toBe(4)
    expect(await shown($)).toBe(`${QUIET} · 10 kept`)
  })

  test('another session writing its own conversation, and the index as it read it, costs this one nothing', async ($, on) => {
    const other = idOf(950)
    const theirs = { id: other, at: 1, tie: 'toolu_theirs', seed: null, count: 0, records: [{ id: idOf(960), kind: 'decision', outcome: 'created' }] }
    const set = await kept($, on, () => SESSION_ID, { kept: { [keyOf(other)]: theirs, 'scribe.lists': [other] } })

    // The other session writes the index it read before this one wrote.
    set.kept.set('scribe.lists', [other])
    await $.session.start(START)
    await set.clock.settle()

    expect(await shown($), 'found by its own key').toBe(`${QUIET} · 2 kept`)
    expect(entryOf(set, other), 'and theirs is as they wrote it').toEqual(theirs)
  })
})

describe('the conversation it goes on from is found by its rows', () => {
  test('one that kept records before any tool call is found by its rows alone', async ($, on) => {
    let id = SESSION_ID
    const set = await kept($, on, () => id, {}, [dev('lock the retry queue with redis, and cap the retries'), claude('Done.', edit(FILE))])

    expect(entryOf(set, SESSION_ID)?.tie).toBeNull()

    id = JOB
    await $.session.start(START)

    expect(await shown($)).toBe(`${QUIET} · 2 kept`)
  })

  test('a fork of a fork picks up the nearest one alone: what that one let go stays gone', async ($, on) => {
    let id = SESSION_ID
    const LOG = decision({ content: 'Log every retry at warn.', detail: 'They were invisible.', anchors: [{ path: FILE }] })
    const set = await kept($, on, () => id, { replies: [verdict({ records: [LOCK, CAP] }), verdict({ records: [LOG] })] })

    await set.clock.advance(1000)
    id = JOB
    await $.session.start(START)
    await $.command.run(COMMAND)

    const ui = await pane($)

    await ui.press(`row:${FIRST}`)
    await ui.press(`remove:${FIRST}`)
    await ui.press(`remove:${FIRST}`)
    await ui.unmount()
    await turn($, set, dev('and log every retry'), claude('Done.', { ...edit(FILE), tool_use_id: 'toolu_02' }))
    await press($, 'ok')
    await set.clock.settle()
    await set.clock.advance(1000)

    expect(entryOf(set, JOB)?.records.map(one => one.id)).toEqual([SECOND, THIRD])

    const before = set.of('open').length

    id = idOf(906)
    await $.session.start(START)

    expect(set.of('open').slice(before).map(args => args.ref)).toEqual([SECOND, THIRD])
    expect(await shown($)).toBe(`${QUIET} · 2 kept`)
  })

  test('a job whose start reads the id of the conversation it resumed, and its own after, keeps the list through the change', async ($, on) => {
    let id = SESSION_ID
    const set = await kept($, on, () => id, { replies: [verdict({ records: [LOCK, CAP] }), NOTHING] })

    await $.session.start(START)

    expect(await shown($)).toBe(`${QUIET} · 2 kept`)

    id = JOB
    await turn($, set, dev('and on'), claude('Sure.'))

    expect(await shown($)).toBe(`${QUIET} · 2 kept`)
    expect((await listed($))[0]).toBe(' ᚠ fylgja  | kept in this session | 2 kept')
  })
})

describe('the conversation picked up is its own, or the nearest it goes on from', () => {
  const LOG = decision({ content: 'Log every retry at warn.', detail: 'They were invisible.', anchors: [{ path: FILE }] })

  test('a conversation that has its own list keeps it, though a sibling forked from the same one wrote later', async ($, on) => {
    let id = SESSION_ID
    const set = await kept($, on, () => id, { replies: [verdict({ records: [LOCK, CAP] }), NOTHING, verdict({ records: [LOG] })] })
    const before = [...set.rows]
    const B = idOf(907)
    const A = idOf(908)

    // B goes on from it, takes the lock out, and goes on talking.
    await set.clock.advance(1000)
    id = B
    await $.session.start(START)
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
    await $.session.start(START)
    await turn($, set, dev('and log every retry'), claude('Done.', { ...edit(FILE), tool_use_id: 'toolu_02' }))
    await press($, 'ok')
    await set.clock.settle()

    expect(entryOf(set, A)?.records.map(one => one.id)).toEqual([FIRST, SECOND, THIRD])

    // B is loaded again: its own list, not A's.
    await set.clock.advance(1000)
    set.rows.splice(0, set.rows.length, ...ofB)
    id = B

    const asked = set.of('open').length

    await $.session.start(START)
    await set.clock.settle()

    expect(set.of('open').slice(asked).map(args => args.ref)).toEqual([SECOND])
    expect(await shown($)).toBe(`${QUIET} · 1 kept`)
    expect(entryOf(set, B)?.records.map(one => one.id), 'and its own is not written over').toEqual([SECOND])
  })

  test('a conversation with no list of its own takes the one it went on from, not a sibling that wrote later', async ($, on) => {
    let id = SESSION_ID
    const set = await kept($, on, () => id, { replies: [verdict({ records: [LOCK, CAP] }), verdict({ records: [LOG] })] })
    const before = [...set.rows]

    await set.clock.advance(1000)
    id = idOf(908)
    await $.session.start(START)
    await turn($, set, dev('and log every retry'), claude('Done.', { ...edit(FILE), tool_use_id: 'toolu_02' }))
    await press($, 'ok')
    await set.clock.settle()
    await set.clock.advance(1000)

    set.rows.splice(0, set.rows.length, ...before)
    id = idOf(909)

    const asked = set.of('open').length

    await $.session.start(START)

    expect(set.of('open').slice(asked).map(args => args.ref)).toEqual([FIRST, SECOND])
  })

  test('kept conversations the index lost neither hide the ones it lists nor stay past the newest twenty', async ($, on) => {
    frame(on)
    const orphans = Object.fromEntries(
      Array.from({ length: 70 }, (_, at) => {
        const id = idOf(400 + at)

        return [keyOf(id), { id, at: 10 + at, tie: `toolu_orphan${at}`, seed: null, count: 0, records: [{ id: idOf(600 + at), kind: 'decision', outcome: 'created' }] }]
      }),
    )
    const set = stage(on, {
      kept: {
        'scribe.lists': [SESSION_ID],
        [keyOf(SESSION_ID)]: {
          id: SESSION_ID,
          at: 1,
          tie: TIE,
          seed: null,
          count: 0,
          records: [
            { id: FIRST, kind: 'decision', outcome: 'created' },
            { id: SECOND, kind: 'decision', outcome: 'created' },
          ],
        },
        ...orphans,
      },
      tools: { open: opened },
    })

    set.rows.push(...WORK)
    await $.session.start(START)
    await set.clock.settle()

    expect(await shown($)).toBe(`${QUIET} · 2 kept`)

    const left = [...set.kept.keys()].filter(key => key.startsWith('scribe.list.'))

    expect(left).toHaveLength(20)
    expect(left).toContain(keyOf(SESSION_ID))
    expect(left, 'the newest of the others stay').toContain(keyOf(idOf(469)))
  })
})

describe('which kept conversation is the one', () => {
  test('its own always, whatever matches its rows and was written later', () => {
    const rows = [...WORK]
    const own = { id: JOB, at: 1, tie: null, seed: null, count: 0, records: [] }
    const sibling = { id: idOf(910), at: 9, ...marksOf(rows), records: [] }

    expect(nearest([sibling, own], JOB, rows)?.id).toBe(JOB)
    expect(nearest([sibling], JOB, rows)?.id, 'and without it, what its rows go on from').toBe(idOf(910))
  })

  test('the tool call is not asked where rows can be compared: a kept hash that does not match is no match', () => {
    const rows = [...WORK]
    const other = { id: idOf(911), at: 1, tie: TIE, seed: 'zzz', count: 1, records: [] }

    expect(nearest([other], JOB, rows)).toBeUndefined()
  })
})

describe('a history longer than the rows answered', () => {
  const long = (n: number, tie: string): Row[] =>
    Array.from({ length: n }, (_, at): Row => (at === n - 1 ? claude('Done.', { ...edit(FILE), tool_use_id: tie }) : dev(`row ${at}`)))

  test('is given no hash of its rows, and is found by its last tool call', () => {
    expect(marksOf(long(MAX_ROWS, TIE))).toEqual({ tie: TIE, seed: null, count: 0 })
  })

  test('one kept while it was short is found by its tool call once its rows no longer begin where it began', () => {
    const short = long(10, TIE)
    const saved = { id: SESSION_ID, at: 1, ...marksOf(short), records: [] }

    expect(saved.seed).not.toBeNull()
    expect(nearest([saved], JOB, [...long(MAX_ROWS - 1, 'toolu_x').slice(5), ...short.slice(-1), ...long(5, 'toolu_y')])?.id).toBe(SESSION_ID)
  })
})
