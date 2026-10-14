import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

export const MEETING_ID = '45ada8aa-6465-45de-8e91-b967cd9bbdae'
export const NOTE_ID = '0b1f6c1e-2a67-4a0c-9d5e-3f0f5a7b8c9d'

/** A reference as the Fylgja app copies it. */
export function token(kind: string, title: string, id: string): string {
  return `{{fylgja:${kind}${title === '' ? '' : ` ${title}`}|${id}}}`
}

/** The n-th of a run of distinct record ids. */
export function idOf(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

/** A meeting as `resolve` answers for it when asked by id. */
export function meetingRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ref: MEETING_ID,
    found: true,
    id: MEETING_ID,
    kind: 'meeting',
    title: 'Engineering Retrospective',
    date: '2026-09-30',
    visibility: 'shared with your team',
    ...overrides,
  }
}

/** A tool result carrying `payload` as its text, the way the server sends JSON. */
export function answer(payload: unknown): Record<string, unknown> {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false }
}

/** The account every test session is signed in as, as `whoami` answers. */
export const ACCOUNT = {
  user: { id: '11111111-0000-4000-8000-000000000001', display_name: 'Ada Lovelace' },
  team: { id: '22222222-0000-4000-8000-000000000002', name: 'Acme' },
  profile: { id: '33333333-0000-4000-8000-000000000003', name: 'Work' },
}

export const CONNECTED = { isConnected: true, server: 'plugin:fylgja:fylgja' }
export const NEEDS_SIGN_IN = { isConnected: false, reason: 'auth', message: 'fylgja needs sign-in' }

type Call = { server: string; tool: string; args: Record<string, unknown> }

/** Engine calls a plugin that only draws has no business making. */
const FORBIDDEN = [
  'ui.log',
  'ui.toast',
  'prompt.read',
  'process.run',
  'http.fetch',
  'fs.read',
  'fs.write',
  'session.repo',
  'env.get',
  'settings.read',
  'model.complete',
] as const

export type Scene = {
  /** Every tool call made on Fylgja's server, in order. */
  calls: Call[]
  /** Every value the status line was set to, in order. */
  statuses: (string | undefined)[]
  /** Every call the plugin made that it must never make, by name. */
  forbidden: string[]
  /** How many times the server's state was asked. */
  connects: () => number
  /** How many times Fylgja was asked who is signed in. */
  whoamis: () => number
  clock: MockClock
}

export type SceneOptions = {
  /** What `$.mcp.connect` answers; connected by default. Read on every call. */
  connect?: (clock: MockClock) => Record<string, unknown> | Promise<Record<string, unknown>>
  /** What `resolve` answers. Without it, and for any other tool, the call rejects. */
  resolve?: (args: Record<string, unknown>, clock: MockClock) => unknown
}

/**
 * A session beneath the plugin: Fylgja's server answered by the test, Claude
 * Code's own rows standing in (each shows the text or tool it was handed),
 * and everything the plugin showed or asked kept for the test to read. The
 * clock is the test's, so an answer comes exactly as late as the test makes
 * it and a timer fires when the test says so.
 */
export function scene(on: On, options: SceneOptions = {}): Scene {
  const calls: Call[] = []
  const statuses: (string | undefined)[] = []
  const forbidden: string[] = []
  const pinned = new Map<string, unknown>()
  const clock = mock.clock(on)
  let connects = 0
  let whoamis = 0

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  // A step of a turn in which the model says nothing and asks for no tool.
  // eslint-disable-next-line require-yield
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })

  on('ui.render', ($, e) => {
    const props = e.props as { text?: string; tool?: string }

    return { type: 'Text', props: {}, children: [`engine: ${props.text ?? props.tool ?? ''}`] }
  })

  for (const name of FORBIDDEN) {
    on(name, () => {
      forbidden.push(name)

      return { deny: 'not for this plugin' } as never
    })
  }

  // Where the session is, and a project that holds no `.mcp.json`: the
  // plugin looks at both before it trusts Fylgja's connection.
  on('session.cwd', () => ({ value: '/work/repo' }))
  on('fs.stat', () => ({ deny: 'no such file' }))

  on('mcp.connect', async () => {
    connects += 1

    return { value: ((await options.connect?.(clock)) ?? CONNECTED) as never }
  })

  // The one thing the plugin keeps on the machine here: which account it is set up for.
  on('store.get', ($, e) => {
    if (e.key !== 'fylgja.account') {
      forbidden.push('store.get')
    }

    return { value: pinned.get(e.key) as never }
  })
  on('store.set', ($, e) => {
    if (e.key !== 'fylgja.account') {
      forbidden.push('store.set')
    }

    pinned.set(e.key, e.value)

    return { value: undefined }
  })

  on('mcp.call', async ($, e) => {
    // Who is signed in is asked before anything else, and is not one of the lookups a test counts.
    if (e.tool === 'whoami') {
      whoamis += 1

      return { value: answer(ACCOUNT) as never }
    }

    calls.push({ server: e.server, tool: e.tool, args: e.args })

    if (e.tool !== 'resolve' || options.resolve === undefined) {
      return { deny: `no such tool: ${e.tool}` }
    }

    return { value: (await options.resolve(e.args, clock)) as never }
  })

  on('ui.status', ($, e) => {
    statuses.push(e.text)

    return { value: undefined }
  })

  return { calls, statuses, forbidden, connects: () => connects, whoamis: () => whoamis, clock }
}

/**
 * A row as Claude Code's own stand-in drew it, showing `text`: Claude Code
 * stamps each hook's returned root with whose part of the drawing it is, so a
 * root marked as the test's is the stand-in's own row, not one the plugin drew
 * or wrapped.
 */
export function engineDrew(text: string) {
  return { type: 'Text', props: {}, children: [text], part: { plugin: 'test' } } as const
}

/** The person's own message as its row is handed to the plugin. */
export function userMessage(text: string, isExpanded = false, kind: 'composer' | 'bridge' = 'composer') {
  return { plugin: 'fylgja', component: 'UserMessage', props: { text, origin: { kind }, isExpanded } } as const
}

/** How long a step of a turn waits for Fylgja before it hands back; the plugin's own figure. */
const STEP_WAIT_MS = 1500

/**
 * A step of a turn passes: the next hook Claude Code waits on, and so the
 * plugin's chance to ask Fylgja what the rows on screen noted. The test's
 * clock moves `ms` while it runs. A step still waiting after that is let run
 * out its own short wait, so what it asked may stay unanswered.
 */
export async function asked($: Engine, started: Scene, ms = 0): Promise<void> {
  let isDone = false
  const done = step($).finally(() => {
    isDone = true
  })

  await started.clock.advance(ms)
  await started.clock.settle()

  if (!isDone) {
    await started.clock.advance(STEP_WAIT_MS)
  }

  await done
}

/** A step of a turn, begun and not waited for: the test moves the clock while it runs, and waits for it when it likes. */
export function step($: Engine): Promise<void> {
  const stream = $.turn.step({ turnId: 'turn-ask', index: 0, model: 'claude-opus', messageCount: 1 })

  return (async () => {
    for await (const chunk of stream) {
      void chunk
    }

    await stream.result
  })()
}

/**
 * Draws the person's message on the terminal, lets a step of a turn pass
 * with `ms` of the test's clock so the plugin asks Fylgja, and gives back
 * what the row shows then.
 */
export async function rowOf($: Engine, started: Scene, text: string, ms = 0): Promise<string> {
  const ui = await $.ui.mount({ ...userMessage(text), surface: 'terminal' })
  await asked($, started, ms)
  const row = await ui.find({ type: 'Text' })
  await ui.unmount()

  return String(row?.children?.[0]).replace(/^engine: /, '')
}

/** Characters no person sees: a zero-width space, a right-to-left override, "hi" in the tag block, a soft hyphen. */
export const UNSEEN = String.fromCodePoint(0x200b, 0x202e, 0xe0068, 0xe0069, 0xad)

/** An interactive terminal session. */
export const SESSION = { surface: 'terminal', isInteractive: true, cwd: '/work/repo' } as const
