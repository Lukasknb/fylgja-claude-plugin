/**
 * Where the session is, as Fylgja names it: the repository as `owner/name`,
 * and a file as its path from the root of the working tree.
 */

import { isRepoPath, symbolOf, withoutLine } from './gate'
import type { Anchor } from './types'

function tail(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .at(-1) ?? ''
  )
}

const PART = /^[A-Za-z0-9][\w.-]*$/

const AZURE_SSH_HOSTS = new Set(['ssh.dev.azure.com', 'vs-ssh.visualstudio.com'])
const VISUALSTUDIO = '.visualstudio.com'

/** The host of a remote, lowercased, without login or port. */
function hostOf(remote: string): string {
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/([^/]*)\//i.exec(remote)
  const scp = /^([^/:@]+@[^:/]+):/.exec(remote)
  const host = scheme?.[1] ?? scp?.[1] ?? ''
  return (host.split('@').at(-1) ?? '').split(':')[0]?.toLowerCase() ?? ''
}

/**
 * The repository's name: its path read from the remote's address
 * (`owner/name`, `group/sub/name` for a nested group, `org/project/repo` for
 * Azure DevOps — the server normalises casing), or the folder's name when the
 * repository has no remote or its address does not give an owner and a name.
 * Undefined when neither gives a name a person would recognise.
 *
 * Both spellings of a remote are read (`git@host:owner/name.git`,
 * `https://host/owner/name`) and the whole path is kept, so `group/sub/repo`
 * stays one repository. Azure DevOps: the `_git` between project and
 * repository, and the `v3/` its ssh form starts with, are left out, and the
 * old `org.visualstudio.com` host gives the organization its path leaves out.
 * A relative remote (`../name`) names no owner, so the folder is used.
 */
export function repoNameOf(remote: string | null, root: string): string | undefined {
  if (remote !== null) {
    const trimmed = remote.trim()
    const host = hostOf(trimmed)
    const path = trimmed
      .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*\//i, '')
      .replace(/^[^/:@]+@[^:/]+:/, '')
      .replace(/\.git\/?$/i, '')
      .replace(/\/+$/, '')
    let parts = path.split('/').filter(part => part !== '' && part !== '_git')

    if (AZURE_SSH_HOSTS.has(host) && parts[0] === 'v3') {
      parts = parts.slice(1)
    } else if (host.endsWith(VISUALSTUDIO) && !AZURE_SSH_HOSTS.has(host)) {
      parts = [host.slice(0, -VISUALSTUDIO.length), ...parts]
    }

    if (parts.length >= 2 && parts.every(part => PART.test(part))) {
      return parts.join('/')
    }
  }

  const folder = tail(root)

  return PART.test(folder) ? folder : undefined
}

/**
 * Whether `path` may be a record's anchor: a path of the repository as
 * Fylgja's server takes one, never leading out of the tree it is relative to.
 */
export function isAnchorPath(path: string): boolean {
  return isRepoPath(path)
}

/**
 * `path` as it is written from `root`, or undefined when it lies outside
 * `root` or cannot be an anchor. A path that is not absolute is taken as
 * already written from the root.
 */
export function relativeTo(root: string, path: string): string | undefined {
  const base = root.replace(/\/+$/, '')
  let relative = path

  if (path.startsWith('/')) {
    if (base === '' || !path.startsWith(`${base}/`)) {
      return undefined
    }

    relative = path.slice(base.length + 1)
  }

  relative = relative.replace(/^(?:\.\/)+/, '')

  return isAnchorPath(relative) ? relative : undefined
}

/** How exactly an anchor says where: a symbol in a file before a file, a file deep in the tree before a folder near its top. */
function sharpness(anchor: Anchor): number {
  return (anchor.symbol === undefined ? 0 : 1000) + anchor.path.split('/').length
}

/**
 * The anchors of `value` that may be written: each a path inside the tree
 * as the server takes one (a line number at its end is taken off), each
 * once. Anything else in the list is left out, so one bad path never costs
 * a record. The server refuses a write with more than it allows rather than
 * cutting it, so with more than `max` the most exact ones are kept.
 *
 * @param known when given, only these paths are taken: the files the session
 *   itself touched, so a record never points at a file nobody opened
 */
export function anchorsOf(value: unknown, max: number, known?: ReadonlySet<string>): Anchor[] {
  const anchors: Anchor[] = []
  const seen = new Set<string>()

  for (const entry of Array.isArray(value) ? value : []) {
    const given: unknown = typeof entry === 'string' ? entry : (entry as { path?: unknown } | null)?.path
    const path = typeof given === 'string' ? withoutLine(given.trim()) : ''

    // With the session's files given, a path is taken as the session wrote
    // it, in full where the file lies outside the session's own tree; where
    // it lies is then looked up. Without them it must be a path of the tree.
    if (known === undefined ? !isAnchorPath(path) : !known.has(path)) {
      continue
    }

    const named = typeof entry === 'string' ? undefined : symbolOf((entry as { symbol?: unknown } | null)?.symbol)
    const key = `${path}\u0000${named ?? ''}`

    if (!seen.has(key)) {
      seen.add(key)
      anchors.push(named === undefined ? { path } : { path, symbol: named })
    }
  }

  if (anchors.length <= max) {
    return anchors
  }

  const kept = new Set([...anchors].sort((a, b) => sharpness(b) - sharpness(a)).slice(0, max))

  return anchors.filter(anchor => kept.has(anchor))
}
