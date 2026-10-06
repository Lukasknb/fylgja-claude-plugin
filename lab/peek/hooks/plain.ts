/**
 * The one place text from a Fylgja record is made safe to draw.
 */

import { GLYPHS } from './glyphs'

// Characters that draw as nothing and are simply taken out: soft hyphen,
// zero-width space, bidirectional controls, invisible operators, variation
// selectors, and the Unicode tag block, which can spell text no person sees.
const GONE = /[\u00ad\u034f\u061c\u180b-\u180f\u200b\u200e-\u200f\u202a-\u202e\u2060-\u206f\ufe00-\ufe0e\ufeff\ufff9-\ufffb\u{1bca0}-\u{1bca3}\u{1d173}-\u{1d17a}\u{e0000}-\u{e0fff}]/gu

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
const DOTS = /[\u00b7\u0387\u05c5\u16eb\u2022-\u2024\u2027\u2043\u204c-\u204d\u2219\u22c5\u2981\u25aa-\u25ab\u25cb\u25cf\u25d8-\u25d9\u25e6\u2b24\u2e30-\u2e31\u2e33\u30fb\ua78f\uff65\u{10101}]/gu

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
 * `value` with what no person sees taken out and its line breaks kept: for
 * text that is drawn over several lines. Control characters other than the
 * line feed and the tab read as a space.
 */
function legible(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.split('\t').map(seen).join('\t'))
    .join('\n')
}

/**
 * A record's prose for a plain `Text`: its paragraphs kept, runs of blank
 * lines folded to one, at most `max` characters. Nothing in it is read as
 * markup, so it can draw no link and no control.
 */
export function paragraphs(value: string, max: number): string {
  const text = legible(value)
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return cut(text, max)
}

// An inline link or image: `[label](target)`, an optional title after the
// target. Label and target are bounded and hold no bracket, which keeps the
// search linear on any input.
const INLINE_LINK = /(!?)\[([^\[\]\n]{0,300})\]\(\s*<?([^()<>\s]{1,2048})>?(?:\s+["'][^"'\n]{0,200}["'])?\s*\)/g

// A link definition (`[name]: target`), which lets `[label][name]` elsewhere
// in the text point anywhere without showing where.
// Stands between the label and the address of a link that is kept, while
// every other `](` is pulled apart. A control character: no cleaned text holds one.
const KEPT = '\u0000'

const LINK_DEFINITION = /^( {0,3})\[([^\]\n]{1,300})\]:/gm

/**
 * A record's markdown made safe to hand to the `Markdown` element: invisible
 * characters gone, at most `max` characters, and no link that hides where it
 * goes.
 *
 * `keep` is asked about every inline link's target. A target it answers for
 * stays a link, written with the address `keep` returned. Every other link
 * is drawn as its label followed by its address in the open, an image as its
 * label alone, and a link definition is defused, so a record cannot dress a
 * foreign address up as a button of this pane.
 */
export function markdownSafe(value: string, max: number, keep: (target: string) => string | undefined): string {
  const text = legible(value)
    .replace(LINK_DEFINITION, '$1\\[$2\\]:')
    .replace(INLINE_LINK, (_whole: string, bang: string, label: string, target: string) => {
      const shown = label.trim()

      if (bang === '!') {
        return shown === '' ? '(image)' : `${shown} (image)`
      }

      const kept = keep(target)

      if (kept !== undefined) {
        return `[${shown === '' ? 'record' : shown}]${KEPT}(${kept})`
      }

      return shown === '' || shown === target ? target : `${shown} (${target})`
    })
    // Whatever still reads as a link (a label with brackets of its own) is
    // pulled apart, so the only links left are the ones kept above.
    .replace(/\]\(/g, '] (')
    .replaceAll(`]${KEPT}(`, '](')

  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}\n\n_Cut here: the record is longer than this pane shows._`
}
