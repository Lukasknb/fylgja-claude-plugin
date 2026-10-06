import type { EngineInterface, On } from 'claude-code'

import { withGlyphs } from './citations'
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
 * It only draws. No hook sees a prompt on its way to Claude, so nothing is
 * added to what Claude reads and no prompt is changed or made to wait:
 * Claude sees a pasted reference as written and opens it with Fylgja's tools
 * when it chooses to. The one lookup, a reference's title for its chip, is
 * started by the row that shows it, rides the session's own Fylgja
 * connection, and is never waited for; a failure leaves the row as it is
 * drawn without an answer.
 */
export function register(on: On): void {
  const session = Session.create()

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
    $.ui.invalidate('ui.render')

    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    const paint = decorationsOf(box.text)

    return paint.length === 0 ? box : { ...box, decorations: [...(box.decorations ?? []), ...paint] }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    // Expanded, the row shows the message exactly as it was sent.
    if (e.props.isExpanded || !isOwnPrompt(e.props.origin)) {
      return next(e)
    }

    // Started, never waited for: the row is drawn now with what is known.
    want(hostOf($), session, referencesIn(e.props.text))

    const text = rowTextOf(e.props.text, session.memory)

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
