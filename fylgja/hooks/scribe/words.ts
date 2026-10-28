/**
 * Comparing two texts by the words that carry their meaning, and the marks a
 * reason carries when it is not in the developer's own words.
 */

// Words that carry no meaning of their own, left out when two texts are compared.
const SMALL = new Set(
  'about after also been before being both does each every from have here into just more most must only other over same should some such than that their them then there these they this those through under very were what when where which while whose will with would your'.split(
    ' ',
  ),
)

/** The words of a text that carry meaning, for comparing two texts: lower case, four letters or more, without their endings. */
export function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
    .filter(word => !SMALL.has(word))
    .map(word => word.replace(/(?:ing|ed|es|s)$/, ''))
}

/** A word longer than this is no word of a sentence: an id, a hash, a key. */
const MAX_WORD = 30

/**
 * The words of a text that carry meaning, as they are written but in lower
 * case, each once and in their order, to look the text up by: no more of
 * them than fit in `max` characters. Empty for a text with none.
 */
export function queryOf(text: string, max: number): string {
  const kept: string[] = []

  for (const word of text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []) {
    if (SMALL.has(word) || word.length > MAX_WORD || /^\d+$/.test(word) || kept.includes(word)) {
      continue
    }

    if ([...kept, word].join(' ').length > max) {
      break
    }

    kept.push(word)
  }

  return kept.join(' ')
}

/** The share of the words of `text` that stand in `source` too; 0 for a text with none. */
export function shareIn(text: string, source: string): number {
  const words = wordsOf(text)
  const there = new Set(wordsOf(source))

  return words.length === 0 ? 0 : words.filter(word => there.has(word)).length / words.length
}

/** How a reason the assistant gave and the developer accepted is marked where it is written down. */
export const PROPOSED_MARK = ' (proposed by the assistant, accepted by the developer)'

/** How a reason is marked that stands in what the assistant said an option means, which the developer then picked. */
export const OFFERED_MARK = ' (offered by the assistant, chosen by the developer)'
