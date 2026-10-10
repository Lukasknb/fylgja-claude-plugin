/**
 * The hooks module of a replay: a recorded session is put through Scribe's
 * own code turn by turn, as if it were happening, to see what Scribe would
 * have done. It stands where the plugin's own module stands, in a copy of
 * the plugin made for the run.
 *
 * Claude Code has no call that hands a session rows it did not produce, so
 * the recorded rows cannot be made a real session's without running the
 * main model again. This module does what the plugin's own hooks do, in
 * their order, on Scribe's modules as shipped: a prompt is sent, each step's
 * tool calls are noted, the turn ends. What is the shipped code: reading the
 * rows, the delta, plan documents, the limits on wakes, the wake itself, the
 * checks on the verdict, the writes, the correction after a refusal, and the
 * band's rules. What is real: Scribe's model calls and the calls to the
 * server, which is the stand-in on this machine. What is stood in for: the
 * rows (built from the recording by `transcript.ts`), the session's facts,
 * the clock between turns (the recording's own times), the person at the
 * band, and everything of the plugin outside Scribe (its hook wiring, the
 * account check, the chips).
 *
 * `/scribe-replay <session.json> <out.json> <policy> <max-wakes> <max-calls> <dry|live>`
 */

import type { EngineInterface, On } from 'claude-code'

import * as Band from '../../hooks/scribe/band'
import { choicesOf } from '../../hooks/scribe/delta'
import type { Row } from '../../hooks/scribe/delta'
import { REFUSED, verdictFor } from '../../hooks/scribe/grant'
import * as Scribe from '../../hooks/scribe/scribe'
import type { ScribeHost } from '../../hooks/scribe/scribe'
import { labelOf } from './transcript'
import type { Turn } from './transcript'

/** The session as `replay-read.mjs` wrote it. */
type Session = {
  sessionId: string
  repo: { root: string; remote: string | null } | null
  /** The working trees the session's files lie in, as the machine had them when the recording was read: each root, and its remote. */
  trees: Record<string, string | null>
  turns: Turn[]
}

/**
 * What the person at the band does. `none`: nothing, and no typing is seen;
 * prompts simply arrive. `ignore`: they type each prompt and never press a
 * key. `answer`: every question is answered, with "No particular reason" and
 * Skip in turn, and every tell is dismissed.
 */
type Policy = 'none' | 'ignore' | 'answer'

type Call = { tool: string; args: Record<string, unknown>; isRefused: boolean; outcome: string | null }

type Step = {
  n: number
  kind: Turn['kind']
  at: number
  label: string
  /** Sizes of what the turn holds: characters of prompt and replies, and tool calls. */
  chars: number
  tools: number
  isWoken: boolean
  modelCalls: number
  ms: number
  /** Characters handed to the model in this turn, system and prompt, all calls together. */
  sent: number
  /** Of those, the characters that are not the standing instruction: the turn, what came before in brief, plans and records. */
  delta: number
  /** What the first call of the turn's wake weighed, part by part, in characters. */
  weights: { instruction: number; plans: number; history: number; turn: number } | null
  /** Whether the turn was worth a look and got none because the hour's share of wakes was used up. */
  isCapped: boolean
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number }
  records: Record<string, unknown>[]
  /** Scribe's own records of the session that it rewrote in place, and the ids of those it took back. */
  updated: Record<string, unknown>[]
  withdrawn: string[]
  /** Places added later to one of Scribe's own records: the record, and the paths. */
  anchored: { id: string; paths: string[] }[]
  refused: number
  corrected: number
  lost: number
  questions: { form: string; text: string; options: string[]; prior: string | null }[]
  tells: { id: string; text: string }[]
  /** What the developer chose in the turn when Claude put a question to them: each question, what was offered, what they chose. */
  chose: { question: string; offered: string[]; chosen: string }[]
  /** How many plans they approved in it. */
  approved: number
  /** What the band showed when the turn was over. */
  shown: string | null
  keys: string[]
}

type Outcome = {
  policy: Policy
  isDry: boolean
  /** Why nothing was replayed, when nothing was. */
  off: string | null
  steps: Step[]
  /** Turns not replayed because a limit of the run was reached, and which. */
  skipped: number
  stopped: string | null
  wakes: number
  modelCalls: number
  calls: Call[]
  counters: Record<string, number>
  notes: string[]
  error: string | null
}

const SILENT = '{"outcome":"nothing"}'

// How the parts of a request open, as `prompt.ts` writes them: the plan documents, and what stands for earlier wakes.
const PLANS = /^The plan documents\b/
const HISTORY = /^(?:Earlier wake \d|Before the wakes below|What you settled earlier)/

/** The recording's own time: it jumps from turn to turn and runs on between. */
type Clock = { at: number; since: number; timers: { due: number; fire: () => void; stop: () => void; isDone: boolean }[] }

function nowOf(clock: Clock): number {
  return clock.at + (performance.now() - clock.since)
}

/** The next turn began at `to`: what was set to happen before then happens now. */
function jump(clock: Clock, to: number): void {
  if (to > nowOf(clock)) {
    clock.at = to
    clock.since = performance.now()
  }

  for (const timer of clock.timers.filter(one => !one.isDone && one.due <= to)) {
    timer.fire()
  }

  clock.timers = clock.timers.filter(one => !one.isDone)
}

type World = {
  session: Session
  server: string
  rows: Row[]
  cwd: string
  kept: Map<string, unknown>
  clock: Clock
  outcome: Outcome
  step: Step | undefined
  maxCalls: number
  clockFile: string
}

function hostOf($: EngineInterface, world: World): ScribeHost {
  const { outcome, clock } = world
  const call = (tool: string, args: Record<string, unknown>): Promise<unknown> => {
    const made: Call = { tool, args, isRefused: false, outcome: null }

    outcome.calls.push(made)

    return $.mcp.call(world.server, tool, args).then(
      result => {
        made.isRefused = result.isError === true

        const text = result.content.map(block => ('text' in block && typeof block.text === 'string' ? block.text : '')).join('')

        // The stand-in's own word for what it did, or the code its refusal opens with.
        made.outcome = made.isRefused
          ? (/^refused:([a-z_]+)/.exec(text)?.[1] ?? 'refused')
          : (/"outcome":"([a-z_]+)"/.exec(text)?.[1] ?? null)

        if (tool === 'amend_memory' && world.step !== undefined && !made.isRefused) {
          if (args.op === 'remove') {
            world.step.withdrawn.push(String(args.atom_id))
          } else if (args.content === undefined && Array.isArray(args.anchors)) {
            world.step.anchored.push({
              id: String(args.atom_id),
              paths: args.anchors.map(anchor => String((anchor as { path?: unknown }).path)),
            })
          } else {
            world.step.updated.push(args)
          }
        }

        if (tool === 'remember' && world.step !== undefined) {
          if (made.isRefused) {
            world.step.refused += 1
          } else {
            // With the id the stand-in gave it, so that a later change to it can be told.
            world.step.records.push({ ...args, id: /"atom_id":"([0-9a-f-]+)"/.exec(text)?.[1] ?? null })
          }
        }

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
      const sent = [...request.system, ...request.prompt].reduce((sum, part) => sum + part.text.length, 0)

      if (world.step !== undefined) {
        world.step.sent += sent
        world.step.delta += request.prompt.reduce((sum, part) => sum + part.text.length, 0)
        world.step.weights ??= {
          instruction: request.system.reduce((sum, part) => sum + part.text.length, 0),
          plans: request.prompt.filter(part => PLANS.test(part.text)).reduce((sum, part) => sum + part.text.length, 0),
          history: request.prompt.filter(part => HISTORY.test(part.text)).reduce((sum, part) => sum + part.text.length, 0),
          turn: request.prompt.at(-1)?.text.length ?? 0,
        }
        world.step.modelCalls += 1
      }

      outcome.modelCalls += 1

      // A dry run asks no model: every look comes back with nothing to do.
      if (outcome.isDry) {
        return { text: SILENT, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
      }

      if (outcome.modelCalls > world.maxCalls) {
        outcome.stopped = `the run's limit of ${world.maxCalls} model calls`
        throw new Error('over the limit of the run')
      }

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

      if (world.step !== undefined) {
        world.step.ms += Math.round(performance.now() - started)
        world.step.usage.input += usage.input
        world.step.usage.output += usage.output
        world.step.usage.cacheRead += usage.cacheRead
        world.step.usage.cacheWrite += usage.cacheWrite
      }

      return { text: reply.isAnswered ? reply.text : undefined, usage }
    },
    now: () => Promise.resolve(nowOf(clock)),
    after: (ms, fn) => {
      const timer = { due: nowOf(clock) + ms, isDone: false, fire: (): void => undefined, stop: (): void => undefined }
      const real = $.clock.after(ms, () => timer.fire())

      timer.stop = () => {
        timer.isDone = true
        real.cancel()
      }
      timer.fire = () => {
        if (!timer.isDone) {
          timer.stop()
          fn()
        }
      }
      clock.timers.push(timer)

      return { cancel: timer.stop }
    },
    redraw: () => undefined,
    toast: () => undefined,
    status: text => {
      if (text !== undefined) {
        outcome.counters.statusLines = (outcome.counters.statusLines ?? 0) + 1
      }
    },
    // Scribe's own notes for the debug log hold no word of the session; they are kept as the run's notes.
    debug: text => {
      outcome.notes.push(text)
    },
    box: () => Promise.resolve(''),
    fill: () => Promise.resolve(true),
    stored: key => Promise.resolve(world.kept.get(key)),
    store: (key, value) => {
      world.kept.set(key, value)

      return Promise.resolve()
    },
    sessionId: () => Promise.resolve(world.session.sessionId),
    repo: () => Promise.resolve(world.session.repo),
    cwd: () => Promise.resolve(world.cwd),
    exists: path =>
      Promise.resolve(
        path.endsWith('/.git') &&
          (path.slice(0, -5) === world.session.repo?.root || Object.hasOwn(world.session.trees, path.slice(0, -5))),
      ),
    // What git keeps about a tree, as far as Scribe reads it: the address of its origin.
    read: path => {
      const root = path.endsWith('/.git/config') ? path.slice(0, -12) : undefined
      const remote = root === undefined ? undefined : world.session.trees[root]

      return root === undefined || !Object.hasOwn(world.session.trees, root)
        ? Promise.reject(new Error('not read'))
        : Promise.resolve(remote === null || remote === undefined ? '' : `[remote "origin"]\n\turl = ${remote}\n`)
    },
    // No project configuration is read here: the stand-in is the only server there is.
    vouched: () => Promise.resolve(true),
    surfaces: () => Promise.resolve(['terminal']),
    rows: () => Promise.resolve(world.rows),
    destination: () => undefined,
  }
}

function lineOf(scribe: Scribe.Scribe): string | null {
  const view = Scribe.view(scribe, false)

  return view === undefined
    ? null
    : view.rows
        .map(row => row.parts.map(part => ('text' in part ? part.text : part.label)).join(''))
        .join(' / ')
        .slice(0, 300)
}

/** Notes every question and tell that is in the band's line and was not there before. */
function noteItems(scribe: Scribe.Scribe, seen: Set<Band.Item>, step: Step, shown: Set<Band.Item>): void {
  const { band } = scribe

  if (band.current !== null) {
    shown.add(band.current)
  }

  for (const item of [...(band.current === null ? [] : [band.current]), ...band.queue]) {
    if (seen.has(item)) {
      continue
    }

    seen.add(item)

    if (item.kind === 'tell') {
      step.tells.push({ id: item.fact.id, text: item.fact.content })
    } else if (item.form === 'reason') {
      step.questions.push({ form: 'reason', text: item.content, options: item.options, prior: null })
    } else {
      step.questions.push({ form: 'reversal', text: item.draft.content, options: item.options, prior: item.prior.content })
    }
  }
}

async function play(
  $: EngineInterface,
  session: Session,
  server: string,
  policy: Policy,
  maxWakes: number,
  maxCalls: number,
  isDry: boolean,
  clockFile: string,
): Promise<Outcome> {
  const outcome: Outcome = {
    policy,
    isDry,
    off: null,
    steps: [],
    skipped: 0,
    stopped: null,
    wakes: 0,
    modelCalls: 0,
    calls: [],
    counters: {},
    notes: [],
    error: null,
  }
  const clock: Clock = { at: session.turns[0]?.at ?? 0, since: performance.now(), timers: [] }
  const world: World = {
    session,
    server,
    rows: [],
    cwd: session.turns[0]?.cwd ?? session.repo?.root ?? '/',
    // A machine that has seen Scribe before, so "What is this" is not in the way.
    kept: new Map([['scribe.hasShown', true]]),
    clock,
    outcome,
    step: undefined,
    maxCalls,
    clockFile,
  }
  const host = hostOf($, world)
  const scribe = Scribe.create({ isOn: true })
  const seen = new Set<Band.Item>()
  const shown = new Set<Band.Item>()
  let answers = 0

  try {
    Scribe.started(scribe, true, 'terminal')

    for (const [at, turn] of session.turns.entries()) {
      if (scribe.wakes >= maxWakes || outcome.stopped !== null) {
        outcome.stopped ??= `the limit of ${maxWakes} wakes`
        outcome.skipped = session.turns.length - at
        break
      }

      jump(clock, turn.at)
      world.cwd = turn.cwd ?? world.cwd
      // The stand-in server counts its burst rule by the session's time, not by this machine's.
      await $.fs.write(world.clockFile, String(Math.round(nowOf(clock))))

      const step: Step = {
        n: at + 1,
        kind: turn.kind,
        at: turn.at,
        label: labelOf(turn),
        chars: turn.rows.reduce((sum, row) => sum + row.text.length, 0),
        tools: turn.rows.reduce((sum, row) => sum + row.toolUses.length, 0),
        isWoken: false,
        modelCalls: 0,
        ms: 0,
        sent: 0,
        delta: 0,
        weights: null,
        isCapped: false,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        records: [],
        updated: [],
        withdrawn: [],
        anchored: [],
        refused: 0,
        corrected: 0,
        lost: 0,
        questions: [],
        tells: [],
        chose: turn.rows.flatMap(row =>
          row.toolUses.flatMap(use =>
            use.tool === 'AskUserQuestion' && use.isError !== true
              ? choicesOf(use.input, use.text).map(choice => ({
                  question: choice.question,
                  offered: choice.offered.map(
                    option => `${option.label}${option.description === '' ? '' : ` (${option.description})`}`,
                  ),
                  chosen: choice.chosen,
                }))
              : [],
          ),
        ),
        approved: turn.rows.reduce(
          (sum, row) =>
            sum +
            row.toolUses.filter(use => use.tool === 'ExitPlanMode' && use.isError !== true && use.text !== undefined).length,
          0,
        ),
        shown: null,
        keys: [],
      }

      outcome.steps.push(step)
      world.step = step

      if (turn.kind === 'clear') {
        Scribe.startOver(scribe)
        world.rows = []
        continue
      }

      if (turn.kind === 'compact') {
        // What came before is now one row that sums it up, as a session's own rows are after a compaction.
        world.rows = [...turn.rows]
        continue
      }

      const before = { wakes: scribe.wakes, corrections: scribe.corrections, dropped: scribe.dropped }

      if (turn.kind === 'prompt') {
        if (policy === 'ignore') {
          Scribe.typed(host, scribe, turn.prompt.slice(0, 1) || 'x')
        }

        Scribe.prompted(host, scribe, turn.prompt)

        if (policy === 'ignore') {
          Scribe.typed(host, scribe, '')
        }
      }

      // The rows arrive as the turn runs, and each step of Claude's names its tool calls, as the plugin's own hook is told them.
      let index = 0

      for (const row of turn.rows) {
        world.rows.push(row)

        if (row.role === 'assistant') {
          await Scribe.stepped(
            host,
            scribe,
            index,
            row.toolUses.map(use => ({ name: use.tool, input: use.input })),
          )
          index += 1
        }
      }

      await Scribe.completed(host, scribe)

      // The first turn settles whether Scribe runs here at all.
      if (scribe.identity === null) {
        outcome.off = session.repo === null ? 'the session is not in a repository' : 'Scribe is off for this session'
        outcome.skipped = session.turns.length - at - 1
        break
      }

      noteItems(scribe, seen, step, shown)

      if (policy === 'answer') {
        for (let acts = 0; acts < 8 && scribe.band.current !== null && scribe.band.editing === null; acts += 1) {
          const { current } = scribe.band
          const key = current.kind === 'tell' ? 'dismiss' : current.form === 'reason' && answers % 2 === 0 ? 'no-reason' : 'skip'

          answers += current.kind === 'question' ? 1 : 0
          step.keys.push(key)
          await Scribe.pressed(host, scribe, key)

          // A key that settles something for good acts on its second press.
          if (key === 'no-reason') {
            await Scribe.pressed(host, scribe, key)
          }

          noteItems(scribe, seen, step, shown)
        }
      }

      step.isWoken = scribe.wakes > before.wakes || step.modelCalls > 0
      step.isCapped =
        !step.isWoken &&
        scribe.hasPrompt &&
        scribe.wakeTimes.filter(began => nowOf(clock) - began < 3_600_000).length >= Scribe.MAX_WAKES_PER_HOUR
      step.corrected = scribe.corrections - before.corrections
      step.lost = scribe.dropped - before.dropped
      step.shown = lineOf(scribe)
    }
  } catch (error) {
    outcome.error = error instanceof Error ? error.name : 'error'
  }

  const { band } = scribe

  outcome.wakes = scribe.wakes
  outcome.counters = {
    ...outcome.counters,
    questions: band.questions,
    maxQuestions: Band.MAX_QUESTIONS,
    unanswered: band.unanswered,
    maxUnanswered: Band.MAX_UNANSWERED,
    tellsOffered: band.told.size,
    receipts: band.receipts,
    itemsShown: shown.size + band.receipts,
    waiting: band.queue.length + (band.current === null ? 0 : 1),
    heldBack: band.held.length,
    pushedOut: band.overflow.length,
    typedPast: band.kept.typedPast,
    skipsOwed: band.kept.skip,
    refusedWrites: scribe.refused,
    corrections: scribe.corrections,
    lost: scribe.dropped,
    stillDeferred: scribe.deferred.length,
    plans: scribe.plans.docs.length,
    lateAnchors: scribe.lateAnchors,
    comparedWithRecorded: scribe.compared,
    foundContradicting: scribe.opposed,
    reasonsLookedFor: scribe.checked,
    reasonsFound: scribe.found,
    notPlaced: scribe.unplaced,
    hourlyCeilingHit: outcome.notes.some(note => note.includes('wakes in the last hour')) ? 1 : 0,
  }

  for (const timer of clock.timers) {
    timer.stop()
  }

  return outcome
}

export function register(on: On): void {
  const own: { server: string | undefined } = { server: undefined }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'scribe-replay', description: 'Puts a recorded session through Scribe.' })

    return next(e)
  })

  // The plugin's own rule, as its own module holds it.
  on('tool.check', async ($, e, next) => verdictFor(await next(e), e, next.origin?.plugin, own.server)).catch(
    async ($, e, next) => verdictFor(await next(e), e, next.origin?.plugin, own.server),
  )

  on('command.run', { command: 'scribe-replay' }, async ($, e) => {
    const [from = '', to = '', policy = 'none', maxWakes = '40', maxCalls = '120', mode = 'live'] = e.args.trim().split(/\s+/)
    // The turns lie beside the session's own file, in parts small enough for the engine to read.
    const head = JSON.parse(await $.fs.read(from)) as {
      sessionId: string
      repo: Session['repo']
      trees?: Session['trees']
      parts: number
    }
    const session: Session = { sessionId: head.sessionId, repo: head.repo, trees: head.trees ?? {}, turns: [] }

    for (let part = 0; part < head.parts; part += 1) {
      session.turns.push(...(JSON.parse(await $.fs.read(from.replace(/\.json$/, `-${part}.json`))) as Turn[]))
    }
    const connection = await $.mcp.connect('fylgja')

    if (!connection.isConnected) {
      return { text: 'the stand-in server is not connected' }
    }

    own.server = connection.server

    const outcome = await play(
      $,
      session,
      connection.server,
      policy === 'ignore' || policy === 'answer' ? policy : 'none',
      Number(maxWakes),
      Number(maxCalls),
      mode === 'dry',
      to.replace(/[^/]*$/, 'clock'),
    )

    await $.fs.write(to, JSON.stringify(outcome))

    return { text: `replayed ${outcome.steps.length} turns, ${outcome.wakes} wakes, ${outcome.modelCalls} model calls` }
  })
}
