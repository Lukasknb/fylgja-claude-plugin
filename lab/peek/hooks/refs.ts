import { drawn } from './plain'
import { tokensIn } from './token'

/**
 * The host Fylgja's records are opened on. It is the host of the server in
 * this plugin's `.mcp.json` and has to change with it: a link is taken for a
 * Fylgja record only when it goes exactly there.
 */
export const FYLGJA_HOST = 'fylgja.lknblab.dev'

/** The kinds of record a link can name. */
export const LINK_KINDS = ['meeting', 'session', 'note', 'project', 'person'] as const

export type LinkKind = (typeof LINK_KINDS)[number]

/**
 * A record to peek at: its id, and its kind when the place it was named in
 * said one. A bare id says none; the record itself tells when it is read.
 */
export type Ref = { id: string; kind: string | undefined }

/** A link to a record as a reply wrote it. */
export type Citation = Ref & {
  kind: LinkKind
  /** The link's address exactly as written, which is what a press reports. */
  href: string
}

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const ADDRESS = `https://${FYLGJA_HOST.replace(/\./g, '\\.')}/open/(${LINK_KINDS.join('|')})/(${UUID})`

// A markdown link straight to a record. The host is followed at once by the
// path, so a user name, a port or a look-alike host does not match. An image
// is not a link. The label is bounded and holds no bracket, which keeps the
// search linear.
const CITATION = new RegExp(`(?<!!)\\[[^\\[\\]\\n]{0,300}\\]\\((${ADDRESS})\\)`, 'g')
const WHOLE_ADDRESS = new RegExp(`^${ADDRESS}$`)
const WHOLE_UUID = new RegExp(`^${UUID}$`)

/** A text longer than this is not searched for links. */
const MAX_SEARCHED = 100_000

function isLinkKind(kind: string): kind is LinkKind {
  return (LINK_KINDS as readonly string[]).includes(kind)
}

/** The address that opens a record in Fylgja, or undefined for a kind no link names. */
export function linkOf(kind: string, id: string): string | undefined {
  return isLinkKind(kind) && WHOLE_UUID.test(id) ? `https://${FYLGJA_HOST}/open/${kind}/${id.toLowerCase()}` : undefined
}

/** The record an address opens, when it is exactly a Fylgja record's address. */
export function refOfLink(href: string): Citation | undefined {
  const match = WHOLE_ADDRESS.exec(href)
  const kind = match?.[1]
  const id = match?.[2]

  return kind !== undefined && id !== undefined && isLinkKind(kind) ? { kind, id: id.toLowerCase(), href } : undefined
}

/**
 * The records a reply's markdown links to, each record once, in the order
 * written. A bare address, an image and a link that only looks like Fylgja's
 * are not citations.
 */
export function citationsIn(markdown: string): Citation[] {
  if (markdown.length > MAX_SEARCHED || !markdown.includes(`](https://${FYLGJA_HOST}/open/`)) {
    return []
  }

  const found = new Map<string, Citation>()

  for (const match of markdown.matchAll(CITATION)) {
    const citation = match[1] === undefined ? undefined : refOfLink(match[1])

    if (citation !== undefined && !found.has(citation.id)) {
      found.set(citation.id, citation)
    }
  }

  return [...found.values()]
}

/**
 * The record a person named after `/peek`: a pasted reference, a link to a
 * record (bare, in angle brackets or as a whole markdown link), or an id.
 * Anything else names none.
 */
export function refOfArgument(argument: string): Ref | undefined {
  const text = argument.trim()

  if (text.length > 1000) {
    return undefined
  }

  const [token] = tokensIn(text)

  if (token !== undefined && token.start === 0 && token.end === text.length) {
    return { id: token.id, kind: token.kind }
  }

  const [citation] = citationsIn(text)

  if (citation !== undefined && text.startsWith('[') && text.endsWith(')')) {
    return { id: citation.id, kind: citation.kind }
  }

  const bare = text.replace(/^<(.*)>$/, '$1')
  const linked = refOfLink(bare)

  if (linked !== undefined) {
    return { id: linked.id, kind: linked.kind }
  }

  return WHOLE_UUID.test(bare) ? { id: bare.toLowerCase(), kind: undefined } : undefined
}

/** The kinds a pasted reference can name. */
const TOKEN_KINDS: readonly string[] = ['meeting', 'session', 'note', 'project']

/**
 * What "Copy reference" puts in the prompt box for a record: the reference
 * the Fylgja app itself copies, `{{fylgja:<kind> <title>|<id>}}`, or the
 * record's link for a kind that reference cannot name. Undefined when
 * neither can be written.
 *
 * The title comes from the server. It is drawn-safe already, and here it
 * also loses every `|`, so no title can end the label early, smuggle in a
 * second id, or close the braces.
 */
export function referenceOf(kind: string, title: string, id: string): string | undefined {
  if (!WHOLE_UUID.test(id)) {
    return undefined
  }

  if (!TOKEN_KINDS.includes(kind)) {
    return linkOf(kind, id)
  }

  const label = drawn(title, 80).replace(/[|{}]/g, '/').trim()

  return `{{fylgja:${kind}${label === '' ? '' : ` ${label}`}|${id.toLowerCase()}}}`
}
