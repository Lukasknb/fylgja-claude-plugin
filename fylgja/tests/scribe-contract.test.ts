import { describe, expect, test } from 'claude-code/testing'

import { codeOf, isRepoPath, teaches } from '../hooks/scribe/gate'
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

const refused = (text: string) => ({ content: [{ type: 'text', text }], isError: true })
const created = (n: number) => answer({ atom_id: idOf(n), outcome: 'created', supersede: 'not_requested', note: null })
const NOT_IMPERATIVE =
  'refused:not_imperative — content must start with an instruction (Use, Never, Always, Run, Check, Before, When …)'

/** A server that refuses a sentence opening with `opener` and takes every other. */
function refusing(opener: string, refusal = NOT_IMPERATIVE) {
  let n = 0

  return {
    remember: (args: Record<string, unknown>) => {
      if (String(args.content).startsWith(opener)) {
        return refused(refusal)
      }

      n += 1

      return created(100 + n)
    },
  }
}

describe('a refusal that says what is wrong is used once', () => {
  const PAGED = decision({
    content: 'Page /audit-log with offset and limit, not a cursor.',
    detail: '',
    reason_status: 'not_stated',
    alternatives: ['a cursor'],
  })
  const MENDED = { ...PAGED, content: 'Use offset and limit to page /audit-log, not a cursor.' }
  const WHY = { form: 'reason', record: 0, options: ['Clients jump to a page', 'Simplest to build'] }

  test('the model is handed the refused record and the refusal, and nothing of the session; what it puts right is sent once', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [PAGED] }), JSON.stringify({ record: MENDED })],
      tools: refusing('Page'),
    })

    await $.session.start(START)
    await turn($, set, dev('SESSION-TEXT: page the audit log with offset, go'), claude('Done.', edit('src/queue/lock.ts')))

    const [, correction] = set.asked

    expect(set.asked.length).toBe(2)
    expect(correction?.system).toMatch('A knowledge base refused one record.')
    expect(correction?.prompt).toMatch('"content":"Page /audit-log with offset and limit, not a cursor."')
    expect(correction?.prompt).toMatch('refused:not_imperative')
    expect(correction?.prompt).not.toMatch('SESSION-TEXT')
    expect(correction?.prompt.match(/^<<< /gm)?.length, 'both are fenced as data').toBe(2)
    expect(set.of('remember').map(args => args.content)).toEqual([PAGED.content, MENDED.content])
    expect(await shown($)).toMatch('✓ Recorded · Use offset and limit to page /audit-log, not a cursor.')
  })

  test('the question about a record that had to be put right is asked about the record as written', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [PAGED], question: WHY }), JSON.stringify({ record: MENDED })],
      tools: refusing('Page'),
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(await shown($)).toMatch('? Why: Use offset and limit to page /audit-log, not a cursor. [1 Clients jump to a page]')

    await pressTwice($, 'reason:0')

    expect(set.of('amend_memory')).toEqual([
      { atom_id: idOf(101), op: 'fix', detail: 'Clients jump to a page', reason_status: 'stated' },
    ])
  })

  test('only the part the refusal is about is taken from the answer: a reworded sentence brings no reason with it', async ($, on) => {
    const smuggling = {
      ...MENDED,
      detail: 'because it was the simplest',
      reason_status: 'stated',
      anchors: [{ path: 'src/never/opened.ts' }],
      alternatives: [],
    }
    const set = stage(on, {
      replies: [verdict({ records: [PAGED], question: WHY }), JSON.stringify({ record: smuggling })],
      tools: refusing('Page'),
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember')[1]).toMatchObject({
      content: MENDED.content,
      reason_status: 'not_stated',
      alternatives: ['a cursor'],
    })
    expect(set.of('remember')[1]?.detail).toBeUndefined()
    expect(await shown($), 'and the question still stands').toMatch('? Why')
  })

  test('refused a second time, the record is let go quietly: no third try, nothing shown', async ($, on) => {
    const again = { ...PAGED, content: 'Page GET /audit-log with offset and limit.' }
    const set = stage(on, {
      replies: [verdict({ records: [PAGED], question: WHY }), JSON.stringify({ record: again }), NOTHING],
      tools: refusing('Page'),
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember').length).toBe(2)
    expect(set.asked.length).toBe(2)
    expect(await shown($)).toBe('engine: AbovePrompt')
    expect(set.toasts).toEqual([])
  })

  for (const [what, reply] of [
    ['says to drop it', '{"drop":true}'],
    ['answers nothing usable', 'I cannot do that.'],
    ['hands the same record back', JSON.stringify({ record: PAGED })],
  ] as const) {
    test(`a model that ${what} costs no second write`, async ($, on) => {
      const set = stage(on, { replies: [verdict({ records: [PAGED] }), reply], tools: refusing('Page') })

      await $.session.start(START)
      await turn($, set, ...TALK)

      expect(set.of('remember').length).toBe(1)
      expect(await shown($)).toBe('engine: AbovePrompt')
    })
  }

  test('the step is one of the wake’s own four: a wake that used them up puts nothing right', async ($, on) => {
    const looking = ['recall', 'search', 'open'].map(tool =>
      JSON.stringify({ tool, args: tool === 'open' ? { id: idOf(1) } : { query: 'audit' } }),
    )
    const set = stage(on, {
      replies: [...looking, verdict({ records: [PAGED] }), JSON.stringify({ record: MENDED })],
      tools: refusing('Page'),
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.asked.length).toBe(4)
    expect(set.of('remember').length).toBe(1)
  })

  test('a record written on the developer’s own key is put right the same way, with one call of its own', async ($, on) => {
    const prior = fact(5, { content: 'Use a cursor to page the audit log.', anchors: { paths: [{ path: 'src/queue/lock.ts' }] } })
    const set = stage(on, {
      replies: [verdict({ records: [{ ...PAGED, supersedes: idOf(5) }] }), JSON.stringify({ record: MENDED })],
      tools: { ...refusing('Page'), recall: () => answer({ facts: [prior] }) },
      kept: { 'scribe.known': [idOf(5)] },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await press($, 'different')

    expect(set.asked.length).toBe(2)
    expect(set.of('remember').map(args => args.content)).toEqual([PAGED.content, MENDED.content])
    expect(await shown($)).toMatch('✓ Recorded · Use offset and limit to page /audit-log, not a cursor.')
  })

  for (const [code, part] of [
    ['too_long', 'content'],
    ['not_one_sentence', 'content'],
    ['status_not_memory', 'content'],
    ['anchor_invalid', 'anchors'],
    ['anchors_too_many', 'anchors'],
    ['reason_missing', 'reason'],
  ] as const) {
    test(`${code} is taught back once, and mends the ${part}`, async ($, on) => {
      const set = stage(on, {
        replies: [verdict({ records: [PAGED] }), JSON.stringify({ record: MENDED })],
        tools: refusing('Page', `refused:${code} — what to do about it`),
      })

      await $.session.start(START)
      await turn($, set, ...TALK)

      expect(set.asked.length).toBe(2)
    })
  }

  for (const code of ['search_index_unavailable', 'edit_conflict']) {
    test(`${code} is the server’s trouble: no model step, and the record is sent once more at the next turn’s end, as it is`, async ($, on) => {
      let calls = 0
      const set = stage(on, {
        replies: [verdict({ records: [PAGED] }), NOTHING, NOTHING],
        tools: {
          remember: () => {
            calls += 1

            return calls < 3 ? refused(`refused:${code} — try again in a moment`) : created(101)
          },
        },
      })

      await $.session.start(START)
      await turn($, set, ...TALK)

      expect([set.asked.length, calls]).toEqual([1, 1])

      await turn($, set, dev('and now the retry policy'), claude('Three tries.', edit('src/queue/retry.ts')))

      expect(calls, 'once more').toBe(2)
      expect(set.of('remember')[1]?.content).toBe(PAGED.content)

      await turn($, set, dev('one more thing to do here'), claude('Done.', edit('src/queue/other.ts')))

      expect(calls, 'and never again').toBe(2)
    })
  }

  for (const refusal of [
    'refused:not_found — record not found',
    'refused:burst — batch settled findings',
    'refused:some_new_rule — x',
    'no code at all',
  ]) {
    test(`“${refusal.slice(0, 26)}” is a quiet failure: no model step, no retry`, async ($, on) => {
      const set = stage(on, { replies: [verdict({ records: [PAGED] }), NOTHING], tools: { remember: () => refused(refusal) } })

      await $.session.start(START)
      await turn($, set, ...TALK)
      await turn($, set, dev('and now the retry policy'), claude('Three tries.', edit('src/queue/retry.ts')))

      expect(set.of('remember').length).toBe(1)
      expect(set.asked.length).toBe(2)
      expect(set.toasts).toEqual([])
    })
  }

  test('a reason is cut to what Fylgja takes', async ($, on) => {
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
  const LINES: readonly (readonly [string, string])[] = [
    [
      `refused:atom_content_taken — atom ${idOf(7)} on this topic already says this`,
      'Not saved: another record already says this.',
    ],
    [
      'refused:atom_content_removed — a removed record already holds this text',
      'Not saved: a record that was removed already holds this text.',
    ],
    [
      'refused:edit_conflict — changed by someone else',
      'Not saved yet: the record was changed by someone else just now. It is tried once more after the next turn.',
    ],
    [
      'refused:search_index_unavailable — try again in a moment',
      'Not saved yet: Fylgja could not reach its search index. It is tried once more after the next turn.',
    ],
    ['refused:not_found — record not found', 'Not saved: the record is gone, or is not yours to change.'],
    [
      'refused:not_imperative — content must start with an instruction',
      'Not saved: Fylgja turned the new text down (not_imperative).',
    ],
    ['refused:some_new_rule — SECRET words of the server', 'Not saved: Fylgja turned the change down.'],
    // Words alone name no rule: only the code is read.
    [`atom ${idOf(7)} on this topic already says this; nothing was changed`, 'Not saved: Fylgja turned the change down.'],
    ['', 'Not saved: Fylgja turned the change down.'],
  ]

  for (const [text, line] of LINES) {
    test(`“${text.slice(0, 40)}” is said as “${line.slice(0, 60)}”`, () => {
      expect(refusalLine(text)).toBe(line)
    })
  }

  test('a refusal is read by its code alone', () => {
    expect(codeOf('refused:not_imperative — x')).toBe('not_imperative')
    expect(codeOf('Refused: say what to do')).toBeUndefined()
    expect(codeOf('it was refused:not_imperative')).toBeUndefined()
    expect(codeOf(undefined)).toBeUndefined()
    expect([
      teaches('not_imperative'),
      teaches('anchor_invalid'),
      teaches('not_found'),
      teaches('burst'),
      teaches('hasOwnProperty'),
    ]).toEqual(['content', 'anchors', undefined, undefined, undefined])
  })

  test('a Fix that is turned down is said in one line, in fixed words, and never tried again', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [decision()] }), NOTHING],
      tools: { amend_memory: () => refused(`refused:atom_content_taken — atom ${idOf(7)} on this topic already says this`) },
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

  test('a Fix the server could not make for trouble of its own is tried once more at the next turn’s end, and then left', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [decision()] }), NOTHING, NOTHING],
      tools: { amend_memory: () => refused('refused:search_index_unavailable — try again in a moment') },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await pressTwice($, 'remove:0')
    await turn($, set, dev('and now the retry policy'), claude('Three tries.', edit('src/queue/retry.ts')))
    await turn($, set, dev('one more thing to do here'), claude('Done.', edit('src/queue/other.ts')))

    expect(set.of('amend_memory').length).toBe(2)
    expect(set.toasts).toEqual([
      'Not saved yet: Fylgja could not reach its search index. It is tried once more after the next turn.',
    ])
  })

  test('a Remove of a record that is gone says so', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [decision()] })],
      tools: { amend_memory: () => refused('refused:not_found — record not found') },
    })

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

describe('a record’s link', () => {
  const FILE = 'src/queue/lock.ts'

  test('the link the server gives opens the record, and goes into the note for Claude', async ($, on) => {
    const set = stage(on, { tools: { recall: () => answer({ facts: [fact(1, { anchors: { paths: [{ path: FILE }] } })] }) } })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await press($, 'open')

    expect(await shown($)).toMatch('[Open in Fylgja]')

    await press($, 'tell-claude')

    expect(set.fills[0]).toMatch(`> https://fylgja.lknblab.dev/open/atom/${idOf(1)}`)
  })

  test('with no link there is nothing to open, and the note carries none', async ($, on) => {
    const set = stage(on, {
      tools: { recall: () => answer({ facts: [fact(1, { anchors: { paths: [{ path: FILE }] }, link: undefined })] }) },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await press($, 'open')

    expect(await shown($)).not.toMatch('Open in Fylgja')

    await press($, 'tell-claude')

    expect(set.fills[0]).not.toMatch('https://')
  })
})
