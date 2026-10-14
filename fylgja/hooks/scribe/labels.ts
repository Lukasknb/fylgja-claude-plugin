/**
 * Labels a session gave the things it weighed, read in a record's words
 * before they are sent, without a model. The model is told to name things
 * by what they are; this holds it to that where it does not.
 *
 * What makes a label one only the session knew is that the session itself
 * set up a series of them: it listed "L1 —", "L2 —", "L3 —", or "**Option
 * A**:", "**Option B**:", or headed "### WP-A" and "### WP-B", as the names
 * of the things it was weighing. One name in a list is no such series: a
 * list of real things reads the same ("- EC2: … - Fargate: …", "1. S3: …
 * 2. GCS: …", "| Option B | default |"). So:
 *
 * - sure: a token of the record whose series the session's own lines set up
 *   as labels, two of it or more ("L1" and "L2" make "L4" one). A record
 *   that still holds one after it was put right is not kept.
 * - likely: a shape labels take but real names take too ("Phase 2", "the
 *   second approach", "as discussed", "the stack's L4" in a session that
 *   never set it up). The record is put right once, where the model keeps a
 *   real name as it is, and is kept whatever comes of that.
 *
 * Only prose is read in the record. A code span or a quotation is a name or
 * a citation, and stays as it is: "`L4`", "`line_status`", "\"option B\"".
 */

import type { Draft } from './types'

const CITED = /`[^`]*`|"[^"\n]*"|“[^”\n]*”|„[^“\n]*“/g

/** `text` with its code spans and quotations blanked out. */
export function proseOf(text: string): string {
  return text.replace(CITED, ' ')
}

/** The words a series of labels is named by, beside a letter or a number. */
const KINDS = 'Option|Track|Phase|Variant|Variante|Approach|Item|Step|Layer|Wave|Proposal'

/** A letter or a number of a series: a small one, as labels are numbered. */
const SMALL_ID = '(?:[A-H]|[1-9]|1\\d|20)'

/**
 * Tokens of a record that may be a label: one or two capital letters and a
 * small number ("L4", "WP3", "P2"), the same with a hyphen and a letter or
 * number ("WP-A", "WP-1"), a kind and its letter or number ("Option B",
 * "Track B", "Layer 4", "Item 3", "Option 2b"), or a number after a hash
 * ("#3"). A longer name ("GPT-4", "EC2" beside a product's list) is a
 * product's. Each is held against the session before it counts.
 */
const TOKEN = new RegExp(
  `(?<![\\w-])(?:(?<short>[A-Z]{1,2})(?:-?(?<number>\\d{1,2})[a-z]?|-(?<letter>[A-Z]))|(?<kind>${KINDS})\\s+(?<id>[A-Z]|\\d{1,2})[a-z]?|#(?<hash>\\d{1,2}))(?![\\w-])`,
  'g',
)

/** A token of a record, and the shape its series takes: the same name or kind with another small letter or number. */
type Token = { label: string; series: string }

function tokensOf(prose: string): Token[] {
  const tokens: Token[] = []

  for (const match of prose.matchAll(TOKEN)) {
    const label = match[0]
    const { short, number, letter, kind, id, hash } = match.groups ?? {}

    if (short !== undefined && (number !== undefined || letter !== undefined)) {
      const rest = number === undefined ? '-[A-H]' : `${label.includes('-') ? '-?' : ''}${SMALL_ID}[a-z]?`

      tokens.push({ label, series: `${short}${rest}` })
    } else if (kind !== undefined && id !== undefined) {
      tokens.push({ label, series: `${kind}\\s+${SMALL_ID}[a-z]?` })
    } else if (hash !== undefined) {
      tokens.push({ label, series: `#${SMALL_ID}` })
    }
  }

  return tokens
}

/**
 * Where the session sets a name up as a label. Its lines reach Scribe with
 * a message's line breaks flattened into spaces, so a numbered mark is read
 * only where it opens a line, follows a speaker's tag or a colon ("Options:
 * 1. Option A: …"); in running text "it costs 2. Step 2: retry" is a
 * sentence, not a list. A bullet is read anywhere after a space. After the
 * mark comes the name, in bold or not, and a colon, a dash or a bar. A name
 * in bold followed by one of those, after a heading's hashes, or alone in a
 * table's cell is set up too.
 */
function labelling(name: string): RegExp {
  const bold = '(?:\\*\\*|__)?'
  const ends = '\\s*(?::|—|–|-\\s|\\|)'
  const opens = '(?:^|\\]\\s+|:\\s+)(?:(?:[-*+•>]|\\d{1,2}[.)])\\s+)?'
  const bullet = '\\s[-*+•]\\s+'

  return new RegExp(
    [
      `(?:${opens}|${bullet})${bold}(${name})${bold}${ends}`,
      `(?:\\*\\*|__)(${name})(?:\\*\\*|__)${ends}`,
      `(?:^|\\s)#{1,6}\\s+${bold}(${name})(?![\\w-])`,
      `\\|\\s*${bold}(${name})${bold}\\s*\\|`,
    ].join('|'),
    'gm',
  )
}

/**
 * Whether the session's own lines set up the series `token` belongs to as
 * labels: two of its names or more. One name alone is never enough.
 */
function isSetUp(token: Token, lines: readonly string[]): boolean {
  const shape = labelling(token.series)
  const seen = new Set<string>()

  for (const line of lines) {
    for (const found of line.matchAll(shape)) {
      const name = found
        .slice(1)
        .find(group => group !== undefined)
        ?.replace(/\s+/g, ' ')

      if (name !== undefined) {
        seen.add(name)
      }
    }
  }

  return seen.size >= 2
}

/** Shapes labels take, and real names too: a record is put right once for one, and kept whatever comes of it. */
const LIKELY: readonly RegExp[] = [
  /\b[Tt]he\s+(?:PR\s+|pull[- ]request\s+)?stack's\s+(?:[A-Z]\d{1,2}|(?:PR|layer|slot)\s+#?\d{1,2})(?![-\w])/,
  /\b(?:[A-Z]\d{1,2}|(?:PR|[Ll]ayer|[Ss]lot)\s+#?\d{1,2})\s+(?:of|in|on)\s+the\s+(?:[\w-]+\s+)?stack(?![-\w])/,
  /\b[Tt]he\s+(?:first|second|third|fourth|fifth|last|top|bottom)\s+(?:PR|pull request)(?![-\w])/,
  /\b(?:its|the)\s+(?:first|second|third|fourth|last|top|bottom)\s+layer\b/i,
  /\b[Tt]he\s+plan's\s+[A-Z]\d{1,2}\b/,
  /\b(?:the|this|that)\s+[A-Za-z]+\d+[- ]?(?:feature[- ])?(?:flag|ruling)(?![-\w])/i,
  /\b(?:[Oo]ption|[Vv]ariant|[Aa]pproach|[Aa]lternative|[Pp]hase|[Ss]tep|[Ww]ave|[Tt]rack|[Pp]roposal|[Ll]ayer)\s+(?:[A-H]|[1-9][a-z]?)(?![\w%/*+#-]|\.\d)/,
  /\bthe\s+(?:first|second|third|fourth|fifth|former|latter|previous|other)\s+(?:approach|option|variant|alternative|proposal|idea|fix|attempt)\b/i,
  // Pointing back into the conversation, where the words do not go on to say where it was said.
  /\b(?:as discussed|as agreed|(?:like|as) we said|per the (?:earlier|previous|above) discussion|see above|as (?:mentioned|noted|said) (?:above|earlier|before))(?![-\w])(?!(?:\s+(?:earlier|before|above))?\s+(?:in|with|at|by|on|during|under|for)\b)/i,
  /\bthe above(?=\s+[^\W\d])/i,
  /\bfrom (?:before|earlier)(?=\s*(?:$|[.,;:!?)]))/i,
]

/** A label found in a record: its words, and whether the session set it up as one. */
export type Leaning = { label: string; isSure: boolean }

/**
 * The first label only the session knew in what `draft` says, in its
 * sentence, its reason or a rejected alternative, a sure one before a
 * likely one; undefined when it names everything by what it is.
 *
 * @param lines the session as Scribe holds it: what it read of this turn
 *   and what it keeps from before; without them nothing is sure
 */
export function leaningOf(draft: Pick<Draft, 'content' | 'detail' | 'alternatives'>, lines: readonly string[] = []): Leaning | undefined {
  const prose = [draft.content, draft.detail, ...draft.alternatives].map(proseOf).join('\n')

  if (lines.length > 0) {
    for (const token of tokensOf(prose)) {
      if (isSetUp(token, lines)) {
        return { label: token.label, isSure: true }
      }
    }
  }

  for (const shape of LIKELY) {
    const found = shape.exec(prose)?.[0]

    if (found !== undefined) {
      return { label: found.replace(/\s+/g, ' '), isSure: false }
    }
  }

  return undefined
}

/** The code the server refuses such a label by, and the plugin too. */
export const LEANING = 'leans_on_conversation'

/**
 * The words a refusal for such a label is written in, the same as the
 * server's own: what is matched, in quotes, right behind the code. A record
 * the plugin catches is so put right the way one the server refused is.
 */
export function leaningRefusal(label: string): string {
  return `refused:${LEANING} — "${label}" only means something inside the conversation it came from. Rule: a record is read by someone who never saw this conversation. Name the thing by what it is, in content, detail and every alternative; if this is its real name, put it in backticks. If you cannot say what the label stands for, do not store the record`
}
