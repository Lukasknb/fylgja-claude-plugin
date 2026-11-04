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
  /**
   * The work package Fylgja filed it as, by id. Unset while it was never
   * sent; null once it was sent and Fylgja filed it as none (the repository
   * is no project of the team's): it is sent once, never again.
   */
  workPackage?: string | null
  /**
   * Whether it is a plan of this session's: the developer approved it, or
   * Claude wrote or edited it here. Only such a plan is filed as a work
   * package, and only decisions under it are planned; a document the session
   * only read (an old ADR, a spec) may describe what is built already.
   */
  isAuthored?: boolean
}

export type Plans = {
  docs: PlanDoc[]
  /** How many documents were ever numbered. */
  count: number
  /** Counts every change, so a reader can tell whether the documents moved. */
  version: number
  /** The keys of the documents approved, written or edited in this session, kept or not. */
  authored: Set<string>
  /**
   * What each plan sent to Fylgja was filed as, by its repository and title
   * (`filedKey`): kept past a document let go and past plan mode's plan being
   * called otherwise, so no plan is sent twice in a session.
   */
  filed: Map<string, string | null>
}

export function create(): Plans {
  return { docs: [], count: 0, version: 0, authored: new Set(), filed: new Map() }
}

/** What a plan sent to Fylgja is known by: its repository and its title. */
export function filedKey(repo: string, title: string): string {
  return `${repo}\u0000${title}`
}

/** The document under `key` was approved, written or edited in this session: it is a plan of the session's own from here. */
export function author(plans: Plans, key: string): void {
  plans.authored.add(key)
  plans.docs = plans.docs.map(doc => (doc.key === key && doc.isAuthored !== true ? { ...doc, isAuthored: true } : doc))
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

  const title = headingsOf(body)[0] ?? (key === PLAN_MODE ? 'Plan' : (key.split('/').at(-1) ?? 'Plan'))
  // A file is the same plan whatever it says now; plan mode's plan is another
  // one once it is called otherwise, and is filed as a work package of its own.
  const filed = held?.workPackage !== undefined && (key !== PLAN_MODE || held.title === title) ? { workPackage: held.workPackage } : {}
  const doc: PlanDoc = {
    n: held?.n ?? plans.count + 1,
    key,
    path,
    title,
    text: body,
    clipped: text.length - body.length,
    headings: headingsOf(body),
    ...filed,
    ...(plans.authored.has(key) ? { isAuthored: true } : {}),
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

/** No longer a title than this is sent as a work package's. */
export const MAX_TITLE = 120

/**
 * What a plan is called as Fylgja files it: its top heading; for plan mode's
 * plan without one, its first line; else what the session calls it. Cut to
 * `MAX_TITLE` characters.
 */
export function titleOf(doc: PlanDoc): string {
  const lines = doc.text.split('\n')
  const top = lines.map(line => /^#\s+(.+?)\s*#*\s*$/.exec(line)?.[1]).find(heading => heading !== undefined)
  const first = doc.key === PLAN_MODE ? lines.map(line => line.replace(/^#+\s*/, '').trim()).find(line => line !== '') : undefined
  const title = (top ?? first ?? doc.title).replace(/\s+/g, ' ').trim()

  return title.length <= MAX_TITLE ? title : `${title.slice(0, MAX_TITLE - 1).trimEnd()}…`
}

/** The heading of `doc` that `section` names, as the document writes it; undefined when it has none such. */
export function headingOf(doc: PlanDoc, section: string): string | undefined {
  const wanted = section
    .replace(/^#+\s*/, '')
    .trim()
    .toLowerCase()

  return wanted === '' ? undefined : doc.headings.find(heading => heading.trim().toLowerCase() === wanted)
}
