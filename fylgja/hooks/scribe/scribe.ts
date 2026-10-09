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
import { observe, pathsOf } from './delta'
import type { Row } from './delta'
import { factsOf, isAnchoredTo } from './facts'
import { wake } from './loop'
import type { LoopHost } from './loop'
import * as Plans from './plans'
import { pastBlock, planBlock, SYSTEM, wakeText } from './prompt'
import type { Block } from './prompt'
import { relativeTo, repoNameOf } from './repo'
import type { Draft, Fact, Verdict, Written } from './types'
import { MAX_CONTENT, mentionsNoReason, saysNoReason } from './verdict'
import { NO_STRONG_REASON, NOT_STATED, viewOf } from './view'
import type { View } from './view'

/** The engine calls Scribe makes, bound from one hook's `$`. */
export type ScribeHost = LoopHost & {
  /** The name Fylgja's server is called under, or undefined while it is not connected. */
  server: () => Promise<string | undefined>
  /** `$.mcp.call`: one tool call on the session's own Fylgja connection. */
  call: (server: string, tool: string, args: Record<string, unknown>) => Promise<unknown>
  /** `$.clock.after`: calls `fn` once, `ms` milliseconds on. */
  after: (ms: number, fn: () => void) => { cancel: () => void }
  /** `$.ui.invalidate('ui.render')`. */
  redraw: () => void
  /** `$.ui.toast`. */
  toast: (text: string) => void
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

export type Options = { isOn: boolean; model: 'sonnet' | 'haiku' }

export type Scribe = {
  options: Options
  /** Whether a person is at a prompt Scribe can draw above. */
  isInteractive: boolean
  /** Undefined until first asked for; null when Scribe is off for this session. */
  identity: Identity | null | undefined
  band: Band.Band
  plans: Plans.Plans
  /** How many rows of the conversation a wake has been through; -1 when not known. */
  consumed: number
  isWaking: boolean
  /** The earlier wakes, each the block it stays. */
  past: Block[]
  wakes: number
  written: Written[]
  /** The sentences recorded and asked about, for the model not to repeat. */
  recorded: string[]
  asked: string[]
  /** Files waiting to be looked up, and every file looked up so far. */
  paths: string[]
  lookedUp: Set<string>
  /** The records the lookups found since the last wake. */
  anchored: Map<string, Fact>
  deferred: Deferred[]
  /** Commits already attached. */
  commits: Set<string>
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

const MAX_LOOKUP_PATHS = 30
const MAX_PAST = 12
const MAX_PAST_CHARS = 3000
const MAX_DEFERRED = 10
const MAX_LISTED = 40

export function create(options: Options): Scribe {
  return {
    options,
    isInteractive: false,
    identity: undefined,
    band: Band.create(),
    plans: Plans.create(),
    consumed: -1,
    isWaking: false,
    past: [],
    wakes: 0,
    written: [],
    recorded: [],
    asked: [],
    paths: [],
    lookedUp: new Set(),
    anchored: new Map(),
    deferred: [],
    commits: new Set(),
    epoch: 0,
    refused: 0,
  }
}

/** The conversation started over: nothing of the one before is held. What is kept on the machine stays. */
export function startOver(scribe: Scribe): void {
  const { kept } = scribe.band

  scribe.epoch += 1
  scribe.band = { ...Band.create(), kept }
  scribe.plans = Plans.create()
  scribe.consumed = -1
  scribe.past = []
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
  scribe.identity = undefined
  scribe.isInteractive = isInteractive && (surface === 'terminal' || surface === 'desktop')
}

function keep(host: ScribeHost, band: Band.Band): void {
  const { kept } = band

  // Not waited for: nothing that follows depends on it.
  void Promise.all([
    host.store(STORE.known, kept.known),
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
 * Who Scribe is working for in this session, or null when it is off: by its
 * option or its switch, with nobody at the prompt, where the band is not
 * drawn, or outside a repository. Asked once per session.
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

  scribe.band.kept = {
    known: Array.isArray(known) ? known.filter((id): id is string => typeof id === 'string').slice(-Band.MAX_KNOWN) : [],
    typedPast: typeof typedPast === 'number' && typedPast > 0 ? Math.floor(typedPast) : 0,
    skip: typeof skip === 'number' && skip > 0 ? Math.min(16, Math.floor(skip)) : 0,
    hasShown: hasShown === true,
  }
  scribe.identity = { sessionId: await host.sessionId(), repo: name, root }

  return scribe.identity
}

/** One tool call on Fylgja; rejects when it is not connected, refused or failing. */
async function call(host: ScribeHost, tool: string, args: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
  const server = await host.server()

  if (server === undefined) {
    throw new Error('Fylgja is not connected')
  }

  return payloadOf(await host.call(server, tool, args))
}

function defer(scribe: Scribe, work: Deferred): void {
  scribe.deferred = [...scribe.deferred, work].slice(-MAX_DEFERRED)
}

/** A change to a record the developer asked for: made now, or at the next turn when it cannot be made here. */
async function amend(host: ScribeHost, scribe: Scribe, args: Record<string, unknown>): Promise<void> {
  try {
    await call(host, 'amend_memory', args)
  } catch {
    defer(scribe, { tool: 'amend_memory', args })
  }
}

/**
 * Writes one record. Undefined when nothing new was stored: Fylgja refused
 * it, or holds it already. A refusal is counted and never tried again.
 */
async function record(host: ScribeHost, scribe: Scribe, who: Identity, draft: Draft): Promise<Written | undefined> {
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
    ...(draft.supersedes === null ? {} : { supersedes: draft.supersedes }),
  }

  let answer: Record<string, unknown> | undefined

  try {
    answer = await call(host, 'remember', args)
  } catch {
    answer = undefined
  }

  const outcome = answer?.outcome

  if (outcome !== 'created' && outcome !== 'duplicate' && outcome !== 'reconfirmed') {
    scribe.refused += 1

    return undefined
  }

  scribe.recorded = [...scribe.recorded, draft.content].slice(-MAX_LISTED)

  if (outcome !== 'created' || typeof answer?.atom_id !== 'string') {
    return undefined
  }

  const written: Written = {
    id: answer.atom_id,
    kind: draft.kind,
    content: draft.content,
    reasonStatus: draft.reasonStatus,
  }

  scribe.written = [...scribe.written, written].slice(-MAX_LISTED)

  return written
}

/**
 * Takes a receipt down once nobody has touched it for a while. One that was
 * behind something else all that time is given the time again.
 */
function expire(host: ScribeHost, scribe: Scribe, serial: number): void {
  host.after(RECEIPT_MS, () => {
    const { band } = scribe

    if (band.receipt?.serial !== serial || band.receipt.isOpen || band.editing !== null) {
      return
    }

    if (band.current !== null) {
      expire(host, scribe, serial)

      return
    }

    band.receipt = null
    host.redraw()
  })
}

/** Shows what was just written. */
function receive(host: ScribeHost, scribe: Scribe, records: readonly Written[]): void {
  Band.receive(scribe.band, records)

  if (records.length > 0 && scribe.band.receipt !== null) {
    expire(host, scribe, scribe.band.receipt.serial)
  }
}

/** Does what could not be done when it was asked for. Each is tried once more and then let go. */
async function flush(host: ScribeHost, scribe: Scribe, who: Identity): Promise<void> {
  const waiting = scribe.deferred

  scribe.deferred = []

  const written: Written[] = []

  for (const work of waiting) {
    if ('draft' in work) {
      const one = await record(host, scribe, who, work.draft)

      if (one !== undefined) {
        written.push(one)
      }
    } else {
      await call(host, work.tool, work.args).catch(() => undefined)
    }
  }

  receive(host, scribe, written)
}

/** Brings up what may now be shown, and sees to what was let go unseen. */
function settle(host: ScribeHost, scribe: Scribe): void {
  const settled = Band.settle(scribe.band)

  for (const item of settled.dropped) {
    // The question is let go; the decision it was about is still recorded.
    if (item.kind === 'question' && item.form === 'reversal') {
      defer(scribe, { draft: { ...item.draft, supersedes: null } })
    }
  }

  if (settled.isKeptChanged) {
    keep(host, scribe.band)
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
  const written: Written[] = []

  for (const [index, draft] of verdict.records.entries()) {
    const isAskedOf = question?.record === index
    const prior = isAskedOf && question.form === 'reversal' ? facts.get(question.prior) : undefined

    if (isAskedOf) {
      scribe.asked = [...scribe.asked, draft.content].slice(-MAX_LISTED)
    }

    // A decision that may replace a recorded one is written once the
    // developer has said which it is; when they cannot be asked, it is
    // written beside the old one.
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

      draft.supersedes = null
    }

    const one = await record(host, scribe, who, draft)

    if (one === undefined) {
      continue
    }

    written.push(one)

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

  receive(host, scribe, written)

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
 */
async function lookUp(host: ScribeHost, scribe: Scribe, who: Identity): Promise<void> {
  const files = scribe.paths.slice(0, MAX_LOOKUP_PATHS)
  const { epoch } = scribe

  scribe.paths = scribe.paths.slice(MAX_LOOKUP_PATHS)

  if (files.length === 0) {
    return
  }

  for (const file of files) {
    scribe.lookedUp.add(file)
  }

  const facts = factsOf(await call(host, 'recall', { repo: who.repo, paths: files }))

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
  return new Promise(resolve => {
    const timer = host.after(ms, resolve)
    const done = (): void => {
      timer.cancel()
      resolve()
    }

    void work.then(done, done)
  })
}

function wanted(scribe: Scribe, files: readonly string[]): void {
  for (const file of files) {
    if (!scribe.lookedUp.has(file) && !scribe.paths.includes(file)) {
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

  if ((index + 1) % LOOKUP_EVERY !== 0 || scribe.paths.length === 0 || (await host.server()) === undefined) {
    return
  }

  await within(
    host,
    lookUp(host, scribe, who).catch(() => undefined),
    LOOKUP_WAIT_MS,
  )
}

/** Where the rows not yet seen begin: after the ones a wake went through, or at the prompt that began this turn. */
function startOf(scribe: Scribe, rows: readonly Row[]): number {
  if (scribe.consumed >= 0 && scribe.consumed <= rows.length) {
    return scribe.consumed
  }

  for (let at = rows.length - 1; at >= 0; at -= 1) {
    const row = rows[at]

    if (row?.role === 'user' && row.text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim() !== '') {
      return at
    }
  }

  return 0
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
 * A turn of the main conversation ended. Scribe reads what happened since
 * it last looked, looks up the files touched, runs one wake over it, acts on
 * the verdict, and attaches any commit the turn made to the session's
 * records.
 *
 * A wake that did not come to a verdict leaves the rows unread, so the next
 * turn's wake has them too.
 */
export async function completed(host: ScribeHost, scribe: Scribe): Promise<void> {
  scribe.band.isWorking = false
  scribe.band.hasAskedThisTurn = false

  const who = await identityOf(host, scribe)

  // Signed out, nothing is read and no model is asked.
  if (who === null || (await host.server()) === undefined) {
    return
  }

  await flush(host, scribe, who)

  const rows = await host.rows()
  const from = startOf(scribe, rows)
  const seen = observe(rows.slice(from), who.root)

  // Held from here on: a wake that comes to nothing leaves these rows for the next.
  scribe.consumed = from

  for (const plan of seen.plans) {
    if ('text' in plan) {
      Plans.keep(scribe.plans, plan.key, plan.path, plan.text)
    } else {
      Plans.edit(scribe.plans, plan.key, plan.before, plan.after)
    }
  }

  wanted(scribe, seen.touched)
  await within(
    host,
    lookUp(host, scribe, who).catch(() => undefined),
    LOOKUP_WAIT_MS,
  )

  if (!scribe.isWaking && seen.lines.length > 0) {
    scribe.isWaking = true

    try {
      const { epoch } = scribe
      const shown = [...scribe.anchored.values()]
      const plans = planBlock(scribe.plans.docs)
      const past = scribe.past.map((block, at) => (at === scribe.past.length - 1 ? { ...block, cache: true as const } : block))
      const woken = await wake(host, {
        model: scribe.options.model,
        system: SYSTEM,
        fixed: [...(plans === undefined ? [] : [plans]), ...past],
        current: wakeText(who.repo, seen.lines, seen.dropped, shown, {
          recorded: scribe.recorded,
          asked: scribe.asked,
          told: [...scribe.band.told],
        }),
        repo: who.repo,
        shown,
        seen: {
          plans: scribe.plans.docs,
          saidNoReason: mentionsNoReason(seen.developer),
        },
      })

      if (woken.ending === 'verdict' && epoch === scribe.epoch) {
        const before = scribe.written.length

        scribe.consumed = rows.length
        scribe.anchored.clear()
        scribe.wakes += 1
        await apply(host, scribe, who, woken.verdict, woken.facts)
        scribe.past = [
          ...scribe.past,
          pastBlock(scribe.wakes, gist(seen.lines), summaryOf(woken.verdict, scribe.written.slice(before))),
        ]

        // Let go in one piece, so the blocks that stay are read from the
        // prompt cache until the next cut.
        if (scribe.past.length > MAX_PAST) {
          scribe.past = scribe.past.slice(-MAX_PAST / 2)
        }
      }
    } finally {
      scribe.isWaking = false
    }
  }

  settle(host, scribe)
  await flush(host, scribe, who)

  // The turn is over: the next one has its own tell.
  scribe.band.tellsThisTurn = 0

  // A commit is attached to what this session recorded, once.
  for (const sha of seen.commits) {
    if (!scribe.commits.has(sha) && scribe.written.length > 0) {
      scribe.commits.add(sha)
      await call(host, 'attach_commit', {
        repo: who.repo,
        sha,
        session_id: who.sessionId,
      }).catch(() => undefined)
    }
  }

  host.redraw()
}

/**
 * The developer sent a prompt. Only what is already in hand is worked on,
 * and nothing is waited for: the prompt goes on at once.
 */
export function prompted(host: ScribeHost, scribe: Scribe): void {
  const { band } = scribe
  const wasQuiet = band.current === null && band.receipt === null && band.queue.length === 0
  const item = Band.submitted(band)

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

  if (wasTyping && !isTyping && scribe.band.queue.length > 0) {
    settle(host, scribe)
  }
}

/** A record as a note for the prompt box: quoted, and said to be information. */
function noteOf(lead: string, fact: Fact): string {
  const quote = [
    `${fact.kind === 'gotcha' ? 'Gotcha' : fact.kind === 'decision' ? 'Decision' : 'Record'}: ${drawn(fact.content, MAX_CONTENT)}`,
    fact.reasonStatus === 'no_strong_reason'
      ? NO_STRONG_REASON
      : fact.detail.trim() !== ''
        ? `Why: ${drawn(fact.detail, 600)}`
        : fact.kind === 'decision'
          ? NOT_STATED
          : '',
    fact.alternatives.length === 0 ? '' : `Rejected: ${fact.alternatives.map(one => drawn(one, 80)).join('; ')}`,
    fact.link ?? '',
  ]

  // A note never mentions a file or a person by the box's own marks.
  return `${lead}\n\n${quote
    .filter(line => line !== '')
    .map(line => `> ${line.replace(/@/g, '(at)')}`)
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

async function pressedQuestion(host: ScribeHost, scribe: Scribe, who: Identity, item: Band.Question, key: string): Promise<void> {
  const { band } = scribe

  if (item.form === 'reason') {
    const option = key.startsWith('reason:') ? item.options[Number(key.slice(7))] : undefined

    if (option !== undefined) {
      Band.clear(band)
      await amend(host, scribe, {
        atom_id: item.id,
        op: 'fix',
        detail: option,
        reason_status: 'stated',
      })
    } else if (key === 'other') {
      band.editing = { what: 'reason' }
    } else if (key === 'no-reason') {
      Band.clear(band)
      await amend(host, scribe, {
        atom_id: item.id,
        op: 'fix',
        reason_status: 'no_strong_reason',
      })
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

  const written = await record(host, scribe, who, {
    ...item.draft,
    supersedes: key === 'replaces' ? item.prior.id : null,
  })

  if (written === undefined) {
    return
  }

  receive(host, scribe, [written])

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

/** A key of the band was pressed. */
export async function pressed(host: ScribeHost, scribe: Scribe, key: string): Promise<void> {
  const { band } = scribe
  const who = scribe.identity

  if (who === null || who === undefined) {
    return
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
    scribe.identity = null
    startOver(scribe)
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

    for (const written of [...scribe.written, ...(band.receipt?.records ?? [])]) {
      if (written.id === editing.id) {
        written.content = text
      }
    }

    band.editing = null
    await amend(host, scribe, {
      atom_id: editing.id,
      op: 'fix',
      content: text,
    })
  } else if (
    key === 'reason-text' &&
    editing.what === 'reason' &&
    band.current?.kind === 'question' &&
    band.current.form === 'reason'
  ) {
    if (text === '') {
      return
    }

    const { id } = band.current

    Band.clear(band)

    // "No idea" is an answer too: it is kept as one, in their words, and
    // never passed off as a reason.
    await amend(
      host,
      scribe,
      saysNoReason(text)
        ? {
            atom_id: id,
            op: 'fix',
            detail: text,
            reason_status: 'no_strong_reason',
          }
        : { atom_id: id, op: 'fix', detail: text, reason_status: 'stated' },
    )
  }

  settle(host, scribe)
}

/** What the band shows now; undefined for nothing, and always while Scribe is off. */
export function view(scribe: Scribe, isWorking: boolean): View | undefined {
  return scribe.identity === null || scribe.identity === undefined ? undefined : viewOf(scribe.band, isWorking)
}
