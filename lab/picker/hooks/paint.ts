import type { PromptDecoration } from 'claude-code'

import type { Box } from './host'
import { HEAD_LENGTH, tokensIn } from './token'

/**
 * The paint over a draft that holds Fylgja references: each one's label in
 * bold, its opening `{{fylgja:` and its `|<id>}}` tail dimmed, so a
 * reference reads as one thing. Paint only; the draft's text is not changed.
 *
 * A draft that holds no reference is found out by one plain search for the
 * opening, so a long draft costs next to nothing on every keystroke.
 */
export function decorationsOf(draft: string): PromptDecoration[] {
  if (!draft.includes('{{fylgja:')) {
    return []
  }

  return tokensIn(draft).flatMap(token => [
    { start: token.start, end: token.start + HEAD_LENGTH, dimColor: true },
    { start: token.start + HEAD_LENGTH, end: token.bar, bold: true },
    { start: token.bar, end: token.end, dimColor: true },
  ])
}

/**
 * `box` with the references in it painted, beside whatever paint it already
 * carries. A run another plugin already painted over the very same
 * characters is left to it, so two plugins that both know references do not
 * paint them twice.
 */
export function painted<B extends Box & { decorations?: PromptDecoration[] }>(box: B): B {
  const theirs = box.decorations ?? []
  const taken = new Set(theirs.map(run => `${run.start}:${run.end}`))
  const mine = decorationsOf(box.text).filter(run => !taken.has(`${run.start}:${run.end}`))

  return mine.length === 0 ? box : { ...box, decorations: [...theirs, ...mine] }
}
