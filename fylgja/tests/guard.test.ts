import type { On, TraceEntry } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'

import { FORK_PROMPT } from '../hooks/reader/prompt'
import type { Upload } from '../hooks/reader/reader'
import { register } from '../hooks/register'
import type { Row } from '../hooks/scribe/delta'
import { ACCOUNT, answer, endedBy, idOf, SESSION_ID } from './fixtures'
import { boundary, claude, decision, dev, edit, NOTHING, press, pressTwice, QUIET, shown, stage, START, turn, verdict } from './scribe-fixtures'
import type { Stage } from './scribe-fixtures'
import { endTurn, QUOTE, readingReply, reported, skuld } from './skuld-fixtures'
import { frame, pane } from './window-fixtures'

/** What the guard writes in the debug log for each hook of a person's plugin it sent an event on past. */
const SKIPPED = 'org-guard: skipped'

/**
 * An organization's guard, as it sits outermost: the events it keeps out of
 * a person's reach go on past them (`next.to(e, "append")`), and a check
 * whose verdict a person's plugin loosened or reworded is run once more
 * without them. Each hook of a person's plugin it passes over is written in
 * the debug log, as Claude Code would say it was skipped. It is loaded as a
 * module of its own, so it holds everything it uses.
 */
const GUARD: Plugin = {
  name: 'org-guard',
  tier: 'prepend',
  register(on: On) {
    const skippedIn = (trace: readonly TraceEntry[]): string[] =>
      trace.filter(entry => entry.tier === 'user' && entry.outcome === 'skipped').map(entry => `org-guard: skipped ${entry.plugin} at ${entry.event}`)
    const order = (decision: string): number => ['deny', 'ask', 'allow'].indexOf(decision)

    on('classic.SessionStart', async ($, e, next) => {
      const done = await next.to(e, 'append')

      for (const line of skippedIn(next.trace)) {
        await $.ui.log(line, { to: 'debug' })
      }

      return done
    })
    on('prompt.context', async ($, e, next) => {
      const done = await next.to(e, 'append')

      for (const line of skippedIn(next.trace)) {
        await $.ui.log(line, { to: 'debug' })
      }

      return done
    })
    on('session.compact', async ($, e, next) => {
      const done = await next.to(e, 'append')

      for (const line of skippedIn(next.trace)) {
        await $.ui.log(line, { to: 'debug' })
      }

      return done
    })
    on('tool.check', async ($, e, next) => {
      const first = await next(e)
      const links = [...next.trace].sort((one, other) => one.index - other.index)
      const isRewritten = links.some((link, at) => {
        const handed = links[at + 1]?.returned
        const answered = link.returned

        return (
          link.tier === 'user' &&
          handed !== undefined &&
          answered !== undefined &&
          (order(answered.decision) > order(handed.decision) || (answered.decision === handed.decision && answered.reason !== handed.reason))
        )
      })

      if (!isRewritten) {
        return first
      }

      const again = await next.to(e, 'append')

      for (const line of skippedIn(next.trace)) {
        await $.ui.log(line, { to: 'debug' })
      }

      return again.decision === 'deny' ? again : first
    })
  },
}

const FILE = 'src/queue/lock.ts'
const WORK = [dev('lock the retry queue with redis, and cap the retries'), claude('Done, both are in.', { ...edit(FILE), tool_use_id: 'toolu_1' })]
const MORE = [dev('and log every retry at warn'), claude('Logged.', { ...edit(FILE), tool_use_id: 'toolu_2' })]
const LOCK = decision({ content: 'Use a Redis lock for the retry queue.', detail: 'Redis is already there.', anchors: [{ path: FILE }] })
const CAP = decision({ content: 'Cap retries at five.', detail: 'A sixth never succeeded.', anchors: [{ path: FILE }] })

/** What Claude Code puts in a compacted conversation's place. */
const SUMMARY: Row = { role: 'user', text: 'This session is being continued from a previous conversation that ran out of context.', toolUses: [] }

const COMMAND = {
  command: 'fylgja-kept',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
} as never

/** The records the window of what was kept lists, opened by its command. */
async function listed($: Engine): Promise<string[]> {
  await $.command.run(COMMAND)

  const ui = await pane($)
  const lines = await ui.lines()

  await ui.unmount()

  return lines.filter(line => line.includes('◆'))
}

/** A session in which Scribe has kept the lock and the cap, its receipt put away, beneath the guard. */
async function kept($: Engine, on: On, id: () => string = () => SESSION_ID): Promise<Stage> {
  frame(on)
  const set = stage(on, { replies: [verdict({ records: [LOCK, CAP] }), NOTHING], sessionId: id })

  // Claude Code's own: a cleared, resumed or branched conversation's classic start, the context, and a compaction with the summary in the conversation's place.
  on('classic.SessionStart', () => ({}))
  on('prompt.context', ($$, e) => ({ blocks: e.blocks }))
  on('session.compact', () => ({ messages: [SUMMARY] }) as never)
  await $.session.start(START)
  await turn($, set, ...WORK)
  await press($, 'ok')

  return set
}

/** The lines of the guard's in the debug log: a hook of the plugin's it sent an event on past. */
function skipped(set: Stage): string[] {
  return set.logged.filter(line => line.startsWith(SKIPPED))
}

describe('beneath an organization’s guard', () => {
  test('a /clear empties what was kept, and the guard passes no hook of the plugin’s over', { plugins: [GUARD] }, async ($, on) => {
    const set = await kept($, on)

    expect(await listed($)).toHaveLength(2)

    await endedBy($, 'clear')
    await $.classic.SessionStart({ source: 'clear' })

    expect(await listed($)).toEqual([])
    expect(await shown($), 'the mark is at rest, and still vouches for the account').toBe(QUIET)
    expect(skipped(set)).toEqual([])
  })

  test('a resume picks up what the conversation it goes into kept, from its own log', { plugins: [GUARD] }, async ($, on) => {
    let id = SESSION_ID
    const set = await kept($, on, () => id)

    id = idOf(950)
    await endedBy($, 'resume', SESSION_ID)
    await $.classic.SessionStart({ source: 'resume', session_id: id })

    expect(await listed($), 'a conversation with no log of its own').toEqual([])

    id = SESSION_ID
    await endedBy($, 'resume', idOf(950))
    await $.classic.SessionStart({ source: 'resume', session_id: id })

    expect(await listed($)).toEqual(['▸ ◆ Decision · Cap retries at five.', '  ◆ Decision · Use a Redis lock for the retry queue.'])
    expect(skipped(set)).toEqual([])
  })

  test('a compaction the guard keeps the plugin out of is seen by its boundary row: the next prompt carries what the session kept, once', { plugins: [GUARD] }, async ($, on) => {
    const set = await kept($, on)
    const done = await $.session.compact({ trigger: 'manual', messages: [...set.rows] } as never)

    set.rows.splice(0, set.rows.length, ...(done.messages as unknown as Row[]))
    await boundary($, 'boundary-1')
    await $.prompt.context({ blocks: [] } as never)
    await turn($, set, ...MORE)

    expect(set.beside.at(-1)?.[0]).toMatch(/^This conversation was compacted\. Before that, this session saved 2 records/)

    await turn($, set, dev('and on'), claude('Sure.'))

    expect(set.beside.at(-1)).toBeUndefined()
    expect(set.events('compaction')).toHaveLength(1)
    // The plugin's own dispatch hook is the one passed over; nothing else is.
    expect(skipped(set)).toEqual(['org-guard: skipped fylgja at session.compact'])
  })

  for (const [what, beneath, reason] of [
    ['a refusal of it from beneath is handed back in its own words', 'deny', 'a rule of yours'],
    ['an ask of it from beneath is refused', 'ask', 'Fylgja: this tool is the plugin’s own, for its reports about itself'],
  ] as const) {
    test(`a call of the reporting tool that is not the plugin’s own: ${what}, so the guard runs no check again`, { plugins: [GUARD] }, async ($, on) => {
      const logged: string[] = []

      on('tool.check', () => ({ decision: beneath, reason: 'a rule of yours' }))
      on('ui.log', ($$, e) => {
        logged.push(e.text)

        return { value: undefined }
      })

      expect(await $.tool.check({ tool: 'mcp__plugin_fylgja_fylgja__report_events', input: {} })).toMatchObject({ decision: 'deny', reason })
      expect(logged.filter(line => line.startsWith(SKIPPED))).toEqual([])
    })
  }

  // That the guard does pass a hook over, and logs it, is what lets the skipped == [] checks above fail.
  test('a person’s plugin that hooks what the guard holds is passed over, and the guard says so', {
    plugins: [
      GUARD,
      {
        name: 'northwind-notes',
        register(on: On) {
          on('prompt.context', ($, e, next) => next(e))
        },
      },
    ],
  }, async ($, on) => {
    const set = await kept($, on)

    await $.prompt.context({ blocks: [] } as never)

    expect(skipped(set)).toEqual([`${SKIPPED} northwind-notes at prompt.context`])
  })
})

/** The hooks the plugin registers, by event, as the engine would call them: the first of each. */
function hooksOf(): Map<string, (...args: never[]) => unknown> {
  const found = new Map<string, (...args: never[]) => unknown>()
  const on = (event: string, ...rest: unknown[]) => {
    if (!found.has(event)) {
      found.set(event, rest.at(-1) as (...args: never[]) => unknown)
    }

    return { catch: () => undefined }
  }

  register(on as unknown as On)

  return found
}

type Hook = ($: unknown, e: unknown, next: unknown) => Promise<unknown>

/** A `next` as the engine hands it, answering `value` and naming who raised the event. */
function nextOf(value: unknown, plugin: string, tier: string): unknown {
  return Object.assign(() => Promise.resolve(value), { origin: { plugin, tier } })
}

/**
 * The plugin, its session started with Fylgja connected as its own server,
 * and the three of its hooks that decide whether it lets its own calls
 * through: the permission check, the run of a call, and the lines logged.
 */
async function lifting(): Promise<{ check: (id: string) => Promise<unknown>; ran: (id: string) => Promise<unknown>; log: (by: string, tier: string, text: string) => Promise<unknown>; start: () => Promise<unknown> }> {
  const hooks = hooksOf()
  const $ = {
    mcp: { connect: () => Promise.resolve({ isConnected: true, server: 'plugin:fylgja:fylgja' }), call: () => Promise.resolve(answer(ACCOUNT)) },
    ui: { status: () => undefined, invalidate: () => undefined },
    clock: { every: () => ({ cancel: () => undefined }), now: () => Promise.resolve(0), after: () => ({ cancel: () => undefined }) },
    store: { get: () => Promise.resolve(undefined), set: () => Promise.resolve() },
    fs: { stat: () => Promise.reject(new Error('no such file')), read: () => Promise.reject(new Error('no such file')) },
    plugin: { root: '/plugin' },
  }
  const hook = (event: string): Hook => hooks.get(event) as unknown as Hook
  const start = async (): Promise<unknown> => {
    const started = await hook('session.start')($, START, (e: unknown) => e)

    // The session's start does not wait for the server's answer.
    for (let turn = 0; turn < 200; turn += 1) {
      await Promise.resolve()
    }

    return started
  }

  await start()

  return {
    // The mode's own ask, beneath, of the plugin's own call of one of its tools.
    check: async id =>
      ((await hook('tool.check')($, { tool: 'mcp__plugin_fylgja_fylgja__recall', input: {}, tool_use_id: id }, nextOf({ decision: 'ask', reason: 'core' }, 'fylgja', 'user'))) as { decision: string })
        .decision,
    ran: id => hook('tool.call')($, { tool: 'mcp__plugin_fylgja_fylgja__recall', tool_use_id: id }, nextOf({ result: {} }, 'fylgja', 'user')),
    log: (by, tier, text) => hook('ui.log')($, { text, to: 'debug' }, nextOf({ value: undefined }, by, tier)),
    start,
  }
}

// The test kit raises no permission check for a call the plugin makes itself, and none that a guard runs again
// without it: so the plugin's own hooks are run here as the engine runs them around such a call.
describe('beneath a guard that runs the plugin’s own call’s check again without it', () => {
  test('the guard’s word about it while the call is under way ends the lift for the session: every later verdict is handed back as it came', async () => {
    const plugin = await lifting()

    expect(await plugin.check('toolu_plugin_01'), 'let through, as ever').toBe('allow')

    await plugin.log('org-guard', 'prepend', 'org-guard: skipped fylgja at tool.check')
    await plugin.ran('toolu_plugin_01')

    expect(await plugin.check('toolu_plugin_02'), 'so the guard has nothing to run again, and nothing to say').toBe('ask')

    await plugin.ran('toolu_plugin_02')

    expect(await plugin.check('toolu_plugin_03')).toBe('ask')

    await plugin.start()

    expect(await plugin.check('toolu_plugin_04'), 'a new session tries once more').toBe('allow')
  })

  for (const [what, act] of [
    ['a line of a plugin that is not seated above the person’s', plugin => plugin.log('northwind-notes', 'user', 'skipped fylgja at tool.check')],
    ['a guard’s line that does not name the plugin', plugin => plugin.log('org-guard', 'prepend', 'org-guard: skipped fylgjax at tool.check')],
    ['a guard’s line once the call the plugin let through has run', async plugin => {
      await plugin.ran('toolu_plugin_01')
      await plugin.log('org-guard', 'prepend', 'org-guard: skipped fylgja at tool.check')
    }],
  ] as const satisfies readonly (readonly [string, (plugin: Awaited<ReturnType<typeof lifting>>) => Promise<unknown>])[]) {
    test(`${what} leaves the lift as it is`, async () => {
      const plugin = await lifting()

      expect(await plugin.check('toolu_plugin_01')).toBe('allow')

      await act(plugin)

      expect(await plugin.check('toolu_plugin_02')).toBe('allow')
    })
  }
})

// What an image holds never leaves the machine by the plugin's hand. The engine's own reads of an attachment's
// bytes (`$.prompt.media`) are not something the test kit can stand in for: no file of the plugin's names it, and
// no host it hands its other files has a way to it. The rest is held here, by what the plugin does.

/** The upload's shape has no field for the words in the image: one could not be sent if it were wanted. */
type HasQuote = 'quote' extends keyof Upload ? true : false
const UPLOAD_HAS_QUOTE: HasQuote = false

/** An image as the conversation's rows would carry it inline: what must never reach a call to Fylgja. */
const INLINE = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA${'Q'.repeat(700)}`

describe('the images a developer pastes stay on the machine', () => {
  test('Scribe never forks, and never reads the conversation as the API takes it', async ($, on) => {
    const set = skuld(on, { wake: () => verdict({ records: [decision()] }) })

    await $.session.start(START)
    await turn($, set, dev('lock the queue with Postgres'), claude('Done.', edit('src/queue/lock.ts')))

    expect(set.of('remember'), 'a look was made').toHaveLength(1)
    expect(set.forks).toEqual([])
    expect(set.shapes.filter(shape => shape === 'api')).toEqual([])
  })

  test('the only fork is the image reader’s, and nothing of an image reaches a call to Fylgja', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    set.rows.push(dev(INLINE))
    await reported($, on, set)
    await pressTwice($, 'keep')
    await endTurn($, set, 'turn-next')

    expect(set.forks).toEqual([FORK_PROMPT])
    expect(set.shapes.filter(shape => shape === 'api')).toEqual([])
    expect(set.of('remember')).toHaveLength(1)

    const sent = JSON.stringify([...set.calls, ...set.reports])

    expect(sent).not.toContain('iVBORw0KGgo')
    expect(sent).not.toContain('data:image/')
    expect(sent).not.toContain(QUOTE)
  })

  test('no upload carries the words in the image', async ($, on) => {
    const set = skuld(on)

    await $.session.start(START)
    await reported($, on, set)

    expect(UPLOAD_HAS_QUOTE).toBe(false)
    expect(set.of('save_image_reading').map(args => Object.keys(args).filter(key => key === 'quote'))).toEqual([[]])
  })

  test('a fork reply carrying a base64 run is stopped before it is held: nothing of it is sent, logged or asked', async ($, on) => {
    const set = skuld(on, { forks: () => ({ text: readingReply({ quote: INLINE.slice(22) }) }) })

    await $.session.start(START)
    await reported($, on, set)
    await endTurn($, set, 'turn-next')

    expect(set.forks).toHaveLength(1)
    expect(set.of('save_image_reading')).toEqual([])
    expect(JSON.stringify([...set.kept.values(), ...set.calls])).not.toContain('iVBORw0KGgo')
    expect(await shown($)).not.toContain('Expected')
  })
})
