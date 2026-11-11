import { describe, expect, test } from 'claude-code/testing'

import { holdsBytes } from '../hooks/reader/bytes'
import { promptHash } from '../hooks/reader/key'
import { isEcho } from '../hooks/reader/reply'
import { FIX_TURNS } from '../hooks/reader/reader'
import { STORE } from '../hooks/scribe/scribe'
import * as Journal from '../hooks/scribe/journal'
import { band, press, pressTwice, ROOT, send, SESSION_ID, shown, START } from './scribe-fixtures'
import { EXPECTED, FIXED, paste, QUOTE, readingReply, reported, endTurn, skuld, stepIn } from './skuld-fixtures'

/**
 * The key of a prompt, as the server computes it (`prompt_hash` of
 * `apps/api/app/domain/services/image_reading.py`): each digest below was
 * written by that code, so the two sides are held to the same bytes.
 */
const VECTORS: readonly [string, string | readonly string[], string][] = [
  ['a marker is removed, not spaced', 'a[Image #1]b', 'fb8e20fc2e4c3f248c60c39bd652f3c1347298bb977b8b4d5903b85055620603'],
  ['a byte-order mark at either end is trimmed', '﻿hello world﻿', 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'],
  ['U+0085 is no whitespace', 'a\u0085b', '75e7cf7e9bf896d878d3b49a7225fc0ef80d9b03356eb6d783bb276e67afe8fa'],
  ['U+001C is no whitespace', 'a\u001cb', '3b03cf1af522d0d5542860e2cfaeb87d480f43b2f7dd842ed03317c651ea1ed9'],
  ['NFD becomes NFC', 'café ok', '71759d3bdf8738540af3d3f74026ca93323e1141ff32cb5db6937859c9e19b12'],
  ['two text blocks join with a line break', ['first block', 'second block'], '6a9e7549cd68356d3564ee6061a0629c58bf793eab2b2bf5e7477a42104e93b1'],
  ['CRLF is one space', 'line one\r\nline two', 'e490ed577595f61675761642aa202c2f1f59ef292f58c24fe0b431b05eeb86ec'],
  ['an image-only prompt is the empty text', '[Image #1] [Image #2]', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['a marker between words leaves one space', 'see [Image #1] here', 'ddf32d0c5e9c0d4dd008fd8c9d36b3a9404d1706b93ce97630a0dc0f28a0628e'],
]

describe('the key is the server’s, byte for byte', () => {
  for (const [name, text, digest] of VECTORS) {
    test(name, async () => {
      expect(await promptHash(text)).toBe(digest)
    })
  }
})

describe('what a fork reads is held to what the server holds', () => {
  test('an echo cut short of a long prompt still matches, from either side', () => {
    const long = `[Image #1] ${'the totals on the invoice export differ from the screen, '.repeat(7)}`

    expect(isEcho(long, long.slice(11, 261))).toBe(true)
    expect(isEcho(long, 'the totals on the invoice')).toBe(false)
  })

  test('an encoded blob broken into lines, or a data URL with a space, is bytes', () => {
    const line = 'QmFzZTY0IGVuY29kZWQgaW1hZ2UgZGF0YSBzcGxpdCBpbnRvIGxpbmVzIG9mIHNldmVudHktc2l4IGNoYXJz'

    expect(holdsBytes(Array.from({ length: 8 }, () => line).join('\n'))).toBe(true)
    expect(holdsBytes('it shows data: image/png in the console')).toBe(true)
    expect(holdsBytes('commit 3f9a2c1e0b7d4a6f8e2c1d3b5a7f9e0c2d4b6a8f in src/invoices/export.ts')).toBe(false)
  })

  test('a description that copies the words in the image is not kept, and nothing of it is sent', async ($, on) => {
    const set = skuld(on, {
      forks: () => ({
        text: readingReply({ observed: `The colleague writes: ${QUOTE}.` }),
      }),
    })

    await $.session.start(START)
    await reported($, on, set)
    await endTurn($, set, 'turn-next')

    expect(set.of('save_image_reading')).toEqual([])
    expect(JSON.stringify(set.calls)).not.toContain('macht gar nichts')
  })

  test('an expectation that copies them is not stated', async ($, on) => {
    const set = skuld(on, {
      forks: () => ({
        text: readingReply({ expected: `When exporting: ${QUOTE}.` }),
      }),
    })

    await $.session.start(START)
    await reported($, on, set)

    expect(set.of('save_image_reading')[0]).not.toHaveProperty('expected')
  })
})

describe('words that prove nothing are read only at a step of their own turn', () => {
  test('an image with no words beside it is not forked for at the turn’s end', async ($, on) => {
    const set = skuld(on, {
      forks: () => ({ text: readingReply({ echo: '' }) }),
    })

    await $.session.start(START)
    await paste($, '[Image #1]')
    await set.clock.settle()
    await stepIn($, on, set, 'turn-img', 0)
    await endTurn($, set, 'turn-img')

    expect(set.forks).toEqual([])
  })

  test('the same words as an earlier image prompt: read at a step, never at the turn’s end', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await reported($, on, set, 'one')
    await paste($)
    await set.clock.settle()
    await stepIn($, on, set, 'two', 0)
    await endTurn($, set, 'two')

    expect(set.forks).toHaveLength(1)
  })
})

describe('a fork the engine would not make costs nothing', () => {
  test('refused forks are not counted against the session’s three', async ($, on) => {
    const set = skuld(on, {
      forks: n => (n <= 3 ? { deny: 'not now' } : { text: readingReply({ echo: 'second report' }) }),
    })

    await $.session.start(START)
    await reported($, on, set, 'one')

    for (const turn of ['two']) {
      await paste($, 'second report [Image #1]')
      await set.clock.settle()
      await stepIn($, on, set, turn, 0)
      await stepIn($, on, set, turn, 1)
      await endTurn($, set, turn)
    }

    // Read at the turn's end, it is sent at the next.
    await endTurn($, set, 'three')

    expect(set.forks).toHaveLength(4)
    expect(set.of('save_image_reading')).toHaveLength(1)
  })
})

describe('the kept sentence is the one the developer confirmed', () => {
  test('a sentence Fylgja refuses is never reworded by a model: the question comes back with its field open', async ($, on) => {
    const set = skuld(on, {
      tools: {
        remember: () => ({
          content: [
            {
              type: 'text',
              text: 'refused:not_one_sentence the content must be one sentence',
            },
          ],
          isError: true,
        }),
      },
      wake: asked =>
        asked.system.startsWith('A knowledge base refused one record')
          ? JSON.stringify({
              record: { content: 'A sentence nobody confirmed.' },
            })
          : '{"outcome":"nothing"}',
    })

    await $.session.start(START)
    await reported($, on, set)
    await pressTwice($, 'keep')

    expect(set.of('remember')).toHaveLength(1)
    expect(await shown($)).toContain(`<${EXPECTED}>`)
  })

  test('a transcribed sentence the server no longer holds as the reading’s (its scrub changed it) is put to the developer to word', async ($, on) => {
    const set = skuld(on, {
      tools: {
        remember: () => ({
          content: [
            {
              type: 'text',
              text: 'refused:basis_mismatch the sentence is not the reading’s expected',
            },
          ],
          isError: true,
        }),
      },
    })

    await $.session.start(START)
    await reported($, on, set)
    await pressTwice($, 'keep')

    const ui = await band($)

    await ui.enter('wording-text', 'When a user presses Export, the listed invoices download as a CSV file.')
    await ui.unmount()

    expect(set.of('remember').map(args => args.basis)).toEqual(['transcribed', 'stated'])
  })

  test('a reading Fylgja says is settled as no requirement is no longer asked about or kept', async ($, on) => {
    const set = skuld(on, {
      tools: {
        remember: () => ({
          content: [
            {
              type: 'text',
              text: 'refused:reading_not_requirement — the developer said this reading is not a requirement; that verdict is final',
            },
          ],
          isError: true,
        }),
      },
    })

    await $.session.start(START)
    await reported($, on, set)
    await pressTwice($, 'keep')
    await send($, 'on')
    await endTurn($, set, 'turn-2')

    expect(await shown($), 'not asked again').not.toContain('Expected')

    // Settled as the server holds it: the session's log says so, and a later load never asks again.
    const log = Journal.fold([...set.kept].flatMap(([key, value]) => (key.startsWith(`${Journal.PREFIX}${SESSION_ID}.`) ? (Journal.segmentOf(value) ?? []) : [])))

    expect(log.groups.images?.readings.map(one => one.verdict)).toEqual(['not_requirement'])
    await send($, 'on again')
    await endTurn($, set, 'turn-3')

    expect(set.of('remember')).toHaveLength(1)
    expect(await shown($)).not.toContain('Expected')
  })
})

describe('the question has a budget of its own', () => {
  test('typing past it holds back none of Scribe’s other offers', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await reported($, on, set)
    await send($, 'carry on')

    expect(set.kept.get(STORE.typedPast) ?? 0).toBe(0)
  })

  test('Keep pressed once, then a prompt sent past it: typed past, shown once more', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await reported($, on, set)
    await press($, 'keep')
    await send($, 'carry on')
    await endTurn($, set, 'turn-2')

    expect(set.of('remember')).toEqual([])
    expect(await shown($)).toContain(`? Expected: ${EXPECTED}`)
  })

  test('switched off in /config, the waiting question goes and nothing more is sent', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await reported($, on, set)
    await $.config.set({
      key: 'fylgja.images',
      value: false,
      previous: true,
      provider: { plugin: 'fylgja', tier: 'user' },
      origin: { kind: 'composer' },
    } as never)

    expect(await shown($)).not.toContain('Expected')
  })
})

describe('the fix is looked for while the report is the work in hand', () => {
  test(`a fix that lands more than ${FIX_TURNS} turns later is no fix of it`, async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await reported($, on, set, 'turn-img', [])

    for (let n = 1; n <= FIX_TURNS + 1; n += 1) {
      await send($, `turn ${n}`)
      await endTurn($, set, `turn-${n}`)
    }

    await send($, 'now fix it')
    await stepIn($, on, set, 'late', 0, [
      {
        name: 'Edit',
        input: {
          file_path: `${ROOT}/${FIXED}`,
          old_string: 'a',
          new_string: 'b',
        },
      },
    ])
    await endTurn($, set, 'late')

    expect(await shown($)).not.toContain('Expected')
  })

  test('a sentence that could not be worked out is tried again at a later turn’s end', async ($, on) => {
    const said = 'When a user presses Export, the listed invoices download as a CSV file.'
    const set = skuld(on, {
      forks: () => ({
        text: readingReply({ expected: null, expected_basis: null }),
      }),
      statement: n =>
        n === 1
          ? undefined
          : JSON.stringify({
              statement: said,
              quote: 'the listed invoices download as a CSV file',
            }),
    })

    await $.session.start(START)
    await reported($, on, set, 'turn-img', [FIXED], 'Fixed: pressing Export, the listed invoices download as a CSV file again.')

    expect(await shown($)).not.toContain('Expected')

    await send($, 'thanks')
    await endTurn($, set, 'turn-2', 'Fixed: pressing Export, the listed invoices download as a CSV file again.')

    expect(set.statements).toHaveLength(2)
    expect(await shown($)).toContain(`? Expected: ${said}`)
  })
})
