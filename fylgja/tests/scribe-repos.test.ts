import { describe, expect, test } from 'claude-code/testing'

import { claude, decision, dev, REPO, ROOT, shown, stage, START, turn, use, verdict } from './scribe-fixtures'

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

  test('a turn that touched no file of any repository records nothing, and says so once in the debug log', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [decision({ anchors: [] })] }), verdict({ records: [decision({ anchors: [] })] })],
    })
    const talk = 'x'.repeat(260)

    await $.session.start(START)
    await turn(
      $,
      set,
      dev(`deploy it on the other box ${talk}`),
      claude('Deployed.', use('Bash', { command: 'ssh box systemctl restart app' })),
    )
    await turn($, set, dev(`and the file outside every repository ${talk}`), edits('/etc/app/app.conf'))

    expect(set.asked.length, 'the turns were looked at').toBe(2)
    expect(set.of('remember')).toEqual([])
    expect(set.logged).toEqual(['Scribe: a record was not written because the turn touched no file of any repository'])
    expect(await shown($)).toBe('engine: AbovePrompt')
  })

  test('a file in no repository is no anchor, and does not decide where a record goes', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [decision({ anchors: [{ path: '/etc/app/app.conf' }, { path: 'src/a.ts' }] })] })],
    })

    await $.session.start(START)
    await turn($, set, dev('wire the config'), edits('/etc/app/app.conf', '/etc/app/other.conf', `${ROOT}/src/a.ts`))

    expect(set.of('remember')[0]).toMatchObject({ repo: REPO, anchors: [{ path: 'src/a.ts' }] })
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
