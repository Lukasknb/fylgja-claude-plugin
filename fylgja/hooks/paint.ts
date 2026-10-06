import type { PromptDecoration } from 'claude-code'

import { touches } from './known'
import type { Span } from './known'
import { HEAD_LENGTH, tokensIn } from './token'

/**
 * The paint over a draft.
 *
 * Each chip is one filled, bold run, its two marks included. The fill and
 * the text on it are theme colours made to be read together, so the chip is
 * legible on a dark and on a light theme.
 *
 * A stretch that is only shaped like a chip, such as a chip from an earlier
 * session, is dimmed and never filled: it is plain text, sent as typed, and
 * it must not look like a reference.
 *
 * A reference that stands in the draft as written is painted part by part
 * instead: its label in bold, its opening `{{fylgja:` and its `|<id>}}`
 * tail dimmed, so it still reads as one thing.
 *
 * Paint only; the draft's text is not changed here.
 */
export function decorationsOf(
  draft: string,
  chips: readonly Span[] = [],
  strangers: readonly Span[] = [],
): PromptDecoration[] {
  const written = tokensIn(draft)
    .filter(token => !touches(token, chips))
    .flatMap(token => [
      { start: token.start, end: token.start + HEAD_LENGTH, dimColor: true },
      { start: token.start + HEAD_LENGTH, end: token.bar, bold: true },
      { start: token.bar, end: token.end, dimColor: true },
    ])

  return [
    ...written,
    ...strangers.map(({ start, end }) => ({ start, end, dimColor: true })),
    ...chips.map(({ start, end }) => ({ start, end, backgroundColor: 'suggestion', color: 'inverseText', bold: true })),
  ]
}
