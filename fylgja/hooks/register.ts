import type { EngineInterface, On, PluginOptions } from 'claude-code'

import { destinationOf } from './account'
import { cardOf } from './card'
import { withGlyphs } from './citations'
import * as Draft from './draft'
import { restored } from './known'
import type { Host } from './host'
import { ledgerOf, PANE, rowKey, TITLE } from './ledger'
import { briefly, called, close, line, LINE_WAIT_MS, open, passed, serve, SHORT_WAIT_MS } from './live'
import type { Line, Live } from './live'
import { flush, want } from './lookups'
import { isOwnPrompt } from './origin'
import { decorationsOf } from './paint'
import { isLeftToPlugin } from './project'
import { receiptOf } from './receipts'
import { drawn } from './plain'
import { REFUSED, verdictFor } from './scribe/grant'
import * as Ledger from './scribe/ledger'
import * as Scribe from './scribe/scribe'
import type { ScribeHost } from './scribe/scribe'
import * as Session from './session'
import { referencesIn, rowTextOf } from './user-row'

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
 * @param calls given to a host whose work may go on after its hook has
 *   handed back: a call it makes then waits there, a short while, for the
 *   next hook that is being waited on, and is started by that hook. A call
 *   of such a host that was not let through only failed: whether Scribe's
 *   calls are let through at all is found out by a hook that is waited on
 *   for its whole look, never by work that may have been left behind.
 */
function scribeHostOf($: EngineInterface, session: Session.Session, live?: Live, calls?: Line<Caller>): ScribeHost {
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
    box: async () => (await $.prompt.read()).text,
    fill: async text => (await $.prompt.fill({ text, mode: 'replace' })).isFilled,
    stored: key => $.store.get(key),
    store: (key, value) => $.store.set(key, value),
    sessionId: () => $.session.id(),
    repo: () => $.session.repo(),
    cwd: () => $.session.cwd(),
    exists: path =>
      $.fs.stat(path).then(
        () => true,
        () => false,
      ),
    read: path => $.fs.read(path),
    vouched: root => isLeftToPlugin(hostOf($, session, live), root),
    surfaces: () => $.session.surfaces(),
    rows: () => $.session.messages(),
    destination: () =>
      session.account.state === 'pinned' && session.account.who !== undefined ? destinationOf(session.account.who) : undefined,
  }
}

/** Brings the mark above the prompt up to date; see `Session.remark`. No call to Fylgja is started for it. */
function remark($: EngineInterface, session: Session.Session): void {
  Session.remark(hostOf($, session), session)
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
 * Opens the window of what was kept, or brings it the keys when it is open.
 * The keys are asked for, not taken: where the prompt box holds text or a
 * dialog is up, Claude Code keeps them and the window is shown all the same.
 * Escape closes it. It holds back nobody's toasts.
 */
async function openLedger($: EngineInterface, scribe: Scribe.Scribe): Promise<void> {
  const rows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, Scribe.ledgerEntries(scribe).length + ROWS_AROUND))

  scribe.ledger.isOpen = true

  try {
    const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true, rows })

    // Open, and no surface draws it: the person asked for it and sees nothing, so they are told why,
    // and it is not left waiting to come up later by itself.
    if (!opened.isPlaced) {
      $.ui.toast(drawn(`Fylgja: the window cannot be shown here. ${opened.reason}`, MAX_LINE))
      await closeLedger($, scribe)
    }
  } catch {
    // Not opened: nothing is drawn, and the next press asks again.
    scribe.ledger.isOpen = false
    $.ui.toast('Fylgja: the window could not be opened here.')
  }

  // While it is open the mark is text, and a key again when it is not.
  $.ui.invalidate('ui.render')
}

/** Closes the window of what was kept. */
async function closeLedger($: EngineInterface, scribe: Scribe.Scribe): Promise<void> {
  Ledger.closed(scribe.ledger)
  // The mark is a key again.
  $.ui.invalidate('ui.render')

  try {
    await $.ui.close({ id: PANE })
  } catch {
    // Kept open by another plugin's hook: it is theirs to say, and the next press closes it.
    scribe.ledger.isOpen = true
  }
}

/**
 * Puts the window's focus ring where the window now is, once it has been
 * drawn again: on the selected record's row, or, while that record's keys
 * are up, on the key that waits for its second press or else the first of
 * them. The row is brought into view. Only a window that holds the keys has
 * a ring to move; any other is left as it is.
 */
function ring($: EngineInterface, scribe: Scribe.Scribe): void {
  const selected = Ledger.selectedIn(Scribe.ledgerEntries(scribe), scribe.ledger)
  const { acting, armed, editing } = scribe.ledger

  if (selected === undefined || editing !== undefined) {
    return
  }

  const id = selected.record.id
  const key = acting === id ? (armed?.key ?? Ledger.actionKeys(id, selected.isGone)[0] ?? rowKey(id)) : rowKey(id)

  $.clock.after(0, () => {
    void $.ui.focus({ requestId: PANE, key }).catch(() => undefined)
    void $.ui.scroll({ in: PANE, to: { key } }).catch(() => undefined)
  })
}

// How the engine words a call of a plugin's that it did not let through:
// `<plugin>: $.mcp.call(<server>, <tool>) refused: <why>`. A server's own
// error may say "connection refused" or "access denied" and is not that.
// Only whether it is one is read; the words go no further.
const REFUSAL = /\$\.mcp\.call\([^)\n]*\) refused:/

/**
 * Fylgja inside Claude Code, quietly: it says when Fylgja needs sign-in, and
 * draws pasted references, links to records and the rare write as what they
 * are.
 *
 * Nothing is added to what Claude reads and no prompt is made to wait. A
 * reference pasted into the prompt box is shown there as a short chip, and
 * the one hook that sees a prompt on its way to Claude puts the reference
 * back exactly as it was pasted. That hook only works on the text in hand:
 * it asks nothing of Fylgja or of Claude Code. Claude opens a reference with
 * Fylgja's tools when it chooses to.
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
 * What Scribe kept in the session is listed in a window the developer
 * opens, by pressing the mark above the prompt or with `/fylgja-kept`. It
 * never opens by itself, and it draws from what the plugin already holds.
 */
export function register(on: On, options: PluginOptions = {}): void {
  const session = Session.create()
  const draft = Draft.create()
  const scribe = Scribe.create({ isOn: options.scribe !== false })

  // What the mark says of Scribe is read from Scribe when the line is written.
  session.doing = () => Scribe.doing(scribe)
  // The keys pressed and the lines entered in the band, as its elements'
  // own handlers took them; the hook on the press does the work.
  const presses: string[] = []
  const entries: { key: string; value: string }[] = []
  // The same for the window of what was kept.
  const picks: string[] = []
  const lines: string[] = []
  // The calls to Fylgja of a look that outlived the hook it began in.
  const calls = line<Caller>()

  on('session.start', async ($, e, next) => {
    Session.startOver(session)
    Session.located(session, e.cwd)
    Session.revet(session)
    Scribe.started(scribe, e.isInteractive, e.surface)

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
    } finally {
      close(live)
      remark($, session)
    }

    // The way to the window of what was kept for a terminal that reports no clicks.
    try {
      await $.command.register({ name: 'fylgja-kept', description: 'Show what Fylgja kept in this session', immediate: true })
    } catch {
      // The mark still opens it.
    }

    return started
  }).catch(($, e, next) => next(e))

  // Typed by the developer, so the window opens. It answers with no line of
  // its own: a command's line is read by Claude, and the window says it all.
  on('command.run', { command: 'fylgja-kept' }, async $ => {
    await openLedger($, scribe)

    return {}
  })

  // A cleared, resumed or branched conversation starts over without a fresh
  // session start: what was known is dropped, and the rows that are still
  // on screen, or come back, have their references asked about again.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    Session.startOver(session)
    Session.revet(session)
    Draft.startOver(draft)
    Scribe.startOver(scribe)

    // What the window listed was the conversation's before.
    if (scribe.ledger.isOpen) {
      await closeLedger($, scribe)
    }

    $.ui.invalidate('ui.render')

    const started = await next(e)
    const live = open()

    try {
      const host = hostOf($, session, live)

      await briefly(host.after, flush(host, session), SHORT_WAIT_MS)
    } finally {
      close(live)
      remark($, session)
    }

    return started
  }).catch(($, e, next) => next(e))

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)

    // Whether the developer is typing; what waits above the prompt comes up
    // once the box is empty. Nothing is asked of anyone for it.
    try {
      Session.typed(hostOf($, session), session, box.text)
      Scribe.typed(scribeHostOf($, session), scribe, box.text)
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
  // text in hand, so the prompt is never made to wait; if it fails, the
  // prompt goes on as it was entered. Nothing is forgotten here: a prompt
  // brought back into the box has its chips, and is sent with its references.
  on('prompt.submit', ($, e, next) => {
    if (e.origin.kind !== 'composer') {
      // A prompt sent from the person's phone or browser is theirs too.
      if (isOwnPrompt(e.origin)) {
        try {
          Session.prompted(hostOf($, session), session)
          Scribe.prompted(scribeHostOf($, session), scribe, e.text)
        } catch {
          // The prompt goes on as it was sent.
        }
      }

      return next(e)
    }

    const text = restored(draft.known, e.text)

    Draft.startOver(draft)

    // Work on what is already in hand, and nothing awaited: an offer the
    // developer typed past is taken down.
    try {
      Session.prompted(hostOf($, session), session)
      Scribe.prompted(scribeHostOf($, session), scribe, text)
    } catch {
      // The prompt goes on as it was entered.
    }

    return text === e.text ? next(e) : next({ ...e, text })
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
  on('tool.check', async ($, e, next) => verdictFor(await next(e), e, next.origin?.plugin, session.server)).catch(
    // Asked here when the engine keeps the hook out of a call raised beneath
    // the plugin's own code: the same rule, from the event alone.
    async ($, e, next) => verdictFor(await next(e), e, next.origin?.plugin, session.server),
  )

  // A step of a turn is the first hook Claude Code waits on after a prompt.
  // Who is signed in, and the references of the rows on screen, are asked
  // about as the step begins and waited for a moment after it, so the step
  // itself is never held. The files the step names are then noted for a
  // lookup of what is recorded about them; a slow one is not waited for.
  //
  // A step that begins after the developer answered a question of Claude's
  // has Scribe look right then, beside the step and never waited for: the
  // step, and the turn, go on as they would have. What that look still has
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
        void looked
          .catch(() => undefined)
          .then(() => Scribe.stepping(scribeHostOf($, session, live, calls), scribe))
          .catch(() => undefined)
          .finally(() => remark($, session))
      }

      const stepped = yield* next(e)

      await briefly(host.after, looked, SHORT_WAIT_MS)

      try {
        if (e.agentId === undefined) {
          await Scribe.stepped(scribeHostOf($, session, live), scribe, e.index, stepped.toolUses)
        } else {
          // An agent's step: the paths of the files it changes, and whether it commits. Nothing else of it.
          await Scribe.agentStepped(scribeHostOf($, session, live), scribe, stepped.toolUses)
        }
      } catch {
        // The turn goes on.
      }

      return stepped
    } finally {
      close(live)
    }
  })

  // The end of a turn of the main conversation is where Scribe does its
  // work, after the turn itself is done with. An agent's turn is not its
  // business. A look begun inside the turn that is still under way is
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
        await Scribe.completed(scribeHostOf($, session, live), scribe)
      }
    } catch {
      // The turn ended as it would have without the plugin.
    } finally {
      close(live)
      // The look at the turn's end has ended by here, however it ended.
      remark($, session)
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
          Scribe.isOff(scribe) || scribe.ledger.isOpen
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

    if (key === MARK_KEY && scribe.ledger.isOpen) {
      await closeLedger($, scribe)
    } else if (key === MARK_KEY) {
      // Opened here, where the person's press is being answered, so it is
      // placed at any width. The press left the keys with the band, and a
      // window is not given them while an element of the band holds them.
      // With the window open the mark is drawn as text, so the band has
      // nothing left to hold them with: once it has been drawn so, the
      // window is asked again, and gets them.
      await openLedger($, scribe)

      if (scribe.ledger.isOpen) {
        $.clock.after(HANDOVER_MS, () => {
          if (scribe.ledger.isOpen) {
            void openLedger($, scribe).finally(() => ring($, scribe))
          }
        })
      }
    } else if (key !== undefined) {
      const live = open()

      try {
        if (key.startsWith('account-')) {
          await Session.pressed(hostOf($, session, live), session, key)
        } else {
          await Scribe.pressed(scribeHostOf($, session, live), scribe, key)
        }
      } catch {
        // The press is done with.
      } finally {
        close(live)
        remark($, session)
      }

      // Scribe was turned off with a key: the window has nothing left to list.
      if (scribe.ledger.isOpen && Scribe.isOff(scribe)) {
        await closeLedger($, scribe)
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
        await Scribe.entered(scribeHostOf($, session, live), scribe, entry.key, entry.value)
      } catch {
        // The line is done with.
      } finally {
        close(live)
        remark($, session)
      }
    }

    return entered
  }).catch(($, e, next) => next(e))

  // The window of what was kept, in the pane Claude Code frames and places.
  // It is drawn from what the plugin holds, so it follows Scribe: a record
  // kept while it is open is listed when the band is next asked to draw.
  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      return next(e)
    }

    const { bodyColumns, isFocused } = e.props
    const shown = Scribe.ledger(scribe, bodyColumns, e.props.scroll.bodyRows, isFocused, session.isHere)

    return ledgerOf($.ui.resolve(e), shown, bodyColumns, isFocused, {
      press: key => void picks.push(key),
      submit: (key, value) => void lines.push(value),
    })
  })

  // A key of the window. As in the band, the element's own handler only
  // notes which; the work is done here, where a call to Fylgja is this
  // plugin's own to make. The window's keys are its own: a key of the band
  // is the band's, whether the window is open or not.
  on('ui.press', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const pressed = await next(e)
    const key = picks.shift()

    if (key !== undefined) {
      const live = open()

      try {
        await Scribe.ledgerPressed(scribeHostOf($, session, live), scribe, key)
      } catch {
        // The press is done with.
      } finally {
        close(live)
        remark($, session)
      }

      ring($, scribe)
    }

    return pressed
  }).catch(($, e, next) => next(e))

  on('ui.input', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const entered = await next(e)
    const value = lines.shift()

    if (value !== undefined) {
      const live = open()

      try {
        await Scribe.ledgerEntered(scribeHostOf($, session, live), scribe, value)
      } catch {
        // The line is done with.
      } finally {
        close(live)
        remark($, session)
      }

      ring($, scribe)
    }

    return entered
  }).catch(($, e, next) => next(e))

  // The arrows move the ring from row to row, and the record under it is the
  // selected one: a move the person makes onto a row lets go of whatever was
  // half done. The ring on anything but a key that waits for its second
  // press ends that wait.
  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)

    if (moved.deny === undefined) {
      const isOntoRow = e.origin.kind === 'person' && e.element?.startsWith('row:') === true
      const isChanged = isOntoRow ? Ledger.rest(scribe.ledger, (e.element ?? '').slice(4)) : Ledger.ringed(scribe.ledger, e.element)

      if (isChanged) {
        $.ui.invalidate('ui.render')

        // What was under the ring may be gone from the drawing now: the ring is seated on the row again.
        if (isOntoRow) {
          ring($, scribe)
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
    if (e.origin.kind !== 'person' || e.pointer !== undefined || scribe.ledger.editing !== undefined || e.by === 0) {
      return next(e)
    }

    const far = Math.abs(e.by)
    const rows = far >= e.contentRows ? Number.MAX_SAFE_INTEGER : far > 1 ? Math.max(1, e.bodyRows - 1) : 1

    if (Ledger.step(Scribe.ledgerEntries(scribe), scribe.ledger, Math.sign(e.by) * rows) === undefined) {
      return next(e)
    }

    $.ui.invalidate('ui.render')
    ring($, scribe)

    return {}
  }).catch(($, e, next) => next(e))

  // Closed by the person, with Escape or Claude Code's own mark, or by the
  // plugin: either way the window is no longer open, and the next press of
  // the mark opens it. With the field open, the person's close only leaves
  // the field: the window stays, and is asked the keys again, which Escape
  // handed back to the prompt.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person' && Scribe.ledgerLeftField(scribe)) {
      $.ui.invalidate('ui.render')
      $.clock.after(0, () => void openLedger($, scribe).then(() => ring($, scribe)))

      return { value: undefined }
    }

    const closed = await next(e)

    Ledger.closed(scribe.ledger)
    // The mark is a key again.
    $.ui.invalidate('ui.render')

    return closed
  }).catch(($, e, next) => next(e))
}
