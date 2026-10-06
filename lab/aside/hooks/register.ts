import type { EngineInterface, On } from 'claude-code'

import * as Asides from './asides'
import { ask } from './flow'
import type { Completion, Host } from './host'
import { draw } from './pane'
import type { Actions } from './pane'
import { flat } from './plain'
import { pointerOf, referenceOf } from './reference'

const PANE = 'fylgja-aside'

/** A question longer than this is cut: it is one search query and one line on screen. */
const MAX_QUESTION = 300

/** The answer is a few sentences; this is the most the model may write. */
const MAX_TOKENS = 400

/** The model call is abandoned after this long, and the pane says so. */
const MODEL_TIMEOUT_MS = 20_000

const NO_PROMPT_BOX = 'The prompt box is not free right now. Nothing was put in it.'

/**
 * The engine calls this plugin makes, each spelled out here once and handed
 * to the plugin's other files as plain functions.
 */
function hostOf($: EngineInterface): Host {
  return {
    connect: () => $.mcp.connect('fylgja'),
    call: (server, tool, args) => $.mcp.call(server, tool, args),
    complete: async (system, prompt): Promise<Completion> => {
      const reply = await $.model.complete({
        model: 'haiku',
        system,
        prompt,
        maxTokens: MAX_TOKENS,
        effort: 'low',
        timeoutMs: MODEL_TIMEOUT_MS,
      })

      if (reply.isAnswered) {
        return { isAnswered: true, text: reply.text }
      }

      const isLimited = reply.reason === 'api-error' && (reply.status === 429 || reply.error === 'rate_limit')

      return {
        isAnswered: false,
        why: reply.reason === 'aborted' ? 'timed-out' : isLimited ? 'rate-limited' : 'failed',
      }
    },
    insert: async text => (await $.prompt.fill({ text, mode: 'insert' })).isFilled,
    redraw: () => $.ui.invalidate('ui.render'),
  }
}

/**
 * Opens the pane for something the person just did. Where no pane can be
 * placed, the band above the prompt shows the same drawing instead.
 */
async function show($: EngineInterface, asides: Asides.Asides): Promise<void> {
  const placed = await $.ui.open({ id: PANE, title: 'Aside' }).catch(() => ({ isPlaced: false }))

  asides.isBand = !placed.isPlaced
  $.ui.invalidate('ui.render')
}

/** What the pane's controls do, bound to this session's asides and the engine. */
function actionsOf(host: Host, asides: Asides.Asides, isBand: boolean): Actions {
  // A fill that the prompt box refused is said in the pane; one that worked says nothing.
  const fill = (text: string): void => {
    void host
      .insert(text)
      .catch(() => false)
      .then(isFilled => {
        asides.notice = isFilled ? undefined : NO_PROMPT_BOX
        host.redraw()
      })
  }

  return {
    ask: typed => {
      const question = flat(typed, MAX_QUESTION)

      if (question !== '') {
        asides.draft = ''
        void ask(host, asides, question, asides.isFresh ? undefined : Asides.shownOf(asides), undefined)
      }
    },
    widen: turn => void ask(host, asides, turn.question, undefined, turn),
    step: by => {
      Asides.step(asides, by)
      host.redraw()
    },
    fresh: () => {
      asides.isFresh = true
      host.redraw()
    },
    insert: hit => fill(`${referenceOf(hit)} `),
    hand: turn => {
      const cited = turn.outcome?.kind === 'answered' ? turn.outcome.cited.map(n => turn.sources[n - 1]) : []
      const records = cited.filter(source => source !== undefined)

      fill(pointerOf(records.length > 0 ? records : turn.sources))
    },
    draft: text => {
      asides.draft = text
    },
    close: isBand
      ? () => {
          asides.isBand = false
          host.redraw()
        }
      : undefined,
  }
}

/**
 * `/aside <question>`: a quick question to Fylgja, answered in a pane of its
 * own while Claude keeps working.
 *
 * The command answers with no text and no notes, so it prints nothing into
 * the transcript, leaves nothing for Claude to read, and starts no turn. The
 * plugin itself searches once and reads a few records, and a small model
 * writes the answer from those alone. The only way anything reaches the main
 * conversation is a button that puts record references into the prompt box
 * for the person to send or not.
 */
export function register(on: On): void {
  const asides = Asides.create()

  on('session.start', async ($, e, next) => {
    // `immediate` lets the command run while a turn is in flight.
    await $.command
      .register({
        name: 'aside',
        description: 'Ask Fylgja a side question in a pane; the main conversation never sees it',
        argumentHint: '<question>',
        immediate: true,
      })
      .catch(() => undefined)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'aside' }, async ($, e) => {
    const question = flat(e.args, MAX_QUESTION)

    if (question !== '') {
      // Not waited for: the command returns at once and the pane shows the progress.
      void ask(hostOf($), asides, question, undefined, undefined)
    }

    await show($, asides)

    return {}
  }).catch(() => ({}))

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) =>
    draw($.ui.resolve(e), asides, actionsOf(hostOf($), asides, false)),
  )

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) =>
    asides.isBand ? draw($.ui.resolve(e), asides, actionsOf(hostOf($), asides, true)) : next(e),
  )
}
