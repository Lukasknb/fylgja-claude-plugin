import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { LINE_WAIT_MS } from '../hooks/live'
import {
  carded,
  claude,
  decision,
  dev,
  edit,
  finish,
  NOTHING,
  press,
  pressTwice,
  QUIET,
  send,
  shown,
  stage,
  START,
  step,
  stepping,
  use,
  verdict,
} from './scribe-fixtures'
import type { Stage } from './scribe-fixtures'

const FILE = 'src/queue/lock.ts'
const PROMPT = 'Move the job queue onto Postgres.'
const RECORD = verdict({ records: [decision()] })

/** What a look was told is new, apart from what it is reminded of. */
function fresh(set: Stage, at: number): string {
  const prompt = set.asked[at]?.prompt ?? ''

  return prompt.slice(prompt.indexOf('What happened since you last looked:'), prompt.indexOf('Records anchored to the files'))
}

/** The developer's prompt, and the steps `from` up to `to` of the turn, each one more row of work. */
async function working($: Engine, set: Stage, from: number, to: number, prompt: string | null = PROMPT): Promise<void> {
  if (prompt !== null) {
    await send($, prompt)
    set.rows.push(dev(prompt))
  }

  for (let index = from; index <= to; index += 1) {
    set.rows.push(claude(`Step ${index} of the move.`, edit(FILE)))
    await step($, index, [])
  }
}

/** A step of the turn that takes a minute, with the test's clock moved a second into it: a look it began is done by then. */
async function slowStep($: Engine, on: On, set: Stage, index: number): Promise<void> {
  set.rows.push(claude(`Step ${index} of the move.`, edit(FILE)))
  stepping(on, () => [], 60_000)

  const going = step($, index, [])

  await set.clock.advance(LINE_WAIT_MS)
  stepping(on, () => [])
  await set.clock.advance(60_000)
  await going
}

describe('how often Scribe looks inside a turn', () => {
  test('every 5 steps, the default: a look after the fifth step, beside it, and the turn’s end reads only what came after', async ($, on) => {
    const set = stage(on, { replies: [RECORD, NOTHING] })

    await $.session.start(START)
    await working($, set, 0, 4)

    expect(set.asked, 'four steps have ended: nothing yet').toEqual([])

    set.rows.push(claude('Step 4 of the move is in.', edit(FILE)))
    stepping(on, () => [], 60_000)

    const fifth = step($, 5, [])

    await set.clock.advance(LINE_WAIT_MS)

    expect(set.asked.length, 'the step that begins after the fifth has a look beside it').toBe(1)
    expect(fresh(set, 0)).toMatch(PROMPT)
    expect(set.of('remember').length, 'and what it came to is written while Claude works').toBe(1)
    expect(await shown($, true)).toMatch('✓ Recorded')

    stepping(on, () => [])
    await set.clock.advance(60_000)
    await fifth
    await working($, set, 6, 7, null)

    expect(set.asked.length, 'the steps that follow begin no look before the tenth').toBe(1)

    await finish($, set, claude('The queue takes its lock from Postgres now.', edit(FILE)))

    expect(set.asked.length, 'the turn’s end looks as it always does').toBe(2)
    expect(fresh(set, 1)).toMatch('The queue takes its lock from Postgres now.')
    expect(fresh(set, 1), 'and not again at what the look inside the turn went through').not.toMatch(PROMPT)
    expect(fresh(set, 1)).not.toMatch('Step 3 of the move.')
    expect(set.of('remember').length, 'nothing is written twice').toBe(1)
  })

  test('no look is begun beside one under way, and a turn’s end that stops it reads its rows once', async ($, on) => {
    const thinking = async (_asked: unknown, clock: Stage['clock']): Promise<string> => {
      await clock.sleep(600_000)

      return RECORD
    }
    const set = stage(on, { replies: [thinking, RECORD, NOTHING] })

    await $.session.start(START)
    await working($, set, 0, 4)
    await slowStep($, on, set, 5)

    expect(set.asked.length, 'the look after the fifth step is still thinking').toBe(1)

    await working($, set, 6, 9, null)
    await slowStep($, on, set, 10)

    expect(set.asked.length, 'the tenth step begins none beside it').toBe(1)

    await finish($, set, claude('The queue takes its lock from Postgres now.', edit(FILE)))

    expect(set.asked.length, 'the turn’s end stops it and looks itself').toBe(2)
    expect(fresh(set, 1), 'at everything the stopped look was reading').toMatch(PROMPT)

    await set.clock.advance(600_000)
    await set.clock.settle()

    expect(set.of('remember').length, 'and what the stopped look comes to in the end is let go').toBe(1)
  })

  test('every 10 steps: the fifth begins nothing, the tenth a look', async ($, on) => {
    const set = stage(on, { settings: { scribeCadence: 'Every 10 steps' } })

    await $.session.start(START)
    await working($, set, 0, 8)
    await slowStep($, on, set, 9)

    expect(set.asked).toEqual([])

    await slowStep($, on, set, 10)

    expect(set.asked.length).toBe(1)
  })

  test('turn end only: no look inside the turn, however long it runs, and one at its end', { options: { scribeCadence: 'Turn end only' } }, async ($, on) => {
    const set = stage(on)

    await $.session.start(START)
    await working($, set, 0, 14)
    await slowStep($, on, set, 15)

    expect(set.asked, 'no step began a look').toEqual([])

    await finish($, set, claude('Done.', edit(FILE)))

    expect(set.asked.length).toBe(1)
    expect(fresh(set, 0)).toMatch(PROMPT)
  })

  test('a change in the /config menu applies at the next step, with no reload', async ($, on) => {
    const set = stage(on, { settings: { scribeCadence: 'Turn end only' } })

    await $.session.start(START)
    await working($, set, 0, 4)
    await slowStep($, on, set, 5)

    expect(set.asked, 'turn end only, as /config said').toEqual([])

    await $.config.set({
      key: 'fylgja.scribeCadence',
      value: 'Every 5 steps',
      previous: 'Turn end only',
      provider: { plugin: 'fylgja', tier: 'user' },
      origin: { kind: 'composer' },
    } as never)
    await working($, set, 6, 9, null)
    await slowStep($, on, set, 10)

    expect(set.asked.length, 'the tenth step is a fifth one, and looks').toBe(1)
  })

  test('as the hour’s share of looks runs low, the count of steps widens: 5, then 10', { timeoutMs: 30_000 }, async ($, on) => {
    const set = stage(on)

    await $.session.start(START)

    // Ten turns of the developer's, each looked at once at its end.
    for (let turn = 0; turn < 10; turn += 1) {
      await working($, set, 0, 0, `Turn ${turn}: rename the lock helper ${turn}.`)
      await finish($, set, claude(`Renamed in turn ${turn}.`, edit(FILE)))
    }

    expect(set.asked.length).toBe(10)

    await working($, set, 0, 4, 'One more change, a long one.')
    await slowStep($, on, set, 5)

    expect(set.asked.length, 'ten looks this hour: the fifth step begins none').toBe(10)

    await working($, set, 6, 9, null)
    await slowStep($, on, set, 10)

    expect(set.asked.length, 'the tenth does').toBe(11)
  })

  test('an answered question is looked at right then, whatever the setting', async ($, on) => {
    const QUESTION = 'Which lock?'
    const INPUT = { questions: [{ question: QUESTION, options: [{ label: 'Postgres', description: '' }, { label: 'Redis', description: '' }] }] }
    const set = stage(on, { settings: { scribeCadence: 'Turn end only' } })

    await $.session.start(START)
    await send($, PROMPT)
    set.rows.push(dev(PROMPT), claude('One thing first.', { tool: 'AskUserQuestion', input: INPUT }))
    stepping(on, () => [{ name: 'AskUserQuestion', input: INPUT }])
    await step($, 0, [])
    set.rows[set.rows.length - 1] = claude(
      'One thing first.',
      use('AskUserQuestion', INPUT, `User has answered your questions: "${QUESTION}"="Postgres". You can now continue.`),
    )
    await slowStep($, on, set, 1)

    expect(set.asked.length).toBe(1)
    expect(fresh(set, 0)).toMatch('[developer chose]')
  })

  test('a look inside the turn puts no question up while Claude works; it waits for the turn’s end', async ($, on) => {
    const WHY = verdict({
      records: [decision({ detail: '', reason_status: 'not_stated' })],
      question: { form: 'reason', record: 0, options: ['One less service to run'] },
    })
    const set = stage(on, { replies: [WHY, NOTHING] })

    await $.session.start(START)
    await working($, set, 0, 4)
    set.rows.push(claude('Step 4 of the move is in.', edit(FILE)))
    stepping(on, () => [], 60_000)

    const fifth = step($, 5, [])

    await set.clock.advance(LINE_WAIT_MS)

    expect(set.of('remember').length).toBe(1)
    expect(await shown($, true), 'Claude is working: the question waits').not.toMatch('Why: ')

    stepping(on, () => [])
    await set.clock.advance(60_000)
    await fifth
    await finish($, set, claude('Done.', edit(FILE)))

    expect(await shown($)).toMatch('Why: ')
  })
})

describe('the model Scribe thinks with', () => {
  test('the model picked is the one asked, and a change applies to the next look with no reload', async ($, on) => {
    const set = stage(on, { settings: { scribeModel: 'Haiku' } })

    await $.session.start(START)
    await working($, set, 0, 0)
    await finish($, set, claude('Done.', edit(FILE)))

    expect(set.asked[0]?.model).toBe('haiku')

    set.settings.scribeModel = 'Opus'
    await working($, set, 0, 0, 'And now the retries, with a backoff that grows.')
    await finish($, set, claude('Retries are in.', edit(FILE)))

    expect(set.asked[1]?.model).toBe('opus')
  })

  test('as the plugin was loaded with it, when /config does not list it', { options: { scribeModel: 'Opus' } }, async ($, on) => {
    const set = stage(on)

    await $.session.start(START)
    await working($, set, 0, 0)
    await finish($, set, claude('Done.', edit(FILE)))

    expect(set.asked[0]?.model).toBe('opus')
  })
})

const AGENT = 'agent-7f3a'
const BRIEF = 'Port the job queue lock to Postgres advisory locks; keep the Redis client.'
const TRAP =
  'Trap: pg_advisory_lock is held per connection, so the pool handed the lock to another job; switched to pg_advisory_xact_lock.'
const REPORT = [
  'Ported the lock to Postgres advisory locks in src/queue/lock.ts.',
  TRAP,
  'I also removed the Redis client, it was unused after the port.',
].join('\n')
const GOTCHA = 'When taking a Postgres advisory lock through the pool, use `pg_advisory_xact_lock`, since `pg_advisory_lock` stays with the connection.'
const CHOICE = 'Remove the Redis client from the job queue.'
const OWN_WORDS = 'Worth knowing: a pooled connection keeps a session-level advisory lock, so the lock is now transaction-scoped.'

/** The record a look takes out of the agent's report, as the model writes it. */
function fromReport(kind: 'gotcha' | 'decision', report = 'r1'): Record<string, unknown> {
  return kind === 'gotcha'
    ? { kind: 'gotcha', content: GOTCHA, detail: '', triggers: ['pg_advisory_lock'], anchors: [{ path: FILE }], from_report: report }
    : { ...decision({ content: CHOICE, detail: 'It was unused after the port.', alternatives: ['keeping the Redis client'] }), from_report: report }
}

/** An agent's run ends, handing `answer` back, as Claude Code ends it. */
async function handsBack($: Engine, agentId: string, answer: string, reason: 'answer' | 'error' = 'answer'): Promise<void> {
  await $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: `run-${agentId}`, reason, agentId } as never)
}

/**
 * Claude starts an agent with the brief, the agent works in its own session
 * and hands its report back, and the Agent call's row in the main
 * conversation holds what it came to.
 */
async function delegated($: Engine, set: Stage, prompt: string | null = PROMPT): Promise<void> {
  if (prompt !== null) {
    await send($, prompt)
    set.rows.push(dev(prompt))
  }

  set.rows.push(
    claude('I will hand the port to an agent.', {
      ...use('Agent', { description: 'Port the queue lock', prompt: BRIEF }, REPORT),
      agentId: AGENT,
    } as never),
  )
  await step($, 0, [])
  await step($, 0, [], AGENT)
  await handsBack($, AGENT, REPORT)
}

describe('what an agent hands back', () => {
  test('a gotcha Claude says again in its own words is recorded, from the report alone and nothing else of the agent', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [fromReport('gotcha')] })] })

    await $.session.start(START)
    await delegated($, set)
    await finish($, set, claude(`Done. ${OWN_WORDS}`, edit(FILE)))

    const prompt = set.asked[0]?.prompt ?? ''

    expect(prompt, 'the report is read').toMatch('agent report r1')
    expect(prompt).toMatch('switched to pg_advisory_xact_lock')
    expect(prompt, 'with what the agent was asked to do').toMatch(BRIEF)
    expect(set.of('remember').map(args => args.content)).toEqual([GOTCHA])
    expect(set.conversations.every(id => id === undefined), 'the agent’s own session is never read').toBe(true)
  })

  test('Claude passing the report on word for word confirms nothing: the gotcha is let go without a word', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [fromReport('gotcha')] })] })

    await $.session.start(START)
    await delegated($, set)
    await finish($, set, claude(`The agent reports: ${TRAP}`, edit(FILE)))

    expect(set.of('remember')).toEqual([])
    expect(await shown($), 'and nothing is asked').toBe(QUIET)
  })

  test('a gotcha only the report says is not recorded, and nothing is asked about it', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [fromReport('gotcha')] })] })

    await $.session.start(START)
    await delegated($, set)
    await finish($, set, claude('The agent is done; the port is in.', edit(FILE)))

    expect(set.of('remember')).toEqual([])
    expect(await shown($)).toBe(QUIET)
  })

  test('the developer saying it in their own words confirms it', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [fromReport('gotcha')] })] })
    const SAID = 'Right, keep the advisory lock transaction-scoped: the pool reuses connections.'

    await $.session.start(START)
    await delegated($, set)
    await send($, SAID)
    await finish($, set, dev(SAID), claude('Noted.', edit(FILE)))

    expect(set.of('remember').map(args => args.content)).toEqual([GOTCHA])
  })

  test('a report goes to one look: one inside the turn holds its gotcha, and it is recorded once Claude confirms it, once', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [fromReport('gotcha')] }), NOTHING] })

    await $.session.start(START)
    await delegated($, set)
    await working($, set, 1, 4, null)
    await slowStep($, on, set, 5)

    expect(set.asked.length, 'the look after the fifth step saw the report').toBe(1)
    expect(set.of('remember'), 'and holds the gotcha, unconfirmed').toEqual([])

    await finish($, set, claude(OWN_WORDS, edit(FILE)))

    expect(set.asked.length).toBe(2)
    expect(set.asked[1]?.prompt, 'the turn’s end is not shown the report again').not.toMatch('agent report r1')
    expect(set.asked[1]?.prompt, 'and is told the gotcha is Scribe’s to hold').toMatch(GOTCHA)
    expect(set.of('remember').map(args => args.content)).toEqual([GOTCHA])
  })

  test('a choice the agent made is never recorded from its report: the developer is asked, and kept it is theirs', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [fromReport('decision')] })] })

    await $.session.start(START)
    await delegated($, set)
    await finish($, set, claude('The agent also removed the Redis client, as it was unused.', edit(FILE)))

    expect(set.of('remember')).toEqual([])
    expect(await shown($)).toBe(
      carded(
        `? Agent chose: ${CHOICE}  Not what it was asked to do, or a choice nobody made with you. [1 Keep, record it] [2 Not wanted, tell Claude] [9 What is this] [0 Skip]`,
      ),
    )

    await pressTwice($, 'keep')

    expect(set.of('remember').length, 'kept on their word').toBe(1)
    expect(set.of('remember')[0]?.reason_status, 'without the reason only the agent gave').toBe('not_stated')
    expect(await shown($), 'which they are asked for next, the agent’s offered').toMatch('It was unused after the port.')
  })

  test('the question about an agent’s choice stands behind a question why, and takes nothing from its share', async ($, on) => {
    const WHY = verdict({
      records: [decision({ detail: '', reason_status: 'not_stated' }), fromReport('decision')],
      question: { form: 'reason', record: 0, options: ['One less service to run'] },
    })
    const set = stage(on, { replies: [WHY] })

    await $.session.start(START)
    await delegated($, set)
    await finish($, set, claude('Done.', edit(FILE)))

    expect(await shown($), 'the question why comes first').toMatch('Why: ')

    await press($, 'skip')

    expect(await shown($), 'then the agent’s choice').toMatch('Agent chose: ')

    await press($, 'skip')

    expect(set.of('remember').length, 'only the decision of the session').toBe(1)
  })

  test('“Not wanted” puts the choice to Claude in the prompt box and writes nothing', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [fromReport('decision')] })] })

    await $.session.start(START)
    await delegated($, set)
    await finish($, set, claude('Done.', edit(FILE)))
    await press($, 'tell-claude')

    expect(set.of('remember')).toEqual([])
    expect(set.box.text).toMatch(CHOICE)
  })

  test('only an agent the main conversation started is read: not one an agent started, nor a plugin’s', async ($, on) => {
    const set = stage(on)

    await $.session.start(START)
    await send($, PROMPT)
    set.rows.push(dev(PROMPT), claude('Working on it.', edit(FILE)))
    // Started inside another agent's session, or by a plugin: no Agent call of the main conversation names it.
    await handsBack($, 'agent-nested', `Nested: ${TRAP}`)
    await handsBack($, 'agent-of-a-plugin', `Plugin: ${TRAP}`)
    await finish($, set, claude('Done.', edit(FILE)))

    expect(set.asked[0]?.prompt).not.toMatch('agent report')
  })

  test('a teammate’s later turns, and a run that ended in an error, are no report', async ($, on) => {
    const set = stage(on)

    await $.session.start(START)
    await send($, PROMPT)
    set.rows.push(
      dev(PROMPT),
      claude('Two helpers.', { ...use('Agent', { prompt: BRIEF }, 'started'), agentId: 'teammate-1' } as never, {
        ...use('Agent', { prompt: BRIEF }, 'failed', true),
        agentId: 'agent-failed',
      } as never),
    )
    await handsBack($, 'teammate-1', 'First report of the teammate.')
    await handsBack($, 'teammate-1', 'Idle: waiting for the next task.')
    await handsBack($, 'agent-failed', 'API error: overloaded', 'error')
    await finish($, set, claude('Done.', edit(FILE)))

    const prompt = set.asked[0]?.prompt ?? ''

    expect(prompt).toMatch('First report of the teammate.')
    expect(prompt).not.toMatch('Idle: waiting')
    expect(prompt).not.toMatch('API error')
  })
})

describe('what came of a report survives a reload', () => {
  test('the question about an agent’s choice comes up again, and the agent’s report is not taken twice', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [fromReport('decision')] }), NOTHING] })

    await $.session.start(START)
    await delegated($, set)
    await finish($, set, claude('Done.', edit(FILE)))

    expect(await shown($)).toMatch('Agent chose: ')

    // The plugin loaded afresh for the conversation: what it held is gone, and the store stays.
    await set.clock.settle()
    await $.session.start(START)
    await set.clock.settle()

    expect(await shown($), 'the same question, untouched').toMatch('Agent chose: ')

    await send($, 'Go on.')
    set.rows.push(dev('Go on.'), claude('Going on.', edit(FILE)))
    await handsBack($, AGENT, REPORT)
    await finish($, set)

    expect(set.asked.length).toBe(2)
    expect(set.asked[1]?.prompt, 'the agent reported once already').not.toMatch('agent report')
  })
})
