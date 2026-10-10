/**
 * The hooks module of the scenario run. It stands where the plugin's own
 * module stands, in a copy of the plugin made for the run, and drives the
 * very code Scribe runs in a session: the same wake, the same checks on the
 * verdict, the same writes and the same band rules.
 *
 * What is real: the model (the person's own plan), the calls to the server
 * (a stand-in on this machine, under the plugin's own server name) and the
 * permission check that lets those calls through. What is scripted: the
 * conversation, the session's facts, and the developer's keys.
 *
 * `/scribe-scenarios <model> <run> <scenarios.json> <out.json>` runs every
 * scenario once and writes what happened after each.
 */

import type { EngineInterface, On } from 'claude-code'

import { observe, plain } from '../../hooks/scribe/delta'
import type { Row } from '../../hooks/scribe/delta'
import { REFUSED, verdictFor } from '../../hooks/scribe/grant'
import * as Scribe from '../../hooks/scribe/scribe'
import type { ScribeHost } from '../../hooks/scribe/scribe'
import * as Session from '../../hooks/session'
import type { Host } from '../../hooks/host'

type Act = { whenQuestion?: string; whenEditing?: boolean; press?: string; enter?: [string, string] }
type Scenario = { id: string; repo: string; turns: { rows: Row[]; then?: Act[] }[] }

/** What one run of one scenario did. Session text is the scenario's own script. */
type Outcome = {
  id: string
  model: string
  run: number
  calls: { tool: string; args: Record<string, unknown>; isRefused?: boolean }[]
  /** What the band showed after each turn and each key. */
  shown: { turn: number; kind: string; text: string }[]
  modelCalls: number
  ms: number
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number }
  fills: number
  /** Records handed back to the model once after a refusal, and those lost after it. */
  corrections: number
  dropped: number
  /** How many turns ended, each a chance for a wake. */
  wakes: number
  /** The head of each reply of the model, to see why a run went as it did. The sessions are scripted, so nothing of anyone's is in them. */
  replies: string[]
  /** How many times a line was put on the status line. */
  statuses: number
  error?: string
}

type World = { scenario: Scenario; run: number; server: string; rows: Row[]; kept: Map<string, unknown>; outcome: Outcome }

const ROOT = '/work/app'

function hostOf($: EngineInterface, world: World): ScribeHost {
  const { outcome } = world
  const call = (tool: string, args: Record<string, unknown>): Promise<unknown> => {
    const made: Outcome['calls'][number] = { tool, args }

    outcome.calls.push(made)

    return $.mcp.call(world.server, tool, args).then(
      result => {
        // What the server itself turned down is told from what it did.
        made.isRefused = result.isError === true

        return result
      },
      (error: unknown) => {
        throw new Error(error instanceof Error && /refused|requested permissions/i.test(error.message) ? REFUSED : 'failed')
      },
    )
  }

  return {
    server: () => Promise.resolve(world.server),
    call: (server, tool, args) => call(tool, args),
    lookup: call,
    complete: async request => {
      const started = performance.now()
      const reply = await $.model.complete({
        model: request.model,
        system: request.system,
        prompt: request.prompt,
        maxTokens: request.maxTokens,
        effort: 'low',
        timeoutMs: request.timeoutMs,
      })
      const usage = {
        input: reply.usage.input_tokens,
        output: reply.usage.output_tokens,
        cacheRead: reply.usage.cache_read_input_tokens ?? 0,
        cacheWrite: reply.usage.cache_creation_input_tokens ?? 0,
      }

      outcome.modelCalls += 1
      outcome.replies.push(reply.isAnswered ? reply.text.slice(0, 600) : `(${reply.reason})`)
      outcome.ms += Math.round(performance.now() - started)
      outcome.usage.input += usage.input
      outcome.usage.output += usage.output
      outcome.usage.cacheRead += usage.cacheRead
      outcome.usage.cacheWrite += usage.cacheWrite

      return { text: reply.isAnswered ? reply.text : undefined, usage }
    },
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
    redraw: () => undefined,
    toast: () => undefined,
    status: text => {
      outcome.statuses += text === undefined ? 0 : 1
    },
    debug: () => undefined,
    box: () => Promise.resolve(''),
    fill: () => {
      outcome.fills += 1

      return Promise.resolve(true)
    },
    stored: key => Promise.resolve(world.kept.get(key)),
    store: (key, value) => {
      world.kept.set(key, value)

      return Promise.resolve()
    },
    sessionId: () => Promise.resolve(`scenario-${world.scenario.id}-${world.run}`),
    repo: () => Promise.resolve({ root: ROOT, remote: `git@github.com:${world.scenario.repo}.git` }),
    cwd: () => Promise.resolve(ROOT),
    exists: path => Promise.resolve(path === `${ROOT}/.git`),
    surfaces: () => Promise.resolve(['terminal']),
    rows: () => Promise.resolve(world.rows),
    destination: () => undefined,
  }
}

/** The plugin's own calls for the check of its connection, as its own module binds them. */
function probeHostOf($: EngineInterface, said: string[], kept: Map<string, unknown>, own: { server: string | undefined }): Host {
  return {
    connect: async () => {
      const connection = await $.mcp.connect('fylgja')

      // What the permission rule goes by, as the plugin's own session keeps it.
      own.server = connection.isConnected ? connection.server : undefined

      return connection
    },
    call: (server, tool, args) => $.mcp.call(server, tool, args),
    // The probe runs inside the command's own hook, which Claude Code waits on.
    isLive: () => true,
    status: text => {
      if (text !== undefined) {
        said.push(text)
      }
    },
    redraw: () => undefined,
    every: (ms, fn) => $.clock.every(ms, fn),
    cwd: () => $.session.cwd(),
    exists: path =>
      $.fs.stat(path).then(
        () => true,
        () => false,
      ),
    read: path => $.fs.read(path),
    declared: () => $.fs.read(`${$.plugin.root}/.mcp.json`),
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
    // The pin is kept in the run's own memory, never on the machine.
    stored: key => Promise.resolve(kept.get(key)),
    store: (key, value) => {
      kept.set(key, value)

      return Promise.resolve()
    },
  }
}

/** What the band shows, as one line and the kind of thing it is. */
function look(scribe: Scribe.Scribe, turn: number): { turn: number; kind: string; text: string } | undefined {
  const view = Scribe.view(scribe, false)

  if (view === undefined) {
    return undefined
  }

  const keys = [...view.keys, ...view.rows.flatMap(row => row.keys ?? [])].map(key => key.key)
  const { current } = scribe.band
  const kind =
    scribe.band.editing !== null
      ? 'field'
      : current?.kind === 'question'
        ? `question-${current.form}`
        : current?.kind === 'tell'
          ? 'tell'
          : keys.includes('ok')
            ? 'receipt'
            : 'other'
  const text = view.rows.map(row => row.parts.map(part => ('text' in part ? part.text : part.label)).join('')).join(' / ')

  return { turn, kind, text }
}

async function play(
  $: EngineInterface,
  scenario: Scenario,
  model: 'sonnet' | 'haiku',
  run: number,
  server: string,
): Promise<Outcome> {
  const outcome: Outcome = {
    id: scenario.id,
    model,
    run,
    calls: [],
    shown: [],
    modelCalls: 0,
    ms: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    fills: 0,
    corrections: 0,
    dropped: 0,
    wakes: 0,
    replies: [],
    statuses: 0,
  }
  // A machine that has seen Scribe before, so "What is this" is not in the way.
  const world: World = { scenario, run, server, rows: [], kept: new Map([['scribe.hasShown', true]]), outcome }
  const host = hostOf($, world)
  const scribe = Scribe.create({ isOn: true })

  // A scenario run may compare models; a session always uses the one Scribe ships with.
  scribe.model = model
  const note = (turn: number): void => {
    const seen = look(scribe, turn)

    if (seen !== undefined && outcome.shown.at(-1)?.text !== seen.text) {
      outcome.shown.push(seen)
    }
  }

  try {
    Scribe.started(scribe, true, 'terminal')

    for (const [turn, step] of scenario.turns.entries()) {
      // As in a session, each prompt of the developer's begins a turn of its
      // own: it is sent from the prompt box, the rows up to their next prompt
      // follow, and the turn ends.
      const starts = step.rows.flatMap((row, at) => (row.role === 'user' && row.text !== '' ? [at] : []))

      for (const [nth, from] of starts.entries()) {
        const first = step.rows[from]

        outcome.wakes += 1
        Scribe.prompted(host, scribe, first?.text ?? '')
        world.rows.push(...step.rows.slice(from, starts[nth + 1]))
        await Scribe.completed(host, scribe)
        note(turn)

        // What the developer does at the band when this turn's end brings something up.
        for (const act of step.then ?? []) {
          const { current, editing } = scribe.band
          const isMeant =
            act.whenEditing === true
              ? editing !== null
              : current?.kind === 'question' && current.form === act.whenQuestion && editing === null

          if (!isMeant) {
            continue
          }

          if (act.press !== undefined) {
            await Scribe.pressed(host, scribe, act.press)
          } else if (act.enter !== undefined) {
            await Scribe.entered(host, scribe, act.enter[0], act.enter[1])
          }

          note(turn)
        }
      }

      // Everything still waiting is looked at, as a developer who dismisses each would see it.
      for (let waiting = 0; waiting < 6 && scribe.band.current !== null; waiting += 1) {
        await Scribe.pressed(host, scribe, scribe.band.current.kind === 'tell' ? 'dismiss' : 'skip')
        note(turn)
      }
    }
  } catch (error) {
    outcome.error = error instanceof Error ? error.name : 'error'
  }

  outcome.corrections = scribe.corrections
  outcome.dropped = scribe.dropped

  return outcome
}

export function register(on: On): void {
  // The name the engine answered for the plugin's own server, and the prompts that entered.
  const own: { server: string | undefined; prompts: Set<string> } = { server: undefined, prompts: new Set() }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'scribe-scenarios', description: 'Runs Scribe over the scripted scenarios.' })

    return next(e)
  })

  // The plugin's own rule, as its own module holds it.
  on('tool.check', async ($, e, next) => verdictFor(await next(e), e, next.origin?.plugin, own.server)).catch(
    async ($, e, next) => verdictFor(await next(e), e, next.origin?.plugin, own.server),
  )

  // Every prompt that enters, to see that the conversation's rows hold it as it was sent.
  on('prompt.submit', ($, e, next) => {
    own.prompts.add(plain(e.text))

    return next(e)
  }).catch(($, e, next) => next(e))

  // With SCRIBE_PROBE naming a file, the end of a real turn leaves there what
  // the conversation's rows hold for each tool call, and what a session says
  // of itself: the facts Scribe builds on, as this build of Claude Code has them.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const to = await $.env.get('SCRIBE_PROBE')

    if (to !== undefined && to !== '' && e.agentId === undefined) {
      const rows = await $.session.messages()
      const seen = observe(rows, await $.session.cwd(), own.prompts)

      await $.fs.write(
        to,
        JSON.stringify(
          {
            repo: await $.session.repo(),
            cwd: await $.session.cwd(),
            root: await $.session.root(),
            surfaces: await $.session.surfaces(),
            rows: rows.map(row => ({
              role: row.role,
              text: row.text.slice(0, 60),
              toolUses: row.toolUses.map(use => ({
                tool: use.tool,
                input: Object.fromEntries(Object.entries(use.input).map(([key, value]) => [key, String(value).slice(0, 60)])),
                text: use.text?.slice(0, 120),
                isError: use.isError,
              })),
            })),
            seen: {
              lines: seen.lines,
              touched: seen.touched,
              commits: seen.commits,
              plans: seen.plans.map(plan => Object.keys(plan)),
            },
          },
          null,
          1,
        ),
      )
    }

    return done
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'scribe-scenarios' }, async ($, e) => {
    const [model = 'haiku', run = '1', from = '', to = '', pinned = ''] = e.args.trim().split(/\s+/)
    const scenarios = JSON.parse(await $.fs.read(from)) as Scenario[]
    // With no scenario to run: what the plugin's own check of the connection
    // comes to in this project, and, where it holds, who served its call.
    if (scenarios.length === 0) {
      const said: string[] = []
      const session = Session.create()

      Session.located(session, await $.session.cwd())

      // A fifth word seeds the pin with another account than the stand-in answers, as a machine set up for someone else.
      const kept = new Map<string, unknown>(
        pinned === '' ? [] : [['fylgja.account', { user: pinned, team: null, profile: pinned }]],
      )
      const server = await Session.serverOf(probeHostOf($, said, kept, own), session, true)

      const served =
        server === undefined
          ? 'no call made'
          : await $.mcp.call(server, 'recall', { repo: 'x/y', paths: ['README.md'] }).then(
              result => JSON.stringify(result.content).slice(0, 120),
              () => 'refused',
            )

      return { text: `own=${server ?? 'no'} account=${session.account.state} status=${said.at(-1) ?? 'none'} served=${served}` }
    }

    const connection = await $.mcp.connect('fylgja')

    if (!connection.isConnected) {
      return { text: 'the stand-in server is not connected' }
    }

    own.server = connection.server

    const outcomes: Outcome[] = []

    for (const scenario of scenarios) {
      outcomes.push(await play($, scenario, model === 'sonnet' ? 'sonnet' : 'haiku', Number(run), connection.server))
      await $.fs.write(to, JSON.stringify(outcomes))
    }

    return { text: `ran ${outcomes.length} scenarios on ${model}` }
  })
}
