import { describe, expect, test } from 'claude-code/testing'

import { leaningOf } from '../hooks/scribe/labels'
import { SYSTEM } from '../hooks/scribe/prompt'
import { isAQuestion } from '../hooks/scribe/verdict'
import { claude, decision, dev, edit, NOTHING, QUIET, shown, stage, START, turn, verdict } from './scribe-fixtures'
import { LEANING, REAL } from './scribe-labels-fixtures'

/** The record a 0.3.7 session kept, as its model proposed it. */
const ABSENCE = decision({
  content:
    "Whole-line absence handling lives on its own branch outside the partial-confirmation stack, and the stack's L4 keeps develop's absence behaviour for every customer.",
  detail: 'Isnt the whole line absence completely seperate from partial confirmation?',
  reason_status: 'stated',
  alternatives: [
    'keeping the `_is_cancelled_by_absence` rule and `line_status` protection in L4',
    'dropping the absence work entirely',
  ],
})

/** A session that set up L1 to L6 as the layers of a stack of pull requests, in one turn… */
const SET_UP_TALK = [
  dev('Split the partial confirmation work into a stack.'),
  claude(
    'The stack:\n- **L1** — schema for confirmed quantities\n- **L2** — importer\n- **L3** — line status\n- **L4** — absence handling\n- **L5** — UI\n- **L6** — docs',
    edit('src/queue/lock.ts'),
  ),
]

/** …and talked about one of them in the next. */
const STACK_TALK = [
  dev('Isnt the whole line absence completely seperate from partial confirmation?'),
  claude('Yes. I will move it to its own branch and keep L4 on develop behaviour.', edit('src/queue/lock.ts')),
]

/** Both turns, Scribe finding nothing in the first. */
async function stacked($: Parameters<typeof turn>[0], set: Parameters<typeof turn>[1]): Promise<void> {
  await $.session.start(START)
  await turn($, set, ...SET_UP_TALK)
  await turn($, set, ...STACK_TALK)
}

const PLAIN_TALK = [dev('go on'), claude('Done.', edit('src/queue/lock.ts'))]

const words = (content: string) => ({ content, detail: '', alternatives: [] })

describe('the record kept on 0.3.7, in a session that set up L1 to L6 as layers of a stack', () => {
  test('the model calls it work: nothing is written and no model is asked to put it right', async ($, on) => {
    const set = stage(on, { replies: [NOTHING, verdict({ records: [{ ...ABSENCE, about: 'work' }] })] })

    await stacked($, set)

    expect(set.asked.length).toBe(2)
    expect(set.of('remember')).toEqual([])
    expect(await shown($)).toBe(QUIET)
  })

  test('the model calls it code: "L4" is a label the session set up, and when it cannot be named the record goes', async ($, on) => {
    const set = stage(on, { replies: [NOTHING, verdict({ records: [{ ...ABSENCE, about: 'code' }] }), JSON.stringify({ drop: true })] })

    await stacked($, set)

    expect(set.asked[2]?.prompt).toMatch('refused:leans_on_conversation — "L4" only means something')
    expect(set.asked[2]?.prompt, 'the session is handed over to name it from').toMatch('**L4** — absence handling')
    expect(set.of('remember')).toEqual([])
    expect(await shown($)).toBe(QUIET)
  })

  test('the model gives it back with the label still in it: nothing is written', async ($, on) => {
    const set = stage(on, { replies: [NOTHING, verdict({ records: [ABSENCE] }), JSON.stringify({ record: ABSENCE })] })

    await stacked($, set)

    expect(set.asked.length).toBe(3)
    expect(set.of('remember')).toEqual([])
  })

  test('named by what it stands for, it is written as named', async ($, on) => {
    const named = { ...ABSENCE, content: "Whole-line absence keeps develop's behaviour for every customer.", detail: '', alternatives: [] }
    const set = stage(on, { replies: [NOTHING, verdict({ records: [ABSENCE] }), JSON.stringify({ record: named })] })

    await stacked($, set)

    expect(set.of('remember').map(args => args.content)).toEqual([named.content])
  })
})

describe('real decisions whose names look like labels, in a session that never set them up as labels', () => {
  for (const content of REAL) {
    test(content, async ($, on) => {
      const record = decision({ about: 'code', content })
      // Asked to put it right, the model gives it back as it was.
      const set = stage(on, { replies: [verdict({ records: [record] }), JSON.stringify({ record })] })

      await $.session.start(START)
      await turn($, set, ...PLAIN_TALK)

      expect(set.of('remember').map(args => args.content)).toEqual([content])
    })
  }

  test('one the model would drop is written as it was', async ($, on) => {
    const record = decision({ content: 'Option B ist Default im Consent-Dialog, weil Legal Opt-in verlangt.' })
    const set = stage(on, { replies: [verdict({ records: [record] }), JSON.stringify({ drop: true })] })

    await $.session.start(START)
    await turn($, set, ...PLAIN_TALK)

    expect(set.asked.length, 'put right once').toBe(2)
    expect(set.of('remember').map(args => args.content)).toEqual([record.content])
  })

  test('no real name is sure without the session setting it up, in the sentence, the reason or an alternative', () => {
    for (const content of REAL) {
      const lines = ['[developer] go on', '[claude] Done.']

      expect(leaningOf(words(content), lines)?.isSure ?? false, content).toBe(false)
      expect(leaningOf({ content: 'Retry with backoff.', detail: content, alternatives: [content] }, lines)?.isSure ?? false, content).toBe(false)
    }
  })
})

describe('the same tokens, set up as labels by the session, are sure', () => {
  const SET_UP: [string, string][] = [
    ["Track B keeps develop's absence behaviour.", '[claude] Two tracks:\n- Track A: keep develop\n- Track B: new rule'],
    ["L4 keeps develop's absence behaviour for every customer.", '[claude] L1: schema\nL2: importer\nL3: status'],
    ['The L2 Cache in front of Redis is sized at 512 MB so evictions stay under 1 percent.', '[claude] | L1 | schema |\n| L2 | importer |'],
    ['WP-A ships the absence handling before the confirmation logic.', '[developer] ### WP-A\nabsence\n### WP-B\nconfirmation'],
    ['Option 2b is used.', '[claude] 1. Option 2a — retry\n2. Option 2b — fail fast'],
    ["Item 3 keeps develop's behaviour.", '[claude] Item 1: a\nItem 2: b\nItem 3: c'],
    ["The #3 item keeps develop's absence behaviour.", '[claude] #1: a\n#2: b\n#3: c'],
    ["Layer 4 keeps develop's absence behaviour for every customer.", '[claude] - Layer 3 — status\n- Layer 4 — absence'],
    ['Variant 2 is used for the absence rule.', '[claude] **Variant 1**: drop\n**Variant 2**: keep'],
    ['The plan\'s P2 is skipped.', '[plan] P1: importer\nP2: absence'],
    ['Approach A was chosen for absence handling.', '[claude] Approach A: keep\nApproach B: drop'],
    ["Option B's retry is kept.", '[claude] Two ways: - **Option A**: fail fast - **Option B**: retry with backoff'],
  ]

  for (const [content, said] of SET_UP) {
    test(content, () => {
      expect(leaningOf(words(content), [said])?.isSure, content).toBe(true)
      expect(leaningOf(words(content), ['[developer] go on'])?.isSure ?? false, `${content}, never set up`).toBe(false)
    })
  }

  test('"Track B keeps…" after the session listed Track A and Track B is not written when it cannot be named', async ($, on) => {
    const record = decision({ about: 'code', content: "Track B keeps develop's absence behaviour." })
    const set = stage(on, { replies: [verdict({ records: [record] }), JSON.stringify({ drop: true })] })

    await $.session.start(START)
    await turn(
      $,
      set,
      dev('which track?'),
      claude('Two tracks:\n- Track A: drop the absence rule\n- Track B: keep develop\'s rule', edit('src/queue/lock.ts')),
    )

    expect(set.of('remember')).toEqual([])
  })

  test('the records that lean on their session are each found by shape or by what the session set up', () => {
    const ONLY_THE_MODEL = new Set([
      'Whole-line absence handling lives on its own branch outside the partial-confirmation stack.',
      'Absence handling is split out into a follow-up PR.',
      'The absence fix goes in after the confirmation work merges.',
      'Absence handling lives in branch scribe-absence, rebased on main.',
    ])
    const said = [
      '[claude] - L1: schema\n- L2: importer\n- L4: absence\n- WP-A: x\n- WP-B: y\n- Track A: a\n- Track B: b\n- Item 3: c\n- Item 4: d\n- Q1: e\n- Q2: f\n- #3: g\n- #4: h',
    ]

    for (const content of LEANING) {
      expect(leaningOf(words(content), said) === undefined, content).toBe(ONLY_THE_MODEL.has(content))
    }
  })
})

describe('one name in a list of real things is no series of labels', () => {
  const NOT_SET_UP: [string, string][] = [
    ['EC2 runs the importer because it needs a GPU.', '[claude] Where to run it: - EC2: GPUs, more to run - Fargate: no GPUs'],
    ['S3 holds the exports because the auditors read them there.', '[claude] Storage: 1. S3: in the EU region 2. GCS: cheaper egress'],
    ['GPT-4 writes the summaries because it follows the format.', '[claude] - GPT-4: follows the format - GPT-3: cheaper'],
    ['Option B stays the default in the consent dialog.', '[claude] | Option B | default |'],
    ['Step 2 retries the upload with backoff.', '[claude] The first try is free but it costs 2. Step 2: retry, which costs more.'],
  ]

  for (const [content, said] of NOT_SET_UP) {
    test(content, () => {
      expect(leaningOf(words(content), [said])?.isSure ?? false, content).toBe(false)
    })
  }

  test('a series in a numbered list that opens after a colon, or on lines of its own, is one', () => {
    expect(leaningOf(words('Step 2 retries the upload.'), ['[claude] The plan: 1. Step 1: try once', '2. Step 2: retry'])?.isSure).toBe(true)
  })
})

describe('words that point back into the conversation', () => {
  test('are put right once, never dropped, and not when they say where it was said', () => {
    expect(leaningOf(words('Like we said earlier, absence handling stays.'))).toEqual({ label: 'Like we said', isSure: false })
    expect(leaningOf(words('As discussed, retries stop at three.'))).toEqual({ label: 'As discussed', isSure: false })
    expect(leaningOf(words('Like we said before in the spec, the API never deletes audio.'))).toBeUndefined()
    expect(leaningOf(words('As discussed with the customer, invoices are sent on the 1st.'))).toBeUndefined()
  })
})

describe('a reason that is a question', () => {
  test('is no reason: the decision is written with none', async ($, on) => {
    const QUESTIONED = decision({
      about: 'code',
      content: 'Whole-line absence never sets `line_status` to cancelled.',
      detail: 'Isnt the whole line absence completely seperate from partial confirmation?',
      reason_status: 'stated',
      alternatives: ['cancelling the line on absence'],
    })
    const set = stage(on, { replies: [verdict({ records: [QUESTIONED] })] })

    await $.session.start(START)
    await turn($, set, ...PLAIN_TALK)

    const [written] = set.of('remember')

    expect(written?.content).toBe('Whole-line absence never sets `line_status` to cancelled.')
    expect(written?.detail, 'the question is not sent as the reason').toBeUndefined()
    expect(written?.reason_status).toBe('not_stated')
  })

  test('only when it does nothing but ask', () => {
    expect(isAQuestion('Isnt the whole line absence completely seperate from partial confirmation?')).toBe(true)
    expect(isAQuestion('Why keep both? Who reads the old column?')).toBe(true)
    expect(isAQuestion('Who reads the old column? Nobody since the importer moved to `line_status`.')).toBe(false)
    expect(isAQuestion('The `retry?` helper already backs off.')).toBe(false)
    expect(isAQuestion('')).toBe(false)
  })
})

test('the model is told what work organisation is, with a team rule about how changes ship on the other side', () => {
  expect(SYSTEM).toMatch("Never how the work of THIS session's task is organised")
  expect(SYSTEM).toMatch('Schema changes ship in a separate PR from the code that uses them')
  expect(SYSTEM).toMatch('"about" (required): "code"')
  expect(SYSTEM).toMatch('A question is not a reason')
  expect(SYSTEM).toMatch('"the stack\'s L4"')
})
