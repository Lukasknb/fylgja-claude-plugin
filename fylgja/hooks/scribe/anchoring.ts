/**
 * Which files a record may point at. An anchor is where a later reader of
 * the code finds the decision, so it has to be a file that will still be
 * there: the code that carries the decision out, or a document the
 * repository keeps (an ADR, a committed spec, a README).
 *
 * A plan, notes or a scratch file is how the session got to the decision,
 * and is thrown away once the work is done. Git tells them apart: a
 * document it keeps is an anchor whatever it is called, one it was never
 * given is none, and nothing it ignores is. Only where git cannot be asked
 * does the name decide (`isWorkingFile`). A decision or gotcha left
 * pointing at no code is waiting for its code: when the session later writes
 * the file that carries it out, or commits it, the wake pairs the two in its
 * usual call (`anchor` in the verdict) and the file is added (`anchorMore` in
 * `scribe.ts`).
 *
 * Across sessions (plan today, code tomorrow) nothing is linked yet. What it
 * would take: a lookup on the server for the author's own records of a
 * repository that point at no code; at session start Scribe would list those
 * as waiting beside its own, and may add places to them, so the same pairing
 * at an edit or a commit applies. Or, server side, the commit a record was
 * written at and a reviewer that pairs it with the code of later commits.
 */

import type { Anchor } from './types'

/** What git says of one file of a working tree. */
export type GitState = 'tracked' | 'untracked' | 'ignored'

/** No more files of the session are asked of git in one look than this; the rest are asked at the next. */
export const MAX_GIT_PATHS = 64

/** No more files are added to one record by one look than this. */
export const MAX_LATE_FILES = 3

const DOC = /\.(?:md|markdown|mdx|txt|rst|adoc|org)$/i

/** Text files that are a build's or a package manager's input, not prose: code for an anchor. */
const MANIFEST = /(?:^|\/)(?:requirements[\w.-]*|constraints[\w.-]*|CMakeLists)\.txt$/i

/** Folders whose files of any kind are working files: what Claude Code and a scratchpad keep. */
const SCRATCH_DIR = /(?:^|\/)(?:\.claude|\.scratch|scratch|scratchpad)\//i

/** A document named by one of these words alone is working notes: `NOTES.md`, `TODO.md`, `plan.md`. */
const NOTES_WORDS: ReadonlySet<string> = new Set([
  'plan',
  'plans',
  'planning',
  'notes',
  'todo',
  'todos',
  'draft',
  'drafts',
  'wip',
  'scratch',
])

/** A document whose name begins with one of these words is too: `plan-l5-l6.md`, `wip_auth.md`. */
const NOTES_FIRST: ReadonlySet<string> = new Set(['plan', 'wip', 'todo', 'scratch'])

/** A path as git writes it, whatever the machine wrote: forward slashes only. */
export function normalised(path: string): string {
  return path.replace(/\\/g, '/')
}

/** Whether a file is prose: a document, not code. */
export function isDoc(path: string): boolean {
  const at = normalised(path)

  return DOC.test(at) && !MANIFEST.test(at)
}

/** Whether a file is code (or the configuration, schema and manifests that sit beside it): anything that is not prose. */
export function isCode(path: string): boolean {
  return !isDoc(path)
}

/**
 * Whether a file is a working file by its path alone: any file of a folder
 * kept for scratch work, or a document whose name says it is a plan, notes
 * or a to-do list (`plan-l5-l6.md`, `auth-plan.md`, `NOTES.md`), word by
 * whole word: `billing-plans.md`, `RELEASE_NOTES.md`, `notes-api.md` and
 * `packages/notes/README.md` are not.
 */
function isWorkingFile(path: string): boolean {
  const at = normalised(path)

  if (SCRATCH_DIR.test(at)) {
    return true
  }

  if (!isDoc(at)) {
    return false
  }

  const words = (at.split('/').at(-1) ?? '')
    .replace(DOC, '')
    .toLowerCase()
    .split(/[-_.\s]+/)
  const first = words[0] ?? ''

  return (words.length === 1 && NOTES_WORDS.has(first)) || NOTES_FIRST.has(first) || words.at(-1) === 'plan'
}

/**
 * Whether a file of a repository may be a record's anchor. What git says
 * comes first: a file it keeps is one, whatever it is called; one it
 * ignores is none; one it was never given is one only when it is code (new
 * code is where its decision lives before it is committed), never a
 * document, and never a working file.
 *
 * @param state what git says of it; undefined when git could not be asked,
 *   and then its path alone decides
 */
export function isAnchorable(path: string, state: GitState | undefined): boolean {
  return whyNotAnchor(path, state) === undefined
}

/** Why a file may not be an anchor, by the rules of `isAnchorable`; undefined for one that may. */
export function whyNotAnchor(path: string, state: GitState | undefined): 'working_file' | 'ignored' | 'untracked_doc' | undefined {
  switch (state) {
    case 'tracked':
      return undefined
    case 'ignored':
      return 'ignored'
    case 'untracked':
      return isDoc(path) ? 'untracked_doc' : isWorkingFile(path) ? 'working_file' : undefined
    default:
      return isWorkingFile(path) ? 'working_file' : undefined
  }
}

/**
 * What git says of each of `paths` from `git status --porcelain=v1 -z
 * --untracked-files=all --ignored -- <paths>`: a path it lists as `??` is
 * untracked, as `!!` ignored (a folder it lists so holds the path), and one
 * it does not list, or lists as changed, is tracked.
 */
export function statesOf(porcelain: string, paths: readonly string[]): Map<string, GitState> {
  const marked = new Map<string, GitState>()
  const entries = porcelain.split('\0')

  for (let at = 0; at < entries.length; at += 1) {
    const entry = entries[at] ?? ''

    if (entry.length < 4) {
      continue
    }

    const code = entry.slice(0, 2)

    if (code === '??' || code === '!!') {
      marked.set(entry.slice(3), code === '??' ? 'untracked' : 'ignored')
    } else if (code[0] === 'R' || code[0] === 'C') {
      // A rename or a copy is followed by the path it came from.
      at += 1
    }
  }

  const states = new Map<string, GitState>()

  for (const path of paths) {
    let state: GitState = marked.get(path) ?? 'tracked'

    for (const [listed, one] of marked) {
      if (listed.endsWith('/') && path.startsWith(listed)) {
        state = one
      }
    }

    states.set(path, state)
  }

  return states
}

/** The anchors of a record that point at code. */
export function codeAnchors(anchors: readonly Anchor[] | undefined): Anchor[] {
  return (anchors ?? []).filter(anchor => isCode(anchor.path))
}

/** The kinds of record that are about code, and so wait for it: a correction is about how Claude works, and waits for nothing. */
const ABOUT_CODE: ReadonlySet<string> = new Set(['decision', 'gotcha'])

/** Whether a record is waiting for its code: a decision or a gotcha that points at no code yet. */
export function isWaiting(record: { kind: string; anchors?: readonly Anchor[]; outcome?: string }): boolean {
  return ABOUT_CODE.has(record.kind) && record.outcome !== 'withdrawn' && codeAnchors(record.anchors).length === 0
}
