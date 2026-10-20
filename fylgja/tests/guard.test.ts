import type { On, TraceEntry } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'

import { register } from '../hooks/register'
import type { Row } from '../hooks/scribe/delta'
import { endedBy, idOf, SESSION_ID } from './fixtures'
import { claude, decision, dev, edit, NOTHING, press, QUIET, shown, stage, START, turn, verdict } from './scribe-fixtures'
import type { Stage } from './scribe-fixtures'
import { frame, pane } from './window-fixtures'

/**
 * The events an organization's guard, seated ahead of a person's plugins,
 * sends on past them, so that Claude Code says each hook of theirs there was
 * skipped. `tool.describe` is on its list only for a tool an organization
 * provides, and `tool.check` only where a person's plugin loosened the
 * verdict it was handed.
 */
const HELD = [
  /^classic\./,
  /^prompt\.(?:section|context|attachment|compose)$/,
  /^skill\.prompt$/,
  /^attribution\.text$/,
  /^session\.(?:append|compact)$/,
  /^settings\.read$/,
  /^command\.describe$/,
  /^agent\.(?:offer|spawn)$/,
  /^tool\.(?:register|list)$/,
  /^ui\.log$/,
  /^env\.(?:get|set)$/,
  /^plugin\.register$/,
]

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
  test('the plugin hooks none of the events the guard sends on past a person’s plugins', () => {
    const events: string[] = []
    const on = (event: string) => {
      events.push(event)

      return { catch: () => undefined }
    }

    register(on as unknown as On)

    expect(events.filter(event => HELD.some(held => held.test(event)))).toEqual([])
  })

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

  test('after a compaction the next prompt carries what the session kept, once, and the guard passes no hook of the plugin’s over', { plugins: [GUARD] }, async ($, on) => {
    const set = await kept($, on)
    const done = await $.session.compact({ trigger: 'manual', messages: [...set.rows] } as never)

    set.rows.splice(0, set.rows.length, ...(done.messages as unknown as Row[]))
    set.window.hasReading = false
    await $.prompt.context({ blocks: [] } as never)
    await turn($, set, ...MORE)

    expect(set.beside.at(-1)?.[0]).toMatch(/^This conversation was compacted\. Before that, this session saved 2 records/)

    await turn($, set, dev('and on'), claude('Sure.'))

    expect(set.beside.at(-1)).toBeUndefined()
    expect(skipped(set)).toEqual([])
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
