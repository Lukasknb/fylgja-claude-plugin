/**
 * What the code a record is anchored to looks like, as one short hash: so
 * that Fylgja can tell, without git, that it changed since the record was
 * last known to hold. Only the hash is ever sent; the file's text never
 * leaves the machine.
 *
 * Two schemes, each named in the hash itself. `r1:` is the region of one
 * symbol: the line that defines it and its block. `f1:` is the whole file,
 * for a small one. Both are taken of the text with what does not change
 * what it says taken out first: line endings, whitespace at a line's end,
 * blank lines. A large file whose symbol is not named or not found has no
 * fingerprint.
 */

/** The two kinds of fingerprint: a symbol's region, or the whole file. */
export type Scheme = 'r1' | 'f1'

/** No more lines than this are a region, and no file longer than this has a fingerprint of the whole. */
export const MAX_PRINT_LINES = 400

/** No file larger than this is read for a fingerprint. */
export const MAX_PRINT_BYTES = 1024 * 1024

/** How many hex characters of the hash are kept. */
const HASH_CHARS = 32

/** The shape of a fingerprint, as Fylgja stores one. */
const PRINT = /^(r1|f1):[0-9a-f]{32}$/

/** Words that may stand before a definition's own word: `export async function`, `public static def`. */
const MODIFIERS = '(?:(?:export|default|async|public|private|protected|static|abstract|override|readonly|pub(?:\\([^)]*\\))?|unsafe|final)\\s+)*'

/** The words that define a name when they stand directly before it, in the languages a repository is written in. */
const DEFINES = '(?:def|class|function\\*?|const|let|var|type|interface|fn|func|struct|enum|impl|trait|module|object)'

/** A Go method: `func (s *Store) Name(`. */
const RECEIVER = 'func\\s*\\([^)]*\\)\\s*'

/**
 * Files that hold secrets by what they are called: `.env` and its kind,
 * keys and keystores, credentials, a tool's own tokens. Never read for a
 * fingerprint, wherever they lie and whatever git says of them: a hash of a
 * short secret is a hash a guess can be held against. The server keeps the
 * same list (`domain/services/code_anchor.py`).
 */
const SECRET_FILE =
  /^(?:\.env.*|.*\.(?:pem|key|p12|pfx|keystore|tfvars)|id_rsa.*|(?:credentials|secrets)(?:[._-][\w.-]*)?|\.npmrc|\.pypirc|\.netrc)$/i

/** What code is written in: `secrets.py` is the code that reads secrets, not where they are kept. */
const CODE = /\.(?:py|ts|tsx|js|jsx|mjs|cjs|go|rs|java|kt|rb|php|cs|swift|scala|c|cc|cpp|h|hpp|sh)$/i

/** Whether the file at `path` is one that holds secrets by its name. */
export function isSecretFile(path: string): boolean {
  const name = path.split('/').at(-1) ?? ''

  return SECRET_FILE.test(name) && !(/^(?:credentials|secrets)/i.test(name) && CODE.test(name))
}

/** Whether `value` has the shape of a fingerprint. */
export function isPrint(value: unknown): value is string {
  return typeof value === 'string' && PRINT.test(value)
}

/** The scheme a fingerprint was taken under. */
export function schemeOf(print: string): Scheme {
  return print.startsWith('r1:') ? 'r1' : 'f1'
}

/** `text` with its line endings made one, the whitespace at each line's end and every blank line taken out: its lines. */
function linesOf(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+$/, ''))
    .filter(line => line !== '')
}

function escaped(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function indentOf(line: string): number {
  return /^\s*/.exec(line)?.[0].length ?? 0
}

/** How far the round brackets and square brackets of `line` open, less how far they close. */
function openedIn(line: string): number {
  let depth = 0

  for (const mark of line) {
    depth += mark === '(' || mark === '[' ? 1 : mark === ')' || mark === ']' ? -1 : 0
  }

  return depth
}

/** Whether `header` holds a brace outside its round and square brackets: the one a block opens with. */
function bracedOutside(header: readonly string[]): boolean {
  let brackets = 0

  for (const mark of header.join('\n')) {
    brackets += mark === '(' || mark === '[' ? 1 : mark === ')' || mark === ']' ? -1 : 0

    if (mark === '{' && brackets <= 0) {
      return true
    }
  }

  return false
}

/**
 * The lines of the region `symbol` defines in `lines`: the first line where
 * it is defined (a word like `def`, `class`, `function` or `const`, after
 * any modifiers, standing directly before it, or a Go receiver), else the
 * first line that holds it at all; with the decorators right above it.
 * Its header runs to where its brackets close again, so a signature over
 * several lines is one header. Then its block: where the header holds a
 * brace, up to the brace that closes it; where it ends in `:`, or holds
 * neither, the lines after it that are indented deeper than its first.
 * No more than `MAX_PRINT_LINES`. Undefined when the symbol is nowhere.
 */
export function regionOf(lines: readonly string[], symbol: string): string[] | undefined {
  // A qualified name (`Store.save`, `Store::save`) is found by its last part.
  const name =
    symbol
      .trim()
      .split(/\.|::|#/)
      .filter(part => part !== '')
      .at(-1) ?? ''

  if (name === '') {
    return undefined
  }

  const word = new RegExp(`(?<![\\w$])${escaped(name)}(?![\\w$])`)
  const defined = new RegExp(`(?:^|[^\\w$.])(?:${MODIFIERS}${DEFINES}\\s+|${RECEIVER})${escaped(name)}(?![\\w$])`)
  const asDefined = lines.findIndex(line => defined.test(line))
  const found = asDefined !== -1 ? asDefined : lines.findIndex(line => word.test(line))

  if (found === -1) {
    return undefined
  }

  const indent = indentOf(lines[found] ?? '')
  let start = found

  // The decorators right above a definition are part of it.
  while (start > 0 && indentOf(lines[start - 1] ?? '') === indent && /^\s*@/.test(lines[start - 1] ?? '')) {
    start -= 1
  }

  const end = Math.min(lines.length, start + MAX_PRINT_LINES)
  let header = found
  let open = openedIn(lines[found] ?? '')

  while (open > 0 && header + 1 < end) {
    header += 1
    open += openedIn(lines[header] ?? '')
  }

  if (bracedOutside(lines.slice(found, header + 1))) {
    // Only a brace outside the brackets is the block's: `options: { ttl: number }` in a signature is a type.
    let depth = 0
    let brackets = 0
    let isOpened = false

    for (let at = found; at < end; at += 1) {
      for (const mark of lines[at] ?? '') {
        brackets += mark === '(' || mark === '[' ? 1 : mark === ')' || mark === ']' ? -1 : 0

        if (brackets <= 0 || isOpened) {
          depth += mark === '{' ? 1 : mark === '}' ? -1 : 0
          isOpened ||= mark === '{'
        }
      }

      if (isOpened && depth <= 0) {
        return lines.slice(start, at + 1)
      }
    }

    return lines.slice(start, end)
  }

  let last = header

  while (last + 1 < end && indentOf(lines[last + 1] ?? '') > indent) {
    last += 1
  }

  return lines.slice(start, last + 1)
}

async function hashed(scheme: Scheme, lines: readonly string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(lines.join('\n')))
  const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')

  return `${scheme}:${hex.slice(0, HASH_CHARS)}`
}

/**
 * The fingerprint of the code an anchor names in `text`: its symbol's
 * region when it has a symbol that is found, else the whole file when it is
 * no longer than `MAX_PRINT_LINES`; undefined otherwise.
 *
 * @param scheme the scheme to take it under, the one stored before: a region
 *   asked for whose symbol is gone is the empty region, so its going reads
 *   as the change it is; the whole file asked for is taken whole
 */
export async function fingerprintOf(text: string, symbol?: string, scheme?: Scheme): Promise<string | undefined> {
  const lines = linesOf(text)
  const region = symbol === undefined || scheme === 'f1' ? undefined : regionOf(lines, symbol)

  if (region !== undefined || (scheme === 'r1' && symbol !== undefined)) {
    return hashed('r1', region ?? [])
  }

  return lines.length <= MAX_PRINT_LINES ? hashed('f1', lines) : undefined
}
