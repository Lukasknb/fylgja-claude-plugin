import { describe, expect, test } from 'claude-code/testing'

import { answer, idOf } from './fixtures'
import {
  carded,
  claude,
  decision,
  dev,
  edit,
  fact,
  gitStatus,
  NOTHING,
  press,
  QUIET,
  shown,
  stage,
  START,
  step,
  stepping,
  turn,
  use,
  verdict,
} from './scribe-fixtures'

const TALK = 'x'.repeat(260)
const NEW = decision({ content: 'Product analytics is PostHog Cloud on the EU host, not a self-hosted PostHog.', anchors: [] })
const OLD = fact(5, {
  content: 'Product analytics is a self-hosted PostHog on the prod box, not PostHog Cloud.',
  anchors: { paths: [{ path: 'src/analytics.ts' }] },
})
/** A server that holds `OLD` and gives it only to a lookup by words: no file of it has been touched. */
const holding = { recall: (args: Record<string, unknown>) => answer({ facts: typeof args.query === 'string' ? [OLD] : [] }) }
const relation = (relation: string) => () => JSON.stringify({ relation, id: idOf(5) })
const steer = [dev(`go with the cloud for analytics ${TALK}`), claude('Agreed, the cloud it is.')]

describe('a new decision is held against what is already recorded on its subject', () => {
  test('one that contradicts a recorded decision, made before any file is touched, is asked about and replaces nothing without the key', async ($, on) => {
    const set = stage(on, { tools: holding, replies: [verdict({ records: [NEW] })], relate: relation('contradicts') })

    await $.session.start(START)
    await turn($, set, ...steer)

    expect(set.of('recall').at(-1), 'Fylgja is asked by the decision’s own words, in its repository').toEqual({
      repo: 'acme/web',
      query: NEW.content,
    })
    expect(set.related.length, 'one judgement').toBe(1)
    expect(set.related[0]?.prompt).toMatch(`<<< record id=${idOf(5)} kind=decision`)
    expect(set.of('remember'), 'nothing is written yet').toEqual([])

    const line = await shown($)

    expect(line).toMatch('Now: Product analytics is PostHog Cloud on the EU host, not a self-hosted PostHog.')
    expect(line).toMatch('Recorded: Product analytics is a self-hosted PostHog on the prod box, not PostHog Cloud.')
    expect(line).toMatch('[1 Yes, it replaces it] [2 No, tell Claude] [3 Different case]')
    expect(line).toMatch('[0 Skip]')

    await press($, 'replaces')

    expect(set.of('remember'), 'one press replaces nothing').toEqual([])

    await press($, 'replaces')

    expect(set.of('remember')[0]).toMatchObject({ content: NEW.content, supersedes: idOf(5) })
  })

  test('one that refines a recorded decision is written with no question', async ($, on) => {
    const set = stage(on, { tools: holding, replies: [verdict({ records: [NEW] })], relate: relation('refines') })

    await $.session.start(START)
    await turn($, set, ...steer)

    expect(set.of('remember').length).toBe(1)
    expect(set.of('remember')[0]?.supersedes).toBeUndefined()
    expect(await shown($)).toMatch('✓ Recorded · ')
  })

  test('one that has nothing to do with what is recorded is written with no question', async ($, on) => {
    const set = stage(on, { tools: holding, replies: [verdict({ records: [NEW] })] })

    await $.session.start(START)
    await turn($, set, ...steer)

    expect(set.related.length).toBe(1)
    expect(set.of('remember').length).toBe(1)
    expect(await shown($)).not.toMatch('replaces')
  })

  test('with nothing recorded on the subject no model is asked', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [NEW] })] })

    await $.session.start(START)
    await turn($, set, ...steer)

    expect(set.of('recall').some(args => args.query === NEW.content)).toBe(true)
    expect(set.related).toEqual([])
    expect(set.of('remember').length).toBe(1)
  })

  test('a record the model names by an id that was not shown is not taken for contradicted', async ($, on) => {
    const set = stage(on, {
      tools: holding,
      replies: [verdict({ records: [NEW] })],
      relate: () => JSON.stringify({ relation: 'contradicts', id: idOf(999) }),
    })

    await $.session.start(START)
    await turn($, set, ...steer)

    expect(set.of('remember').length).toBe(1)
  })

  test('the lookup is one of the wake’s own three: a wake that used them makes none, and writes the decision', async ($, on) => {
    const lookup = JSON.stringify({ tool: 'recall', args: { query: 'analytics' } })
    const set = stage(on, {
      tools: holding,
      replies: [lookup, lookup, lookup, verdict({ records: [NEW] })],
      relate: relation('contradicts'),
    })

    await $.session.start(START)
    await turn($, set, ...steer)

    expect(set.of('recall').filter(args => args.query === NEW.content)).toEqual([])
    expect(set.related).toEqual([])
    expect(set.of('remember').length).toBe(1)
  })

  test('a gotcha and a correction are not compared, and Scribe’s own record of the session never comes back as one to replace', async ($, on) => {
    const set = stage(on, {
      tools: {
        recall: (args: Record<string, unknown>) =>
          answer({
            // Held once it is written: it comes back for the second decision's subject.
            facts: String(args.query ?? '').includes('Postgres')
              ? [fact(101, { content: 'Use a Redis lock for the retry queue.' })]
              : [],
          }),
      },
      replies: [
        verdict({ records: [decision({ content: 'Use a Redis lock for the retry queue.', anchors: [] })] }),
        verdict({
          records: [
            { kind: 'correction', content: 'Never page with a cursor here.', anchors: [] },
            decision({ content: 'Use a Postgres lock for the retry queue.', anchors: [] }),
          ],
        }),
      ],
      relate: () => JSON.stringify({ relation: 'contradicts', id: idOf(101) }),
    })

    await $.session.start(START)
    await turn($, set, dev(`lock the queue with redis ${TALK}`), claude('Done.'))
    await turn($, set, dev(`no, postgres ${TALK}`), claude('Done.'))

    expect(set.related, 'the only record on the subject is its own').toEqual([])
    expect(set.of('remember').length).toBe(3)
  })
})

describe('a decision recorded before its code exists gets its places later', () => {
  const DESIGN = decision({ content: 'The retry queue lock is a Postgres advisory lock.', anchors: [] })
  const OWN = idOf(101)
  const later = (paths: string[], id = OWN) => JSON.stringify({ outcome: 'act', records: [], anchor: [{ id, paths }] })

  test('files a later turn touched are added to Scribe’s own record as anchors, with nothing shown for it', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [DESIGN] }), later(['src/queue/lock.ts'])] })

    await $.session.start(START)
    await turn($, set, dev(`we lock the retry queue with an advisory lock ${TALK}`), claude('Agreed.'))
    await set.clock.advance(30_000)
    await turn($, set, dev('now build it'), claude('Built.', edit('src/queue/lock.ts')))

    expect(set.asked[1]?.prompt, 'its own record is listed with its id').toMatch(
      `(id=${OWN}, no place in the code yet) The retry queue lock is a Postgres advisory lock.`,
    )
    expect(set.of('amend_memory')).toEqual([{ atom_id: OWN, op: 'fix', anchors: [{ path: 'src/queue/lock.ts' }] }])
    expect(await shown($), 'no receipt for places alone').toBe(`${QUIET} · 1 kept`)
  })

  test('the places it had are kept, and each place is added once', async ($, on) => {
    const anchored = { ...DESIGN, anchors: [{ path: 'docs/specs/queue.md' }] }
    const set = stage(on, {
      git: gitStatus([]),
      replies: [
        verdict({ records: [anchored] }),
        later(['src/queue/lock.ts', 'docs/specs/queue.md']),
        later(['src/queue/lock.ts']),
      ],
    })

    await $.session.start(START)
    await turn(
      $,
      set,
      dev('write the spec'),
      claude('Written.', use('Write', { file_path: '/work/repo/docs/specs/queue.md', content: '# Spec\n\nLock.' })),
    )
    await turn($, set, dev('now build it'), claude('Built.', edit('src/queue/lock.ts')))
    await turn($, set, dev('and once more the same file'), claude('Done.', edit('src/queue/lock.ts')))

    expect(set.of('amend_memory')).toEqual([
      { atom_id: OWN, op: 'fix', anchors: [{ path: 'docs/specs/queue.md' }, { path: 'src/queue/lock.ts' }] },
    ])
  })

  test('only its own record, only files the session touched, only in the record’s own repository', async ($, on) => {
    const theirs = fact(5, { content: 'Another record.', anchors: { paths: [{ path: 'src/queue/lock.ts' }] } })
    const set = stage(on, {
      files: { '/work/other/.git': '', '/work/other/.git/config': '[remote "origin"]\n\turl = git@github.com:acme/other.git\n' },
      tools: { recall: (args: Record<string, unknown>) => answer({ facts: Array.isArray(args.paths) ? [theirs] : [] }) },
      kept: { 'scribe.known': [idOf(5)] },
      replies: [
        verdict({ records: [DESIGN] }),
        JSON.stringify({
          outcome: 'act',
          records: [],
          anchor: [
            { id: idOf(5), paths: ['src/queue/lock.ts'] },
            { id: OWN, paths: ['src/never/opened.ts'] },
            { id: OWN, paths: ['/work/other/lib/y.ts'] },
          ],
        }),
      ],
    })

    await $.session.start(START)
    await turn($, set, dev(`we lock the retry queue with an advisory lock ${TALK}`), claude('Agreed.'))
    await turn(
      $,
      set,
      dev('now build it'),
      claude(
        'Built.',
        edit('src/queue/lock.ts'),
        use('Edit', { file_path: '/work/other/lib/y.ts', old_string: 'a', new_string: 'b' }),
      ),
    )

    expect(set.of('amend_memory')).toEqual([])
  })
})

describe('a commit is where a decision gets its place', () => {
  const DESIGN = decision({ content: 'The retry queue lock is a Postgres advisory lock.', anchors: [] })
  const OWN = idOf(101)
  const commit = (output = '[main 1a2b3c4] lock the queue\n 2 files changed') =>
    use('Bash', { command: 'git commit -m "lock the queue"' }, output)
  const pairs = (paths: string[], id = OWN) => JSON.stringify({ outcome: 'act', records: [], anchor: [{ id, paths }] })

  test('at a commit the wake is given its own records without a place and the files the commit holds, once, and what it pairs is added', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [DESIGN] }), NOTHING, pairs(['src/queue/lock.ts']), NOTHING] })

    await $.session.start(START)
    await turn($, set, dev(`we lock the retry queue with an advisory lock ${TALK}`), claude('Agreed.'))
    await turn($, set, dev('build it'), claude('Built.', edit('src/queue/lock.ts'), edit('src/queue/worker.ts')))

    expect(set.asked[1]?.prompt, 'no commit yet: nothing is asked about one').not.toMatch('A commit was made')

    await turn($, set, dev('commit it'), claude('Committed.', commit()))

    const asked = set.asked[2]?.prompt ?? ''

    expect(asked).toMatch('A commit was made in acme/web. These records of yours have no place in the code yet:')
    expect(asked).toMatch(`- (id=${OWN}) The retry queue lock is a Postgres advisory lock.`)
    expect(asked).toMatch('The files the commit holds:\n- src/queue/lock.ts\n- src/queue/worker.ts')
    expect(set.of('amend_memory')).toEqual([{ atom_id: OWN, op: 'fix', anchors: [{ path: 'src/queue/lock.ts' }] }])
    expect(set.of('attach_commit').length, 'and the commit is attached as before').toBe(1)

    await turn($, set, dev('one more change to the worker afterwards'), claude('Done.', edit('src/queue/worker.ts')))

    expect(set.asked[3]?.prompt, 'asked once per commit').not.toMatch('A commit was made')
  })

  test('files an agent of the session changed are files of the session: a record may point at them, and the agent’s commit holds them', async ($, on) => {
    let agentUses: { name: string; input: unknown }[] = []
    const set = stage(on, { replies: [verdict({ records: [DESIGN] }), pairs(['src/queue/lock.ts'])] })

    stepping(on, () => agentUses)

    await $.session.start(START)
    await turn($, set, dev(`we lock the retry queue with an advisory lock ${TALK}`), claude('Agreed, an agent will build it.'))

    agentUses = [
      { name: 'Edit', input: { file_path: '/work/repo/src/queue/lock.ts', old_string: 'SECRET-OLD', new_string: 'SECRET-NEW' } },
    ]
    await step($, 0, agentUses, 'agent-1')
    agentUses = [{ name: 'Bash', input: { command: 'git add -A && git commit -m "lock"' } }]
    await step($, 1, agentUses, 'agent-1')
    agentUses = []

    const before = set.of('recall').length

    await turn($, set, dev(`the agent is done, anything else to do here ${TALK}`), claude('It built and committed the lock.'))

    const asked = set.asked[1]?.prompt ?? ''

    expect(asked).toMatch('A commit was made in acme/web.')
    expect(asked).toMatch('The files the commit holds:\n- src/queue/lock.ts')
    expect(asked, 'the path only: nothing of what the agent wrote').not.toMatch(/SECRET-OLD|SECRET-NEW/)
    expect(set.of('amend_memory')).toEqual([{ atom_id: OWN, op: 'fix', anchors: [{ path: 'src/queue/lock.ts' }] }])
    expect(set.of('recall').slice(0, before), 'nothing is looked up in an agent’s step itself').not.toContainEqual(
      expect.objectContaining({ paths: ['src/queue/lock.ts'] }),
    )
    expect(set.of('recall').slice(before), 'the file it changed is looked up at the turn’s end').toContainEqual({
      repo: 'acme/web',
      paths: ['src/queue/lock.ts'],
    })
  })

  test('a commit with no record waiting for a place asks nothing, and a record that fits no file stays without one', async ($, on) => {
    const anchored = { ...DESIGN, anchors: [{ path: 'src/queue/lock.ts' }] }
    const set = stage(on, { replies: [verdict({ records: [anchored] }), NOTHING, verdict({ records: [DESIGN] }), NOTHING] })

    await $.session.start(START)
    await turn($, set, dev('build the lock'), claude('Built.', edit('src/queue/lock.ts')))
    await turn($, set, dev('commit it'), claude('Committed.', commit()))

    expect(set.asked[1]?.prompt).not.toMatch('A commit was made')

    await turn($, set, dev(`and a second decision in talk only ${TALK}`), claude('Agreed.'))
    await turn(
      $,
      set,
      dev('change the worker and commit'),
      claude('Done.', edit('src/queue/worker.ts'), commit('[main 2b3c4d5] worker')),
    )

    expect(set.asked[3]?.prompt, 'the model is asked, and may pair nothing').toMatch('A commit was made')
    expect(set.of('amend_memory'), 'no guessing').toEqual([])
  })
})

describe('a decision written beside one it may go against says so', () => {
  test('when the question whether it replaces a recorded decision went unanswered, the receipt names the earlier record', async ($, on) => {
    const set = stage(on, { tools: holding, replies: [verdict({ records: [NEW] }), NOTHING], relate: relation('contradicts') })

    await $.session.start(START)
    await turn($, set, ...steer)

    expect(await shown($)).toMatch('This looks like it replaces a recorded decision')

    // The developer types past it; the decision is written at the next turn's end, replacing nothing.
    await turn($, set, dev(`go on with the dashboards ${TALK}`), claude('Done.', edit('src/a.ts')))

    expect(set.of('remember')[0]).toMatchObject({ content: NEW.content })
    expect(set.of('remember')[0]?.supersedes).toBeUndefined()
    expect(await shown($)).toMatch(`may contradict an earlier decision ${idOf(5).slice(0, 8)}`)
  })
})

describe('what the developer chose through a question', () => {
  const question = (n: number) => `Which way for part ${n}?`
  const asking = (count: number) => ({
    questions: Array.from({ length: count }, (_, n) => ({
      question: question(n + 1),
      options: [
        { label: `Way A${n + 1}`, description: `A${n + 1} needs no new service.` },
        { label: `Way B${n + 1}`, description: `B${n + 1} is faster to build.` },
      ],
    })),
  })
  const answered = (count: number) =>
    `Your questions have been answered: ${Array.from({ length: count }, (_, n) => `"${question(n + 1)}"="Way A${n + 1}"`).join(', ')}. You can now continue with the user's answers in mind.`
  const chosen = (n: number, more: Record<string, unknown> = {}) =>
    decision({
      content: `Part ${n} is built way A${n}, not way B${n}.`,
      alternatives: [`way B${n}`],
      anchors: [],
      from_choice: true,
      ...more,
    })
  const other = (n: number) => decision({ content: `Use helper ${n} for the build.`, anchors: [] })
  const choosing = (count: number) => [
    dev(`plan the parts ${TALK}`),
    claude('Some questions.', use('AskUserQuestion', asking(count), answered(count))),
  ]

  test('each choice gets its record beside the three a wake may write: none is dropped for the limit, and the receipt is one line', async ($, on) => {
    const records = [chosen(1), other(1), chosen(2), other(2), chosen(3), other(3), chosen(4), other(4)]
    const set = stage(on, { replies: [verdict({ records })] })

    await $.session.start(START)
    await turn($, set, ...choosing(4))

    expect(set.of('remember').map(args => args.content)).toEqual([
      'Part 1 is built way A1, not way B1.',
      'Use helper 1 for the build.',
      'Part 2 is built way A2, not way B2.',
      'Use helper 2 for the build.',
      'Part 3 is built way A3, not way B3.',
      'Use helper 3 for the build.',
      'Part 4 is built way A4, not way B4.',
    ])
    expect(await shown($)).toBe(carded('✓ Recorded 7 [1 Review] [9 What is this] [0 OK]'))
  })

  test('a record cannot claim to be a choice where the developer answered nothing, and no more choices count than were made', async ($, on) => {
    const set = stage(on, {
      replies: [
        verdict({ records: [chosen(1), chosen(2), chosen(3), chosen(4), chosen(5)] }),
        verdict({ records: [chosen(6), chosen(7), chosen(8), chosen(9)] }),
      ],
    })

    await $.session.start(START)
    await turn($, set, ...choosing(1))

    expect(set.of('remember').length, 'one choice and three others').toBe(4)

    await set.clock.advance(60_000)
    await turn($, set, dev(`and the rest, no question this time ${TALK}`), claude('Done.', edit('src/a.ts')))

    expect(set.of('remember').length, 'three more').toBe(7)
  })

  test('nobody is asked why about a choice they made themselves: without a reason it is recorded as not stated', async ($, on) => {
    const bare = chosen(1, { detail: '', reason_status: 'not_stated' })
    const set = stage(on, {
      replies: [verdict({ records: [bare], question: { form: 'reason', record: 0, options: ['Fewer moving parts'] } })],
    })

    await $.session.start(START)
    await turn($, set, ...choosing(1))

    expect(set.of('remember')[0]).toMatchObject({ reason_status: 'not_stated', alternatives: ['way B1'] })
    expect(await shown($)).not.toMatch('? Why')
  })

  test('the reason is taken from what the chosen option was said to mean, as a whole sentence', async ($, on) => {
    const bare = chosen(1, { detail: '', reason_status: 'not_stated' })
    const set = stage(on, {
      replies: [verdict({ records: [bare] })],
      verify: () => JSON.stringify({ offered: 'needs no new service' }),
    })

    await $.session.start(START)
    await turn($, set, ...choosing(1))

    expect(set.of('remember')[0], 'and it is marked as the assistant’s words, which they chose').toMatchObject({
      reason_status: 'stated',
      detail: 'A1 needs no new service. (offered by the assistant, chosen by the developer)',
    })
  })
})
