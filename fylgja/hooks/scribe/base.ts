/**
 * The commit a decision was written at: the commit its repository's working
 * tree is at, and whether any file the decision is anchored to had changes
 * not yet committed. A commit id and one flag are sent; nothing of the code.
 *
 * Read with git itself, once per decision, in the working tree the decision's
 * files lie in, and given up on quietly: anything that does not answer at
 * once, or answers anything but a whole sha, leaves both out.
 */

import { gitIn } from './git'
import type { Ran, Run } from './git'
import type { After } from './time'
import type { Anchor, Place } from './types'

/** What `remember` is told: the commit, and whether an anchored file was changed. */
export type Base = { base_sha: string; base_dirty?: boolean }

// A whole sha as git prints it for a repository of sha-1 commits. A sha-256
// repository's are longer, and the server does not take them: none is sent.
const WHOLE_SHA = /^[0-9a-f]{40}$/

/**
 * Where the working tree the anchors lie in begins: read off the files of
 * the session that were placed, each kept under its full path beside the
 * repository and the path in it it lies at. An anchor to a folder is never
 * a placed file and says nothing here. With none placed, the session's own
 * tree when the record is about the session's own repository. Undefined
 * when that gives no tree, or more than one: two checkouts of the same
 * repository, say, and which of them the record means is not known.
 */
export function rootOf(
  places: ReadonlyMap<string, Place>,
  repo: string,
  anchors: readonly Anchor[],
  own: { repo: string | null; root: string },
): string | undefined {
  const roots = new Set<string>()

  for (const [file, place] of places) {
    const isAnchored = anchors.some(anchor => anchor.path === place.path)

    if (isAnchored && file.startsWith('/') && place.repo === repo && file.endsWith(`/${place.path}`)) {
      roots.add(file.slice(0, file.length - place.path.length - 1))
    }
  }

  if (roots.size === 0 && own.repo === repo) {
    roots.add(own.root)
  }

  return roots.size === 1 ? [...roots][0] : undefined
}

/**
 * The commit the working tree at `root` is at and whether any of `paths` is
 * changed there, or undefined when the commit cannot be read. Whether the
 * files are changed is left out when only that cannot be read. git is run
 * as `git.ts` runs it, the two commands side by side.
 */
export async function baseOf(run: Run, after: After, root: string, paths: readonly string[]): Promise<Base | undefined> {
  const asked = (args: readonly string[]): Promise<Ran | undefined> => gitIn(run, after, root, args)
  const [head, status] = await Promise.all([
    asked(['rev-parse', '--verify', '--quiet', 'HEAD']),
    paths.length === 0 ? Promise.resolve(undefined) : asked(['status', '--porcelain', '--untracked-files=all', '--', ...paths]),
  ])
  const sha = head?.exitCode === 0 ? head.stdout.trim() : ''

  if (!WHOLE_SHA.test(sha)) {
    return undefined
  }

  return status?.exitCode === 0 ? { base_sha: sha, base_dirty: status.stdout.trim() !== '' } : { base_sha: sha }
}

const OLD_WORDS = /\bbase_(?:sha|dirty)\b[\s\S]{0,200}?unexpected[ _]keyword[ _]argument|unexpected[ _]keyword[ _]argument[\s\S]{0,200}?\bbase_(?:sha|dirty)\b/i

/**
 * Whether Fylgja turned a write down for the commit fields: a server from
 * before it took them. Such an answer from today's servers names no
 * argument the tool does not take, only the ones it does, and `base_sha`
 * is not among them; older servers name the argument.
 */
export function isUnknownBase(refusal: string): boolean {
  const isUntaken = /invalid arguments[\s\S]{0,40}an argument this tool does not take/i.test(refusal) && !/\bbase_sha\b/.test(refusal)

  return isUntaken || OLD_WORDS.test(refusal)
}
