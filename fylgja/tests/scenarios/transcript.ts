/**
 * Reads a recorded Claude Code session, as the CLI writes it (one JSON object
 * per line), into the turns of its main conversation: for each, what began
 * it, and the rows a running session would hold for it. A prompt of the
 * developer's, Claude's replies, and each tool call with its input and a
 * clipped head of what it returned.
 *
 * Nothing here reads a file or keeps anything: lines go in, turns come out.
 * What a session holds is somebody's work, so texts are clipped where they
 * are read and nothing is logged.
 */

import type { Row } from '../../hooks/scribe/delta'

type Use = { tool: string; input: Record<string, unknown>; text?: string; result?: unknown; isError?: true }

/** One turn of the recorded session, or a point where the conversation was rewritten. */
export type Turn = {
  /**
   * `prompt`: the developer sent it. `other`: something else began it (a
   * background task's notice, a hook, a scheduled prompt). `clear`: the
   * conversation was cleared here. `compact`: it was compacted, and `rows`
   * holds the one row that replaced what came before.
   */
  kind: 'prompt' | 'other' | 'clear' | 'compact'
  /** When it began, in milliseconds since 1970; 0 when the session did not say. */
  at: number
  /** The directory the session ran in at that time. */
  cwd: string | null
  /** What the session said began it (`human`, `task-notification`, …), as far as it said. */
  source: string
  /** The text that began it, as the conversation's row holds it. */
  prompt: string
  rows: Row[]
  /** Whether the turn left plan mode with a plan. */
  hasPlan: boolean
  /**
   * What agents the session started did while the turn ran, as far as Scribe
   * is told of it: each file they wrote or changed (the path alone) and each
   * commit command, in the order they happened.
   */
  agentUses?: { name: string; input: Record<string, unknown> }[]
}

export type Recorded = {
  sessionId: string | null
  /** The first directory the session ran in. */
  cwd: string | null
  /** The Claude Code version that wrote the first line that names one. */
  version: string | null
  turns: Turn[]
  /** What was left out, by why: rows of agents, rows only Claude was shown, lines that are not rows. */
  left: { sidechain: number; meta: number; unreadable: number; other: number }
}

export type Limits = {
  /** No more of a prompt or a reply is kept than this. */
  text: number
  /** No more of one string in a tool call's input. */
  input: number
  /** No more of what a tool returned. */
  result: number
  /** No more of a markdown document that was written, read or approved as a plan. */
  document: number
}

export const LIMITS: Limits = { text: 6000, input: 4000, result: 2000, document: 30_000 }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const cut = (text: string, max: number): string => (text.length <= max ? text : text.slice(0, max))

const MARKDOWN = /\.(?:md|markdown|mdx)$/i

/** The text of a message's content: a string, or the text blocks of a list. */
function textOf(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .flatMap(block => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
    .join('\n')
}

function blocksOf(content: unknown, type: string): Record<string, unknown>[] {
  return Array.isArray(content)
    ? content.filter((block): block is Record<string, unknown> => isRecord(block) && block.type === type)
    : []
}

/** A tool call's input with every long string clipped; a markdown document's text is given more room. */
function inputOf(tool: string, input: unknown, limits: Limits): Record<string, unknown> {
  if (!isRecord(input)) {
    return {}
  }

  const path = typeof input.file_path === 'string' ? input.file_path : ''
  const isDocument = tool === 'ExitPlanMode' || MARKDOWN.test(path)
  const clipped = (value: unknown, depth: number): unknown => {
    if (typeof value === 'string') {
      return cut(value, isDocument ? limits.document : limits.input)
    }

    if (Array.isArray(value)) {
      return depth > 6 ? [] : value.slice(0, 50).map(one => clipped(one, depth + 1))
    }

    if (isRecord(value)) {
      return depth > 6 ? {} : Object.fromEntries(Object.entries(value).map(([key, one]) => [key, clipped(one, depth + 1)]))
    }

    return value
  }

  return clipped(input, 0) as Record<string, unknown>
}

// What a slash command leaves in the conversation: its name, and what was typed after it.
const COMMAND = /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/
const ARGS = /<command-args>([\s\S]*?)<\/command-args>/

// Rows the engine writes for itself or for Claude: never a turn of anybody's.
const ENGINE_ROW = /^\s*(?:<local-command-stdout>|<local-command-stderr>|<local-command-caveat>|\[Request interrupted)/

/** Reads a session line by line. `push` each line, then `done` for what it came to. */
export function reader(limits: Limits = LIMITS): { push: (line: string) => void; done: () => Recorded } {
  const recorded: Recorded = {
    sessionId: null,
    cwd: null,
    version: null,
    turns: [],
    left: { sidechain: 0, meta: 0, unreadable: 0, other: 0 },
  }
  // Tool calls by id, to hand each what it returned; and the assistant message a row belongs to.
  const uses = new Map<string, Use>()
  const replies = new Map<string, { text: string; toolUses: Use[] }>()
  let turn: Turn | undefined
  let hasOrigins = false
  let isCompacted = false

  const begin = (kind: Turn['kind'], entry: Record<string, unknown>, source: string, prompt: string): Turn => {
    const at = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : Number.NaN

    turn = {
      kind,
      at: Number.isFinite(at) ? at : (turn?.at ?? 0),
      cwd: typeof entry.cwd === 'string' ? entry.cwd : (turn?.cwd ?? recorded.cwd),
      source,
      prompt,
      rows: [],
      hasPlan: false,
    }
    recorded.turns.push(turn)
    replies.clear()

    return turn
  }

  const user = (entry: Record<string, unknown>, message: Record<string, unknown>): void => {
    const { content } = message
    const results = blocksOf(content, 'tool_result')

    for (const result of results) {
      const use = typeof result.tool_use_id === 'string' ? uses.get(result.tool_use_id) : undefined

      if (use !== undefined) {
        const isDocument = typeof use.input.file_path === 'string' && MARKDOWN.test(use.input.file_path)

        use.text = cut(textOf(result.content), isDocument ? limits.document : limits.result)

        if (result.is_error === true) {
          use.isError = true

          // What the transcript stored beside an errored call: the engine's own error text.
          if (typeof entry.toolUseResult === 'string') {
            use.result = cut(entry.toolUseResult, limits.result)
          }
        }
      }
    }

    const text = textOf(content)

    if (text.trim() === '') {
      recorded.left.other += results.length === 0 ? 1 : 0

      return
    }

    if (entry.isCompactSummary === true || isCompacted) {
      isCompacted = false
      begin('compact', entry, 'compact', '').rows.push({ role: 'user', text: cut(text, limits.text), toolUses: [] })

      return
    }

    if (entry.isMeta === true) {
      recorded.left.meta += 1

      return
    }

    const origin = isRecord(entry.origin) && typeof entry.origin.kind === 'string' ? entry.origin.kind : undefined

    hasOrigins ||= origin !== undefined

    const command = COMMAND.exec(text)?.[1]

    if (command === 'clear') {
      begin('clear', entry, 'command', '')

      return
    }

    if (ENGINE_ROW.test(text)) {
      recorded.left.meta += 1

      return
    }

    // A slash command reads as it was typed: its name and what followed it.
    const said = command === undefined ? text : `/${command} ${ARGS.exec(text)?.[1]?.trim() ?? ''}`.trim()
    // A session that names what began each turn is taken at its word. One that
    // does not (an older build) has every plain prompt taken as the developer's.
    const isDeveloper =
      origin === 'human' || (origin === undefined && !hasOrigins && !/^\s*</.test(text)) || command !== undefined
    const prompt = cut(said, limits.text)

    begin(isDeveloper ? 'prompt' : 'other', entry, origin ?? (command === undefined ? 'unnamed' : 'command'), prompt).rows.push({
      role: 'user',
      text: prompt,
      toolUses: [],
    })
  }

  const assistant = (entry: Record<string, unknown>, message: Record<string, unknown>): void => {
    // Rows before the first prompt (a session resumed mid-turn) still belong to a turn.
    const into = turn ?? begin('other', entry, 'unnamed', '')
    const id = typeof message.id === 'string' ? message.id : `row-${into.rows.length}`
    let reply = replies.get(id)

    if (reply === undefined) {
      reply = { text: '', toolUses: [] }
      replies.set(id, reply)
      into.rows.push({ role: 'assistant', text: '', toolUses: reply.toolUses })
    }

    const row = into.rows.find(one => one.toolUses === reply.toolUses)
    const text = textOf(message.content)

    if (row !== undefined && text !== '') {
      reply.text = cut(reply.text === '' ? text : `${reply.text}\n${text}`, limits.text)
      ;(row as { text: string }).text = reply.text
    }

    for (const block of blocksOf(message.content, 'tool_use')) {
      const tool = typeof block.name === 'string' ? block.name : ''
      const use: Use = { tool, input: inputOf(tool, block.input, limits) }

      reply.toolUses.push(use)

      if (typeof block.id === 'string') {
        uses.set(block.id, use)
      }

      if (tool === 'ExitPlanMode' && typeof use.input.plan === 'string' && use.input.plan.trim() !== '') {
        into.hasPlan = true
      }
    }
  }

  return {
    push: line => {
      if (line.trim() === '') {
        return
      }

      let entry: unknown

      try {
        entry = JSON.parse(line)
      } catch {
        recorded.left.unreadable += 1

        return
      }

      if (!isRecord(entry)) {
        recorded.left.unreadable += 1

        return
      }

      recorded.sessionId ??= typeof entry.sessionId === 'string' ? entry.sessionId : null
      recorded.cwd ??= typeof entry.cwd === 'string' ? entry.cwd : null
      recorded.version ??= typeof entry.version === 'string' ? entry.version : null

      // An agent's rows are its own conversation, not the main one.
      if (entry.isSidechain === true) {
        recorded.left.sidechain += 1

        return
      }

      if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
        isCompacted = true

        return
      }

      const message = isRecord(entry.message) ? entry.message : undefined

      if (message !== undefined && entry.type === 'user') {
        user(entry, message)
      } else if (message !== undefined && entry.type === 'assistant') {
        assistant(entry, message)
      } else {
        recorded.left.other += 1
      }
    },
    done: () => {
      for (const one of recorded.turns) {
        one.rows = one.rows.filter(row => row.text !== '' || row.toolUses.length > 0)
      }

      return recorded
    },
  }
}

/** A whole session from its lines. */
export function recordedOf(lines: Iterable<string>, limits: Limits = LIMITS): Recorded {
  const reading = reader(limits)

  for (const line of lines) {
    reading.push(line)
  }

  return reading.done()
}

/** A turn in a few words that quote no more than sixty characters of it. */
export function labelOf(turn: Turn): string {
  const flat = turn.prompt.replace(/\s+/g, ' ').trim()
  const head = flat.length <= 60 ? flat : `${flat.slice(0, 59)}…`

  return turn.kind === 'prompt' ? head : turn.kind === 'other' ? `(${turn.source}) ${head}`.slice(0, 70) : `(${turn.kind})`
}

const CHANGING = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/**
 * What one line of an agent's own transcript holds for Scribe: the path of
 * a file the agent wrote or changed, or a commit command, with when it
 * happened. Nothing of what was written, and nothing the agent said.
 */
export function agentUsesOf(line: string): { at: number; name: string; input: Record<string, unknown> }[] {
  let entry: unknown

  try {
    entry = JSON.parse(line)
  } catch {
    return []
  }

  if (!isRecord(entry) || entry.type !== 'assistant' || !isRecord(entry.message)) {
    return []
  }

  const at = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : Number.NaN
  const uses: { at: number; name: string; input: Record<string, unknown> }[] = []

  for (const block of blocksOf(entry.message.content, 'tool_use')) {
    const name = typeof block.name === 'string' ? block.name : ''
    const input = isRecord(block.input) ? block.input : {}

    if (CHANGING.has(name) && typeof input.file_path === 'string') {
      uses.push({ at, name, input: { file_path: input.file_path } })
    } else if (name === 'Bash' && typeof input.command === 'string' && /\bgit\b[^\n]*\bcommit\b/.test(input.command)) {
      uses.push({ at, name, input: { command: 'git commit' } })
    }
  }

  return Number.isFinite(at) ? uses : []
}
