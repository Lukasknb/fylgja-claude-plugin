import type { EngineInterface, On } from 'claude-code'

import * as Finder from './finder'
import type { Host } from './host'
import { painted } from './paint'
import * as Pane from './pane'
import * as Picker from './picker'
import { lineOf, rowsOf } from './rows'
import * as Source from './source'

/**
 * The engine calls this plugin makes, each spelled out here once and handed
 * to the plugin's other files as plain functions.
 */
function hostOf($: EngineInterface): Host {
  return {
    connect: () => $.mcp.connect('fylgja'),
    call: (server, tool, args) => $.mcp.call(server, tool, args),
    redraw: () => $.ui.invalidate('ui.render'),
    after: (ms, fn) => $.clock.after(ms, fn),
    every: (ms, fn) => $.clock.every(ms, fn),
    read: () => $.prompt.read(),
    fill: args => $.prompt.fill(args),
    close: id => $.ui.close({ id }),
  }
}

/**
 * Mention a Fylgja record the way a file is mentioned: type `@@` or `{{` and
 * a few letters, and the records that match are listed above the prompt; a
 * key or a click puts the reference in. `/pick` opens the same list in a
 * pane.
 *
 * Only the prompt box's draft is written, and only when the person chooses a
 * record. No hook sees a prompt on its way to Claude, so nothing is added to
 * what Claude reads. The hook on the prompt box asks Fylgja nothing itself:
 * it notes what is typed and leaves the asking to a timer.
 */
export function register(on: On): void {
  const source = Source.create()
  const picker = Picker.create()
  const pane = Pane.create()
  // The session's own calls, for work that outlives the keystroke that started it.
  let session: Host | undefined

  on('session.start', async ($, e, next) => {
    session = hostOf($)

    await $.command
      .register({
        name: 'pick',
        description: 'Find a Fylgja meeting, session, note or project and put its reference in the prompt',
        argumentHint: '[part of a title]',
      })
      .catch(() => undefined)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'pick' }, async ($, e) => {
    const host = hostOf($)
    const placed = await $.ui.open({
      id: Pane.PANE_ID,
      title: 'Fylgja',
      focus: true,
      closeOnEscape: true,
    })

    if (!placed.isPlaced) {
      return { text: 'Fylgja: there is no room for the picker here.' }
    }

    Pane.begin(host, source, pane, e.args)

    return {}
  }).catch(() => ({ text: 'Fylgja: the picker could not be opened.' }))

  on('prompt.edit', async ($, e, next) => {
    const host = session ?? hostOf($)
    const taken = Picker.keyTaken(host, picker, source, e)

    if (taken !== undefined) {
      return painted(taken)
    }

    const box = await next(e)

    return painted(Picker.follow(host, picker, source, e, box) ?? box)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    // Closed, the band is not this plugin's: nothing is drawn, not even an empty row.
    if (picker.open === undefined || e.props.hasSurvey) {
      return next(e)
    }

    const host = hostOf($)
    const kit = $.ui.resolve(e)
    const view = Finder.viewOf(picker.finder, source)
    const onDismiss = (): void => Picker.dismiss(host, picker)
    if (picker.note !== undefined || view.rows.length === 0) {
      return lineOf(kit, picker.note ?? view.line ?? '', onDismiss)
    }

    return kit.Box({
      flexDirection: 'column',
      children: rowsOf(kit, view.rows, {
        width: e.props.bodyColumns,
        highlight: Math.min(picker.finder.highlight, view.rows.length - 1),
        // A number is the key that chooses the row, so it is shown only where a digit does that.
        isNumbered: view.isSettled && picker.open.mark === '@@',
        onDismiss,
        onChoose: candidate => void Picker.press(host, picker, candidate).catch(() => undefined),
      }),
    })
  })

  on('ui.render', { component: 'Pane', requestId: 'fylgja-pick' }, ($, e) => {
    const host = hostOf($)
    const kit = $.ui.resolve(e)

    return Pane.draw(kit, 'Input' in kit ? kit.Input : undefined, host, source, pane, e.props.bodyColumns)
  })
}
