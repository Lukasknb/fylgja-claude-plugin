/**
 * The reference the Fylgja app copies for Claude:
 * `{{fylgja:<kind>[ <title>]|<uuid>}}`. One parser for every place that
 * reads it: the prompt as submitted, the row it is drawn in, and the paint
 * over the prompt box.
 *
 * The title is a label the person pasted. Nothing here treats it as a fact
 * about the record; only the kind and the id are used to look the record up.
 */

export type TokenKind = 'meeting' | 'session' | 'note' | 'project'

export type Token = {
  /** Where the token begins in the text it was found in. */
  start: number
  /** The offset past its closing braces. */
  end: number
  /** The token exactly as written. */
  text: string
  kind: TokenKind
  /** The record's id, lower-cased. */
  id: string
  /** Where the `|` before the id sits: the label ends here, the id tail begins. */
  bar: number
}

/** The length of `{{fylgja:`, the part before the label. */
export const HEAD_LENGTH = 9

const PATTERN =
  /\{\{fylgja:(meeting|session|note|project)(?: [^{}|\n]{0,200})?\|([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\}\}/g

/**
 * Every well-formed token in `text`, in the order written. A token-shaped
 * string with an unknown kind, a malformed id or no `|` is not one.
 */
export function tokensIn(text: string): Token[] {
  const found: Token[] = []

  for (const match of text.matchAll(PATTERN)) {
    const [whole, kind, id] = match

    if (kind === undefined || id === undefined) {
      continue
    }

    const end = match.index + whole.length

    found.push({
      start: match.index,
      end,
      text: whole,
      kind: kind as TokenKind,
      id: id.toLowerCase(),
      // The tail is `|`, the 36 characters of the id, and `}}`.
      bar: end - 39,
    })
  }

  return found
}

/**
 * The first token of each record, in the order written: a record pasted
 * twice is looked up once.
 */
export function distinctById(tokens: readonly Token[]): Token[] {
  const seen = new Set<string>()

  return tokens.filter(token => {
    if (seen.has(token.id)) {
      return false
    }

    seen.add(token.id)

    return true
  })
}

/**
 * The title written inside a token, or '' when it has none. Whatever the
 * person pasted: nothing checks it against the record.
 */
export function titleOf(token: Token): string {
  return token.text.slice(HEAD_LENGTH + token.kind.length, token.bar - token.start).trim()
}
