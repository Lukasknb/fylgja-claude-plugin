import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

import type { Row } from '../hooks/scribe/delta'
import { ACCOUNT, answer, CONNECTED, idOf } from './fixtures'

export const ROOT = '/work/repo'
export const REPO = 'acme/web'
export const SESSION_ID = 'c0ffee00-0000-4000-8000-000000000001'

/** An interactive terminal session in a repository. */
export const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const

export const NOTHING = '{"outcome":"nothing"}'

/** The band as the stand-in for Claude Code draws it when the plugin draws nothing there at all. */
export const EMPTY = 'engine: AbovePrompt'

/** The mark at rest, as the band above the prompt draws it while it has nothing of its own to show. */
export const MARK = 'ᚠ fylgja'

/**
 * The band with nothing of Scribe's or of the account's in it, in a session
 * the plugin works for: what the stand-in for Claude Code draws there, and
 * the mark at rest under it.
 */
export const QUIET = `${EMPTY}${MARK}`

type Call = { tool: string; args: Record<string, unknown> }

/** One request to Scribe's model, as the engine was handed it. */
export type Asked = { model: string; prompt: string; system: string; effort: unknown; timeoutMs: unknown }

export type StageOptions = {
  /** What Scribe's model answers, in order; the last is repeated. "Nothing" by default. A function is handed the request. */
  replies?: readonly (string | ((asked: Asked, clock: MockClock) => string | undefined | Promise<string | undefined>))[]
  /** What each Fylgja tool answers; a tool not named answers as the server would for an ordinary call. */
  tools?: Readonly<Record<string, (args: Record<string, unknown>, clock: MockClock) => unknown>>
  repo?: { root: string; remote: string | null } | null
  cwd?: string
  surfaces?: readonly string[]
  connect?: () => Record<string, unknown> | Promise<Record<string, unknown>>
  /** Tools the engine does not let the plugin call, each with the engine's words for it. */
  refused?: Readonly<Record<string, string>>
  /** What `whoami` answers, when it is not the usual account. */
  whoami?: (clock: MockClock) => unknown
  /** What the comparison of a new decision with records already held answers; "unrelated" without it. */
  relate?: (asked: Asked, clock: MockClock) => string | undefined | Promise<string | undefined>
  /** What the look for a reason in the developer's own words answers; "absent" without it. */
  verify?: (asked: Asked, clock: MockClock) => string | undefined | Promise<string | undefined>
  /** The text of the plugin's own `.mcp.json`. */
  declared?: string
  /** Where the session is now, when it moves. */
  cwdNow?: () => string
  /** Files of the machine by path: their text, or `null` for one that is there and cannot be read. Read on every look. */
  files?: Record<string, string | null>
  /** Paths the machine never answers about: a mount that has gone away. */
  stalled?: (path: string) => boolean
  /** The session's id, when it is not the usual one. */
  sessionId?: () => string
  /** The session cannot say what its id is. */
  hasNoId?: boolean
  /** What is already kept on this machine. */
  kept?: Readonly<Record<string, unknown>>
}

export type Stage = {
  /** Every call made on Fylgja's server, in order. */
  calls: Call[]
  /** Every request made to Scribe's model, in order. */
  asked: Asked[]
  toasts: string[]
  /** Every text put in the prompt box by the plugin. */
  fills: string[]
  /** Each time Fylgja was asked who is signed in: how many other calls had been made by then. */
  whoamis: number[]
  /** Every look for a reason in the developer's own words, in order. */
  verified: Asked[]
  /** Every comparison of a new decision with records already held, in order. */
  related: Asked[]
  /** Every file the plugin read, in order. */
  reads: string[]
  /** Every line the plugin wrote to the debug log. */
  logged: string[]
  /** Every tool whose call was put to the permission check, in order. */
  checks: string[]
  /** Every prompt that entered the session, as it arrived. */
  sent: string[]
  statuses: (string | undefined)[]
  /** What is kept on this machine. */
  kept: Map<string, unknown>
  /** The conversation; a test adds to it and ends the turn. */
  rows: Row[]
  /** The prompt box as `$.prompt.read` answers. */
  box: { text: string }
  clock: MockClock
  /** The calls made of one tool. */
  of: (tool: string) => Record<string, unknown>[]
}

/**
 * A session beneath the plugin for Scribe: Fylgja's server, Scribe's model
 * and the session's facts all answered by the test, the clock the test's,
 * and everything the plugin asked, wrote, kept or showed held for the test
 * to read.
 */
export function stage(on: On, options: StageOptions = {}): Stage {
  const calls: Call[] = []
  const asked: Asked[] = []
  const toasts: string[] = []
  const fills: string[] = []
  const whoamis: number[] = []
  const verified: Asked[] = []
  const related: Asked[] = []
  const reads: string[] = []
  const logged: string[] = []
  const checks: string[] = []
  const sent: string[] = []
  const statuses: (string | undefined)[] = []
  const kept = new Map<string, unknown>(Object.entries(options.kept ?? {}))
  const rows: Row[] = []
  const box = { text: '' }
  const clock = mock.clock(on)
  let written = 0

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('prompt.submit', ($, e) => {
    sent.push(e.text)

    return { text: e.text, context: e.context }
  })
  on('prompt.edit', ($, e) => {
    box.text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)

    return { text: box.text, cursor: e.start + e.inputText.length }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  // The model's step: it asks for the tool calls a test named with `stepping`, or for none.
  // eslint-disable-next-line require-yield
  on('turn.step', async function* ($, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [...(STEPS.get(on)?.() ?? [])],
      stopReason: 'tool_use' as const,
      usage: null,
    }
  })
  on('ui.render', ($, e) => {
    const props = e.props as { text?: string }

    return { type: 'Text', props: {}, children: [`engine: ${props.text ?? e.component}`] }
  })
  on('tool.check', ($, e) => {
    checks.push(e.tool)

    return { decision: 'ask' as const, reason: 'not granted yet' }
  })

  on('mcp.connect', async () => ({ value: ((await options.connect?.()) ?? CONNECTED) as never }))
  on('mcp.call', async ($, e) => {
    // Who is signed in is asked before anything else; it is counted apart from the calls a test lists.
    if (e.tool === 'whoami') {
      whoamis.push(calls.length)

      return options.whoami === undefined
        ? { value: answer(ACCOUNT) as never }
        : { value: (await options.whoami(clock)) as never }
    }

    calls.push({ tool: e.tool, args: e.args })

    const refusal = options.refused?.[e.tool]

    if (refusal !== undefined) {
      return { deny: refusal }
    }

    const own = options.tools?.[e.tool]

    if (own !== undefined) {
      return { value: (await own(e.args, clock)) as never }
    }

    if (e.tool === 'remember') {
      written += 1

      return {
        value: answer({
          atom_id: idOf(100 + written),
          outcome: 'created',
          supersede: e.args.supersedes === undefined ? 'not_requested' : 'applied',
        }) as never,
      }
    }

    if (e.tool === 'amend_memory') {
      return { value: answer({ atom_id: e.args.atom_id, outcome: e.args.op === 'remove' ? 'removed' : 'fixed' }) as never }
    }

    if (e.tool === 'attach_commit') {
      return { value: answer({ attached: 1, atom_ids: [] }) as never }
    }

    return { value: answer({ repo: REPO, facts: [], records: [] }) as never }
  })

  on('model.complete', async ($, e) => {
    const request: Asked = { model: e.model, prompt: e.prompt, system: e.system ?? '', effort: e.effort, timeoutMs: e.timeoutMs }

    // The look for a reason in what the developer wrote is a call of its own
    // kind: it is answered apart from a test's list of replies, with "absent"
    // unless the test says otherwise, and kept apart from the calls a test counts.
    if (request.system.startsWith('You check one thing')) {
      verified.push(request)

      const found = (await options.verify?.(request, clock)) ?? '{"absent":true}'
      const spent = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

      return { value: { isAnswered: true, text: found, usage: spent } as never }
    }

    // How a new decision stands to records already held is a call of its own kind too: "unrelated" unless the test says otherwise.
    if (request.system.startsWith('You compare one new decision')) {
      related.push(request)

      const found = (await options.relate?.(request, clock)) ?? '{"relation":"unrelated"}'
      const spent = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

      return { value: { isAnswered: true, text: found, usage: spent } as never }
    }

    const replies = options.replies ?? [NOTHING]
    const reply = replies[Math.min(asked.length, replies.length - 1)] ?? NOTHING

    asked.push(request)

    const text = typeof reply === 'string' ? reply : await reply(request, clock)
    const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

    return {
      value: (text === undefined ? { isAnswered: false, reason: 'aborted', usage } : { isAnswered: true, text, usage }) as never,
    }
  })

  on('session.messages', () => ({ value: rows as never }))
  on('session.id', () => (options.hasNoId === true ? { deny: 'no id today' } : { value: options.sessionId?.() ?? SESSION_ID }))
  on('session.repo', () => ({
    value: (options.repo === undefined
      ? { root: ROOT, remote: 'git@github.com:acme/web.git', internal: false, name: null }
      : options.repo === null
        ? null
        : { ...options.repo, internal: false, name: null }) as never,
  }))
  on('session.cwd', () => ({ value: options.cwdNow?.() ?? options.cwd ?? ROOT }))
  on('session.surfaces', () => ({ value: (options.surfaces ?? ['terminal']) as never }))
  on('fs.stat', ($, e) => {
    if (options.stalled?.(e.path) === true) {
      return new Promise<never>(() => undefined)
    }

    const isThere = e.path === `${options.cwd ?? ROOT}/.git` || e.path === `${ROOT}/.git` || options.files?.[e.path] !== undefined

    return isThere ? { value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false } as never } : { deny: 'no such file' }
  })
  on('fs.read', ($, e) => {
    // Any other `.mcp.json` asked for is the plugin's own, wherever the plugin is installed.
    const text =
      options.files?.[e.path] ??
      (e.path.endsWith('/.mcp.json') && !(e.path in (options.files ?? {})) ? options.declared : undefined)

    reads.push(e.path)

    return typeof text === 'string' ? { value: text as never } : { deny: 'cannot be read' }
  })
  on('store.get', ($, e) => ({ value: kept.get(e.key) as never }))
  on('store.set', ($, e) => {
    kept.set(e.key, e.value)

    return { value: undefined }
  })
  on('prompt.read', () => ({ value: { text: box.text, cursor: box.text.length } }))
  on('prompt.fill', ($, e) => {
    fills.push(e.text)
    box.text = e.text

    return { isFilled: true }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    logged.push(e.text)

    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    statuses.push(e.text)

    return { value: undefined }
  })

  return {
    calls,
    asked,
    toasts,
    fills,
    whoamis,
    verified,
    related,
    reads,
    logged,
    checks,
    sent,
    statuses,
    kept,
    rows,
    box,
    clock,
    of: tool => calls.filter(call => call.tool === tool).map(call => call.args),
  }
}

/** What the developer wrote. */
export function dev(text: string): Row {
  return { role: 'user', text, toolUses: [] }
}

type Use = Row['toolUses'][number]

/** What Claude wrote, and the tools it called. */
export function claude(text: string, ...toolUses: Use[]): Row {
  return { role: 'assistant', text, toolUses }
}

export function use(tool: string, input: Record<string, unknown>, text = 'ok', isError = false): Use {
  return isError ? { tool, input, text, isError: true } : { tool, input, text }
}

export const edit = (path: string): Use => use('Edit', { file_path: `${ROOT}/${path}`, old_string: 'a', new_string: 'b' })

let turns = 0

/**
 * One turn as a developer starts it: each of their prompts among `rows` is
 * sent from the prompt box, the rows join the conversation, and the turn
 * ends as the main conversation's own turn ends.
 */
export async function turn($: Engine, on: Stage, ...rows: Row[]): Promise<void> {
  for (const row of rows) {
    if (row.role === 'user' && row.text !== '') {
      await send($, row.text)
    }
  }

  await finish($, on, ...rows)
}

/** The developer sends a prompt from the prompt box. */
export async function send($: Engine, text: string): Promise<void> {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

/** Adds `rows` to the conversation and ends the turn, with no prompt sent for it here. */
export async function finish($: Engine, on: Stage, ...rows: Row[]): Promise<void> {
  turns += 1
  on.rows.push(...rows)
  await $.turn.complete({
    answer: rows.at(-1)?.text ?? '',
    durationMs: 1,
    isAborted: false,
    turnId: `turn-${turns}`,
    reason: 'answer',
  })
}

/** Types into the prompt box, or empties it. */
export async function typing($: Engine, on: Stage, text: string): Promise<void> {
  const prompt = $.prompt as unknown as { edit: (input: Record<string, unknown>) => Promise<unknown> }

  await prompt.edit({
    origin: { kind: 'composer' },
    text: on.box.text,
    cursor: 0,
    start: 0,
    end: on.box.text.length,
    inputText: text,
  })
}

/** Presses a key that only acts on its second press, twice. */
export async function pressTwice($: Engine, key: string): Promise<void> {
  await press($, key)
  await press($, key)
}

/** One step of the main conversation's turn that asks for `uses`. */
export async function step(
  $: Engine,
  index: number,
  uses: readonly { name: string; input: unknown }[],
  agentId?: string,
): Promise<void> {
  const stream = $.turn.step({
    turnId: 'turn-step',
    index,
    model: 'claude-opus',
    messageCount: 3,
    ...(agentId === undefined ? {} : { agentId }),
  })

  for await (const chunk of stream) {
    void chunk
  }

  void uses
  await stream.result
}

/** Stands for the model's step: it asks for the tool calls the test names. */
export function stepping(on: On, uses: () => readonly { name: string; input: unknown }[]): void {
  STEPS.set(on, uses)
}

const STEPS = new WeakMap<On, () => readonly { name: string; input: unknown }[]>()

const BAND = {
  plugin: 'fylgja',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

function words(node: unknown, into: string[]): void {
  if (typeof node === 'string') {
    into.push(node)
  } else if (typeof node === 'object' && node !== null) {
    const { props, children } = node as { props?: { label?: unknown; hotkey?: unknown; value?: unknown }; children?: unknown }

    if (typeof props?.label === 'string') {
      into.push(typeof props.hotkey === 'string' ? ` [${props.hotkey} ${props.label}]` : ` [${props.label}]`)
    }

    if (typeof props?.value === 'string') {
      into.push(`<${props.value}>`)
    }

    if (Array.isArray(children)) {
      children.forEach(child => words(child, into))
    }
  }
}

/** The band above the prompt as the plugin draws it, and the keys a person has there. */
export async function band($: Engine, surface: 'terminal' | 'desktop' = 'terminal', isWorking = false) {
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking }, surface } as never)
  const text = async (): Promise<string> => {
    const into: string[] = []

    words(await ui.drawn(), into)

    return into.join('')
  }

  return {
    text,
    /** Whether the plugin draws nothing there. */
    isEmpty: async () => (await text()) === EMPTY,
    press: (key: string) => ui.press({ key } as never),
    enter: (key: string, value: string) =>
      (ui as unknown as { input: (act: { key: string; text: string }) => Promise<unknown> }).input({ key, text: value }),
    redraw: () => ui.redraw(),
    unmount: () => ui.unmount(),
  }
}

/** What the band shows now; a fresh look each time. */
export async function shown($: Engine, isWorking = false): Promise<string> {
  const ui = await band($, 'terminal', isWorking)
  const text = await ui.text()

  await ui.unmount()

  return text
}

/** Presses one key of the band as it stands now. */
export async function press($: Engine, key: string): Promise<void> {
  const ui = await band($)

  await ui.press(key)
  await ui.unmount()
}

/** A record as `recall` returns it. */
export function fact(n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: idOf(n),
    type: 'decision',
    content: 'Use the queue for outbound mail, never a direct SMTP call.',
    detail: 'Direct calls dropped mail when the provider throttled.',
    alternatives: ['direct SMTP call'],
    anchors: [{ path: 'src/mail/send.ts' }],
    reason_status: 'stated',
    origin: 'scribe',
    last_verified: '2026-09-12T10:00:00Z',
    // Remembered directly, as most records are: it has no page of its own.
    link: null,
    source_id: null,
    ...overrides,
  }
}

/** A verdict as Scribe's model writes one. */
export function verdict(parts: { records?: unknown[]; question?: unknown; tells?: unknown[] }): string {
  return JSON.stringify({
    outcome: 'act',
    records: parts.records ?? [],
    question: parts.question ?? null,
    tells: parts.tells ?? [],
  })
}

/** A decision with its reason, as the model proposes it. */
export function decision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'decision',
    content: 'Use Postgres advisory locks for the job queue, not Redis.',
    detail: 'One less service to run, and the jobs table is already in Postgres.',
    reason_status: 'stated',
    alternatives: ['Redis with Redlock'],
    anchors: [{ path: 'src/queue/lock.ts', symbol: 'acquire' }],
    supersedes: null,
    plan: null,
    ...overrides,
  }
}
