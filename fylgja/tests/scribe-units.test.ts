import { describe, expect, test } from 'claude-code/testing'

import * as Band from '../hooks/scribe/band'
import { skipsAfter } from '../hooks/scribe/band'
import { commitOf, MAX_DELTA_CHARS, observe, plain } from '../hooks/scribe/delta'
import { factsOf } from '../hooks/scribe/facts'
import { isPlanDocument } from '../hooks/scribe/plans'
import { relativeTo, repoNameOf } from '../hooks/scribe/repo'
import { saysNoReason, verdictOf } from '../hooks/scribe/verdict'
import { idOf } from './fixtures'
import { claude, decision, dev, edit, fact, ROOT, use } from './scribe-fixtures'

describe('the repository’s name', () => {
  const NAMES: readonly (readonly [string | null, string, string | undefined])[] = [
    ['git@github.com:acme/web.git', '/work/web', 'acme/web'],
    ['https://github.com/acme/web.git', '/work/web', 'acme/web'],
    ['https://github.com/acme/web', '/work/web', 'acme/web'],
    ['ssh://git@gitlab.example.com:2222/group/sub/web.git', '/work/web', 'sub/web'],
    ['https://user:secret@github.com/acme/web.git/', '/work/web', 'acme/web'],
    ['https://dev.azure.com/acme/Platform/_git/web', '/work/web', 'Platform/web'],
    ['git@ssh.dev.azure.com:v3/acme/Platform/web', '/work/web', 'Platform/web'],
    ['../web-upstream', '/work/web', 'web'],
    ['../../mirrors/web.git', '/work/web', 'mirrors/web'],
    ['/srv/git/web.git', '/work/checkout', 'git/web'],
    ['file:///srv/_git/web', '/work/checkout', 'srv/web'],
    [null, '/work/local-thing', 'local-thing'],
    [null, '/work/local thing/', undefined],
    ['not a remote', '/work/fallback', 'fallback'],
  ]

  for (const [remote, root, name] of NAMES) {
    test(`${remote ?? 'no remote'} in ${root} is ${name ?? 'no name'}`, () => {
      expect(repoNameOf(remote, root)).toBe(name)
    })
  }
})

describe('a file’s path from the tree’s root', () => {
  test('a file in the tree is named from its root; in a worktree that is the worktree', () => {
    expect(relativeTo('/work/repo', '/work/repo/src/a.ts')).toBe('src/a.ts')
    expect(relativeTo('/work/repo/.claude/worktrees/x', '/work/repo/.claude/worktrees/x/src/a.ts')).toBe('src/a.ts')
    expect(relativeTo('/work/repo/', './src/a.ts')).toBe('src/a.ts')
  })

  test('a file outside the tree, or a path that climbs, has no name there', () => {
    for (const path of [
      '/work/repo-other/a.ts',
      '/etc/passwd',
      '/work/repo',
      '../a.ts',
      'src/../a.ts',
      'a\\b.ts',
      'C:/a.ts',
      '',
      'src/',
    ]) {
      expect(relativeTo('/work/repo', path), path).toBeUndefined()
    }

    expect(relativeTo('/work/repo', `src/${'x'.repeat(400)}.ts`)).toBeUndefined()
  })
})

describe('what Scribe is told of a turn', () => {
  const said = (...prompts: string[]) => new Set(prompts.map(plain))

  test('prompts, replies and one line per tool call; no file’s contents and no tool’s output but a shell command’s head', () => {
    const seen = observe(
      [
        dev('<system-reminder>ENGINE-NOTE</system-reminder>make it retry'),
        claude(
          'On it.',
          use('Read', { file_path: `${ROOT}/src/a.ts` }, 'FILE-CONTENT-READ'),
          use('Write', { file_path: `${ROOT}/src/b.ts`, content: 'FILE-CONTENT-WRITTEN' }),
          use('Edit', { file_path: '/elsewhere/c.ts', old_string: 'OLD-TEXT', new_string: 'NEW-TEXT' }),
          use('Bash', { command: 'npm test' }, `3 passed${' and more'.repeat(60)}`),
          use('Bash', { command: 'npm run lint' }, 'boom', true),
          use('Grep', { pattern: 'retry' }, 'src/a.ts:1: MATCHED-LINE'),
          use('mcp__fylgja__recall', { query: 'QUERY-TEXT' }, 'RECALL-OUTPUT'),
        ),
        { role: 'user', text: '', toolUses: [] },
        claude('Retries three times now.'),
      ],
      ROOT,
      said('make it retry'),
    )

    expect(seen.lines.slice(0, 5)).toEqual([
      '[developer] make it retry',
      '[claude] On it.',
      '[tool] Read src/a.ts ok',
      '[tool] Write src/b.ts ok',
      '[tool] Edit /elsewhere/c.ts (outside the working tree) ok',
    ])
    expect(seen.lines[5]).toMatch(/^\[tool\] Bash `npm test` ok: 3 passed and more.{0,200}… \(\d+ more characters\)$/)
    expect(seen.lines.slice(6)).toEqual([
      '[tool] Bash `npm run lint` failed: boom',
      '[tool] Grep retry ok',
      '[tool] mcp__fylgja__recall ok',
      '[claude] Retries three times now.',
    ])
    expect(seen.touched).toEqual(['src/a.ts', 'src/b.ts'])
    expect(seen.developer).toBe('make it retry')
    expect([seen.hasChange, seen.words]).toEqual([
      true,
      'make it retry'.length + 'On it.'.length + 'Retries three times now.'.length,
    ])

    for (const kept of ['FILE-CONTENT', 'OLD-TEXT', 'NEW-TEXT', 'MATCHED-LINE', 'QUERY-TEXT', 'RECALL-OUTPUT', 'ENGINE-NOTE']) {
      expect(seen.lines.join('\n'), kept).not.toMatch(kept)
    }
  })

  test('only a prompt the developer sent is theirs: every other user-role row is named for what it is, or left out', () => {
    const seen = observe(
      [
        dev('make it retry'),
        {
          role: 'user',
          text: '<task-notification><summary>Agent "tests" finished</summary><result>NOTICE-BODY</result></task-notification>',
          toolUses: [],
        },
        { role: 'user', text: 'This session is being continued from a previous conversation. SUMMARY-BODY', toolUses: [] },
        { role: 'user', text: 'Base directory for this skill: /x\n\nSKILL-BODY', toolUses: [] },
        { role: 'user', text: 'HOOK-INJECTED no particular reason', toolUses: [] },
        claude('Done.'),
        dev('  make it   retry\n<system-reminder>x</system-reminder>'),
      ],
      ROOT,
      said('make it retry'),
    )

    expect(seen.lines).toEqual([
      '[developer] make it retry',
      '[notice] a background task reported back',
      '[claude] Done.',
      '[developer] make it retry',
    ])
    expect(seen.developer).toBe('make it retry\nmake it   retry')
  })

  test('a turn too long to hand over loses its oldest lines, and says how many', () => {
    const rows = Array.from({ length: 40 }, (_, n) => claude(`REPLY-${n} ${'word '.repeat(200)}`))
    const seen = observe([dev('OLDEST'), ...rows], ROOT, said('OLDEST'))

    expect(seen.lines.join('\n').length <= MAX_DELTA_CHARS).toBe(true)
    expect(seen.lines.at(-1)).toMatch('REPLY-39')
    expect(seen.lines.join('\n')).not.toMatch('OLDEST')
    expect(seen.dropped).toBe(41 - seen.lines.length)
  })

  test('a commit’s sha is read from the line git prints for a commit it made, in this repository alone', () => {
    const HERE: readonly (readonly [string, string])[] = [
      ['git commit -m x', '[main 1a2b3c4] x'],
      ['git add . && git commit -m x', 'hint\n[feat/a (root-commit) 1a2b3c4] x'],
      ['git -C sub commit --amend', '[detached HEAD 1a2b3c4] x'],
      [`git -C ${ROOT} commit -m x`, '[main 1a2b3c4] x'],
      [`cd ${ROOT}/packages/api && git commit -m x`, '[main 1a2b3c4] x'],
      ['cd packages/api && git commit -m x', '[main 1a2b3c4] x'],
      // The commit went through; what failed came after it.
      ['git commit -m x && npm run deploy', '[main 1a2b3c4] x\nnpm ERR! missing script'],
    ]
    const NOT_HERE: readonly (readonly [string, string | undefined])[] = [
      ['git status', '[main 1a2b3c4] x'],
      ['git commit -m x', 'nothing to commit, working tree clean'],
      ['git commit -m x', 'error: pathspec did not match'],
      ['git commit -m x', undefined],
      ['git commit -m x', '[main 1A2B3C4] upper case is no sha git prints'],
      ['git -C /work/other commit -m x', '[main 1a2b3c4] x'],
      ['git -C ../other commit -m x', '[main 1a2b3c4] x'],
      [`git -C ${ROOT}-other commit -m x`, '[main 1a2b3c4] x'],
      ['cd /work/other && git commit -m x', '[main 1a2b3c4] x'],
      ['cd .. && git commit -m x', '[main 1a2b3c4] x'],
      ['cd ~/other && git commit -m x', '[main 1a2b3c4] x'],
      ['cd "$SOMEWHERE" && git commit -m x', '[main 1a2b3c4] x'],
      ['git --git-dir=/work/other/.git commit -m x', '[main 1a2b3c4] x'],
      ['GIT_DIR=/work/other/.git git commit -m x', '[main 1a2b3c4] x'],
      ['pushd /work/other; git commit -m x', '[main 1a2b3c4] x'],
      // Words in a message that read like a change of place: it cannot be told, so it is left.
      ['git commit -m "cd /elsewhere is just words here"', '[main 1a2b3c4] x'],
    ]

    for (const [command, printed] of HERE) {
      expect(commitOf(command, printed, ROOT), command).toBe('1a2b3c4')
    }

    expect(commitOf('git commit -m x', '[main 0123456789abcdef0123456789abcdef01234567] x', ROOT)).toBe(
      '0123456789abcdef0123456789abcdef01234567',
    )

    for (const [command, printed] of NOT_HERE) {
      expect(commitOf(command, printed, ROOT), `${command} → ${printed}`).toBeUndefined()
    }
  })

  test('the files touched are the tree’s own, each once', () => {
    expect(
      observe([claude('', edit('src/a.ts'), edit('src/a.ts'), use('Read', { file_path: '/etc/hosts' }))], ROOT, said()).touched,
    ).toEqual(['src/a.ts'])
  })
})

describe('what counts as a plan document', () => {
  const PLANS = [
    ['docs/plan-queue.md', '# Anything'],
    ['PLAN.md', ''],
    ['/home/me/.claude/plans/sunny-otter.md', '# Queue rework'],
    ['docs/adr/0007-queues.md', '# Queues'],
    ['rfcs/0012-auth.markdown', 'no heading'],
    ['WP-12.md', '# Twelve'],
    ['docs/auth_design.md', '# Auth'],
    ['notes/monday.md', '# Design: mail retries'],
    ['notes/monday.md', '\n\n## Work package 3\n'],
    ['specs/login.mdx', '# Login'],
  ] as const
  const OTHERS = [
    ['README.md', '# Web'],
    ['docs/planning.md', '# Notes'],
    ['docs/display.md', '# Display'],
    ['src/plan.ts', '# Plan'],
    ['docs/plan.txt', '# Plan'],
    ['notes/monday.md', '# Monday\n\n## The plan\n'],
    ['CHANGELOG.md', '# Changelog\n\nWe plan to design a spec.'],
  ] as const

  for (const [path, text] of PLANS) {
    test(`${path} headed “${text.trim().split('\n')[0] ?? ''}” is one`, () => {
      expect(isPlanDocument(path, text)).toBe(true)
    })
  }

  for (const [path, text] of OTHERS) {
    test(`${path} headed “${text.split('\n')[0] ?? ''}” is not`, () => {
      expect(isPlanDocument(path, text)).toBe(false)
    })
  }
})

describe('a verdict is held to what the wake really saw', () => {
  const [recorded] = factsOf({ facts: [fact(1)] })
  const SEEN = {
    facts: new Map(recorded === undefined ? [] : [[idOf(1), recorded]]),
    plans: [],
    saidNoReason: false,
    paths: new Set(['src/queue/lock.ts']),
  }

  test('a reason nobody gave is never written down as one', () => {
    const [record] = verdictOf(
      { outcome: 'act', records: [decision({ detail: 'a guess', reason_status: 'not_stated' })] },
      SEEN,
    ).records

    expect([record?.reasonStatus, record?.detail]).toEqual(['not_stated', ''])
  })

  test('“no particular reason” stands only when the developer’s own words say so', () => {
    const claimed = {
      outcome: 'act',
      records: [decision({ detail: 'picked the first that worked', reason_status: 'no_strong_reason' })],
    }

    expect(verdictOf(claimed, SEEN).records[0]?.reasonStatus).toBe('not_stated')
    expect(verdictOf(claimed, { ...SEEN, saidNoReason: true }).records[0]).toMatchObject({
      reasonStatus: 'no_strong_reason',
      detail: 'picked the first that worked',
    })
  })

  test('a decision with a reason and no status is stated; one with neither is not', () => {
    expect(verdictOf({ outcome: 'act', records: [decision({ reason_status: undefined })] }, SEEN).records[0]?.reasonStatus).toBe(
      'stated',
    )
    expect(
      verdictOf({ outcome: 'act', records: [decision({ reason_status: 'stated', detail: ' ' })] }, SEEN).records[0]?.reasonStatus,
    ).toBe('not_stated')
  })

  test('what is no record is left out, and a question keeps pointing at its own record', () => {
    const read = verdictOf(
      {
        outcome: 'act',
        records: [{ kind: 'status', content: 'Tests pass.' }, decision({ detail: '', reason_status: 'not_stated' })],
        question: { form: 'reason', record: 1, options: ['a', 'b', 'c', 'd', 7, 'x'.repeat(81)] },
      },
      SEEN,
    )

    expect(read.records.length).toBe(1)
    expect(read.question).toEqual({ form: 'reason', record: 0, options: ['a', 'b', 'c'] })
  })

  test('an anchor is kept only for a file the session touched', () => {
    const anchors = [{ path: 'src/queue/lock.ts', symbol: 'acquire' }, { path: 'src/untouched.ts' }, { path: 'src/queue' }]

    expect(verdictOf({ outcome: 'act', records: [decision({ anchors })] }, SEEN).records[0]?.anchors).toEqual([
      { path: 'src/queue/lock.ts', symbol: 'acquire' },
    ])
  })

  test('a reversal is asked only about a recorded decision a lookup of this wake returned', () => {
    const ask = { form: 'reversal', record: 0, prior: idOf(1), options: [] }
    const [gotcha] = factsOf({ facts: [fact(1, { type: 'gotcha' })] })

    expect(verdictOf({ outcome: 'act', records: [decision()], question: ask }, { ...SEEN, facts: new Map() }).question).toBe(null)
    expect(
      verdictOf(
        { outcome: 'act', records: [decision()], question: ask },
        { ...SEEN, facts: new Map([[idOf(1), gotcha as never]]) },
      ).question,
    ).toBe(null)

    const read = verdictOf({ outcome: 'act', records: [decision()], question: ask }, SEEN)

    expect(read.question).toMatchObject({ form: 'reversal', prior: idOf(1) })
    expect(read.records[0]?.supersedes).toBe(idOf(1))
  })

  test('a record marked as a replacement with no question about it gets the question; with another question in the way it replaces nothing', () => {
    const alone = verdictOf({ outcome: 'act', records: [decision({ supersedes: idOf(1) })] }, SEEN)

    expect(alone.question).toEqual({ form: 'reversal', record: 0, prior: idOf(1), options: [] })

    const crowded = verdictOf(
      {
        outcome: 'act',
        records: [decision({ content: 'Use A.', detail: '', reason_status: 'not_stated' }), decision({ supersedes: idOf(1) })],
        question: { form: 'reason', record: 0, options: ['a', 'b'] },
      },
      SEEN,
    )

    expect(crowded.question?.form).toBe('reason')
    expect(crowded.records.map(record => record.supersedes)).toEqual([null, null])
  })
})

describe('reading records', () => {
  test('a record is read from either shape of its anchors, and one that is no record is left out', () => {
    const facts = factsOf({
      facts: [
        fact(1, { anchors: { paths: [{ path: 'src/a.ts', symbol: 'f' }], commits: ['1a2b3c4'] } }),
        fact(2, {
          anchors: [
            { kind: 'path', ref: 'src/b.ts' },
            { kind: 'commit', ref: '1a2b3c4' },
          ],
          link: 'https://evil.example/open/atom/x',
        }),
        { id: 'not-an-id', content: 'x' },
        { id: idOf(3) },
        fact(1),
      ],
    })

    expect(facts.map(one => [one.id, one.anchors, one.link === null])).toEqual([
      [idOf(1), [{ path: 'src/a.ts', symbol: 'f' }], false],
      [idOf(2), [{ path: 'src/b.ts' }], true],
    ])
  })
})

describe('small rules', () => {
  test('offers let go after being ignored: none for the first two, then 1, 2, 4, 8, 16 and no more', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 20].map(skipsAfter)).toEqual([0, 0, 0, 1, 2, 4, 8, 16, 16, 16])
  })

  const NO_REASON = [
    'idk',
    'no idea',
    'No idea.',
    'no idea, it just worked',
    'No idea, it just worked!',
    'don’t know',
    "I don't remember",
    'honestly, I have no idea',
    'no particular reason',
    'no reason, really',
    'none',
    'None, honestly',
    'nothing in particular',
    'just because',
    'it just worked',
    'well, it just worked',
    'picked the first that worked',
    'not sure why',
    'arbitrary',
    '?',
  ]
  const REASONS = [
    'none of the others support ESM',
    'just because the API requires it',
    'nothing else passed the load test',
    'no idea how they do it upstream, but their docs require it',
    'it works with our proxy and the other one does not',
    'not sure about Redis in CI, it was flaky',
    'the vendor has no idea how to support it and we cannot wait',
    'Redis was flaky',
    'arbitrary limits upstream forced it',
    'because of the 10 MB attachment limit',
    `no idea ${'x'.repeat(200)}`,
  ]

  for (const text of NO_REASON) {
    test(`“${text}” says there was no reason`, () => {
      expect(saysNoReason(text)).toBe(true)
    })
  }

  for (const text of REASONS) {
    test(`“${text.slice(0, 60)}” is a reason`, () => {
      expect(saysNoReason(text)).toBe(false)
    })
  }

  test('one item shows at a time, no more than five wait, and what a full line pushes out is handed back to be written', () => {
    const band = Band.create()
    const [prior] = factsOf({ facts: [fact(1)] })
    const draft = {
      kind: 'decision',
      content: 'x',
      detail: '',
      alternatives: [],
      anchors: [],
      triggers: [],
      reasonStatus: null,
      supersedes: null,
    } as const
    const question = (n: number): Band.Question => ({
      kind: 'question',
      form: 'reversal',
      draft: { ...draft, content: `Use ${n}.`, alternatives: [], anchors: [], triggers: [] },
      prior: prior as never,
      options: [],
      isTouched: false,
    })

    for (let n = 1; n <= 7; n += 1) {
      // The rule of one question per turn's end is not what is tested here.
      band.hasAskedThisTurn = false
      band.questions = 0
      Band.offerQuestion(band, question(n), `Use ${n}.`)
    }

    const first = Band.settle(band)

    expect(band.current).toMatchObject({ draft: { content: 'Use 3.' } })
    expect(first.dropped.map(item => (item.kind === 'question' && item.form === 'reversal' ? item.draft.content : ''))).toEqual([
      'Use 1.',
      'Use 2.',
    ])
    expect(band.queue.length).toBe(4)

    Band.settle(band)

    expect(band.current, 'still the first').toMatchObject({ draft: { content: 'Use 3.' } })

    Band.clear(band)
    Band.settle(band)

    expect(band.current).toMatchObject({ draft: { content: 'Use 4.' } })
  })
})
