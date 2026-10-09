import { describe, expect, test } from 'claude-code/testing'

import { skipsAfter } from '../hooks/scribe/band'
import { commitOf, MAX_DELTA_CHARS, observe } from '../hooks/scribe/delta'
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

    for (const kept of ['FILE-CONTENT', 'OLD-TEXT', 'NEW-TEXT', 'MATCHED-LINE', 'QUERY-TEXT', 'RECALL-OUTPUT', 'ENGINE-NOTE']) {
      expect(seen.lines.join('\n'), kept).not.toMatch(kept)
    }
  })

  test('a turn too long to hand over loses its oldest lines, and says how many', () => {
    const rows = Array.from({ length: 40 }, (_, n) => claude(`REPLY-${n} ${'word '.repeat(200)}`))
    const seen = observe([dev('OLDEST'), ...rows], ROOT)

    expect(seen.lines.join('\n').length <= MAX_DELTA_CHARS).toBe(true)
    expect(seen.lines.at(-1)).toMatch('REPLY-39')
    expect(seen.lines.join('\n')).not.toMatch('OLDEST')
    expect(seen.dropped).toBe(41 - seen.lines.length)
  })

  test('a commit’s sha is read from what the commit printed', () => {
    expect(commitOf('git commit -m x', '[main 1a2b3c4] x', false)).toBe('1a2b3c4')
    expect(
      commitOf('git add . && git commit -m x', 'hint\n[feat/a (root-commit) 0123456789abcdef0123456789abcdef01234567] x', false),
    ).toBe('0123456789abcdef0123456789abcdef01234567')
    expect(commitOf('git -C sub commit --amend', '[detached HEAD 9f8e7d6] x', false)).toBe('9f8e7d6')

    for (const [command, printed, isError] of [
      ['git commit -m x', '[main 1a2b3c4] x', true],
      ['git status', '[main 1a2b3c4] x', false],
      ['echo "[main 1a2b3c4] commit"', '[main 1a2b3c4] commit', false],
      ['git commit -m x', 'nothing to commit, working tree clean', false],
      ['git commit -m x', undefined, false],
      ['git commit -m x', '[main 1A2B3C4] upper case is no sha git prints', false],
    ] as const) {
      expect(commitOf(command, printed, isError), `${command} → ${printed}`).toBeUndefined()
    }
  })

  test('the files touched are the tree’s own, each once', () => {
    expect(
      observe([claude('', edit('src/a.ts'), edit('src/a.ts'), use('Read', { file_path: '/etc/hosts' }))], ROOT).touched,
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
  const SEEN = { citable: new Set([idOf(1)]), facts: new Map(), plans: [], saidNoReason: false }

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

  test('a reversal is asked only about a record the wake holds', () => {
    const ask = { form: 'reversal', record: 0, prior: idOf(1), options: [] }

    expect(verdictOf({ outcome: 'act', records: [decision()], question: ask }, SEEN).question).toBe(null)

    const [held] = factsOf({ facts: [fact(1)] })
    const read = verdictOf(
      { outcome: 'act', records: [decision()], question: ask },
      { ...SEEN, facts: new Map([[idOf(1), held as never]]) },
    )

    expect(read.question).toMatchObject({ form: 'reversal', prior: idOf(1) })
    expect(read.records[0]?.supersedes).toBe(idOf(1))
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

  test('a short answer that says there was no reason is told from a reason', () => {
    for (const text of [
      'idk',
      'no idea',
      'No idea, it just worked',
      'don’t know',
      "I don't remember",
      'no particular reason',
      'none',
      '?',
      'just because',
      'Honestly, I have no idea',
      'well, it just worked',
    ]) {
      expect(saysNoReason(text), text).toBe(true)
    }

    for (const text of [
      'Redis was flaky',
      'the vendor has no idea how to support it and we cannot wait',
      `no idea ${'x'.repeat(200)}`,
    ]) {
      expect(saysNoReason(text), text).toBe(false)
    }
  })
})
