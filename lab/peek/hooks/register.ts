import type { EngineInterface, On, PluginOptions, RenderSurface, RenderViewport } from 'claude-code'

import { chipsLine } from './chips'
import type { Host } from './host'
import * as Library from './library'
import { drawPeek } from './pane'
import * as Peek from './peek'
import { citationsIn, refOfArgument, refOfLink } from './refs'
import type { Ref } from './refs'
import { distinctById, tokensIn } from './token'
import * as View from './view'

/** The one pane this plugin opens. */
const PANE = 'fylgja-peek'

/** A reply block longer than this keeps Claude Code's own drawing. */
const MAX_REDRAWN = 50_000

const USAGE = 'Usage: /peek <a pasted {{fylgja:…}} reference, a link to a Fylgja record, or a record id>'

/**
 * The engine calls this plugin makes, each spelled out here once and handed
 * to the plugin's other files as plain functions.
 */
function hostOf($: EngineInterface): Host {
  return {
    connect: () => $.mcp.connect('fylgja'),
    call: (server, tool, args) => $.mcp.call(server, tool, args),
    redraw: () => $.ui.invalidate('ui.render'),
    openPane: async wantsFocus => {
      const opened = await $.ui.open(
        wantsFocus ? { id: PANE, title: 'Fylgja peek', closeOnEscape: true, focus: true } : { id: PANE, title: 'Fylgja peek', closeOnEscape: true },
      )

      return opened.isPlaced
    },
    closePane: () => $.ui.close({ id: PANE }),
    insert: async text => (await $.prompt.fill({ text, mode: 'insert' })).isFilled,
  }
}

/**
 * Whether the surface drawing this row reports the pointer, so that a chip
 * can be pressed and its card shown: the desktop app, and the terminal in
 * fullscreen mode. On the terminal's main screen a row is printed into
 * scrollback, where nothing can be hovered or clicked, so nothing is added.
 */
function hasPointer(surface: RenderSurface, viewport: RenderViewport | undefined): boolean {
  return surface === 'desktop' || (surface === 'terminal' && viewport?.isFullscreen === true)
}

/**
 * Peeking at a Fylgja record without leaving the conversation.
 *
 * A reply that links to Fylgja records, and a prompt of the person's that
 * holds pasted references, get one line of chips: a chip shows a small card
 * under the pointer and opens the record in a pane on a press. `/peek` opens
 * the same pane by hand.
 *
 * It draws and it reads, nothing else. No hook sees a prompt on its way to
 * Claude or a tool call, so nothing is added to what Claude reads and
 * nothing is made to wait. Every read rides the session's own Fylgja
 * connection, is started in the background and is never waited for by a
 * drawing; what was read is held in this module's memory only.
 */
export function register(on: On, options: PluginOptions): void {
  const peek = Peek.create()
  const keepsEngineReply = options.replyLinks === 'engine'

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'peek',
        description: 'Read a Fylgja record in a pane beside the conversation',
        argumentHint: '[reference, link or id]',
      })
    } catch {
      // Without the command the chips still open the pane.
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // A cleared, resumed or branched conversation starts over without a fresh
  // session start: what was read is dropped and read again when next shown.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, ($, e, next) => {
    Library.startOver(peek.library)
    $.ui.invalidate('ui.render')

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'peek' }, async ($, e) => {
    const argument = e.args.trim()
    const ref = argument === '' ? View.current(peek.view) : refOfArgument(argument)

    if (ref === undefined) {
      return { text: argument === '' ? `Nothing peeked at yet. ${USAGE}` : `That names no Fylgja record. ${USAGE}` }
    }

    await Peek.open(hostOf($), peek, ref, true)

    return {}
  }).catch(() => ({ text: 'The peek pane could not be opened.' }))

  on('ui.close', { id: PANE }, ($, e, next) => {
    if (e.origin.kind !== 'unload') {
      peek.view.where = 'closed'
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary === true || !hasPointer(e.surface, e.viewport)) {
      return next(e)
    }

    const citations = citationsIn(e.props.text)

    if (citations.length === 0) {
      return next(e)
    }

    const host = hostOf($)
    // Started, never waited for: the reply is drawn now with what is known.
    Library.want(host, peek.library, citations)

    const kit = $.ui.resolve(e)
    const { Box, Text, Markdown } = kit
    const onPeek = (ref: Ref) => void Peek.open(host, peek, ref, false)
    // The reply's own text starts two cells in, after its mark.
    const columns = Math.max(20, (e.viewport?.columns ?? 80) - 2)
    const chips = chipsLine(kit, citations, peek.library.facts, columns, onPeek)

    if (keepsEngineReply || e.props.text.length > MAX_REDRAWN) {
      return Box({ flexDirection: 'column', children: [await next(e), Box({ paddingLeft: 2, children: [chips] })] })
    }

    // The reply is drawn here instead of by Claude Code, as the same
    // markdown, so that a click on a link to a record can be answered with
    // the pane. Links to anywhere else keep opening as they always do.
    return Box({
      flexDirection: 'row',
      children: [
        Box({ width: 2, flexShrink: 0, children: [Text({ children: [e.surface === 'terminal' && e.props.isFirstOfReply ? '●' : ' '] })] }),
        Box({
          flexDirection: 'column',
          flexGrow: 1,
          flexShrink: 1,
          children: [
            Markdown({
              key: 'peek-reply',
              text: e.props.text,
              pressableLinks: citations.slice(0, 256).map(citation => citation.href),
              onLinkPress: link => {
                const ref = refOfLink(link.href)

                if (ref !== undefined) {
                  onPeek({ id: ref.id, kind: ref.kind })
                }
              },
            }),
            chips,
          ],
        }),
      ],
    })
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    // Expanded, the row shows the message exactly as it was sent. Only the
    // person's own words are read: typed here, or sent from their phone.
    const isOwn = e.props.origin.kind === 'composer' || e.props.origin.kind === 'bridge'

    if (e.props.isExpanded || !isOwn || !hasPointer(e.surface, e.viewport)) {
      return next(e)
    }

    const refs = distinctById(tokensIn(e.props.text)).map(token => ({ id: token.id, kind: token.kind }))

    if (refs.length === 0) {
      return next(e)
    }

    const host = hostOf($)
    Library.want(host, peek.library, refs)

    const kit = $.ui.resolve(e)
    const columns = Math.max(20, (e.viewport?.columns ?? 80) - 2)
    const chips = chipsLine(kit, refs, peek.library.facts, columns, ref => void Peek.open(host, peek, ref, false))

    return kit.Box({ flexDirection: 'column', children: [await next(e), kit.Box({ paddingLeft: 2, children: [chips] })] })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => {
    const host = hostOf($)
    const shown = View.current(peek.view)

    // A pane that outlived what was read (a reload, a dropped sign-in) reads its record again.
    if (shown !== undefined && !peek.library.records.has(shown.id)) {
      void Library.load(host, peek.library, shown)
    }

    return drawPeek($.ui.resolve(e), peek, Peek.actionsOf(host, peek))
  })

  // Where the surface placed no pane, the same view is drawn above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (peek.view.where !== 'band' || View.current(peek.view) === undefined) {
      return next(e)
    }

    return drawPeek($.ui.resolve(e), peek, Peek.actionsOf(hostOf($), peek))
  })
}
