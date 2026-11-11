import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import * as Journal from '../hooks/scribe/journal'
import { answer } from './fixtures'
import { pressTwice, SESSION_ID, shown, START } from './scribe-fixtures'
import type { Stage } from './scribe-fixtures'
import { EXPECTED, OBSERVED, QUOTE, READING_ID, reported, endTurn, skuld } from './skuld-fixtures'

/** The plugin loaded afresh for the conversation: what it held is gone, and the store stays. */
async function reloaded($: Engine, set: Stage): Promise<void> {
  await set.clock.settle()
  await $.session.start(START)
  await set.clock.settle()
}

/** What the log of the conversation keeps, as one text. */
function logOf(set: Stage): string {
  return JSON.stringify([...set.kept].filter(([key]) => key.startsWith(`${Journal.PREFIX}${SESSION_ID}.`)))
}

/** A tool of Fylgja's that cannot be reached while `isDown` says so. */
function down(isDown: () => boolean, then: (args: Record<string, unknown>) => unknown) {
  return (args: Record<string, unknown>): unknown => {
    if (isDown()) {
      throw new Error('Fylgja is down')
    }

    return then(args)
  }
}

describe('the reading in hand is the truth; whether Fylgja has it is a flag', () => {
  test('an upload that did not get through is sent at the next turn’s end, once', async ($, on) => {
    let isDown = true
    const set = skuld(on, { tools: { save_image_reading: down(() => isDown, () => answer({ id: READING_ID, outcome: 'saved' })) } })

    await $.session.start(START)
    await reported($, on, set)

    expect(set.of('save_image_reading')).toHaveLength(1)

    isDown = false
    await endTurn($, set, 'turn-2')

    expect(set.of('save_image_reading')).toHaveLength(2)

    await endTurn($, set, 'turn-3')

    expect(set.of('save_image_reading'), 'taken: not sent again').toHaveLength(2)
  })

  test('a server fault is tried again; a refusal by a rule is not', async ($, on) => {
    let fault = true
    const set = skuld(on, {
      tools: {
        save_image_reading: () =>
          fault
            ? { content: [{ type: 'text', text: 'save_image_reading failed on the server' }], isError: true }
            : { content: [{ type: 'text', text: 'refused:reading_kept — the developer kept this reading as a requirement; that verdict and what it rests on are final' }], isError: true },
      },
    })

    await $.session.start(START)
    await reported($, on, set)
    fault = false
    await endTurn($, set, 'turn-2')
    await endTurn($, set, 'turn-3')

    expect(set.of('save_image_reading')).toHaveLength(2)
  })

  test('Keep while Fylgja has nothing of the reading and cannot be reached: the record waits, and goes with the reading at the next turn’s end', async ($, on) => {
    let isDown = true
    const set = skuld(on, {
      tools: {
        save_image_reading: down(() => isDown, () => answer({ id: READING_ID, outcome: 'saved' })),
        remember: down(() => isDown, () => answer({ atom_id: '00000000-0000-4000-8000-000000000901', outcome: 'created' })),
      },
    })

    await $.session.start(START)
    await reported($, on, set)
    await pressTwice($, 'keep')

    expect(set.of('remember'), 'not sent without the reading').toEqual([])

    isDown = false
    await endTurn($, set, 'turn-2')

    expect(set.of('remember')).toEqual([expect.objectContaining({ content: EXPECTED, report_id: READING_ID, basis: 'transcribed' })])
    expect(
      set.calls.map(call => call.tool).filter(tool => tool === 'save_image_reading' || tool === 'remember').slice(-2),
      'the reading first, then the record',
    ).toEqual(['save_image_reading', 'remember'])
  })

  test('Keep while Fylgja has the reading and the write fails: it waits for the next turn’s end, as any record does', async ($, on) => {
    let isDown = false
    const set = skuld(on, { tools: { remember: down(() => isDown, () => answer({ atom_id: '00000000-0000-4000-8000-000000000902', outcome: 'created' })) } })

    await $.session.start(START)
    await reported($, on, set)
    isDown = true
    await pressTwice($, 'keep')
    isDown = false
    await endTurn($, set, 'turn-2')

    expect(set.of('remember').at(-1)).toMatchObject({ content: EXPECTED, report_id: READING_ID, basis: 'transcribed' })
  })
})

describe('a reload goes on with the images where they were', () => {
  test('the question that waited comes up again, without the words in the image, and Keep still names the reading', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await reported($, on, set)

    expect(await shown($)).toContain(QUOTE)

    await reloaded($, set)

    const card = await shown($)

    expect(card).toContain(`? Expected: ${EXPECTED}`)
    expect(card).toContain(`Reported: ${OBSERVED}`)
    expect(card, 'the quote was never logged').not.toContain(QUOTE)

    await pressTwice($, 'keep')

    expect(set.of('remember')).toEqual([expect.objectContaining({ content: EXPECTED, report_id: READING_ID, basis: 'transcribed' })])
  })

  test('the log holds the reader’s words, never the quote or the prompt', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await reported($, on, set)
    await set.clock.settle()

    const log = logOf(set)

    expect(log).toContain(OBSERVED)
    expect(log).not.toContain(QUOTE)
    expect(log).not.toContain('see the screenshot')
  })

  test('a reading Fylgja did not have before the reload is sent at the next turn’s end; one it had is not', async ($, on) => {
    let isDown = true
    const set = skuld(on, { tools: { save_image_reading: down(() => isDown, () => answer({ id: READING_ID, outcome: 'saved' })) } })

    await $.session.start(START)
    await reported($, on, set)
    await reloaded($, set)
    isDown = false
    await endTurn($, set, 'turn-2')

    expect(set.of('save_image_reading')).toHaveLength(2)

    await reloaded($, set)
    await endTurn($, set, 'turn-3')

    expect(set.of('save_image_reading')).toHaveLength(2)
  })

  test('a reading kept already, to another record, is settled: the keep is not tried again', async ($, on) => {
    const set = skuld(on, { tools: { remember: () => ({ content: [{ type: 'text', text: 'refused:reading_kept — the reading is already kept as another record; nothing was kept' }], isError: true }) } })

    await $.session.start(START)
    await reported($, on, set)
    await pressTwice($, 'keep')
    await endTurn($, set, 'turn-2')
    await endTurn($, set, 'turn-3')

    expect(set.of('remember')).toHaveLength(1)
    expect(set.of('save_image_reading'), 'nor the reading sent again').toHaveLength(1)
  })
})
