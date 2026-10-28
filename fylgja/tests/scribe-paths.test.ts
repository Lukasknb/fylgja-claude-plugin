import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { LOOKUP_WAIT_MS, PLACE_WAIT_MS } from '../hooks/scribe/scribe'
import { answer, idOf } from './fixtures'
import {
  claude,
  decision,
  dev,
  edit,
  fact,
  finish,
  press,
  QUIET,
  REPO,
  ROOT,
  send,
  shown,
  stage,
  START,
  step,
  stepping,
  turn,
  use,
  verdict,
} from './scribe-fixtures'
import type { Stage } from './scribe-fixtures'

const A = 'src/a.ts'
const B = 'src/b.ts'
const ON_A = fact(1, {
  content: 'Parse dates in UTC, never in local time.',
  anchors: [{ path: A }],
})
const ON_B = fact(2, {
  content: 'Keep the retry count at three.',
  anchors: [{ path: B }],
})
const THERE = { [`${ROOT}/${A}`]: '', [`${ROOT}/${B}`]: '' }

/** A server that answers a lookup by path with the records anchored to those very files, and nothing else. */
const anchoredTo = (...facts: Record<string, unknown>[]) => ({
  recall: (args: Record<string, unknown>) => {
    const paths = Array.isArray(args.paths) ? (args.paths as string[]) : []

    return answer({
      repo: REPO,
      facts: facts.filter(one => (one.anchors as { path: string }[]).some(anchor => paths.includes(anchor.path))),
    })
  },
})

const bash = (command: string) => ({ name: 'Bash', input: { command } })

/** A step of the main conversation that runs `uses`, in a turn the developer began with `prompt`, then the turn's end. */
async function ran(
  $: Engine,
  on: On,
  set: Stage,
  prompt: string,
  ...uses: { name: string; input: unknown }[]
): Promise<void> {
  stepping(on, () => uses)
  await send($, prompt)
  await step($, 0, uses)
  await finish($, set, dev(prompt), claude('Done.', ...uses.map(one => use(one.name, one.input as Record<string, unknown>))))
}

const looked = (set: Stage): string[] => set.of('recall').flatMap(args => (Array.isArray(args.paths) ? (args.paths as string[]) : []))

describe('the files a command or a search names are looked up as the files Claude opens are', () => {
  test('a file a shell command reads, and is there, is looked up at the turn’s end, and a record anchored to it is told', async ($, on) => {
    const set = stage(on, { files: THERE, tools: anchoredTo(ON_A) })

    await $.session.start(START)
    await ran($, on, set, 'look at the date parsing', bash(`sed -n 1,40p ${A}`))

    expect(set.of('recall')).toEqual([{ repo: REPO, paths: [A] }])
    expect(await shown($)).toMatch('Parse dates in UTC, never in local time.')
  })

  test('a file that is not there, a pattern, a variable, a quote, a file outside the repository and a way out of it are not looked up', async ($, on) => {
    const set = stage(on, {
      files: { ...THERE, '/etc/hosts': '', '/work/other/a.ts': '' },
      tools: anchoredTo(ON_A),
    })

    await $.session.start(START)
    await ran(
      $,
      on,
      set,
      'check those',
      bash('cat src/missing.ts src/*.ts $HOME/a.ts "src/a.ts" /etc/hosts ../other/a.ts'),
      bash(`git log -p --follow ${ROOT}/../other/a.ts`),
    )

    expect(looked(set)).toEqual([])
    expect(await shown($)).toBe(QUIET)
  })

  test('a path after a `cd` is read from where the `cd` left the shell', async ($, on) => {
    const set = stage(on, {
      files: { [`${ROOT}/sub/b.ts`]: '', [`${ROOT}/b.ts`]: '' },
    })

    await $.session.start(START)
    await ran($, on, set, 'read it', bash('cd sub && cat b.ts'))

    expect(looked(set)).toEqual(['sub/b.ts'])
  })

  test('what a here-document holds is text, and names no file', async ($, on) => {
    const set = stage(on, { files: THERE })

    await $.session.start(START)
    await ran($, on, set, 'write the note', bash(`cat <<'EOF' > /tmp/note.md\nsee ${A} for the parser\nEOF`))

    expect(looked(set)).toEqual([])
  })

  test('the folder a search looks in is looked up', async ($, on) => {
    const set = stage(on, { files: { [`${ROOT}/src`]: '' } })

    await $.session.start(START)
    await ran($, on, set, 'find the parser', {
      name: 'Grep',
      input: { pattern: 'parseDate', path: 'src/' },
    })

    expect(looked(set)).toEqual(['src'])
  })

  test('a file only named is never where a record is anchored: only the files the session opened are', async ($, on) => {
    const FILE = 'src/queue/lock.ts'
    const set = stage(on, {
      files: THERE,
      replies: [
        verdict({
          records: [
            decision({
              anchors: [{ path: A }, { path: FILE, symbol: 'acquire' }],
            }),
          ],
        }),
      ],
    })

    stepping(on, () => [bash(`cat ${A}`)])
    await $.session.start(START)
    await send($, 'switch the lock to postgres advisory locks')
    await step($, 0, [bash(`cat ${A}`)])
    await finish(
      $,
      set,
      dev('switch the lock to postgres advisory locks'),
      claude('Done.', use('Bash', { command: `cat ${A}` }), edit(FILE)),
    )

    expect(set.of('remember').map(args => args.anchors)).toEqual([[{ path: FILE, symbol: 'acquire' }]])
  })
})

const BRIEF = {
  name: 'Agent',
  input: {
    description: 'Fix the date parser',
    prompt: `Read \`${A}\` and ${B}:12, then make the parser keep UTC throughout.`,
  },
}
const AGENT_ID = 'agent-7'
const BRIEF_LINE = "2 records on files this agent's brief names"

/** Where the plugin's messages to agents go: each is answered by `isDelivered`. */
function agents(on: On, isDelivered = () => true): { to: unknown; text: string }[] {
  const sent: { to: unknown; text: string }[] = []

  on('session.send', ($, e) => {
    sent.push({ to: e.to, text: e.text })

    return isDelivered() ? { isDelivered: true } : { isDelivered: false, reason: 'gone' }
  })

  return sent
}

/** The developer starts a turn in which Claude starts an agent with `BRIEF`; with `agentId`, the agent is at work. */
async function briefing($: Engine, on: On, set: Stage, agentId?: string): Promise<void> {
  stepping(on, () => [BRIEF])
  await $.session.start(START)
  await send($, 'have an agent fix the date parser')
  set.rows.push(dev('have an agent fix the date parser'))
  await step($, 0, [BRIEF])

  if (agentId !== undefined) {
    set.rows.push(
      claude('Starting an agent.', {
        tool: 'Agent',
        input: BRIEF.input,
        agentId,
      }),
    )
  }
}

describe('the files an agent’s brief names are looked up as it starts, for the developer to have them told to it', () => {
  test('the records on those files are offered as one item, and Tell agent sends them to the agent at work', async ($, on) => {
    const sent = agents(on)
    const set = stage(on, { files: THERE, tools: anchoredTo(ON_A, ON_B) })

    await briefing($, on, set, AGENT_ID)

    expect(set.of('recall'), 'at once, by the brief’s files').toEqual([{ repo: REPO, paths: [A, B] }])
    expect(await shown($, true)).toMatch(`${BRIEF_LINE}`)
    expect(await shown($, true)).toMatch('[1 Tell agent] [2 Open]')

    await press($, 'tell-agent')

    expect(sent).toHaveLength(1)
    expect(JSON.stringify(sent[0]?.to)).toMatch(AGENT_ID)
    expect(sent[0]?.text).toMatch('Parse dates in UTC, never in local time.')
    expect(sent[0]?.text).toMatch('Keep the retry count at three.')
    expect(sent[0]?.text).toMatch(`Fylgja record ${idOf(1).slice(0, 8)}`)
    expect(set.fills, 'nothing in the prompt box').toEqual([])
    expect(await shown($, true)).toBe(QUIET)
  })

  test('Open lists each record', async ($, on) => {
    const set = stage(on, { files: THERE, tools: anchoredTo(ON_A, ON_B) })

    await briefing($, on, set, AGENT_ID)
    await press($, 'open')

    const card = await shown($, true)

    expect(card).toMatch('Parse dates in UTC, never in local time.')
    expect(card).toMatch('Keep the retry count at three.')
  })

  test('with no agent at work to take them, they go in the prompt box, and only an empty one', async ($, on) => {
    const sent = agents(on)
    const set = stage(on, { files: THERE, tools: anchoredTo(ON_A, ON_B) })

    await briefing($, on, set)
    set.box.text = 'half a prompt'
    await press($, 'tell-agent')

    expect(set.fills, 'a box with text in it is left alone').toEqual([])
    expect(await shown($, true)).toMatch(BRIEF_LINE)

    set.box.text = ''
    await press($, 'tell-agent')

    expect(sent).toEqual([])
    expect(set.fills).toHaveLength(1)
    expect(set.fills[0]).toMatch('Keep the retry count at three.')
  })

  test('a message the agent does not take goes in the prompt box instead', async ($, on) => {
    const sent = agents(on, () => false)
    const set = stage(on, { files: THERE, tools: anchoredTo(ON_A, ON_B) })

    await briefing($, on, set, AGENT_ID)
    await press($, 'tell-agent')

    expect(sent).toHaveLength(1)
    expect(set.fills).toHaveLength(1)
    expect(set.fills[0]).toMatch('Parse dates in UTC, never in local time.')
  })

  test('it is the turn’s one tell: after a record told in the turn, an agent’s brief brings no item', async ($, on) => {
    const set = stage(on, { files: THERE, tools: anchoredTo(ON_A, ON_B) })
    const first = [bash(`cat ${A}`), bash(`cat ${A}`), bash(`cat ${A}`), bash(`cat ${A}`)]

    stepping(on, () => first)
    await $.session.start(START)
    await send($, 'have an agent fix the date parser')

    for (const index of [0, 1, 2, 3]) {
      await step($, index, first)
    }

    expect(await shown($, true)).toMatch('Parse dates in UTC, never in local time.')

    const before = set.of('recall').length

    stepping(on, () => [BRIEF])
    await step($, 4, [BRIEF])

    expect(await shown($, true)).not.toMatch('brief names')
    expect(set.of('recall'), 'and nothing is looked up for it').toHaveLength(before)
  })

  test('several agents started in one step are looked up together, and the step is held no longer than one lookup', async ($, on) => {
    const set = stage(on, { files: THERE, tools: { recall: () => new Promise(() => undefined) } })
    const many = [A, B, A, B, A].map((file, n) => ({ name: 'Agent', input: { description: `Part ${n}`, prompt: `Part ${n}: rework ${file}.` } }))

    stepping(on, () => many)
    await $.session.start(START)
    await send($, 'split the parser work over five agents')

    let isDone = false
    const pending = step($, 0, many).then(() => {
      isDone = true
    })

    await set.clock.advance(PLACE_WAIT_MS + LOOKUP_WAIT_MS + 10)
    await pending

    expect(isDone).toBe(true)
    expect(set.of('recall')).toEqual([{ repo: REPO, paths: [A, B] }])
  })

  test('agents started together are each told the records on the files their own brief names', async ($, on) => {
    const sent = agents(on)
    const set = stage(on, { files: THERE, tools: anchoredTo(ON_A, ON_B) })
    const two = [
      { name: 'Agent', input: { description: 'Dates', prompt: `Rework ${A}.` } },
      { name: 'Agent', input: { description: 'Retries', prompt: `Rework ${B}.` } },
    ]

    stepping(on, () => two)
    await $.session.start(START)
    await send($, 'two agents, please')
    await step($, 0, two)
    set.rows.push(
      claude(
        'Starting two agents.',
        { tool_use_id: 'call-1', tool: 'Agent', input: two[0]?.input ?? {}, agentId: 'agent-1' },
        { tool_use_id: 'call-2', tool: 'Agent', input: two[1]?.input ?? {}, agentId: 'agent-2' },
      ),
    )

    expect(await shown($, true)).toMatch("2 records on files these agents' briefs name")

    await press($, 'tell-agent')

    expect(sent.map(one => [JSON.stringify(one.to), one.text.includes('Parse dates'), one.text.includes('retry count')])).toEqual([
      [JSON.stringify('agent-1'), true, false],
      [JSON.stringify('agent-2'), false, true],
    ])
  })

  test('two agents given the same brief are two agents: each is told', async ($, on) => {
    const sent = agents(on)
    const set = stage(on, { files: THERE, tools: anchoredTo(ON_A, ON_B) })

    await briefing($, on, set)
    set.rows.push(
      claude(
        'Starting two agents.',
        { tool_use_id: 'call-1', tool: 'Agent', input: BRIEF.input, agentId: 'agent-1' },
        { tool_use_id: 'call-2', tool: 'Agent', input: BRIEF.input, agentId: 'agent-2' },
      ),
    )
    await press($, 'tell-agent')

    expect(sent.map(one => JSON.stringify(one.to))).toEqual([JSON.stringify('agent-1'), JSON.stringify('agent-2')])
  })

  test('the agent is known as it starts, before any row says so', async ($, on) => {
    const sent = agents(on)
    const set = stage(on, { files: THERE, tools: anchoredTo(ON_A, ON_B) })

    on('agent.spawn', () => ({ model: 'haiku', agentId: 'agent-9' }))
    await briefing($, on, set)
    await $.agent.spawn({ prompt: BRIEF.input.prompt, description: BRIEF.input.description } as never)
    await press($, 'tell-agent')

    expect(sent.map(one => JSON.stringify(one.to))).toEqual([JSON.stringify('agent-9')])
    expect(set.fills).toEqual([])
  })

  for (const [how, ending] of [
    ['stopped', { answer: 'half done', isAborted: true, reason: 'aborted' }],
    ['ended with nothing said', { answer: '', isAborted: false, reason: 'answer' }],
  ] as const) {
    test(`an agent that ${how} is sent nothing, which would start it again: the notes go in the prompt box`, async ($, on) => {
      const sent = agents(on)
      const set = stage(on, { files: THERE, tools: anchoredTo(ON_A, ON_B) })

      await briefing($, on, set, AGENT_ID)
      await $.turn.complete({ ...ending, durationMs: 1, turnId: 'agent-turn', agentId: AGENT_ID } as never)
      await press($, 'tell-agent')

      expect(sent).toEqual([])
      expect(set.fills).toHaveLength(1)
      expect(set.fills[0]).toMatch('Parse dates in UTC, never in local time.')
    })
  }
})

describe('a turn with no file to look up by is looked up by the words of the prompt', () => {
  test('its words are asked about once, and the record Fylgja ranks first is told', async ($, on) => {
    const set = stage(on, {
      tools: {
        recall: () =>
          answer({
            repo: REPO,
            facts: [
              fact(1, {
                content: 'Use Postgres advisory locks for the job queue.',
              }),
              fact(2, { content: 'Keep Redis.' }),
            ],
          }),
      },
    })

    await $.session.start(START)
    await turn($, set, dev('Redis or Postgres for the job lock?'), claude('Postgres.'))

    expect(set.of('recall')).toEqual([{ repo: REPO, query: 'redis postgres lock' }])
    expect(await shown($)).toMatch('Use Postgres advisory locks for the job queue.')
    expect(await shown($)).not.toMatch('Keep Redis.')

    await finish($, set, claude('And more on it, without a new prompt.'))

    expect(set.of('recall'), 'once a prompt').toHaveLength(1)
  })

  test('a prompt with no word that carries meaning asks about the file every repository has, as before', async ($, on) => {
    const set = stage(on)

    await $.session.start(START)
    await turn($, set, dev('ok go'), claude('Going.'))

    expect(set.of('recall')).toEqual([{ repo: REPO, paths: ['README.md'] }])
  })

  test('a record of the session’s own is not told', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [decision()] }), '{"outcome":"nothing"}'],
      tools: {
        recall: args =>
          answer({
            repo: REPO,
            facts: typeof args.query === 'string' && !/[A-Z.]/.test(args.query) ? [fact(101)] : [],
          }),
      },
    })

    await $.session.start(START)
    await turn($, set, dev('Use Postgres for the queue lock.'), claude('Done.', edit('src/queue/lock.ts')))
    await press($, 'ok')
    await turn($, set, dev('what about the postgres lock now?'), claude('It stands.'))

    expect(
      set.of('recall').some(args => args.query === 'postgres lock'),
      'asked',
    ).toBe(true)
    expect(await shown($)).not.toMatch('Use the queue for outbound mail')
  })
})
