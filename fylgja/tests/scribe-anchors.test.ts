import type { Engine } from 'claude-code/testing'
import { describe, expect, test } from 'claude-code/testing'

import { isAnchorable, isCode, isWaiting, isWorkingFile, statesOf } from '../hooks/scribe/anchoring'
import { GIT_TIMEOUT_MS } from '../hooks/scribe/git'
import { NO_CODE } from '../hooks/scribe/ledger'
import { idOf } from './fixtures'
import { claude, decision, dev, edit, gitStatus, NOTHING, ROOT, SESSION_ID, stage, START, turn, use, verdict } from './scribe-fixtures'
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

const savedRecords = (set: { kept: Map<string, unknown> }) =>
  (set.kept.get(`scribe.list.${SESSION_ID}`) as { records: unknown[] } | undefined)?.records

describe('a plan or notes file is no place for a decision', () => {
  test('a decision anchored to the plan it was made in is written without it, and waits for its code', async ($, on) => {
    frame(on)
    const set = stage(on, { git: gitStatus([PLAN_FILE]), replies: [verdict({ records: [OUTBOX_DECISION] })] })

    await $.session.start(START)
    await turn($, set, dev(`plan the L5/L6 partial confirmations ${TALK}`), claude('Planned.', writePlan))

    expect(set.of('remember').length).toBe(1)
    expect(set.of('remember')[0]?.anchors, 'a plan git was never given is not where the decision lives').toBeUndefined()
    expect(await keptLines($)).toContain(`In: ${NO_CODE}`)
    expect(savedRecords(set), 'saved as waiting for its code').toEqual([{ id: OWN, kind: 'decision', outcome: 'created', waiting: true }])
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
    expect(savedRecords(set), 'no longer waiting').toEqual([{ id: OWN, kind: 'decision', outcome: 'created' }])
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

  test('a document git keeps is an anchor, whatever it is called', () => {
    for (const path of [...KEPT_DOCS, PLAN_FILE, 'NOTES.md']) {
      expect(isAnchorable(path, 'tracked'), path).toBe(true)
    }
  })

  test('by name, only a whole word that says plan, notes, to-do, draft or scratch marks a working file', () => {
    // `plan-format` begins with the word plan: only git can tell it from a plan of the work.
    for (const path of KEPT_DOCS.filter(one => one !== 'docs/specs/plan-format.md')) {
      expect(isWorkingFile(path), path).toBe(false)
    }

    for (const path of [
      PLAN_FILE,
      'docs/auth-plan.md',
      'TODO.md',
      'NOTES.md',
      'plan.md',
      'wip_auth.md',
      '.claude/plans/x.md',
      'scratch/try.py',
    ]) {
      expect(isWorkingFile(path), path).toBe(true)
    }

    expect(isWorkingFile('src/billing/plans/pricing.ts'), 'code in a folder named plans').toBe(false)
    expect(isWorkingFile('docs\\partial-confirmations\\plan-l5-l6.md'), 'a Windows path').toBe(true)
    expect(isWorkingFile('scratch\\try.py'), 'a Windows path').toBe(true)
  })

  test('new code is an anchor before it is committed; a document git was never given is not; nothing git ignores is', () => {
    expect(isAnchorable(OUTBOX, 'untracked')).toBe(true)
    expect(isAnchorable('scratch/try.py', 'untracked')).toBe(false)
    expect(isAnchorable('docs/specs/import.md', 'untracked')).toBe(false)
    expect(isAnchorable('docs/specs/import.md', undefined), 'git could not be asked: the name decides').toBe(true)
    expect(isAnchorable(PLAN_FILE, undefined)).toBe(false)
    expect(isAnchorable('build/out.py', 'ignored')).toBe(false)
  })

  test('a build or package manifest written as text is code; prose is not', () => {
    for (const path of ['requirements.txt', 'requirements-dev.txt', 'apps/api/constraints.txt', 'CMakeLists.txt', 'src\\CMakeLists.txt']) {
      expect(isCode(path), path).toBe(true)
    }

    for (const path of ['docs/notes.txt', 'README.md', 'docs/adr/0007.rst']) {
      expect(isCode(path), path).toBe(false)
    }
  })

  test('a decision or a gotcha waits for its code; a correction waits for nothing', () => {
    expect(isWaiting({ kind: 'decision', anchors: [{ path: 'docs/specs/import.md' }] })).toBe(true)
    expect(isWaiting({ kind: 'gotcha', anchors: [] })).toBe(true)
    expect(isWaiting({ kind: 'correction', anchors: [] })).toBe(false)
    expect(isWaiting({ kind: 'decision', anchors: [{ path: OUTBOX }] })).toBe(false)
  })

  test('git status is read file by file, an ignored folder holding what lies in it', () => {
    const states = statesOf('?? new.md\0!! build/\0R  moved.ts\0old.ts\0 M changed.ts\0', [
      'new.md',
      'build/x.py',
      'moved.ts',
      'old.ts',
      'changed.ts',
      'kept.ts',
    ])

    expect(Object.fromEntries(states)).toEqual({
      'new.md': 'untracked',
      'build/x.py': 'ignored',
      'moved.ts': 'tracked',
      'old.ts': 'tracked',
      'changed.ts': 'tracked',
      'kept.ts': 'tracked',
    })
  })
})
