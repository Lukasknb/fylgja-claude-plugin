import { describe, expect, test } from 'claude-code/testing'

import type { Host } from '../hooks/host'
import { painted } from '../hooks/paint'
import * as Picker from '../hooks/picker'
import * as Source from '../hooks/source'
import { idOf, RETRO, scene, token, type } from './fixtures'

/** A draft of a hundred thousand characters: prose, with a reference every few thousand. */
function longDraft(references: number): string {
  const prose = 'the quick brown fox jumps over the lazy dog and keeps going. '
  const parts: string[] = []

  for (let n = 0; parts.join('').length < 100_000; n += 1) {
    parts.push(prose.repeat(40))

    if (n < references) {
      parts.push(`${token('meeting', `Weekly sync ${n}`, idOf(n))} `)
    }
  }

  return parts.join('').slice(0, 100_000)
}

/** A host that counts what it is asked and does none of it. */
function countingHost(): { host: Host; asked: string[] } {
  const asked: string[] = []
  const note = (name: string) => (): never => {
    asked.push(name)

    throw new Error(`${name} on a keystroke`)
  }

  return {
    asked,
    host: {
      connect: note('connect'),
      call: note('call'),
      read: note('read'),
      fill: note('fill'),
      close: note('close'),
      redraw: () => undefined,
      after: () => ({ cancel: () => undefined }),
      every: () => ({ cancel: () => undefined }),
    },
  }
}

/**
 * Everything the plugin's own code does on one keystroke, timed: the check
 * for a key that works the list, following the draft, and the paint. What
 * the engine does beneath (applying the edit) is not the plugin's time.
 */
function timeKeystrokes(
  draft: string,
  typed: string,
  isOpen: boolean,
): { median: number; slowest: number; asked: string[] } {
  const { host, asked } = countingHost()
  const source = Source.create()
  const picker = Picker.create()
  const times: number[] = []
  let text = draft

  source.recents = {
    list: [{ kind: 'meeting', id: RETRO.id, title: RETRO.title, date: RETRO.date }],
    at: performance.now(),
  }

  if (isOpen) {
    text += ' @@'
    Picker.follow(host, picker, source, undefined, {
      text,
      cursor: text.length,
    })
  }

  for (let n = 0; n < 300; n += 1) {
    const char = typed[n % typed.length] ?? 'x'
    const edit = {
      key: { key: char },
      text,
      cursor: text.length,
      start: text.length,
      end: text.length,
      inputText: char,
    }
    const began = performance.now()
    const taken = Picker.keyTaken(host, picker, source, edit)
    const box = { text: text + char, cursor: text.length + 1 }
    const answer = painted(taken ?? Picker.follow(host, picker, source, edit, box) ?? box)

    times.push(performance.now() - began)
    text = answer.text
  }

  times.sort((a, b) => a - b)

  return {
    median: times[150] ?? Infinity,
    slowest: times[296] ?? Infinity,
    asked,
  }
}

describe('a keystroke is never kept waiting', () => {
  test('in a draft of 100,000 characters with no reference and no list, the hook’s own work is far under its 50 ms', () => {
    const timed = timeKeystrokes(longDraft(0), 'plain words ', false)

    expect(timed.median < 1, `median ${timed.median} ms`).toBe(true)
    expect(timed.slowest < 10, `slowest ${timed.slowest} ms`).toBe(true)
    expect(timed.asked).toEqual([])
  })

  test('the same with twenty references to paint and the list open and following every key', () => {
    const timed = timeKeystrokes(longDraft(20), 'retro planning', true)

    expect(timed.median < 3, `median ${timed.median} ms`).toBe(true)
    expect(timed.slowest < 15, `slowest ${timed.slowest} ms`).toBe(true)
    expect(timed.asked, 'nothing is asked of Fylgja, and the draft is not read back, on a keystroke').toEqual([])
  })

  test('every edit is answered while Fylgja has answered nothing yet', async ($, on) => {
    const started = scene(on, {
      timeline: async clock => {
        await clock.sleep(60_000)

        return { content: [], isError: false }
      },
      search: async (query, clock) => {
        await clock.sleep(60_000)

        return { content: [], isError: false }
      },
    })

    started.box.text = longDraft(20)
    started.box.cursor = started.box.text.length

    // No clock moves here: each answer comes back with every timer still held.
    const box = await type($, started, ' @@retro planning')

    expect(box.text.endsWith(' @@retro planning')).toBe(true)
    expect(box.decorations?.length).toBe(60)
    expect(started.calls).toEqual([])

    await started.clock.advance(400)

    expect(started.calls.map(call => call.tool)).toEqual(['search'])
  })
})
