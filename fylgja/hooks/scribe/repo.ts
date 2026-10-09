/**
 * Where the session is, as Fylgja names it: the repository as `owner/name`,
 * and a file as its path from the root of the working tree.
 */

import type { Anchor } from './types'

/** No path longer than this is an anchor. */
const MAX_PATH = 400

/** No symbol longer than this is kept. */
const MAX_SYMBOL = 200

function tail(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .at(-1) ?? ''
  )
}

/**
 * The repository's name: `owner/name` read from the remote's address, or the
 * folder's name when the repository has no remote. Undefined when neither
 * gives a name a person would recognise.
 *
 * Both spellings of a remote are read (`git@host:owner/name.git`,
 * `https://host/owner/name`); a longer path keeps its last two parts.
 */
export function repoNameOf(remote: string | null, root: string): string | undefined {
  if (remote !== null) {
    const path = remote
      .trim()
      .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*\//i, '')
      .replace(/^[^/:@]+@[^:/]+:/, '')
      .replace(/\.git\/?$/i, '')
      .replace(/\/+$/, '')
    const parts = path.split('/').filter(part => part !== '')
    const name = parts.slice(-2).join('/')

    if (parts.length >= 2 && /^[\w.-]+\/[\w.-]+$/.test(name)) {
      return name
    }
  }

  const folder = tail(root)

  return /^[\w.-]+$/.test(folder) ? folder : undefined
}

/**
 * Whether `path` may be a record's anchor: relative, written with forward
 * slashes, and never leading out of the tree it is relative to.
 */
export function isAnchorPath(path: string): boolean {
  return (
    path !== '' &&
    path.length <= MAX_PATH &&
    !path.startsWith('/') &&
    !path.endsWith('/') &&
    !path.includes('\\') &&
    !/^[a-zA-Z]:/.test(path) &&
    !/[\u0000-\u001f]/.test(path) &&
    path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
  )
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

/**
 * The anchors of `value` that may be written: each a path inside the tree,
 * each once, at most `max`. Anything else in the list is left out, so one
 * bad path never costs a record.
 */
export function anchorsOf(value: unknown, max: number): Anchor[] {
  const anchors: Anchor[] = []
  const seen = new Set<string>()

  for (const entry of Array.isArray(value) ? value : []) {
    const path: unknown = typeof entry === 'string' ? entry : (entry as { path?: unknown } | null)?.path
    const symbol: unknown = typeof entry === 'string' ? undefined : (entry as { symbol?: unknown } | null)?.symbol

    if (typeof path !== 'string' || !isAnchorPath(path)) {
      continue
    }

    const named = typeof symbol === 'string' && symbol.trim() !== '' && symbol.length <= MAX_SYMBOL ? symbol.trim() : undefined
    const key = `${path}\u0000${named ?? ''}`

    if (!seen.has(key) && anchors.length < max) {
      seen.add(key)
      anchors.push(named === undefined ? { path } : { path, symbol: named })
    }
  }

  return anchors
}
