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
  REPO,
  SESSION_ID,
  shown,
  stage,
  START,
  turn,
  verdict,
} from './scribe-fixtures'

const TALK = [
  dev('Redis or Postgres for the queue lock? Postgres: one less service, and the jobs table is there already.'),
  claude('Done, advisory locks in src/queue/lock.ts.', edit('src/queue/lock.ts')),
]

describe('Scribe records', () => {
  test('a choice between two options with its reason is written once, with where and why, and a receipt shows', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [decision()] })] })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember')).toEqual([
      {
        content: 'Use Postgres advisory locks for the job queue, not Redis.',
        repo: REPO,
        kind: 'decision',
        author: 'scribe',
        session_id: SESSION_ID,
        detail: 'One less service to run, and the jobs table is already in Postgres.',
        anchors: [{ path: 'src/queue/lock.ts', symbol: 'acquire' }],
        alternatives: ['Redis with Redlock'],
        reason_status: 'stated',
      },
    ])
    expect(await shown($)).toBe(
      '✓ Recorded · Use Postgres advisory locks for the job queue, not Redis. [1 Fix] [2 Remove] [9 What is this] [0 OK]',
    )
    expect(set.asked[0]?.model).toBe('sonnet')
    expect(set.asked[0]?.effort).toBe('low')
  })

  test('the model named in the plugin’s options is the one asked', { options: { scribeModel: 'haiku' } }, async ($, on) => {
    const set = stage(on)

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.asked.map(asked => asked.model)).toEqual(['haiku'])
  })

  test('a verdict of nothing writes nothing and draws nothing', async ($, on) => {
    const set = stage(on, { replies: [NOTHING] })

    await $.session.start(START)
    await turn($, set, dev('rename the helper'), claude('Renamed.', edit('src/a.ts')))

    expect(set.asked.length).toBe(1)
    expect(set.of('remember')).toEqual([])
    expect(await shown($)).toBe('engine: AbovePrompt')
  })

  test('an anchor outside the tree, absolute or climbing out is left off, and the record is still written', async ($, on) => {
    const anchors = [
      { path: '/etc/passwd' },
      { path: '/work/repo/src/abs.ts' },
      { path: '../other/x.ts' },
      { path: 'src/../../x.ts' },
      { path: 'src\\win.ts' },
      { path: 'src/dir/' },
      { path: 'src/kept.ts' },
    ]
    const set = stage(on, { replies: [verdict({ records: [decision({ anchors })] })] })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember').map(args => args.anchors)).toEqual([[{ path: 'src/kept.ts' }]])
  })

  test('a record whose sentence is too long is not written at all, never cut short', async ($, on) => {
    const long = `Use ${'a very '.repeat(40)}long sentence.`
    const set = stage(on, {
      replies: [verdict({ records: [decision({ content: long }), decision({ content: 'Use the short one.' })] })],
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember').map(args => args.content)).toEqual(['Use the short one.'])
  })

  test('a record that names one it replaces by an id no lookup returned is written without it', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [decision({ supersedes: idOf(77) })] })],
      tools: { recall: () => answer({ facts: [fact(5, { anchors: [{ path: 'src/queue/lock.ts' }] })] }) },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember')[0]?.supersedes).toBeUndefined()
  })

  test('a record that names one the path lookup returned keeps it', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [decision({ supersedes: idOf(5) })] })],
      tools: { recall: () => answer({ facts: [fact(5, { anchors: [{ path: 'src/queue/lock.ts' }] })] }) },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember')[0]?.supersedes).toBe(idOf(5))
  })

  test('a write Fylgja refuses shows no receipt and no error, and the next turn is read as ever', async ($, on) => {
    let refusals = 0
    const set = stage(on, {
      replies: [verdict({ records: [decision()] })],
      tools: {
        remember: () => {
          refusals += 1

          return { content: [{ type: 'text', text: 'refused:shape — content must start with an instruction' }], isError: true }
        },
      },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(refusals, 'not tried again').toBe(1)
    expect(await shown($)).toBe('engine: AbovePrompt')
    expect(set.toasts).toEqual([])

    await turn($, set, dev('and now the retry policy'), claude('Three tries, then the dead letter queue.'))

    expect(set.asked.length).toBe(2)
  })

  test('Remove takes the record away again', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [decision()] })] })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await press($, 'remove:0')

    expect(set.of('amend_memory')).toEqual([{ atom_id: idOf(101), op: 'remove' }])
    expect(await shown($)).toBe('engine: AbovePrompt')
  })

  test('Fix opens the sentence in a field and saves what is entered', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [decision()] })] })

    await $.session.start(START)
    await turn($, set, ...TALK)

    const ui = await band($)

    await ui.press('fix:0')
    await ui.redraw()

    expect(await ui.text()).toBe(' [Fix]<Use Postgres advisory locks for the job queue, not Redis.> [0 Cancel]')

    await ui.enter('fix-text', `Use ${'x'.repeat(230)}`)

    expect(set.toasts, 'too long a sentence is not saved').toEqual(['One sentence of at most 220 characters.'])
    expect(set.of('amend_memory')).toEqual([])

    await ui.enter('fix-text', 'Use Postgres advisory locks for the job queue.')
    await ui.redraw()

    expect(await ui.text()).toMatch('✓ Recorded · Use Postgres advisory locks for the job queue. ')

    expect(set.of('amend_memory')[0]).toEqual({
      atom_id: idOf(101),
      op: 'fix',
      content: 'Use Postgres advisory locks for the job queue.',
    })
  })

  test('a receipt nobody touches goes after twenty seconds', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [decision()] })] })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await set.clock.advance(19_999)

    expect(await shown($)).toMatch('✓ Recorded')

    await set.clock.advance(1)

    expect(await shown($)).toBe('engine: AbovePrompt')
    expect(set.of('amend_memory')).toEqual([])
  })

  test('a receipt goes with the next prompt sent', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [decision()] })] })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await $.prompt.submit({ text: 'next thing', wait: false, origin: { kind: 'composer' } })

    expect(await shown($)).toBe('engine: AbovePrompt')
  })

  for (const outcome of ['duplicate', 'reconfirmed']) {
    test(`a record Fylgja already holds (${outcome}) shows no receipt`, async ($, on) => {
      const set = stage(on, {
        replies: [verdict({ records: [decision()] })],
        tools: { remember: () => answer({ atom_id: idOf(9), outcome, supersede: 'not_requested' }) },
      })

      await $.session.start(START)
      await turn($, set, ...TALK)

      expect(set.of('remember').length).toBe(1)
      expect(await shown($)).toBe('engine: AbovePrompt')
    })
  }

  test('several records from one turn are one line, opened to fix or remove each', async ($, on) => {
    const set = stage(on, {
      replies: [
        verdict({
          records: [
            decision({ content: 'Use A.' }),
            decision({ content: 'Use B.' }),
            decision({ content: 'Use C.' }),
            decision({ content: 'Use D.' }),
          ],
        }),
      ],
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember').length, 'never more than three from one turn').toBe(3)

    const ui = await band($)

    expect(await ui.text()).toBe('✓ Recorded 3 [1 Review] [9 What is this] [0 OK]')

    await ui.press('review')
    await ui.redraw()

    expect(await ui.text()).toBe(
      '✓ Recorded 3Use A. [1 Fix] [2 Remove]Use B. [3 Fix] [4 Remove]Use C. [5 Fix] [6 Remove] [0 Close]',
    )

    await ui.press('remove:1')
    await ui.redraw()

    expect(set.of('amend_memory')).toEqual([{ atom_id: idOf(102), op: 'remove' }])
    expect(await ui.text()).toBe('✓ Recorded 2Use A. [1 Fix] [2 Remove]Use C. [3 Fix] [4 Remove] [0 Close]')
  })

  test('a gotcha is written with the words a later command would hold, and no reason status', async ($, on) => {
    const gotcha = {
      kind: 'gotcha',
      content: 'Run migrations with the admin role, the app role cannot create extensions.',
      detail: 'alembic upgrade failed with permission denied for extension pgcrypto.',
      triggers: ['alembic upgrade', 'permission denied for extension'],
      reason_status: 'stated',
      alternatives: ['ignored on a gotcha'],
      anchors: [{ path: 'migrations/env.py' }],
    }
    const set = stage(on, { replies: [verdict({ records: [gotcha] })] })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember')).toEqual([
      {
        content: gotcha.content,
        repo: REPO,
        kind: 'gotcha',
        author: 'scribe',
        session_id: SESSION_ID,
        detail: gotcha.detail,
        anchors: gotcha.anchors,
        triggers: gotcha.triggers,
      },
    ])
  })

  test('a commit made in the turn is attached to what the session recorded, by the sha the commit printed', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [decision()] })] })

    await $.session.start(START)
    await turn(
      $,
      set,
      ...TALK,
      claude('Committed.', {
        tool: 'Bash',
        input: { command: 'git add -A && git commit -m "queue lock"' },
        text: '[main 1a2b3c4] queue lock\n 1 file changed, 12 insertions(+)',
      }),
    )

    expect(set.of('attach_commit')).toEqual([{ repo: REPO, sha: '1a2b3c4', session_id: SESSION_ID }])

    await turn($, set, dev('thanks'), claude('Welcome.'))

    expect(set.of('attach_commit').length, 'once').toBe(1)
  })

  test('a commit that failed is attached to nothing', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [decision()] })] })

    await $.session.start(START)
    await turn(
      $,
      set,
      ...TALK,
      claude('The hook refused it.', {
        tool: 'Bash',
        input: { command: 'git commit -m "queue lock"' },
        text: 'pre-commit hook failed\n[main 9f9f9f9] not really',
        isError: true,
      }),
    )

    expect(set.of('attach_commit')).toEqual([])
  })
})
