import type { EngineInterface, On, PluginOptions, PromptSubmitResult } from 'claude-code'

import { destinationOf } from './account'
import { cardOf } from './card'
import { withGlyphs } from './citations'
import * as Draft from './draft'
import { restored } from './known'
import type { Host } from './host'
import { keyed } from './listing'
import { briefly, called, close, line, LINE_WAIT_MS, open, passed, REFUSAL, serve, SHORT_WAIT_MS } from './live'
import type { Line, Live } from './live'
import { flush, want } from './lookups'
import { isOwnPrompt } from './origin'
import { decorationsOf } from './paint'
import { isLeftToPlugin } from './project'
import { receiptOf } from './receipts'
import { drawn } from './plain'
import { OWN_SERVER, REFUSED, REPORT_TOOL, verdictFor } from './scribe/grant'
import * as Ledger from './scribe/ledger'
import * as Scribe from './scribe/scribe'
import type { ScribeHost } from './scribe/scribe'
import * as Search from './search'
import * as Session from './session'
import * as Telemetry from './telemetry'
import type { Report, Word } from './telemetry'
import { referencesIn, rowTextOf } from './user-row'
import { PANE, RINGLESS, TITLES, windowOf } from './window'
import type { Which } from './window'

/** No line this plugin shows is longer than this. */
const MAX_LINE = 200

/**
 * The engine calls this plugin makes, each spelled out here once and handed
 * to the plugin's other files as plain functions. Every line shown passes
 * the same sanitiser the chips do.
 *
 * @param live the hook this host is made in, when that hook is one Claude
 *   Code waits on and the host is used while it does. Without it the host
 *   starts no call to Fylgja.
 */
function hostOf($: EngineInterface, session: Session.Session, live?: Live): Host {
  return {
    connect: () => $.mcp.connect('fylgja'),
    call: (server, tool, args) => called(live, () => $.mcp.call(server, tool, args)),
    isLive: () => live?.isOpen === true,
    // The line under the prompt has one owner. Sign-in comes first; when it
    // has nothing to say, the line shows what the plugin left there, if anything.
    status: text => {
      const line = text ?? session.notice

      $.ui.status(line === undefined ? undefined : drawn(line, MAX_LINE))
    },
    redraw: () => $.ui.invalidate('ui.render'),
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
    stored: key => $.store.get(key),
    store: (key, value) => $.store.set(key, value),
  }
}

/** One hook's own way to call a tool on Fylgja: `$.mcp.call`, bound to that hook. */
type Caller = (server: string, tool: string, args: Record<string, unknown>) => Promise<unknown>

function callerOf($: EngineInterface): Caller {
  return (server, tool, args) => $.mcp.call(server, tool, args)
}

/**
 * The engine calls Scribe makes, spelled out here as the others are. A call
 * to Fylgja goes to the session's own connection, under the name the
 * sign-in check last gave for it.
 *
 * @param report notes an event of the plugin's own working (`telemetry.ts`)
 * @param calls given to a host whose work may go on after its hook has
 *   handed back: a call it makes then waits there, a short while, for the
 *   next hook that is being waited on, and is started by that hook. A call
 *   of such a host that was not let through only failed: whether Scribe's
 *   calls are let through at all is found out by a hook that is waited on
 *   for its whole look, never by work that may have been left behind.
 */
function scribeHostOf($: EngineInterface, session: Session.Session, report: Report, live?: Live, calls?: Line<Caller>): ScribeHost {
  const start = (server: string, tool: string, args: Record<string, unknown>): Promise<unknown> =>
    calls === undefined
      ? called(live, () => $.mcp.call(server, tool, args))
      : passed(
          calls,
          live,
          callerOf($),
          (ms, fn) => $.clock.after(ms, fn),
          LINE_WAIT_MS,
          call => call(server, tool, args),
        )

  return {
    server: () => Session.serverOf(hostOf($, session, live), session),
    // Why a call failed is kept as one word: whether it was not let
    // through, or anything else. The engine's own words are not handed on.
    call: (server, tool, args) =>
      start(server, tool, args).catch((error: unknown) => {
        throw new Error(calls === undefined && error instanceof Error && REFUSAL.test(error.message) ? REFUSED : 'failed')
      }),
    lookup: async (tool, args) => {
      const server = await Session.serverOf(hostOf($, session, live), session)

      if (server === undefined) {
        throw new Error('Fylgja is not connected')
      }

      return start(server, tool, args)
    },
    complete: async request => {
      const reply = await $.model.complete(
        {
          model: request.model,
          system: request.system,
          prompt: request.prompt,
          maxTokens: request.maxTokens,
          effort: 'low',
          timeoutMs: request.timeoutMs,
        },
        request.signal === undefined ? {} : { signal: request.signal },
      )

      return {
        text: reply.isAnswered ? reply.text : undefined,
        usage: {
          input: reply.usage.input_tokens,
          output: reply.usage.output_tokens,
          cacheRead: reply.usage.cache_read_input_tokens ?? 0,
          cacheWrite: reply.usage.cache_creation_input_tokens ?? 0,
        },
      }
    },
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
    redraw: () => $.ui.invalidate('ui.render'),
    toast: text => $.ui.toast(drawn(text, MAX_LINE)),
    // Scribe's line goes where every line of the plugin's goes, behind the sign-in line.
    status: text => Session.say(hostOf($, session, live), session, text),
    mark: () => remark($, session),
    debug: text => $.ui.log(drawn(text, MAX_LINE), { to: 'debug' }),
    report,
    box: async () => (await $.prompt.read()).text,
    fill: async text => (await $.prompt.fill({ text, mode: 'replace' })).isFilled,
    stored: key => $.store.get(key),
    store: (key, value) => $.store.set(key, value),
    unstore: key => $.store.delete(key),
    keys: () => $.store.keys(),
    sessionId: () => $.session.id(),
    repo: () => $.session.repo(),
    cwd: () => $.session.cwd(),
    exists: path =>
      $.fs.stat(path).then(
        () => true,
        () => false,
      ),
    read: path => $.fs.read(path),
    size: path =>
      $.fs.stat(path).then(
        stat => (stat.kind === 'file' ? stat.size : undefined),
        () => undefined,
      ),
    send: (agentId, text) => $.session.send({ to: { agentId }, text }).then(sent => sent.isDelivered),
    vouched: root => isLeftToPlugin(hostOf($, session, live), root),
    surfaces: () => $.session.surfaces(),
    run: (argv, timeoutMs) => $.process.run(argv, { timeoutMs }),
    rows: () => $.session.messages(),
    // The plugin's own rows of `/config`, by field, as they stand now.
    settings: async () => Object.fromEntries((await $.config.list()).flatMap(row => {
      const field = ownField(row.key)

      return field === undefined ? [] : [[field, row.value]]
    })),
    destination: () =>
      session.account.state === 'pinned' && session.account.who !== undefined ? destinationOf(session.account.who) : undefined,
  }
}

/** The field a `/config` key names when it is one of this plugin's own (`fylgja.<field>`); undefined otherwise. */
function ownField(key: string): string | undefined {
  const at = key.indexOf('.')

  return at === -1 || key.slice(0, at).split('@')[0] !== 'fylgja' ? undefined : key.slice(at + 1)
}

/**
 * The way a batch of the plugin's own events is sent from one hook: on the
 * session's connection, while that hook is being waited on, and only while
 * Fylgja is here for the account this machine is set up for.
 */
function doorOf($: EngineInterface, session: Session.Session, live: Live): Telemetry.Door {
  return {
    server: session.isHere && session.server === OWN_SERVER ? session.server : undefined,
    isOpen: () => live.isOpen,
    call: (server, tool, args) => called(live, () => $.mcp.call(server, tool, args)),
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
  }
}

/** Sends one batch of what waits, for a moment at most; what it started goes on. Never fails. */
function sendEvents($: EngineInterface, session: Session.Session, telemetry: Telemetry.Telemetry, live: Live): Promise<void> {
  return briefly((ms, fn) => $.clock.after(ms, fn), Telemetry.send(telemetry, doorOf($, session, live)), SHORT_WAIT_MS)
}

/** Brings the mark above the prompt up to date; see `Session.remark`. No call to Fylgja is started for it. */
function remark($: EngineInterface, session: Session.Session): void {
  Session.remark(hostOf($, session), session)
}

/**
 * Brings the mark up to date.
 *
 * @param noted told once that is done: whether Fylgja is here is noted then
 */
function refresh($: EngineInterface, session: Session.Session, noted?: () => void): void {
  remark($, session)
  noted?.()
}

/** The conversation's id, or undefined where it cannot be read. */
async function idOf($: EngineInterface): Promise<string | undefined> {
  try {
    return await $.session.id()
  } catch {
    return undefined
  }
}

/** The mark's own key: pressing the mark opens the window of what was kept. */
const MARK_KEY = 'kept'

/** How long after the mark opened the window the keys are asked for again: long enough for the band to be drawn without the mark. */
const HANDOVER_MS = 60

/** The window is asked to open no shorter and no taller than this, above the prompt. */
const MIN_ROWS = 6
const MAX_ROWS = 18

/** What the window holds beside one row a record: its title, the selected record opened, and the line of keys. */
const ROWS_AROUND = 8

/**
 * Fylgja's one window: which of its views it shows, and what the search
 * view holds. What the view of what was kept holds is Scribe's. One view is
 * up at a time, so the title bar, the rows, the ring and the keys are the
 * same code whichever it is.
 */
type Win = { which: Which; search: Search.Search }

/** Whether the window is open, on either view. */
function isUp(scribe: Scribe.Scribe, win: Win): boolean {
  return scribe.ledger.isOpen || win.search.isOpen
}

/** Notes whether the window is open on the view it shows; the other view is not. */
function noted(scribe: Scribe.Scribe, win: Win, isOpen: boolean): void {
  scribe.ledger.isOpen = isOpen && win.which === 'kept'
  win.search.isOpen = isOpen && win.which === 'search'
}

/**
 * Opens the window on the view it is set to, or brings it the keys when it
 * is open. The keys are asked for, not taken: where the prompt box holds
 * text or a dialog is up, Claude Code keeps them and the window is shown all
 * the same. Escape closes it. It holds back nobody's toasts.
 */
async function openWindow($: EngineInterface, scribe: Scribe.Scribe, win: Win): Promise<Word<'window', 'outcome'>> {
  // The search view has its field above the records and its line in place of them, and opens a record to more lines than a kept one has.
  const found = win.search.hits.length
  const listed = win.which === 'kept' ? Scribe.ledgerEntries(scribe).length : found + (found === 0 ? 2 : 5)
  const rows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, listed + ROWS_AROUND))

  let outcome: Word<'window', 'outcome'> = 'opened'

  noted(scribe, win, true)

  try {
    const opened = await $.ui.open({ id: PANE, title: TITLES[win.which], focus: true, closeOnEscape: true, rows })

    // Open, and no surface draws it: the person asked for it and sees nothing, so they are told why,
    // and it is not left waiting to come up later by itself.
    if (!opened.isPlaced) {
      outcome = 'not_placed'
      $.ui.toast(drawn(`Fylgja: the window cannot be shown here. ${opened.reason}`, MAX_LINE))
      await closeWindow($, scribe, win)
    }
  } catch {
    // Not opened: nothing is drawn, and the next press asks again.
    outcome = 'failed'
    noted(scribe, win, false)
    $.ui.toast('Fylgja: the window could not be opened here.')
  }

  // While it is open the mark is text, and a key again when it is not.
  $.ui.invalidate('ui.render')

  return outcome
}

/**
 * Shows what was kept, because the person asked for it: the search view, if
 * that was up, lets go of what it held half done.
 *
 * @param by how they asked: the mark, or the command
 */
async function openKept(
  $: EngineInterface,
  scribe: Scribe.Scribe,
  win: Win,
  report: Report,
  by: Word<'window', 'opened_by'>,
): Promise<void> {
  Search.closed(win.search)
  win.which = 'kept'
  report('window', {
    view: 'kept',
    opened_by: by,
    outcome: await openWindow($, scribe, win),
    records_listed: Scribe.ledgerEntries(scribe).length,
  })
}

/**
 * Before the window lists what was kept: what Scribe kept in this
 * conversation before the plugin was loaded afresh for it is picked up, in
 * the hook that opens it and for a moment at most. Nothing is asked once
 * that is done.
 */
async function recovered($: EngineInterface, session: Session.Session, scribe: Scribe.Scribe, report: Report): Promise<void> {
  if (scribe.recovery !== 'pending') {
    return
  }

  const live = open()

  try {
    await briefly((ms, fn) => $.clock.after(ms, fn), Scribe.recover(scribeHostOf($, session, report, live), scribe), SHORT_WAIT_MS)
  } finally {
    close(live)
  }
}

/**
 * One search of the developer's, noted once it has been answered or has
 * failed: how it was asked for, how it ended, how long it took and how many
 * it found as one of four sizes. Nothing of what was looked for or found.
 */
async function searched(
  report: Report,
  session: Session.Session,
  search: Search.Search,
  by: Word<'search', 'asked_by'>,
  look: () => Promise<void>,
): Promise<void> {
  const { asked } = search
  const began = performance.now()

  try {
    await look()
  } finally {
    // Asked, and the answer was this search's: one that was not made, or that another took the place of, is not counted.
    if (search.asked !== asked && search.phase !== 'searching') {
      report('search', {
        asked_by: by,
        outcome: search.phase === 'found' ? 'found' : session.isHere ? 'failed' : 'signed_out',
        results: Telemetry.sizeOf(search.hits.length),
        duration_ms: performance.now() - began,
      })
    }
  }
}

/**
 * A search was answered while the window shows it: the window is asked to
 * be as tall as what was found needs, since it was opened before anything
 * was, and for the keys it had.
 */
async function fitFound($: EngineInterface, scribe: Scribe.Scribe, win: Win): Promise<void> {
  if (win.which === 'search' && win.search.isOpen && win.search.hits.length > 0) {
    await openWindow($, scribe, win)
  }
}

/** Closes the window, whichever view it shows. */
async function closeWindow($: EngineInterface, scribe: Scribe.Scribe, win: Win): Promise<void> {
  Ledger.closed(scribe.ledger)
  Search.closed(win.search)

  // The mark is a key again, when it is next drawn if not now.
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // The window is closed all the same.
  }

  try {
    await $.ui.close({ id: PANE })
  } catch {
    // Kept open by another plugin's hook: it is theirs to say, and the next press closes it.
    noted(scribe, win, true)
  }
}

/**
 * Which conversation what the plugin holds is of, by its id: a /clear, a
 * resume or a branch goes on under another id in the same session.
 *
 * `seen` is a conversation started over because its id was seen to change
 * before Claude Code said that the one before ended; that end then drops
 * nothing more. `left` is the id of the conversation that ended, while the
 * id read from the session may still be that one: read then, it is not
 * another conversation. `ending` is how it ended, until the id of the one
 * that begins is read.
 */
type Conversation = {
  id: string | undefined
  seen: string | undefined
  left: string | undefined
  ending: 'clear' | 'resume' | undefined
}

/** Everything the plugin holds of the conversation it is in. */
type Held = { session: Session.Session; draft: Draft.Draft; scribe: Scribe.Scribe; win: Win; conversation: Conversation }

/**
 * What was known of the conversation before is dropped: the references
 * looked up, the draft and what Scribe held of it. The rows that are still
 * on screen, or come back, are drawn again and have their references noted
 * for the next hook that may ask Fylgja. Who is signed in stands: a new
 * conversation does not change it.
 *
 * What is held is dropped first, all of it. Then Claude Code is asked to
 * draw again, each ask on its own, so one it turns down leaves the others.
 * It never fails.
 */
async function startOver($: EngineInterface, held: Held): Promise<void> {
  const { session, draft, scribe, win } = held

  Session.startOver(session)
  Draft.startOver(draft)
  Scribe.startOver(scribe)

  // What the window listed was the conversation's before. The search view stays up, and lets go of what it found when it is next looked at.
  if (scribe.ledger.isOpen) {
    await closeWindow($, scribe, win)
  }

  try {
    $.ui.invalidate('ui.render')
  } catch {
    // The rows are drawn again when Claude Code next draws them.
  }
}

/**
 * Takes up the conversation the session is in when it is another than the
 * one last seen, by the id the session reads. A conversation that ended
 * (see `ended`) was started over at its end, and the one that begins is
 * followed from here: its own log is the one picked up. A branch has no
 * end of its own to say so, and starts over here when its id is first
 * read. It is read where the conversation is next touched: the box typed
 * into, a prompt sent, a command of the plugin's.
 *
 * True when the conversation in hand is another one, so that a hook Claude
 * Code waits on can ask who is signed in again (`vouch`).
 */
async function caughtUp($: EngineInterface, held: Held): Promise<boolean> {
  const id = await idOf($)
  const { conversation } = held
  const before = conversation.id
  const { ending } = conversation

  if (id === undefined || id === conversation.left) {
    return false
  }

  conversation.left = undefined

  if (id === before) {
    return false
  }

  conversation.id = id
  conversation.ending = undefined

  // The first id read is the conversation the plugin started in.
  if (before === undefined && ending === undefined) {
    return false
  }

  // A resumed conversation may be another directory's: its project is looked at before Fylgja is next asked anything.
  try {
    Session.located(held.session, await $.session.cwd())
  } catch {
    // Looked at again when the session is next found to have moved.
  }

  if (ending === undefined) {
    conversation.seen = id
    await startOver($, held)
  }

  // Still the conversation the plugin was loaded for, when no turn has ended since: see `Scribe.followed`.
  // What it kept before is picked up from its own log: none after a `/clear`.
  Scribe.followed(held.scribe, id, ending)

  return true
}

/**
 * The conversation ended by a `/clear` or a resume, under the id `id`, and
 * the session goes on with another. Everything held of it is dropped now,
 * and who is signed in is to be asked again before Fylgja is next asked
 * anything. The one that begins is taken up once its id is read (see
 * `caughtUp`). Where that id was read first, the conversation was started
 * over then, and only what its end says is taken from here: a `/clear`
 * picks up nothing.
 */
async function ended($: EngineInterface, held: Held, id: string, reason: 'clear' | 'resume'): Promise<void> {
  const { conversation, session, scribe } = held

  Session.revet(session)

  if (conversation.seen !== undefined && conversation.seen === conversation.id && id !== conversation.id) {
    conversation.seen = undefined
    Scribe.followed(scribe, conversation.id, reason)

    return
  }

  conversation.seen = undefined
  conversation.left = id
  conversation.id = undefined
  conversation.ending = reason
  await startOver($, held)
  Scribe.ended(scribe)
}

/**
 * After a start over, in a hook that Claude Code waits on: who is signed in,
 * and the references the rows on screen noted, are asked about for a
 * moment. A start over anywhere else leaves them to the next such hook.
 * `noted` is told once that is done, as `refresh` tells it.
 *
 * @param ms how long the moment is at most
 */
async function vouch($: EngineInterface, held: Held, noted?: () => void, ms = SHORT_WAIT_MS): Promise<void> {
  const live = open()

  try {
    const host = hostOf($, held.session, live)

    await briefly(host.after, flush(host, held.session), ms)
  } finally {
    close(live)
    refresh($, held.session, noted)
  }
}

/**
 * Reads the context window, as a prompt is sent, a step of a turn begins or
 * a turn ends, for a compaction Claude Code said it made since it was last
 * read (`Scribe.windowRead`). A step also learns whether a compaction is
 * near (`Scribe.isNearCompaction`), and as a turn begins the count it comes
 * at is read again. `isDue` when the step should have Scribe look now: the
 * conversation was just compacted, or is about to be, and then `near` is
 * the window's reading that a look made for that is noted at. Never fails,
 * and asks nothing of Fylgja.
 *
 * @param when as a prompt is sent, a step begins or a turn ends
 * @param step the step's place in its turn, for a step
 */
async function watchWindow(
  $: EngineInterface,
  held: Held,
  report: Report,
  when: 'prompt' | 'step' | 'end',
  step = 0,
): Promise<{ isDue: boolean; near?: number }> {
  const { session, scribe } = held

  if (!Scribe.watchesWindow(scribe)) {
    return { isDue: false }
  }

  try {
    const isCompacted = await Scribe.windowRead(scribeHostOf($, session, report), scribe, when)

    if (when !== 'step') {
      return { isDue: isCompacted }
    }

    const { context } = await $.session.usage()

    if (step === 0) {
      const { breakdown } = (await $.session.usage({ breakdown: 'summary' })).context

      Scribe.compactsAt(scribe, breakdown === undefined || !breakdown.isAutoCompactEnabled ? null : (breakdown.autoCompactThreshold ?? null))
    }

    if (Scribe.isNearCompaction(scribe, context.tokens, step)) {
      return { isDue: true, near: context.tokens }
    }

    return { isDue: isCompacted }
  } catch (error) {
    report('error', { component: 'context', kind: 'threw', cause: Telemetry.causeOf(error) })

    return { isDue: false }
  }
}

/**
 * What a prompt being sent carries beside it for Claude: what it came with,
 * and the records the session kept while they are owed after a compaction
 * (see `Scribe.handed`); undefined when it takes nothing more. A slash
 * command takes nothing. Never fails.
 */
async function carriedWith(
  $: EngineInterface,
  held: Held,
  report: Report,
  e: { command?: unknown; context?: readonly string[] },
): Promise<readonly string[] | undefined> {
  if (e.command !== undefined) {
    return undefined
  }

  await watchWindow($, held, report, 'prompt')

  const text = Scribe.handed(held.scribe, held.session.isHere)

  return text === undefined ? undefined : [...(e.context ?? []), text]
}

/** The prompt box as the search view reaches it: read as it stands, and written at the cursor alone. */
function boxOf($: EngineInterface): Search.Box {
  return {
    read: () => $.prompt.read(),
    insert: async (text, decorations) => (await $.prompt.fill({ text, mode: 'insert', decorations })).isFilled,
  }
}

/**
 * Puts the window's focus ring where the window now is, once it has been
 * drawn again: on the selected record's row, or, while that record's keys
 * are up, on the key that waits for its second press or else the first of
 * them; in the search view, in its field while what is typed goes there.
 * The row is brought into view. Only a window that holds the keys has a
 * ring to move; any other is left as it is.
 */
function ring($: EngineInterface, session: Session.Session, scribe: Scribe.Scribe, win: Win): void {
  const key =
    win.which === 'search' ? Search.ringKey(win.search, session.isHere) : Ledger.ringKey(Scribe.ledgerEntries(scribe), scribe.ledger)

  if (key === undefined) {
    return
  }

  $.clock.after(0, () => {
    void $.ui.focus({ requestId: PANE, key }).catch(() => {
      // A surface with no ring to move: said once, in fixed words, where only someone looking for it reads it.
      if (!scribe.said.has(RINGLESS)) {
        scribe.said.add(RINGLESS)
        $.ui.log(RINGLESS, { to: 'debug' })
      }
    })
    void $.ui.scroll({ in: PANE, to: { key } }).catch(() => undefined)
  })
}

/**
 * Fylgja inside Claude Code, quietly: it says when Fylgja needs sign-in, and
 * draws pasted references, links to records and the rare write as what they
 * are.
 *
 * Nothing is added to the conversation and no prompt is made to wait. A
 * reference pasted into the prompt box is shown there as a short chip, and
 * the one hook that sees a prompt on its way to Claude puts the reference
 * back exactly as it was pasted. That hook only works on the text in hand:
 * it asks nothing of Fylgja, and of Claude Code only which conversation it
 * is in. Claude opens a reference with Fylgja's tools when it chooses to.
 *
 * The one lookup, a reference's title for its chip in the message row, is
 * noted by the row that shows it and asked by the next hook Claude Code
 * waits on (the start of the session, a step of a turn, a turn's end): no
 * call to Fylgja is ever started from a row being drawn, from a timer or
 * from work a hook left behind. It rides the session's own Fylgja
 * connection, and a failure leaves the row as it is drawn without an answer.
 *
 * Scribe is the one part that does more than draw: at the end of a turn,
 * and inside one when the developer has answered a question of Claude's, it
 * reads what happened, asks its own model, and writes to Fylgja. It runs
 * beside the conversation and never in it: nothing it reads, asks or writes
 * is added to what Claude reads, and no prompt waits for it.
 *
 * The one exception is a conversation that was compacted. The summary that
 * takes its place may or may not hold what was decided in it, so the
 * records Scribe kept in the session go to Claude once after it, as one
 * block of the plugin's own that Claude reads beside the next tool result or
 * prompt and the developer never sees (see `scribe/carry.ts`). The summary is
 * left as Claude Code made it.
 *
 * Every hook here works the same where an organization seats its own guard
 * ahead of a person's plugins. Such a guard sends the events it keeps out of
 * a person's reach (the classic settings hooks, the context and the system
 * prompt, the rows Claude Code makes for the model, a compaction, settings)
 * on past them, and Claude Code then says that each hook of theirs there
 * was skipped; so none is hooked. What the plugin needs of them it learns
 * from what stays in view: the end of a conversation (`session.end`), the
 * id the session reads, the rows of the conversation and the context
 * window's reading. The one hook the guard can still pass over is the
 * permission check, for the plugin's own calls (see below).
 *
 * What Scribe kept in the session is listed in a window the developer
 * opens, by pressing the mark above the prompt or with `/fylgja-kept`. It
 * never opens by itself, and it draws from what the plugin already holds.
 *
 * The same window searches Fylgja's knowledge atoms when the developer
 * types `/fylgja-search`. Fylgja is asked on their Enter and at no other
 * time, what it found is shown to them and not to Claude, and nothing of it
 * reaches the conversation but the reference of a record they chose to
 * cite, put into the prompt box for them to send (see `search.ts`).
 */
export function register(on: On, options: PluginOptions = {}): void {
  const session = Session.create()
  const draft = Draft.create()
  const scribe = Scribe.create({ isOn: options.scribe !== false, settings: options })
  const win: Win = { which: 'kept', search: Search.create() }
  // What the plugin reports about its own working, unless its option is off: counts and fixed words, held in memory until a hook sends them.
  const telemetry = Telemetry.create(options.telemetry !== false)
  // Whether Fylgja is here, as last reported: a change of it is an event of its own.
  let signedIn: Word<'sign_in', 'state'> | undefined
  const noteSignIn = (): void => {
    const state: Word<'sign_in', 'state'> = session.isHere
      ? 'here'
      : session.account.state === 'other'
        ? 'other_account'
        : session.signIn.isShown
          ? 'needs_sign_in'
          : 'not_here'

    if (signedIn !== undefined && state !== signedIn) {
      report('sign_in', { state })
    }

    signedIn = state
  }
  const report: Report = (name, props) => {
    try {
      Telemetry.record(telemetry, name, props)
    } catch {
      // An event that could not be noted is nobody's trouble but its own.
    }
  }

  // What the mark says of Scribe is read from Scribe when the line is written.
  session.doing = () => Scribe.doing(scribe)
  // The keys pressed and the lines entered in the band, as its elements'
  // own handlers took them; the hook on the press does the work.
  const presses: string[] = []
  const entries: { key: string; value: string }[] = []
  // The same for the window, whichever view it shows.
  const picks: string[] = []
  const lines: string[] = []
  // The calls to Fylgja of a look that outlived the hook it began in.
  const calls = line<Caller>()
  const held: Held = { session, draft, scribe, win, conversation: { id: undefined, seen: undefined, left: undefined, ending: undefined } }

  on('session.start', async ($, e, next) => {
    Session.startOver(session)
    Session.located(session, e.cwd)
    Session.revet(session)
    Scribe.started(scribe, e.isInteractive, e.surface)

    const id = await idOf($)

    held.conversation.id = id ?? held.conversation.id
    held.conversation.left = undefined
    held.conversation.ending = undefined
    Scribe.loaded(scribe, id)
    Telemetry.started(telemetry, e.surface)
    signedIn = undefined

    const started = await next(e)
    const live = open()

    // Who is signed in is asked here, and what is already on screen looked
    // up, but the session is not held for it: after a moment it starts
    // whether or not Fylgja has answered. The sign-in line's state is
    // written whatever the answer, because a plugin that was just loaded
    // cannot know whether an earlier load left the line up.
    try {
      const host = hostOf($, session, live)

      await briefly(host.after, flush(host, session, true), SHORT_WAIT_MS)
      // A conversation the plugin was loaded afresh for, a moment more: what Scribe kept in it before.
      await briefly(host.after, Scribe.recover(scribeHostOf($, session, report, live), scribe), SHORT_WAIT_MS)
    } catch (error) {
      report('error', { component: 'session_start', kind: 'threw', cause: Telemetry.causeOf(error) })

      throw error
    } finally {
      close(live)
      refresh($, session, noteSignIn)
    }

    // Which plugin and engine this is and what time it is by the engine's clock, for the events the plugin reports. None of it is asked of Fylgja.
    if (telemetry.isOn) {
      try {
        Telemetry.pluginIs(telemetry, await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))
      } catch {
        // Reported without it.
      }

      try {
        Telemetry.engineIs(telemetry, (await $.session.version()).base)
      } catch {
        // Reported without it.
      }

      try {
        Telemetry.anchored(telemetry, await $.clock.now())
      } catch {
        // An event's time is then the time it is sent.
      }

      report('session_started', {
        is_interactive: e.isInteractive,
        is_signed_in: session.isHere,
        is_scribe_on: options.scribe !== false,
      })
    }

    // The way to the window of what was kept for a terminal that reports no clicks.
    try {
      await $.command.register({ name: 'fylgja-kept', description: 'Show what Fylgja kept in this session', immediate: true })
    } catch {
      // The mark still opens it.
    }

    // The one way to the search: nothing else opens it.
    try {
      await $.command.register({
        name: 'fylgja-search',
        description: 'Search Fylgja for what was decided and why',
        argumentHint: '[what to look for]',
        immediate: true,
      })
    } catch {
      // Claude can still search with Fylgja's own tool.
    }

    return started
  }).catch(($, e, next) => next(e))

  // Typed by the developer, so the window opens. It answers with no line of
  // its own: a command's line is read by Claude, and the window says it all.
  on('command.run', { command: 'fylgja-kept' }, async $ => {
    if (await caughtUp($, held)) {
      await vouch($, held, noteSignIn)
    }

    await recovered($, session, scribe, report)
    await openKept($, scribe, win, report, 'command')

    return {}
  })

  // Typed by the developer, so the window opens on its search view, which
  // starts over. With words after the command they are searched for at
  // once, as Enter in the field would: the one call to Fylgja a search is,
  // made here, where the command is being waited on. With none the ring is
  // in the field, and nothing is asked until Enter. It answers with no line
  // of its own either: what was found is the developer's to read, not Claude's.
  on('command.run', { command: 'fylgja-search' }, async ($, e) => {
    const query = Search.queryOf(e.args)

    if (await caughtUp($, held)) {
      await vouch($, held, noteSignIn)
    }

    Ledger.closed(scribe.ledger)
    win.which = 'search'
    Search.current(win.search, session.epoch)
    Search.begun(win.search, query !== '')
    report('window', { view: 'search', opened_by: 'command', outcome: await openWindow($, scribe, win) })

    if (query !== '' && win.search.isOpen) {
      const live = open()

      try {
        await searched(report, session, win.search, 'command', () => Search.look(hostOf($, session, live), session, win.search, query))
      } catch {
        // The view says what it has.
      } finally {
        close(live)
        remark($, session)
      }

      await fitFound($, scribe, win)
    }

    ring($, session, scribe, win)

    return {}
  })

  // A conversation that ends by a `/clear` or a resume, while the session
  // goes on with another: everything held of it is dropped as it ends, and
  // the one that begins is taken up once the session reads its id, which may
  // be the moment this end is through. Who is signed in is asked again,
  // along with the rows on screen, once the end is through. The end has one
  // short while that every hook on it shares, so this takes half of what is
  // left of it at most; what is not answered by then is asked in the next
  // hook Claude Code waits on. A branch has no end of its own, and is started
  // over when its id is first read (see `caughtUp`).
  on('session.end', { reason: ['clear', 'resume'] }, async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      await ended($, held, e.sessionId, e.reason)
    }

    const done = await next(e)

    await caughtUp($, held)
    await vouch($, held, noteSignIn, Math.min(SHORT_WAIT_MS, next.budget.remainingMs / 2))

    return done
  }).catch(($, e, next) => next(e))

  // Claude Code compacting the main conversation, said two ways: its own
  // dispatch, once the compaction is made, and the boundary row it appends.
  // Either is enough; together they are one compaction (see
  // `Scribe.compactionSignalled`). A summary made ahead of time, one called
  // off and a subagent's own are no compaction of the conversation.
  on('session.compact', async ($, e, next) => {
    const done = await next(e)

    if (e.trigger !== 'precompute' && e.agentId === undefined && done.skip === undefined) {
      Scribe.compactionSignalled(held.scribe, await $.clock.now(), { by: 'event' })
    }

    return done
  }).catch(($, e, next) => next(e))

  on('session.append', { door: 'compaction' }, async ($, e, next) => {
    const done = await next(e)

    if (e.agentId === undefined && e.message.type === 'system' && e.message.name === 'compact_boundary') {
      Scribe.compactionSignalled(held.scribe, await $.clock.now(), { by: 'boundary', id: e.uuid })
    }

    return done
  }).catch(($, e, next) => next(e))

  on('prompt.edit', async ($, e, next) => {
    // Typing is not held for it: the conversation starts over beside the edit, if it is another one.
    void caughtUp($, held)

    const box = await next(e)

    // Whether the developer is typing; what waits above the prompt comes up
    // once the box is empty. Nothing is asked of anyone for it.
    try {
      Session.typed(hostOf($, session), session, box.text)
      Scribe.typed(scribeHostOf($, session, report), scribe, box.text)
    } catch {
      // The box is drawn all the same.
    }

    try {
      const { text, start, end, inputText } = e
      const shown = Draft.edited(draft, { text, start, end, inputText, key: e.key?.key }, box)
      const paint = decorationsOf(shown.text, shown.chips, shown.strangers)

      if (paint.length === 0 && shown.text === box.text) {
        return box
      }

      // Paint asked for beneath stays on the characters it was asked for.
      const theirs = (box.decorations ?? []).map(run => ({ ...run, start: shown.at(run.start), end: shown.at(run.end) }))

      return { ...box, text: shown.text, cursor: shown.cursor, decorations: [...theirs, ...paint] }
    } catch {
      // The box is left as the editor made it, its references painted where they stand.
      const paint = decorationsOf(box.text)

      return paint.length === 0 ? box : { ...box, decorations: [...(box.decorations ?? []), ...paint] }
    }
  }).catch(($, e, next) => next(e))

  // A prompt entered at the prompt box only; no other prompt passed through
  // it, so no other holds a chip. Everything before `next` is work on the
  // text in hand and reads of the session (which conversation it is, and
  // whether the context window has a reading), so the prompt is never made
  // to wait on Fylgja; if it fails, the prompt goes on as it was entered.
  // Nothing is forgotten here: a prompt brought back into the box has its
  // chips, and is sent with its references. The first prompt of another
  // conversation is the first of what Scribe holds of it.
  //
  // The first prompt after the conversation was compacted, whoever sent it,
  // takes the records the session kept along, once, as what Claude reads
  // beside it (see `Scribe.handed`), unless a tool result took them first; a
  // slash command does not. They are owed until the prompt has entered: one
  // that a hook beneath turns back leaves them for the next.
  on('prompt.submit', async ($, e, next) => {
    await caughtUp($, held)

    const entered = (done: PromptSubmitResult, context: readonly string[] | undefined): PromptSubmitResult => {
      if (context !== undefined && done.drop === undefined) {
        Scribe.takenIn(scribeHostOf($, session, report), scribe)
      }

      return done
    }

    if (e.origin.kind !== 'composer') {
      // A prompt sent from the person's phone or browser is theirs too.
      if (isOwnPrompt(e.origin)) {
        try {
          Session.prompted(hostOf($, session), session)
          Scribe.prompted(scribeHostOf($, session, report), scribe, e.text)
        } catch {
          // The prompt goes on as it was sent.
        }
      }

      const context = await carriedWith($, held, report, e)

      return entered(await next(context === undefined ? e : { ...e, context }), context)
    }

    const text = restored(draft.known, e.text)

    Draft.startOver(draft)

    // Work on what is already in hand, and nothing awaited: an offer the
    // developer typed past is taken down.
    try {
      Session.prompted(hostOf($, session), session)
      Scribe.prompted(scribeHostOf($, session, report), scribe, text)
    } catch {
      // The prompt goes on as it was entered.
    }

    const context = await carriedWith($, held, report, e)

    return entered(await (text === e.text && context === undefined ? next(e) : next({ ...e, text, ...(context === undefined ? {} : { context }) })), context)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    // Expanded, the row shows the message exactly as it was sent.
    if (e.props.isExpanded || !isOwnPrompt(e.props.origin)) {
      return next(e)
    }

    // The row is drawn now with what is known, and its references are noted
    // for the next hook that may ask Fylgja; nothing is asked from here.
    // A row handed the text as it was typed is drawn from what was sent for it.
    const sent = e.props.origin.kind === 'composer' ? restored(draft.known, e.props.text) : e.props.text

    want(session, referencesIn(sent))

    const text = rowTextOf(sent, session.memory)

    return text === undefined ? next(e) : next({ ...e, props: { ...e.props, text } })
  })

  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    const text = withGlyphs(e.props.text)

    return text === undefined ? next(e) : next({ ...e, props: { ...e.props, text } })
  })

  // Only the tools that write. Fylgja's reads are drawn by Claude Code
  // as every other tool's are.
  on(
    'ui.render',
    {
      component: 'ToolResult',
      props: {
        tool: /^mcp__(?:plugin_fylgja_fylgja|fylgja)__(?:remember|save_knowledge|restructure|review_suggestion|define_term|amend_memory|attach_commit)$/,
      },
    },
    ($, e, next) => {
      const receipt = e.props.isErrored ? undefined : receiptOf(e.props.tool, e.props.output)

      if (receipt === undefined) {
        return next(e)
      }

      const { Text } = $.ui.resolve(e)

      return Text({
        children: [
          Text({ color: receipt.isChange ? 'success' : 'inactive', children: ['✓ '] }),
          Text({ dimColor: !receipt.isChange, children: [drawn(receipt.line, MAX_LINE)] }),
        ],
      })
    },
  )

  // Scribe's own calls to Fylgja are let through without a question to the
  // person: this plugin's call, on its own server, of one of a fixed few
  // tools, and never past a refusal. Every other check is passed on as it
  // came, so nobody else's call is decided here.
  //
  // `$.mcp.call` takes no grant of its own: a call a plugin makes goes
  // through the same permission check as Claude's, under an id of the
  // plugin's kind, and outside auto mode its ask is put to the person. So
  // the ask is turned into an allow here, which is the one answer that
  // loosens a verdict. Where an organization's guard sits ahead of a
  // person's plugins it runs such a check once more without them; the
  // person's mode asked and nothing stands behind the ask, so the allow
  // stands, and Claude Code says that this hook was skipped in that second
  // run. No other way to spare the person the question exists.
  // The tool the plugin reports its own working to is for the plugin alone: it waits behind ToolSearch,
  // out of the prompt's list, and a call of it that is not the plugin's own is refused. That only ever
  // tightens a verdict, so a guard runs nothing again for it.
  on('tool.describe', { tool: REPORT_TOOL }, async ($, e, next) => ({ ...(await next(e)), isDeferred: true })).catch(($, e, next) =>
    next(e),
  )

  on('tool.check', async ($, e, next) => verdictFor(await next(e), e, next.origin?.plugin, session.server)).catch(
    // Asked here when the engine keeps the hook out of a call raised beneath
    // the plugin's own code: the same rule, from the event alone.
    async ($, e, next) => verdictFor(await next(e), e, next.origin?.plugin, session.server),
  )

  // A compaction in the middle of a turn: the records the session kept go
  // to Claude with the first result of a tool of the main conversation's
  // that ends after it, as what Claude reads beside that result, unless a
  // prompt took them first. The request a step had already made when the
  // compaction was seen cannot take them: nothing a person's plugin may hook
  // adds to it. The call itself, and its result, are handed on as they came.
  on('tool.call', async ($, e, next) => {
    const done = await next(e)

    if (done.deny !== undefined || e.agentId !== undefined) {
      return done
    }

    try {
      const text = Scribe.handed(scribe, session.isHere)

      if (text === undefined) {
        return done
      }

      Scribe.takenIn(scribeHostOf($, session, report), scribe)

      return { ...done, context: [...(done.context ?? []), text] }
    } catch {
      return done
    }
  })

  // A step of a turn is the first hook Claude Code waits on after a prompt.
  // Who is signed in, and the references of the rows on screen, are asked
  // about as the step begins and waited for a moment after it, so the step
  // itself is never held. The files the step names are then noted for a
  // lookup of what is recorded about them; a slow one is not waited for.
  //
  // A step that begins after the developer answered a question of Claude's,
  // or after as many steps as the developer's setting says, has Scribe look
  // right then, beside the step and never waited for: the step, and the
  // turn, go on as they would have. What that look still has
  // to call on Fylgja once this hook has handed back is started by the hooks
  // that follow, each for as long as it is being waited on.
  on('turn.step', async function* ($, e, next) {
    const live = open()

    // A hook Claude Code has stopped waiting on starts nothing more.
    next.signal.addEventListener('abort', () => close(live))

    try {
      const host = hostOf($, session, live)
      const looked = flush(host, session)

      void serve(calls, live, callerOf($))

      if (e.agentId === undefined) {
        // Claude is working from here until the turn ends, whoever began the turn.
        Scribe.began(scribe)
        // A compaction just made, or about to be, has Scribe look now, whatever the developer's setting.
        void Promise.all([looked.catch(() => undefined), watchWindow($, held, report, 'step', e.index)])
          .then(([, due]) => Scribe.stepping(scribeHostOf($, session, report, live, calls), scribe, e.index, due.isDue, due.near))
          .catch(() => undefined)
          .finally(() => refresh($, session, noteSignIn))
      }

      const stepped = yield* next(e)

      await briefly(host.after, looked, SHORT_WAIT_MS)

      try {
        if (e.agentId === undefined) {
          await Scribe.stepped(scribeHostOf($, session, report, live), scribe, e.index, stepped.toolUses)
        } else {
          // An agent's step: the paths of the files it changes, and whether it commits. Nothing else of it.
          await Scribe.agentStepped(scribeHostOf($, session, report, live), scribe, stepped.toolUses)
        }
      } catch (error) {
        // The turn goes on.
        report('error', { component: 'turn_step', kind: 'threw', cause: Telemetry.causeOf(error) })
      }

      return stepped
    } finally {
      close(live)
    }
  })

  // An agent the main conversation's Agent tool starts: which call started
  // it, and its id, so that the records on the files its brief names can be
  // told to it on the developer's key. Only watched: the spawn goes on as it
  // was asked, its brief untouched.
  on('agent.spawn', async ($, e, next) => {
    const done = await next(e)

    if (e.parentAgentId === undefined && e.workflow === undefined && e.resume === undefined && done.agentId !== undefined) {
      Scribe.spawned(scribe, e.tool_use_id, e.prompt, done.agentId)
    }

    return done
  })

  // A row of the plugin's own changed in the `/config` menu: Scribe takes it
  // at once, for its next step, look or key, with no reload.
  on('config.set', { key: /^fylgja(?:@[^.]*)?\./ }, async ($, e, next) => {
    const done = await next(e)
    const field = ownField(e.key)

    if (field !== undefined && done.deny === undefined) {
      Scribe.configured(scribe, field, done.value)
    }

    return done
  }).catch(($, e, next) => next(e))

  // The end of a turn of the main conversation is where Scribe does its
  // work, after the turn itself is done with. Of an agent's turn, only the
  // report it hands back is taken, for Scribe's next look: never its session. A look begun inside the turn that is still under way is
  // stopped here, and this one reads what it was reading. The hook has ten
  // seconds of its own time, and waiting for work begun elsewhere counts
  // against them, where waiting for its own calls does not.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const live = open()

    // A hook Claude Code has stopped waiting on starts nothing more.
    next.signal.addEventListener('abort', () => close(live))

    try {
      const host = hostOf($, session, live)

      void serve(calls, live, callerOf($))

      if (e.agentId === undefined) {
        // A session that has moved is in another project; what that one holds is looked at before anything else.
        Session.located(session, await $.session.cwd())
      }

      await briefly(host.after, flush(host, session), SHORT_WAIT_MS)

      if (e.agentId === undefined) {
        await Scribe.completed(scribeHostOf($, session, report, live), scribe)
        // Claude answered: the window's reading now is what a later one is told from.
        await watchWindow($, held, report, 'end')
      } else {
        // However it ended, the agent is at work no longer: nothing is sent to it from here, which would start it again.
        Scribe.agentEnded(scribe, e.agentId)
        Scribe.reported(scribe, e.agentId, e.answer, e.isAborted ? 'aborted' : e.reason)
      }
    } catch (error) {
      // The turn ended as it would have without the plugin.
      report('error', { component: 'turn_end', kind: 'threw', cause: Telemetry.causeOf(error) })
    } finally {
      // Last, once Scribe is done with the turn: what the plugin noted about its own working is sent, a batch a turn.
      // Only from the main conversation's turn: a call raised inside an agent's turn is not the plugin's own to the
      // permission check, and would be put to the person.
      if (e.agentId === undefined) {
        await sendEvents($, session, telemetry, live)
      }
      close(live)
      // The look at the turn's end has ended by here, however it ended.
      refresh($, session, noteSignIn)
    }

    return done
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The band is the survey's while one is up, and an agent's transcript is not Scribe's.
    // The question of which account is signed in comes before anything of Scribe's.
    const isOthers = e.props.hasSurvey || e.props.view?.agentId !== undefined
    const shown = isOthers
      ? undefined
      : (Session.accountView(session) ??
        Scribe.view(
          scribe,
          e.props.isWorking,
          session.account.state === 'pinned' && session.account.who !== undefined
            ? destinationOf(session.account.who)
            : undefined,
        ))
    // The mark comes last: only while the band has nothing of its own to show.
    const mark = isOthers || shown !== undefined ? undefined : Session.markView(session)

    if ((shown === undefined && mark === undefined) || (e.surface !== 'terminal' && e.surface !== 'desktop')) {
      return next(e)
    }

    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table

    // One dim line under whatever is drawn beneath, which is passed on as
    // it came. It reads as text and can be pressed, with a click or from
    // the band's own focus: that opens the window of what was kept. It has
    // no hotkey and asks for no focus, so a digit or a letter typed into an
    // empty prompt box is the person's text as ever. While Scribe is off
    // there is nothing to open, and it is text alone. So it is while the
    // window is open: the window has its own way out, and with no key in
    // the band the keys go to the window and ctrl+x tab finds it first.
    if (shown === undefined) {
      return Box({
        flexDirection: 'column',
        children: [
          await next(e),
          Scribe.isOff(scribe) || isUp(scribe, win)
            ? Text({ dimColor: true, children: [mark ?? ''] })
            : Button({ key: MARK_KEY, plain: true, dimColor: true, onPress: () => void presses.push(MARK_KEY), children: [mark ?? ''] }),
        ],
      })
    }

    return cardOf(table, shown, e.props.bodyColumns, {
      press: key => void presses.push(key),
      submit: (key, value) => void entries.push({ key, value }),
    })
  })

  // A key of the band. The element's own handler only notes which; the work
  // is done here, where a call to Fylgja is this plugin's own to make.
  on('ui.press', { component: 'AbovePrompt' }, async ($, e, next) => {
    const pressed = await next(e)
    const key = presses.shift()

    if (key === MARK_KEY && isUp(scribe, win)) {
      await closeWindow($, scribe, win)
    } else if (key === MARK_KEY) {
      // Opened here, where the person's press is being answered, so it is
      // placed at any width. The press left the keys with the band, and a
      // window is not given them while an element of the band holds them.
      // With the window open the mark is drawn as text, so the band has
      // nothing left to hold them with: once it has been drawn so, the
      // window is asked again, and gets them.
      await recovered($, session, scribe, report)
      await openKept($, scribe, win, report, 'click')

      if (scribe.ledger.isOpen) {
        $.clock.after(HANDOVER_MS, () => {
          if (scribe.ledger.isOpen) {
            void openWindow($, scribe, win).finally(() => ring($, session, scribe, win))
          }
        })
      }
    } else if (key !== undefined) {
      const live = open()

      try {
        if (key.startsWith('account-')) {
          await Session.pressed(hostOf($, session, live), session, key)
        } else {
          await Scribe.pressed(scribeHostOf($, session, report, live), scribe, key)
        }
      } catch (error) {
        // The press is done with.
        report('error', { component: 'band', kind: 'threw', cause: Telemetry.causeOf(error) })
      } finally {
        close(live)
        refresh($, session, noteSignIn)
      }

      // Scribe was turned off with a key: the window has nothing left to list.
      if (scribe.ledger.isOpen && Scribe.isOff(scribe)) {
        await closeWindow($, scribe, win)
      }
    }

    return pressed
  }).catch(($, e, next) => next(e))

  on('ui.input', { component: 'AbovePrompt' }, async ($, e, next) => {
    const entered = await next(e)
    const entry = entries.shift()

    if (entry !== undefined) {
      const live = open()

      try {
        await Scribe.entered(scribeHostOf($, session, report, live), scribe, entry.key, entry.value)
      } catch (error) {
        // The line is done with.
        report('error', { component: 'band', kind: 'threw', cause: Telemetry.causeOf(error) })
      } finally {
        close(live)
        refresh($, session, noteSignIn)
      }
    }

    return entered
  }).catch(($, e, next) => next(e))

  // The window, in the pane Claude Code frames and places, on the view it
  // is set to. Either is drawn from what the plugin holds. What was kept
  // follows Scribe: a record kept while it is open is listed when the band
  // is next asked to draw.
  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      return next(e)
    }

    const { bodyColumns, isFocused } = e.props
    const isSearch = win.which === 'search'

    // Everything known was dropped since the view last looked, by a sign-in or a sign-out: what it found is let go before it is drawn.
    if (isSearch) {
      Search.current(win.search, session.epoch)
    }

    const shown = isSearch
      ? Search.viewOf(win.search, bodyColumns, isFocused, session.isHere, e.props.scroll.bodyRows)
      : Scribe.ledger(scribe, bodyColumns, e.props.scroll.bodyRows, isFocused, session.isHere)

    // Given the keys with ctrl+x tab, the window's ring is on nothing, and Enter would press nothing:
    // it is seated on the selected record, so Enter and the arrows start from what is shown as selected.
    if (keyed(isSearch ? win.search : scribe.ledger, isFocused)) {
      ring($, session, scribe, win)
    }

    return windowOf($.ui.resolve(e), shown, bodyColumns, isFocused, {
      press: key => void picks.push(key),
      submit: (key, value) => void lines.push(value),
    })
  })

  // A key of the window. As in the band, the element's own handler only
  // notes which; the work is done here, where a call to Fylgja is this
  // plugin's own to make. The window's keys are its own: a key of the band
  // is the band's, whether the window is open or not. A key of the search
  // view changes no record: it reads one, or puts its reference in the box.
  on('ui.press', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const pressed = await next(e)
    const key = picks.shift()

    if (key !== undefined) {
      const live = open()

      try {
        if (win.which !== 'search') {
          await Scribe.ledgerPressed(scribeHostOf($, session, report, live), scribe, key)
        } else if (!Search.current(win.search, session.epoch)) {
          const pressing = (): Promise<void> => Search.pressed(hostOf($, session, live), session, win.search, draft, boxOf($), key)

          if (key === Search.AGAIN) {
            await searched(report, session, win.search, 'again', pressing)
          } else {
            const wasActing = win.search.acting
            const id = key.slice(key.indexOf(':') + 1)

            await pressing()

            // A record opened, or its reference put in the prompt box: which of the two, and whether the box took it.
            if (key.startsWith('row:') && win.search.acting === id) {
              report('window_action', { view: 'search', action: 'open_record' })
            } else if (key.startsWith('cite:') && wasActing === id) {
              report('window_action', {
                view: 'search',
                action: 'cite',
                outcome: win.search.said.get(id) === 'cited' ? 'done' : 'trouble',
              })
            }
          }
        }
      } catch (error) {
        // The press is done with.
        report('error', { component: 'window', kind: 'threw', cause: Telemetry.causeOf(error) })
      } finally {
        close(live)
        refresh($, session, noteSignIn)
      }

      ring($, session, scribe, win)
    }

    return pressed
  }).catch(($, e, next) => next(e))

  // Enter in the window's field. In the search view that is a search, the
  // only thing that starts one: nothing is asked of Fylgja while the field
  // is typed into.
  on('ui.input', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const entered = await next(e)
    const value = lines.shift()

    if (value !== undefined) {
      const live = open()

      try {
        if (win.which === 'search') {
          Search.current(win.search, session.epoch)
          await searched(report, session, win.search, 'field', () => Search.look(hostOf($, session, live), session, win.search, value))
        } else {
          await Scribe.ledgerEntered(scribeHostOf($, session, report, live), scribe, value)
        }
      } catch (error) {
        // The line is done with.
        report('error', { component: 'window', kind: 'threw', cause: Telemetry.causeOf(error) })
      } finally {
        close(live)
        refresh($, session, noteSignIn)
      }

      await fitFound($, scribe, win)
      ring($, session, scribe, win)
    }

    return entered
  }).catch(($, e, next) => next(e))

  // The arrows move the ring from row to row, and the record under it is the
  // selected one: a move the person makes onto a row lets go of whatever was
  // half done. The ring on anything but a key that waits for its second
  // press ends that wait. In the search view the ring the person moves into
  // the field makes what is typed the field's, and out of it no longer.
  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)

    if (moved.deny === undefined) {
      const isOntoRow = e.origin.kind === 'person' && e.element?.startsWith('row:') === true
      const id = (e.element ?? '').slice(4)
      const isChanged =
        win.which !== 'search'
          ? isOntoRow
            ? Ledger.rest(scribe.ledger, id)
            : Ledger.ringed(scribe.ledger, e.element)
          : isOntoRow
            ? Search.rest(win.search, id)
            : e.origin.kind === 'person' && e.element === Search.fieldKey(win.search) && Search.entered(win.search)

      if (isChanged) {
        $.ui.invalidate('ui.render')

        // What was under the ring may be gone from the drawing now: the ring is seated on the row again.
        if (isOntoRow) {
          ring($, session, scribe, win)
        }
      }
    }

    return moved
  }).catch(($, e, next) => next(e))

  // A scroll key in a window taller than its room moves the selection, and
  // the window follows it: an arrow a row, a page key a page of rows, Home
  // and End to the ends. The wheel moves the window alone, as does a key
  // once the selection is at its end, so what lies past the rows is reached.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, ($, e, next) => {
    const isInField = win.which === 'search' ? Search.inField(win.search, session.isHere) : scribe.ledger.editing !== undefined

    if (e.origin.kind !== 'person' || e.pointer !== undefined || isInField || e.by === 0) {
      return next(e)
    }

    const far = Math.abs(e.by)
    const rows = far >= e.contentRows ? Number.MAX_SAFE_INTEGER : far > 1 ? Math.max(1, e.bodyRows - 1) : 1
    const by = Math.sign(e.by) * rows
    const to = win.which === 'search' ? Search.step(win.search, by) : Ledger.step(Scribe.ledgerEntries(scribe), scribe.ledger, by)

    if (to === undefined) {
      return next(e)
    }

    $.ui.invalidate('ui.render')
    ring($, session, scribe, win)

    return {}
  }).catch(($, e, next) => next(e))

  // Closed by the person, with Escape or Claude Code's own mark, or by the
  // plugin: either way the window is no longer open, and the next press of
  // the mark opens it. With the field open, the person's close only leaves
  // the field: the window stays, and is asked the keys again, which Escape
  // handed back to the prompt.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person' && (win.which === 'search' ? Search.leftField(win.search, session.isHere) : Scribe.ledgerLeftField(scribe))) {
      $.ui.invalidate('ui.render')
      $.clock.after(0, () => void openWindow($, scribe, win).then(() => ring($, session, scribe, win)))

      return { value: undefined }
    }

    const closed = await next(e)

    Ledger.closed(scribe.ledger)
    Search.closed(win.search)
    // The mark is a key again.
    $.ui.invalidate('ui.render')

    return closed
  }).catch(($, e, next) => next(e))
}
