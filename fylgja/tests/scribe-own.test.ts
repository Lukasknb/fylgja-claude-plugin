import { describe, expect, test } from 'claude-code/testing'

import { SYSTEM } from '../hooks/scribe/prompt'
import { ACCOUNT_OPENERS, CONDITIONAL_OPENERS, DECISION_RULE, SHAPE_LIMITS, VERB_OPENERS } from '../hooks/scribe/shape'
import { answer, idOf } from './fixtures'
import {
  carded,
  claude,
  decision,
  dev,
  edit,
  fact,
  NOTHING,
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
    expect(SYSTEM, 'and the instruction says to look there before asking').toMatch(
      'in the list of what the developer has stated so far',
    )
  })
})

describe('the shape the server takes is in the instruction', () => {
  test('the server’s own opener lists, its lengths and the statement shape are stated once', () => {
    expect(VERB_OPENERS.length).toBeGreaterThan(150)
    expect(SYSTEM).toMatch(`with one of these words: ${CONDITIONAL_OPENERS.join(', ')};`)
    expect(SYSTEM).toMatch(` ${VERB_OPENERS.slice(0, 6).join(' ')} `)
    expect(SYSTEM).toMatch(' page ')
    expect(SYSTEM).toMatch(`ONE sentence of at most ${SHAPE_LIMITS.content} characters`)
    expect(SYSTEM, 'a correction may be a statement with one of the server’s statement words').toMatch(
      'holds one of the words "is", "are", "must", "stays", "becomes"',
    )
    expect(SYSTEM, 'a decision is said in whatever words say what holds, by the server’s own rule').toMatch(DECISION_RULE)
    expect(SYSTEM, 'and names what the server refuses as an account').toMatch(ACCOUNT_OPENERS.join(', '))
    expect(SYSTEM).toMatch('do not put "Always" before it')
    expect(SYSTEM).toMatch('"open PR"')
  })

  test('a record names a thing by what it is, in its sentence, its reason and its alternatives, and that is said once', () => {
    expect(SYSTEM.split('are read by someone who never saw this session').length).toBe(2)
    expect(SYSTEM).toMatch('"content", "detail" and every entry of "alternatives" are read by someone who never saw')
    expect(SYSTEM).toMatch('Name a thing by what it is, never by a label the session gave it')

    for (const label of ['"P2"', '"option B"', '"phase 2"', '"this PR"', '"as discussed"', '"the above"']) {
      expect(SYSTEM, label).toMatch(label)
    }

    expect(SYSTEM).toMatch('not by its letter or its number')
    expect(SYSTEM).toMatch('A name that exists outside the session stays as it is')
    expect(SYSTEM).toMatch('When you cannot say what a label stands for, there is no record.')
  })
})

describe('what a wake is sent', () => {
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

  test('an earlier wake is sent again as what was said, without its tool calls, and no more than four of them', async ($, on) => {
    const set = stage(on)

    await $.session.start(START)

    for (let n = 1; n <= 7; n += 1) {
      await turn(
        $,
        set,
        dev(`STEP-${n} change the lock once more please`),
        claude(`REPLY-${n}`, use('Bash', { command: `echo PAST-COMMAND-${n}` }), edit(FILE)),
      )
      await set.clock.advance(60_000)
    }

    const last = set.asked.at(-1)?.prompt ?? ''
    const earlier = last.slice(0, last.indexOf("The session's repository:"))

    expect(earlier.match(/Earlier wake \d+:/g)?.length).toBeLessThanOrEqual(4)
    expect(earlier).toMatch('[claude] REPLY-6')
    expect(earlier, 'the developer’s words stay').toMatch('[developer] STEP-6')
    expect(earlier).not.toMatch('PAST-COMMAND')
    expect(earlier).toMatch('Before the wakes below you looked')
  })
})
