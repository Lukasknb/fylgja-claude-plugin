import { describe, expect, test } from 'claude-code/testing'

import { MAX_REQUIREMENTS } from '../hooks/scribe/band'
import { band, claude, decision, dev, edit, gitStatus, press, pressTwice, ROOT, send, shown, START, stepping, turn, verdict } from './scribe-fixtures'
import { EXPECTED, FIXED, FIXED_TEST, OBSERVED, paste, QUOTE, READING_ID, readingReply, reported, endTurn, skuld, stepIn } from './skuld-fixtures'

const QUESTION = `? Expected: ${EXPECTED}`

/** The remember call that keeps a requirement, as Fylgja is sent it. */
function kept(content: string, basis: string): Record<string, unknown> {
  return {
    content,
    kind: 'decision',
    author: 'scribe',
    repo: 'acme/web',
    stage: 'built',
    reason_status: 'stated',
    detail: `A report pasted into the session showed: ${OBSERVED}`,
    anchors: [expect.objectContaining({ path: FIXED })],
    report_id: READING_ID,
    basis,
  }
}

describe('once the fix for a reported image landed', () => {
  test('in code the report brought in, the developer is asked to keep the expectation, with what was reported and the words in the image', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await reported($, on, set)

    const card = await shown($)

    expect(card).toContain(QUESTION)
    expect(card).toContain(`Reported: ${OBSERVED}`)
    expect(card).toContain(QUOTE)
    expect(card).toContain('[1 Keep] [2 Fix wording]')
    expect(card).toContain('[0 Not a requirement]')
    expect(set.of('save_image_reading')).toEqual([expect.objectContaining({ work_state: 'brought_in' })])
  })

  test('Keep, pressed twice, writes one decision through remember with the reading and its basis', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await reported($, on, set)
    await press($, 'keep')

    expect(set.of('remember'), 'one press writes nothing').toEqual([])

    await press($, 'keep')

    expect(set.of('remember')).toEqual([expect.objectContaining(kept(EXPECTED, 'transcribed'))])
    expect(await shown($)).toContain(`✓ Recorded · ${EXPECTED}`)

    await endTurn($, set, 'turn-next')

    expect(set.of('save_image_reading'), 'a kept reading is settled with its record and is not sent again').toHaveLength(1)
  })

  test('Fix wording keeps the developer’s own sentence, stated', async ($, on) => {
    const set = skuld(on)
    const mine = 'When a user exports the invoice list, every listed invoice is in the CSV.'

    await $.session.start(START)
    await reported($, on, set)
    await press($, 'wording')

    const ui = await band($)

    await ui.enter('wording-text', mine)
    await ui.unmount()

    expect(set.of('remember')).toEqual([expect.objectContaining(kept(mine, 'stated'))])
  })

  test('Not a requirement settles the reading with that verdict and writes no record', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await reported($, on, set)
    await pressTwice($, 'not-requirement')

    expect(set.of('remember')).toEqual([])
    expect(set.of('save_image_reading').at(-1)).toMatchObject({ verdict: 'not_requirement', work_state: 'brought_in' })
    expect(await shown($)).not.toContain('Expected')
  })

  test('an expectation the developer typed beside the image is theirs: stated', async ($, on) => {
    const set = skuld(on, { forks: () => ({ text: readingReply({ expected_basis: 'by_developer' }) }) })

    await $.session.start(START)
    await reported($, on, set)
    await pressTwice($, 'keep')

    expect(set.of('remember')[0]).toMatchObject({ basis: 'stated' })
  })

  test('only a test changed: the fix has not landed, nothing is asked', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await reported($, on, set, 'turn-img', [FIXED_TEST])

    expect(await shown($)).not.toContain('Expected')
    expect(set.of('save_image_reading')).toEqual([expect.objectContaining({ work_state: 'unknown' })])
  })

  test('code the session had changed before the image came: work in progress, never asked', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await turn($, set, dev('make the export stream rows'), claude('Done.', edit(FIXED)))
    await reported($, on, set)

    expect(await shown($)).not.toContain('Expected')
    expect(set.of('save_image_reading')).toEqual([expect.objectContaining({ work_state: 'work_in_progress' })])
  })

  test('code git already held as changed in the tree: work in progress too', async ($, on) => {
    const set = skuld(on, {
      git: args => (args[0] === 'status' && args.includes('--porcelain') && !args.some(arg => arg.startsWith('--ignored')) ? { exitCode: 0, stdout: ` M ${FIXED}\0` } : gitStatus([])(args)),
    })

    await $.session.start(START)
    await reported($, on, set)

    expect(set.of('save_image_reading')).toEqual([expect.objectContaining({ work_state: 'work_in_progress' })])
    expect(set.runs.some(argv => argv.includes('status') && argv.includes(ROOT))).toBe(true)
  })

  test('a fix an agent makes lands as Claude’s does', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await paste($)
    await set.clock.settle()
    await stepIn($, on, set, 'turn-img', 0)
    await stepIn($, on, set, 'turn-img', 1)

    stepping(on, () => [{ name: 'Edit', input: { file_path: `${ROOT}/${FIXED}`, old_string: 'a', new_string: 'b' } }])

    const stream = $.turn.step({ turnId: 'agent-turn', index: 0, model: 'claude-opus', messageCount: 3, agentId: 'agent-1' })

    for await (const chunk of stream) {
      void chunk
    }

    await stream.result
    await endTurn($, set, 'turn-img', 'An agent fixed the export.')

    expect(await shown($)).toContain(QUESTION)
  })
})

describe('the sentence when the image states none', () => {
  const NONE = { expected: null, expected_basis: null }

  test('worked out at the fix’s turn from the final answer: concluded, and the card says whose words they are', async ($, on) => {
    const said = 'When a user presses Export, the listed invoices download as a CSV file.'
    const set = skuld(on, {
      forks: () => ({ text: readingReply(NONE) }),
      statement: JSON.stringify({ statement: said, quote: 'the listed invoices download as a CSV file' }),
    })

    await $.session.start(START)
    await reported($, on, set, 'turn-img', [FIXED], 'Fixed: pressing Export, the listed invoices download as a CSV file again.')

    expect(set.statements).toHaveLength(1)
    expect(set.statements[0]?.prompt).toContain(OBSERVED)

    const card = await shown($)

    expect(card).toContain(`? Expected: ${said}`)
    expect(card).toContain('Worded from Claude')

    await pressTwice($, 'keep')

    expect(set.of('remember')[0]).toMatchObject({ content: said, basis: 'concluded' })
  })

  test('resting on the developer’s own words since the report: stated', async ($, on) => {
    const said = 'When a user presses Export, the CSV holds every listed invoice.'
    const set = skuld(on, {
      forks: () => ({ text: readingReply({ ...NONE, echo: 'export is broken, every listed invoice must be in the CSV' }) }),
      statement: JSON.stringify({ statement: said, quote: 'every listed invoice must be in the csv' }),
    })

    await $.session.start(START)
    await paste($, 'export is broken, every listed invoice must be in the CSV [Image #1]')
    await set.clock.settle()
    await stepIn($, on, set, 'turn-img', 0)
    await stepIn($, on, set, 'turn-img', 1, [{ name: 'Edit', input: { file_path: `${ROOT}/${FIXED}`, old_string: 'a', new_string: 'b' } }])
    await endTurn($, set, 'turn-img', 'Done.')
    await pressTwice($, 'keep')

    expect(set.of('remember')[0]).toMatchObject({ content: said, basis: 'stated' })
  })

  test('a quote found nowhere the session holds: no sentence, no question', async ($, on) => {
    const set = skuld(on, {
      forks: () => ({ text: readingReply(NONE) }),
      statement: JSON.stringify({ statement: 'When anything happens, everything works.', quote: 'words nobody wrote anywhere' }),
    })

    await $.session.start(START)
    await reported($, on, set)

    expect(set.statements).toHaveLength(1)
    expect(await shown($)).not.toContain('Expected')
  })
})

describe('the question has its own share', () => {
  test('sent past, it comes up once more after a later turn, and then is let go', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await reported($, on, set)

    expect(await shown($)).toContain(QUESTION)

    await send($, 'carry on')
    await endTurn($, set, 'turn-2')

    expect(await shown($), 'once more').toContain(QUESTION)

    await send($, 'and on')
    await endTurn($, set, 'turn-3')

    expect(await shown($)).not.toContain('Expected')

    await send($, 'and on again')
    await endTurn($, set, 'turn-4')

    expect(await shown($)).not.toContain('Expected')
    expect(set.of('save_image_reading').some(args => 'verdict' in args), 'unsettled, the reading has no verdict').toBe(false)
  })

  test(`no more than ${MAX_REQUIREMENTS} in a session`, async ($, on) => {
    const set = skuld(on, { forks: n => ({ text: readingReply({ echo: `report ${n}` }) }) })

    await $.session.start(START)

    for (const n of [1, 2, 3]) {
      await paste($, `report ${n} [Image #1]`)
      await set.clock.settle()
      await stepIn($, on, set, `turn-${n}`, 0)
      await stepIn($, on, set, `turn-${n}`, 1, [{ name: 'Edit', input: { file_path: `${ROOT}/src/invoices/export-${n}.ts`, old_string: 'a', new_string: 'b' } }])
      await endTurn($, set, `turn-${n}`)

      if (await shown($).then(text => text.includes('Expected'))) {
        await pressTwice($, 'not-requirement')
      }
    }

    expect(set.events('image').filter(event => event.props.stage === 'ask')).toHaveLength(MAX_REQUIREMENTS)
  })

  test('it takes nothing from Scribe’s own four: Scribe asks why in the same turn', async ($, on) => {
    const UNEXPLAINED = decision({ content: 'Stream the export rows instead of building the file in memory.', detail: '', reason_status: 'not_stated', anchors: [{ path: FIXED }] })
    let looks = 0
    const set = skuld(on, {
      wake: () => {
        looks += 1

        return looks === 1 ? verdict({ records: [UNEXPLAINED], question: { form: 'reason', record: 0, options: ['Large lists ran out of memory'] } }) : '{"outcome":"nothing"}'
      },
    })

    await $.session.start(START)
    await reported($, on, set)

    expect(await shown($), 'Scribe’s question first').toContain('? Why: Stream the export rows')

    await pressTwice($, 'reason:0')

    expect(set.of('amend_memory')).toEqual([expect.objectContaining({ detail: 'Large lists ran out of memory', reason_status: 'stated' })])
    expect(await shown($), 'then the report’s').toContain(QUESTION)
  })
})

describe('the question stays out', () => {
  test('while the plugin is invisible the image is read and sent, and nothing is asked', { options: { invisible: true } }, async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await reported($, on, set)

    expect(set.forks).toHaveLength(1)
    expect(set.of('save_image_reading')).toEqual([expect.objectContaining({ work_state: 'brought_in' })])
    expect(set.events('image').some(event => event.props.stage === 'ask')).toBe(false)
  })

  test('a record the server refuses leaves the reading unsettled: it is sent with no verdict', async ($, on) => {
    const set = skuld(on, {
      tools: { remember: () => ({ content: [{ type: 'text', text: 'refused:basis_mismatch the sentence is not the reading’s' }], isError: true }) },
    })

    await $.session.start(START)
    await reported($, on, set)
    await pressTwice($, 'keep')
    await endTurn($, set, 'turn-next')

    expect(set.of('save_image_reading').every(args => !('verdict' in args))).toBe(true)
  })
})
