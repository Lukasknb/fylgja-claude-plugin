/**
 * What happened in the main conversation since Scribe last looked, read from
 * the conversation's own rows: the developer's prompts, Claude's replies,
 * and one short line per tool call.
 *
 * No file's contents and no tool's output are taken, with two exceptions: a
 * short head of what a shell command printed, and the text of a plan
 * document (see `plans.ts`).
 */

import { isRecord } from '../payload'
import { isPlanDocument, PLAN_MODE } from './plans'
import { relativeTo } from './repo'

/** A row of the conversation, as much of it as is read here. */
export type Row = {
  role: 'user' | 'assistant'
  text: string
  toolUses: readonly {
    tool: string
    input: Record<string, unknown>
    text?: string
    isError?: true
  }[]
}

/** A plan document seen in a tool call: its whole text, or one edit to it. */
export type PlanSighting = { key: string; path: string | null; text: string } | { key: string; before: string; after: string }

export type Seen = {
  /** The rows as lines, oldest first, cut to `MAX_DELTA_CHARS` from the old end. */
  lines: string[]
  /** How many lines the cut left out. */
  dropped: number
  /** Files of the working tree Claude read or changed, each once, as paths from its root. */
  touched: string[]
  /** The sha of every commit a shell call made in this repository. */
  commits: string[]
  plans: PlanSighting[]
  /** Everything the developer wrote, for checks on their own words. */
  developer: string
  /** Whether a file was written or changed, or a commit made. */
  hasChange: boolean
  /** How many characters the developer and Claude wrote between them. */
  words: number
}

/** No more of the conversation than this is handed to one wake. */
export const MAX_DELTA_CHARS = 14_000

const MAX_PROMPT = 2500
const MAX_REPLY = 2500
const MAX_COMMAND = 200
const MAX_HEAD = 160

const FILE_TOOLS: ReadonlySet<string> = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length <= max ? flat : `${flat.slice(0, max)}… (${flat.length - max} more characters)`
}

/** A prompt without the notes the engine attaches to it for Claude alone. */
function said(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
}

function fileOf(input: Record<string, unknown>): string | undefined {
  const path = input.file_path ?? input.notebook_path

  return typeof path === 'string' && path !== '' ? path : undefined
}

/** What a read of a file returned, without the line numbers the tool puts before each line. */
function readText(text: string): string {
  return text
    .split('\n')
    .map(line => line.replace(/^\s*\d+(?:→|\t)/, ''))
    .join('\n')
}

// Where a shell command says it runs git: `git -C <dir>`, or a `cd <dir>`
// before it. A `--git-dir`, a `GIT_DIR` or a `pushd` names a repository in
// ways that are not followed here.
const ELSEWHERE = /--git-dir|--work-tree|\bGIT_DIR\b|\bGIT_WORK_TREE\b|\bpushd\b/
const DIRS = /(?:\bgit\s+(?:-c\s+\S+\s+)*-C|\bcd)\s+("[^"]*"|'[^']*'|[^\s;&|]+)/g

/**
 * Whether a command's own text shows that its git runs at the root of the
 * tree at `root`: it names no other place, or names exactly that root. A
 * folder inside the tree may be a repository of its own (a submodule, a
 * nested checkout), so `cd sub && git commit` shows nothing.
 */
function isHere(command: string, root: string): boolean {
  if (ELSEWHERE.test(command)) {
    return false
  }

  for (const [, quoted = ''] of command.matchAll(DIRS)) {
    if (quoted.replace(/^["']|["']$/g, '').replace(/\/+$/, '') !== root) {
      return false
    }
  }

  return true
}

/**
 * The sha of the commit a shell call made in this repository, read from the
 * line git prints for a commit it made (`[main 1a2b3c4] message`).
 *
 * The line is the proof: a commit that failed prints none, and a command
 * that failed after its commit went through still printed it. A commit made
 * somewhere else (`git -C /other`, `cd sub && git commit`), or anywhere the
 * command's text does not show to be this repository's root, is nobody's
 * to attach here.
 *
 * @param root the working tree's root
 */
export function commitOf(command: string, printed: string | undefined, root: string): string | undefined {
  if (printed === undefined || !/\bgit\b[^\n]*\bcommit\b/.test(command) || !isHere(command, root.replace(/\/+$/, ''))) {
    return undefined
  }

  return /^\[[^\]\n]* ([0-9a-f]{7,40})\]/m.exec(printed)?.[1]
}

function planOf(
  tool: string,
  input: Record<string, unknown>,
  printed: string | undefined,
  root: string,
): PlanSighting | undefined {
  if (tool === 'ExitPlanMode') {
    return typeof input.plan === 'string' && input.plan.trim() !== ''
      ? { key: PLAN_MODE, path: null, text: input.plan }
      : undefined
  }

  const file = fileOf(input)

  if (file === undefined) {
    return undefined
  }

  const path = relativeTo(root, file) ?? null

  if (tool === 'Write' && typeof input.content === 'string') {
    return isPlanDocument(file, input.content) ? { key: file, path, text: input.content } : undefined
  }

  // A read from the top of the file only: a later part alone has no heading
  // to tell what it is, and would stand for the whole document.
  if (tool === 'Read' && printed !== undefined && (input.offset === undefined || input.offset === 0 || input.offset === 1)) {
    const text = readText(printed)

    return isPlanDocument(file, text) ? { key: file, path, text } : undefined
  }

  if (tool === 'Edit' && typeof input.old_string === 'string' && typeof input.new_string === 'string') {
    return { key: file, before: input.old_string, after: input.new_string }
  }

  return undefined
}

function lineOf(
  tool: string,
  input: Record<string, unknown>,
  printed: string | undefined,
  isError: boolean,
  root: string,
): string {
  const outcome = printed === undefined ? '' : isError ? ' failed' : ' ok'

  if (tool === 'Bash' && typeof input.command === 'string') {
    const head = printed === undefined || printed.trim() === '' ? '' : `: ${clip(printed, MAX_HEAD)}`

    return `[tool] Bash \`${clip(input.command, MAX_COMMAND)}\`${outcome}${head}`
  }

  const file = fileOf(input)

  if (file !== undefined) {
    return `[tool] ${tool} ${relativeTo(root, file) ?? `${file} (outside the working tree)`}${outcome}`
  }

  if ((tool === 'Grep' || tool === 'Glob') && typeof input.pattern === 'string') {
    return `[tool] ${tool} ${clip(input.pattern, MAX_COMMAND)}${outcome}`
  }

  return `[tool] ${clip(tool, 80)}${outcome}`
}

const CHANGING: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** A prompt as it is compared: without the engine's notes, its spaces evened out. */
export function plain(text: string): string {
  return said(text).replace(/\s+/g, ' ').trim()
}

// How the engine opens the row that stands for a compacted conversation.
const SUMMARY = /^This session is being continued from a previous conversation\b/

/** A prompt shorter than this is found only as the whole of a row, or at its start or end; a longer one anywhere in it. */
const MIN_INSIDE = 12

/**
 * Whether a user-role row holds the developer's own words: one of the
 * prompts they sent, as the plugin saw them sent. The row may hold more than
 * the prompt (what an editor or a hook put around it), so the prompt is
 * looked for inside it. A background task's notice, a skill's text and a
 * summary after compaction are user-role rows too, and are nobody's prompt.
 */
export function isPrompt(row: Row, prompts: ReadonlySet<string>): boolean {
  if (row.role !== 'user' || row.text === '') {
    return false
  }

  const text = plain(row.text)

  if (prompts.has(text)) {
    return true
  }

  // What the engine writes in place of a compacted conversation quotes the
  // developer at length; it is the engine's row, not theirs.
  if (SUMMARY.test(text)) {
    return false
  }

  for (const prompt of prompts) {
    const isInside =
      prompt !== '' &&
      (prompt.length >= MIN_INSIDE ? text.includes(prompt) : text.startsWith(`${prompt} `) || text.endsWith(` ${prompt}`))

    if (isInside) {
      return true
    }
  }

  return false
}

/**
 * Reads `rows` into what a wake is told and what the plugin itself acts on.
 *
 * @param root the working tree's root; files are named from it
 * @param prompts the prompts the developer sent, each as `plain` leaves it
 */
export function observe(rows: readonly Row[], root: string, prompts: ReadonlySet<string>): Seen {
  const lines: string[] = []
  const touched = new Set<string>()
  const commits: string[] = []
  const plans: PlanSighting[] = []
  const developer: string[] = []
  let hasChange = false
  let words = 0

  for (const row of rows) {
    const text = row.role === 'user' ? said(row.text) : row.text.trim()

    if (row.role === 'assistant' && text !== '') {
      lines.push(`[claude] ${clip(text, MAX_REPLY)}`)
      words += text.length
    } else if (isPrompt(row, prompts)) {
      lines.push(`[developer] ${clip(text, MAX_PROMPT)}`)
      developer.push(text)
      words += text.length
    } else if (text.startsWith('<task-notification>')) {
      // Said to have happened; what it reported is not the developer's and is left out.
      lines.push('[notice] a background task reported back')
    }

    for (const use of row.toolUses) {
      const input = isRecord(use.input) ? use.input : {}
      const isError = use.isError === true

      lines.push(lineOf(use.tool, input, use.text, isError, root))

      const file = FILE_TOOLS.has(use.tool) ? fileOf(input) : undefined
      const path = file === undefined ? undefined : relativeTo(root, file)

      if (path !== undefined) {
        touched.add(path)
        hasChange ||= CHANGING.has(use.tool) && !isError
      }

      const sha = use.tool === 'Bash' && typeof input.command === 'string' ? commitOf(input.command, use.text, root) : undefined

      if (sha !== undefined && !commits.includes(sha)) {
        commits.push(sha)
        hasChange = true
      }

      const plan = isError ? undefined : planOf(use.tool, input, use.text, root)

      if (plan !== undefined) {
        plans.push(plan)
      }
    }
  }

  let size = lines.reduce((sum, line) => sum + line.length + 1, 0)
  let dropped = 0

  while (size > MAX_DELTA_CHARS && lines.length > 1) {
    size -= (lines.shift()?.length ?? 0) + 1
    dropped += 1
  }

  return { lines, dropped, touched: [...touched], commits, plans, developer: developer.join('\n'), hasChange, words }
}

/**
 * The files of the working tree one step's tool calls name, as paths from
 * its root: what Claude is about to read or change.
 */
export function pathsOf(uses: readonly { name: string; input: unknown }[], root: string): string[] {
  const paths: string[] = []

  for (const use of uses) {
    const file = FILE_TOOLS.has(use.name) && isRecord(use.input) ? fileOf(use.input) : undefined
    const path = file === undefined ? undefined : relativeTo(root, file)

    if (path !== undefined && !paths.includes(path)) {
      paths.push(path)
    }
  }

  return paths
}
