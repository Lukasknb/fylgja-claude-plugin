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

export const CONNECTED = { isConnected: true, server: 'plugin:fylgja:fylgja' }
export const NEEDS_SIGN_IN = { isConnected: false, reason: 'auth', message: 'fylgja needs sign-in' }

type Call = { server: string; tool: string; args: Record<string, unknown> }

/** Engine calls a plugin that only draws has no business making. */
const FORBIDDEN = [
  'ui.log',
  'ui.toast',
  'store.get',
  'store.set',
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
  const clock = mock.clock(on)
  let connects = 0

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))

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

  on('mcp.connect', async () => {
    connects += 1

    return { value: ((await options.connect?.(clock)) ?? CONNECTED) as never }
  })

  on('mcp.call', async ($, e) => {
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

  return { calls, statuses, forbidden, connects: () => connects, clock }
}

/** The person's own message as its row is handed to the plugin. */
export function userMessage(text: string, isExpanded = false, kind: 'composer' | 'bridge' = 'composer') {
  return { plugin: 'fylgja', component: 'UserMessage', props: { text, origin: { kind }, isExpanded } } as const
}

/**
 * Draws the person's message on the terminal, lets the plugin's lookups run
 * for `ms` of the test's clock, and gives back what the row shows then.
 */
export async function rowOf($: Engine, started: Scene, text: string, ms = 0): Promise<string> {
  const ui = await $.ui.mount({ ...userMessage(text), surface: 'terminal' })
  await started.clock.advance(ms)
  const row = await ui.find({ type: 'Text' })
  await ui.unmount()

  return String(row?.children?.[0]).replace(/^engine: /, '')
}

/** Characters no person sees: a zero-width space, a right-to-left override, "hi" in the tag block, a soft hyphen. */
export const UNSEEN = String.fromCodePoint(0x200b, 0x202e, 0xe0068, 0xe0069, 0xad)

/** An interactive terminal session. */
export const SESSION = { surface: 'terminal', isInteractive: true, cwd: '/work/repo' } as const
