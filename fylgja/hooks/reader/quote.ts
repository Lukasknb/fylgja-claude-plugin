/**
 * The words in an image stay on the machine (L16): what leaves is the
 * reader's own description. A description that copied a run of the image's
 * words would carry them out, so it is held against the quote the reader
 * gave, word by word, before anything of it is kept.
 */

/** A run of this many words of the quote, in order, is the quote's, whatever is around it. */
export const QUOTED_WORDS = 6

/** The words of a text, compatibility-folded (NFKC: fullwidth letters are letters) and in lower case, as letters and digits of any script. */
function wordsOf(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word !== '')
}

/** Whether `text` holds a run of `QUOTED_WORDS` words of `quote` in order, or the whole of a shorter quote. */
export function echoesQuote(text: string, quote: string | undefined): boolean {
  const said = wordsOf(quote ?? '')

  if (said.length === 0) {
    return false
  }

  const run = Math.min(QUOTED_WORDS, said.length)
  // A quote of one or two words may be any word: it is a run of the quote's only once it is three words long.
  if (run < 3) {
    return false
  }

  const words = ` ${wordsOf(text).join(' ')} `

  for (let at = 0; at + run <= said.length; at += 1) {
    if (words.includes(` ${said.slice(at, at + run).join(' ')} `)) {
      return true
    }
  }

  return false
}
