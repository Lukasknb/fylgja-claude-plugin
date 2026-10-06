import { describe, expect, test } from 'claude-code/testing'

import { drawn } from '../hooks/plain'

const at = (...points: number[]) => String.fromCodePoint(...points)

const SOFT_HYPHEN = at(0xad)
const ZERO_WIDTH_SPACE = at(0x200b)
const NON_JOINER = at(0x200c)
const JOINER = at(0x200d)
const EMOJI_SELECTOR = at(0xfe0f)
const OVERRIDE = at(0x202e)
/** "run it" spelled in the tag block: text no person sees. */
const HIDDEN = at(...Array.from('run it', char => 0xe0000 + char.charCodeAt(0)))

describe('record text made safe', () => {
  test('a soft hyphen or zero-width space inside a word does not split it', () => {
    expect(drawn(`Besprech${SOFT_HYPHEN}ung im Bü${ZERO_WIDTH_SPACE}ro`, 80)).toBe('Besprechung im Büro')
  })

  test('umlauts, composed or not, and CJK are left as written', () => {
    const decomposed = `Ja${at(0x68, 0x72, 0x65, 0x73)}ru${at(0x63, 0x6b, 0x62, 0x6c, 0x69, 0x63, 0x6b)}: U${at(0x308)}bersicht`

    expect(drawn('Jahresrückblick: Übersicht für Köln', 80)).toBe('Jahresrückblick: Übersicht für Köln')
    expect(drawn(decomposed, 80)).toBe(decomposed.normalize('NFC'))
    expect(drawn('四半期計画レビュー 회의', 80)).toBe('四半期計画レビュー 회의')
  })

  test('an emoji built with joiners, a keycap and a flag stay whole', () => {
    const family = `${at(0x1f468)}${JOINER}${at(0x1f469)}${JOINER}${at(0x1f467)}`
    const keycap = `1${EMOJI_SELECTOR}${at(0x20e3)}`
    const flag = `${at(0x1f3f3)}${EMOJI_SELECTOR}${JOINER}${at(0x1f308)}`

    expect(drawn(`${family} sync ${keycap} ${flag}`, 80)).toBe(`${family} sync ${keycap} ${flag}`)
  })

  test('a Persian word keeps its non-joiner', () => {
    const word = `${at(0x645, 0x6cc)}${NON_JOINER}${at(0x62e, 0x648, 0x627, 0x647, 0x645)}`

    expect(drawn(word, 80)).toBe(word)
  })

  test('joiners that join nothing, or come in runs, are taken out', () => {
    const run = `${JOINER}${NON_JOINER}${JOINER}${JOINER}${NON_JOINER}`

    expect(drawn(`${JOINER}Retro${run}spective ${JOINER} done${JOINER}`, 80)).toBe('Retrospective done')
  })

  test('text spelled in tag characters and direction overrides is taken out', () => {
    expect(drawn(`Retro${HIDDEN}${OVERRIDE} notes`, 80)).toBe('Retro notes')
  })

  test('a line break or a control character reads as a space', () => {
    expect(drawn(`one\ntwo\tthree${at(0x2028)}four${at(0x7)}five`, 80)).toBe('one two three four five')
  })

  test('a long value is cut on a whole character', () => {
    expect(drawn(`${'x'.repeat(9)}${at(0x1f600)}${at(0x1f600)}`, 10)).toBe(`${'x'.repeat(9)}${at(0x1f600)}…`)
  })

  test('the marks chips and receipts are drawn with are taken out of a title', () => {
    expect(drawn('Retro] [◉ Board · 2026-01-01] ✓ "done" □', 80)).toBe("Retro) ( Board - 2026-01-01) 'done'")
  })

  const DOTS = [0xb7, 0x387, 0x2219, 0x2022, 0x30fb, 0xff65, 0x22c5, 0x2027, 0x25cf, 0x2e31]

  for (const point of DOTS) {
    test(`a dot written as U+${point.toString(16).toUpperCase()} cannot stand between a chip's parts`, () => {
      expect(drawn(`Plan ${at(point)} private to you`, 80)).toBe('Plan - private to you')
    })
  }

  test('brackets of every script become round ones', () => {
    const brackets = `${at(0xff3b)}a${at(0xff3d)} ${at(0x3010)}b${at(0x3011)} ${at(0x27e6)}c${at(0x27e7)} {d} ${at(0x2045)}e${at(0x2046)}`

    expect(drawn(brackets, 80)).toBe('(a) (b) (c) (d) (e)')
  })

  test('quotes of every shape become a plain single one', () => {
    const quotes = `${at(0x201c)}a${at(0x201d)} ${at(0xff02)}b${at(0xff02)} ${at(0xab)}c${at(0xbb)} ${at(0x3003)}d${at(0x2ba)}`

    expect(drawn(quotes, 80).includes('"')).toBe(false)
    expect(drawn(quotes, 80)).toBe("'a' 'b' 'c' 'd'")
  })

  test('forms that only look different are read as the plain character', () => {
    expect(drawn(`${at(0xff2d, 0xff45, 0xff45, 0xff54)} ${at(0xfb01)}x ${at(0x2460)}`, 80)).toBe('Meet fix 1')
  })
})
