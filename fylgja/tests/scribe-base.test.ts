import { describe, expect, test } from 'claude-code/testing'

import { GIT_TIMEOUT_MS } from '../hooks/scribe/git'
import { answer } from './fixtures'
import { claude, decision, dev, edit, REPO, ROOT, stage, START, turn, use, verdict } from './scribe-fixtures'
import type { StageOptions } from './scribe-fixtures'

const SHA = '4d9da09a1b2c3d4e5f60718293a4b5c6d7e8f901'
const FILE = 'src/queue/lock.ts'
const TALK = [
  dev('Redis or Postgres for the queue lock? Postgres: one less service, and the jobs table is there already.'),
  claude('Done, advisory locks in src/queue/lock.ts.', edit(FILE)),
]

/** A git that is at `SHA` and prints `status` for the files asked about. */
const gitAt =
  (status = '', head = `${SHA}\n`): NonNullable<StageOptions['git']> =>
  args =>
    args[0] === 'rev-parse' ? { exitCode: 0, stdout: head } : { exitCode: 0, stdout: status }

const sentOf = (set: ReturnType<typeof stage>): unknown[][] =>
  set.of('remember').map(args => [args.base_sha, args.base_dirty])

/** The commands that read the commit; the status that asks which files git ignores is the anchors' own (`anchoring.ts`). */
const commitRuns = (set: { runs: (readonly string[])[] }) => set.runs.filter(argv => !argv.includes('--ignored=traditional'))

describe('the commit a decision was written at', () => {
  test('a decision about files goes with the commit the tree is at, and says its files were clean', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [decision()] })], git: gitAt() })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember')[0]).toMatchObject({ repo: REPO, anchors: [{ path: FILE }], base_sha: SHA, base_dirty: false })
    const git = ['git', '--no-optional-locks', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-C', ROOT]
    expect(commitRuns(set), 'git is asked in the tree the files lie in, and is told not to lock or monitor anything').toEqual([
      [...git, 'rev-parse', '--verify', '--quiet', 'HEAD'],
      [...git, 'status', '--porcelain', '--untracked-files=all', '--', FILE],
    ])
  })

  test('a file changed or new and not committed says the files were not clean', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [decision(), decision({ content: 'Use B.' })] })],
      git: gitAt(` M ${FILE}\n`),
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(sentOf(set)).toEqual([
      [SHA, true],
      [SHA, true],
    ])
  })

  test('nothing is sent of it when git does not start, has no commit, or prints anything but a whole sha', async ($, on) => {
    // git that does not start; a tree with no commit yet; a repository of sha-256 commits, which the server does not take.
    const heads = ['', 'HEAD\n', `${SHA}${SHA.slice(0, 24)}`]
    let at = -1
    const set = stage(on, {
      replies: [verdict({ records: heads.map((_, n) => decision({ content: `Use option ${n}.` })) })],
      git: args => {
        if (args[0] === 'rev-parse') {
          at += 1

          return at === 0 ? undefined : { exitCode: at === 1 ? 128 : 0, stdout: heads[at] ?? '' }
        }

        return { exitCode: 0, stdout: '' }
      },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(sentOf(set)).toEqual(heads.map(() => [undefined, undefined]))
    expect(set.of('remember').length, 'and every decision is written all the same').toBe(heads.length)
  })

  test('a status git cannot give leaves out only whether the files were clean', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [decision()] })],
      git: args => (args[0] === 'rev-parse' ? { exitCode: 0, stdout: SHA } : { exitCode: 128, stdout: '' }),
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(sentOf(set)).toEqual([[SHA, undefined]])
    expect('base_dirty' in (set.of('remember')[0] ?? {})).toBe(false)
  })

  test('a git that does not answer is not waited for: the decision is written without it', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [decision()] })],
      // It never answers; the clock moves on once it was asked.
      git: (args, root, clock) => {
        void Promise.resolve().then(() => clock.advance(GIT_TIMEOUT_MS + 10))

        return new Promise<never>(() => undefined)
      },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(sentOf(set)).toEqual([[undefined, undefined]])
  })

  test('a record that is no decision, or a decision about no file, runs no git for the commit', async ($, on) => {
    const set = stage(on, {
      replies: [
        verdict({
          records: [
            decision({ content: 'Use C.', anchors: [] }),
            { kind: 'gotcha', content: 'Run the migration before the worker starts.', detail: 'It fails otherwise.', triggers: ['alembic upgrade'], anchors: [{ path: FILE }] },
          ],
        }),
      ],
      git: gitAt(),
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember').length).toBeGreaterThan(0)
    expect(sentOf(set).every(([sha]) => sha === undefined)).toBe(true)
    expect(commitRuns(set)).toEqual([])
  })

  test('a decision about a worktree’s files is read in that worktree, not in the session’s own tree', async ($, on) => {
    const set = stage(on, {
      files: {
        '/work/wt/.git': 'gitdir: /work/repo/.git/worktrees/wt\n',
        '/work/repo/.git/worktrees/wt/commondir': '../..\n',
        '/work/repo/.git/worktrees/wt/gitdir': '/work/wt/.git\n',
        '/work/repo/.git/config': '[remote "origin"]\n\turl = git@github.com:acme/web.git\n',
      },
      replies: [verdict({ records: [decision({ anchors: [{ path: '/work/wt/src/x.ts' }] })] })],
      git: gitAt(),
    })

    await $.session.start(START)
    await turn($, set, dev('do it in the worktree'), claude('Done.', use('Edit', { file_path: '/work/wt/src/x.ts', old_string: 'a', new_string: 'b' })))

    expect(set.of('remember')[0]).toMatchObject({ repo: REPO, anchors: [{ path: 'src/x.ts' }], base_sha: SHA })
    expect(commitRuns(set).map(argv => argv[argv.indexOf('-C') + 1])).toEqual(['/work/wt', '/work/wt'])
  })

  test('a server that does not take the commit gets the decision without it, and is not sent it again this session', async ($, on) => {
    const untaken = {
      content: [
        {
          type: 'text',
          text: 'remember was called with invalid arguments — an argument this tool does not take (it takes: alternatives, anchors, author, content, cwd, detail, hostname, kind, reason_status, recalled_atom_id, repo, scope, session_id, supersedes, triggers, volatility)',
        },
      ],
      isError: true,
    }
    let written = 0
    const set = stage(on, {
      replies: [verdict({ records: [decision()] }), verdict({ records: [decision({ content: 'Use B.' })] })],
      tools: {
        remember: args => {
          if ('base_sha' in args) {
            return untaken
          }

          written += 1

          return answer({ atom_id: `00000000-0000-4000-8000-00000000020${written}`, outcome: 'created' })
        },
      },
      git: gitAt(),
    })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await turn($, set, dev('and the retry?'), claude('Done.', edit(FILE)))

    expect(sentOf(set)).toEqual([
      [SHA, false],
      [undefined, undefined],
      [undefined, undefined],
    ])
    expect(written, 'both decisions are written').toBe(2)
    expect(commitRuns(set).length, 'and git is asked only for the first').toBe(2)
  })

  test('a refusal for anything else is not taken for an old server: the commit is sent again with the next decision', async ($, on) => {
    const refused = { content: [{ type: 'text', text: 'refused:not_imperative — say it as an instruction' }], isError: true }
    const set = stage(on, {
      replies: [verdict({ records: [decision({ content: 'Use A.' }), decision({ content: 'Use B.' })] })],
      tools: { remember: args => (args.content === 'Use A.' ? refused : answer({ atom_id: '00000000-0000-4000-8000-000000000301', outcome: 'created' })) },
      git: gitAt(),
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember').map(args => [args.content, args.base_sha])).toEqual([
      ['Use A.', SHA],
      ['Use B.', SHA],
    ])
  })
})

describe('which commit is attached', () => {
  // Each from the tree's root: where an earlier command left the shell is not what is tested here.
  const commits = (command: string, printed: string | undefined) =>
    claude(
      'Committed.',
      use('Bash', { command: `cd ${ROOT}` }, ''),
      printed === undefined ? ({ tool: 'Bash', input: { command } } as never) : use('Bash', { command }, printed),
    )

  test('the sha is read from the line git prints for a commit it made in this repository', async ($, on) => {
    const HERE: readonly (readonly [string, string, string])[] = [
      ['git commit -m x', '[main 1a2b3c1] x', '1a2b3c1'],
      ['git add . && git commit -m x', 'hint\n[feat/a (root-commit) 1a2b3c2] x', '1a2b3c2'],
      [`git -C ${ROOT} commit -m x`, '[main 1a2b3c3] x', '1a2b3c3'],
      [`cd ${ROOT} && git commit --amend`, '[detached HEAD 1a2b3c4] x', '1a2b3c4'],
      [`cd "${ROOT}/" && git commit -m x`, '[main 1a2b3c5] x', '1a2b3c5'],
      ['git commit -m x', '[main 0123456789abcdef0123456789abcdef01234567] x', '0123456789abcdef0123456789abcdef01234567'],
    ]
    const set = stage(on)

    await $.session.start(START)

    for (const [command, printed] of HERE) {
      await turn($, set, dev('commit it'), commits(command, printed))
      await set.clock.advance(60_000)
    }

    expect(set.of('attach_commit').map(args => args.sha)).toEqual(HERE.map(([, , sha]) => sha))
  })

  test('a commit made somewhere else, or one git did not make, is attached to nothing', async ($, on) => {
    const NOT_HERE: readonly (readonly [string, string | undefined])[] = [
      ['git status', '[main 1a2b3c4] x'],
      ['git commit -m x', 'error: pathspec did not match'],
      ['git commit -m x', undefined],
      ['git commit -m x', '[main 1A2B3C4] upper case is no sha git prints'],
      // A folder inside the tree may be a repository of its own.
      ['git -C sub commit -m x', '[main 1a2b3c4] x'],
      [`cd ${ROOT}/packages/api && git commit -m x`, '[main 1a2b3c4] x'],
      ['git -C ../other commit -m x', '[main 1a2b3c4] x'],
      [`git -C ${ROOT}-other commit -m x`, '[main 1a2b3c4] x'],
      ['cd .. && git commit -m x', '[main 1a2b3c4] x'],
      ['cd ~/other && git commit -m x', '[main 1a2b3c4] x'],
      ['GIT_DIR=/work/other/.git git commit -m x', '[main 1a2b3c4] x'],
      ['pushd /work/other; git commit -m x', '[main 1a2b3c4] x'],
      // Words in a message that read like a change of place: it cannot be told, so it is left.
      ['git commit -m "cd /elsewhere is just words here"', '[main 1a2b3c4] x'],
    ]
    const set = stage(on)

    await $.session.start(START)

    for (const [command, printed] of NOT_HERE) {
      await turn($, set, dev('commit it'), commits(command, printed))
      await set.clock.advance(60_000)
    }

    await turn($, set, dev('commit it'), commits('git commit -m x', '[main 9e9e9e9] x'))

    expect(set.of('attach_commit').map(args => args.sha), 'only the one commit made here, last').toEqual(['9e9e9e9'])
  })
})
