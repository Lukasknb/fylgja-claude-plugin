import { describe, expect, test } from 'claude-code/testing'

import { answer, idOf } from './fixtures'
import {
  carded,
  claude,
  decision,
  dev,
  edit,
  fact,
  finish,
  NOTHING,
  ROOT,
  send,
  sessionOf,
  shown,
  stage,
  START,
  turn,
  use,
  verdict,
} from './scribe-fixtures'

const FILE = 'src/queue/lock.ts'
const FIRST = decision({
  content: 'Use a Redis lock for the retry queue.',
  detail: 'Redis is already there.',
  anchors: [{ path: FILE }],
})
const SECOND = {
  ...FIRST,
  content: 'Use a Postgres advisory lock for the retry queue.',
  detail: 'Redis dropped connections under load.',
}
const OWN = idOf(101)
const one = (text: string) => [dev(text), claude('Done.', edit(FILE))]

describe('Scribe keeps its own records of the session true', () => {
  test('a decision that replaces one Scribe recorded earlier in the session rewrites that record: no second one, no key', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [FIRST] }), verdict({ records: [{ ...SECOND, updates: OWN }] })] })

    await $.session.start(START)
    await turn($, set, ...one('lock the retry queue with redis'))
    await turn($, set, ...one('no, redis keeps dropping, use postgres advisory locks'))

    expect(set.asked[1]?.prompt, 'its own records are listed with their ids').toMatch(
      `- (id=${OWN}) Use a Redis lock for the retry queue.`,
    )
    expect(set.of('remember').length, 'one record').toBe(1)
    expect(set.of('amend_memory')).toMatchObject([
      { atom_id: OWN, op: 'fix', content: SECOND.content, detail: SECOND.detail, reason_status: 'stated' },
    ])
    expect(await shown($)).toBe(carded(`✓ Updated · ${SECOND.content} [1 Fix] [2 Remove] [9 What is this] [0 OK]`))
  })

  test('a decision that was dropped is taken back, and the receipt says so', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [FIRST] }), JSON.stringify({ outcome: 'act', records: [], withdraw: [OWN] })],
    })

    await $.session.start(START)
    await turn($, set, ...one('lock the retry queue with redis'))
    await turn($, set, ...one('forget the lock altogether, the queue is single-consumer now'))

    expect(set.of('amend_memory')).toEqual([{ atom_id: OWN, op: 'remove' }])
    expect(await shown($), 'what is gone can be neither fixed nor removed; it can be put back').toBe(
      carded('✓ Withdrawn · Use a Redis lock for the retry queue. [1 Put back] [9 What is this] [0 OK]'),
    )

    await turn($, set, ...one('and one more routine change to the same file here'))

    const later = set.asked[2]?.prompt ?? ''

    expect(later.slice(later.indexOf('Already recorded in this session')), 'and it is no longer listed as recorded').not.toMatch(
      'Use a Redis lock',
    )
    expect(later, 'the earlier look says it was taken back').toMatch('"withdrawn":1')
  })

  test('only a record Scribe itself wrote in this session: another session’s or another author’s is never rewritten or taken back', async ($, on) => {
    const theirs = fact(5, { content: 'Use a Redis lock for the retry queue.', anchors: { paths: [{ path: FILE }] } })
    const set = stage(on, {
      tools: { recall: () => answer({ facts: [theirs] }) },
      replies: [JSON.stringify({ outcome: 'act', records: [{ ...SECOND, updates: idOf(5) }], withdraw: [idOf(5), idOf(999)] })],
      kept: { 'scribe.known': [idOf(5)] },
    })

    await $.session.start(START)
    await turn($, set, ...one('use postgres advisory locks for the retry queue'))

    expect(set.of('amend_memory'), 'nothing of anybody else’s is touched').toEqual([])
    expect(set.of('remember').length, 'it is written as a record of its own').toBe(1)
  })

  test('a record rewritten in place replaces nobody else’s record along the way', async ($, on) => {
    const theirs = fact(5, { content: 'Use a cursor to page the audit log.', anchors: { paths: [{ path: FILE }] } })
    const set = stage(on, {
      tools: { recall: () => answer({ facts: [theirs] }) },
      replies: [verdict({ records: [FIRST] }), verdict({ records: [{ ...SECOND, updates: OWN, supersedes: idOf(5) }] })],
      kept: { 'scribe.known': [idOf(5)] },
    })

    await $.session.start(START)
    await turn($, set, ...one('lock the retry queue with redis'))
    await turn($, set, ...one('no, use postgres advisory locks'))

    expect(set.of('amend_memory').length).toBe(1)
    expect(await shown($), 'and no reversal question is put for it').toMatch('✓ Updated')
  })
})

describe('a why-question is for a reason nobody has given', () => {
  const BARE = decision({
    content: 'Use offset and limit to page the audit log.',
    detail: '',
    reason_status: 'not_stated',
    anchors: [{ path: FILE }],
  })
  const WHY = { form: 'reason', record: 0, options: ['Clients jump to a page', 'Simplest to build'] }

  test('when the reason turns up in a later turn, the question is withdrawn and the record says why', async ($, on) => {
    const reasoned = { ...BARE, detail: 'Support needs to jump straight to a page.', reason_status: 'stated', updates: OWN }
    const set = stage(on, { replies: [verdict({ records: [BARE], question: WHY }), verdict({ records: [reasoned] })] })

    await $.session.start(START)
    await turn($, set, ...one('page the audit log with offset and limit'))

    expect(await shown($)).toMatch('? Why: Use offset and limit to page the audit log.')

    await turn($, set, ...one('by the way, offset because support needs to jump straight to a page'))

    expect(set.of('amend_memory')).toMatchObject([
      {
        atom_id: OWN,
        op: 'fix',
        content: BARE.content,
        detail: 'Support needs to jump straight to a page.',
        reason_status: 'stated',
      },
    ])

    const band = await shown($)

    expect(band, 'the question is gone').not.toMatch('? Why')
    expect(band).toMatch('✓ Updated · Use offset and limit to page the audit log.')
  })

  test('what the developer has stated is kept for the session and handed to every later look', async ($, on) => {
    const stating = JSON.stringify({
      outcome: 'act',
      records: [],
      stated: ['Patient text must stay in the EU.', 'No new dependencies in the worker.'],
    })
    const set = stage(on, { replies: [stating, NOTHING, NOTHING] })

    await $.session.start(START)
    await turn($, set, ...one('patient text must stay in the EU, and no new dependencies in the worker'))
    await turn($, set, ...one('now pick a push provider for the notifications'))

    expect(set.asked[1]?.prompt).toMatch(
      'What the developer has stated so far in this session:\n- Patient text must stay in the EU.\n- No new dependencies in the worker.',
    )
    expect(JSON.stringify([...set.kept.entries()]), 'in memory only').not.toMatch('Patient text')
  })
})

describe('what a wake is sent', () => {
  test('prompts, replies and one line per tool call: no file’s contents, no tool’s output but the head of a command that failed, and only a prompt the developer sent is theirs', async ($, on) => {
    const set = stage(on, { replies: [NOTHING] })

    await $.session.start(START)
    await send($, 'make it retry')
    await finish(
      $,
      set,
      dev('<system-reminder>ENGINE-NOTE</system-reminder>make it retry'),
      claude(
        'On it.',
        use('Read', { file_path: `${ROOT}/src/a.ts` }, 'FILE-CONTENT-READ'),
        use('Write', { file_path: `${ROOT}/src/b.ts`, content: 'FILE-CONTENT-WRITTEN' }),
        use('Edit', { file_path: '/elsewhere/c.ts', old_string: 'OLD-TEXT', new_string: 'NEW-TEXT' }),
        use('Bash', { command: 'npm test' }, `3 passed${' and more'.repeat(60)}`),
        use('Bash', { command: 'npm run lint' }, 'boom', true),
        use('Grep', { pattern: 'retry' }, 'src/a.ts:1: MATCHED-LINE'),
        use('mcp__fylgja__recall', { query: 'QUERY-TEXT' }, 'RECALL-OUTPUT'),
      ),
      dev('<task-notification><summary>Agent "tests" finished</summary><result>NOTICE-BODY</result></task-notification>'),
      dev('This session is being continued from a previous conversation. SUMMARY-BODY'),
      dev('Base directory for this skill: /x\n\nSKILL-BODY'),
      dev('HOOK-INJECTED no particular reason'),
      dev(''),
      claude('Retries three times now.'),
    )

    expect(sessionOf(set.asked[0]?.prompt)).toEqual([
      '[developer] make it retry',
      '[claude] On it.',
      '[tool] Read src/a.ts ok',
      '[tool] Write src/b.ts ok',
      '[tool] Edit /elsewhere/c.ts (outside the working tree) ok',
      '[tool] Bash `npm test` ok',
      '[tool] Bash `npm run lint` failed: boom',
      '[tool] Grep retry ok',
      '[tool] mcp__fylgja__recall ok',
      '[notice] a background task reported back',
      '[claude] Retries three times now.',
    ])
  })

  test('a turn too long to hand over loses Claude’s oldest replies and says how many; what the developer wrote is never what goes', async ($, on) => {
    const set = stage(on, { replies: [NOTHING] })

    await $.session.start(START)
    await turn($, set, dev('OLDEST'), ...Array.from({ length: 40 }, (_, n) => claude(`REPLY-${n} ${'word '.repeat(200)}`)))

    const prompt = set.asked[0]?.prompt ?? ''
    const lines = sessionOf(prompt)
    const left = Number(/\((\d+) earlier lines of this turn were left out for length\)/.exec(prompt)?.[1])

    expect(lines[0]).toMatch('left out for length')
    expect(lines[1]).toBe('[developer] OLDEST')
    expect(lines.at(-1)).toMatch('REPLY-39')
    expect(prompt).not.toMatch('REPLY-0 ')
    expect(left + lines.length - 1, 'every line is either sent or counted as left out').toBe(41)
  })

  test('tool lines go before anything that was said: a turn of many tool calls keeps the developer’s words and Claude’s replies', async ($, on) => {
    const set = stage(on, { replies: [NOTHING] })
    const noise = Array.from({ length: 400 }, (_, n) => use('Bash', { command: `echo step-${n} ${'x'.repeat(60)}` }))

    await $.session.start(START)
    await turn(
      $,
      set,
      dev('FIRST-PROMPT pick the lock'),
      claude('PLAN-REPLY', ...noise),
      claude('FINAL-REPLY', edit('src/a.ts')),
    )

    const prompt = set.asked[0]?.prompt ?? ''

    for (const said of ['[developer] FIRST-PROMPT pick the lock', '[claude] PLAN-REPLY', '[claude] FINAL-REPLY']) {
      expect(prompt, said).toMatch(said)
    }

    expect(prompt, 'the oldest tool lines went').not.toMatch('step-0 ')
    expect(prompt, 'the newest stayed').toMatch('step-399 ')
    expect(Number(/\((\d+) earlier lines/.exec(prompt)?.[1])).toBeGreaterThan(100)
  })

  test('files read one after the other are one line, and Claude’s own bookkeeping is left out', async ($, on) => {
    const set = stage(on)

    await $.session.start(START)
    await turn(
      $,
      set,
      dev('look at the queue and then change the lock'),
      claude(
        'Reading.',
        use('Read', { file_path: '/work/repo/src/a.ts' }),
        use('Read', { file_path: '/work/repo/src/b.ts' }),
        use('TodoWrite', { todos: [] }),
        use('Read', { file_path: '/work/repo/src/c.ts' }),
        use('Bash', { command: 'npm test' }, 'PASSED-OUTPUT 41 passed'),
      ),
      claude('Done.', edit(FILE)),
    )

    const prompt = set.asked[0]?.prompt ?? ''

    expect(prompt).toMatch('[tool] Read src/a.ts, src/b.ts, src/c.ts ok')
    expect(prompt).not.toMatch('TodoWrite')
    expect(prompt, 'what a command that worked printed is not sent').not.toMatch('PASSED-OUTPUT')
  })

  test('a plan document nobody has read or changed for five wakes is sent as its headings alone, and whole again once it is touched', async ($, on) => {
    const set = stage(on)
    const plan = '/work/repo/docs/plan-queue.md'
    const text = '# Plan: queue\n\n## Locking\n\nPLAN-BODY-TEXT use an advisory lock.\n'

    await $.session.start(START)
    await turn($, set, dev('write the plan down'), claude('Written.', use('Write', { file_path: plan, content: text })))

    for (let n = 1; n <= 6; n += 1) {
      await turn($, set, dev(`STEP-${n} change the lock once more please`), claude('Done.', edit(FILE)))
      await set.clock.advance(60_000)
    }

    expect(set.asked[1]?.prompt, 'whole while the session works with it').toMatch('PLAN-BODY-TEXT')

    const stale = set.asked.at(-1)?.prompt ?? ''

    expect(stale).toMatch('not read or changed lately, so only its headings are shown')
    expect(stale).toMatch('Locking')
    expect(stale).not.toMatch('PLAN-BODY-TEXT')

    await turn($, set, dev('read the plan again'), claude('Read.', use('Read', { file_path: plan }, text), edit(FILE)))
    await turn($, set, dev('and go on with the lock as planned'), claude('Done.', edit(FILE)))

    expect(set.asked.at(-1)?.prompt).toMatch('PLAN-BODY-TEXT')
  })
})
