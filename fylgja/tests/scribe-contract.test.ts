import { describe, expect, test } from 'claude-code/testing'

import { isRepoPath, refusalOf } from '../hooks/scribe/gate'
import { anchorsOf } from '../hooks/scribe/repo'
import { refusalLine } from '../hooks/scribe/scribe'
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
  shown,
  stage,
  START,
  turn,
  verdict,
} from './scribe-fixtures'

const TALK = [dev('Use Postgres for the queue lock.'), claude('Done.', edit('src/queue/lock.ts'))]

describe('what Fylgja would refuse is not sent', () => {
  const REFUSED: readonly (readonly [string, string, string, string])[] = [
    ['not_imperative', 'decision', 'Web push uses our own service worker.', ''],
    ['not_imperative', 'decision', 'GET /audit-log pages with offset and limit.', ''],
    ['not_imperative', 'gotcha', 'The seed is needed before the tests.', ''],
    ['not_one_sentence', 'decision', 'Use dayjs. It is small.', ''],
    ['not_one_sentence', 'decision', 'Use a cursor, e.g. on created_at, for the audit log.', ''],
    ['status_not_memory', 'decision', 'Use the new exporter, which is in review.', ''],
    ['status_not_memory', 'decision', 'Use the fix from PLA-12, PLA-13 and PLA-14.', ''],
    ['status_not_memory', 'decision', 'Use the lock that was merged with #318.', ''],
    ['too_long', 'decision', `Use ${'x'.repeat(220)}.`, ''],
    ['no_trigger', 'gotcha', 'Run the seed before the tests.', ''],
  ]
  const TAKEN: readonly (readonly [string, string])[] = [
    ['decision', 'Use Postgres advisory locks for the job queue, not Redis.'],
    ['decision', 'The queue lock is a Postgres advisory lock, not Redlock.'],
    ['decision', 'Sessions are rows in the `sessions` table (migration 0042.sql) looked up by cookie.'],
    ['correction', 'pnpm is the only package manager in this repo, never npm.'],
    ['decision', 'Never run migrations while one is pending.'],
    ['decision', "Don't cache permission checks in-process."],
  ]

  for (const [rule, kind, content] of REFUSED) {
    test(`“${content.slice(0, 50)}” (${kind}) breaks ${rule}`, () => {
      expect(refusalOf(kind, content, '', [])).toBe(rule)
    })
  }

  for (const [kind, content] of TAKEN) {
    test(`“${content.slice(0, 60)}” passes`, () => {
      expect(refusalOf(kind, content, '', [])).toBeUndefined()
    })
  }

  test('a record whose sentence Fylgja would refuse is said back once by its rule, and the answer put right is written', async ($, on) => {
    const set = stage(on, {
      replies: [
        verdict({ records: [decision({ content: 'Web push uses our own service worker. No vendor SDK.' })] }),
        verdict({ records: [decision({ content: 'Use our own service worker for web push, not a vendor SDK.' })] }),
      ],
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.asked.length).toBe(2)
    expect(set.asked[1]?.prompt).toMatch('Fylgja would refuse record 0: its "content" must be ONE sentence')
    expect(set.of('remember').map(args => args.content)).toEqual(['Use our own service worker for web push, not a vendor SDK.'])
  })

  test('still refused after that, the record is left out and the rest is written: nothing refused is ever sent', async ($, on) => {
    const bad = decision({ content: 'Web push uses our own service worker.' })
    const set = stage(on, { replies: [verdict({ records: [bad, decision({ content: 'Use B.' })] })] })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.asked.length).toBe(2)
    expect(set.of('remember').map(args => args.content)).toEqual(['Use B.'])
  })

  test('a reason is cut to what Fylgja takes, with the plan’s name still on it', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [decision({ detail: 'because '.repeat(400) })] })] })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(String(set.of('remember')[0]?.detail).length <= 1200).toBe(true)
  })

  test('paths are held to the server’s rules, a line number is taken off, and over twelve the most exact are kept', () => {
    for (const path of [
      'src/a.ts:12',
      'src/a.ts#L3-L9',
      'src/./a.ts',
      'src//a.ts',
      ' src/a.ts',
      'src/a.ts\u007f',
      'a\\b',
      '/abs',
      'dir/',
      '../x',
      'C:/x',
      '',
    ]) {
      expect(isRepoPath(path), JSON.stringify(path)).toBe(false)
    }

    expect(
      anchorsOf(
        [
          { path: 'src/a.ts:12-30', symbol: ' f ' },
          { path: 'src/a.ts#L4' },
          'src/b.ts:7:2',
          { path: 'src/c.ts', symbol: 'x'.repeat(201) },
        ],
        12,
      ),
    ).toEqual([{ path: 'src/a.ts', symbol: 'f' }, { path: 'src/a.ts' }, { path: 'src/b.ts' }, { path: 'src/c.ts' }])

    const many = [
      { path: 'src' },
      { path: 'README.md' },
      ...Array.from({ length: 12 }, (_, n) => ({ path: `src/deep/file-${n}.ts` })),
      { path: 'x.ts', symbol: 'f' },
    ]
    const kept = anchorsOf(many, 12)

    expect(kept.length).toBe(12)
    expect(kept.map(anchor => anchor.path)).not.toContain('src')
    expect(kept.map(anchor => anchor.path)).not.toContain('README.md')
    expect(kept.at(-1)).toEqual({ path: 'x.ts', symbol: 'f' })
  })
})

describe('a record another member already holds', () => {
  for (const outcome of ['duplicate', 'restored'] as const) {
    test(`${outcome} with a note: said plainly, with nothing to fix or remove, and no question about it`, async ($, on) => {
      const set = stage(on, {
        replies: [
          verdict({
            records: [decision({ detail: '', reason_status: 'not_stated' })],
            question: { form: 'reason', record: 0, options: ['a', 'b'] },
          }),
        ],
        tools: {
          remember: () =>
            answer({
              atom_id: idOf(9),
              outcome,
              supersede: 'not_requested',
              anchors: { paths: [], commits: [], paths_total: 0, commits_total: 0 },
              anchors_added: 1,
              reason_status: 'stated',
              note: 'this record is another member’s: its text, reason and alternatives were left as they are',
            }),
        },
      })

      await $.session.start(START)
      await turn($, set, ...TALK)

      expect(await shown($)).toBe(
        '✓ Already recorded by someone else · Use Postgres advisory locks for the job queue, not Redis. [9 What is this] [0 OK]',
      )
      expect(set.of('amend_memory')).toEqual([])
    })
  }

  test('one’s own record that Fylgja already holds still shows nothing', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [decision()] })],
      tools: { remember: () => answer({ atom_id: idOf(9), outcome: 'duplicate', supersede: 'not_requested', note: null }) },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(await shown($)).toBe('engine: AbovePrompt')
  })
})

describe('a change Fylgja turns down', () => {
  const refused = (text: string) => () => ({ content: [{ type: 'text', text }], isError: true })
  const LINES: readonly (readonly [string, string])[] = [
    [
      `atom ${idOf(7)} on this topic already says this; atom ${idOf(101)} was not changed`,
      'Not saved: another record already says this.',
    ],
    [
      `a removed record on this topic (atom ${idOf(7)}) already holds this text; atom ${idOf(101)} was not changed`,
      'Not saved: a record that was removed already holds this text.',
    ],
    [`memory ${idOf(101)} was changed by someone else`, 'Not saved: the record was changed by someone else just now. Try again.'],
    [
      "Fylgja couldn't reach its search index, so nothing was changed. Try again in a moment.",
      'Not saved: Fylgja could not reach its search index, so nothing was changed. Try again in a moment.',
    ],
    ['record not found', 'Not saved: the record is gone, or is not yours to change.'],
    [
      'refused:not_imperative — content must start with an instruction (Use, Never, …)',
      'Not saved: Fylgja turned the new text down (not_imperative).',
    ],
    ['SECRET internal error text', 'Not saved: Fylgja turned the change down.'],
  ]

  for (const [text, line] of LINES) {
    test(`“${text.slice(0, 48)}” is said as “${line}”`, () => {
      expect(refusalLine(text)).toBe(line)
    })
  }

  test('a Fix that is turned down is said in one line, in fixed words, and never tried again', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [decision()] }), NOTHING],
      tools: { amend_memory: refused(`atom ${idOf(7)} on this topic already says this; atom ${idOf(101)} was not changed`) },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    const ui = await band($)

    await ui.press('fix:0')
    await ui.redraw()
    await ui.enter('fix-text', 'Use Postgres advisory locks.')
    await ui.unmount()

    expect(set.toasts).toEqual(['Not saved: another record already says this.'])

    await turn($, set, dev('and now the retry policy'), claude('Three tries.', edit('src/queue/retry.ts')))

    expect(set.of('amend_memory').length, 'not tried again at the next turn').toBe(1)
  })

  test('a Remove that is turned down says so', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [decision()] })], tools: { amend_memory: refused('record not found') } })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await pressTwice($, 'remove:0')

    expect(set.toasts).toEqual(['Not saved: the record is gone, or is not yours to change.'])
  })
})

describe('a record as the server returns it', () => {
  test('its anchors are read from the server’s own shape, and one another member added says so when opened', async ($, on) => {
    const recorded = fact(1, {
      anchors: {
        paths: [
          { path: 'src/queue/lock.ts', symbol: 'acquire', added_by: 'author' },
          { path: 'src/queue', added_by: 'you' },
          { path: 'src/billing/export.ts', added_by: 'other' },
        ],
        commits: ['1a2b3c4'],
        paths_total: 3,
        commits_total: 1,
      },
      matched_paths: ['src/queue/lock.ts'],
      origin: 'scribe',
    })
    const set = stage(on, {
      tools: { recall: () => answer({ repo: 'acme/web', facts: [recorded], known_repos: [], repo_hint: null }) },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await press($, 'open')

    expect(await shown($)).toMatch('In: src/queue/lock.ts (acquire), src/queue, src/billing/export.ts (added by another member)')
  })
})
