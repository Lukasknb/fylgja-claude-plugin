import type { EngineInterface, On } from 'claude-code'

import * as Atlas from './atlas'
import { crumbs } from './draw'
import { fallbackOf } from './fallback'
import type { Host } from './host'
import { referenceOf, scopeOf } from './reference'
import { levelOf, pickedRow, ROOT } from './shape'
import type { Place, Position } from './shape'
import { messageOf, signatureOf, viewOf } from './view'

/** The pane's id, and the key of the navigator inside it. */
const PANE = 'fylgja-map'
const NAVIGATOR = 'navigator'

/** How long a row stays highlighted before the project under it is read ahead. */
export const DWELL_MS = 180

/** The rows of the pane that are not the navigator's: the note, the actions, and a margin. */
const CHROME_ROWS = 3

const UUID_IN = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/

/**
 * The engine calls the map makes, each spelled out here once and handed to
 * the plugin's other files as plain functions.
 */
function hostOf($: EngineInterface): Host {
  return {
    connect: () => $.mcp.connect('fylgja'),
    call: (server, tool, args) => $.mcp.call(server, tool, args),
    redraw: () => $.ui.invalidate('ui.render'),
    after: (ms, fn) => $.clock.after(ms, fn),
    // Insert mode: the text goes in at the cursor and what the person had
    // typed stays. Nothing is submitted.
    fill: text => {
      void $.prompt.fill({ text, mode: 'insert' }).catch(() => undefined)
    },
  }
}

/**
 * `/map [project]`: the Fylgja project tree as a place to move through.
 *
 * It only shows. The tree is read one level at a time with Fylgja's read
 * tools on the session's own connection, after the person asked for the
 * map, and is never changed from here. Nothing is added to what Claude
 * reads: the two actions on a project only put text into the prompt box for
 * the person to send or not.
 */
export function register(on: On): void {
  const atlas = Atlas.create()
  /** Whether the pane is closed, open and drawn, or open and waiting for room. */
  let shown: 'closed' | 'placed' | 'unplaced' = 'closed'
  /** The surfaces on which the navigator's surface module failed. */
  const faulted = new Set<string>()
  /** The view the navigator was last handed, as its signature. */
  let handed = ''
  let dwell: { cancel: () => void } | undefined
  /** The size the pane was last drawn at. */
  let size = { columns: 80, rows: 16 }

  /**
   * Reads what the person's position needs: the levels on their path at
   * once, and the highlighted project once the highlight has rested on it,
   * so holding an arrow key down reads nothing along the way.
   */
  function tend(host: Host): void {
    for (const id of atlas.position.path) {
      Atlas.wantPlace(host, atlas, id)
    }

    dwell?.cancel()
    dwell = host.after(DWELL_MS, () => wantPicked(host))
  }

  /** Reads the highlighted project's outline, and what holds there now while that is what the preview shows. */
  function wantPicked(host: Host): void {
    const level = Atlas.placeOf(atlas, levelOf(atlas.position))
    const row = level?.rows.find(one => one.id === atlas.position.pick) ?? level?.rows[0]

    if (row === undefined) {
      return
    }

    Atlas.wantPlace(host, atlas, row.id)

    if (atlas.position.showsState) {
      Atlas.wantKnowledge(host, atlas, row.id)
    }
  }

  /** The highlighted project, or the level itself when it lists nothing. */
  function subject(): Pick<Place, 'id' | 'name' | 'path'> | undefined {
    const places: Record<string, Place> = {}

    for (const id of atlas.position.path) {
      const place = Atlas.placeOf(atlas, id)

      if (place !== undefined) {
        places[id] = place
      }
    }

    const names = crumbs(atlas.position, places).slice(1)
    const row = pickedRow(atlas.position, places)

    if (row !== undefined) {
      return { id: row.id, name: row.name, path: atlas.places.get(row.id)?.path ?? [...names, row.name] }
    }

    const level = Atlas.placeOf(atlas, levelOf(atlas.position))

    return level === undefined || level.id === ROOT ? undefined : { id: level.id, name: level.name, path: names }
  }

  /** Puts text about the highlighted project into the prompt box. It fills and never submits. */
  function act(host: Host, kind: 'reference' | 'scope'): void {
    const project = subject()

    if (project !== undefined) {
      host.fill(kind === 'reference' ? `${referenceOf(project.name, project.id)} ` : scopeOf(project))
    }
  }

  function go(host: Host, position: Position): void {
    const isAsked = position.showsState && !atlas.position.showsState
    atlas.position = position
    atlas.miss = ''
    tend(host)

    if (isAsked) {
      wantPicked(host)
    }
    host.redraw()
  }

  on('session.start', async ($, e, next) => {
    // Registered inside a try: a failure here must not skip the session's
    // start for every plugin beneath.
    try {
      await $.command.register({
        name: 'map',
        description: 'Move through the Fylgja project tree',
        argumentHint: '[project]',
      })
    } catch {
      // Without the command there is no map; nothing else depends on it.
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'map' }, async ($, e) => {
    const host = hostOf($)
    const opened = await $.ui.open({ id: PANE, title: 'Fylgja map', focus: true })
    shown = opened.isPlaced ? 'placed' : 'unplaced'

    Atlas.retry(atlas)
    tend(host)

    const asked = e.args.trim().slice(0, 300)

    if (asked !== '') {
      // A pasted reference or a bare id names the project by its id.
      void Atlas.goTo(host, atlas, UUID_IN.exec(asked)?.[0].toLowerCase() ?? asked)
        .then(() => tend(host))
        .catch(() => undefined)
    }

    $.ui.invalidate('ui.render')

    // No text: a command's output is read by Claude on the next turn, and
    // the map adds nothing to what Claude reads.
    return {}
  }).catch(() => ({}))

  on('ui.close', { id: PANE }, ($, e, next) => {
    shown = 'closed'
    dwell?.cancel()
    $.ui.invalidate('ui.render')

    return next(e)
  }).catch(($, e, next) => next(e))

  // The navigator's surface module failed on this surface: the engine draws
  // the pane again, and this time it gets the buttons.
  on('ui.fault', ($, e, next) => {
    if (e.requestId === PANE) {
      faulted.add(e.surface)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.message', ($, e, next) => {
    const message = e.requestId === PANE && e.element === NAVIGATOR ? messageOf(e.data) : undefined

    if (message === undefined) {
      return next(e)
    }

    const host = hostOf($)

    // A message from before the person was moved elsewhere describes a
    // position that no longer stands.
    if (message.epoch === atlas.epoch) {
      const isAsked = message.position.showsState && !atlas.position.showsState
      atlas.position = message.position
      atlas.miss = ''

      // The key that asks for what holds now is a request of its own: it is
      // read at once, not after the highlight has rested.
      if (isAsked) {
        wantPicked(host)
      }

      if (message.act !== undefined) {
        act(host, message.act)
      }
    }

    // Started, never waited for: the answer goes back at once with what is
    // known, and what is read arrives with a later drawing.
    tend(host)

    const view = viewOf(atlas, size.columns, size.rows)
    const signature = signatureOf(view)

    if (signature === handed) {
      return {}
    }

    handed = signature

    return { props: view }
  }).catch(() => ({}))

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => {
    const host = hostOf($)
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements

    if (shown !== 'placed') {
      // The pane is on screen now, so the line above the prompt goes.
      shown = 'placed'
      $.ui.invalidate('ui.render')
    }

    size = { columns: Math.max(20, e.props.bodyColumns), rows: Math.max(8, e.props.scroll.bodyRows - CHROME_ROWS) }

    // A pane that outlived a reload of the plugin is still the person's
    // open map: the tree is read again, once, started and not waited for.
    if (Atlas.isUntouched(atlas)) {
      tend(host)
    }

    const view = viewOf(atlas, size.columns, size.rows)
    const hasNavigator = (e.surface === 'terminal' || e.surface === 'desktop') && !faulted.has(e.surface)
    handed = signatureOf(view)

    return Box({
      flexDirection: 'column',
      children: [
        ...(view.note === '' ? [] : [Text({ color: 'warning', wrap: 'truncate-end', children: [view.note] })]),
        'Client' in elements && hasNavigator
          ? elements.Client({ key: NAVIGATOR, module: './navigator.ts', props: view, width: '100%' })
          : fallbackOf(elements, view, position => go(host, position)),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Button({ key: 'act-reference', label: 'reference → prompt', onPress: () => act(host, 'reference') }),
            Button({ key: 'act-scope', label: 'ask in this place', onPress: () => act(host, 'scope') }),
          ],
        }),
      ],
    })
  })

  // One line above the prompt, only while the pane is open and waits for
  // room: where the person is, and how to get the pane.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (shown !== 'unplaced') {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const places: Record<string, Place> = {}

    for (const id of atlas.position.path) {
      const place = Atlas.placeOf(atlas, id)

      if (place !== undefined) {
        places[id] = place
      }
    }

    const row = pickedRow(atlas.position, places)
    const where = [...crumbs(atlas.position, places), ...(row === undefined ? [] : [row.name])].join(' › ')
    const note = atlas.note !== '' ? atlas.note : atlas.miss

    return Box({
      flexDirection: 'column',
      children: [
        Text({
          wrap: 'truncate-end',
          children: [
            Text({ dimColor: true, children: ['map  '] }),
            note === '' ? where : note,
            Text({ dimColor: true, children: ['  ·  the pane waits for a wider window; /map asks again'] }),
          ],
        }),
        await next(e),
      ],
    })
  })
}
