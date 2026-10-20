import type { Engine } from 'claude-code/testing'
import { describe, expect, test } from 'claude-code/testing'

import { GIT_TIMEOUT_MS } from '../hooks/scribe/git'
import { NO_CODE } from '../hooks/scribe/ledger'
import { answer, idOf } from './fixtures'
import { claude, decision, dev, edit, fact, gitStatus, NOTHING, ROOT, stage, START, turn, use, verdict } from './scribe-fixtures'
import type { StageOptions } from './scribe-fixtures'
import { frame, pane } from './window-fixtures'

const PLAN_FILE = 'docs/partial-confirmations/plan-l5-l6.md'
const OUTBOX = 'src/import/outbox.py'
const OWN = idOf(101)
const OUTBOX_DECISION = decision({
  content: 'Trigger the agent turn after an ERP update with an outbox event written in the import transaction, not with a new Redis queue.',
  detail: 'The event commits or rolls back with the import itself.',
  alternatives: ['a new Redis queue'],
  anchors: [{ path: PLAN_FILE }],
})
const TALK = 'x'.repeat(260)
const writePlan = use('Write', { file_path: `${ROOT}/${PLAN_FILE}`, content: '# L5/L6 partial confirmations\n\nOutbox, not Redis.' })
const later = (paths: string[]) => JSON.stringify({ outcome: 'act', records: [], anchor: [{ id: OWN, paths }] })

const COMMAND = {
  command: 'fylgja-kept',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
} as never

/** The lines the window of what was kept shows, opened by its command. */
async function keptLines($: Engine): Promise<string[]> {
  await $.command.run(COMMAND)

  const ui = await pane($)
  const lines = await ui.lines()

  await ui.unmount()

  return lines
}

describe('a plan or notes file is no place for a decision', () => {
  test('a decision anchored to the plan it was made in is written without it, and waits for its code', async ($, on) => {
    frame(on)
    const set = stage(on, { git: gitStatus([PLAN_FILE]), replies: [verdict({ records: [OUTBOX_DECISION] })] })

    await $.session.start(START)
    await turn($, set, dev(`plan the L5/L6 partial confirmations ${TALK}`), claude('Planned.', writePlan))

    expect(set.of('remember').length).toBe(1)
    expect(set.of('remember')[0]?.anchors, 'a plan git was never given is not where the decision lives').toBeUndefined()
    expect(await keptLines($)).toContain(`In: ${NO_CODE}`)

    await set.clock.settle()
    await $.session.start(START)

    expect(await keptLines($), 'and still waits for it once the plugin is loaded again').toContain(`In: ${NO_CODE}`)
  })

  test('where git cannot be run, the plan is told by its name', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [OUTBOX_DECISION] })] })

    await $.session.start(START)
    await turn($, set, dev(`plan the L5/L6 partial confirmations ${TALK}`), claude('Planned.', writePlan))

    expect(set.of('remember')[0]?.anchors).toBeUndefined()
  })

  test('a git that never answers holds the look a moment only, and the name decides', async ($, on) => {
    const set = stage(on, { git: () => 'hangs', replies: [verdict({ records: [OUTBOX_DECISION] })] })

    await $.session.start(START)

    const pending = turn($, set, dev(`plan the L5/L6 partial confirmations ${TALK}`), claude('Planned.', writePlan))

    await set.clock.advance(GIT_TIMEOUT_MS + 10)
    await pending

    expect(set.of('remember').length, 'the record is written all the same').toBe(1)
    expect(set.of('remember')[0]?.anchors).toBeUndefined()
  })

  test('the code written later in the session is added as its place, and the window names it', async ($, on) => {
    frame(on)
    const set = stage(on, { git: gitStatus([PLAN_FILE, OUTBOX]), replies: [verdict({ records: [OUTBOX_DECISION] }), later([OUTBOX])] })

    await $.session.start(START)
    await turn($, set, dev(`plan the L5/L6 partial confirmations ${TALK}`), claude('Planned.', writePlan))
    await turn($, set, dev('now build the outbox'), claude('Built.', edit(OUTBOX)))

    expect(set.asked[1]?.prompt, 'the model is told it waits for its code').toMatch(
      `(id=${OWN}, no place in the code yet) Trigger the agent turn`,
    )
    expect(set.of('amend_memory'), 'new code, not committed yet, is still where it lives').toEqual([
      { atom_id: OWN, op: 'fix', anchors: [{ path: OUTBOX }] },
    ])
    expect(await keptLines($)).toContain(`In: ${OUTBOX}`)

    await set.clock.settle()
    await $.session.start(START)

    expect(await keptLines($), 'and names it once the plugin is loaded again').toContain(`In: ${OUTBOX}`)
  })

  test('an unrelated edit, a document, a file only read and more than three files are not taken as its place', async ($, on) => {
    const files = ['src/a.py', 'src/b.py', 'src/c.py', 'src/d.py']
    const set = stage(on, {
      git: gitStatus([PLAN_FILE]),
      replies: [
        verdict({ records: [OUTBOX_DECISION] }),
        NOTHING,
        later(['README.md', PLAN_FILE]),
        later(['src/import/reader.py']),
        later(files),
      ],
    })

    await $.session.start(START)
    await turn($, set, dev(`plan the L5/L6 partial confirmations ${TALK}`), claude('Planned.', writePlan))
    await turn($, set, dev('fix the invoice rounding'), claude('Fixed.', edit('src/billing/invoice.py')))

    expect(set.of('amend_memory'), 'the model pairs nothing with an unrelated edit, and nothing is guessed').toEqual([])

    await turn($, set, dev('update the readme and the plan'), claude('Updated.', edit('README.md'), edit(PLAN_FILE)))

    expect(set.of('amend_memory'), 'a document is never a later place').toEqual([])

    await turn(
      $,
      set,
      dev(`look at the reader ${TALK}`),
      claude('Read it.', use('Read', { file_path: `${ROOT}/src/import/reader.py` }, 'reader')),
    )

    expect(set.of('amend_memory'), 'a file only read is not where it was carried out').toEqual([])

    await turn($, set, dev('build the import'), claude('Built.', ...files.map(file => edit(file))))

    expect(set.of('amend_memory')).toEqual([
      { atom_id: OWN, op: 'fix', anchors: [{ path: 'src/a.py' }, { path: 'src/b.py' }, { path: 'src/c.py' }] },
    ])
  })

  test('a record that already points at its code is given no more by a later pairing', async ($, on) => {
    const LOCK = decision({ anchors: [{ path: 'src/queue/lock.ts' }] })
    const set = stage(on, { git: gitStatus([]), replies: [verdict({ records: [LOCK] }), later(['src/queue/worker.ts'])] })

    await $.session.start(START)
    await turn($, set, dev('build the lock'), claude('Built.', edit('src/queue/lock.ts')))
    await turn($, set, dev('and the worker'), claude('Built.', edit('src/queue/worker.ts')))

    expect(set.of('remember')[0]?.anchors).toEqual([{ path: 'src/queue/lock.ts' }])
    expect(set.of('amend_memory')).toEqual([])
  })

  test('a record rewritten in place keeps the places the rewrite names', async ($, on) => {
    const reworded = {
      ...OUTBOX_DECISION,
      detail: 'It commits with the import, and needs no new service.',
      anchors: [{ path: OUTBOX }],
      updates: OWN,
    }
    const set = stage(on, {
      git: gitStatus([PLAN_FILE]),
      replies: [verdict({ records: [OUTBOX_DECISION] }), verdict({ records: [reworded] })],
    })

    await $.session.start(START)
    await turn($, set, dev(`plan the L5/L6 partial confirmations ${TALK}`), claude('Planned.', writePlan))
    await turn($, set, dev('build the outbox, it also saves a service'), claude('Built.', edit(OUTBOX)))

    expect(set.of('amend_memory')).toMatchObject([{ atom_id: OWN, op: 'fix', anchors: [{ path: OUTBOX }] }])
  })

  test('a spec the repository keeps still anchors; one git was never given, or ignores, does not', async ($, on) => {
    const SPEC = 'docs/specs/import.md'
    const DRAFT = 'docs/specs/export.md'
    const GENERATED = 'gen/client.py'
    const set = stage(on, {
      git: gitStatus([DRAFT], [GENERATED]),
      replies: [
        verdict({
          records: [
            decision({ anchors: [{ path: SPEC }] }),
            decision({ content: 'Export runs nightly, not on demand.', anchors: [{ path: DRAFT }, { path: GENERATED }] }),
          ],
        }),
      ],
    })

    await $.session.start(START)
    await turn(
      $,
      set,
      dev(`read the specs ${TALK}`),
      claude(
        'Read.',
        use('Read', { file_path: `${ROOT}/${SPEC}` }, 'Import spec.'),
        use('Read', { file_path: `${ROOT}/${DRAFT}` }, 'Export spec.'),
        use('Read', { file_path: `${ROOT}/${GENERATED}` }, 'client'),
      ),
    )

    expect(set.of('remember').map(args => args.anchors)).toEqual([[{ path: SPEC }], undefined])
  })
})

describe('what is a working file, by git first and by its name where git cannot say', () => {
  const KEPT_DOCS = [
    'docs/planning-guide.md',
    'docs/specs/plan-format.md',
    'docs/billing-plans.md',
    'docs/pricing-plans.md',
    'RELEASE_NOTES.md',
    'docs/release-notes.md',
    'docs/notes-api.md',
    'docs/draft-standard.md',
    'docs/handoff-protocol.md',
    'packages/notes/README.md',
    'services/plans/README.md',
  ]

  /**
   * Each of `paths` read in the session, three to a turn, and a decision
   * anchored to each: the paths whose decision was written with its anchor.
   */
  async function anchored($: Engine, on: Parameters<typeof stage>[0], git: StageOptions['git'], paths: readonly string[]) {
    const turns = Array.from({ length: Math.ceil(paths.length / 3) }, (_, n) => paths.slice(n * 3, n * 3 + 3))
    const set = stage(on, {
      git,
      replies: turns.map((chunk, n) =>
        verdict({ records: chunk.map((path, at) => decision({ content: `Use way ${n * 3 + at} for the import.`, anchors: [{ path }] })) }),
      ),
    })

    await $.session.start(START)

    for (const chunk of turns) {
      await turn($, set, dev(`read these ${TALK}`), claude('Read.', ...chunk.map(path => use('Read', { file_path: `${ROOT}/${path}` }, 'text'))))
      await set.clock.advance(180_000)
    }

    expect(set.of('remember').length, 'every decision is written').toBe(paths.length)

    return set.of('remember').flatMap((args, n) => (args.anchors === undefined ? [] : [paths[n]]))
  }

  test('by git: a document it keeps is an anchor whatever it is called; new code is one before it is committed; a document it was never given, and anything it ignores, is not', async ($, on) => {
    const NOT = ['scratch/try.py', 'docs/specs/import.md', 'build/out.py']
    const KEPT = [...KEPT_DOCS, PLAN_FILE, 'NOTES.md', OUTBOX]

    expect(await anchored($, on, gitStatus([OUTBOX, 'scratch/try.py', 'docs/specs/import.md'], ['build/out.py']), [...KEPT, ...NOT])).toEqual(KEPT)
  })

  test('by git status as it prints it, file by file: an ignored folder holds what lies in it', async ($, on) => {
    const porcelain = '?? new.md\0!! build/\0R  moved.ts\0old.ts\0 M changed.ts\0'
    const git = (args: readonly string[]) => (args[0] === 'status' ? { exitCode: 0, stdout: porcelain } : undefined)

    expect(await anchored($, on, git, ['new.md', 'build/x.py', 'moved.ts', 'old.ts', 'changed.ts', 'kept.ts'])).toEqual([
      'moved.ts',
      'old.ts',
      'changed.ts',
      'kept.ts',
    ])
  })

  test('by name, where git cannot say: only a whole word that says plan, notes, to-do, draft or scratch marks a working file', async ($, on) => {
    // `plan-format` begins with the word plan: only git can tell it from a plan of the work.
    const KEPT = [...KEPT_DOCS.filter(one => one !== 'docs/specs/plan-format.md'), 'src/billing/plans/pricing.ts', 'docs/specs/import.md']
    const WORKING = [PLAN_FILE, 'docs/auth-plan.md', 'TODO.md', 'NOTES.md', 'plan.md', 'wip_auth.md', '.claude/plans/x.md', 'scratch/try.py']

    expect(await anchored($, on, undefined, [...KEPT, ...WORKING])).toEqual(KEPT)
  })

  test('a decision or a gotcha without its code waits for it, a correction for nothing; a manifest written as text is code, prose is not', async ($, on) => {
    const GOTCHA = { kind: 'gotcha', content: 'Run the import before the worker starts.', detail: 'It fails otherwise.', triggers: ['import run'], anchors: [] }
    const CORRECTION = { kind: 'correction', content: 'The import is not retried on failure.', detail: '', anchors: [] }
    const set = stage(on, {
      git: gitStatus([PLAN_FILE]),
      replies: [
        verdict({ records: [OUTBOX_DECISION, GOTCHA, CORRECTION] }),
        later(['docs/notes.txt']),
        JSON.stringify({
          outcome: 'act',
          records: [],
          anchor: [
            { id: idOf(101), paths: ['requirements.txt', 'CMakeLists.txt'] },
            { id: idOf(102), paths: ['requirements.txt'] },
            { id: idOf(103), paths: ['requirements.txt'] },
          ],
        }),
      ],
    })

    await $.session.start(START)
    await turn($, set, dev(`plan the L5/L6 partial confirmations ${TALK}`), claude('Planned.', writePlan))
    await turn($, set, dev('write the notes down'), claude('Written.', edit('docs/notes.txt')))

    expect(set.of('amend_memory'), 'prose is never a later place').toEqual([])

    await set.clock.advance(180_000)
    await turn($, set, dev('pin the dependencies and the build'), claude('Pinned.', edit('requirements.txt'), edit('CMakeLists.txt')))

    expect(set.of('amend_memory')).toEqual([
      { atom_id: idOf(101), op: 'fix', anchors: [{ path: 'requirements.txt' }, { path: 'CMakeLists.txt' }] },
      { atom_id: idOf(102), op: 'fix', anchors: [{ path: 'requirements.txt' }] },
    ])
  })
})

describe('a file’s place in the tree', () => {
  test('a file in the tree is named from its root; a file outside it, or a path that climbs, is named in full and anchors nothing', async ($, on) => {
    const OUTSIDE = ['/work/repo-other/a.ts', '/etc/passwd', '/work/repo', '../a.ts', 'src/../a.ts', 'a\\b.ts', 'C:/a.ts', 'src/', `src/${'x'.repeat(400)}.ts`]
    const set = stage(on, {
      replies: [verdict({ records: [decision({ anchors: [{ path: 'src/a.ts' }, ...OUTSIDE.map(path => ({ path }))] })] })],
    })

    await $.session.start(START)
    await turn(
      $,
      set,
      dev(`change them all ${TALK}`),
      claude('Done.', ...['./src/a.ts', ...OUTSIDE].map(path => use('Edit', { file_path: path, old_string: 'a', new_string: 'b' }))),
    )

    const prompt = set.asked[0]?.prompt ?? ''

    expect(prompt).toMatch('[tool] Edit src/a.ts ok')

    for (const path of OUTSIDE) {
      expect(prompt, path).toMatch(`[tool] Edit ${path} (outside the working tree) ok`)
    }

    expect(set.of('remember')[0]?.anchors).toEqual([{ path: 'src/a.ts' }])
  })
})

describe('a record as Fylgja sends it', () => {
  test('is read from either shape of its anchors; one that is no record, or comes twice, is left out', async ($, on) => {
    const set = stage(on, {
      tools: {
        recall: () =>
          answer({
            facts: [
              fact(1, { content: 'FIRST-RECORD', anchors: { paths: [{ path: 'src/a.ts', symbol: 'f', added_by: 'author' }], commits: [{ sha: '1a2b3c4', added_by: 'author' }] } }),
              fact(2, { content: 'SECOND-RECORD', anchors: [{ kind: 'path', ref: 'src/b.ts' }, { kind: 'commit', ref: '1a2b3c4' }] }),
              { id: 'not-an-id', content: 'NO-ID-RECORD' },
              { id: idOf(3) },
              fact(1, { content: 'FIRST-RECORD' }),
            ],
          }),
      },
    })

    await $.session.start(START)
    await turn($, set, dev(`change both ${TALK}`), claude('Done.', edit('src/a.ts'), edit('src/b.ts')))

    const prompt = set.asked[0]?.prompt ?? ''

    expect(prompt.match(/<<< record id=/g)?.length).toBe(2)
    expect(prompt).toMatch(`id=${idOf(1)} kind=decision`)
    expect(prompt).toMatch(/FIRST-RECORD\n(?:.*\n)*?Anchored to: src\/a\.ts/)
    expect(prompt).toMatch(/SECOND-RECORD\n(?:.*\n)*?Anchored to: src\/b\.ts/)
    expect(prompt).not.toMatch('NO-ID-RECORD')
  })
})
