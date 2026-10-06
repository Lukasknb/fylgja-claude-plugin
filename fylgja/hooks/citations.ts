import { glyphOf } from './glyphs'

/**
 * The host Fylgja's records are opened on. It is the host of the server in
 * this plugin's `.mcp.json` and has to change with it: a link is marked as a
 * Fylgja record only when it goes exactly there.
 */
export const FYLGJA_HOST = 'fylgja.lknblab.dev'

/** A reply block longer than this is drawn as it is. */
const MAX_LENGTH = 100_000

// A markdown link straight to a record: `[label](https://<host>/open/<kind>/<uuid>)`.
// The host is followed at once by the path, so a user name, a port or a
// look-alike host before or after it does not match. An image is not a link.
// The label is bounded and holds no bracket, which keeps the search linear.
const PATTERN = new RegExp(
  '(?<!!)\\[([^\\[\\]\\n]{0,300})\\]\\((https://' +
    FYLGJA_HOST.replace(/\./g, '\\.') +
    '/open/(meeting|session|note|project|person)/' +
    '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\\)',
  'g',
)

/**
 * A reply's markdown with the record's glyph put before the label of every
 * link to a Fylgja record, or undefined when it holds no such link.
 *
 * The link stays an ordinary markdown link to the same address, so it opens
 * wherever links open. Nothing else in the reply is changed.
 */
export function withGlyphs(markdown: string): string | undefined {
  if (markdown.length > MAX_LENGTH || !markdown.includes(`](https://${FYLGJA_HOST}/open/`)) {
    return undefined
  }

  let isChanged = false
  const marked = markdown.replace(PATTERN, (whole: string, label: string, url: string, kind: string) => {
    const glyph = glyphOf(kind)

    if (label.startsWith(glyph)) {
      return whole
    }

    isChanged = true

    return `[${glyph} ${label}](${url})`
  })

  return isChanged ? marked : undefined
}
