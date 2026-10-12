import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { PANE } from '../hooks/window'

/**
 * Fylgja's window as a test works it, whichever view it shows: Claude Code
 * beneath the plugin answered by the test, the pane drawn through the
 * plugin, and what it shows read off as words.
 */

export type Node = { type: string; props?: Record<string, unknown>; children?: (Node | string)[] }

/** What Claude Code was asked about the window, in order: the engine beneath the plugin, answered by the test. */
export type Frame = {
  opens: Record<string, unknown>[]
  closes: string[]
  /** How many moves of the window the plugin left to Claude Code. */
  scrolls: number
  commands: Record<string, unknown>[]
}

/** @param answers what Claude Code says to a request to open the window; that it is placed, without it */
export function frame(on: On, answers: () => 'placed' | 'unplaced' | 'refused' = () => 'placed'): Frame {
  const seen: Frame = { opens: [], closes: [], scrolls: 0, commands: [] }

  on('ui.open', ($, e) => {
    seen.opens.push({ ...e })

    const said = answers()

    return said === 'refused'
      ? { deny: 'no panes here' }
      : { value: said === 'placed' ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'The terminal is 60 columns wide.' } }
  })
  on('ui.close', ($, e) => {
    seen.closes.push(e.id)

    return { value: undefined } as never
  })
  on('ui.focus', () => ({}))
  on('ui.scroll', () => {
    seen.scrolls += 1

    return {}
  })
  on('command.register', ($, e) => {
    seen.commands.push({ ...e })

    return { value: { command: e.name } } as never
  })

  return seen
}

export function wordsOf(node: Node | string): string {
  if (typeof node === 'string') {
    return node
  }

  // A key is its words: the label it was given, or the one its children come to.
  if (typeof node.props?.label === 'string') {
    return node.props.label
  }

  return (node.children ?? []).map(wordsOf).join('')
}

export function all(tree: Node, type: string): Node[] {
  const below = (tree.children ?? []).flatMap(child => (typeof child === 'string' ? [] : all(child, type)))

  return tree.type === type ? [tree, ...below] : below
}

export const isRule = (text: string): boolean => /^─+$/.test(text)

/** One line of the window as its words: what stands side by side in a row is set apart by a bar. */
export function lineOf(node: Node | string): string {
  return typeof node !== 'string' && node.type === 'Box' ? (node.children ?? []).map(lineOf).join(' | ') : wordsOf(node)
}

/** The window as the plugin draws it: into `columns` cells and `rows` rows, with or without the keys. */
export async function pane($: Engine, isFocused = true, columns = 100, rows = 20, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await $.ui.mount({
    plugin: 'fylgja',
    component: 'Pane',
    surface,
    requestId: PANE,
    props: { title: 'Fylgja · kept', isFocused, bodyColumns: columns, placement: 'inline', scroll: { offset: 0, bodyRows: rows }, view: {} },
  } as never)
  const tree = async (): Promise<Node> => (await ui.drawn()) as unknown as Node
  const keys = async (): Promise<Node[]> => all(await tree(), 'Button')

  return {
    tree,
    keys,
    /** Every line the window shows, in the order drawn, the rule under the title bar left out. */
    lines: async () =>
      ((await tree()).children ?? []).flatMap(function lines(child): string[] {
        if (typeof child === 'string') {
          return [child]
        }

        // A column holds lines; anything else is one line, its parts set apart.
        return child.type === 'Box' && child.props?.flexDirection === 'column' ? (child.children ?? []).flatMap(lines) : [lineOf(child)]
      }).filter(line => !isRule(line)),
    hasRule: async () => all(await tree(), 'Text').some(text => isRule(wordsOf(text))),
    /** The rows, each as its words. */
    rows: async () =>
      (await keys())
        .filter(key => String(key.props?.key).startsWith('row:'))
        .map(wordsOf),
    /** The keys that are not rows, each as its words. */
    actions: async () =>
      (await keys())
        .filter(key => !String(key.props?.key).startsWith('row:'))
        .map(wordsOf),
    /** The keys that wait for their second press, each as its words: the ones that are filled. */
    waiting: async () =>
      (await keys())
        .filter(key => all(key, 'Text').some(text => text.props?.inverse === true))
        .map(wordsOf),
    press: (key: string) => ui.press({ key } as never),
    /** Enter in the field that is open, with `value` in it. */
    enter: async (value: string) => {
      const key = String(all(await tree(), 'Input')[0]?.props?.key)

      return (ui as unknown as { input: (act: { key: string; text: string }) => Promise<unknown> }).input({ key, text: value })
    },
    /** Enter in the field `key`, with `value` in it: asked at once, without a look at the drawing first. */
    enterIn: (key: string, value: string) =>
      (ui as unknown as { input: (act: { key: string; text: string }) => Promise<unknown> }).input({ key, text: value }),
    /** The window is drawn again, with or without the keys. */
    keyed: (isHeld: boolean) =>
      ui.redraw({
        title: 'Fylgja · kept',
        isFocused: isHeld,
        bodyColumns: columns,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: rows },
        view: {},
      } as never),
    unmount: () => ui.unmount(),
  }
}

/** The person moves the window with a key or the wheel, as Claude Code reports it. */
export function scrolled($: Engine, by: number, more: Record<string, unknown> = {}): Promise<{ deny?: string }> {
  return $.ui.scroll({
    component: 'Pane',
    requestId: PANE,
    offset: Math.max(0, by),
    by,
    bodyRows: 6,
    contentRows: 40,
    origin: { kind: 'person' },
    ...more,
  } as never)
}

/** The person moves the focus ring onto an element of the window: an arrow, Tab or a click. */
export function ringOn($: Engine, element: string | undefined): Promise<unknown> {
  return $.ui.focus({
    component: 'Pane',
    requestId: PANE,
    ...(element === undefined ? {} : { plugin: 'fylgja', element }),
    origin: { kind: 'person' },
  } as never)
}
