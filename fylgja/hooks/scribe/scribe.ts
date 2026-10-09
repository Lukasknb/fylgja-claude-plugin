/**
 * Scribe: it follows the session and works with Fylgja so that whoever
 * reads the code later can find out why it was built that way. It records
 * decisions with their reasons, asks when a decision has none, and tells
 * the developer what is already recorded about the files in hand.
 *
 * It only ever listens and writes to Fylgja. Nothing here adds to what
 * Claude reads; the one way anything of it reaches Claude is the developer
 * pressing "Tell Claude", which puts a note in the prompt box and sends
 * nothing.
 *
 * What it holds of the session and of records is held in the running plugin
 * alone. What it keeps on the machine is ids, counters and two switches.
 */

import { payloadOf } from '../payload'
import { drawn } from '../plain'
import * as Band from './band'
import { isPrompt, observe, pathsOf, plain } from './delta'
import type { Row } from './delta'
import { factsOf, isAnchoredTo, knownReposIn } from './facts'
import { REFUSED } from './grant'
import { WAKE_DEADLINE_MS, wake } from './loop'
import type { LoopHost } from './loop'
import * as Plans from './plans'
import { foldedBlock, MAX_SHOWN, pastBlock, planBlock, SYSTEM, wakeText } from './prompt'
import type { Block } from './prompt'
import { repoNameOf } from './repo'
import { CALL_TIMEOUT_MS, limited } from './time'
import type { Draft, Fact, Verdict, Written } from './types'
import { MAX_CONTENT, mentionsNoReason, saysNoReason } from './verdict'
import { NO_STRONG_REASON, NOT_STATED, viewOf } from './view'
import type { View } from './view'

/** The engine calls Scribe makes, bound from one hook's `$`. */
export type ScribeHost = LoopHost & {
  /** The name Fylgja's server is called under, or undefined while it is not connected. */
  server: () => Promise<string | undefined>
  /**
   * `$.mcp.call`: one tool call on the session's own Fylgja connection.
   * Rejects with an error whose message is `REFUSED` when the call was not
   * let through, and with any other error when it failed.
   */
  call: (server: string, tool: string, args: Record<string, unknown>) => Promise<unknown>
  /** `$.ui.invalidate('ui.render')`. */
  redraw: () => void
  /** `$.ui.toast`. */
  toast: (text: string) => void
  /** `$.ui.status`: the plugin's one line under the prompt; undefined removes it. */
  status: (text: string | undefined) => void
  /** A line for the debug log alone. Counts and fixed words; never anything a person or a record wrote. */
  debug: (text: string) => void
  /** `$.prompt.read`: the text in the prompt box. */
  box: () => Promise<string>
  /** `$.prompt.fill`: puts `text` in the prompt box and sends nothing; whether the box took it. */
  fill: (text: string) => Promise<boolean>
  /** `$.store.get`. */
  stored: (key: string) => Promise<unknown>
  /** `$.store.set`. */
  store: (key: string, value: unknown) => Promise<void>
  /** `$.session.id`. */
  sessionId: () => Promise<string>
  /** `$.session.repo`. */
  repo: () => Promise<{ root: string; remote: string | null } | null>
  /** `$.session.cwd`. */
  cwd: () => Promise<string>
  /** Whether a file or folder is at `path` (`$.fs.stat`). */
  exists: (path: string) => Promise<boolean>
  /** `$.session.surfaces`. */
  surfaces: () => Promise<readonly string[]>
  /** `$.session.messages`: the main conversation's rows. */
  rows: () => Promise<readonly Row[]>
}

/** The session as Fylgja is told of it. */
type Identity = { sessionId: string; repo: string; root: string }

/** Something to do on Fylgja that could not be done when it was asked for, kept for the next turn. */
type Deferred = { tool: string; args: Record<string, unknown> } | { draft: Draft }

export type Options = { isOn: boolean }

/**
 * The model Scribe thinks with. One model, not a choice: the smaller one was
 * tried on the same scripted sessions and stayed silent where a decision came
 * without a reason, which is the very thing Scribe is there to catch.
 */
export const MODEL = 'sonnet'

export type Scribe = {
  options: Options
  /** The model asked; `MODEL` everywhere but in a run that compares models. */
  model: string
  /** Whether a person is at a prompt Scribe can draw above. */
  isInteractive: boolean
  /** Undefined until asked for; null when Scribe is off for this session. */
  identity: Identity | null | undefined
  band: Band.Band
  /** The counts of the session a conversation started over in, to pick up again if it is the same session. */
  carry: { sessionId: string; tally: Band.Tally } | undefined
  plans: Plans.Plans
  /** The prompts the developer sent, as `plain` leaves them: what tells their words from every other row. */
  prompts: Set<string>
  /** Whether the developer has sent a prompt since Scribe last came to a verdict. */
  hasPrompt: boolean
  /** How many rows of the conversation a wake has been through; -1 when not known. */
  consumed: number
  /** The last row a wake went through, so rows that were rewritten under it are noticed. */
  mark: string | undefined
  /** When the wake under way began; 0 with none under way. */
  wakingSince: number
  /** When each wake of the last hour began. */
  wakeTimes: number[]
  /** The earlier wakes, each the block it stays, and how many were folded away before them. */
  past: Block[]
  folded: { wakes: number; block: Block | undefined }
  wakes: number
  written: Written[]
  /** The sentences recorded and asked about, for the model not to repeat. */
  recorded: string[]
  asked: string[]
  /** Files waiting to be looked up, and every file of the tree the session touched. */
  paths: string[]
  lookedUp: Set<string>
  /** The records the lookups found since the last wake. */
  anchored: Map<string, Fact>
  deferred: Deferred[]
  /** Commits already attached. */
  commits: Set<string>
  /** Whether a call of Scribe's own has got through to Fylgja in this session. */
  isGranted: boolean
  /** Whether Fylgja has been asked at all in this session, got through or not. */
  hasAsked: boolean
  /** Things said once: in the debug log, or on the status line. */
  said: Set<string>
  /** Counts the times the session started over; an answer from before is dropped. */
  epoch: number
  /** Writes Fylgja refused or that failed. */
  refused: number
}

/** The keys kept on this machine. */
export const STORE = {
  off: 'scribe.off',
  known: 'scribe.known',
  typedPast: 'scribe.typedPast',
  skip: 'scribe.skip',
  hasShown: 'scribe.hasShown',
} as const

/** A receipt nobody touched goes after this long. */
export const RECEIPT_MS = 20_000

/** A lookup by path holds a turn no longer than this; its answer is still used when it comes later. */
export const LOOKUP_WAIT_MS = 1500

/** Paths are looked up on every this-many-th step of a turn, and at its end. */
export const LOOKUP_EVERY = 4

/** No more wakes than this begin in any one hour; past it Scribe is quiet until the hour has rolled on. */
export const MAX_WAKES_PER_HOUR = 30

/**
 * A turn that changed no file and in which the developer and Claude wrote
 * fewer characters than this between them is not worth a model call. Its
 * rows are read with the next turn's.
 */
export const QUIET_TURN_CHARS = 200

/** No more earlier wakes are sent again than this; older ones are folded into one line. */
export const MAX_PAST = 8

/** No more of one earlier wake is sent again than this. */
export const MAX_PAST_CHARS = 3000

/** What the status line says, until the next prompt, when Scribe's calls are not let through. */
export const OFF_STATUS = 'Scribe is off in this session: its calls to Fylgja are not let through here'

const HOUR_MS = 3_600_000
const MAX_LOOKUP_PATHS = 30
const MAX_DEFERRED = 10
const MAX_LISTED = 40
const MAX_PROMPTS = 100
const FLUSH_BUDGET_MS = 20_000
const PROBE = 'README.md'

export function create(options: Options): Scribe {
  return {
    options,
    model: MODEL,
    isInteractive: false,
    identity: undefined,
    band: Band.create(),
    carry: undefined,
    plans: Plans.create(),
    prompts: new Set(),
    hasPrompt: false,
    consumed: -1,
    mark: undefined,
    wakingSince: 0,
    wakeTimes: [],
    past: [],
    folded: { wakes: 0, block: undefined },
    wakes: 0,
    written: [],
    recorded: [],
    asked: [],
    paths: [],
    lookedUp: new Set(),
    anchored: new Map(),
    deferred: [],
    commits: new Set(),
    isGranted: false,
    hasAsked: false,
    said: new Set(),
    epoch: 0,
    refused: 0,
  }
}

/**
 * The conversation started over (`/clear`, a resume, a fork): nothing of the
 * one before is held, and who the session is, is asked again, because its id
 * may be another now. What is kept on the machine stays, and so do the
 * session's counts if it turns out to be the same session.
 */
export function startOver(scribe: Scribe): void {
  const { kept } = scribe.band

  if (scribe.identity !== null && scribe.identity !== undefined) {
    scribe.carry = { sessionId: scribe.identity.sessionId, tally: Band.tallyOf(scribe.band) }
  }

  scribe.epoch += 1
  scribe.identity = undefined
  scribe.band = { ...Band.create(), kept }
  scribe.plans = Plans.create()
  scribe.prompts.clear()
  scribe.hasPrompt = false
  scribe.consumed = -1
  scribe.mark = undefined
  scribe.wakingSince = 0
  scribe.past = []
  scribe.folded = { wakes: 0, block: undefined }
  scribe.written = []
  scribe.recorded = []
  scribe.asked = []
  scribe.paths = []
  scribe.lookedUp.clear()
  scribe.anchored.clear()
  scribe.deferred = []
}

/** A session began: whether a person is at it, and whether it draws where the band is. */
export function started(scribe: Scribe, isInteractive: boolean, surface: string | null): void {
  startOver(scribe)
  scribe.carry = undefined
  scribe.isGranted = false
  scribe.hasAsked = false
  scribe.isInteractive = isInteractive && (surface === 'terminal' || surface === 'desktop')
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

/**
 * Writes what is kept on this machine. The records marked as known are
 * added to what is there, never written over it: another session open on
 * the same machine may have marked its own since this one last read.
 */
function keep(host: ScribeHost, band: Band.Band): void {
  const { kept } = band
  const known = async (): Promise<void> => {
    const theirs = ids(await host.stored(STORE.known))

    kept.known = [...new Set([...theirs, ...kept.known])].slice(-Band.MAX_KNOWN)
    await host.store(STORE.known, kept.known)
  }

  // Not waited for: nothing that follows depends on it.
  void Promise.all([
    known(),
    host.store(STORE.typedPast, kept.typedPast),
    host.store(STORE.skip, kept.skip),
    host.store(STORE.hasShown, kept.hasShown),
  ]).catch(() => undefined)
}

/** The root of the working tree `cwd` is in: the nearest folder upward that holds a `.git`. */
async function treeOf(host: ScribeHost, cwd: string): Promise<string | undefined> {
  let folder = cwd.replace(/\/+$/, '')

  for (let level = 0; level < 40 && folder !== ''; level += 1) {
    if (await host.exists(`${folder}/.git`)) {
      return folder
    }

    folder = folder.slice(0, folder.lastIndexOf('/'))
  }

  return undefined
}

/**
 * Who Scribe is working for in this conversation, or null when it is off:
 * by its option or its switch, with nobody at the prompt, where the band is
 * not drawn, or outside a repository. Asked once per conversation.
 */
async function identityOf(host: ScribeHost, scribe: Scribe): Promise<Identity | null> {
  if (scribe.identity !== undefined) {
    return scribe.identity
  }

  scribe.identity = null

  if (!scribe.options.isOn || !scribe.isInteractive) {
    return null
  }

  const surfaces = await host.surfaces()

  if (!surfaces.includes('terminal') && !surfaces.includes('desktop')) {
    return null
  }

  if ((await host.stored(STORE.off)) === true) {
    return null
  }

  const repo = await host.repo()
  const cwd = await host.cwd()
  const root = repo === null ? undefined : await treeOf(host, cwd)
  const name = repo === null ? undefined : repoNameOf(repo.remote, repo.root)

  if (root === undefined || name === undefined) {
    return null
  }

  const [known, typedPast, skip, hasShown] = await Promise.all([
    host.stored(STORE.known),
    host.stored(STORE.typedPast),
    host.stored(STORE.skip),
    host.stored(STORE.hasShown),
  ])
  const sessionId = await host.sessionId()
  const { band, carry } = scribe

  band.kept = {
    known: ids(known).slice(-Band.MAX_KNOWN),
    typedPast: typeof typedPast === 'number' && typedPast > 0 ? Math.floor(typedPast) : 0,
    skip: typeof skip === 'number' && skip > 0 ? Math.min(16, Math.floor(skip)) : 0,
    hasShown: hasShown === true,
  }

  // The same session after a `/clear` has had its questions and its tells;
  // a new one starts with none.
  if (carry?.sessionId === sessionId) {
    Object.assign(band, carry.tally)
  }

  scribe.carry = undefined
  scribe.identity = { sessionId, repo: name, root }

  return scribe.identity
}

/**
 * The name Fylgja's server is called under, or undefined when Scribe is not
 * to call it: not connected, connected through an entry that is not the
 * plugin's own (which the session decides, for the whole plugin), or not
 * saying in time.
 */
function connected(host: ScribeHost): Promise<string | undefined> {
  return limited(host.after, host.server(), CALL_TIMEOUT_MS).catch(() => undefined)
}

function once(scribe: Scribe, what: string): boolean {
  const isFirst = !scribe.said.has(what)

  scribe.said.add(what)

  return isFirst
}

/**
 * One tool call on Fylgja, waited for no longer than a fixed time. Rejects
 * when Fylgja is not connected, when the call is not let through, when it
 * fails and when it does not answer in time.
 */
async function call(
  host: ScribeHost,
  scribe: Scribe,
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const server = await connected(host)

  if (server === undefined) {
    throw new Error('Fylgja is not connected')
  }

  const answer = payloadOf(
    await limited(host.after, host.call(server, tool, args), CALL_TIMEOUT_MS).catch((error: unknown) => {
      // A call that is not let through, whichever it is, ends Scribe for
      // the session: it does not go on reading and asking a model for
      // records it may not write.
      if (error instanceof Error && error.message === REFUSED) {
        switchOff(host, scribe)
      }

      throw error
    }),
  )

  scribe.isGranted = true

  // Fylgja knows the repository under another spelling. Which repository
  // this is, is the session's to say, so nothing is switched; it is noted.
  if (knownReposIn(answer) > 0 && once(scribe, 'known-repos')) {
    host.debug(`Fylgja holds nothing under this repository's name and offers ${knownReposIn(answer)} it knows`)
  }

  return answer
}

/**
 * Scribe stops for the session: a call of its own was not let through. It
 * says so once, on the line under the prompt, and does nothing more.
 */
function switchOff(host: ScribeHost, scribe: Scribe): void {
  scribe.identity = null
  scribe.band = { ...Band.create(), kept: scribe.band.kept }
  scribe.deferred = []

  if (once(scribe, 'off')) {
    host.status(OFF_STATUS)
    host.debug('Scribe: its own call to Fylgja was refused; off for this session')
  }

  host.redraw()
}

function defer(scribe: Scribe, work: Deferred): void {
  scribe.deferred = [...scribe.deferred, work].slice(-MAX_DEFERRED)
}

/**
 * A change to a record the developer asked for: made now, or at the next
 * turn when it cannot be made here. Whether it was made now.
 */
async function amend(host: ScribeHost, scribe: Scribe, args: Record<string, unknown>): Promise<boolean> {
  try {
    await call(host, scribe, 'amend_memory', args)

    return true
  } catch {
    // Off for the session, nothing is kept to try again.
    if (scribe.identity !== null) {
      defer(scribe, { tool: 'amend_memory', args })
    }

    return false
  }
}

/**
 * Writes one record. Undefined when nothing was stored or brought back:
 * Fylgja refused it, or holds it already. A refusal is counted and never
 * tried again.
 *
 * @param prior the recorded decision it replaces, when the developer said it does
 */
async function record(host: ScribeHost, scribe: Scribe, who: Identity, draft: Draft, prior?: Fact): Promise<Written | undefined> {
  const args: Record<string, unknown> = {
    content: draft.content,
    repo: who.repo,
    kind: draft.kind,
    author: 'scribe',
    session_id: who.sessionId,
    ...(draft.detail === '' ? {} : { detail: draft.detail }),
    ...(draft.anchors.length === 0 ? {} : { anchors: draft.anchors }),
    ...(draft.alternatives.length === 0 ? {} : { alternatives: draft.alternatives }),
    ...(draft.triggers.length === 0 ? {} : { triggers: draft.triggers }),
    ...(draft.reasonStatus === null ? {} : { reason_status: draft.reasonStatus }),
    ...(prior === undefined ? {} : { supersedes: prior.id }),
  }

  let answer: Record<string, unknown> | undefined

  try {
    answer = await call(host, scribe, 'remember', args)
  } catch {
    answer = undefined
  }

  const outcome = answer?.outcome

  if (outcome !== 'created' && outcome !== 'restored' && outcome !== 'duplicate' && outcome !== 'reconfirmed') {
    scribe.refused += 1

    return undefined
  }

  scribe.recorded = [...scribe.recorded, draft.content].slice(-MAX_LISTED)

  // Held already: nothing was written, so there is nothing to show or undo.
  if ((outcome !== 'created' && outcome !== 'restored') || typeof answer?.atom_id !== 'string') {
    return undefined
  }

  const written: Written = {
    id: answer.atom_id,
    kind: draft.kind,
    content: draft.content,
    reasonStatus: draft.reasonStatus,
    outcome,
    replaced: prior !== undefined && answer.supersede === 'applied' ? prior.content : null,
  }

  scribe.written = [...scribe.written, written].slice(-MAX_LISTED)

  return written
}

/**
 * Takes a receipt down once nobody has touched it for a while. One that was
 * behind something else all that time is given the time again. A receipt of
 * a conversation that has since started over is not this timer's.
 */
function expire(host: ScribeHost, scribe: Scribe, band: Band.Band, serial: number): void {
  host.after(RECEIPT_MS, () => {
    if (scribe.band !== band || band.receipt?.serial !== serial || band.receipt.isOpen || band.editing !== null) {
      return
    }

    if (band.current !== null || band.armed !== null) {
      expire(host, scribe, band, serial)

      return
    }

    band.receipt = null
    host.redraw()
  })
}

/**
 * Does what could not be done when it was asked for. Each is tried once more
 * and then let go; what there is no time for waits for the next turn.
 */
async function flush(host: ScribeHost, scribe: Scribe, who: Identity): Promise<void> {
  const waiting = scribe.deferred
  const startedAt = await host.now()

  scribe.deferred = []

  for (const [at, work] of waiting.entries()) {
    if ((await host.now()) - startedAt > FLUSH_BUDGET_MS) {
      scribe.deferred = [...waiting.slice(at), ...scribe.deferred].slice(-MAX_DEFERRED)

      break
    }

    if ('draft' in work) {
      const one = await record(host, scribe, who, work.draft)

      Band.receive(scribe.band, one === undefined ? [] : [one])
    } else {
      await call(host, scribe, work.tool, work.args).catch(() => undefined)
    }
  }
}

/** Brings up what may now be shown, and sees to what was let go unseen. */
function settle(host: ScribeHost, scribe: Scribe): void {
  const { band } = scribe
  const settled = Band.settle(band)

  for (const item of settled.dropped) {
    // The question is let go; the decision it was about is still recorded,
    // beside the one it might have replaced.
    if (item.kind === 'question' && item.form === 'reversal') {
      defer(scribe, { draft: { ...item.draft, supersedes: null } })
    }
  }

  if (settled.receipt !== undefined) {
    expire(host, scribe, band, settled.receipt)
  }

  if (settled.isKeptChanged) {
    keep(host, band)
  }

  host.redraw()
}

/** Acts on a wake's verdict: writes its records, and puts its question and its tells in line. */
async function apply(
  host: ScribeHost,
  scribe: Scribe,
  who: Identity,
  verdict: Verdict,
  facts: ReadonlyMap<string, Fact>,
): Promise<void> {
  const { band } = scribe
  const { question } = verdict

  for (const [index, draft] of verdict.records.entries()) {
    const isAskedOf = question?.record === index
    const prior = isAskedOf && question.form === 'reversal' ? facts.get(question.prior) : undefined

    if (isAskedOf) {
      scribe.asked = [...scribe.asked, draft.content].slice(-MAX_LISTED)
    }

    // A decision that may replace a recorded one is written once the
    // developer has said which it is. When they cannot be asked, it is
    // written beside the old one: nothing is ever replaced without their key.
    if (prior !== undefined) {
      const ask: Band.Question = {
        kind: 'question',
        form: 'reversal',
        draft,
        prior,
        options: question?.options ?? [],
        isTouched: false,
      }

      if (Band.offerQuestion(band, ask, draft.content)) {
        continue
      }
    }

    const one = await record(host, scribe, who, { ...draft, supersedes: null })

    if (one === undefined) {
      continue
    }

    Band.receive(band, [one])

    if (isAskedOf && question.form === 'reason' && one.reasonStatus === 'not_stated') {
      Band.offerQuestion(
        band,
        {
          kind: 'question',
          form: 'reason',
          id: one.id,
          content: one.content,
          options: question.options,
          isTouched: false,
        },
        one.content,
      )
    }
  }

  for (const id of verdict.tells) {
    const fact = facts.get(id)

    if (fact !== undefined && !scribe.written.some(own => own.id === id)) {
      Band.offerTell(band, fact)
    }
  }
}

/**
 * Asks Fylgja what is recorded about the files waiting to be looked up. A
 * record anchored to one of those very files is offered to the developer;
 * one anchored to a folder above is kept for the next wake to judge.
 *
 * @param isProbe with no file waiting, ask all the same, about a file every
 *   repository has: whether the call gets through is what is asked
 */
async function lookUp(host: ScribeHost, scribe: Scribe, who: Identity, isProbe = false): Promise<void> {
  const files = scribe.paths.slice(0, MAX_LOOKUP_PATHS)
  const { epoch } = scribe

  scribe.paths = scribe.paths.slice(MAX_LOOKUP_PATHS)

  if (files.length === 0 && !isProbe) {
    return
  }

  const facts = factsOf(await call(host, scribe, 'recall', { repo: who.repo, paths: files.length === 0 ? [PROBE] : files }))

  if (epoch !== scribe.epoch) {
    return
  }

  for (const fact of facts) {
    if (scribe.written.some(own => own.id === fact.id)) {
      continue
    }

    scribe.anchored.set(fact.id, fact)

    if (isAnchoredTo(fact, files)) {
      Band.offerTell(scribe.band, fact)
    }
  }

  settle(host, scribe)
}

/** Waits for `work`, but no longer than `ms`. `work` goes on either way. */
function within(host: ScribeHost, work: Promise<unknown>, ms: number): Promise<void> {
  return limited(host.after, work, ms).then(
    () => undefined,
    () => undefined,
  )
}

/** Notes files of the tree the session touched: to be looked up once, and to be what a record may point at. */
function wanted(scribe: Scribe, files: readonly string[]): void {
  for (const file of files) {
    if (!scribe.lookedUp.has(file)) {
      scribe.lookedUp.add(file)
      scribe.paths.push(file)
    }
  }
}

/**
 * One step of the main conversation ended. The files it names are noted,
 * and on every fourth step they are looked up; a slow answer does not hold
 * the turn.
 */
export async function stepped(
  host: ScribeHost,
  scribe: Scribe,
  index: number,
  uses: readonly { name: string; input: unknown }[],
): Promise<void> {
  if (scribe.identity === null) {
    return
  }

  const who = await identityOf(host, scribe)

  if (who === null) {
    return
  }

  wanted(scribe, pathsOf(uses, who.root))

  if ((index + 1) % LOOKUP_EVERY !== 0 || scribe.paths.length === 0 || (await connected(host)) === undefined) {
    return
  }

  await within(
    host,
    lookUp(host, scribe, who).catch(() => undefined),
    LOOKUP_WAIT_MS,
  )
}

/** What tells one row from another, without holding it: enough to notice that the rows were rewritten. */
function markOf(row: Row | undefined): string | undefined {
  return row === undefined ? undefined : `${row.role}|${row.text.length}|${row.toolUses.length}|${row.text.slice(0, 80)}`
}

/**
 * Where the rows not yet seen begin: after the ones a wake went through. A
 * compaction, or anything else that rewrites the conversation, leaves that
 * count pointing into another list; then, and when nothing is known yet,
 * they begin at the developer's last prompt.
 */
function startOf(scribe: Scribe, rows: readonly Row[]): number {
  const { consumed } = scribe

  if (consumed >= 0 && consumed <= rows.length && (consumed === 0 || markOf(rows[consumed - 1]) === scribe.mark)) {
    return consumed
  }

  for (let at = rows.length - 1; at >= 0; at -= 1) {
    const row = rows[at]

    if (row !== undefined && isPrompt(row, scribe.prompts)) {
      return at
    }
  }

  return rows.length
}

function summaryOf(verdict: Verdict, written: readonly Written[]): string {
  return JSON.stringify({
    outcome: verdict.records.length === 0 && verdict.question === null && verdict.tells.length === 0 ? 'nothing' : 'act',
    recorded: written.map(one => one.content),
    asked: verdict.question !== null,
    told: verdict.tells.length,
  })
}

/** An earlier wake's lines, cut from the old end to what a later wake needs to follow the thread. */
function gist(lines: readonly string[]): string[] {
  const kept: string[] = []
  let size = 0

  for (const line of [...lines].reverse()) {
    const short = line.length > 400 ? `${line.slice(0, 400)}…` : line

    if (size + short.length > MAX_PAST_CHARS) {
      break
    }

    kept.unshift(short)
    size += short.length
  }

  return kept
}

/**
 * Whether a wake may begin now: none is under way, and the hour has not had
 * its share. The hour's share used up is said once in the debug log.
 */
function mayWake(host: ScribeHost, scribe: Scribe, now: number): boolean {
  // A wake always ends, by its own limits; one that somehow did not is not
  // let stand in the way of every later one.
  if (scribe.wakingSince !== 0 && now - scribe.wakingSince < 2 * WAKE_DEADLINE_MS) {
    return false
  }

  scribe.wakeTimes = scribe.wakeTimes.filter(at => now - at < HOUR_MS)

  if (scribe.wakeTimes.length < MAX_WAKES_PER_HOUR) {
    scribe.said.delete('ceiling')

    return true
  }

  if (once(scribe, 'ceiling')) {
    host.debug(`Scribe: ${MAX_WAKES_PER_HOUR} wakes in the last hour; quiet until the hour has rolled on`)
  }

  return false
}

/**
 * A turn of the main conversation ended. Scribe reads what happened since
 * it last looked, looks up the files touched, runs one wake over it, acts on
 * the verdict, and attaches any commit the turn made to the session's
 * records.
 *
 * A model is asked only for a turn the developer started, that has
 * something in it, and only once a call of Scribe's own has got through to
 * Fylgja. A wake that did not come to a verdict, or was not begun, leaves
 * the rows unread, so the next turn's wake has them too.
 */
export async function completed(host: ScribeHost, scribe: Scribe): Promise<void> {
  scribe.band.isWorking = false
  scribe.band.hasAskedThisTurn = false

  const who = await identityOf(host, scribe)

  // Signed out, nothing is read and no model is asked.
  if (who === null || (await connected(host)) === undefined) {
    return
  }

  const rows = await host.rows()
  const from = startOf(scribe, rows)
  const seen = observe(rows.slice(from), who.root, scribe.prompts)

  // Held from here on: a wake that comes to nothing leaves these rows for the next.
  scribe.consumed = from
  scribe.mark = markOf(rows[from - 1])

  for (const plan of seen.plans) {
    if ('text' in plan) {
      Plans.keep(scribe.plans, plan.key, plan.path, plan.text)
    } else {
      Plans.edit(scribe.plans, plan.key, plan.before, plan.after)
    }
  }

  wanted(scribe, seen.touched)

  // The developer's rows are told from every other by the prompt they sent.
  // Where no row holds it, their words are not labelled as theirs; that is
  // worth knowing, and says nothing of what was written.
  if (scribe.hasPrompt && seen.developer === '' && once(scribe, 'no-prompt-row')) {
    host.debug(
      'Scribe: a prompt was sent and no row of the conversation holds it; the turn is read without what the developer wrote',
    )
  }

  // The first call of a session is waited for: whether it gets through
  // decides whether Scribe runs at all. After that a slow lookup does not
  // hold the turn's end.
  if (scribe.isGranted) {
    await within(
      host,
      lookUp(host, scribe, who).catch(() => undefined),
      LOOKUP_WAIT_MS,
    )
  } else {
    const first = lookUp(host, scribe, who, true).catch(() => undefined)

    // Waited for in full once. A server that did not answer then is not
    // given more than a moment at each later turn's end.
    await (scribe.hasAsked ? within(host, first, LOOKUP_WAIT_MS) : first)
    scribe.hasAsked = true
  }

  if (scribe.identity === null || !scribe.isGranted) {
    return
  }

  await flush(host, scribe, who)

  const now = await host.now()
  const isWorthAsking = seen.lines.length > 0 && (seen.hasChange || seen.words >= QUIET_TURN_CHARS)

  if (scribe.hasPrompt && isWorthAsking && mayWake(host, scribe, now)) {
    scribe.wakingSince = now
    scribe.wakeTimes.push(now)

    try {
      const { epoch } = scribe
      const shown = [...scribe.anchored.values()].slice(0, MAX_SHOWN)
      const plans = planBlock(scribe.plans.docs)
      const past = scribe.past.map((block, at) => (at === scribe.past.length - 1 ? { ...block, cache: true as const } : block))
      const inTree = scribe.plans.docs.flatMap(doc => (doc.path === null ? [] : [doc.path]))
      const woken = await wake(host, {
        model: scribe.model,
        system: SYSTEM,
        fixed: [
          ...(plans === undefined ? [] : [plans]),
          ...(scribe.folded.block === undefined ? [] : [scribe.folded.block]),
          ...past,
        ],
        current: wakeText(who.repo, seen.lines, seen.dropped, shown, {
          recorded: scribe.recorded,
          asked: scribe.asked,
          told: [...scribe.band.told].slice(-MAX_LISTED),
        }),
        repo: who.repo,
        shown,
        seen: {
          plans: scribe.plans.docs,
          saidNoReason: mentionsNoReason(seen.developer),
          paths: new Set([...scribe.lookedUp, ...inTree]),
        },
      })

      if (woken.ending === 'verdict' && epoch === scribe.epoch) {
        const before = scribe.written.length

        scribe.consumed = rows.length
        scribe.mark = markOf(rows.at(-1))
        scribe.hasPrompt = false
        scribe.anchored.clear()
        scribe.wakes += 1
        await apply(host, scribe, who, woken.verdict, woken.facts)
        scribe.past = [
          ...scribe.past,
          pastBlock(scribe.wakes, gist(seen.lines), summaryOf(woken.verdict, scribe.written.slice(before))),
        ]

        // The oldest are folded into one line, in one piece, so the blocks
        // that stay are read from the prompt cache until the next cut.
        if (scribe.past.length > MAX_PAST) {
          const gone = scribe.past.length - MAX_PAST / 2

          scribe.past = scribe.past.slice(gone)
          scribe.folded.wakes += gone
          scribe.folded.block = foldedBlock(scribe.folded.wakes, scribe.recorded.length)
        }
      }
    } finally {
      scribe.wakingSince = 0
    }
  }

  // A commit made in this repository is attached to what the session
  // recorded: Scribe's records and Claude's own. Fylgja attaches it once.
  for (const sha of seen.commits) {
    if (!scribe.commits.has(sha)) {
      scribe.commits.add(sha)
      await call(host, scribe, 'attach_commit', { repo: who.repo, sha, session_id: who.sessionId }).catch(() => undefined)
    }
  }

  settle(host, scribe)
  await flush(host, scribe, who)
  settle(host, scribe)
}

/**
 * The developer sent a prompt. Only what is already in hand is worked on,
 * and nothing is waited for: the prompt goes on at once.
 *
 * @param text the prompt as it goes to Claude; held in the running plugin to
 *   tell the developer's rows from every other, and nowhere else
 */
export function prompted(host: ScribeHost, scribe: Scribe, text: string): void {
  const { band } = scribe
  const wasQuiet = band.current === null && band.receipt === null && band.queue.length === 0 && band.held.length === 0
  const item = Band.submitted(band)

  scribe.hasPrompt = true
  scribe.prompts.add(plain(text))

  for (const old of scribe.prompts) {
    if (scribe.prompts.size <= MAX_PROMPTS) {
      break
    }

    scribe.prompts.delete(old)
  }

  // What was said once on the status line has been there long enough.
  if (scribe.said.has('off') && once(scribe, 'off-cleared')) {
    host.status(undefined)
  }

  if (wasQuiet) {
    return
  }

  if (item?.kind === 'question' && item.form === 'reversal') {
    defer(scribe, { draft: { ...item.draft, supersedes: null } })
  }

  keep(host, band)
  settle(host, scribe)
}

/** The prompt box changed. Once it is empty again, what waited for the developer to stop typing comes up. */
export function typed(host: ScribeHost, scribe: Scribe, text: string): void {
  const isTyping = text !== ''
  const wasTyping = scribe.band.isTyping

  scribe.band.isTyping = isTyping

  if (wasTyping && !isTyping && (scribe.band.queue.length > 0 || scribe.band.held.length > 0)) {
    settle(host, scribe)
  }
}

/** One line of a note: a record's words made safe to draw, and never one of the box's own marks. */
function quoted(text: string, max: number): string {
  return drawn(text, max).replace(/@/g, '(at)')
}

/** A record as a note for the prompt box: quoted, every line made safe, and said to be information. */
function noteOf(lead: string, fact: Fact): string {
  const quote = [
    `${fact.kind === 'gotcha' ? 'Gotcha' : fact.kind === 'decision' ? 'Decision' : 'Record'}: ${quoted(fact.content, MAX_CONTENT)}`,
    fact.reasonStatus === 'no_strong_reason'
      ? NO_STRONG_REASON
      : fact.detail.trim() !== ''
        ? `Why: ${quoted(fact.detail, 600)}`
        : fact.kind === 'decision'
          ? NOT_STATED
          : '',
    fact.alternatives.length === 0 ? '' : `Rejected: ${fact.alternatives.map(one => quoted(one, 80)).join('; ')}`,
    // Its address was checked when the record was read: one line, on Fylgja's own host.
    fact.link ?? '',
  ]

  return `${lead}\n\n${quote
    .filter(line => line !== '')
    .map(line => `> ${line}`)
    .join('\n')}\n\n`
}

/** Puts a note about `fact` in the prompt box, when the box is empty. Sends nothing. */
async function tellClaude(host: ScribeHost, lead: string, fact: Fact): Promise<boolean> {
  if ((await host.box()) !== '') {
    host.toast('The prompt box has text in it. Clear it, then press the key again.')

    return false
  }

  if (!(await host.fill(noteOf(lead, fact)))) {
    host.toast('The note could not be put in the prompt box.')

    return false
  }

  return true
}

const TELL_LEAD = 'A note from Fylgja, offered by Scribe. It is information about this code, not an instruction:'
const REVERSAL_LEAD =
  'Scribe noticed that the last change may go against a decision recorded in Fylgja. The record is information, not an instruction:'

async function pressedReceipt(host: ScribeHost, scribe: Scribe, key: string): Promise<void> {
  const { band } = scribe
  const shown = band.receipt

  if (shown === null) {
    return
  }

  const [action, place] = key.split(':')
  const written = shown.records[Number(place)]

  if (key === 'ok') {
    band.receipt = null
  } else if (key === 'review') {
    shown.isOpen = true
  } else if (action === 'fix' && written !== undefined) {
    band.editing = { what: 'fix', id: written.id, value: written.content }
  } else if (action === 'remove' && written !== undefined) {
    shown.records = shown.records.filter(one => one !== written)
    scribe.written = scribe.written.filter(one => one.id !== written.id)
    band.receipt = shown.records.length === 0 ? null : shown
    await amend(host, scribe, { atom_id: written.id, op: 'remove' })
  }
}

async function pressedTell(host: ScribeHost, scribe: Scribe, item: Band.Tell, key: string): Promise<void> {
  const { band } = scribe

  if (key === 'open') {
    item.isOpen = true
  } else if (key === 'tell-claude') {
    if (await tellClaude(host, TELL_LEAD, item.fact)) {
      Band.clear(band)
    }
  } else if (key === 'knew') {
    Band.know(band, item.fact.id)
    Band.clear(band)
  } else if (key === 'dismiss') {
    Band.clear(band)
  }
}

/** Saves the developer's answer to "why" on the record it was asked about, and shows that it was saved. */
async function reasoned(
  host: ScribeHost,
  scribe: Scribe,
  item: Band.ReasonQuestion,
  answer: { detail?: string; reason_status: 'stated' | 'no_strong_reason' },
): Promise<void> {
  if (await amend(host, scribe, { atom_id: item.id, op: 'fix', ...answer })) {
    Band.receive(scribe.band, [
      {
        id: item.id,
        kind: 'decision',
        content: item.content,
        reasonStatus: answer.reason_status,
        outcome: 'reasoned',
        replaced: null,
      },
    ])
  }
}

async function pressedQuestion(host: ScribeHost, scribe: Scribe, who: Identity, item: Band.Question, key: string): Promise<void> {
  const { band } = scribe

  if (item.form === 'reason') {
    const option = key.startsWith('reason:') ? item.options[Number(key.slice(7))] : undefined

    if (option !== undefined) {
      Band.clear(band)
      await reasoned(host, scribe, item, { detail: option, reason_status: 'stated' })
    } else if (key === 'other') {
      band.editing = { what: 'reason' }
    } else if (key === 'no-reason') {
      Band.clear(band)
      await reasoned(host, scribe, item, { reason_status: 'no_strong_reason' })
    } else if (key === 'skip') {
      band.unanswered += 1
      Band.clear(band)
    }

    return
  }

  if (key === 'tell-claude') {
    // Nothing is written: the developer is taking it up with Claude.
    if (await tellClaude(host, REVERSAL_LEAD, item.prior)) {
      Band.clear(band)
    }

    return
  }

  if (key !== 'replaces' && key !== 'different' && key !== 'skip') {
    return
  }

  band.unanswered += key === 'skip' ? 1 : 0
  Band.clear(band)

  // Only this key makes the new decision the replacement of the old one.
  const written = await record(host, scribe, who, item.draft, key === 'replaces' ? item.prior : undefined)

  if (written === undefined) {
    return
  }

  Band.receive(band, [written])

  // It replaces the old decision, and nobody has said why: that is asked
  // next, as part of the same answer.
  if (key === 'replaces' && written.reasonStatus === 'not_stated') {
    band.current = {
      kind: 'question',
      form: 'reason',
      id: written.id,
      content: written.content,
      options: item.options,
      isTouched: true,
    }
  }
}

/**
 * Whether a key writes to Fylgja or settles something for good, and so acts
 * only on its second press: removing a record, silencing one for good,
 * turning Scribe off, making a decision the replacement of a recorded one,
 * and saving a reason the model proposed. Keys that only open, skip, dismiss
 * or fill the prompt box act at once.
 */
function needsSecondPress(key: string): boolean {
  return key === 'knew' || key === 'off' || key === 'replaces' || key === 'no-reason' || /^(?:remove|reason):/.test(key)
}

/** A key of the band was pressed. */
export async function pressed(host: ScribeHost, scribe: Scribe, key: string): Promise<void> {
  const { band } = scribe
  const who = scribe.identity

  if (who === null || who === undefined) {
    return
  }

  if (needsSecondPress(key)) {
    if (!Band.confirmed(band, key, await host.now())) {
      const { armed } = band

      // The first press only makes the key say what a second will do, for a
      // few seconds. It is no sign of attention either: a stray digit is
      // exactly what it guards against.
      host.after(Band.ARM_MS, () => {
        if (scribe.band === band && band.armed === armed) {
          band.armed = null
          host.redraw()
        }
      })
      host.redraw()

      return
    }
  } else {
    band.armed = null
  }

  const isKeptChanged = Band.touch(band)
  const known = band.kept.known.length
  const item = band.current

  if (key === 'about') {
    band.isAboutOpen = true
  } else if (key === 'about-ok') {
    band.isAboutOpen = false
    band.offersAbout = false
  } else if (key === 'off') {
    // Off for this machine, from this moment: nothing more is read or shown.
    startOver(scribe)
    scribe.identity = null
    void host.store(STORE.off, true).catch(() => undefined)
  } else if (key === 'cancel') {
    band.editing = null
  } else if (band.editing !== null || band.isAboutOpen) {
    return
  } else if (item?.kind === 'question' && !band.isWorking) {
    await pressedQuestion(host, scribe, who, item, key)
  } else if (item?.kind === 'tell') {
    await pressedTell(host, scribe, item, key)
  } else {
    await pressedReceipt(host, scribe, key)
  }

  if (isKeptChanged || band.kept.known.length !== known) {
    keep(host, band)
  }

  settle(host, scribe)
}

/** Enter was pressed in the band's field. */
export async function entered(host: ScribeHost, scribe: Scribe, key: string, value: string): Promise<void> {
  const { band } = scribe
  const { editing } = band
  const text = value.replace(/\s+/g, ' ').trim()

  if (scribe.identity === null || scribe.identity === undefined || editing === null) {
    return
  }

  if (key === 'fix-text' && editing.what === 'fix') {
    if (text === '' || text.length > MAX_CONTENT) {
      host.toast(`One sentence of at most ${MAX_CONTENT} characters.`)

      return
    }

    for (const written of [...scribe.written, ...band.held, ...(band.receipt?.records ?? [])]) {
      if (written.id === editing.id) {
        written.content = text
      }
    }

    band.editing = null
    await amend(host, scribe, { atom_id: editing.id, op: 'fix', content: text })
  } else if (
    key === 'reason-text' &&
    editing.what === 'reason' &&
    band.current?.kind === 'question' &&
    band.current.form === 'reason'
  ) {
    if (text === '') {
      return
    }

    const asked = band.current

    Band.clear(band)

    // "No idea" is an answer too: it is kept as one, in their words, and
    // never passed off as a reason.
    await reasoned(host, scribe, asked, { detail: text, reason_status: saysNoReason(text) ? 'no_strong_reason' : 'stated' })
  }

  settle(host, scribe)
}

/** What the band shows now; undefined for nothing, and always while Scribe is off. */
export function view(scribe: Scribe, isWorking: boolean): View | undefined {
  return scribe.identity === null || scribe.identity === undefined ? undefined : viewOf(scribe.band, isWorking)
}
