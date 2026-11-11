import { describe, expect, test } from 'claude-code/testing'

import { echoesQuote } from '../hooks/reader/quote'
import { isEcho, readingOf } from '../hooks/reader/reply'
import * as Band from '../hooks/scribe/band'
import * as Journal from '../hooks/scribe/journal'
import { STORE } from '../hooks/scribe/scribe'
import { claude, dev, edit, pressTwice, ROOT, send, SESSION_ID, shown, START, turn } from './scribe-fixtures'
import type { Stage } from './scribe-fixtures'
import { EXPECTED, FIXED, OBSERVED, paste, readingReply, reported, endTurn, skuld, stepIn } from './skuld-fixtures'
import type { Engine } from 'claude-code/testing'

const FIX = [{ name: 'Edit', input: { file_path: `${ROOT}/${FIXED}`, old_string: 'a', new_string: 'b' } }]

/** The plugin loaded afresh for the conversation: what it held is gone, and the store stays. */
async function reloaded($: Engine, set: Stage): Promise<void> {
  await set.clock.settle()
  await $.session.start(START)
  await set.clock.settle()
}

/** A requirement question as the band holds it. */
function question(more: Partial<Band.RequirementQuestion> = {}): Band.RequirementQuestion {
  return {
    kind: 'question',
    form: 'requirement',
    reading: `${'a'.repeat(64)}@2026-11-11T10:00:00.000Z`,
    content: EXPECTED,
    basis: 'transcribed',
    observed: OBSERVED,
    repo: 'acme/web',
    anchors: [{ path: FIXED }],
    isTouched: false,
    ...more,
  }
}

describe('the echo, and the words in the image, are held to strictly', () => {
  test('an echo longer than a short prompt is another message', () => {
    expect(isEcho('Look at this', 'Look at this screenshot from the customer, the totals are off')).toBe(false)
    expect(isEcho('Look at this', 'Look at this')).toBe(true)
  })

  test('words copied from beyond what the card shows of the quote are caught', () => {
    const quote = `${'Vorwort ohne Belang hier. '.repeat(20)}der Export liefert keine Datei mehr zurück`
    const text = readingReply({ quote, observed: 'The colleague says der Export liefert keine Datei mehr zurück.' })

    expect(quote.length).toBeGreaterThan(400)
    expect(readingOf(text, 'the export on the invoice list does nothing, see the screenshot', 1)).toEqual({ refused: 'quoted' })
  })

  test('copied words are found whatever their case, and in fullwidth letters', () => {
    expect(echoesQuote('DER EXPORT LIEFERT KEINE DATEI MEHR', 'der Export liefert keine Datei mehr')).toBe(true)
    expect(echoesQuote('ｄｅｒ ｅｘｐｏｒｔ ｌｉｅｆｅｒｔ ｋｅｉｎｅ ｄａｔｅｉ ｍｅｈｒ', 'der export liefert keine datei mehr')).toBe(true)
  })
})

describe('the question’s own budget', () => {
  test('offers held back for having been ignored never hold back a question about a report', async ($, on) => {
    const set = skuld(on, { kept: { [STORE.typedPast]: 6, [STORE.skip]: 8 } })

    await $.session.start(START)
    await reported($, on, set)

    expect(await shown($)).toContain(`? Expected: ${EXPECTED}`)
  })

  test('one let go unseen gives its place in the session’s share back; one shown once more was never counted', () => {
    const band = Band.create()
    const first = question()

    expect(Band.offerRequirement(band, first)).toBe(true)
    expect(band.requirements).toBe(1)

    Band.droppedRequirement(band, first)

    expect(band.requirements).toBe(0)

    Band.droppedRequirement(band, question({ isAgain: true }))

    expect(band.requirements).toBe(0)
  })
})

describe('what a report is, across turns and loads', () => {
  test('a later image prompt closes the window of the one before: only the newer report is asked about', async ($, on) => {
    const set = skuld(on, { forks: n => ({ text: readingReply({ echo: n === 1 ? 'first report' : 'second report' }) }) })

    await $.session.start(START)

    for (const [n, text] of [[1, 'first report [Image #1]'], [2, 'second report [Image #1]']] as const) {
      await paste($, text)
      await set.clock.settle()
      await stepIn($, on, set, `r${n}`, 0)
      await stepIn($, on, set, `r${n}`, 1)
      await endTurn($, set, `r${n}`)
    }

    await send($, 'fix it')
    await stepIn($, on, set, 'fix', 0, FIX)
    await endTurn($, set, 'fix')
    await pressTwice($, 'not-requirement')
    await send($, 'and on')
    await endTurn($, set, 'after')

    expect(set.events('image').filter(event => event.props.stage === 'ask'), 'the second report alone').toHaveLength(1)
  })

  test('a fix that lands after a reload, within the window, is still the report’s', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await reported($, on, set, 'turn-img', [])
    await reloaded($, set)
    await send($, 'fix it')
    await stepIn($, on, set, 'fix', 0, FIX)
    await endTurn($, set, 'fix')

    expect(await shown($)).toContain(`? Expected: ${EXPECTED}`)
  })

  test('a reading picked up from the log is held to the byte guard before it is sent', async ($, on) => {
    const set = skuld(on)
    const blob = `QmFzZTY0IGVuY29kZWQgaW1hZ2UgZGF0YQ${'A'.repeat(600)}`

    await $.session.start(START)
    await turn($, set, dev('carry on'), claude('Done.', edit('src/other.ts')))
    set.kept.set(`${Journal.PREFIX}${SESSION_ID}.abcd1234`, {
      conv: SESSION_ID,
      writer: 'abcd1234',
      at: 1,
      tie: null,
      seed: null,
      count: 0,
      lines: [
        JSON.stringify({
          at: 1,
          set: {
            images: {
              readings: [
                {
                  key: `${'b'.repeat(64)}@2026-11-11T10:00:00.000Z`,
                  promptHash: 'b'.repeat(64),
                  promptedAt: '2026-11-11T10:00:00.000Z',
                  sessionId: SESSION_ID,
                  imageCount: 1,
                  shows: 'app_ui',
                  legibility: 'clear',
                  reporterRole: 'colleague',
                  observed: `The screen shows ${blob}`,
                  expected: null,
                  expectedBasis: null,
                  workState: 'unknown',
                  id: null,
                  isSynced: false,
                  verdict: null,
                  asking: 'not_yet',
                  before: [],
                  dirty: null,
                  since: [],
                  statement: null,
                  spokenFrom: 0,
                  turnsLeft: 3,
                },
              ],
              forks: 1,
              isCold: false,
              requirements: 0,
              typedPast: 0,
            },
          },
        }),
      ],
    })
    await reloaded($, set)
    await send($, 'on')
    await endTurn($, set, 'next')

    expect(set.of('save_image_reading')).toEqual([])
  })

  test('the model finding nothing stated is an answer: it is not asked again', async ($, on) => {
    const set = skuld(on, { forks: () => ({ text: readingReply({ expected: null, expected_basis: null }) }), statement: '{"none":true}' })

    await $.session.start(START)
    await reported($, on, set)
    await send($, 'on')
    await endTurn($, set, 'next')

    expect(set.statements).toHaveLength(1)
  })

  test('a slash command is no prompt of the conversation: the image prompt stays the latest', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await paste($)
    await set.clock.settle()
    await stepIn($, on, set, 'turn-img', 0)
    await $.prompt.submit({ text: '/fylgja-kept', wait: false, origin: { kind: 'composer' }, command: { name: 'fylgja-kept', args: '', text: '/fylgja-kept' } } as never)
    await set.clock.settle()
    await stepIn($, on, set, 'turn-img', 1)

    expect(set.forks).toHaveLength(1)
  })
})
