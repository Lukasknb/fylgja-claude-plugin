/**
 * The plan documents a session works from: plan mode's own plan, and any
 * markdown file Claude wrote or read that calls itself a plan, a design, a
 * spec, an RFC, an ADR or a work package.
 *
 * They are the first place to look for why something was decided, so they
 * are the one kind of file whose text Scribe keeps: the newest version of at
 * most three, each cut to a fixed length, in the running plugin only.
 */

/** No more of one document is kept than this. */
export const MAX_PLAN_CHARS = 12_000

/** No more documents are kept than this; the one touched longest ago goes first. */
export const MAX_PLANS = 3

/** The name plan mode's own plan is kept under: it has no file the session can name. */
export const PLAN_MODE = 'plan mode'

export type PlanDoc = {
  /** The number the model cites it by; never reused in a session. */
  n: number
  /** What tells it apart: its absolute path, or `PLAN_MODE`. */
  key: string
  /** Its path from the root of the working tree; null when it lies outside the tree. */
  path: string | null
  /** Its first heading, or its file's name. */
  title: string
  /** Its text, cut to `MAX_PLAN_CHARS`. */
  text: string
  /** How many characters the cut left out; 0 when it is whole. */
  clipped: number
  /** Its headings, as written, for a record to name the section it follows. */
  headings: string[]
  /** The wake count of the session when it was last read or changed; unset where that is not kept. */
  touchedAt?: number
}

export type Plans = {
  docs: PlanDoc[]
  /** How many documents were ever numbered. */
  count: number
  /** Counts every change, so a reader can tell whether the documents moved. */
  version: number
}

export function create(): Plans {
  return { docs: [], count: 0, version: 0 }
}

const MARKDOWN = /\.(?:md|markdown|mdx)$/i

// A word that marks a plan document, standing as a word of its own in a
// file's or a folder's name: `plan-auth.md`, `docs/adr/0007-queues.md`,
// `WP-12.md`. `planning.md` and `display.md` are not marked.
const NAMED =
  /(?:^|[-_.\s/])(?:plans?|designs?|specs?|specification|rfcs?|adrs?|proposals?|wp|work[-_ ]?packages?)(?=$|[-_.\s\d/])/i

const HEADED = /\b(?:plan|design|spec|specification|rfc|adr|architecture decision|proposal|work package|wp)\b/i

function headingsOf(text: string): string[] {
  const headings: string[] = []

  for (const line of text.split('\n')) {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1]

    if (heading !== undefined && headings.length < 200) {
      headings.push(heading)
    }
  }

  return headings
}

/**
 * Whether a file is a plan document, by its name and its first heading
 * alone: a markdown file whose name, or whose folder's name, holds one of
 * the marking words, or whose first heading does.
 */
export function isPlanDocument(path: string, text: string): boolean {
  if (!MARKDOWN.test(path)) {
    return false
  }

  const named = path.replace(MARKDOWN, '').split('/').slice(-2).join('/')
  const first = headingsOf(text.slice(0, 4000))[0]

  return NAMED.test(named) || (first !== undefined && HEADED.test(first))
}

/**
 * Keeps `text` as the newest version of the document under `key`, in place
 * of whatever was kept for it.
 *
 * @param path the document's path from the tree's root, null outside the tree
 */
export function keep(plans: Plans, key: string, path: string | null, text: string): void {
  const held = plans.docs.find(doc => doc.key === key)
  const body = text.length > MAX_PLAN_CHARS ? text.slice(0, MAX_PLAN_CHARS) : text

  if (held !== undefined && held.text === body && held.clipped === text.length - body.length) {
    return
  }

  const doc: PlanDoc = {
    n: held?.n ?? plans.count + 1,
    key,
    path,
    title: headingsOf(body)[0] ?? (key === PLAN_MODE ? 'Plan' : (key.split('/').at(-1) ?? 'Plan')),
    text: body,
    clipped: text.length - body.length,
    headings: headingsOf(body),
  }

  plans.count = Math.max(plans.count, doc.n)
  plans.version += 1
  plans.docs = [...plans.docs.filter(other => other.key !== key), doc].slice(-MAX_PLANS)
}

/**
 * Applies an edit Claude made to a kept document: the first `before` becomes
 * `after`. A document that is not kept whole, or does not hold `before`, is
 * left as it is; the next read or write of it brings the new version.
 */
export function edit(plans: Plans, key: string, before: string, after: string): void {
  const held = plans.docs.find(doc => doc.key === key)

  if (held !== undefined && held.clipped === 0 && before !== '' && held.text.includes(before)) {
    keep(
      plans,
      key,
      held.path,
      held.text.replace(before, () => after),
    )
  }
}

/** The heading of `doc` that `section` names, as the document writes it; undefined when it has none such. */
export function headingOf(doc: PlanDoc, section: string): string | undefined {
  const wanted = section
    .replace(/^#+\s*/, '')
    .trim()
    .toLowerCase()

  return wanted === '' ? undefined : doc.headings.find(heading => heading.trim().toLowerCase() === wanted)
}
