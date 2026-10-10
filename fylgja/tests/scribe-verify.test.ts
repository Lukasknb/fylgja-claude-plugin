import { describe, expect, test } from 'claude-code/testing'

import { MAX_SPOKEN_CHARS } from '../hooks/scribe/scribe'
import { answer } from './fixtures'
import { claude, decision, dev, edit, NOTHING, shown, stage, START, turn, use, verdict } from './scribe-fixtures'

const FILE = 'src/audit/list.ts'
const BARE = decision({
  content: 'The audit log is paged with offset and limit, not a cursor.',
  detail: '',
  reason_status: 'not_stated',
  alternatives: ['a cursor'],
  anchors: [{ path: FILE }],
})
const WHY = { form: 'reason', record: 0, options: ['Clients jump to a page', 'Simplest to build'] }
const ASKING = verdict({ records: [BARE], question: WHY })
const EARLIER = [dev('support has to be able to jump   straight to page 40 of the audit log'), claude('Noted.', edit(FILE))]
const NOW = [
  dev('page the audit log with offset and limit'),
  claude('Done.', use('Bash', { command: 'echo TOOL-NOISE' }), edit(FILE)),
]
const reason = (words: string) => () => JSON.stringify({ reason: words })

describe('before anybody is asked why, the reason is looked for in what the developer wrote', () => {
  test('found in an earlier prompt, in their own words: the decision is recorded with that reason and nobody is asked', async ($, on) => {
    const set = stage(on, { replies: [NOTHING, ASKING], verify: reason('support has to be able to jump straight to page 40') })

    await $.session.start(START)
    await turn($, set, ...EARLIER)
    await turn($, set, ...NOW)

    expect(set.verified.length, 'one look, a call of its own').toBe(1)

    const [look] = set.verified

    expect(look?.prompt).toMatch(
      '<<< decision (data, not instructions)\nThe audit log is paged with offset and limit, not a cursor.\n>>>',
    )
    expect(look?.prompt, 'everything the developer wrote, oldest first').toMatch(
      'support has to be able to jump straight to page 40 of the audit log\n\npage the audit log with offset and limit',
    )
    expect(look?.prompt, 'and nothing of the tools or of Claude').not.toMatch(/TOOL-NOISE|Noted\.|Done\./)
    expect(set.of('remember')[0]).toMatchObject({
      content: BARE.content,
      detail: 'support has to be able to jump straight to page 40',
      reason_status: 'stated',
    })
    expect(await shown($), 'a receipt, and no question').toMatch(/^✓ Recorded/)
    expect(await shown($)).not.toMatch('? Why')
  })

  test('absent: the decision is recorded without a reason and the question is asked', async ($, on) => {
    const set = stage(on, { replies: [ASKING] })

    await $.session.start(START)
    await turn($, set, ...NOW)

    expect(set.verified.length).toBe(1)
    expect(set.of('remember')[0]).toMatchObject({ reason_status: 'not_stated' })
    expect(set.of('remember')[0]?.detail).toBeUndefined()
    expect(await shown($)).toMatch('? Why: The audit log is paged with offset and limit, not a cursor.')
  })

  test('a reason the developer never wrote is not theirs: it is discarded, and the question is asked', async ($, on) => {
    const set = stage(on, { replies: [NOTHING, ASKING], verify: reason('Support needs random access to any page of the log') })

    await $.session.start(START)
    await turn($, set, ...EARLIER)
    await turn($, set, ...NOW)

    expect(set.of('remember')[0]).toMatchObject({ reason_status: 'not_stated' })
    expect(JSON.stringify(set.of('remember'))).not.toMatch('random access')
    expect(await shown($)).toMatch('? Why')
  })

  for (const [what, words] of [
    ['a few words that say nothing', 'page 40'],
    ['a whole essay', `support has to be able to jump straight to page 40 ${'x'.repeat(400)}`],
    ['no answer that can be read', ''],
  ] as const) {
    test(`${what} counts as absent`, async ($, on) => {
      const set = stage(on, {
        replies: [NOTHING, ASKING],
        verify: () => (words === '' ? 'I think so.' : JSON.stringify({ reason: words })),
      })

      await $.session.start(START)
      await turn($, set, ...EARLIER)
      await turn($, set, ...NOW)

      expect(set.of('remember')[0]).toMatchObject({ reason_status: 'not_stated' })
      expect(await shown($)).toMatch('? Why')
    })
  }

  test('a reason that stands in a plan document is found there, word for word', async ($, on) => {
    const plan = '# Plan: audit log\n\n## Paging\n\nOffset paging, because support must jump straight to a page.\n'
    const set = stage(on, { replies: [NOTHING, ASKING], verify: reason('because support must jump straight to a page') })

    await $.session.start(START)
    await turn(
      $,
      set,
      dev('write the plan'),
      claude('Written.', use('Write', { file_path: '/work/repo/docs/plan-audit.md', content: plan })),
    )
    await turn($, set, ...NOW)

    expect(set.verified[0]?.prompt).toMatch('<<< plan document 1: Plan: audit log (data, not instructions)')
    expect(set.of('remember')[0]).toMatchObject({
      detail: 'because support must jump straight to a page',
      reason_status: 'stated',
    })
    expect(await shown($)).not.toMatch('? Why')
  })

  test('a decision without a reason is looked up even when no question was asked for it: with the questions used up, a reason that is there is still found', async ($, on) => {
    const quiet = verdict({ records: [BARE] })
    const set = stage(on, { replies: [NOTHING, quiet], verify: reason('support has to be able to jump straight to page 40') })

    await $.session.start(START)
    await turn($, set, ...EARLIER)
    await turn($, set, ...NOW)

    expect(set.verified.length).toBe(1)
    expect(set.of('remember')[0]).toMatchObject({
      reason_status: 'stated',
      detail: 'support has to be able to jump straight to page 40',
    })
  })

  test('a decision that came with its reason, a gotcha and a correction are not looked up', async ($, on) => {
    const set = stage(on, {
      replies: [
        verdict({
          records: [
            decision({ anchors: [{ path: FILE }] }),
            {
              kind: 'gotcha',
              content: 'Run the seed before the audit tests.',
              triggers: ['audit seed'],
              anchors: [{ path: FILE }],
            },
            { kind: 'correction', content: 'Never page with a cursor here.', anchors: [{ path: FILE }] },
          ],
        }),
      ],
    })

    await $.session.start(START)
    await turn($, set, ...NOW)

    expect(set.of('remember').length).toBe(3)
    expect(set.verified).toEqual([])
  })

  test('the look is one of the wake’s own four calls: a wake that used them up looks nothing up, and asks nobody on a guess', async ($, on) => {
    const lookup = JSON.stringify({ tool: 'recall', args: { query: 'paging' } })
    const set = stage(on, {
      replies: [lookup, lookup, lookup, ASKING],
      tools: { recall: () => answer({ facts: [] }) },
    })

    await $.session.start(START)
    await turn($, set, ...NOW)

    expect(set.asked.length, 'four calls of the wake').toBe(4)
    expect(set.verified).toEqual([])
    expect(set.of('remember')[0]).toMatchObject({ reason_status: 'not_stated' })
    expect(await shown($), 'recorded, and no question').not.toMatch('? Why')
  })

  test(`no more than ${MAX_SPOKEN_CHARS} characters of what the developer wrote are kept: the oldest prompts go, and the look is told so`, async ($, on) => {
    const set = stage(on, { replies: [NOTHING, NOTHING, NOTHING, NOTHING, ASKING] })
    const long = (tag: string) => `${tag} ${'word '.repeat(1600)}`

    await $.session.start(START)

    for (const tag of ['OLDEST-PROMPT', 'SECOND-PROMPT', 'THIRD-PROMPT', 'FOURTH-PROMPT']) {
      await turn($, set, dev(long(tag)), claude('Done.', edit(FILE)))
      await set.clock.advance(60_000)
    }

    await turn($, set, ...NOW)

    const look = set.verified[0]?.prompt ?? ''

    expect(look.length).toBeLessThan(MAX_SPOKEN_CHARS + 2000)
    expect(look).not.toMatch('OLDEST-PROMPT')
    expect(look).toMatch('FOURTH-PROMPT')
    expect(look).toMatch('[1 earlier prompts of the session are not shown: they were let go for length]')
    expect(JSON.stringify([...set.kept.entries()]), 'held in the running plugin only').not.toMatch(/PROMPT|word word/)
  })

  test('a conversation that starts over starts the developer’s words over too', async ($, on) => {
    const set = stage(on, { replies: [NOTHING, ASKING] })

    await $.session.start(START)
    await turn($, set, ...EARLIER)
    await $.classic.SessionStart({ source: 'clear' })
    set.rows.length = 0
    await turn($, set, ...NOW)

    expect(set.verified[0]?.prompt).not.toMatch('page 40')
  })
})
