import { describe, expect, test } from 'claude-code/testing'

import { claude, decision, dev, NOTHING, REPO, ROOT, stage, START, turn, use, verdict } from './scribe-fixtures'

const origin = (name: string): string =>
  `[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:${name}.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`
const edits = (...files: string[]) =>
  claude('Done.', ...files.map(file => use('Edit', { file_path: file, old_string: 'a', new_string: 'b' })))

// A repository checked out inside the session's own tree, as a plugin's is.
const NESTED = { [`${ROOT}/plugin/.git`]: '', [`${ROOT}/plugin/.git/config`]: origin('acme/plugin') }
// A checkout beside the session's own.
const SIBLING = { '/work/other/.git': '', '/work/other/.git/config': origin('acme/other') }
// A worktree of the session's own repository: its `.git` is a file that names its folder inside that repository.
const WORKTREE = {
  '/work/wt/.git': 'gitdir: /work/repo/.git/worktrees/wt\n',
  '/work/repo/.git/worktrees/wt/commondir': '../..\n',
  '/work/repo/.git/config': origin('acme/web'),
}

describe('a record is about the repository its files lie in', () => {
  test('a file of the session’s own tree: the record is filed under the session’s repository, as ever', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [decision({ anchors: [{ path: 'src/mail/send.ts' }] })] })] })

    await $.session.start(START)
    await turn($, set, dev('make the mailer retry'), edits(`${ROOT}/src/mail/send.ts`))

    expect(set.of('remember')[0]).toMatchObject({ repo: REPO, anchors: [{ path: 'src/mail/send.ts' }] })
  })

  test('a repository checked out inside the session’s tree is its own: the record is filed under it, from its own root', async ($, on) => {
    const set = stage(on, {
      files: NESTED,
      replies: [verdict({ records: [decision({ anchors: [{ path: 'plugin/hooks/a.ts' }] })] })],
    })

    await $.session.start(START)
    await turn($, set, dev('change the plugin hook'), edits(`${ROOT}/plugin/hooks/a.ts`))

    expect(set.of('remember')[0]).toMatchObject({ repo: 'acme/plugin', anchors: [{ path: 'hooks/a.ts' }] })
    expect(
      set.of('recall').map(args => [args.repo, args.paths]),
      'and what is recorded about the file is asked of that repository',
    ).toContainEqual(['acme/plugin', ['hooks/a.ts']])
  })

  test('a worktree is the same repository with its own root', async ($, on) => {
    const set = stage(on, {
      files: WORKTREE,
      replies: [verdict({ records: [decision({ anchors: [{ path: '/work/wt/src/x.ts' }] })] })],
    })

    await $.session.start(START)
    await turn($, set, dev('do it in the worktree'), edits('/work/wt/src/x.ts'))

    expect(set.asked[0]?.prompt, 'a file outside the session’s tree is written in full for the model').toMatch(
      '/work/wt/src/x.ts',
    )
    expect(set.of('remember')[0]).toMatchObject({ repo: 'acme/web', anchors: [{ path: 'src/x.ts' }] })
  })

  test('a checkout beside the session’s own: work done there is recorded under that repository, not the session’s', async ($, on) => {
    const set = stage(on, { files: SIBLING, replies: [verdict({ records: [decision({ anchors: [] })] })] })

    await $.session.start(START)
    await turn($, set, dev('fix the other service'), edits('/work/other/lib/y.ts', '/work/other/lib/z.ts'))

    expect(set.of('remember')[0], 'with no anchor it goes where most of the turn’s files are').toMatchObject({
      repo: 'acme/other',
    })
    expect(set.of('remember')[0]?.anchors).toBeUndefined()
  })

  test('a repository without a remote is named by its folder', async ($, on) => {
    const set = stage(on, {
      files: { '/work/scratch/.git': '', '/work/scratch/.git/config': '[core]\n\tbare = false\n' },
      replies: [verdict({ records: [decision({ anchors: [{ path: '/work/scratch/a.ts' }] })] })],
    })

    await $.session.start(START)
    await turn($, set, dev('try it in scratch'), edits('/work/scratch/a.ts'))

    expect(set.of('remember')[0]).toMatchObject({ repo: 'scratch', anchors: [{ path: 'a.ts' }] })
  })

  test('a turn that spans two repositories: one record is filed under the repository most of its anchors are in, and keeps only those', async ($, on) => {
    const spanning = decision({
      anchors: [{ path: 'src/api/client.ts' }, { path: '/work/other/lib/y.ts' }, { path: '/work/other/lib/z.ts' }],
    })
    const unanchored = decision({ content: 'Keep the client and the service on one wire format.', anchors: [] })
    const set = stage(on, { files: SIBLING, replies: [verdict({ records: [spanning, unanchored] })] })

    await $.session.start(START)
    await turn(
      $,
      set,
      dev('change both sides'),
      edits(`${ROOT}/src/api/client.ts`, '/work/other/lib/y.ts', '/work/other/lib/z.ts'),
    )

    const [first, second] = set.of('remember')

    expect(first).toMatchObject({ repo: 'acme/other', anchors: [{ path: 'lib/y.ts' }, { path: 'lib/z.ts' }] })
    expect(second, 'one with no anchor goes where most of the turn’s files are').toMatchObject({ repo: 'acme/other' })
  })

  test('files of two repositories in equal number: the session’s own repository takes a record without anchors', async ($, on) => {
    const set = stage(on, { files: SIBLING, replies: [verdict({ records: [decision({ anchors: [] })] })] })

    await $.session.start(START)
    await turn($, set, dev('change both sides'), edits(`${ROOT}/src/api/client.ts`, '/work/other/lib/y.ts'))

    expect(set.of('remember')[0]).toMatchObject({ repo: REPO })
  })

  test('a turn that touched no file is about the repository the session has been working in: most of its files so far, or its own', async ($, on) => {
    const set = stage(on, {
      files: SIBLING,
      replies: [
        verdict({ records: [decision({ anchors: [] })] }),
        NOTHING,
        verdict({ records: [decision({ content: 'The other service is restarted by hand after a deploy.', anchors: [] })] }),
      ],
    })
    const talk = 'x'.repeat(260)

    await $.session.start(START)
    await turn(
      $,
      set,
      dev(`the developer steers, an agent does the work ${talk}`),
      claude('Agreed.', use('Agent', { prompt: 'do it' })),
    )

    expect(set.of('remember')[0], 'nothing touched yet: the session’s own repository').toMatchObject({ repo: REPO })

    await turn(
      $,
      set,
      dev('now the other service'),
      edits('/work/other/lib/y.ts', '/work/other/lib/z.ts', '/work/other/lib/w.ts'),
    )
    await turn(
      $,
      set,
      dev(`and how it is restarted ${talk}`),
      claude('Noted.', use('Bash', { command: 'ssh box systemctl restart other' })),
    )

    expect(set.of('remember')[1], 'most of the session’s files lie in the other one by now').toMatchObject({ repo: 'acme/other' })
  })

  test('a session with no repository of its own: a turn without a file is about the repository it looked into before', async ($, on) => {
    const set = stage(on, {
      repo: null,
      cwdNow: () => '/work',
      files: SIBLING,
      replies: [NOTHING, verdict({ records: [decision({ anchors: [] })] })],
    })
    const talk = 'x'.repeat(260)

    await $.session.start({ ...START, cwd: '/work' })
    await turn($, set, dev('look at the other service'), edits('/work/other/lib/y.ts'))
    await turn(
      $,
      set,
      dev(`deploy it on the other box ${talk}`),
      claude('Deployed.', use('Bash', { command: 'ssh box systemctl restart app' })),
    )

    expect(set.of('remember').map(args => args.repo)).toEqual(['acme/other'])
  })

  test('with no repository of its own and no file of one in the whole conversation, nothing is recorded, and the debug log says so once', async ($, on) => {
    const set = stage(on, {
      repo: null,
      cwdNow: () => '/work',
      files: SIBLING,
      replies: [NOTHING, verdict({ records: [decision({ anchors: [] })] })],
    })
    const talk = 'x'.repeat(260)

    await $.session.start({ ...START, cwd: '/work' })
    await turn($, set, dev('look at the other service'), edits('/work/other/lib/y.ts'))
    await $.classic.SessionStart({ source: 'clear' })
    set.rows.length = 0
    await turn(
      $,
      set,
      dev(`deploy it on the other box ${talk}`),
      claude('Deployed.', use('Bash', { command: 'ssh box systemctl restart app' })),
    )

    expect(set.of('remember'), 'the cleared conversation has touched nothing').toEqual([])
    expect(set.logged).toContain('Scribe: a record was not written because the session has touched no file of any repository')
  })

  test('a file in no repository is no anchor, and does not decide where a record goes', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [decision({ anchors: [{ path: '/etc/app/app.conf' }, { path: 'src/a.ts' }] })] })],
    })

    await $.session.start(START)
    await turn($, set, dev('wire the config'), edits('/etc/app/app.conf', '/etc/app/other.conf', `${ROOT}/src/a.ts`))

    expect(set.of('remember')[0]).toMatchObject({ repo: REPO, anchors: [{ path: 'src/a.ts' }] })
  })

  test('a session started in a folder that is no repository follows the work into the repository its files lie in', async ($, on) => {
    const set = stage(on, {
      repo: null,
      cwdNow: () => '/work',
      files: { [`${ROOT}/.git/config`]: origin('acme/web'), ...SIBLING },
      replies: [verdict({ records: [decision({ anchors: [{ path: 'other/lib/y.ts' }] })] })],
    })

    await $.session.start({ ...START, cwd: '/work' })
    await turn($, set, dev('fix the other service from up here'), edits('/work/other/lib/y.ts'))

    expect(set.asked[0]?.prompt).toMatch("The session's repository: none")
    expect(set.of('remember')[0]).toMatchObject({ repo: 'acme/other', anchors: [{ path: 'lib/y.ts' }] })
    expect(set.of('attach_commit'), 'a session with no repository of its own attaches no commit').toEqual([])
  })

  describe('a session started in a folder that is no repository', () => {
    const DECLARED = JSON.stringify({ mcpServers: { fylgja: { type: 'http', url: 'https://fylgja.lknblab.dev/mcp' } } })
    const theirs = JSON.stringify({
      mcpServers: {
        kb: { type: 'http', url: 'https://fylgja.lknblab.dev/mcp', headers: { Authorization: 'Bearer somebody-else' } },
      },
    })
    const outside = { repo: null, cwdNow: () => '/work', declared: DECLARED } as const
    const begin = { ...START, cwd: '/work' }

    test('who is signed in is asked and pinned all the same: that does not wait for a repository', async ($, on) => {
      const set = stage(on, { ...outside, files: SIBLING })

      await $.session.start(begin)

      expect(set.whoamis.length).toBe(1)
      expect(set.kept.get('fylgja.account')).toBeDefined()
    })

    test('an entry in the start folder’s own `.mcp.json` that could stand in for the plugin’s server keeps the whole plugin out', async ($, on) => {
      const set = stage(on, {
        ...outside,
        files: { ...SIBLING, '/work/.mcp.json': theirs },
        replies: [verdict({ records: [decision({ anchors: [] })] })],
      })

      await $.session.start(begin)
      await turn($, set, dev('fix the other service from up here'), edits('/work/other/lib/y.ts'))

      expect([set.calls, set.asked], 'no call to Fylgja and no model call').toEqual([[], []])
      expect(set.statuses.filter(line => line !== undefined).length, 'and one line says why').toBe(1)
    })

    test('a repository the session works in is looked at before anything about it is sent: one whose own `.mcp.json` holds such an entry is left alone', async ($, on) => {
      const set = stage(on, {
        ...outside,
        files: { ...SIBLING, [`${ROOT}/.git/config`]: origin('acme/web'), '/work/other/.mcp.json': theirs },
        replies: [verdict({ records: [decision({ anchors: [{ path: 'other/lib/y.ts' }, { path: 'repo/src/a.ts' }] })] })],
      })

      await $.session.start(begin)
      await turn($, set, dev('change both from up here'), edits('/work/other/lib/y.ts', `${ROOT}/src/a.ts`))

      expect(set.reads, 'its `.mcp.json` was read').toContain('/work/other/.mcp.json')
      expect(
        set.of('recall').map(args => args.repo),
        'nothing is asked about it',
      ).not.toContain('acme/other')
      expect(
        set.of('remember').map(args => [args.repo, args.anchors]),
        'and the record is filed with the files of the other repository alone',
      ).toEqual([['acme/web', [{ path: 'src/a.ts' }]]])
    })

    test('a turn that touched only a repository that is left alone records nothing', async ($, on) => {
      const set = stage(on, {
        ...outside,
        files: { ...SIBLING, '/work/other/.mcp.json': '{ not json' },
        replies: [verdict({ records: [decision({ anchors: [] })] })],
      })

      await $.session.start(begin)
      await turn($, set, dev('fix the other service from up here'), edits('/work/other/lib/y.ts'))

      expect(set.calls, 'a file that cannot be read as configuration counts as hostile').toEqual([])
      expect(set.asked).toEqual([])
    })
  })

  test('which repository a folder lies in is asked of the machine once', async ($, on) => {
    const set = stage(on, { files: NESTED })

    await $.session.start(START)
    await turn($, set, dev('change the plugin hook'), edits(`${ROOT}/plugin/hooks/a.ts`))
    await turn(
      $,
      set,
      dev('and again, the same file and its neighbour'),
      edits(`${ROOT}/plugin/hooks/a.ts`, `${ROOT}/plugin/hooks/b.ts`),
    )

    expect(set.reads.filter(path => path === `${ROOT}/plugin/.git/config`).length).toBe(1)
  })
})
