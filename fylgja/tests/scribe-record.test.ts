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
  REPO,
  ROOT,
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
    await turn($, set, ...TALK, claude('And the helper.', edit('src/kept.ts')))

    expect(set.of('remember').map(args => args.anchors)).toEqual([[{ path: 'src/kept.ts' }]])
  })

  test('a sentence far too long to be one is not sent at all, never cut short', async ($, on) => {
    const long = `Use ${'a very '.repeat(200)}long sentence.`
    const set = stage(on, {
      replies: [verdict({ records: [decision({ content: long }), decision({ content: 'Use the short one.' })] })],
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember').map(args => args.content)).toEqual(['Use the short one.'])
    expect(set.asked.length).toBe(1)
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

  test('an anchor the session never touched is left off: a record points only at files that were opened', async ($, on) => {
    const anchors = [{ path: 'src/queue/lock.ts' }, { path: 'src/never/opened.ts' }, { path: 'src/queue' }]
    const set = stage(on, {
      replies: [
        verdict({ records: [decision({ anchors }), decision({ content: 'Use B.', anchors: [{ path: 'src/other.ts' }] })] }),
      ],
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember').map(args => [args.content, args.anchors])).toEqual([
      ['Use Postgres advisory locks for the job queue, not Redis.', [{ path: 'src/queue/lock.ts' }]],
      // Every anchor fell away; the record is still written.
      ['Use B.', undefined],
    ])
  })

  test('a record that names a gotcha, or an id found only in a lookup’s text, as the one it replaces is written without it', async ($, on) => {
    const set = stage(on, {
      replies: [
        JSON.stringify({ tool: 'search', args: { query: 'queue lock' } }),
        verdict({
          records: [decision({ content: 'Use A.', supersedes: idOf(5) }), decision({ content: 'Use B.', supersedes: idOf(6) })],
        }),
      ],
      tools: {
        recall: () => answer({ facts: [fact(5, { type: 'gotcha', anchors: [{ path: 'src/queue/lock.ts' }] })] }),
        search: () => ({ content: [{ type: 'text', text: `Some meeting mentioned ${idOf(6)} in passing.` }], isError: false }),
      },
      kept: { 'scribe.known': [idOf(5)] },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember').map(args => args.supersedes)).toEqual([undefined, undefined])
    expect(await shown($)).toMatch('✓ Recorded 2')
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

    await turn(
      $,
      set,
      dev('and now the retry policy'),
      claude('Three tries, then the dead letter queue.', edit('src/queue/retry.ts')),
    )

    expect(set.asked.length).toBe(2)
  })

  test('Remove takes the record away again', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [decision()] })] })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await press($, 'remove:0')

    expect(set.of('amend_memory'), 'one press removes nothing').toEqual([])
    expect(await shown($)).toMatch('[1 Fix] [2 Press again to remove]')

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
      '✓ Recorded 3Use A. · src/queue/lock.ts [1 Fix] [2 Remove]Use B. · src/queue/lock.ts [3 Fix] [4 Remove]Use C. · src/queue/lock.ts [5 Fix] [6 Remove]Recorded to Acme as Ada Lovelace, profile Work [0 Close]',
    )

    await ui.press('remove:1')
    await ui.press('remove:1')
    await ui.redraw()

    expect(set.of('amend_memory')).toEqual([{ atom_id: idOf(102), op: 'remove' }])
    expect(await ui.text()).toBe(
      '✓ Recorded 2Use A. · src/queue/lock.ts [1 Fix] [2 Remove]Use C. · src/queue/lock.ts [3 Fix] [4 Remove]Recorded to Acme as Ada Lovelace, profile Work [0 Close]',
    )
  })

  test('a gotcha is written with the words a later command would hold, and no reason status', async ($, on) => {
    const gotcha = {
      kind: 'gotcha',
      content: 'Run migrations with the admin role, the app role cannot create extensions.',
      detail: 'alembic upgrade failed with permission denied for extension pgcrypto.',
      triggers: ['alembic upgrade', 'permission denied for extension'],
      reason_status: 'stated',
      alternatives: ['ignored on a gotcha'],
      anchors: [{ path: 'src/queue/lock.ts' }],
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

  const committed = (command: string, text: string, isError = false) =>
    claude(
      'Committed.',
      isError ? { tool: 'Bash', input: { command }, text, isError: true } : { tool: 'Bash', input: { command }, text },
    )

  test('a commit made in the turn is attached to what the session recorded, by the sha the commit printed, once', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [decision()] })] })

    await $.session.start(START)
    await turn(
      $,
      set,
      ...TALK,
      committed('git add -A && git commit -m "queue lock"', '[main 1a2b3c4] queue lock\n 1 file changed'),
    )

    const tools = set.calls.map(call => call.tool)

    expect(set.of('attach_commit')).toEqual([{ repo: REPO, sha: '1a2b3c4', session_id: SESSION_ID }])
    expect(tools.indexOf('attach_commit') > tools.indexOf('remember'), 'after the record').toBe(true)

    await turn($, set, dev('thanks'), claude('Welcome.'))

    expect(set.of('attach_commit').length, 'once').toBe(1)
  })

  test('a commit is attached whether or not Scribe recorded anything: the session’s other records are Fylgja’s to find', async ($, on) => {
    const set = stage(on, { replies: [NOTHING] })

    await $.session.start(START)
    await turn($, set, dev('commit it'), committed('git commit -am chore', '[main 0a1b2c3] chore'))

    expect(set.of('remember')).toEqual([])
    expect(set.of('attach_commit')).toEqual([{ repo: REPO, sha: '0a1b2c3', session_id: SESSION_ID }])
  })

  test('a commit is attached while a question waits, and when a later command of the same call failed', async ($, on) => {
    const asking = verdict({
      records: [decision({ detail: '', reason_status: 'not_stated' })],
      question: { form: 'reason', record: 0, options: ['a', 'b'] },
    })
    const set = stage(on, { replies: [asking] })

    await $.session.start(START)
    await turn(
      $,
      set,
      ...TALK,
      committed('git commit -m x && npm run deploy', '[main 5e5e5e5] x\nnpm ERR! missing script: deploy', true),
    )

    expect(await shown($)).toMatch('? Why')
    expect(set.of('attach_commit').map(args => args.sha)).toEqual(['5e5e5e5'])
  })

  for (const [what, command, text] of [
    ['that failed', 'git commit -m "queue lock"', 'pre-commit hook failed: lint errors'],
    ['with nothing to commit', 'git commit -m x', 'nothing to commit, working tree clean'],
    ['in another repository by -C', 'git -C /work/other commit -m x', '[main 9f9f9f9] x'],
    ['in another repository by cd', 'cd /work/other && git commit -m x', '[main 9f9f9f9] x'],
    ['in a folder of the tree, which may be a repository of its own', 'cd vendor/lib && git commit -m x', '[main 9f9f9f9] x'],
    ['in a place the command does not say', 'cd "$OTHER" && git commit -m x', '[main 9f9f9f9] x'],
    ['with another git directory', 'git --git-dir=/work/other/.git commit -m x', '[main 9f9f9f9] x'],
  ] as const) {
    test(`a commit ${what} is attached to nothing`, async ($, on) => {
      const set = stage(on, { replies: [verdict({ records: [decision()] })] })

      await $.session.start(START)
      await turn($, set, ...TALK, committed(command, text))

      expect(set.of('attach_commit')).toEqual([])
    })
  }

  test('a commit in this repository named by its own path is attached', async ($, on) => {
    const set = stage(on)

    await $.session.start(START)
    await turn($, set, dev('commit it'), committed(`cd ${ROOT} && git -C ${ROOT} commit -m x`, '[main 7a7a7a7] x'))

    expect(set.of('attach_commit').map(args => args.sha)).toEqual(['7a7a7a7'])
  })

  test('a record that had been removed and is written again is shown as restored, and can be removed again', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [decision()] })],
      tools: { remember: () => answer({ atom_id: idOf(9), outcome: 'restored', supersede: 'not_requested' }) },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(await shown($)).toBe(
      '✓ Restored · Use Postgres advisory locks for the job queue, not Redis. [1 Fix] [2 Remove] [9 What is this] [0 OK]',
    )

    await pressTwice($, 'remove:0')

    expect(set.of('amend_memory')).toEqual([{ atom_id: idOf(9), op: 'remove' }])
  })

  test('a repository Fylgja knows under another spelling is not switched to: it is noted in the debug log, by count alone', async ($, on) => {
    const set = stage(on, {
      tools: {
        recall: () => answer({ repo: REPO, facts: [], known_repos: ['acme-corp/web'], hint: 'retry with acme-corp/web' }),
      },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await turn($, set, dev('and the retry policy'), claude('Done.', edit('src/queue/retry.ts')))

    expect(set.logged).toEqual(["Fylgja holds nothing under this repository's name and offers 1 it knows"])
    expect(set.of('recall').every(args => args.repo === REPO)).toBe(true)
  })

  test('records written after the conversation started over carry the session’s id as it is then', async ($, on) => {
    let id = 'aaaaaaaa-0000-4000-8000-000000000001'
    const set = stage(on, {
      replies: [verdict({ records: [decision()] }), verdict({ records: [decision({ content: 'Use B.' })] })],
      sessionId: () => id,
    })

    await $.session.start(START)
    await turn($, set, ...TALK)
    id = 'bbbbbbbb-0000-4000-8000-000000000002'
    await $.classic.SessionStart({ source: 'clear' })
    set.rows.length = 0
    await turn($, set, ...TALK)

    expect(set.of('remember').map(args => args.session_id)).toEqual([
      'aaaaaaaa-0000-4000-8000-000000000001',
      'bbbbbbbb-0000-4000-8000-000000000002',
    ])
  })
})
