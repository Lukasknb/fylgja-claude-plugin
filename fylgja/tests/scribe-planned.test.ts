import { describe, expect, test } from 'claude-code/testing'

import { answer, idOf } from './fixtures'
import { claude, decision, dev, edit, fact, finish, press, REPO, ROOT, send, shown, stage, START, turn, typing, use } from './scribe-fixtures'

const TALK = 'x'.repeat(260)
const PLAN = ['# Plan: nightly export', '', '## Locking', '', 'Use Postgres advisory locks, not Redis.'].join('\n')
const WP = '7a1c0de0-0000-4000-8000-0000000000aa'
const SPEC = `${ROOT}/docs/specs/export.md`
const numbered = (text: string) =>
  text
    .split('\n')
    .map((line, at) => `${String(at + 1).padStart(6)}→${line}`)
    .join('\n')
const approved = (plan = PLAN) => claude('Here is the plan.', use('ExitPlanMode', { plan }))
/** What `push_work_package` answers for a plan with no units. */
const filing = {
  push_work_package: () =>
    answer({ outcome: 'created', units_created: 0, units_kept: 0, units_removed: 0, units_orphaned: 0, work_package_id: WP }),
}
const UNDER_PLAN = decision({ plan: { doc: 1, section: 'Locking' }, stage: 'planned', anchors: [] })
const act = (parts: Record<string, unknown>): string => JSON.stringify({ outcome: 'act', records: [], question: null, tells: [], ...parts })
const refusedWith = (code: string) => () => ({
  content: [{ type: 'text', text: `refused:${code} — the plan is not filed; name the project with project_name` }],
  isError: true,
})

describe('Scribe files a plan as a work package and the decisions under it as planned', () => {
  test('an approved plan is pushed once, by repository and title and without units; approving it again pushes nothing', async ($, on) => {
    const set = stage(on, { tools: filing })

    await $.session.start(START)
    await turn($, set, dev(`plan it ${TALK}`), approved())
    await turn($, set, dev(`looks good ${TALK}`), approved())

    expect(set.asked.length, 'both turns were looked at').toBe(2)
    expect(set.of('push_work_package')).toEqual([{ repo: REPO, title: 'Plan: nightly export' }])
    expect(set.of('push_work_package')[0], 'units are left to the package').not.toHaveProperty('units')
    expect(set.asked[1]?.prompt, 'the plan reads as filed').toMatch('; filed in Fylgja)')
  })

  test('a plan presented but not yet answered is no approved plan: nothing is pushed', async ($, on) => {
    const set = stage(on, { tools: filing })

    await $.session.start(START)
    await turn($, set, dev(`plan it ${TALK}`), claude('Here is the plan.', { ...use('ExitPlanMode', { plan: PLAN }), text: undefined }))

    expect(set.asked.length).toBe(1)
    expect(set.of('push_work_package')).toEqual([])
  })

  test('a plan document only read is no plan of the session’s: nothing is pushed, and a decision citing it has no stage', async ($, on) => {
    const set = stage(on, { tools: filing, replies: [act({ records: [UNDER_PLAN] })] })

    await $.session.start(START)
    await turn($, set, dev(`read the spec ${TALK}`), claude('Read.', use('Read', { file_path: SPEC }, numbered(PLAN))))

    expect(set.asked.length).toBe(1)
    expect(set.of('push_work_package')).toEqual([])
    expect(set.of('remember').length).toBe(1)
    expect(set.of('remember')[0]).not.toHaveProperty('stage')
    expect(set.of('remember')[0]).not.toHaveProperty('work_package_id')
  })

  test('a plan document read and then edited in the session is pushed once, and a decision under it is planned', async ($, on) => {
    const set = stage(on, { tools: filing, replies: [act({}), act({ records: [UNDER_PLAN] })] })

    await $.session.start(START)
    await turn($, set, dev(`read the spec ${TALK}`), claude('Read.', use('Read', { file_path: SPEC }, numbered(PLAN))))
    await turn(
      $,
      set,
      dev(`tighten the locking section ${TALK}`),
      claude('Edited.', use('Edit', { file_path: SPEC, old_string: 'not Redis.', new_string: 'not Redis, held per job.' })),
    )

    expect(set.of('push_work_package')).toEqual([{ repo: REPO, title: 'Plan: nightly export' }])
    expect(set.of('remember')[0]).toMatchObject({ stage: 'planned', work_package_id: WP })
  })

  test('under the plan: the stage the model gave and the work package; no stage when it gave none; under no plan neither', async ($, on) => {
    const set = stage(on, {
      tools: filing,
      replies: [
        act({ records: [UNDER_PLAN] }),
        act({ records: [decision({ content: 'Export rows are claimed with SKIP LOCKED.', plan: { doc: 1, section: null }, anchors: [] })] }),
        act({ records: [decision({ content: 'Retry failed mail sends with backoff.', anchors: [] })] }),
      ],
    })

    await $.session.start(START)
    await turn($, set, dev(`plan it ${TALK}`), approved())
    await turn($, set, dev(`how are rows claimed? ${TALK}`), claude('With SKIP LOCKED.'))
    await turn($, set, dev(`and the mail retries? ${TALK}`), claude('Backoff it is.'))

    const sent = set.of('remember')

    expect(sent.length).toBe(3)
    expect(sent[0]).toMatchObject({ stage: 'planned', work_package_id: WP })
    expect(sent[1]).toMatchObject({ work_package_id: WP })
    expect(sent[1]).not.toHaveProperty('stage')
    expect(sent[2]).not.toHaveProperty('stage')
    expect(sent[2]).not.toHaveProperty('work_package_id')
  })

  for (const code of ['project_not_resolved', 'plan_archived', 'title_taken', 'plan_withdrawn']) {
    test(`a push refused with ${code}: pushed once, and decisions go as planned without a package`, async ($, on) => {
      const set = stage(on, {
        tools: { push_work_package: refusedWith(code) },
        replies: [
          act({ records: [UNDER_PLAN] }),
          act({ records: [decision({ content: 'Claim export rows with SKIP LOCKED.', plan: { doc: 1, section: null }, stage: 'planned', anchors: [] })] }),
        ],
      })

      await $.session.start(START)
      await turn($, set, dev(`plan it ${TALK}`), approved())
      await turn($, set, dev(`refine it ${TALK}`), approved(`${PLAN}\n\nClaim rows with SKIP LOCKED.`))

      expect(set.of('push_work_package').length, 'one attempt per plan, no retry').toBe(1)
      expect(set.of('remember').length).toBe(2)

      for (const args of set.of('remember')) {
        expect(args).toMatchObject({ stage: 'planned' })
        expect(args).not.toHaveProperty('work_package_id')
      }
    })
  }

  test('a server from before stages: the write is sent again without stage and package, and none is sent them again', async ($, on) => {
    let written = 0
    const set = stage(on, {
      tools: {
        ...filing,
        remember: (args: Record<string, unknown>) => {
          if ('stage' in args || 'work_package_id' in args) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'invalid arguments: an argument this tool does not take (it takes: alternatives, anchors, applies_to, content, detail, kind, reason_status, repo, session_id)',
                },
              ],
              isError: true,
            }
          }

          written += 1

          return answer({ atom_id: idOf(200 + written), outcome: 'created', supersede: 'not_requested' })
        },
      },
      replies: [
        act({ records: [{ ...UNDER_PLAN, applies_to: ['Northwind'] }] }),
        act({ records: [decision({ content: 'Claim export rows with SKIP LOCKED.', plan: { doc: 1, section: null }, stage: 'planned', anchors: [] })] }),
      ],
    })

    await $.session.start(START)
    await turn($, set, dev(`plan it, this is for Northwind ${TALK}`), approved())
    await turn($, set, dev(`refine it ${TALK}`), claude('Refined.'))

    const sent = set.of('remember')

    expect(sent.length).toBe(3)
    expect(sent[0]).toMatchObject({ stage: 'planned', work_package_id: WP })
    expect(sent[1], 'where it holds is still sent').toMatchObject({ applies_to: ['Northwind'] })
    expect(sent[1]).not.toHaveProperty('stage')
    expect(sent[2]).not.toHaveProperty('stage')
    expect(sent[2]).not.toHaveProperty('work_package_id')
  })
})

describe('Scribe proposes withdrawing a plan, and withdraws only on the developer’s yes', () => {
  const PLANNED_D = { id: idOf(1), content: 'Export the ledger as CSV every night.', stage: 'planned' }
  const BUILT_D = { id: idOf(2), content: 'Use Postgres advisory locks for the export job.', stage: 'built' }
  const PACKAGE = {
    ...filing,
    get_work_package: () =>
      answer({
        work_package_id: WP,
        title: 'Plan: nightly export',
        decisions: [PLANNED_D, BUILT_D],
        decisions_planned: 1,
        decisions_built: 1,
        completed_at: null,
        withdrawn_at: null,
        withdrawn_by_user_id: null,
        withdrawn_reason: null,
      }),
    withdraw_work_package: (args: Record<string, unknown>) =>
      answer({
        work_package_id: WP,
        outcome: 'withdrawn',
        withdrawn_at: '2026-11-04T20:10:00Z',
        reason: args.reason,
        withdrawn: [PLANNED_D],
        kept_built: [BUILT_D],
      }),
    complete_work_package: () =>
      answer({ work_package_id: WP, outcome: 'completed', completed_at: '2026-11-04T20:10:00Z', decisions_planned: 0, decisions_built: 2 }),
  }
  const REASON = 'The changes stream over the webhook, so the nightly export is not built.'
  const DROP = act({ withdraw_plan: { plan: 1, reason: REASON } })
  const dropping = [dev(`forget the nightly export, stream the changes over the webhook instead ${TALK}`), claude('Switching to the webhook stream.')] as const

  test('the proposal is one question with what it would do; nothing is withdrawn before the yes, and the yes withdraws once', async ($, on) => {
    const set = stage(on, { tools: PACKAGE, replies: [act({}), DROP] })

    await $.session.start(START)
    await turn($, set, dev(`plan it ${TALK}`), approved())
    await turn($, set, ...dropping)

    const card = await shown($)

    expect(card).toMatch('withdraw this plan?')
    expect(card).toMatch('Plan: nightly export')
    expect(card).toMatch(REASON)
    expect(card).toMatch('1 planned decision withdrawn, 1 built kept')
    expect(card).toMatch('Export the ledger as CSV every night.')
    expect(set.of('get_work_package')).toEqual([{ work_package: WP }])
    expect(set.of('withdraw_work_package')).toEqual([])

    await press($, 'withdraw-plan')

    expect(set.of('withdraw_work_package'), 'a single press does nothing').toEqual([])

    await press($, 'withdraw-plan')

    expect(set.of('withdraw_work_package')).toEqual([{ work_package_id: WP, reason: REASON }])
    expect(set.toasts).toEqual(['Withdrawn: 1 planned decision, 1 built kept.'])
  })

  test('no withdraws nothing, and the plan is asked about once a session', async ($, on) => {
    const set = stage(on, { tools: PACKAGE, replies: [act({}), DROP, DROP] })

    await $.session.start(START)
    await turn($, set, dev(`plan it ${TALK}`), approved())
    await turn($, set, ...dropping)

    expect(await shown($)).toMatch('withdraw this plan?')

    await press($, 'skip')
    await turn($, set, ...dropping)

    expect(set.asked.length).toBe(3)
    expect(await shown($), 'asked once a session').not.toMatch('withdraw this plan?')
    expect(set.of('withdraw_work_package')).toEqual([])
  })

  test('still waiting when the developer sends the next prompt, it lapses and is never shown', async ($, on) => {
    const set = stage(on, { tools: PACKAGE, replies: [act({}), DROP, act({})] })

    await $.session.start(START)
    await turn($, set, dev(`plan it ${TALK}`), approved())

    // The developer is typing as the look ends: the question waits in line, not on show.
    const [said, answered] = dropping

    await send($, said.text)
    await typing($, set, 'one more thing')
    await finish($, set, said, answered)
    await turn($, set, dev(`carry on ${TALK}`), claude('Carrying on.'))
    await typing($, set, '')

    expect(set.asked.length).toBe(3)
    expect(await shown($)).not.toMatch('withdraw this plan?')
    expect(set.of('withdraw_work_package')).toEqual([])
  })

  test('still waiting at a compaction, it lapses and is never shown', async ($, on) => {
    on('session.compact', () => ({ messages: [{ role: 'user', text: 'This session is being continued from a previous conversation.', toolUses: [] }] }) as never)
    const set = stage(on, { tools: PACKAGE, replies: [act({}), DROP, act({})] })

    await $.session.start(START)
    await turn($, set, dev(`plan it ${TALK}`), approved())

    const [said, answered] = dropping

    await send($, said.text)
    await typing($, set, 'one more thing')
    await finish($, set, said, answered)

    // The conversation as it is handed over, its calls left out: only that it is compacted matters here.
    const done = await $.session.compact({ trigger: 'manual', messages: set.rows.map(row => ({ ...row, toolUses: [] })) } as never)

    set.rows.splice(0, set.rows.length, ...(done.messages as never[]))
    await typing($, set, '')

    expect(await shown($)).not.toMatch('withdraw this plan?')
    expect(set.of('withdraw_work_package')).toEqual([])
  })

  test('a proposal for a plan Fylgja holds no package of is not put at all', async ($, on) => {
    const set = stage(on, { tools: { ...PACKAGE, push_work_package: refusedWith('project_not_resolved') }, replies: [act({}), DROP] })

    await $.session.start(START)
    await turn($, set, dev(`plan it ${TALK}`), approved())
    await turn($, set, ...dropping)

    expect(set.asked.length).toBe(2)
    expect(await shown($)).not.toMatch('withdraw this plan?')
    expect(set.of('get_work_package')).toEqual([])
  })

  test('planned decisions outside any plan here are proposed by their ids, and the yes withdraws exactly those', async ($, on) => {
    const MEETING = fact(4, { content: 'The platform will export the ledger nightly.', stage: 'planned', anchors: [] })
    const set = stage(on, {
      tools: {
        recall: () => answer({ repo: REPO, facts: [MEETING] }),
        withdraw_decisions: () =>
          answer({
            withdrawn: [{ id: idOf(4), content: 'The platform will export the ledger nightly.', stage: 'planned' }],
            kept: [],
            already_withdrawn: [],
            not_found: [],
          }),
      },
      replies: [act({ withdraw_plan: { ids: [idOf(4), idOf(9)], reason: REASON } })],
    })

    await $.session.start(START)
    await turn($, set, ...dropping)

    const card = await shown($)

    expect(card).toMatch('Plan: 1 planned decision')
    expect(card).toMatch('The platform will export the ledger nightly.')

    await press($, 'withdraw-plan')
    await press($, 'withdraw-plan')

    expect(set.of('withdraw_decisions'), 'only an id a lookup returned as planned').toEqual([{ atom_ids: [idOf(4)], reason: REASON }])
    expect(set.toasts).toEqual(['Withdrawn: 1 planned decision.'])
  })

  test('the developer says the plan is finished: marking it done is asked, and done only on the yes', async ($, on) => {
    const set = stage(on, { tools: PACKAGE, replies: [act({}), act({ complete_plan: { plan: 1 } })] })

    await $.session.start(START)
    await turn($, set, dev(`plan it ${TALK}`), approved())
    await turn($, set, dev(`that was the last step, the export plan is done ${TALK}`), claude('Done.'))

    const card = await shown($)

    expect(card).toMatch('mark this plan done?')
    expect(card).toMatch('1 planned decision recorded as built')
    expect(set.of('complete_work_package')).toEqual([])

    await press($, 'complete-plan')
    await press($, 'complete-plan')

    expect(set.of('complete_work_package')).toEqual([{ work_package_id: WP }])
    expect(set.toasts).toEqual(['Plan marked done: its decisions now read as built.'])
  })
})

describe('a planned decision the session builds is recorded as built', () => {
  const PLANNED = fact(3, { content: 'Use Postgres advisory locks for the job queue.', stage: 'planned', anchors: [{ path: 'src/queue/lock.ts' }] })
  const holding = (one: Record<string, unknown>) => ({ recall: () => answer({ repo: REPO, facts: [one] }) })

  test('the verdict names a recalled planned decision whose code the turn wrote: it is confirmed again, declared built', async ($, on) => {
    const set = stage(on, { tools: holding(PLANNED), replies: [act({ built: [idOf(3)] })] })

    await $.session.start(START)
    await turn($, set, dev(`build the locking ${TALK}`), claude('Built.', edit('src/queue/lock.ts')))

    expect(set.asked[0]?.prompt).toMatch("Stage: planned (decided while planning, not built yet; don't treat it as how the code works)")
    expect(set.of('remember')).toMatchObject([
      { recalled_atom_id: idOf(3), stage: 'built', content: 'Use Postgres advisory locks for the job queue.' },
    ])
    expect(set.of('remember')[0]).not.toHaveProperty('work_package_id')
  })

  test('one whose code the turn did not write is left as it is, though the turn wrote other code', async ($, on) => {
    const set = stage(on, { tools: holding(PLANNED), replies: [act({ built: [idOf(3)] })] })

    await $.session.start(START)
    await turn(
      $,
      set,
      dev(`read the locking and fix the mailer ${TALK}`),
      claude('Done.', use('Read', { file_path: `${ROOT}/src/queue/lock.ts` }, 'code'), edit('src/mail/send.ts')),
    )

    expect(set.asked.length).toBe(1)
    expect(set.of('remember')).toEqual([])
  })

  test('one that points at no code is never taken for built', async ($, on) => {
    const set = stage(on, { tools: holding({ ...PLANNED, anchors: [] }), replies: [act({ built: [idOf(3)] })] })

    await $.session.start(START)
    await turn($, set, dev(`build the locking ${TALK}`), claude('Built.', edit('src/queue/lock.ts')))

    expect(set.asked.length).toBe(1)
    expect(set.of('remember')).toEqual([])
  })
})
