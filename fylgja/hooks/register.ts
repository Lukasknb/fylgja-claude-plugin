import type { EngineInterface, On } from 'claude-code'

import { withGlyphs } from './citations'
import * as Draft from './draft'
import { restored } from './known'
import type { Host } from './host'
import { want } from './lookups'
import { isOwnPrompt } from './origin'
import { decorationsOf } from './paint'
import { receiptOf } from './receipts'
import { drawn } from './plain'
import * as Session from './session'
import { referencesIn, rowTextOf } from './user-row'

/** No line this plugin shows is longer than this. */
const MAX_LINE = 200

/**
 * The engine calls this plugin makes, each spelled out here once and handed
 * to the plugin's other files as plain functions. Every line shown passes
 * the same sanitiser the chips do.
 */
function hostOf($: EngineInterface): Host {
  return {
    connect: () => $.mcp.connect('fylgja'),
    call: (server, tool, args) => $.mcp.call(server, tool, args),
    status: text => $.ui.status(text === undefined ? undefined : drawn(text, MAX_LINE)),
    redraw: () => $.ui.invalidate('ui.render'),
    every: (ms, fn) => $.clock.every(ms, fn),
  }
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
 * started by the row that shows it, rides the session's own Fylgja
 * connection, and is never waited for; a failure leaves the row as it is
 * drawn without an answer.
 */
export function register(on: On): void {
  const session = Session.create()
  const draft = Draft.create()

  on('session.start', ($, e, next) => {
    Session.startOver(session)
    // Not waited on: the session starts whether or not Fylgja answers. The
    // line's state is written whatever the answer, because a plugin that was
    // just loaded cannot know whether an earlier load left the line up.
    void Session.serverOf(hostOf($), session, true).catch(() => undefined)

    return next(e)
  }).catch(($, e, next) => next(e))

  // A cleared, resumed or branched conversation starts over without a fresh
  // session start: what was known is dropped, and the rows that are still
  // on screen, or come back, look their references up again.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, ($, e, next) => {
    Session.startOver(session)
    Draft.startOver(draft)
    $.ui.invalidate('ui.render')

    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)

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
      return next(e)
    }

    const text = restored(draft.known, e.text)

    Draft.startOver(draft)

    return text === e.text ? next(e) : next({ ...e, text })
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    // Expanded, the row shows the message exactly as it was sent.
    if (e.props.isExpanded || !isOwnPrompt(e.props.origin)) {
      return next(e)
    }

    // Started, never waited for: the row is drawn now with what is known.
    // A row handed the text as it was typed is drawn from what was sent for it.
    const sent = e.props.origin.kind === 'composer' ? restored(draft.known, e.props.text) : e.props.text

    want(hostOf($), session, referencesIn(sent))

    const text = rowTextOf(sent, session.memory)

    return text === undefined ? next(e) : next({ ...e, props: { ...e.props, text } })
  })

  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    const text = withGlyphs(e.props.text)

    return text === undefined ? next(e) : next({ ...e, props: { ...e.props, text } })
  })

  // Only the four tools that write. Fylgja's reads are drawn by Claude Code
  // as every other tool's are.
  on(
    'ui.render',
    {
      component: 'ToolResult',
      props: { tool: /^mcp__(?:plugin_fylgja_fylgja|fylgja)__(?:remember|save_knowledge|restructure|review_suggestion)$/ },
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
}
