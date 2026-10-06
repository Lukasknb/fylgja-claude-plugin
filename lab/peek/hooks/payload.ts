/**
 * Reading what a Fylgja tool answered. A tool answers with a JSON object or
 * with a record's text between two fence lines; either may arrive as the
 * structured result or as text blocks.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** What one call came to. */
export type Answer =
  | { is: 'json'; json: Record<string, unknown> }
  | { is: 'text'; text: string }
  /** The tool said no. `isNotFound` when it said the record is not there, or not the person's to read. */
  | { is: 'refused'; isNotFound: boolean }
  /** Anything else: nothing to read. */
  | { is: 'unreadable' }

/** The one sentence Fylgja answers with for every record a person cannot read. */
const NOT_FOUND = /\brecord not found\b/i

function textOf(blocks: readonly unknown[]): string {
  return blocks
    .map(block => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('')
}

function ofText(text: string): Answer {
  const trimmed = text.trim()

  if (trimmed === '') {
    return { is: 'unreadable' }
  }

  if (trimmed.startsWith('{')) {
    try {
      const value: unknown = JSON.parse(trimmed)

      if (isRecord(value)) {
        return { is: 'json', json: value }
      }
    } catch {
      // Not JSON after all: read as a record's text.
    }
  }

  return { is: 'text', text: trimmed }
}

/**
 * The answer inside a tool result.
 *
 * The structured result is preferred when present. A tool that returns text
 * may have it wrapped there as `{ result: "<text>" }`, which is unwrapped.
 * Otherwise the text blocks are joined and read as JSON when they are a JSON
 * object, as a record's text when not.
 */
export function answerOf(result: unknown): Answer {
  if (!isRecord(result)) {
    return { is: 'unreadable' }
  }

  const blocks = Array.isArray(result.content) ? result.content : []

  if (result.isError === true) {
    return { is: 'refused', isNotFound: NOT_FOUND.test(textOf(blocks).slice(0, 2000)) }
  }

  const structured = result.structuredContent

  if (isRecord(structured)) {
    const keys = Object.keys(structured)

    if (keys.length === 1 && keys[0] === 'result') {
      const inner = structured.result

      return typeof inner === 'string' ? ofText(inner) : isRecord(inner) ? { is: 'json', json: inner } : { is: 'unreadable' }
    }

    return { is: 'json', json: structured }
  }

  return ofText(textOf(blocks))
}

/** What a record's text said about itself on its fence, and the text between the fences. */
export type Fenced = {
  /** The body, without the fence lines and without the note that it was cut. */
  body: string
  /** Who may read the record, as the fence says it; undefined when it says nothing. */
  scope: string | undefined
  /** Whether the server cut the text short. */
  isCut: boolean
}

const OPENING = /^<<<fylgja-record\b([^\n]*)>>>[ \t]*\n?/
const CLOSING = /\n?<<<end fylgja-record>>>\s*$/
const CUT_NOTE = /\n?\[truncated: [^\]\n]{0,200}\]\s*$/

/**
 * A text answer taken out of its fence. Text that carries no fence is taken
 * whole: the fence is the server's label, not something this plugin needs.
 */
export function unfenced(text: string): Fenced {
  const opening = OPENING.exec(text)
  const scope = opening === null ? undefined : /\bscope="([^"\n]{0,80})"/.exec(opening[1] ?? '')?.[1]
  const inside = text.replace(OPENING, '').replace(CLOSING, '')
  const body = inside.replace(CUT_NOTE, '')

  return { body: body.trim(), scope, isCut: body.length !== inside.length }
}
