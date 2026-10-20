import { describe, expect, test } from 'claude-code/testing'

import { MAX_WAKES_PER_HOUR } from '../hooks/scribe/scribe'
import { NOTES } from '../hooks/scribe/view'
import { answer, idOf } from './fixtures'
import {
  band,
  carded,
  claude,
  decision,
  dev,
  edit,
  fact,
  NOTHING,
  press,
  pressTwice,
  QUIET,
  shown,
  stage,
  START,
  turn,
  verdict,
} from './scribe-fixtures'

const TALK = [dev('Use Postgres for the queue lock.'), claude('Done.', edit('src/queue/lock.ts'))]

const refused = (text: string) => ({ content: [{ type: 'text', text }], isError: true })
const created = (n: number) => answer({ atom_id: idOf(n), outcome: 'created', supersede: 'not_requested', note: null })
// The words of the server's gate for this record.
const NOT_IMPERATIVE = `refused:not_imperative — content opens with "We", which tells what happened or what is the case. Rule: content must start with an instruction (Use, Never, Always, Run, Check, Before, When …); a decision or correction may instead read "X is/must/stays Y". State the rule that came out of it, for example "Always <do this> before <that>" or "Check <this> when <that happens>". Acceptable instead: content="Never run terraform apply without -target on the GPU stack" (runbook/gotcha), or content="The live database is fylgja_rebuild" (decision/correction)`

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
    content: 'We paginate /audit-log with offset and limit, not a cursor.',
    detail: '',
    reason_status: 'not_stated',
    alternatives: ['a cursor'],
  })
  const MENDED = { ...PAGED, content: 'Use offset and limit to page /audit-log, not a cursor.' }
  const WHY = { form: 'reason', record: 0, options: ['Clients jump to a page', 'Simplest to build'] }

  test('the model is handed the refused record and the refusal, and nothing of the session; what it puts right is sent once', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [PAGED] }), JSON.stringify({ record: MENDED })],
      tools: refusing('We paginate'),
    })

    await $.session.start(START)
    await turn($, set, dev('SESSION-TEXT: page the audit log with offset, go'), claude('Done.', edit('src/queue/lock.ts')))

    const [, correction] = set.asked

    expect(set.asked.length).toBe(2)
    expect(correction?.system).toMatch('A knowledge base refused one record.')
    expect(correction?.prompt).toMatch('"content":"We paginate /audit-log with offset and limit, not a cursor."')
    expect(correction?.prompt).toMatch('refused:not_imperative')
    expect(correction?.prompt, 'the word the server named reaches the model').toMatch('opens with "We"')
    expect(correction?.prompt, 'and so do both of its rewrites').toMatch('"Check <this> when <that happens>"')
    expect(correction?.prompt, 'and the refusal to its end').toMatch('fylgja_rebuild')
    expect(correction?.system).toMatch('When the refusal names the word or the phrase it matched, whatever the rule')
    expect(correction?.prompt).not.toMatch('SESSION-TEXT')
    expect(correction?.prompt.match(/^<<< /gm)?.length, 'both are fenced as data').toBe(2)
    expect(set.of('remember').map(args => args.content)).toEqual([PAGED.content, MENDED.content])
    expect(await shown($)).toMatch('✓ Recorded · Use offset and limit to page /audit-log, not a cursor.')
  })

  test('the question about a record that had to be put right is asked about the record as written', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [PAGED], question: WHY }), JSON.stringify({ record: MENDED })],
      tools: refusing('We paginate'),
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(await shown($)).toMatch('? Why: Use offset and limit to page /audit-log, not a cursor.')
    expect(await shown($)).toMatch(' [1 Clients jump to a page] [2 Simplest to build]')

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
      tools: refusing('We paginate'),
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

  test('a model that thinks again and answers twice is taken at its last whole answer', async ($, on) => {
    const twice = `${JSON.stringify({ record: PAGED })}\n\nWait, that leaves the content unchanged. Corrected answer:\n\n${JSON.stringify({ record: MENDED })}`
    const set = stage(on, { replies: [verdict({ records: [PAGED] }), twice], tools: refusing('We paginate') })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember').map(args => args.content)).toEqual([PAGED.content, MENDED.content])
  })

  test('refused a second time, the record is let go quietly: no third try, nothing shown', async ($, on) => {
    const again = { ...PAGED, content: 'We paginate GET /audit-log with offset and limit.' }
    const set = stage(on, {
      replies: [verdict({ records: [PAGED], question: WHY }), JSON.stringify({ record: again }), NOTHING],
      tools: refusing('We paginate'),
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember').length).toBe(2)
    expect(set.asked.length).toBe(2)
    expect(await shown($)).toBe(QUIET)
    expect(set.toasts).toEqual([])
  })

  for (const [what, reply] of [
    ['says to drop it', '{"drop":true}'],
    ['answers nothing usable', 'I cannot do that.'],
    ['hands the same record back', JSON.stringify({ record: PAGED })],
    [
      'cuts its second thought off',
      `${JSON.stringify({ record: PAGED })}\n\nWait. Corrected answer:\n\n{"record":{"kind":"decision","content":"Use off`,
    ],
  ] as const) {
    test(`a model that ${what} costs no second write`, async ($, on) => {
      const set = stage(on, { replies: [verdict({ records: [PAGED] }), reply], tools: refusing('We paginate') })

      await $.session.start(START)
      await turn($, set, ...TALK)

      expect(set.of('remember').length).toBe(1)
      expect(await shown($)).toBe(QUIET)
    })
  }

  test('the step is one of the wake’s own four: a wake that used them up puts nothing right', async ($, on) => {
    const looking = ['recall', 'search', 'open'].map(tool =>
      JSON.stringify({ tool, args: tool === 'open' ? { id: idOf(1) } : { query: 'audit' } }),
    )
    const set = stage(on, {
      replies: [...looking, verdict({ records: [PAGED] }), JSON.stringify({ record: MENDED })],
      tools: refusing('We paginate'),
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
      tools: { ...refusing('We paginate'), recall: () => answer({ facts: [prior] }) },
      kept: { 'scribe.known': [idOf(5)] },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await press($, 'different')

    expect(set.asked.length).toBe(2)
    expect(set.of('remember').map(args => args.content)).toEqual([PAGED.content, MENDED.content])
    expect(await shown($)).toMatch('✓ Recorded · Use offset and limit to page /audit-log, not a cursor.')
  })

  test('a call that puts a record right outside a wake is one of the hour’s share: with the share used up there is none', async ($, on) => {
    const prior = fact(5, { content: 'Use a cursor to page the audit log.', anchors: { paths: [{ path: 'src/queue/lock.ts' }] } })
    const quiet = Array.from({ length: MAX_WAKES_PER_HOUR - 1 }, () => NOTHING)
    const set = stage(on, {
      replies: [...quiet, verdict({ records: [{ ...PAGED, supersedes: idOf(5) }] }), JSON.stringify({ record: MENDED })],
      tools: { ...refusing('We paginate'), recall: () => answer({ facts: [prior] }) },
      kept: { 'scribe.known': [idOf(5)] },
    })

    await $.session.start(START)

    for (let n = 1; n < MAX_WAKES_PER_HOUR; n += 1) {
      await turn($, set, dev(`routine step number ${n}`), claude('Done.', edit(`src/routine/${n}.ts`)))
      await set.clock.advance(60_000)
    }

    await turn($, set, ...TALK)

    expect(set.asked.length, 'the hour’s share of looks').toBe(MAX_WAKES_PER_HOUR)

    await press($, 'different')

    expect(
      set.of('remember').map(args => args.content),
      'sent once, and refused',
    ).toEqual([PAGED.content])
    expect(set.asked.length, 'and no model is asked to put it right').toBe(MAX_WAKES_PER_HOUR)
  })

  const LEANS = 'refused:leans_on_conversation — "the P2 flag" only means something inside the conversation it came from. Rule: a record is read by someone who never saw this conversation. Name the thing by what it is.'
  const BEHIND = decision({
    content: 'Reopening a closed thread on an ERP update goes behind the P2 flag.',
    detail: 'It is safer than option B.',
    reason_status: 'stated',
    alternatives: ['option B'],
  })
  const NAMED = {
    ...BEHIND,
    content: 'Reopening a closed thread on an ERP update goes behind the partial-sync flag.',
    detail: 'It is safer than resyncing the whole thread on every reopen.',
    alternatives: ['resyncing the whole thread on every reopen'],
  }

  test('a record refused for a label only the session knew is put right by a model that is handed the session, and names the thing', async ($, on) => {
    // Its wording may grow in every part, and it gains no alternative or place it did not have.
    const grown = { ...NAMED, alternatives: [...NAMED.alternatives, 'one nobody weighed'], anchors: [{ path: 'src/invented.ts' }] }
    const set = stage(on, {
      replies: [verdict({ records: [BEHIND] }), JSON.stringify({ record: grown })],
      tools: refusing('Reopening a closed thread on an ERP update goes behind the P2', LEANS),
    })

    await $.session.start(START)
    await turn(
      $,
      set,
      dev('SESSION-TEXT: P2 is the partial-sync flag; option B was resyncing the whole thread on every reopen. Go with P2.'),
      claude('Done.', edit('src/queue/lock.ts')),
    )

    const [, naming] = set.asked

    expect(set.asked.length).toBe(2)
    expect(naming?.system).toMatch('names something by a label that only the session it came from knows')
    expect(naming?.system).toMatch('Take what it stands for from the session and from nowhere else')
    expect(naming?.system).toMatch('If the session does not show what a label stands for, drop the record.')
    expect(naming?.prompt, 'the plugin catches the label itself, in the server\'s words').toMatch(
      'refused:leans_on_conversation — "the P2 flag" only means something inside the conversation it came from',
    )
    expect(naming?.prompt, 'the session the record was taken from is handed over').toMatch('SESSION-TEXT: P2 is the partial-sync flag')
    expect(naming?.prompt.match(/^<<< /gm)?.length, 'all three are fenced as data').toBe(3)
    expect(
      set.of('remember').map(args => [args.content, args.detail, args.alternatives, args.anchors]),
      'only the record put right is sent: it names the thing in the sentence, the reason and the alternative',
    ).toEqual([[NAMED.content, NAMED.detail, NAMED.alternatives, [{ path: 'src/queue/lock.ts', symbol: 'acquire' }]]])
    expect(await shown($)).toMatch('✓ Recorded · Reopening a closed thread on an ERP update goes behind the partial-sync flag.')
  })

  test('a label explained three turns earlier is found there: the lines that mention it are handed over with the turn in hand', async ($, on) => {
    const set = stage(on, {
      replies: [NOTHING, NOTHING, NOTHING, verdict({ records: [BEHIND] }), JSON.stringify({ record: NAMED })],
      tools: refusing('Reopening a closed thread on an ERP update goes behind the P2', LEANS),
    })

    await $.session.start(START)
    await turn($, set, dev('EARLY-TEXT: call the partial-sync flag P2 from here on'), claude('Understood.', edit('src/flags.ts')))
    await turn($, set, dev('rename the importer module'), claude('Done.', edit('src/importer.ts')))
    await turn($, set, dev('UNRELATED-TEXT: add a retry to the upload'), claude('Done.', edit('src/upload.ts')))
    await turn($, set, dev('put reopening behind P2, not option B'), claude('Done.', edit('src/queue/lock.ts')))

    const naming = set.asked.at(-1)

    expect(set.asked.length).toBe(5)
    expect(naming?.system).toMatch('names something by a label that only the session it came from knows')
    expect(naming?.system, 'a real name is kept, as code').toMatch('keep it and put it in backticks')
    expect(naming?.system, 'and the sentence keeps the shape the server takes').toMatch('a decision says what holds')
    expect(naming?.prompt, 'the earlier line that explains the label').toMatch('EARLY-TEXT: call the partial-sync flag P2 from here on')
    expect(naming?.prompt, 'the turn in hand').toMatch('put reopening behind P2, not option B')
    expect(naming?.prompt, 'and no earlier line that does not mention it').not.toMatch('UNRELATED-TEXT')
    expect(naming?.prompt.match(/^<<< /gm)?.length, 'fenced as data, as one session').toBe(3)
    expect(set.of('remember').map(args => args.content), 'the leaning wording is never sent').toEqual([NAMED.content])
    expect(await shown($)).toMatch('✓ Recorded · Reopening a closed thread on an ERP update goes behind the partial-sync flag.')
  })

  test('outside a wake there is no session to name the thing from: such a record is let go without a model call', async ($, on) => {
    const prior = fact(5, { content: 'Use a cursor to page the audit log.', anchors: { paths: [{ path: 'src/queue/lock.ts' }] } })
    const set = stage(on, {
      replies: [verdict({ records: [{ ...PAGED, supersedes: idOf(5) }] }), JSON.stringify({ record: MENDED })],
      tools: { ...refusing('We paginate', LEANS), recall: () => answer({ facts: [prior] }) },
      kept: { 'scribe.known': [idOf(5)] },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await press($, 'different')

    expect(set.asked.length, 'no model is asked to guess what the label stood for').toBe(1)
    expect(set.of('remember').map(args => args.content)).toEqual([PAGED.content])
    expect(await shown($)).not.toMatch('✓ Recorded')
  })

  const RULE =
    'Rule: a decision\'s reason is the cause that will still be the cause later, not how things stand today. Give the constraint behind it, or leave the reason unstated: no detail and reason_status="not_stated". Never invent a reason'
  const STATE_IN_REASON = `refused:status_not_memory — in the reason: "cannot be handled yet" says what something is right now. ${RULE}`
  const STATE_IN_OPTION = 'refused:status_not_memory — in a rejected alternative: "is still pending" says what something is right now. Rule: a rejected alternative names the option that was ruled out'
  const STATE_IN_BOTH = `refused:status_not_memory — in the reason: "cannot be handled yet" says what something is right now; in a rejected alternative: "is still pending" says what something is right now. ${RULE}`
  const REOPEN = decision({
    content: 'Reopen a thread into Ready to Sync on an ERP update.',
    detail: 'The pilot org has auto-sync off only because its cases cannot be handled yet.',
    reason_status: 'stated',
    alternatives: ['never acting on a reopened thread', 'wait, since the migration is still pending'],
  })
  const CAUSED = 'Orders with scheduled lines need partial sync, which auto-sync cannot handle; reopening into Ready to Sync keeps a person in the loop for exactly those.'

  /** A server that refuses a decision whose reason says "yet", as it refuses state in a reason, and takes every other. */
  function refusingAStateReason() {
    let n = 0

    return {
      remember: (args: Record<string, unknown>) => {
        if (String(args.detail ?? '').includes('yet')) {
          return refused(STATE_IN_REASON)
        }

        n += 1

        return created(100 + n)
      },
    }
  }

  test('a decision refused for state in its reason is handed the session, and its reason comes back as the cause the session gives, longer than it was', async ($, on) => {
    const caused = { ...REOPEN, content: 'Something else entirely.', detail: CAUSED, alternatives: [] }
    const set = stage(on, {
      replies: [verdict({ records: [REOPEN] }), JSON.stringify({ record: caused })],
      tools: refusingAStateReason(),
    })

    await $.session.start(START)
    await turn(
      $,
      set,
      dev('SESSION-TEXT: Orders with scheduled lines need partial sync, auto-sync cannot do those. Reopen into Ready to Sync.'),
      claude('Done.', edit('src/queue/lock.ts')),
    )

    const [, correction] = set.asked

    expect(set.asked.length).toBe(2)
    expect(correction?.system).toMatch('says how things stand today')
    expect(correction?.system, 'what a reason is').toMatch("A reason is the cause that holds whatever today's settings or progress are")
    expect(correction?.system, 'a general mechanism is no state').toMatch('is fine with "yet" or "still" in it')
    expect(correction?.system, 'and not stated is the last resort').toMatch('Only as the last resort, when neither gives a cause')
    expect(correction?.prompt, 'the field and the wording the server named reach the model').toMatch(
      'in the reason: "cannot be handled yet"',
    )
    expect(correction?.prompt, 'the session the record was taken from is handed over').toMatch('SESSION-TEXT: Orders with scheduled lines need')
    expect(correction?.prompt.match(/^<<< /gm)?.length, 'all three are fenced as data').toBe(3)
    expect(CAUSED.length > String(REOPEN.detail).length).toBe(true)
    expect(set.of('remember').length).toBe(2)
    expect(set.of('remember')[1], 'the sentence and the alternatives are as they were, whatever the answer did to them').toMatchObject({
      content: REOPEN.content,
      detail: CAUSED,
      reason_status: 'stated',
      alternatives: REOPEN.alternatives,
    })
    expect(await shown($)).toMatch('✓ Recorded · Reopen a thread into Ready to Sync on an ERP update.')
  })

  test('when neither the session nor the record gives a cause, the decision is kept and its reason is marked not stated', async ($, on) => {
    const unstated = { ...REOPEN, detail: '', reason_status: 'not_stated' }
    const set = stage(on, {
      replies: [verdict({ records: [REOPEN] }), JSON.stringify({ record: unstated })],
      tools: refusingAStateReason(),
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember')[1]).toMatchObject({
      content: REOPEN.content,
      reason_status: 'not_stated',
      alternatives: REOPEN.alternatives,
    })
    expect(set.of('remember')[1]?.detail).toBeUndefined()
    expect(await shown($)).toMatch('✓ Recorded · Reopen a thread into Ready to Sync on an ERP update.')
  })

  test('a reason that still says how things stand is refused a second time, and the record is let go: no third try', async ($, on) => {
    const still = { ...REOPEN, detail: 'Their cases are not handled yet.' }
    const set = stage(on, {
      replies: [verdict({ records: [REOPEN] }), JSON.stringify({ record: still }), NOTHING],
      tools: refusingAStateReason(),
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember').map(args => args.detail)).toEqual([REOPEN.detail, still.detail])
    expect(set.asked.length).toBe(2)
    expect(await shown($)).toBe(QUIET)
  })

  const OPTIONS = ['never acting on a reopened thread', 'waiting for the migration']

  for (const [what, refusal, mended] of [
    ['about an alternative: the reason is not touched, and no alternative is added', STATE_IN_OPTION, { detail: REOPEN.detail, alternatives: OPTIONS }],
    ['about both: both', STATE_IN_BOTH, { detail: CAUSED, alternatives: OPTIONS }],
    [
      'a field is named ahead of the rule, never by it',
      'refused:status_not_memory — in the reason: "not yet" says. Rule: a rejected alternative: none',
      { detail: CAUSED, alternatives: REOPEN.alternatives },
    ],
  ] as const) {
    test(`a refusal for state changes only the fields it names, ${what}`, async ($, on) => {
      const answered = { ...REOPEN, content: 'Something else entirely.', detail: CAUSED, alternatives: [...OPTIONS, 'one nobody weighed'] }
      let n = 0
      const set = stage(on, {
        replies: [verdict({ records: [REOPEN] }), JSON.stringify({ record: answered })],
        tools: { remember: () => (n++ === 0 ? refused(refusal) : created(101)) },
      })

      await $.session.start(START)
      await turn($, set, ...TALK)

      expect(set.of('remember')[1]).toMatchObject({ content: REOPEN.content, reason_status: 'stated', ...mended })
    })
  }

  // An answer that changes every part of the record: only the part the refusal teaches is taken from it.
  const EVERY = {
    ...MENDED,
    detail: 'Clients jump to a page.',
    reason_status: 'stated',
    alternatives: ['a cursor', 'keyset'],
    anchors: [{ path: 'src/queue/lock.ts', symbol: 'release' }],
  }
  const AS_WRITTEN = {
    content: PAGED.content,
    anchors: [{ path: 'src/queue/lock.ts', symbol: 'acquire' }],
    alternatives: ['a cursor'],
    reason_status: 'not_stated',
  }

  for (const [code, part, mended] of [
    ['too_long', 'content', { content: MENDED.content }],
    ['not_one_sentence', 'content', { content: MENDED.content }],
    ['status_not_memory', 'content', { content: MENDED.content }],
    ['anchor_invalid', 'anchors', { anchors: EVERY.anchors }],
    ['anchors_too_many', 'anchors', { anchors: EVERY.anchors }],
    // A record that had no reason gets none from the answer, and is not said to state one.
    ['reason_missing', 'reason', { alternatives: EVERY.alternatives }],
  ] as const) {
    test(`${code} is taught back once, and mends the ${part}`, async ($, on) => {
      const set = stage(on, {
        replies: [verdict({ records: [PAGED] }), JSON.stringify({ record: EVERY })],
        tools: refusing('We paginate', `refused:${code} — what to do about it`),
      })

      await $.session.start(START)
      await turn($, set, ...TALK)

      expect(set.asked.length).toBe(2)
      expect(set.of('remember')[1]).toMatchObject({ ...AS_WRITTEN, ...mended })
      expect(set.of('remember')[1]?.detail).toBeUndefined()
    })
  }

  for (const [what, detail, sent] of [
    ['a shorter reason is taken', 'Clients jump to a page.', 'Clients jump to a page.'],
    ['a longer one is not', `${'A much longer story. '.repeat(4)}`.trim(), 'Clients jump straight to a page.'],
  ] as const) {
    test(`a mended reason comes back no longer than it was: ${what}`, async ($, on) => {
      const reasoned = { ...PAGED, detail: 'Clients jump straight to a page.', reason_status: 'stated' }
      const set = stage(on, {
        replies: [verdict({ records: [reasoned] }), JSON.stringify({ record: { ...EVERY, detail } })],
        tools: refusing('We paginate', 'refused:detail_too_long — what to do about it'),
      })

      await $.session.start(START)
      await turn($, set, ...TALK)

      expect(set.of('remember')[1]).toMatchObject({ content: PAGED.content, detail: sent, reason_status: 'stated' })
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
    'refused:constructor — x',
    'no code at all',
    // A code is read only where a refusal opens with it.
    'it was refused:not_imperative',
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

  test('a place is sent as the server takes it: a line number is taken off, a symbol trimmed, and a file the session never opened left out', async ($, on) => {
    const anchors = [
      { path: 'src/queue/lock.ts:12-30', symbol: ' acquire ' },
      { path: 'src/a.ts#L4' },
      'src/b.ts:7:2',
      { path: 'src/a.ts', symbol: 'x'.repeat(201) },
      { path: 'src/never/opened.ts' },
      '../x',
      'src//a.ts',
    ]
    const set = stage(on, { replies: [verdict({ records: [decision({ anchors })] })] })

    await $.session.start(START)
    await turn($, set, dev('Use Postgres for the queue lock.'), claude('Done.', edit('src/queue/lock.ts'), edit('src/a.ts'), edit('src/b.ts')))

    expect(set.of('remember')[0]?.anchors).toEqual([{ path: 'src/queue/lock.ts', symbol: 'acquire' }, { path: 'src/a.ts' }, { path: 'src/b.ts' }])
  })

  test('over the places a record takes, the most exact are kept: a symbol before a file, a file deep in the tree before one near its top', async ($, on) => {
    const deep = Array.from({ length: 12 }, (_, n) => `src/deep/file-${n}.ts`)
    const anchors = [{ path: 'README.md' }, ...deep.map(path => ({ path })), { path: 'src/a.ts', symbol: 'f' }]
    const set = stage(on, { replies: [verdict({ records: [decision({ anchors })] })] })

    await $.session.start(START)
    await turn($, set, dev('Use Postgres for the queue lock.'), claude('Done.', edit('README.md'), ...deep.map(edit), edit('src/a.ts')))

    const sent = set.of('remember')[0]?.anchors as { path: string; symbol?: string }[]

    expect(sent.map(anchor => anchor.path)).not.toContain('README.md')
    expect(sent.at(-1)).toEqual({ path: 'src/a.ts', symbol: 'f' })
    expect(sent.length).toBe(11)
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
        carded('✓ Already recorded by someone else · Use Postgres advisory locks for the job queue, not Redis. [9 What is this] [0 OK]'),
      )
      expect(set.of('amend_memory')).toEqual([])
    })
  }
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
    test(`a Fix turned down with “${text.slice(0, 40)}” is said as “${line.slice(0, 60)}”`, async ($, on) => {
      const set = stage(on, {
        replies: [verdict({ records: [decision()] }), NOTHING, NOTHING],
        tools: { amend_memory: () => refused(text) },
      })

      await $.session.start(START)
      await turn($, set, ...TALK)

      const ui = await band($)

      await ui.press('fix:0')
      await ui.redraw()
      await ui.enter('fix-text', 'Use Postgres advisory locks.')
      await ui.unmount()

      expect(set.toasts).toEqual([line])

      await turn($, set, dev('and now the retry policy'), claude('Three tries.', edit('src/queue/retry.ts')))

      expect(set.of('amend_memory').length, 'tried again only for trouble of the server’s own').toBe(line.includes('tried once more') ? 2 : 1)
    })
  }

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

describe('where a record came from', () => {
  const FILE = 'src/queue/lock.ts'
  const PAGE = `https://fylgja.lknblab.dev/open/meeting/${idOf(900)}`

  test('a record that was remembered directly has no page: it is opened in the band, and named by its short id for Claude', async ($, on) => {
    const remembered = fact(1, {
      id: 'ab12cd34-0000-4000-8000-000000000001',
      anchors: { paths: [{ path: FILE }] },
      origin: 'assistant',
      link: null,
      source_id: null,
    })
    const set = stage(on, { tools: { recall: () => answer({ facts: [remembered] }) } })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await press($, 'open')

    const opened = await shown($)

    expect(opened).toMatch(`  In: src/queue/lock.ts  Fylgja record ab12cd34, written down by Claude${NOTES.told} [2 Tell Claude]`)
    expect(opened).not.toMatch('Open where it came from')

    await press($, 'tell-claude')

    expect(set.fills[0]).toMatch('> Fylgja record ab12cd34, written down by Claude\n\n')
    expect(set.fills[0]).not.toMatch('https://')
  })

  test('a record read out of a meeting or a session links to that page, in the band and in the note', async ($, on) => {
    const extracted = fact(1, { anchors: { paths: [{ path: FILE }] }, origin: 'extraction', link: PAGE, source_id: idOf(900) })
    const set = stage(on, { tools: { recall: () => answer({ facts: [extracted] }) } })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await press($, 'open')

    expect(await shown($)).toMatch('Fylgja record 00000000, read out of a meeting or session   [Open where it came from]')

    await press($, 'tell-claude')

    expect(set.fills[0]).toMatch(`> Fylgja record 00000000, read out of a meeting or session\n> ${PAGE}`)
  })
})
