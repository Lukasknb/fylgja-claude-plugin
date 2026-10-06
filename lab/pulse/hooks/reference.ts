/**
 * What "put in prompt" writes for an entry or a project.
 *
 * Meetings, sessions and projects are written as the reference the Fylgja
 * app copies for Claude, `{{fylgja:<kind> <title>|<uuid>}}`, which Fylgja's
 * tools take wherever they take an id. The title is a label for the person
 * reading the prompt; only the kind and the id name the record.
 *
 * The other kinds have no such reference, so they are written as a plain
 * word and the id, which `open` reads. No word of the record's own text is
 * in that form.
 */

import type { Entry } from './timeline'

const MAX_LABEL = 150

/** A reference to a record of one of the kinds the grammar has. */
export function referenceOf(kind: 'meeting' | 'session' | 'project', title: string, id: string): string {
  // The label may hold neither brace, nor the bar that ends it, nor a line break.
  const label = Array.from(title.replace(/[{}|\r\n]/g, ' ').replace(/\s+/g, ' ').trim())
    .slice(0, MAX_LABEL)
    .join('')

  return `{{fylgja:${kind}${label === '' ? '' : ` ${label}`}|${id}}}`
}

/** What the button under an entry says and what it puts at the prompt's cursor. */
export function insertOf(entry: Entry): { label: string; text: string } {
  if (entry.lane === 'meeting' || entry.lane === 'session') {
    return { label: 'Put reference in prompt', text: `${referenceOf(entry.lane, entry.title, entry.id)} ` }
  }

  return { label: 'Put id in prompt', text: `${entry.lane === 'decision' ? 'decision' : 'record'} ${entry.id} ` }
}
