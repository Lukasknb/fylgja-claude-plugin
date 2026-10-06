import type { PromptDecoration } from 'claude-code'

import { HEAD_LENGTH, tokensIn } from './token'

/**
 * The paint over a draft that holds Fylgja references: each one's label in
 * bold, its opening `{{fylgja:` and its `|<id>}}` tail dimmed, so a pasted
 * reference reads as one thing. Paint only; the draft's text is not changed.
 */
export function decorationsOf(draft: string): PromptDecoration[] {
  return tokensIn(draft).flatMap(token => [
    { start: token.start, end: token.start + HEAD_LENGTH, dimColor: true },
    { start: token.start + HEAD_LENGTH, end: token.bar, bold: true },
    { start: token.bar, end: token.end, dimColor: true },
  ])
}
