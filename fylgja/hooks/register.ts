import type { EngineInterface, On, PluginOptions } from 'claude-code'

import { destinationOf } from './account'
import { withGlyphs } from './citations'
import * as Draft from './draft'
import { restored } from './known'
import type { Host } from './host'
import { briefly, called, close, open, SHORT_WAIT_MS } from './live'
import type { Live } from './live'
import { flush, want } from './lookups'
import { isOwnPrompt } from './origin'
import { decorationsOf } from './paint'
import { isLeftToPlugin } from './project'
import { receiptOf } from './receipts'
import { drawn } from './plain'
import { REFUSED, verdictFor } from './scribe/grant'
import * as Scribe from './scribe/scribe'
import type { ScribeHost } from './scribe/scribe'
import type { Part } from './scribe/view'
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

/**
 * The engine calls Scribe makes, spelled out here as the others are. A call
 * to Fylgja goes to the session's own connection, under the name the
 * sign-in check last gave for it.
 */
function scribeHostOf($: EngineInterface, session: Session.Session, live?: Live): ScribeHost {
  return {
    server: () => Session.serverOf(hostOf($, session, live), session),
    // Why a call failed is kept as one word: whether it was not let
    // through, or anything else. The engine's own words are not handed on.
    call: (server, tool, args) =>
      called(live, () => $.mcp.call(server, tool, args)).catch((error: unknown) => {
        throw new Error(error instanceof Error && REFUSAL.test(error.message) ? REFUSED : 'failed')
      }),
    lookup: async (tool, args) => {
      const server = await Session.serverOf(hostOf($, session, live), session)

      if (server === undefined) {
        throw new Error('Fylgja is not connected')
      }

      return called(live, () => $.mcp.call(server, tool, args))
    },
    complete: async request => {
      const reply = await $.model.complete({
        model: request.model,
        system: request.system,
        prompt: request.prompt,
        maxTokens: request.maxTokens,
        effort: 'low',
        timeoutMs: request.timeoutMs,
      })

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

// How the engine words a call of a plugin's that it did not let through:
// `<plugin>: $.mcp.call(<server>, <tool>) refused: <why>`. A server's own
// error may say "connection refused" or "access denied" and is not that.
// Only whether it is one is read; the words go no further.
const REFUSAL = /\$\.mcp\.call\([^)\n]*\) refused:/

const TONES: Readonly<Record<string, { color?: 'success' | 'inactive'; dimColor?: boolean; bold?: boolean }>> = {
  dim: { dimColor: true },
  strong: { bold: true },
  good: { color: 'success' },
  mark: { color: 'success' },
}

function toneOf(part: Part): { color?: 'success' | 'inactive'; dimColor?: boolean; bold?: boolean } {
  return 'tone' in part && part.tone !== undefined ? (TONES[part.tone] ?? {}) : {}
}

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
 * Scribe is the one part that does more than draw: at the end of a turn it
 * reads what happened, asks its own model, and writes to Fylgja. It runs
 * beside the conversation and never in it: nothing it reads, asks or writes
 * is added to what Claude reads, and no prompt waits for it.
 */
export function register(on: On, options: PluginOptions = {}): void {
  const session = Session.create()
  const draft = Draft.create()
  const scribe = Scribe.create({ isOn: options.scribe !== false })
  // The keys pressed and the lines entered in the band, as its elements'
  // own handlers took them; the hook on the press does the work.
  const presses: string[] = []
  const entries: { key: string; value: string }[] = []

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
    }

    return started
  }).catch(($, e, next) => next(e))

  // A cleared, resumed or branched conversation starts over without a fresh
  // session start: what was known is dropped, and the rows that are still
  // on screen, or come back, have their references asked about again.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    Session.startOver(session)
    Session.revet(session)
    Draft.startOver(draft)
    Scribe.startOver(scribe)
    $.ui.invalidate('ui.render')

    const started = await next(e)
    const live = open()

    try {
      const host = hostOf($, session, live)

      await briefly(host.after, flush(host, session), SHORT_WAIT_MS)
    } finally {
      close(live)
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
  on('turn.step', async function* ($, e, next) {
    const live = open()

    try {
      const host = hostOf($, session, live)
      const looked = flush(host, session)
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
  // business.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const live = open()

    try {
      const host = hostOf($, session, live)

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
    }

    return done
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    // The band is the survey's while one is up, and an agent's transcript is not Scribe's.
    // The question of which account is signed in comes before anything of Scribe's.
    const shown =
      e.props.hasSurvey || e.props.view?.agentId !== undefined
        ? undefined
        : (Session.accountView(session) ??
          Scribe.view(
            scribe,
            e.props.isWorking,
            session.account.state === 'pinned' && session.account.who !== undefined
              ? destinationOf(session.account.who)
              : undefined,
          ))

    if (shown === undefined || (e.surface !== 'terminal' && e.surface !== 'desktop')) {
      return next(e)
    }

    const { Box, Button, Input, Link, Text } = $.ui.resolve(e)
    const keys = (list: readonly { key: string; hotkey: string; label: string }[]) =>
      list.map(key =>
        Button({ key: key.key, label: key.label, hotkey: key.hotkey, plain: true, onPress: () => void presses.push(key.key) }),
      )

    return Box({
      flexDirection: 'column',
      children: [
        ...shown.rows.map(row =>
          Box({
            flexDirection: 'row',
            flexWrap: 'wrap',
            columnGap: 2,
            children: [
              ...(row.field === undefined
                ? [
                    Text({
                      children: row.parts.map(part =>
                        'link' in part
                          ? Link({ href: part.link, label: part.label })
                          : Text({ ...toneOf(part), children: [part.text] }),
                      ),
                    }),
                  ]
                : [
                    Input({
                      key: row.field.key,
                      label: row.field.label,
                      value: row.field.value,
                      placeholder: row.field.placeholder,
                      submitLabel: row.field.submitLabel,
                      // The person pressed the key that opens the field; typing goes there.
                      autoFocus: true,
                      onSubmit: value => void entries.push({ key: row.field?.key ?? '', value }),
                    }),
                  ]),
              ...keys(row.keys ?? []),
            ],
          }),
        ),
        Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children: keys(shown.keys) }),
      ],
    })
  })

  // A key of the band. The element's own handler only notes which; the work
  // is done here, where a call to Fylgja is this plugin's own to make.
  on('ui.press', { component: 'AbovePrompt' }, async ($, e, next) => {
    const pressed = await next(e)
    const key = presses.shift()

    if (key !== undefined) {
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
      }
    }

    return entered
  }).catch(($, e, next) => next(e))
}
