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
import { cleared, countIn, namedAfter } from './staged'
import type { Away, Index, Step, Whole } from './staged'

/** A row of the conversation, as much of it as is read here. */
export type Row = {
  role: 'user' | 'assistant'
  text: string
  toolUses: readonly {
    /** The call's id, where the engine gives it: what tells two calls with the same words apart. */
    tool_use_id?: string
    tool: string
    input: Record<string, unknown>
    text?: string
    /** What the transcript stored for the call; on a call that was refused or failed, the engine's own error text. */
    result?: unknown
    isError?: true
  }[]
}

/** A plan document seen in a tool call: its whole text, or one edit to it. */
export type PlanSighting = { key: string; path: string | null; text: string } | { key: string; before: string; after: string }

/**
 * A commit made in this repository, and what the rows before it say of the
 * files it holds.
 */
export type Landed = {
  sha: string
  /** The files written or changed in these rows before it and after the commit before, as absolute paths. */
  before: string[]
  /**
   * The files the commands of these rows named as staged for it, as paths
   * from the working tree's root; null when they do not plainly say.
   */
  named: string[] | null
  /** Whether a command of these rows did anything to what is staged for it, beside the commit's own `-a` and the whole tree staged from its root. */
  hasStaged: boolean
  /** Whether the whole tree was staged for it, by itself or by a command before it, and whether new files with it. */
  whole: Whole
  /**
   * Those among `before` that these rows show to be new: written where the
   * tool said it created the file. Staging what git tracks does not take them.
   */
  created: string[]
  /** Where the shell was when it was made: at the working tree's root, in a folder inside it, or outside it. */
  isAway: Away
  /** How many files git said it changed; null when it did not say. */
  count: number | null
}

export type Seen = {
  /** The rows as lines, oldest first, cut to `MAX_DELTA_CHARS` from the old end. */
  lines: string[]
  /** How many lines the cut left out. */
  dropped: number
  /** Files of the working tree Claude read or changed, each once, as paths from its root. */
  touched: string[]
  /**
   * Every file Claude read or changed, wherever it lies, each once, as an
   * absolute path: which repository each belongs to is found out from these.
   */
  files: string[]
  /** Those among them that were written or changed, as absolute paths. */
  changed: string[]
  /** The sha of every commit a shell call made in this repository. */
  commits: string[]
  /** Those commits in the order they were made, each with what the rows say of the files it holds. */
  landed: Landed[]
  /** The files written or changed after the last of those commits, as absolute paths: no commit among the rows holds them. */
  loose: string[]
  /** Those among them the rows show to be new files. */
  created: string[]
  /** What the shell commands since the last commit, these rows' included, say of the commit to come. */
  index: Index
  plans: PlanSighting[]
  /** Everything the developer wrote, for checks on their own words. */
  developer: string
  /**
   * What the developer decided without typing a prompt: each answer to a
   * question Claude put to them, each plan they approved, and each word of
   * theirs on a plan or a tool call they turned down. `words` is what of it
   * is their own, to be kept with their prompts: the label of the option
   * they picked or what they typed, never the question and never what an
   * option was said to mean. `key` tells one act from another.
   */
  acts: { key: string; words: string }[]
  /** How many questions Claude put to them they answered in these rows. */
  choices: number
  /** The words of those questions and of the option labels: not theirs, and no reason for anything. */
  offered: string[]
  /**
   * Each question they answered by picking an option, with what the picked
   * options were said to mean. The assistant's text, which the developer
   * chose: never their own words.
   */
  offers: Offer[]
  /**
   * Everything the assistant wrote in the questions they answered: each
   * question and every option's label and what it was said to mean, picked
   * or not. A reason that mostly says this over is the assistant's.
   */
  offeredText: string
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
/** A shell command that worked is shown this short; what it printed is not shown at all. */
const MAX_QUIET_COMMAND = 120
/** One line lists no more files read than fit in this. */
const MAX_READS = 400
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
    // What a command printed is shown where it says something a reader of
    // the turn needs: when it failed, and the line of a commit it made. A
    // command that simply worked is its own short line.
    const isTelling = isError || /\bgit\b[^\n]*\bcommit\b/.test(input.command)
    const head = !isTelling || printed === undefined || printed.trim() === '' ? '' : `: ${clip(printed, MAX_HEAD)}`

    return `[tool] Bash \`${clip(input.command, isTelling ? MAX_COMMAND : MAX_QUIET_COMMAND)}\`${outcome}${head}`
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

const MAX_QUESTION = 300
const MAX_OPTION_TEXT = 200
const MAX_CHOSEN = 600

/**
 * One choice the developer made between options Claude offered: the question,
 * what was offered, and what they answered. `picked` holds the options they
 * picked, each by its exact label; `typed` what they wrote instead of picking
 * one ("Other"), which is their own words.
 */
export type Choice = {
  question: string
  offered: { label: string; description: string }[]
  chosen: string
  picked: { label: string; description: string }[]
  typed: string
}

/** A question the developer answered by picking, and what the assistant said each picked option means. */
export type Offer = { question: string; picked: { label: string; description: string }[] }

/**
 * The options an answer names, each by its exact label: the whole answer is
 * one label, or (several picked at once) every part of it between commas is
 * one. An answer that only contains a label ("No, use the queue" beside an
 * option "No") names none: it is what the developer typed.
 */
function pickedOf(
  chosen: string,
  offered: readonly { label: string; description: string }[],
): { label: string; description: string }[] {
  const whole = offered.find(option => option.label.trim() === chosen)

  if (whole !== undefined) {
    return [whole]
  }

  const parts = chosen.split(/,\s*/).map(part => part.trim())
  const named = parts.map(part => offered.find(option => option.label.trim() === part))

  return parts.length > 1 && named.every(option => option !== undefined)
    ? (named as { label: string; description: string }[])
    : []
}

/**
 * The developer's answers to the questions of one `AskUserQuestion` call,
 * read from the call and from what it returned. The engine writes each
 * answer back as `"<question>"="<answer>"`; an answer is what stands between
 * its own question and the next. A question that got no answer is left out.
 */
export function choicesOf(input: Record<string, unknown>, printed: string | undefined): Choice[] {
  const asked = (Array.isArray(input.questions) ? input.questions : []).flatMap(one =>
    isRecord(one) && typeof one.question === 'string' && one.question !== '' ? [one] : [],
  )
  const text = printed ?? ''
  const marks = asked.map(one => text.indexOf(`"${String(one.question)}"="`))
  const choices: Choice[] = []

  for (const [at, one] of asked.entries()) {
    const mark = marks[at] ?? -1

    if (mark === -1) {
      continue
    }

    const question = String(one.question)
    const from = mark + question.length + 4
    const next = Math.min(...marks.filter(other => other > mark), Number.POSITIVE_INFINITY)
    // Up to the quote that closes it: the one before the next question, or the last of the text.
    const until = next === Number.POSITIVE_INFINITY ? text.lastIndexOf('"') : text.lastIndexOf('"', next - 1)
    const chosen = text.slice(from, until > from ? until : text.length).trim()

    if (chosen !== '') {
      const offered = (Array.isArray(one.options) ? one.options : []).flatMap(option =>
        isRecord(option) && typeof option.label === 'string'
          ? [{ label: option.label, description: typeof option.description === 'string' ? option.description : '' }]
          : [],
      )
      const picked = pickedOf(chosen, offered)

      choices.push({ question, offered, chosen, picked, typed: picked.length === 0 ? chosen : '' })
    }
  }

  return choices
}

// The engine's own result for a tool call the developer turned down: these
// words open it, and with something said, the second sentence and then what
// was said follow. Beside it the transcript stores one of two fixed texts.
const REJECTION =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file)."
const SAID = ' To tell you how to proceed, the user said:'
const STORED_REJECTION = 'User rejected tool use'

/**
 * Whether a tool call's result is the engine's own for a call the developer
 * turned down, and what they said about it ('' when nothing).
 *
 * It is one only when the call ended in an error, its result BEGINS with the
 * engine's sentence, and what the transcript stored for it, where that is
 * held, is the engine's text for a rejection too. A tool that failed and
 * printed that sentence is not one: what a command prints never opens its
 * result (the engine puts "Exit code N" before it), and what the transcript
 * stores for it is its own error. A tool of an MCP server writes its own
 * error text from the first character on, so nothing it returned is taken
 * for the developer's words.
 */
export function rejectionOf(use: Row['toolUses'][number]): { feedback: string } | undefined {
  const { text, result } = use

  if (use.isError !== true || text === undefined || !text.startsWith(REJECTION)) {
    return undefined
  }

  if (
    result !== undefined &&
    !(typeof result === 'string' && (result === STORED_REJECTION || result.startsWith(`Error: ${REJECTION}`)))
  ) {
    return undefined
  }

  const rest = text.slice(REJECTION.length)

  return { feedback: rest.startsWith(SAID) && !use.tool.startsWith('mcp__') ? rest.slice(SAID.length).trim() : '' }
}

/** Whether an act is an answer to a question Claude put to the developer. */
export function isAnswer(act: { key: string }): boolean {
  return act.key.startsWith('chose\u0000')
}

/**
 * Whether a question Claude put to the developer is still out among `rows`:
 * the call is there and what it came to is not.
 */
export function hasOpenQuestion(rows: readonly Row[]): boolean {
  return rows.some(row =>
    row.toolUses.some(use => use.tool === 'AskUserQuestion' && use.text === undefined && use.isError !== true),
  )
}

// Calls that keep Claude's own books or wait on its own tasks: they say
// nothing of what was decided, and are left out of what a wake is told.
const BOOKKEEPING: ReadonlySet<string> = new Set([
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'TaskOutput',
  'TaskStop',
  'ToolSearch',
  'Monitor',
  'BashOutput',
  'KillShell',
  'SendMessage',
])

/** A file path as a tool call gives it, made absolute from the working tree's root. */
function absolute(root: string, file: string): string {
  return file.startsWith('/') ? file : `${root.replace(/\/+$/, '')}/${file.replace(/^(?:\.\/)+/, '')}`
}

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
 * @param index what the shell commands before these rows, since the commit before, say of the commit to come
 */
export function observe(rows: readonly Row[], root: string, prompts: ReadonlySet<string>, index: Index = cleared(false)): Seen {
  const lines: string[] = []
  const touched = new Set<string>()
  const files = new Set<string>()
  const changed = new Set<string>()
  const commits: string[] = []
  const landed: Landed[] = []
  // Since the last commit among the rows: the files changed, those of them
  // that are new, and what the commands say of what is staged.
  let since = new Set<string>()
  let created = new Set<string>()
  let { named, hasStaged, whole } = index
  let away: Away = index.isAway
  const plans: PlanSighting[] = []
  const developer: string[] = []
  const acts: { key: string; words: string }[] = []
  const optionWords: string[] = []
  const offers: Offer[] = []
  const offeredText: string[] = []
  let answered = 0
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

      const line = lineOf(use.tool, input, use.text, isError, root)
      const last = lines.at(-1)
      const choices = use.tool === 'AskUserQuestion' && !isError ? choicesOf(input, use.text) : []
      const rejection = rejectionOf(use)

      if (choices.length > 0) {
        // The developer's own choice between named options: theirs as a prompt is.
        for (const choice of choices) {
          const offered = choice.offered
            .map(
              option =>
                `${clip(option.label, MAX_OPTION_TEXT)}${option.description === '' ? '' : ` (${clip(option.description, MAX_OPTION_TEXT)})`}`,
            )
            .join('; ')
          const answer = `${choice.typed === '' ? 'Chosen' : 'Typed by the developer, who picked none of them'}: ${clip(choice.chosen, MAX_CHOSEN)}`

          lines.push(`[developer chose] Question: ${clip(choice.question, MAX_QUESTION)} | Offered: ${offered} | ${answer}`)

          // Their own words are what they typed. A label they picked is kept
          // as what they chose; what the option was said to mean is the
          // assistant's, and is kept apart as offered text.
          if (choice.typed !== '') {
            developer.push(choice.typed)
          }

          // One act per answered call: the same question answered the same way again is another.
          const call = use.tool_use_id === undefined ? '' : `${use.tool_use_id}\u0000`

          acts.push({ key: `chose\u0000${call}${choice.question}\u0000${choice.chosen}`, words: choice.chosen })

          if (choice.picked.some(option => option.description !== '')) {
            offers.push({ question: choice.question, picked: choice.picked.filter(option => option.description !== '') })
          }

          offeredText.push(choice.question, ...choice.offered.map(option => `${option.label}: ${option.description}`))
          answered += 1
          optionWords.push(choice.question, ...choice.offered.map(option => option.label))
          words += choice.question.length + choice.chosen.length
        }
      } else if (rejection !== undefined && rejection.feedback !== '') {
        // A plan or a call the developer turned down, with what they said: a correction in their own words.
        lines.push(`[developer rejected ${clip(use.tool, 40)}] ${clip(rejection.feedback, MAX_PROMPT)}`)
        developer.push(rejection.feedback)
        acts.push({ key: `rejected\u0000${rejection.feedback}`, words: rejection.feedback })
        words += rejection.feedback.length
      } else if (rejection !== undefined) {
        // Turned down without a word: said to have happened, and nobody's words.
        lines.push(`[tool rejected] ${clip(use.tool, 40)}`)
      } else if (use.tool === 'ExitPlanMode' && !isError && use.text !== undefined) {
        lines.push('[developer approved the plan]')
        acts.push({ key: `approved\u0000${typeof input.plan === 'string' ? input.plan.length : 0}`, words: '' })
      } else if (BOOKKEEPING.has(use.tool)) {
        // Left out.
      } else if (use.tool === 'Read' && !isError && last !== undefined && READS.test(last) && last.length < MAX_READS) {
        // Files read one after the other are one line.
        lines[lines.length - 1] = `${last.slice(0, -3)}, ${line.slice('[tool] Read '.length)}`
      } else {
        lines.push(line)
      }

      const file = FILE_TOOLS.has(use.tool) ? fileOf(input) : undefined
      const path = file === undefined ? undefined : relativeTo(root, file)

      if (file !== undefined) {
        files.add(absolute(root, file))
        // A change counts wherever the file lies: the session may be working in another repository.
        hasChange ||= CHANGING.has(use.tool) && !isError

        if (CHANGING.has(use.tool) && !isError) {
          changed.add(absolute(root, file))
          since.add(absolute(root, file))

          // The tool says when it wrote a file that was not there; any other wording counts as a file that was.
          if (use.tool === 'Write' && /^File created\b/.test(use.text ?? '')) {
            created.add(absolute(root, file))
          }
        }
      }

      if (path !== undefined) {
        touched.add(path)
      }

      const sha = use.tool === 'Bash' && typeof input.command === 'string' ? commitOf(input.command, use.text, root) : undefined

      // Every shell command is read for the files it stages by name and for
      // where it leaves the shell. A commit that did not show, and a command
      // that names git and failed, leave what is staged unknown.
      const step: Step | undefined =
        use.tool === 'Bash' && typeof input.command === 'string' ? namedAfter(named, input.command, root, away, whole) : undefined

      if (step !== undefined) {
        const isLost: boolean = sha === undefined && (step.next !== undefined || (isError && /\bgit\b/.test(String(input.command))))

        away = step.isAway
        named = sha !== undefined ? named : isLost ? null : step.named
        hasStaged ||= step.hasStaged || isLost
        whole = step.whole
      }

      if (sha !== undefined && !commits.includes(sha)) {
        commits.push(sha)
        landed.push({
          sha,
          before: [...since],
          named: step?.named ?? null,
          hasStaged,
          whole,
          created: [...created],
          isAway: away,
          count: countIn(use.text ?? '', sha),
        })
        since = new Set()
        created = new Set()
        // A command that went on after its commit has done to the next one what is not read here.
        named = step?.next ?? null
        hasStaged = named === null
        whole = false
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

  // A turn too long to hand over loses its tool lines first, oldest first,
  // then its notices, then Claude's oldest replies. What the developer wrote
  // or chose is never what goes.
  for (const mark of ['[tool]', '[notice]', '[claude]']) {
    for (let at = 0; size > MAX_DELTA_CHARS && at < lines.length;) {
      const line = lines[at] ?? ''

      if (line.startsWith(mark) && lines.length > 1) {
        lines.splice(at, 1)
        size -= line.length + 1
        dropped += 1
      } else {
        at += 1
      }
    }
  }

  return {
    lines,
    dropped,
    touched: [...touched],
    files: [...files],
    changed: [...changed],
    acts,
    choices: answered,
    offered: optionWords,
    offers,
    offeredText: offeredText.join('\n'),
    commits,
    landed,
    loose: [...since],
    created: [...created],
    index: { named, hasStaged, whole, isAway: away },
    plans,
    developer: developer.join('\n'),
    hasChange,
    words,
  }
}

// A line of files read that worked, to which the next file read is added.
const READS = /^\[tool\] Read .* ok$/

/** The files one step's tool calls write or change, as absolute paths, and whether one of them is a git commit. */
export function changesOf(
  uses: readonly { name: string; input: unknown }[],
  root: string,
): { files: string[]; hasCommit: boolean } {
  const files: string[] = []
  let hasCommit = false

  for (const use of uses) {
    const input = isRecord(use.input) ? use.input : {}
    const file = CHANGING.has(use.name) ? fileOf(input) : undefined

    if (file !== undefined && !files.includes(absolute(root, file))) {
      files.push(absolute(root, file))
    }

    hasCommit ||= use.name === 'Bash' && typeof input.command === 'string' && /\bgit\b[^\n]*\bcommit\b/.test(input.command)
  }

  return { files, hasCommit }
}

/** The files one step's tool calls name, wherever they lie, as absolute paths: what Claude is about to read or change. */
export function filesOf(uses: readonly { name: string; input: unknown }[], root: string): string[] {
  const files: string[] = []

  for (const use of uses) {
    const file = FILE_TOOLS.has(use.name) && isRecord(use.input) ? fileOf(use.input) : undefined
    const path = file === undefined ? undefined : absolute(root, file)

    if (path !== undefined && !files.includes(path)) {
      files.push(path)
    }
  }

  return files
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
