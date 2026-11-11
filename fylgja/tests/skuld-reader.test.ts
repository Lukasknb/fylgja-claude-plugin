import { describe, expect, test } from 'claude-code/testing'

import { FORK_PROMPT } from '../hooks/reader/prompt'
import { MAX_FORKS, WARM_MS } from '../hooks/reader/reader'
import { NEEDS_SIGN_IN } from './fixtures'
import { dev, START } from './scribe-fixtures'
import { EXPECTED, FIXED, OBSERVED, paste, PASTED, QUOTE, READING_ID, readingReply, reported, endTurn, skuld, stepIn } from './skuld-fixtures'

/** The upload of the screenshot read as the fork reads it by default. */
const UPLOADED = {
  prompt_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
  prompted_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
  image_count: 1,
  shows: 'coworker_chat',
  legibility: 'clear',
  reporter_role: 'colleague',
  observed: OBSERVED,
  expected: EXPECTED,
  expected_basis: 'in_image',
}

describe('a pasted image is read on this machine', () => {
  test('Scribe judges it worth reading after the first step; the fork goes out at the next boundary, never right after the first step', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await paste($)
    await set.clock.settle()
    await stepIn($, on, set, 'turn-img', 0)

    expect(set.gates, 'judged once the first step is back').toHaveLength(1)
    expect(set.gates[0]?.prompt).toContain('the export on the invoice list does nothing')
    expect(set.forks, 'nothing forked right after the first step').toEqual([])

    await stepIn($, on, set, 'turn-img', 1)

    expect(set.forks).toEqual([FORK_PROMPT])

    await endTurn($, set, 'turn-img')

    expect(set.forks, 'one fork for one prompt').toHaveLength(1)
    expect(set.of('save_image_reading')).toEqual([{ ...UPLOADED, session_id: expect.any(String), work_state: 'unknown' }])
  })

  test('the upload holds the reader’s words and never the quote or the prompt', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await reported($, on, set)

    const sent = JSON.stringify(set.of('save_image_reading'))

    expect(sent).not.toContain(QUOTE)
    expect(sent).not.toContain('quote')
    expect(sent).not.toContain(PASTED.slice(0, 30))
  })

  test('the hash is the prompt’s with its image placeholders taken out', async ($, on) => {
    const set = skuld(on)
    const bare = 'the export on the invoice list does nothing, see the screenshot'
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bare))
    const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')

    await $.session.start(START)
    await reported($, on, set)

    expect(set.of('save_image_reading')[0]?.prompt_hash).toBe(hex)
  })
})

describe('the fork goes out only when every guard holds', () => {
  test('Scribe says no: nothing is forked', async ($, on) => {
    const set = skuld(on, { isWorth: false })

    await $.session.start(START)
    await reported($, on, set)

    expect(set.gates).toHaveLength(1)
    expect(set.forks).toEqual([])
    expect(set.of('save_image_reading')).toEqual([])
    expect(set.events('image').map(event => event.props)).toContainEqual({ stage: 'gate', outcome: 'gate_no' })
  })

  test('a later prompt entered: the image prompt is no longer the latest', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await paste($)
    await set.clock.settle()
    await stepIn($, on, set, 'turn-img', 0)
    await $.prompt.submit({ text: 'and the totals too', wait: false, origin: { kind: 'composer' } })
    await set.clock.settle()
    await stepIn($, on, set, 'turn-img', 1)
    await endTurn($, set, 'turn-img')

    expect(set.forks).toEqual([])
  })

  test('a compaction since the prompt: nothing is forked', async ($, on) => {
    const set = skuld(on)

    on('session.compact', () => ({ messages: [dev('This session is being continued from a previous conversation.')] }) as never)
    await $.session.start(START)
    await paste($)
    await set.clock.settle()
    await stepIn($, on, set, 'turn-img', 0)
    set.rows.push(dev(PASTED))
    await $.session.compact({ trigger: 'manual', messages: [...set.rows] } as never)
    await set.clock.settle()
    await stepIn($, on, set, 'turn-img', 1)
    await endTurn($, set, 'turn-img')

    expect(set.forks).toEqual([])
  })

  test(`the cache has gone cold: more than ${WARM_MS / 1000} s since the last response, the step’s boundary passes, the turn’s end reads it`, async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await paste($)
    await set.clock.settle()
    await stepIn($, on, set, 'turn-img', 0)
    await set.clock.advance(WARM_MS + 1000)
    await stepIn($, on, set, 'turn-img', 1)

    expect(set.forks, 'not at the boundary').toEqual([])

    await endTurn($, set, 'turn-img')

    expect(set.forks, 'at the turn’s end, just after a response').toHaveLength(1)
  })

  test('one at a time: a boundary while a fork is out makes none', async ($, on) => {
    let release: (answer: { text: string }) => void = () => undefined
    const set = skuld(on, { forks: () => new Promise(resolve => (release = resolve)) })

    await $.session.start(START)
    await paste($)
    await set.clock.settle()
    await stepIn($, on, set, 'turn-img', 0)
    await stepIn($, on, set, 'turn-img', 1)
    await stepIn($, on, set, 'turn-img', 2)

    expect(set.forks).toHaveLength(1)

    release({ text: readingReply() })
    await set.clock.settle()
    await endTurn($, set, 'turn-img')

    expect(set.forks).toHaveLength(1)
    expect(set.of('save_image_reading')).toHaveLength(1)
  })

  test(`no more than ${MAX_FORKS} forks in a session, retries included`, async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)

    for (const turn of ['one', 'two', 'three', 'four']) {
      await paste($, `${turn}: the export does nothing [Image #1]`)
      await set.clock.settle()
      await stepIn($, on, set, turn, 0)
      await stepIn($, on, set, turn, 1)
      await endTurn($, set, turn)
    }

    expect(set.forks).toHaveLength(MAX_FORKS)
  })

  test('once a fork found the cache cold, none follows in the session', async ($, on) => {
    const set = skuld(on, { forks: () => ({ text: readingReply(), cacheRead: 100, input: 9000 }) })

    await $.session.start(START)
    await reported($, on, set, 'one')
    await reported($, on, set, 'two')

    expect(set.forks).toHaveLength(1)
  })
})

describe('what the fork answers is checked before anything of it is kept', () => {
  test('an echo of another message: tried once more at the turn’s end, then given up', async ($, on) => {
    const set = skuld(on, { forks: () => ({ text: readingReply({ echo: 'a different message altogether' }) }) })

    await $.session.start(START)
    await reported($, on, set)

    expect(set.forks, 'one at the boundary, one at the turn’s end').toHaveLength(2)

    await endTurn($, set, 'turn-next')

    expect(set.forks, 'and none after').toHaveLength(2)
    expect(set.of('save_image_reading')).toEqual([])
  })

  test('a mismatch, then the right message at the turn’s end: kept', async ($, on) => {
    const set = skuld(on, { forks: n => ({ text: n === 1 ? readingReply({ echo: 'another' }) : readingReply() }) })

    await $.session.start(START)
    await reported($, on, set)
    await endTurn($, set, 'turn-next')

    expect(set.forks).toHaveLength(2)
    expect(set.of('save_image_reading')).toHaveLength(1)
  })

  test('an aborted fork is tried once more at the turn’s end', async ($, on) => {
    const set = skuld(on, { forks: n => (n === 1 ? { reason: 'aborted' } : { text: readingReply() }) })

    await $.session.start(START)
    await reported($, on, set)
    await endTurn($, set, 'turn-next')

    expect(set.forks).toHaveLength(2)
    expect(set.of('save_image_reading')).toHaveLength(1)
  })

  test('the image not visible, or a different count: not kept', async ($, on) => {
    const set = skuld(on, { forks: n => ({ text: readingReply(n === 1 ? { image_visible: false } : { images_seen: 2 }) }) })

    await $.session.start(START)
    await reported($, on, set)
    await endTurn($, set, 'turn-next')

    expect(set.forks).toHaveLength(2)
    expect(set.of('save_image_reading')).toEqual([])
  })

  test('a reply that carries an image’s bytes is stopped before it is kept, and not asked again', async ($, on) => {
    const blob = `iVBORw0KGgoAAAANSUhEUgAA${'A'.repeat(600)}`
    const set = skuld(on, { forks: () => ({ text: readingReply({ observed: `The screen shows ${blob}` }) }) })

    await $.session.start(START)
    await reported($, on, set)
    await endTurn($, set, 'turn-next')

    expect(set.forks).toHaveLength(1)
    expect(set.of('save_image_reading')).toEqual([])
    expect(JSON.stringify([...set.kept.values()])).not.toContain('iVBORw0KGgo')
  })

  test('an expectation without its basis, or longer than a sentence, is not stated', async ($, on) => {
    const set = skuld(on, { forks: () => ({ text: readingReply({ expected_basis: null }) }) })

    await $.session.start(START)
    await reported($, on, set)
    await endTurn($, set, 'turn-next')

    const [sent] = set.of('save_image_reading')

    expect(sent).toBeDefined()
    expect(sent).not.toHaveProperty('expected')
    expect(sent).not.toHaveProperty('expected_basis')
  })
})

describe('the reader stays out', () => {
  test('a prompt with no image arms nothing', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await $.prompt.submit({ text: 'fix the export', wait: false, origin: { kind: 'composer' } })
    await stepIn($, on, set, 'turn-1', 0)
    await stepIn($, on, set, 'turn-1', 1, [{ name: 'Edit', input: { file_path: `/work/repo/${FIXED}`, old_string: 'a', new_string: 'b' } }])
    await endTurn($, set, 'turn-1')

    expect([set.gates, set.forks]).toEqual([[], []])
  })

  test('with the images switch off nothing is judged or forked', { options: { images: false } }, async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await reported($, on, set)

    expect([set.gates, set.forks, set.of('save_image_reading')]).toEqual([[], [], []])
  })

  test('with Scribe off nothing is judged or forked', { options: { scribe: false } }, async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await reported($, on, set)

    expect([set.gates, set.forks, set.of('save_image_reading')]).toEqual([[], [], []])
  })

  test('signed out of Fylgja, nothing is forked', async ($, on) => {
    const set = skuld(on, { connect: () => NEEDS_SIGN_IN })

    await $.session.start(START)
    await reported($, on, set)

    expect(set.forks).toEqual([])
  })

  test('the reading is the session’s: Fylgja has it as the turn ended, under its id', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await reported($, on, set)

    expect(set.of('save_image_reading')).toHaveLength(1)
    expect(READING_ID).toMatch(/^[0-9a-f-]{36}$/)
  })
})
