/**
 * The one place text from a Fylgja record is made safe to draw.
 */

import { GLYPHS } from './glyphs'

// Characters that draw as nothing and are simply taken out: soft hyphen,
// zero-width space, bidirectional controls, invisible operators, variation
// selectors, and the Unicode tag block, which can spell text no person sees.
const GONE =
  /[\u00ad\u034f\u061c\u180b-\u180f\u200b\u200e-\u200f\u202a-\u202e\u2060-\u206f\ufe00-\ufe0e\ufeff\ufff9-\ufffb\u{1bca0}-\u{1bca3}\u{1d173}-\u{1d17a}\u{e0000}-\u{e0fff}]/gu

// Characters that stand where a gap is seen, read as a space: control
// characters, line and paragraph separators, and blank fillers.
const BLANK = /[\u0000-\u001f\u007f-\u009f\u115f\u1160\u17b4\u17b5\u2028\u2029\u2800\u3164\uffa0\ufff0-\ufff8\ufffc]/gu

// The joiners and the emoji selector. Real writing needs them one at a time
// between visible characters (a family emoji, a keycap, Persian); anywhere
// else, or in a longer run, they carry nothing a person sees.
const JOINERS = /[\u200c\u200d\ufe0f]+/gu
const ONE_JOIN = /^\ufe0f?[\u200c\u200d]?$/u
const JOINS = /[\u200c\u200d]/u

// Every double quote and everything that draws like one. A chip puts a
// record's title between double quotes, so a title must hold none.
const QUOTES = /[\u0022\u02ba\u02dd\u02ee\u05f4\u2033\u2036\u3003\p{Pi}\p{Pf}]/gu

// A middle dot and everything that draws like one: the mark between the
// parts of a chip.
const DOTS =
  /[\u00b7\u0387\u05c5\u16eb\u2022-\u2024\u2027\u2043\u204c-\u204d\u2219\u22c5\u2981\u25aa-\u25ab\u25cb\u25cf\u25d8-\u25d9\u25e6\u2b24\u2e30-\u2e31\u2e33\u30fb\ua78f\uff65\u{10101}]/gu

const MARKS = new RegExp(`[${GLYPHS.join('')}✓]`, 'gu')

function cut(value: string, max: number): string {
  const chars = Array.from(value)

  return chars.length <= max ? value : `${chars.slice(0, max).join('').trimEnd()}…`
}

function isSeen(char: string | undefined): boolean {
  return char !== undefined && !/\s/u.test(char)
}

function seen(value: string): string {
  return value
    .replace(GONE, '')
    .replace(BLANK, ' ')
    .replace(JOINERS, (run: string, at: number, whole: string) => {
      const isBetween = isSeen(whole[at - 1]) && (!JOINS.test(run) || isSeen(whole[at + run.length]))

      return ONE_JOIN.test(run) && isBetween ? run : ''
    })
}

/**
 * `value` for the screen: on one line, at most `max` characters, without
 * invisible characters and without anything this plugin draws with.
 *
 * Look-alike forms are folded to the plain character first (a full-width
 * bracket is a bracket, a Greek ano teleia is a middle dot). Then every
 * opening bracket becomes `(`, every closing one `)`, every dot-like mark
 * `-`, every quote-like mark `'`, and the record glyphs and the tick go. So
 * no record's text can pass as a chip, as the mark between a chip's parts,
 * as the quotes around a chip's title, or as a receipt's tick.
 */
export function drawn(value: string, max: number): string {
  const flat = seen(value.normalize('NFKC'))
    .replace(QUOTES, "'")
    .replace(/\p{Ps}/gu, '(')
    .replace(/\p{Pe}/gu, ')')
    .replace(DOTS, '-')
    .replace(MARKS, '')
    .replace(/\s+/g, ' ')
    .trim()

  return cut(flat, max)
}

/**
 * `value` line by line, without the characters no person sees: what is safe
 * to hand to a model as quoted text. A record could otherwise carry words in
 * the Unicode tag block that a person reading the same record never saw.
 */
export function lines(value: string): string[] {
  return value.split(/\r\n|\r|\n/).map(line => seen(line).replace(/[ \t]+$/, ''))
}

/** `value` on one line with only the invisible characters taken out, at most `max` characters. */
export function flat(value: string, max: number): string {
  return cut(lines(value).join(' ').replace(/\s+/g, ' ').trim(), max)
}

// Anything a Markdown drawing could turn into a link: an address with a
// scheme, a bare `www.` host, a mail address scheme.
const ADDRESS = /\b(?:[a-z][a-z0-9+.-]{1,20}:\/\/|www\.|mailto:)[^\s)\]>]*/giu

// A Markdown link or image, kept as its text alone, and a line that defines
// a link target, which goes whole. A link whose text is a number would
// otherwise read as a citation once its address is gone.
const LINK = /!?\[([^\]\n]{0,200})\]\s*\([^)\n]{0,2100}\)/g
const DEFINITION = /^\s{0,3}\[[^\]\n]{0,200}\]:.*$/

/**
 * Text a model wrote, made safe to draw as Markdown: its line breaks kept,
 * at most `maxLines` lines and `max` characters.
 *
 * Invisible characters go, as for any drawn text. A link is kept as its
 * text, every address goes, and `](` and `]:` are pulled apart, so the text
 * can hold no link at all: the
 * only links on screen are the ones this plugin draws itself. Curly braces
 * become parentheses, so the text can hold no record reference. The record
 * glyphs and the tick go, so it cannot imitate a row of sources.
 */
export function prose(value: string, max: number, maxLines: number): string {
  const kept = lines(value.normalize('NFKC'))
    .map(line =>
      line
        .replace(DEFINITION, '')
        .replace(LINK, '$1')
        .replace(ADDRESS, '(link removed)')
        .replace(/\]\s*\(/g, '] (')
        .replace(/\]\s*:/g, '] :')
        .replace(/\{/g, '(')
        .replace(/\}/g, ')')
        .replace(MARKS, '')
        .trimEnd(),
    )
    .filter((line, at, all) => line.trim() !== '' || (at > 0 && all[at - 1]?.trim() !== ''))
    .slice(0, maxLines)

  return cut(kept.join('\n').trim(), max)
}
