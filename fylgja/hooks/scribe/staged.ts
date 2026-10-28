/**
 * Which files the shell commands of a session staged by name.
 *
 * Scribe runs no git. Which files a commit holds is decided by the number
 * git itself prints for it (`reportedWith` in `scribe.ts`); what is read
 * here only serves the case where the session changed more files than the
 * commit took, and the commands named the ones it took. A shell command is
 * not read for more than it plainly says: one `git add` of files written
 * out by name, or the commit itself. Anything else that names git leaves
 * the answer unknown, and a mistake in reading can leave a file out but
 * never put one in, because what is read must still add up to git's own
 * number.
 */

/** What reading one shell command came to. */
export type Step = {
  /** The files named as staged up to the first commit in the command, as paths from the working tree's root; null when that cannot be told. */
  named: string[] | null
  /**
   * Set when the command holds a commit: what the commit after it starts
   * from, none named yet, or unknown when the command went on after it.
   */
  next?: string[] | null
  /** Where the shell is left, and for a command that holds a commit, where the commit was made. */
  isAway: Away
  /**
   * Whether the command, up to its commit, did anything to what is staged
   * beside a commit taking everything changed with its own `-a`: read or
   * not, it is then the commands and not the session's files that say what
   * the commit holds.
   */
  hasStaged: boolean
  /** Whether everything changed in the tree was staged, up to the commit and by it. */
  whole: Whole
}

/** Whether the shell is somewhere other than the working tree's root: in a folder inside it, or outside it. */
export type Away = false | 'inside' | 'outside'

/**
 * Whether everything changed in the working tree was staged from its root
 * with nothing named: not at all, the files git already tracked (`commit
 * -a`, `add -u`), or new files too (`add -A`, `add --all`, `add .`).
 */
export type Whole = false | 'tracked' | 'all'

/**
 * What the shell commands since the last commit say of the commit to come:
 * the files they named as staged (null when that cannot be told), whether
 * any of them did anything to what is staged beside staging the whole tree,
 * whether the whole tree was staged, and where the shell is.
 */
export type Index = { named: string[] | null; hasStaged: boolean; whole: Whole; isAway: Away }

/** With no command read yet, and after a commit: nothing named, nothing staged, the shell where it was. */
export function cleared(isAway: Away): Index {
  return { named: [], hasStaged: false, whole: false, isAway }
}

const TOKEN = /"(?:[^"\\]|\\.)*"|'[^']*'|&&|\|\||[;|&\n]|[^\s;&|]+/g
const SEPARATOR = /^(?:&&|\|\||[;|&\n])$/
const GIT = /\bgit\b/

// What a path may not hold to be taken at its word: a pattern, a variable,
// a substitution, or the rest of a quote that did not close.
const UNSURE = /[*?[\]{}$`"'()<>\\~!:]/

// The words after `git add` that stage everything changed in the tree, when they stand alone and the shell is at its root.
const WHOLE: Readonly<Record<string, Whole>> = { '-A': 'all', '--all': 'all', '.': 'all', '-u': 'tracked' }

// Subcommands that only read: they stage nothing and unstage nothing.
const READS = new Set(['status', 'diff', 'log', 'show'])

// Options of `git commit` that take the next word as their value, and those that change nothing about what it holds.
const COMMIT_VALUES = new Set(['--message', '--file', '--author', '--date', '--cleanup', '--trailer'])
const COMMIT_PLAIN = new Set(['--no-verify', '--no-edit', '--quiet', '--signoff', '--verbose', '--no-gpg-sign'])

/**
 * `command` without the bodies of its here-documents, which are text and
 * never commands; undefined when one does not end.
 */
function withoutBodies(command: string): string | undefined {
  const lines = command.split('\n')
  const kept: string[] = []

  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at] ?? ''
    const word = /<<-?\s*(["']?)([A-Za-z_][\w-]*)\1/.exec(line)?.[2]

    kept.push(line)

    if (word === undefined) {
      continue
    }

    const end = lines.findIndex((other, index) => index > at && other.trim() === word)

    if (end === -1) {
      return undefined
    }

    at = end
  }

  return kept.join('\n')
}

/**
 * The words of a shell command as it splits them, a separator (`&&`, `||`,
 * `;`, `|`, `&`, a line's end) each a word of its own and a quote kept whole
 * with its marks; the bodies of here-documents left out. Undefined when a
 * body does not end: nothing after it is what it seems.
 */
export function shellWords(command: string): string[] | undefined {
  const text = withoutBodies(command)

  return text === undefined ? undefined : (text.match(TOKEN) ?? [])
}

/** Whether a word of `shellWords` is a separator between two commands. */
export function isSeparator(word: string): boolean {
  return SEPARATOR.test(word)
}

/** Whether a word cannot be taken at its word as a path: it holds a pattern, a variable, a substitution or a quote. */
export function isUnsure(word: string): boolean {
  return UNSURE.test(word)
}

/** A file as a command names it, as a path from the working tree's root; undefined when it cannot be taken at its word. */
function fileOf(word: string, root: string): string | undefined {
  const bare = /^(["']).*\1$/s.test(word) ? word.slice(1, -1) : word

  if (bare === '' || bare.endsWith('/') || UNSURE.test(bare)) {
    return undefined
  }

  const base = root.replace(/\/+$/, '')
  const path = bare.startsWith('/') ? (bare.startsWith(`${base}/`) ? bare.slice(base.length + 1) : '') : bare
  const parts = path.split('/').filter(part => part !== '' && part !== '.')

  return parts.length === 0 || parts.includes('..') ? undefined : parts.join('/')
}

/** The files the words after `git add` name, when they are files written out by name and nothing else. */
function addOf(args: readonly string[], root: string): string[] | null {
  const files = args.filter(arg => arg !== '--').map(arg => (arg.startsWith('-') ? undefined : fileOf(arg, root)))

  return files.length === 0 || files.includes(undefined) ? null : (files as string[])
}

/**
 * The files a `git commit` with these words holds beyond question: the ones
 * it names itself, which are then all it holds, or the ones named as staged
 * before it. Null for a commit that stages by itself or in a way not read here.
 */
function commitOf(
  args: readonly string[],
  named: string[] | null,
  root: string,
): { named: string[] | null; hasStaged: boolean; isAll: boolean } {
  const paths: (string | undefined)[] = []
  let onlyPaths = false
  // Whether it stages everything tracked by itself, and whether it does anything else that is not read here.
  let isAll = false
  let isOdd = false

  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at] ?? ''

    if (onlyPaths || !arg.startsWith('-')) {
      paths.push(fileOf(arg, root))
    } else if (arg === '--') {
      onlyPaths = true
    } else if (arg.startsWith('--')) {
      if (COMMIT_VALUES.has(arg)) {
        at += 1
      } else if (arg === '--all') {
        isAll = true
      } else {
        isOdd ||= !COMMIT_PLAIN.has(arg) && !COMMIT_VALUES.has(arg.slice(0, arg.indexOf('=')))
      }
    } else {
      // A run of short options, up to the first that takes a value: the rest of the word is that value, or the next word is.
      const value = arg.slice(1).search(/[mF]/)
      const flags = value === -1 ? arg.slice(1) : arg.slice(1, value + 1)

      isAll ||= flags.includes('a')
      isOdd ||= !/^[aqsSvn]*$/.test(flags)
      at += value !== -1 && value === arg.length - 2 ? 1 : 0
    }
  }

  return {
    named: isAll || isOdd ? null : paths.length === 0 ? named : paths.includes(undefined) ? null : (paths as string[]),
    // Its own `-a` is no staging beside the commit: it takes what was changed, which is what is counted.
    hasStaged: isOdd || paths.length > 0,
    isAll,
  }
}

/**
 * Reads one shell command for the files it stages by name.
 *
 * Only this is followed: commands joined by `&&`, each of them a `cd`, a
 * `git add` of files written out by name, a `git commit`, a git command
 * that only reads, or a command that does not name git at all. Git reached
 * any other way (through a subshell, a substitution, a path, another
 * program, a pipe), any other git command, any option of `git add`, a
 * folder or a pattern in place of a file, commands joined so that one may
 * fail and the next still run, and anything staged while the shell is not
 * at the working tree's root: each leaves what is staged unknown.
 *
 * @param named the files named as staged before, null when unknown
 * @param isAway whether the shell was left outside the working tree's root by an earlier command
 * @param whole whether the whole tree was staged by an earlier command
 */
export function namedAfter(named: string[] | null, command: string, root: string, isAway: Away, whole: Whole = false): Step {
  const split = shellWords(command)
  const words = split ?? []
  const parts: string[][] = [[]]
  // A quote that never closes, or a body that never ends: nothing after it is what it seems.
  let isSure = split !== undefined && !words.some(word => /^["']/.test(word) && !/^(["']).*\1$/s.test(word))
  let now = named
  let away = isAway
  let hasStaged = false
  let swept = whole

  for (const word of words) {
    if (SEPARATOR.test(word)) {
      isSure &&= word === '&&'
      parts.push([])
    } else {
      parts.at(-1)?.push(word)
    }
  }

  for (const [at, all] of parts.entries()) {
    // Settings given to the one command (`NAME=value git …`) stand before it.
    const part = all.slice(all.findIndex(word => !/^[A-Za-z_]\w*=/.test(word)))
    const [first = '', sub = '', ...args] = part

    if (/^\(?(?:cd|pushd|popd)$/.test(first)) {
      away = first === 'cd' ? movedTo(away, sub, root) : 'outside'
    } else if (first !== 'git') {
      // Git named anywhere but as the command itself: what it did is not followed.
      if (part.some(word => GIT.test(word))) {
        now = null
        hasStaged = true
      }
    } else if (sub === 'commit') {
      const commit = commitOf(args, now, root)
      const hasMore = parts.slice(at + 1).some(later => later.some(word => GIT.test(word)))

      return {
        named: isSure && away === false ? commit.named : null,
        next: hasMore || !isSure ? null : [],
        isAway: away,
        hasStaged: hasStaged || commit.hasStaged || !isSure,
        // Its own `-a` takes what git tracks; new files only where an add before it took them.
        whole: swept === false && commit.isAll && away === false ? 'tracked' : swept,
      }
    } else if (sub === 'add' && away === false && args.length === 1 && Object.hasOwn(WHOLE, args[0] ?? '')) {
      // The whole tree, staged from its root: what a commit's own `-a` does. No file is named by it, and it is no staging beside the commit.
      now = null
      swept = swept === 'all' ? 'all' : (WHOLE[args[0] ?? ''] ?? swept)
    } else if (sub === 'add') {
      const more = away === false ? addOf(args, root) : null

      now = now === null || more === null ? null : [...now, ...more]
      hasStaged = true
    } else if (!READS.has(sub)) {
      now = null
      hasStaged = true
    }
  }

  const isRead = isSure || !GIT.test(command)

  return { named: isRead ? now : null, isAway: away, hasStaged: hasStaged || !isRead, whole: swept }
}

/**
 * Where a `cd` leaves the shell: at the working tree's root, in a folder
 * inside it, or outside it. Anything that cannot be told from the word
 * itself counts as outside.
 */
function movedTo(from: Away, word: string, root: string): Away {
  const base = root.replace(/\/+$/, '')
  const to = word.replace(/^(["'])(.*)\1$/s, '$2').replace(/\/+$/, '')

  if (to === '' || UNSURE.test(to) || to.split('/').includes('..') || to === '-') {
    return 'outside'
  }

  if (to.startsWith('/')) {
    return to === base ? false : to.startsWith(`${base}/`) ? 'inside' : 'outside'
  }

  // A folder named from where the shell is: deeper into the tree, or deeper into wherever it was left.
  return from === 'outside' ? 'outside' : 'inside'
}

/**
 * The folder a `cd` to `word` leaves the shell in, from `from`; undefined
 * where that cannot be told from the word itself (a pattern, a variable,
 * `..`, `-`, home), or was not known before.
 */
export function folderAfter(from: string | undefined, word: string): string | undefined {
  const to = word.replace(/^(["'])(.*)\1$/s, '$2').replace(/\/+$/, '')

  if (to === '' || UNSURE.test(to) || to.split('/').includes('..') || to === '-') {
    return undefined
  }

  const parts = to.split('/').filter(part => part !== '' && part !== '.')

  if (to.startsWith('/')) {
    return `/${parts.join('/')}`
  }

  return from === undefined ? undefined : [from.replace(/\/+$/, ''), ...parts].join('/')
}

/**
 * How many files git said the commit `sha` changed: the number on the line
 * after the commit's own line, and no other count the command printed.
 * Null when git did not say.
 */
export function countIn(printed: string, sha: string): number | null {
  const at = printed.search(new RegExp(`^\\[[^\\]\\n]* ${sha}\\]`, 'm'))
  const count = at === -1 ? undefined : /^[^\n]*\n\s*(\d+) files? changed\b/.exec(printed.slice(at))?.[1]

  return count === undefined ? null : Number(count)
}
