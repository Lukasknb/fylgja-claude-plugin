import { describe, expect, test } from 'claude-code/testing'

import { fingerprintOf } from '../hooks/scribe/fingerprint'
import { answer, idOf } from './fixtures'
import { claude, decision, dev, edit, fact, gitStatus, NOTHING, pressTwice, REPO, ROOT, SESSION_ID, shown, stage, START, turn, use, verdict } from './scribe-fixtures'

const LOCK = 'src/queue/lock.ts'
const WORKER = 'src/queue/worker.ts'
const LOCK_TEXT = 'import { db } from "./db"\n\nexport function acquire(key: string) {\n  return db.lock(key)\n}\n'
const STORED = `f1:${'0'.repeat(32)}`
const origin = (name: string): string => `[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:${name}.git\n`
const bash = (command: string, text = '') => use('Bash', { command }, text)

describe('a record is written with how the code it is anchored to reads', () => {
  test('each anchor whose file can be read goes with its fingerprint, and one that cannot be read goes without', async ($, on) => {
    const set = stage(on, {
      files: { [`${ROOT}/${LOCK}`]: LOCK_TEXT, [`${ROOT}/${WORKER}`]: null },
      replies: [verdict({ records: [decision({ anchors: [{ path: LOCK, symbol: 'acquire' }, { path: WORKER }] })] }), NOTHING],
    })

    await $.session.start(START)
    await turn($, set, dev('Use Postgres advisory locks for the job queue.'), claude('Done.', edit(LOCK), edit(WORKER)))

    expect(set.of('remember').length).toBe(1)
    expect(set.of('remember')[0]?.anchors).toEqual([
      { path: LOCK, symbol: 'acquire', fingerprint: await fingerprintOf(LOCK_TEXT, 'acquire') },
      { path: WORKER },
    ])
    expect(set.reads.filter(path => path.endsWith('.ts')), 'only the anchored files are read').toEqual([`${ROOT}/${LOCK}`, `${ROOT}/${WORKER}`])
  })
})

describe('a lookup holds the files against what Fylgja remembers of them', () => {
  const OLD = fact(5, { content: 'Use Redis with Redlock for the job queue.', anchors: [{ path: LOCK, fingerprint: STORED }] })
  const MARKED = { ...OLD, staleness: 'code_changed', code_changed: { sha: null, at: '2026-10-28T10:00:00Z', paths: [LOCK] } }

  test('a file that reads otherwise is asked about once more with how it reads, and Fylgja’s mark on the record brings the question', async ($, on) => {
    let isStamped = false
    const set = stage(on, {
      files: { [`${ROOT}/${LOCK}`]: LOCK_TEXT },
      tools: {
        // Stamped by the reading it was sent, Fylgja holds the record as changed until it is confirmed.
        recall: args => {
          isStamped ||= args.seen !== undefined

          return answer({ repo: REPO, facts: [isStamped ? MARKED : OLD] })
        },
        remember: () => answer({ atom_id: idOf(5), outcome: 'reconfirmed', supersede: 'not_requested' }),
      },
    })
    const now = await fingerprintOf(LOCK_TEXT, undefined, 'f1')

    await $.session.start(START)
    await turn($, set, dev('Change the queue lock.'), claude('Done.', edit(LOCK)))

    expect(set.of('recall')).toEqual([
      { repo: REPO, paths: [LOCK] },
      { repo: REPO, paths: [LOCK], seen: [{ path: LOCK, fingerprint: now }] },
    ])
    expect(await shown($)).toMatch(`Its code changed since it was last confirmed: ${LOCK}`)

    await pressTwice($, 'holds')

    expect(set.of('remember'), '“Still holds” sends how the file reads now, and nothing else of it').toEqual([
      {
        content: 'Use Redis with Redlock for the job queue.',
        repo: REPO,
        kind: 'decision',
        author: 'scribe',
        session_id: SESSION_ID,
        detail: 'Direct calls dropped mail when the provider throttled.',
        anchors: [{ path: LOCK, fingerprint: now }],
        alternatives: ['direct SMTP call'],
        reason_status: 'stated',
        recalled_atom_id: idOf(5),
      },
    ])
  })

  test('a file that reads as remembered, or cannot be read, is not asked about again', async ($, on) => {
    const kept = await fingerprintOf(LOCK_TEXT, undefined, 'f1')
    const same = fact(5, { anchors: [{ path: LOCK, fingerprint: kept }, { path: WORKER, fingerprint: STORED }] })
    const set = stage(on, { files: { [`${ROOT}/${LOCK}`]: LOCK_TEXT, [`${ROOT}/${WORKER}`]: null }, tools: { recall: () => answer({ repo: REPO, facts: [same] }) } })

    await $.session.start(START)
    await turn($, set, dev('Change the queue lock.'), claude('Done.', edit(LOCK), edit(WORKER)))

    expect(set.of('recall')).toEqual([{ repo: REPO, paths: [LOCK, WORKER] }])
  })
})

describe('what is never read for a fingerprint', () => {
  test('a file that holds secrets by its name, or one git ignores, is not read, whoever anchored a record to it', async ($, on) => {
    const ENV = 'apps/api/.env'
    const CACHE = 'build/cache.ts'
    const theirs = fact(5, { anchors: [{ path: ENV }, { path: CACHE }, { path: LOCK }] })
    const set = stage(on, {
      git: gitStatus([], [CACHE]),
      files: { [`${ROOT}/${ENV}`]: 'TOKEN=hunter2', [`${ROOT}/${CACHE}`]: 'cache', [`${ROOT}/${LOCK}`]: LOCK_TEXT },
      tools: { recall: () => answer({ repo: REPO, facts: [theirs] }) },
    })

    await $.session.start(START)
    await turn($, set, dev('Change the queue lock and the settings.'), claude('Done.', edit(LOCK), edit(ENV), edit(CACHE)))

    expect(set.reads).not.toContain(`${ROOT}/${ENV}`)
    expect(set.reads).not.toContain(`${ROOT}/${CACHE}`)
    expect(set.of('recall').at(-1)?.seen, 'only the code is').toEqual([{ path: LOCK, fingerprint: await fingerprintOf(LOCK_TEXT, undefined, 'f1') }])
  })

  test('a file a teammate anchored that this session never opened is read only once git says it may be', async ($, on) => {
    const LOCAL = 'config/local.json'
    const theirs = fact(5, { anchors: [{ path: LOCAL }, { path: LOCK }] })
    const files = { [`${ROOT}/${LOCAL}`]: '{"token": "x"}', [`${ROOT}/${LOCK}`]: LOCK_TEXT }
    const ignoring = stage(on, { git: gitStatus([], [LOCAL]), files, tools: { recall: () => answer({ repo: REPO, facts: [theirs] }) } })

    await $.session.start(START)
    await turn($, ignoring, dev('Change the queue lock.'), claude('Done.', edit(LOCK)))

    expect(ignoring.reads, 'git ignores it').not.toContain(`${ROOT}/${LOCAL}`)
    expect(ignoring.of('recall').at(-1)?.seen).toEqual([{ path: LOCK, fingerprint: await fingerprintOf(LOCK_TEXT, undefined, 'f1') }])
  })

  test('where git cannot say, only a file this session opened is read', async ($, on) => {
    const LOCAL = 'config/local.json'
    const theirs = fact(5, { anchors: [{ path: LOCAL }, { path: LOCK }] })
    const set = stage(on, {
      files: { [`${ROOT}/${LOCAL}`]: '{"token": "x"}', [`${ROOT}/${LOCK}`]: LOCK_TEXT },
      tools: { recall: () => answer({ repo: REPO, facts: [theirs] }) },
    })

    await $.session.start(START)
    await turn($, set, dev('Change the queue lock.'), claude('Done.', edit(LOCK)))

    expect(set.reads).not.toContain(`${ROOT}/${LOCAL}`)
    expect(set.reads).toContain(`${ROOT}/${LOCK}`)
  })

  test('a record already marked for a file is not asked about it again', async ($, on) => {
    const marked = { ...fact(5, { anchors: [{ path: LOCK, fingerprint: STORED }] }), staleness: 'code_changed', code_changed: { sha: null, at: '2026-10-28T10:00:00Z', paths: [LOCK] } }
    const set = stage(on, { files: { [`${ROOT}/${LOCK}`]: LOCK_TEXT }, tools: { recall: () => answer({ repo: REPO, facts: [marked] }) } })

    await $.session.start(START)
    await turn($, set, dev('Change the queue lock.'), claude('Done.', edit(LOCK)))

    expect(set.of('recall')).toEqual([{ repo: REPO, paths: [LOCK] }])
  })
})

describe('code a shell command writes is where a waiting decision may be placed', () => {
  const OUTBOX = 'src/import/outbox.py'
  const OWN = idOf(101)
  const waiting = decision({
    content: 'Trigger the agent turn after an ERP update with an outbox event written in the import transaction.',
    detail: 'The event commits or rolls back with the import itself.',
    anchors: [],
  })
  const later = JSON.stringify({ outcome: 'act', records: [], anchor: [{ id: OWN, paths: [OUTBOX] }] })

  for (const [how, command] of [
    ['an in-place sed', `sed -i 's/queue/outbox/' ${OUTBOX}`],
    ['an in-place sed as macOS writes it, the script unquoted', `sed -i '' s/queue/outbox/ ${OUTBOX}`],
    ['a here-document written into the file', `cat > ${OUTBOX} <<'EOF'\nprint("outbox")\nEOF`],
    ['a move onto the file', `mv /tmp/outbox.py ${OUTBOX}`],
    ['a copy onto it from another folder', `cd /tmp && cp outbox.py ${ROOT}/${OUTBOX}`],
  ] as const) {
    test(how, async ($, on) => {
      const set = stage(on, { git: gitStatus([OUTBOX]), replies: [verdict({ records: [waiting] }), later] })

      await $.session.start(START)
      await turn($, set, dev(`we go with an outbox ${'x'.repeat(260)}`), claude('Agreed.'))
      await turn($, set, dev('now write it'), claude('Written.', bash(command)))

      expect(set.of('amend_memory')).toEqual([{ atom_id: OWN, op: 'fix', anchors: [{ path: OUTBOX }] }])
    })
  }

  test('a command that only reads the file places nothing', async ($, on) => {
    const set = stage(on, { git: gitStatus([OUTBOX]), replies: [verdict({ records: [waiting] }), later] })

    await $.session.start(START)
    await turn($, set, dev(`we go with an outbox ${'x'.repeat(260)}`), claude('Agreed.'))
    await turn($, set, dev('show it'), claude('Here.', bash(`sed -n 1,20p ${OUTBOX} > /dev/null && cat ${OUTBOX} 2>/tmp/err.log`)))

    expect(set.of('amend_memory')).toEqual([])
  })
})

describe('every commit is attached where it was made, or said not to be', () => {
  const SIBLING = { '/work/other/.git': '', '/work/other/.git/config': origin('acme/other') }

  test('a commit in a session with no repository of its own is reported, never let go unsaid', async ($, on) => {
    const set = stage(on, { repo: null, cwdNow: () => '/work', files: SIBLING })

    await $.session.start({ ...START, cwd: '/work' })
    await turn(
      $,
      set,
      dev('fix the other service'),
      claude('Done.', use('Edit', { file_path: '/work/other/lib/y.ts', old_string: 'a', new_string: 'b' }), bash('git commit -am fix', '[main 1a2b3c4] fix\n 1 file changed')),
    )

    expect(set.of('attach_commit')).toEqual([])
    expect(set.events('commit').map(event => event.props)).toEqual([{ rule: 'none_no_repo', files_sent: 0, is_attached: false }])
  })

  test('a commit made in another repository the session changed files in is attached there, with no file named', async ($, on) => {
    const set = stage(on, { files: SIBLING })

    await $.session.start(START)
    await turn(
      $,
      set,
      dev('fix the other service too'),
      claude(
        'Done.',
        use('Edit', { file_path: '/work/other/lib/y.ts', old_string: 'a', new_string: 'b' }),
        bash('git -C /work/other commit -am fix', '[main 1a2b3c4] fix\n 1 file changed'),
        bash('git -C /work/elsewhere commit -am fix', '[main 2b3c4d5] fix\n 1 file changed'),
      ),
    )

    expect(set.of('attach_commit'), 'and none where the session changed nothing').toEqual([{ repo: 'acme/other', sha: '1a2b3c4', session_id: SESSION_ID }])
    expect(set.events('commit').map(event => event.props)).toMatchObject([{ rule: 'none_away', files_sent: 0, is_attached: true }])
  })
})

describe('the places a record was not given are counted', () => {
  test('by why, and nothing of the places themselves', async ($, on) => {
    const PLAN = 'docs/plan-queue.md'
    const set = stage(on, {
      git: gitStatus([PLAN]),
      replies: [verdict({ records: [decision({ anchors: [{ path: 'src/never/opened.ts' }, { path: PLAN }, { path: LOCK }] })] }), NOTHING],
    })

    await $.session.start(START)
    await turn($, set, dev('Use Postgres advisory locks for the job queue.'), claude('Done.', edit(LOCK), use('Write', { file_path: `${ROOT}/${PLAN}`, content: '# Queue' })))

    expect(set.of('remember')[0]?.anchors).toEqual([{ path: LOCK }])
    expect(set.events('anchors_dropped').map(event => event.props)).toEqual([
      { not_known: 1, working_file: 0, ignored: 0, untracked_doc: 1, other_repo: 0, plan_not_kept: 0 },
    ])
  })
})
