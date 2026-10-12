import { describe, expect, test } from 'claude-code/testing'

import { answer, idOf } from './fixtures'
import {
  band,
  claude,
  decision,
  dev,
  edit,
  fact,
  NOTHING,
  press,
  pressTwice,
  QUIET,
  shown,
  stage,
  START,
  turn,
  verdict,
} from './scribe-fixtures'

const TALK = [dev('Use Postgres for the queue lock.'), claude('Done.', edit('src/queue/lock.ts'))]

const UNEXPLAINED = decision({ detail: '', reason_status: 'not_stated' })
const WHY = { form: 'reason', record: 0, options: ['One less service to run', 'Redis was flaky in CI'] }
const ASKING = verdict({ records: [UNEXPLAINED], question: WHY })

const QUESTION =
  '? Why: Use Postgres advisory locks for the job queue, not Redis. [1 One less service to run] [2 Redis was flaky in CI] [3 Other] [4 No particular reason] [9 What is this] [0 Skip]'

const PRIOR = fact(5, { content: 'Use Redis with Redlock for the job queue.', anchors: [{ path: 'src/queue/lock.ts' }] })
const REVERSAL = { form: 'reversal', record: 0, prior: idOf(5), options: ['One less service to run'] }

/** A stage where the lookup by path finds an older decision the new one goes against. */
function reversing(on: Parameters<typeof stage>[0], record: Record<string, unknown> = decision()) {
  return stage(on, {
    replies: [verdict({ records: [record], question: REVERSAL }), NOTHING],
    tools: { recall: () => answer({ facts: [PRIOR] }) },
    // The developer has said they know the older record, so it is not also told.
    kept: { 'scribe.known': [idOf(5)] },
  })
}

describe('Scribe asks why', () => {
  test('a decision with no reason is written as such, and the question comes once the turn is over', async ($, on) => {
    const set = stage(on, { replies: [ASKING] })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember')[0]).toMatchObject({ reason_status: 'not_stated', kind: 'decision' })
    expect(set.of('remember')[0]?.detail).toBeUndefined()
    expect(await shown($, true), 'while Claude works, only the receipt').toMatch('✓ Recorded')
    expect(await shown($)).toBe(QUESTION)
  })

  test('picking a proposed reason saves it as the stated reason', async ($, on) => {
    const set = stage(on, { replies: [ASKING] })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await pressTwice($, 'reason:1')

    expect(set.of('amend_memory')).toEqual([
      { atom_id: idOf(101), op: 'fix', detail: 'Redis was flaky in CI', reason_status: 'stated' },
    ])
    expect(await shown($)).toBe(
      '✓ Reason saved · Use Postgres advisory locks for the job queue, not Redis. [1 Fix] [2 Remove] [0 OK]',
    )
  })

  test('Skip saves nothing: the record stays without a reason', async ($, on) => {
    const set = stage(on, { replies: [ASKING] })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await press($, 'skip')

    expect(set.of('amend_memory')).toEqual([])
    expect(await shown($)).not.toMatch('Why')
  })

  test('“No particular reason” is an answer, and is saved as one', async ($, on) => {
    const set = stage(on, { replies: [ASKING] })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await pressTwice($, 'no-reason')

    expect(set.of('amend_memory')).toEqual([{ atom_id: idOf(101), op: 'fix', reason_status: 'no_strong_reason' }])
  })

  for (const [typed, status] of [
    ['idk', 'no_strong_reason'],
    ['no idea, it just worked', 'no_strong_reason'],
    ['Honestly don’t know', 'no_strong_reason'],
    ['Redis kept dropping connections under load', 'stated'],
  ] as const) {
    test(`a typed answer “${typed}” is saved in those words as ${status}`, async ($, on) => {
      const set = stage(on, { replies: [ASKING] })

      await $.session.start(START)
      await turn($, set, ...TALK)

      const ui = await band($)

      await ui.press('other')
      await ui.redraw()

      expect(await ui.text()).toBe(' [Why]<> [0 Cancel]')

      await ui.enter('reason-text', typed)

      expect(set.of('amend_memory')).toEqual([{ atom_id: idOf(101), op: 'fix', detail: typed, reason_status: status }])
    })
  }

  test('a question the model asks about a gotcha, a correction or a decision with its reason is never shown', async ($, on) => {
    const gotcha = { kind: 'gotcha', content: 'Run the seed before the tests.', detail: '', triggers: ['pytest'], anchors: [] }
    const correction = { kind: 'correction', content: 'The staging host is stage-2, not stage-1.', detail: '', anchors: [] }
    const set = stage(on, {
      replies: [
        verdict({ records: [gotcha], question: WHY }),
        verdict({ records: [correction], question: WHY }),
        verdict({ records: [decision({ content: 'Use B over A.' })], question: WHY }),
      ],
    })

    await $.session.start(START)

    for (let at = 0; at < 3; at += 1) {
      await turn($, set, ...TALK)

      expect(await shown($), `turn ${at}`).not.toMatch('Why')
      await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })
    }

    expect(set.of('remember').length).toBe(3)
  })

  test('the same decision is never asked about twice', async ($, on) => {
    const set = stage(on, { replies: [ASKING, ASKING] })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(await shown($)).toBe(QUESTION)

    await press($, 'skip')
    await turn($, set, ...TALK)

    expect(set.asked.length).toBe(2)
    expect(await shown($)).not.toMatch('Why')
  })

  test('a question comes before a tell that is waiting untouched, and the tell comes back after it', async ($, on) => {
    const set = stage(on, {
      replies: [ASKING],
      tools: { recall: () => answer({ facts: [fact(7, { anchors: [{ path: 'src/queue/lock.ts' }] })] }) },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(await shown($)).toMatch('? Why: Use Postgres advisory locks')

    await press($, 'skip')

    expect(await shown($)).toMatch('◆ Decision · Use the queue for outbound mail')
  })

  test('two questions left unanswered end the asking for the session', async ($, on) => {
    const ask = (n: number) =>
      verdict({ records: [decision({ content: `Use option ${n}.`, detail: '', reason_status: 'not_stated' })], question: WHY })
    const set = stage(on, { replies: [ask(1), ask(2), ask(3)] })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await press($, 'skip')
    await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })
    await turn($, set, ...TALK)

    expect(await shown($)).toMatch('? Why: Use option 2.')

    // Typed past, untouched.
    await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })
    await turn($, set, ...TALK)

    expect(set.of('remember').length, 'still recorded').toBe(3)
    expect(await shown($)).not.toMatch('Why')
  })

  test('no session is asked more than four questions', async ($, on) => {
    const ask = (n: number) =>
      verdict({ records: [decision({ content: `Use option ${n}.`, detail: '', reason_status: 'not_stated' })], question: WHY })
    const set = stage(on, { replies: [ask(1), ask(2), ask(3), ask(4), ask(5)] })

    await $.session.start(START)

    const seen: boolean[] = []

    for (let at = 0; at < 5; at += 1) {
      await turn($, set, ...TALK)
      seen.push((await shown($)).includes('? Why'))

      if (seen.at(-1) === true) {
        await pressTwice($, 'reason:0')
      }

      await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })
    }

    expect(seen).toEqual([true, true, true, true, false])
  })
})

describe('Scribe asks whether a decision replaces a recorded one', () => {
  test('the new decision waits for the answer, and both are shown', async ($, on) => {
    const set = reversing(on)

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember'), 'not written before the answer').toEqual([])
    expect(await shown($)).toBe(
      '? This looks like it replaces a recorded decision.Now: Use Postgres advisory locks for the job queue, not Redis.Recorded: Use Redis with Redlock for the job queue. · 2026-09-12 [1 Yes, it replaces it] [2 No, tell Claude] [3 Different case] [9 What is this] [0 Skip]',
    )
  })

  test('“Yes, it replaces it” writes it as the replacement', async ($, on) => {
    const set = reversing(on)

    await $.session.start(START)
    await turn($, set, ...TALK)
    await pressTwice($, 'replaces')

    expect(set.of('remember')).toMatchObject([{ supersedes: idOf(5), reason_status: 'stated' }])
    expect(await shown($)).toMatch('· replaces: Use Redis with Redlock for the job queue.')
  })

  test('“Yes, it replaces it” with no reason given asks for the reason next, with the same choices', async ($, on) => {
    const set = reversing(on, decision({ detail: '', reason_status: 'not_stated' }))

    await $.session.start(START)
    await turn($, set, ...TALK)
    await pressTwice($, 'replaces')

    expect(set.of('remember')).toMatchObject([{ supersedes: idOf(5), reason_status: 'not_stated' }])
    expect(await shown($)).toBe(
      '? Why: Use Postgres advisory locks for the job queue, not Redis. [1 One less service to run] [2 Other] [3 No particular reason] [0 Skip]',
    )

    await pressTwice($, 'no-reason')

    expect(set.of('amend_memory')).toEqual([{ atom_id: idOf(101), op: 'fix', reason_status: 'no_strong_reason' }])
  })

  test('“No, tell Claude” puts a note with the recorded decision in the prompt box and writes nothing', async ($, on) => {
    const set = reversing(on)

    await $.session.start(START)
    await turn($, set, ...TALK)
    await press($, 'tell-claude')

    expect(set.of('remember')).toEqual([])
    expect(set.fills.length).toBe(1)
    expect(set.fills[0]).toMatch('> Decision: Use Redis with Redlock for the job queue.')
    expect(set.fills[0]).toMatch('> Fylgja record 00000000, written down by Scribe')
    expect(set.fills[0]).not.toMatch('https://')
    expect(await shown($)).toBe(QUIET)
  })

  for (const key of ['different', 'skip']) {
    test(`“${key}” writes the new decision beside the old one`, async ($, on) => {
      const set = reversing(on)

      await $.session.start(START)
      await turn($, set, ...TALK)
      await press($, key)

      expect(set.of('remember').length).toBe(1)
      expect(set.of('remember')[0]?.supersedes).toBeUndefined()
      expect(set.of('remember')[0]?.reason_status).toBe('stated')
    })
  }

  test('typed past, the new decision is still written, beside the old one, at the next turn', async ($, on) => {
    const set = reversing(on)

    await $.session.start(START)
    await turn($, set, ...TALK)
    await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })

    expect(set.of('remember'), 'nothing is waited for when a prompt is sent').toEqual([])

    await turn($, set, dev('go on'), claude('Going on.'))

    expect(set.of('remember').length).toBe(1)
    expect(set.of('remember')[0]?.supersedes).toBeUndefined()
  })

  test('a record the model itself marks as a replacement is asked about all the same: nothing is replaced without the key', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [decision({ supersedes: idOf(5) })] }), NOTHING],
      tools: { recall: () => answer({ facts: [PRIOR] }) },
      kept: { 'scribe.known': [idOf(5)] },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember')).toEqual([])
    expect(await shown($)).toMatch('? This looks like it replaces a recorded decision.')

    await pressTwice($, 'replaces')

    expect(set.of('remember')).toMatchObject([{ supersedes: idOf(5) }])
    expect(await shown($)).toBe(
      '✓ Recorded · Use Postgres advisory locks for the job queue, not Redis. · replaces: Use Redis with Redlock for the job queue. [1 Fix] [2 Remove] [0 OK]',
    )
  })

  test('where the question cannot be asked, the decision is written beside the old one, never as its replacement', async ($, on) => {
    const unexplained = (n: number) =>
      verdict({ records: [decision({ content: `Use option ${n}.`, detail: '', reason_status: 'not_stated' })], question: WHY })
    const set = stage(on, {
      replies: [unexplained(1), unexplained(2), verdict({ records: [decision({ content: 'Use B.', supersedes: idOf(5) })] })],
      tools: { recall: () => answer({ facts: [PRIOR] }) },
      kept: { 'scribe.known': [idOf(5)] },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await press($, 'skip')
    await turn($, set, ...TALK)
    await press($, 'skip')
    // Two questions went unanswered in this session; a third is not asked.
    await turn($, set, ...TALK)

    expect(await shown($)).not.toMatch('replaces')
    expect(set.of('remember').map(args => [args.content, args.supersedes])).toEqual([
      ['Use option 1.', undefined],
      ['Use option 2.', undefined],
      ['Use B.', undefined],
    ])
  })
})
