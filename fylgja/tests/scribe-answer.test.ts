import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { LINE_WAIT_MS } from '../hooks/live'
import { INSIDE_WAIT_MS, MAX_WAKES_PER_HOUR, OFF_STATUS, QUIET_TURN_CHARS } from '../hooks/scribe/scribe'
import { answer, idOf, NEEDS_SIGN_IN } from './fixtures'
import {
  carded,
  claude,
  decision,
  dev,
  edit,
  finish,
  NOTHING,
  press,
  QUIET,
  send,
  shown,
  stage,
  START,
  step,
  stepping,
  turn,
  typing,
  use,
  verdict,
} from './scribe-fixtures'
import type { Stage } from './scribe-fixtures'

const FILE = 'src/queue/lock.ts'
const QUESTION = 'Which lock?'
const INPUT = {
  questions: [
    {
      question: QUESTION,
      options: [
        { label: 'Postgres', description: 'One less service to run.' },
        { label: 'Redis', description: 'Already used for the cache.' },
      ],
    },
  ],
}
const ASKED = { name: 'AskUserQuestion', input: INPUT }
const CHOSE = `[developer chose] Question: ${QUESTION}`

// What the call's row holds: nothing while the question is up, and then what it came to.
const OUT = { tool: 'AskUserQuestion', input: INPUT }
const ANSWERED = use('AskUserQuestion', INPUT, `User has answered your questions: "${QUESTION}"="Postgres". You can now continue.`)
const TURNED_DOWN = {
  ...use(
    'AskUserQuestion',
    INPUT,
    "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file).",
    true,
  ),
  result: 'User rejected tool use',
}
const FAILED = use('AskUserQuestion', INPUT, 'Error: the question could not be shown', true)
const UNANSWERED = use('AskUserQuestion', INPUT, 'User has answered your questions: . You can now continue.')

// A second question, for a turn that asks another.
const AGAIN = {
  questions: [{ question: 'Retry a failed job?', options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }] }],
}
const ANSWERED_AGAIN = use('AskUserQuestion', AGAIN, 'User has answered your questions: "Retry a failed job?"="Yes". You can now continue.')

const RECORD = verdict({ records: [decision()] })
const NOTICE = { role: 'user' as const, text: '<task-notification>the checks are done</task-notification>', toolUses: [] }
const LATER = 'The queue takes its lock from Postgres now.'

// A decision that came with no reason, and the question about it.
const WHY = { form: 'reason', record: 0, options: ['One less service to run', 'Redis was flaky in CI'] }
const UNEXPLAINED = verdict({ records: [decision({ detail: '', reason_status: 'not_stated' })], question: WHY })
const WHY_CARD = carded(
  '? Why: Use Postgres advisory locks for the job queue, not Redis. [1 One less service to run] [2 Redis was flaky in CI] [3 Other] [4 No particular reason] [9 What is this] [0 Skip]',
)
// Another, as a later look might come to.
const UNEXPLAINED_TOO = verdict({
  records: [
    decision({
      content: 'Retry a failed job three times, then park it.',
      detail: '',
      reason_status: 'not_stated',
      alternatives: ['retry for ever'],
    }),
  ],
  question: { form: 'reason', record: 0, options: ['Parked jobs are looked at by hand'] },
})

/** Fylgja taking `ms` of the test's clock to write a record down. */
const writesIn =
  (ms: number) =>
  async (_args: Record<string, unknown>, clock: Stage['clock']): Promise<unknown> => {
    await clock.sleep(ms)

    return answer({ atom_id: idOf(101), outcome: 'created', supersede: 'not_requested' })
  }

/** A model that takes `ms` of the test's clock over its answer. */
const slowly =
  (ms: number, reply: string) =>
  async (_asked: unknown, clock: Stage['clock']): Promise<string> => {
    await clock.sleep(ms)

    return reply
  }

/** What a look was told is new, apart from what it is reminded of. */
function fresh(set: Stage, at: number): string {
  const prompt = set.asked[at]?.prompt ?? ''

  return prompt.slice(prompt.indexOf('What happened since you last looked:'), prompt.indexOf('Records anchored to the files'))
}

/**
 * A turn as far as Claude's question: the developer's prompt when there is
 * one, some work, and a step that ends with the question put to them.
 */
async function asking($: Engine, on: On, set: Stage, prompt: string | null = 'Set up the job queue.'): Promise<void> {
  if (prompt !== null) {
    await send($, prompt)
    set.rows.push(dev(prompt))
  }

  set.rows.push(claude('One thing first.', OUT))
  stepping(on, () => [ASKED])
  await step($, 0, [])
  stepping(on, () => [])
}

/** What the question came to is in its row now, as it is when the step after it begins. */
function came(set: Stage, outcome: (typeof set.rows)[number]['toolUses'][number]): void {
  set.rows[set.rows.length - 1] = claude('One thing first.', outcome)
}

/** A step of the turn that takes `ms`, from its beginning to its end, with the test's clock moved that far. */
async function works($: Engine, on: On, set: Stage, index: number, ms: number): Promise<void> {
  stepping(on, () => [], ms)

  const working = step($, index, [])

  await set.clock.advance(ms)
  await working
  stepping(on, () => [])
}

describe('an answer the developer gives to a question of Claude’s is looked at right then', () => {
  test('the step after the answer begins a look, beside the step: the record is written while Claude still works', async ($, on) => {
    const set = stage(on, { replies: [RECORD, NOTHING] })
    let isOver = false

    await $.session.start(START)
    await asking($, on, set)

    expect(set.asked, 'a question that is still up is nothing to look at').toEqual([])

    came(set, ANSWERED)
    stepping(on, () => [], 60_000)

    const working = step($, 1, []).then(() => {
      isOver = true
    })

    await set.clock.advance(1000)

    expect(isOver, 'Claude is still on the step').toBe(false)
    expect(set.asked.length).toBe(1)
    expect(fresh(set, 0)).toMatch(CHOSE)
    expect(set.of('remember').length, 'and the decision is on record already').toBe(1)
    expect(await shown($, true)).toMatch('✓ Recorded')

    await set.clock.advance(60_000)
    await working
    stepping(on, () => [])
    await step($, 2, [])

    expect(set.asked.length, 'the steps that follow have no new answer, and look at nothing').toBe(1)

    await finish($, set, claude('The queue takes its lock from Postgres now.', edit(FILE)))

    expect(set.asked.length, 'the turn’s end looks at what came after').toBe(2)
    expect(fresh(set, 1)).toMatch('The queue takes its lock from Postgres now.')
    expect(fresh(set, 1), 'and not again at what the look inside the turn went through').not.toMatch(CHOSE)
    expect(fresh(set, 1)).not.toMatch('Set up the job queue.')
  })

  for (const [what, outcome] of [
    ['turned down', TURNED_DOWN],
    ['that failed', FAILED],
    ['that got no answer', UNANSWERED],
  ] as const) {
    test(`a question ${what} begins no look`, async ($, on) => {
      const set = stage(on, { replies: [NOTHING] })

      await $.session.start(START)
      await asking($, on, set)
      came(set, outcome)
      stepping(on, () => [], 5000)

      const working = step($, 1, [])

      await set.clock.advance(5000)
      await working

      expect(set.asked, 'nothing was answered').toEqual([])

      await finish($, set, claude('Then I will go on as planned.', edit(FILE)))

      expect(set.asked.length, 'the turn’s end looks as it always does').toBe(1)
    })
  }

  test('the step is not held by the look, and a call the look makes later is made by the step under way then', async ($, on) => {
    const set = stage(on, { replies: [slowly(10_000, RECORD), NOTHING] })

    await $.session.start(START)
    await asking($, on, set)
    came(set, ANSWERED)
    await works($, on, set, 1, 2000)

    expect(set.asked.length, 'the step is over and the look is still under way').toBe(1)
    expect(set.of('remember')).toEqual([])

    await set.clock.advance(7000)
    stepping(on, () => [], 5000)

    const next = step($, 2, [])

    await set.clock.advance(2000)

    expect(set.of('remember').length, 'the verdict came during the next step, which made the call').toBe(1)
    expect(await shown($, true)).toMatch('✓ Recorded')

    await set.clock.advance(3000)
    await next
  })

  test('a call no hook starts in time is given up, never made late, and the look leaves its rows for the turn’s end', async ($, on) => {
    const set = stage(on, { replies: [slowly(10_000, RECORD), RECORD] })

    await $.session.start(START)
    await asking($, on, set)
    came(set, ANSWERED)
    await works($, on, set, 1, 2000)
    // The verdict comes while a tool runs: no hook is being waited on.
    await set.clock.advance(8000)

    expect(set.of('remember')).toEqual([])

    // Each call the look still has to make waits its short while, and is given up.
    await set.clock.advance(60_000)
    await works($, on, set, 2, 1000)

    expect(set.of('remember'), 'a step that begins after they were given up does not make them').toEqual([])
    expect(set.statuses, 'and Scribe is not off').not.toContain(OFF_STATUS)

    await finish($, set, claude(LATER, edit(FILE)))

    expect(set.asked.length).toBe(2)
    expect(fresh(set, 1), 'the answer is among the rows the turn’s end looks at').toMatch(CHOSE)
    expect(fresh(set, 1)).toMatch(LATER)
    expect(set.of('remember').length, 'and the decision is written then, once').toBe(1)
  })

  test('a call of a look inside a turn that is not let through leaves Scribe on, and the rows for the turn’s end', async ($, on) => {
    const refused: Record<string, string> = {
      remember: 'fylgja: $.mcp.call(plugin:fylgja:fylgja, remember) refused: no hook is waiting on this call',
    }
    const set = stage(on, { replies: [RECORD, RECORD], refused })

    await $.session.start(START)
    await asking($, on, set)
    came(set, ANSWERED)
    await works($, on, set, 1, 5000)

    expect(set.asked.length).toBe(1)
    expect(set.of('remember').length, 'the call was made, and refused').toBe(1)
    expect(set.statuses).not.toContain(OFF_STATUS)
    expect(await shown($, true), 'nothing was written').toBe(QUIET)

    delete refused.remember
    await finish($, set, claude(LATER, edit(FILE)))

    expect(set.asked.length, 'Scribe still looks').toBe(2)
    expect(fresh(set, 1), 'at the answer too').toMatch(CHOSE)
    expect(set.of('remember').length).toBe(2)
    expect(await shown($)).toMatch('✓ Recorded')
  })

  test('a turn that ends while a look inside it is still thinking stops that look and reads its rows itself, once', async ($, on) => {
    let release = (): void => undefined
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    const set = stage(on, {
      replies: [
        async () => {
          await held

          return RECORD
        },
        RECORD,
        NOTHING,
      ],
    })

    await $.session.start(START)
    await asking($, on, set)
    came(set, ANSWERED)
    await works($, on, set, 1, 2000)

    expect(set.asked.length, 'the look inside the turn is under way').toBe(1)

    // No time passes on the test's clock: the turn's end does not wait for the look inside it.
    await finish($, set, claude(LATER, edit(FILE)))

    expect(set.asked.length, 'the turn’s end looked').toBe(2)
    expect(fresh(set, 1), 'at the answer, which the stopped look left unread').toMatch(CHOSE)
    expect(fresh(set, 1), 'and at what came after').toMatch(LATER)
    expect(set.of('remember').length).toBe(1)

    release()
    await set.clock.settle()

    expect(set.of('remember').length, 'what the stopped look’s model answers in the end is let go').toBe(1)

    await turn($, set, dev('And now the retries, with a backoff that grows.'), claude('Done.', edit(FILE)))

    expect(set.asked.length).toBe(3)
    expect(fresh(set, 2), 'no row is looked at twice').not.toMatch(CHOSE)
    expect(fresh(set, 2)).not.toMatch(LATER)
  })

  test('a look that is writing its verdict down when the turn ends is not undone: its rows are not read again', async ($, on) => {
    const set = stage(on, { replies: [slowly(1500, RECORD), NOTHING], tools: { remember: writesIn(1000) } })

    await $.session.start(START)
    await asking($, on, set)
    came(set, ANSWERED)
    await works($, on, set, 1, 2000)

    expect(set.of('remember').length, 'the write is on its way as the step ends').toBe(1)

    // The turn ends with the write half done, which then takes the rest of its second.
    const ending = finish($, set, claude(LATER, edit(FILE)))

    await set.clock.advance(1000)
    await ending

    expect(set.asked.length).toBe(2)
    expect(fresh(set, 1), 'the turn’s end reads what came after').toMatch(LATER)
    expect(fresh(set, 1), 'and not the answer again').not.toMatch(CHOSE)
    expect(fresh(set, 1)).not.toMatch('Set up the job queue.')
    expect(set.of('remember').length, 'so the decision is written once').toBe(1)
  })

  test('a commit among the rows of a look that the turn’s end stopped while it wrote is attached by the turn’s end', async ($, on) => {
    const set = stage(on, { replies: [slowly(1500, RECORD), NOTHING], tools: { remember: writesIn(1000) } })

    await $.session.start(START)
    await send($, 'Set up the job queue.')
    set.rows.push(
      dev('Set up the job queue.'),
      claude('Committed.', edit(FILE), use('Bash', { command: 'git commit -am "queue lock"' }, '[main 1a2b3c4] queue lock\n 1 file changed')),
    )
    await asking($, on, set, null)
    came(set, ANSWERED)
    await works($, on, set, 1, 2000)

    const ending = finish($, set, claude('Anything else?'))

    await set.clock.advance(1000)
    await ending

    expect(set.of('remember').length).toBe(1)
    expect(set.of('attach_commit'), 'once, by the look that came next').toEqual([
      { repo: 'acme/web', sha: '1a2b3c4', session_id: 'c0ffee00-0000-4000-8000-000000000001' },
    ])
  })

  test('a look still writing after the turn’s end has waited its moment keeps the turn’s end from looking; the rest is read when the next turn ends', async ($, on) => {
    const set = stage(on, { replies: [slowly(1500, RECORD), NOTHING], tools: { remember: writesIn(INSIDE_WAIT_MS + 3000) } })

    await $.session.start(START)
    await asking($, on, set)
    came(set, ANSWERED)
    await works($, on, set, 1, 2000)

    const ending = finish($, set, claude(LATER, edit(FILE)))

    await set.clock.advance(INSIDE_WAIT_MS)
    await ending

    expect(set.asked.length, 'no second look beside the one that is writing').toBe(1)

    await set.clock.advance(3000)

    expect(await shown($)).toMatch('✓ Recorded')

    // A turn nobody prompted, with nothing much in it.
    await finish($, set, NOTICE, claude('Noted.'))

    expect(set.asked.length, 'the rows left over are looked at now').toBe(2)
    expect(fresh(set, 1)).toMatch(LATER)
    expect(fresh(set, 1)).not.toMatch(CHOSE)
    expect(set.of('remember').length).toBe(1)
  })

  test('a look stopped while it waits for the session’s first answer from Fylgja ends at once, and the turn’s end looks', async ($, on) => {
    let asks = 0
    const set = stage(on, {
      replies: [RECORD],
      tools: {
        // Slow to answer the look inside the turn, and then the turn's end, once each.
        recall: async (_args, clock) => {
          asks += 1

          if (asks <= 2) {
            await clock.sleep(5000)
          }

          return answer({ repo: 'acme/web', facts: [] })
        },
      },
    })

    await $.session.start(START)
    await asking($, on, set)
    came(set, ANSWERED)
    await works($, on, set, 1, 1000)

    expect(set.asked, 'the look inside the turn is waiting for Fylgja').toEqual([])

    const ending = finish($, set, claude(LATER, edit(FILE)))

    // The turn's end asks Fylgja itself, and that call is its own to wait for.
    await set.clock.advance(5000)
    await ending

    expect(set.asked.length, 'the turn’s end looked').toBe(1)
    expect(fresh(set, 0)).toMatch(CHOSE)
    expect(fresh(set, 0)).toMatch(LATER)
    expect(set.of('remember').length).toBe(1)
  })

  test('a call that fails for a step’s own lookup while a look writes is not held against the look', async ($, on) => {
    let isDown = false
    const set = stage(on, {
      replies: [NOTHING, slowly(500, RECORD), NOTHING],
      tools: {
        remember: writesIn(3000),
        recall: () => {
          if (isDown) {
            throw new Error('down')
          }

          return answer({ repo: 'acme/web', facts: [] })
        },
      },
    })

    await $.session.start(START)
    await turn($, set, dev('Look at the queue with me.'), claude('It has no lock yet.', edit(FILE)))
    await asking($, on, set)
    came(set, ANSWERED)
    // Every fourth step looks up the files it names, at its end.
    stepping(on, () => [{ name: 'Read', input: { file_path: '/work/repo/src/queue/retry.ts' } }], 1000)

    const working = step($, 3, [])

    await set.clock.advance(600)
    isDown = true
    await set.clock.advance(400)
    await working

    expect(set.of('recall').length, 'the step’s lookup was made, and failed').toBeGreaterThan(2)

    isDown = false
    await set.clock.advance(3000)
    stepping(on, () => [])
    await finish($, set, claude(LATER, edit(FILE)))

    expect(set.asked.length).toBe(3)
    expect(fresh(set, 2), 'the look went all the way: its rows are not read again').not.toMatch(CHOSE)
    expect(set.of('remember').length).toBe(1)
  })

  test('a question asked at the end of the turn before does not count as this turn’s: its end may ask', async ($, on) => {
    const set = stage(on, { replies: [UNEXPLAINED, NOTHING, UNEXPLAINED_TOO] })

    await $.session.start(START)
    await turn($, set, dev('Use Postgres for the queue lock.'), claude('Done.', edit(FILE)))

    expect(await shown($)).toBe(WHY_CARD)

    await press($, 'skip')
    await asking($, on, set, 'And the retries?')
    came(set, ANSWERED)
    await works($, on, set, 1, 5000)

    expect(set.asked.length, 'the look inside the turn asked nothing').toBe(2)

    await finish($, set, claude('Failed jobs are retried three times and then parked.', edit('src/queue/retry.ts')))

    expect(set.asked.length).toBe(3)
    expect(await shown($), 'the turn’s end asks its one question').toMatch('? Why: Retry a failed job three times, then park it.')
  })

  test('a lookup the look’s model asks for while no hook is being waited on is done without, and never made late', async ($, on) => {
    const set = stage(on, {
      replies: [slowly(10_000, JSON.stringify({ tool: 'search', args: { query: 'queue lock' } })), NOTHING],
    })

    await $.session.start(START)
    await asking($, on, set)
    came(set, ANSWERED)
    await works($, on, set, 1, 2000)
    await set.clock.advance(8000)

    expect([set.asked.length, set.of('search')], 'the model asked for a lookup while a tool runs').toEqual([1, []])

    await set.clock.advance(LINE_WAIT_MS)

    expect(set.asked.length, 'after a short wait the model goes on').toBe(2)
    expect(set.asked[1]?.prompt).toMatch('(the lookup failed; go on without it)')

    await works($, on, set, 2, 1000)

    expect(set.of('search'), 'and the step that begins later does not make the lookup').toEqual([])
  })

  test('the same question answered the same way again is another answer, and is looked at too', async ($, on) => {
    const set = stage(on, { replies: [NOTHING] })
    const row = (id: string, outcome: Record<string, unknown>) => claude('One thing first.', { ...OUT, ...outcome, tool_use_id: id })

    await $.session.start(START)
    await asking($, on, set)
    set.rows[set.rows.length - 1] = row('toolu_1', ANSWERED)
    await works($, on, set, 1, 5000)

    expect(set.asked.length).toBe(1)

    set.rows.push(row('toolu_2', {}))
    stepping(on, () => [ASKED])
    await step($, 2, [])
    set.rows[set.rows.length - 1] = row('toolu_2', ANSWERED)
    await works($, on, set, 3, 5000)

    expect(set.asked.length).toBe(2)
    expect(fresh(set, 1)).toMatch(CHOSE)

    await works($, on, set, 4, 5000)

    expect(set.asked.length, 'each answer once').toBe(2)
  })

  test('in a turn nobody prompted, a question of Scribe’s does not come up while Claude works', async ($, on) => {
    const set = stage(on, { replies: [NOTHING, UNEXPLAINED] })

    await $.session.start(START)
    await turn($, set, dev('Run the checks in the background.'), claude('Started.', edit(FILE)))
    set.rows.push(NOTICE, claude('The checks pass. I took Postgres advisory locks for the queue.', edit(FILE)))
    await asking($, on, set, null)
    came(set, ANSWERED)
    stepping(on, () => [], 60_000)

    const working = step($, 1, [])

    await set.clock.advance(1000)

    expect(set.of('remember').length).toBe(1)
    expect(await shown($, true), 'the receipt is what shows').toMatch('✓ Recorded')

    await press($, 'ok')

    expect(await shown($, true), 'and its OK takes it down, with the question still waiting').toBe(`${QUIET} · 1 kept`)

    await set.clock.advance(60_000)
    await working
    await finish($, set, claude('Done.'))

    expect(await shown($), 'the question comes once the turn is over').toBe(WHY_CARD)
  })

  test('one turn raises one question of Scribe’s: where the look inside it asked, the look at its end does not', async ($, on) => {
    const set = stage(on, { replies: [NOTHING, UNEXPLAINED, UNEXPLAINED_TOO] })

    await $.session.start(START)
    await turn($, set, dev('Look at the queue with me.'), claude('It has no lock yet.', edit(FILE)))
    await send($, 'Set up the job queue.')
    set.rows.push(dev('Set up the job queue.'), claude('I took Postgres advisory locks for the queue.', edit(FILE)))
    await asking($, on, set, null)
    came(set, ANSWERED)
    await works($, on, set, 1, 5000)

    expect(set.of('remember').length).toBe(1)

    await finish($, set, claude('Failed jobs are retried three times and then parked.', edit('src/queue/retry.ts')))

    expect(set.asked.length).toBe(3)
    expect(set.of('remember').length, 'both decisions are on record').toBe(2)
    expect(await shown($)).toBe(WHY_CARD)

    await press($, 'skip')

    expect(await shown($), 'and no second question follows').not.toMatch('? Why')
  })

  test('a look inside a turn that came to nothing leaves its rows for the turn’s end', async ($, on) => {
    const set = stage(on, { replies: [() => undefined, NOTHING] })

    await $.session.start(START)
    await asking($, on, set)
    came(set, ANSWERED)
    stepping(on, () => [], 2000)

    const working = step($, 1, [])

    await set.clock.advance(2000)
    await working
    stepping(on, () => [])

    expect(set.asked.length).toBe(1)

    await step($, 2, [])
    await set.clock.settle()

    expect(set.asked.length, 'the answer is not looked at again step after step').toBe(1)

    await finish($, set, claude('Done.', edit(FILE)))

    expect(set.asked.length).toBe(2)
    expect(fresh(set, 1), 'the answer is in the rows the turn’s end looks at').toMatch(CHOSE)
  })

  test(`an answer is looked at in a turn nobody prompted, that changed no file and holds under ${QUIET_TURN_CHARS} characters`, async ($, on) => {
    const set = stage(on, { replies: [NOTHING] })

    await $.session.start(START)
    await turn($, set, dev('Run the checks in the background.'), claude('Started.', edit(FILE)))

    expect(set.asked.length).toBe(1)

    set.rows.push(NOTICE)
    await asking($, on, set, null)
    came(set, ANSWERED)
    await step($, 1, [])
    await set.clock.settle()

    expect(set.asked.length).toBe(2)
    expect(fresh(set, 1)).toMatch(CHOSE)
  })

  test(`an answer is looked at when the hour has had its ${MAX_WAKES_PER_HOUR} looks, and is counted among them`, async ($, on) => {
    const set = stage(on, { replies: [NOTHING] })

    await $.session.start(START)

    for (let n = 1; n < MAX_WAKES_PER_HOUR; n += 1) {
      await turn($, set, dev(`step ${n}`), claude('Done.', edit(FILE)))
    }

    await asking($, on, set)
    came(set, ANSWERED)
    await step($, 1, [])
    await set.clock.settle()

    expect(set.asked.length, 'the hour’s last look').toBe(MAX_WAKES_PER_HOUR)

    await finish($, set, claude('Done.', edit(FILE)))

    expect(set.asked.length, 'the turn’s end is refused: the answer’s look was one of the hour’s').toBe(MAX_WAKES_PER_HOUR)
    expect(set.logged).toEqual([`Scribe: ${MAX_WAKES_PER_HOUR} wakes in the last hour; quiet until the hour has rolled on`])

    await asking($, on, set, 'And the retries?')
    came(set, ANSWERED_AGAIN)
    await step($, 1, [])
    await set.clock.settle()

    expect(set.asked.length, 'an answer is looked at all the same').toBe(MAX_WAKES_PER_HOUR + 1)
    expect(fresh(set, MAX_WAKES_PER_HOUR), 'with the rows the refused look left').toMatch('[developer] And the retries?')
  })

  test('signed out, an answer begins no look', async ($, on) => {
    const set = stage(on, { connect: () => NEEDS_SIGN_IN })

    await $.session.start(START)
    await asking($, on, set)
    came(set, ANSWERED)
    await step($, 1, [])
    await set.clock.settle()

    expect([set.asked, set.calls]).toEqual([[], []])
  })

  test('what a look inside a turn wrote is not shown while the developer types', async ($, on) => {
    const set = stage(on, { replies: [RECORD] })

    await $.session.start(START)
    await asking($, on, set)
    await typing($, set, 'and while you are at it')
    came(set, ANSWERED)
    stepping(on, () => [], 60_000)

    const working = step($, 1, [])

    await set.clock.advance(1000)

    expect(set.of('remember').length).toBe(1)
    expect(await shown($, true), 'nothing comes up over their typing').not.toMatch('Recorded')

    await typing($, set, '')

    expect(await shown($, true)).toMatch('✓ Recorded')

    await set.clock.advance(60_000)
    await working
  })
})
