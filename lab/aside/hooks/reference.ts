/**
 * How a record is named in the prompt box: the reference the Fylgja app
 * itself copies, which Claude can open with Fylgja's tools if it chooses to.
 */

import { drawn } from './plain'
import type { Hit } from './retrieve'
import { tokensIn } from './token'

/** The kinds the reference grammar has. */
const KINDS = new Set(['meeting', 'session', 'note', 'project'])

const MAX_LABEL = 60

/**
 * The text that names `hit` in a prompt.
 *
 * For the kinds the grammar has, `{{fylgja:<kind> <title>|<id>}}`. The title
 * is only a label, cut short and cleaned so that it can neither end the
 * reference nor start a second one; if the result is not exactly one
 * reference to this record, the label is left out. For any other kind, the
 * record's address in the Fylgja app when the server gave one, else its kind
 * and id in plain words.
 */
export function referenceOf(hit: Hit): string {
  if (!KINDS.has(hit.kind)) {
    return hit.link ?? `Fylgja ${hit.kind} ${hit.id}`
  }

  const label = drawn(hit.title, MAX_LABEL).replace(/[{}|]/g, ' ').replace(/\s+/g, ' ').trim()
  const labelled = `{{fylgja:${hit.kind}${label === '' ? '' : ` ${label}`}|${hit.id}}}`
  const found = tokensIn(labelled)
  const isOne =
    found.length === 1 && found[0]?.text === labelled && found[0].id === hit.id && found[0].kind === hit.kind

  return isOne ? labelled : `{{fylgja:${hit.kind}|${hit.id}}}`
}

/**
 * The one line handed to the main conversation: the references of `hits`
 * and nothing of the answer, so that Claude reads the records itself.
 */
export function pointerOf(hits: readonly Hit[]): string {
  return `See these Fylgja records: ${hits.map(referenceOf).join(' ')} `
}
