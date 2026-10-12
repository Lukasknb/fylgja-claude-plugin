import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PANE } from '../hooks/ledger'
import { ARM_MS } from '../hooks/scribe/band'
import * as Ledger from '../hooks/scribe/ledger'
import type { Written } from '../hooks/scribe/types'
import { answer, idOf, NEEDS_SIGN_IN } from './fixtures'
import { claude, decision, dev, edit, EMPTY, MARK, NOTHING, press, pressTwice, QUIET, shown, stage, START, turn, verdict } from './scribe-fixtures'

const FILE = 'src/queue/lock.ts'
const WORK = [dev('lock the retry queue with redis, and cap the retries'), claude('Done.', edit(FILE))]
const MORE = [dev('and log every retry'), claude('Done.', edit(FILE))]
const LOCK = decision({ content: 'Use a Redis lock for the retry queue.', detail: 'Redis is already there.', anchors: [{ path: FILE, symbol: 'acquire' }] })
const CAP = decision({ content: 'Cap retries at five.', detail: 'A sixth never succeeded.', alternatives: ['retry forever'], anchors: [{ path: FILE }] })
const LOG = decision({ content: 'Log every retry at warn.', detail: 'They were invisible.', anchors: [{ path: FILE }] })
const TWO = verdict({ records: [LOCK, CAP] })
const DROPPING = JSON.stringify({ outcome: 'act', records: [], withdraw: [idOf(102)] })
const ASKING = verdict({
  records: [decision({ detail: '', reason_status: 'not_stated', anchors: [] })],
  question: { form: 'reason', record: 0, options: ['One less service to run', 'Redis was flaky in CI'] },
})

/** The ids Fylgja gives the records of a session, in the order they are written. */
const FIRST = idOf(101)
const SECOND = idOf(102)

/** The two rows of a session that kept the lock and then the cap, with the cap selected. */
const CAP_ROW = '▸ ◆ Decision · Cap retries at five.'
const LOCK_ROW = '  ◆ Decision · Use a Redis lock for the retry queue.'

/** How long the mark stays text after it opened the window; the plugin's own figure. */
const HANDOVER_MS = 60

const COMMAND = {
  command: 'fylgja-kept',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
} as never

const BAND = {
  plugin: 'fylgja',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as never

type Node = { type: string; props?: Record<string, unknown>; children?: (Node | string)[] }

/** What Claude Code was asked about the window, in order: the engine beneath the plugin, answered by the test. */
type Frame = {
  opens: Record<string, unknown>[]
  closes: string[]
  /** How many moves of the window the plugin left to Claude Code. */
  scrolls: number
  commands: Record<string, unknown>[]
}

/** @param answers what Claude Code says to a request to open the window; that it is placed, without it */
function frame(on: On, answers: () => 'placed' | 'unplaced' | 'refused' = () => 'placed'): Frame {
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

function wordsOf(node: Node | string): string {
  if (typeof node === 'string') {
    return node
  }

  // A key is its words: the label it was given, or the one its children come to.
  if (typeof node.props?.label === 'string') {
    return node.props.label
  }

  return (node.children ?? []).map(wordsOf).join('')
}

function all(tree: Node, type: string): Node[] {
  const below = (tree.children ?? []).flatMap(child => (typeof child === 'string' ? [] : all(child, type)))

  return tree.type === type ? [tree, ...below] : below
}

const isRule = (text: string): boolean => /^─+$/.test(text)

/** One line of the window as its words: what stands side by side in a row is set apart by a bar. */
function lineOf(node: Node | string): string {
  return typeof node !== 'string' && node.type === 'Box' ? (node.children ?? []).map(lineOf).join(' | ') : wordsOf(node)
}

/** The window as the plugin draws it: into `columns` cells and `rows` rows, with or without the keys. */
async function pane($: Engine, isFocused = true, columns = 100, rows = 20, surface: 'terminal' | 'desktop' = 'terminal') {
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
    press: (key: string) => ui.press({ key } as never),
    enter: (value: string) =>
      (ui as unknown as { input: (act: { key: string; text: string }) => Promise<unknown> }).input({ key: 'reword-text', text: value }),
    unmount: () => ui.unmount(),
  }
}

/** A session in which Scribe has kept two records, the lock first and the cap after it; the window is not open. */
async function kept($: Engine, on: On, options: Parameters<typeof stage>[1] = {}, answers?: () => 'placed' | 'unplaced' | 'refused') {
  const seen = frame(on, answers)
  const set = stage(on, { replies: [TWO], ...options })

  await $.session.start(START)
  await turn($, set, ...WORK)
  // The receipt is put away; what is left above the prompt is the mark.
  await press($, 'ok')

  return { seen, set }
}

/** The same session with the window opened by its command. */
async function opened($: Engine, on: On, options: Parameters<typeof stage>[1] = {}) {
  const session = await kept($, on, options)

  await $.command.run(COMMAND)

  return session
}

/** The person moves the window with a key or the wheel, as Claude Code reports it. */
function scrolled($: Engine, by: number, more: Record<string, unknown> = {}): Promise<{ deny?: string }> {
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
function ringOn($: Engine, element: string | undefined): Promise<unknown> {
  return $.ui.focus({
    component: 'Pane',
    requestId: PANE,
    ...(element === undefined ? {} : { plugin: 'fylgja', element }),
    origin: { kind: 'person' },
  } as never)
}

const record = (id: string, content: string, more: Partial<Written> = {}): Written => ({
  id,
  kind: 'decision',
  content,
  reasonStatus: 'stated',
  outcome: 'created',
  replaced: null,
  detail: 'Because.',
  anchors: [{ path: FILE }],
  ...more,
})

const words = (parts: readonly ({ text: string } | { link: string; label: string })[] | undefined): string =>
  (parts ?? []).map(part => ('text' in part ? part.text : '')).join('')

describe('the window of what was kept, as it is described', () => {
  test('the rows are the records that stand, newest first, and the removed ones under them', () => {
    const ledger = Ledger.create()
    const written = [record('a', 'First.'), record('b', 'Second.')]

    Ledger.shelve(ledger, record('x', 'Dropped.', { outcome: 'withdrawn' }))
    Ledger.shelve(ledger, record('y', 'Dropped later.', { outcome: 'withdrawn' }))

    const view = Ledger.viewOf(written, ledger, 100, true)

    expect(view.lines.map(line => [line.id, line.isGone, line.outcome])).toEqual([
      ['b', false, ''],
      ['a', false, ''],
      ['y', true, 'removed'],
      ['x', true, 'removed'],
    ])
    expect(view.count).toBe('2 kept')
    expect(view.lines.map(line => line.isSelected), 'with nothing picked the newest is selected').toEqual([true, false, false, false])
    expect(view.lines[0]?.detail.map(words)).toEqual(['Why: Because.', `In: ${FILE}`])
    expect(view.lines[1]?.detail, 'only the selected record is opened').toEqual([])
    expect(view.lines.flatMap(line => line.actions), 'and no key is up until one is asked for').toEqual([])
  })

  test('a record that stands again is listed once, as standing', () => {
    const ledger = Ledger.create()

    Ledger.shelve(ledger, record('a', 'First.', { outcome: 'withdrawn' }))

    expect(
      Ledger.viewOf([record('a', 'First.', { outcome: 'restored' })], ledger, 100, true).lines.map(line => [line.id, line.outcome]),
    ).toEqual([['a', 'put back']])
  })

  test('the selection moves a row at a time, stops at either end, and lets go of whatever was half done', () => {
    const ledger = Ledger.create()
    const entries = Ledger.entriesOf([record('a', 'First.'), record('b', 'Second.'), record('c', 'Third.')], ledger)

    expect(Ledger.step(entries, ledger, -1), 'the newest is the top').toBeUndefined()
    expect(Ledger.step(entries, ledger, 1)).toBe('b')

    ledger.acting = 'b'
    ledger.armed = { key: 'remove:b', until: 10 }
    ledger.editing = 'b'

    expect(Ledger.step(entries, ledger, 5), 'a page past the end lands on the last').toBe('a')
    expect([ledger.acting, ledger.armed, ledger.editing]).toEqual([undefined, null, undefined])
    expect(Ledger.step(entries, ledger, 1)).toBeUndefined()
    expect(Ledger.step(entries, ledger, -Number.MAX_SAFE_INTEGER)).toBe('c')
  })

  test('a sentence longer than its row is cut so the row is one line, what became of it included, and shown whole where it is opened', () => {
    const long = `Use ${'a very long name '.repeat(8)}for the queue.`

    for (const columns of [48, 57, 80]) {
      const [line] = Ledger.viewOf([record('a', long, { outcome: 'updated' })], Ledger.create(), columns, true).lines

      expect(line?.sentence.endsWith('…')).toBe(true)
      expect(`▸ ${line?.kind} · ${line?.sentence} · ${line?.outcome}`.length, `at ${columns} columns`).toBeLessThan(columns)
      expect(words(line?.detail[0])).toBe(long)
    }
  })

  test('nothing a record holds is drawn as it came: a row is one line, with no mark of the plugin’s in it', () => {
    const [line] = Ledger.viewOf([record('a', 'Use ◆ the\nqueue ✓ · always‮.')], Ledger.create(), 100, true).lines

    expect(line?.sentence).toBe('Use the queue - always.')
  })

  test('the line of keys names keys only while the window has them, and no key is ever a letter or a digit', () => {
    const ledger = Ledger.create()
    const written = [record('a', 'First.')]
    const legend = (isFocused: boolean): string => Ledger.viewOf(written, ledger, 100, isFocused).legend

    expect(legend(true)).toBe(Ledger.LEGENDS.list)
    expect(legend(false), 'without the keys it says how the window is given them').toBe(Ledger.LEGENDS.away)

    ledger.acting = 'a'

    expect(legend(true)).toBe(Ledger.LEGENDS.keys)
    expect(legend(false)).toBe(Ledger.LEGENDS.away)

    ledger.editing = 'a'

    expect(legend(true)).toBe(Ledger.LEGENDS.field)
    expect(Ledger.viewOf([], Ledger.create(), 100, false).legend).toBe(Ledger.LEGENDS.awayQuiet)

    for (const line of [Ledger.LEGENDS.list, Ledger.LEGENDS.keys, Ledger.LEGENDS.field, Ledger.LEGENDS.quiet]) {
      expect(line, 'only the arrows, Enter and Escape').not.toMatch(/(?:^| )[a-z0-9] /)
    }
  })

  test('in a window one row too short the rule goes; with the keys up the last of what the record holds goes too; a long list is left whole', () => {
    const ledger = Ledger.create()
    const written = [record('a', 'First.'), record('b', 'Second.', { alternatives: ['a third way'] })]
    // The title bar, the rule, two rows, three lines of the selected record, and the line of keys.
    const tall = Ledger.viewOf(written, ledger, 100, true, undefined, 8)
    const short = Ledger.viewOf(written, ledger, 100, true, undefined, 7)

    expect([tall.hasRule, tall.lines[0]?.detail.length]).toEqual([true, 3])
    expect([short.hasRule, short.lines[0]?.detail.length]).toEqual([false, 3])

    ledger.acting = 'b'

    const worked = Ledger.viewOf(written, ledger, 100, true, undefined, 7)

    expect([worked.hasRule, worked.lines[0]?.detail.map(words)], 'the keys take the place of the last line').toEqual([
      false,
      ['Why: Because.', 'Rejected: a third way'],
    ])

    const tight = Ledger.viewOf(written, Ledger.create(), 100, true, undefined, 4)

    expect([tight.hasRule, tight.lines[0]?.detail.length], 'what cannot fit is scrolled, not cut').toEqual([true, 3])
  })

  test('what the window held for a record Scribe has since taken back is let go', () => {
    const ledger = Ledger.create()

    ledger.acting = 'a'
    ledger.editing = 'a'
    ledger.armed = { key: 'remove:a', until: 10 }
    Ledger.tidy([record('b', 'Second.')], ledger)

    expect([ledger.acting, ledger.editing, ledger.armed]).toEqual([undefined, undefined, null])
  })
})

describe('the mark opens the window', () => {
  test('a press on the mark opens it and hands it the keys, and it never opens by itself', async ($, on) => {
    const { seen, set } = await kept($, on, { replies: [TWO, NOTHING] })

    await turn($, set, ...MORE)
    await set.clock.advance(60_000)

    expect(await shown($)).toBe(`${QUIET} · 2 kept`)
    expect([seen.opens, seen.closes], 'records were kept and turns ran: nothing opened').toEqual([[], []])

    await press($, 'kept')

    // The keys are asked for, Escape closes it, and no toast is held back for it.
    const asked = { id: PANE, title: 'Fylgja · kept', focus: true, closeOnEscape: true, rows: 10 }

    expect(seen.opens, 'opened while the press is answered').toEqual([asked])

    // The press left the keys with the band. While the window is open the mark is text: the band has nothing to hold them with.
    const band = await $.ui.mount(BAND)

    expect(all((await band.drawn()) as unknown as Node, 'Button')).toEqual([])
    expect((await band.find({ type: 'Text', text: `${MARK} · 2 kept` }))?.props, 'it reads as it did').toEqual({ dimColor: true })

    await set.clock.advance(HANDOVER_MS)

    expect(seen.opens, 'and the window is asked for the keys again once the band has let go').toEqual([asked, asked])
    expect(all((await band.drawn()) as unknown as Node, 'Button'), 'open, it is the only place the keys can go').toEqual([])

    // Closed, the mark is a key again, and opens it again.
    await $.classic.SessionStart({ source: 'clear' })

    expect(seen.closes).toEqual([PANE])
    expect(all((await band.drawn()) as unknown as Node, 'Button').map(key => key.props?.key)).toEqual(['kept'])

    await band.unmount()
    await press($, 'kept')
    await set.clock.advance(HANDOVER_MS)

    expect(seen.opens).toHaveLength(4)
    expect([set.toasts, set.fills], 'nothing was said or typed for it').toEqual([[], []])
  })

  test('where Claude Code does not open it, or shows it nowhere, one line says so, nothing is left open and the next press asks again', async ($, on) => {
    let answers: 'placed' | 'unplaced' | 'refused' = 'refused'
    const { seen, set } = await kept($, on, {}, () => answers)

    await press($, 'kept')
    await set.clock.advance(HANDOVER_MS)

    expect(seen.opens, 'asked once: there is nothing to hand the keys to').toHaveLength(1)
    expect(set.toasts).toEqual(['Fylgja: the window could not be opened here.'])
    expect(await shown($), 'the mark is as it was').toBe(`${QUIET} · 2 kept`)

    answers = 'unplaced'
    await press($, 'kept')
    await set.clock.advance(HANDOVER_MS)

    expect(set.toasts.at(-1)).toBe('Fylgja: the window cannot be shown here. The terminal is 60 columns wide.')
    expect([seen.opens.length, seen.closes], 'it is not left to come up later by itself').toEqual([2, [PANE]])

    answers = 'placed'
    await press($, 'kept')

    expect(seen.opens, 'the mark is still a key').toHaveLength(3)
  })

  test('the mark has no hotkey and asks for no focus', async ($, on) => {
    await kept($, on)

    const band = await $.ui.mount(BAND)
    const [mark] = all((await band.drawn()) as unknown as Node, 'Button')

    expect(mark?.props).toMatchObject({ key: 'kept', plain: true, dimColor: true, label: `${MARK} · 2 kept` })
    expect(Object.keys(mark?.props ?? {}).filter(name => name === 'hotkey' || name === 'autoFocus' || name === 'action')).toEqual([])

    await band.unmount()
  })

  test('its command opens the same window, and answers with no line for Claude to read', async ($, on) => {
    const { seen } = await kept($, on)

    expect(seen.commands).toEqual([{ name: 'fylgja-kept', description: 'Show what Fylgja kept in this session', immediate: true }])
    expect(await $.command.run(COMMAND)).toEqual({})
    expect(seen.opens.map(open => open.id)).toEqual([PANE])

    const ui = await pane($)

    expect(await ui.rows()).toEqual([CAP_ROW, LOCK_ROW])

    await ui.unmount()
  })

  test('a conversation that starts over closes it', async ($, on) => {
    const { seen } = await opened($, on)

    await $.classic.SessionStart({ source: 'clear' })

    expect(seen.closes).toEqual([PANE])

    await $.command.run(COMMAND)

    const ui = await pane($)

    expect(await ui.lines(), 'and what it listed was the conversation’s before').toContain(Ledger.QUIET.empty)

    await ui.unmount()
  })
})

describe('the window lists what Scribe kept', () => {
  test('a title bar with the count and a rule under it, a row a record newest first, the selected one opened, and a line of keys', async ($, on) => {
    await opened($, on)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await pane($, true, 100, 20, surface)
      const tree = await ui.tree()

      expect(await ui.lines()).toEqual([
        ' ᚠ fylgja  | kept in this session | 2 kept',
        CAP_ROW,
        'Why: A sixth never succeeded.',
        'Rejected: retry forever',
        `In: ${FILE}`,
        LOCK_ROW,
        Ledger.LEGENDS.list,
      ])
      expect(await ui.hasRule()).toBe(true)
      expect(await ui.actions(), 'the close mark is the one Claude Code draws on the frame: no second one, and no key until one is asked for').toEqual([])
      expect(JSON.stringify(tree), 'the plugin’s own colours are the theme’s, by name').not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i)

      await ui.unmount()
    }
  })

  test('the title bar says whether the window has the keys, and without them the line of keys names none', async ($, on) => {
    await opened($, on)

    const held = await pane($, true)
    const [name] = all(await held.tree(), 'Text')

    expect(name).toMatchObject({ props: { inverse: true, bold: true }, children: [' ᚠ fylgja '] })

    await held.unmount()

    const ui = await pane($, false)
    const [dim] = all(await ui.tree(), 'Text')

    expect(dim).toMatchObject({ props: { dimColor: true, bold: true }, children: ['ᚠ fylgja'] })
    expect((await ui.lines()).at(-1)).toBe(Ledger.LEGENDS.away)
    expect(await ui.rows(), 'the rows are the same').toEqual([CAP_ROW, LOCK_ROW])

    await ui.unmount()
  })

  test('in a window one row too short the title bar and the line of keys stay, and the rule gives way', async ($, on) => {
    await opened($, on)

    const ui = await pane($, true, 100, 7)

    expect(await ui.hasRule()).toBe(false)
    expect((await ui.lines()).at(0)).toMatch('ᚠ fylgja')
    expect((await ui.lines()).at(-1)).toBe(Ledger.LEGENDS.list)

    await ui.unmount()
  })

  test('the arrows go from record to record: the ring landing on a row selects it, and nothing else is in its way', async ($, on) => {
    await opened($, on)

    const ui = await pane($)

    expect((await ui.keys()).map(key => key.props?.key), 'the rows are the only stops').toEqual([`row:${SECOND}`, `row:${FIRST}`])

    await ringOn($, `row:${FIRST}`)

    expect(await ui.rows()).toEqual(['  ◆ Decision · Cap retries at five.', '▸ ◆ Decision · Use a Redis lock for the retry queue.'])
    expect(await ui.lines()).toContain(`In: ${FILE} (acquire)`)
    expect((await ui.keys()).map(key => key.props?.key)).toEqual([`row:${SECOND}`, `row:${FIRST}`])

    await ringOn($, `row:${SECOND}`)

    expect(await ui.rows()).toEqual([CAP_ROW, LOCK_ROW])

    await ui.unmount()
  })

  test('a scroll key moves the selection in place of the window; the wheel, and a key past the last row, are Claude Code’s', async ($, on) => {
    const { seen } = await opened($, on)
    const ui = await pane($)

    await scrolled($, 1)

    expect(await ui.rows()).toEqual(['  ◆ Decision · Cap retries at five.', '▸ ◆ Decision · Use a Redis lock for the retry queue.'])
    expect(seen.scrolls, 'the selection moved: the window is not moved under it').toBe(0)

    await scrolled($, 1)

    expect(seen.scrolls, 'at the last row the key scrolls on, to what lies under the rows').toBe(1)

    await scrolled($, -1, { pointer: { column: 3, row: 2 } })

    expect(seen.scrolls, 'the wheel moves the window alone').toBe(2)
    expect((await ui.rows())[1]).toMatch(/^▸/)

    await scrolled($, -40)

    expect((await ui.rows())[0], 'Home is the newest').toMatch(/^▸/)
    expect(seen.scrolls).toBe(2)

    // While a sentence is being put right, the keys are the field's.
    await ui.press(`row:${SECOND}`)
    await ui.press(`reword:${SECOND}`)
    await scrolled($, 1)

    expect((await ui.rows())[0]).toMatch(/^▸/)
    expect(seen.scrolls).toBe(3)

    await ui.unmount()
  })

  test('a record Scribe keeps while the window is open is listed at once, the selection stays on its record, and a turn leaves it open', async ($, on) => {
    const { seen, set } = await opened($, on, { replies: [TWO, verdict({ records: [LOG] })] })
    const ui = await pane($)

    await ringOn($, `row:${SECOND}`)
    await turn($, set, ...MORE)

    expect(await ui.rows()).toEqual(['  ◆ Decision · Log every retry at warn.', CAP_ROW, LOCK_ROW])
    expect((await ui.lines())[0]).toMatch('3 kept')
    expect(seen.closes).toEqual([])

    await ui.unmount()
  })

  test('with nothing kept it says so in one quiet line', async ($, on) => {
    frame(on)
    stage(on)

    await $.session.start(START)
    await $.command.run(COMMAND)

    const ui = await pane($)

    expect(await ui.lines()).toEqual([' ᚠ fylgja  | kept in this session | ', Ledger.QUIET.empty, Ledger.LEGENDS.quiet])
    expect(await ui.keys()).toEqual([])

    await ui.unmount()
  })
})

describe('what is typed never acts on a record', () => {
  test('no key of the window is a letter or a digit, in any state it can be in, and nothing is typed into unless Reword was pressed', async ($, on) => {
    const { set } = await opened($, on)
    const ui = await pane($)
    const typed = async (): Promise<unknown[]> =>
      (await ui.keys()).flatMap(key => [key.props?.hotkey, key.props?.action]).filter(value => value !== undefined)
    const fields = async (): Promise<number> => all(await ui.tree(), 'Input').length

    expect([await typed(), await fields()], 'the list').toEqual([[], 0])

    await ui.press(`row:${SECOND}`)

    expect([await typed(), await fields(), await ui.actions()], 'the record’s keys').toEqual([[], 0, ['Reword', 'Remove']])

    await ui.press(`remove:${SECOND}`)

    expect([await typed(), await fields(), await ui.actions()], 'a key that waits').toEqual([[], 0, ['Reword', 'Again to remove']])

    await ui.press(`reword:${SECOND}`)

    expect([await typed(), await fields(), await ui.actions()], 'the field').toEqual([[], 1, ['Cancel']])
    expect(set.of('amend_memory'), 'and nothing was changed on the way').toEqual([])

    await ui.unmount()
  })

  test('Enter on a record only brings up its keys: it takes Reword and Enter in its field, or Remove twice, to change anything', async ($, on) => {
    const { set } = await opened($, on)
    const ui = await pane($)

    // Enter, as often as one likes, on the row the ring is on.
    await ui.press(`row:${SECOND}`)
    await ui.press(`row:${SECOND}`)
    await ui.press(`row:${SECOND}`)

    expect(await ui.actions()).toEqual(['Reword', 'Remove'])
    expect((await ui.lines()).at(-1)).toBe(Ledger.LEGENDS.keys)
    expect([set.of('amend_memory'), set.of('remember').length], 'nothing was changed').toEqual([[], 2])

    await ui.unmount()
  })
})

describe('a record is changed from the window', () => {
  test('Reword opens a field holding the sentence, and Enter rewrites the record once', async ($, on) => {
    const { set } = await opened($, on)
    const ui = await pane($)

    await ui.press(`row:${SECOND}`)
    await ui.press(`reword:${SECOND}`)

    const [field] = all(await ui.tree(), 'Input')

    expect(field?.props).toMatchObject({ key: 'reword-text', label: 'Reword', value: 'Cap retries at five.', autoFocus: true })
    expect(await ui.actions()).toEqual(['Cancel'])
    expect((await ui.lines()).at(-1)).toBe(Ledger.LEGENDS.field)
    expect(set.of('amend_memory'), 'nothing is changed by opening the field').toEqual([])

    await ui.enter('  Cap retries at three,\n not five. ')

    expect(set.of('amend_memory')).toEqual([{ atom_id: SECOND, op: 'fix', content: 'Cap retries at three, not five.', reason_status: 'stated' }])
    expect((await ui.rows())[0]).toBe('▸ ◆ Decision · Cap retries at three, not five. · updated')
    expect(all(await ui.tree(), 'Input'), 'the field is gone').toEqual([])
    expect(await ui.lines(), 'what the change did not send is as it was').toContain('Rejected: retry forever')

    // It is the developer's from here on, and can be put right again.
    await ui.press(`reword:${SECOND}`)
    await ui.enter('Cap retries at three.')

    expect(set.of('amend_memory')).toHaveLength(2)
    expect((await ui.rows())[0]).toBe('▸ ◆ Decision · Cap retries at three. · updated')
    expect(set.toasts).toEqual([])

    await ui.unmount()
  })

  test('Cancel, the same sentence and a sentence that is none change nothing', async ($, on) => {
    const { set } = await opened($, on)
    const ui = await pane($)

    await ui.press(`row:${SECOND}`)
    await ui.press(`reword:${SECOND}`)
    await ui.press('cancel')

    expect(all(await ui.tree(), 'Input')).toEqual([])
    expect(await ui.actions(), 'the record’s keys are up again').toEqual(['Reword', 'Remove'])

    await ui.press(`reword:${SECOND}`)
    await ui.enter('Cap retries at five.')
    await ui.press(`reword:${SECOND}`)
    await ui.enter(`Cap ${'x'.repeat(230)}`)

    expect(set.of('amend_memory')).toEqual([])
    expect(await ui.lines()).toContain(`! ${Ledger.TROUBLE.length}`)
    expect((await ui.rows())[0]).toBe(CAP_ROW)

    await ui.unmount()
  })

  test('Remove acts on its second press only, once, and the record is listed as removed', async ($, on) => {
    const { set } = await opened($, on)
    const ui = await pane($)

    await ui.press(`row:${SECOND}`)
    await ui.press(`remove:${SECOND}`)

    expect(set.of('amend_memory'), 'one press removes nothing').toEqual([])
    expect(await ui.actions()).toEqual(['Reword', 'Again to remove'])
    expect(await ui.lines()).toContain(Ledger.ARMED_NOTE)

    await set.clock.advance(ARM_MS + 1)

    expect(await ui.actions(), 'left alone it stops waiting').toEqual(['Reword', 'Remove'])

    await ui.press(`remove:${SECOND}`)
    await ui.press(`remove:${SECOND}`)

    expect(set.of('amend_memory')).toEqual([{ atom_id: SECOND, op: 'remove' }])
    expect(await ui.rows()).toEqual(['  ◆ Decision · Use a Redis lock for the retry queue.', '▸ ◆ Decision · Cap retries at five. · removed'])
    expect(await ui.actions()).toEqual(['Put back'])
    expect((await ui.lines())[0]).toMatch('1 kept')
    expect(await shown($), 'the mark counts what stands').toBe(`${QUIET} · 1 kept`)

    await ui.unmount()
  })

  test('a key that waits for its second press stops waiting as soon as the ring leaves it', async ($, on) => {
    const { set } = await opened($, on)
    const ui = await pane($)

    for (const away of [`reword:${SECOND}`, `row:${FIRST}`, `row:${SECOND}`, undefined]) {
      await ui.press(`row:${SECOND}`)
      await ui.press(`remove:${SECOND}`)
      await ringOn($, `remove:${SECOND}`)

      expect(await ui.actions(), 'the ring on the key itself leaves it waiting').toEqual(['Reword', 'Again to remove'])

      await ringOn($, away)
      await ui.press(`row:${SECOND}`)

      expect(await ui.actions(), `after the ring went to ${away ?? 'Claude Code’s own mark'}`).toEqual(['Reword', 'Remove'])
    }

    await ui.press(`remove:${SECOND}`)
    await scrolled($, 1)
    await ui.press(`row:${SECOND}`)
    await ui.press(`remove:${SECOND}`)

    expect(await ui.actions(), 'and after a scroll key moved the selection').toEqual(['Reword', 'Again to remove'])
    expect(set.of('amend_memory'), 'none of it removed anything').toEqual([])

    await ui.unmount()
  })

  test('Put back acts on its second press only, once, and the record stands again', async ($, on) => {
    const { set } = await opened($, on)
    const ui = await pane($)

    await ui.press(`row:${SECOND}`)
    await ui.press(`remove:${SECOND}`)
    await ui.press(`remove:${SECOND}`)

    const before = set.of('remember').length

    await ui.press(`putback:${SECOND}`)

    expect(set.of('remember')).toHaveLength(before)
    expect(await ui.actions()).toEqual(['Again to put back'])

    await ui.press(`putback:${SECOND}`)

    expect(set.of('remember').slice(before)).toEqual([
      expect.objectContaining({
        content: 'Cap retries at five.',
        detail: 'A sixth never succeeded.',
        alternatives: ['retry forever'],
        anchors: [{ path: FILE }],
        reason_status: 'stated',
      }),
    ])
    // The stand-in gives it a new id, as Fylgja may: the selection follows the record.
    expect(await ui.rows()).toEqual(['▸ ◆ Decision · Cap retries at five. · put back', LOCK_ROW])
    expect(await ui.actions()).toEqual(['Reword', 'Remove'])
    expect(await shown($)).toBe(`${QUIET} · 2 kept`)

    await ui.unmount()
  })

  test('a key pressed again while Fylgja is still asked starts no second change', async ($, on) => {
    const slow = async (args: Record<string, unknown>, clock: { sleep: (ms: number) => Promise<void> }): Promise<unknown> => {
      await clock.sleep(500)

      return answer({ atom_id: args.atom_id, outcome: args.op === 'remove' ? 'removed' : 'fixed' })
    }
    const { set } = await opened($, on, { tools: { amend_memory: slow } })
    const ui = await pane($)

    await ui.press(`row:${SECOND}`)
    await ui.press(`remove:${SECOND}`)

    // Held down: the press that removes, and three more before Fylgja has answered.
    const presses = [1, 2, 3, 4].map(() => ui.press(`remove:${SECOND}`).catch(() => undefined))

    await set.clock.advance(100)

    expect(await ui.actions(), 'while it is asked there is no key to press').toEqual([])
    expect(await ui.lines()).toContain(Ledger.WAITING)

    await set.clock.advance(500)
    await Promise.all(presses)

    expect(set.of('amend_memory')).toEqual([{ atom_id: SECOND, op: 'remove' }])
    expect(await ui.actions()).toEqual(['Put back'])

    await ui.unmount()
  })

  test('Enter pressed again in the field while Fylgja is still asked rewrites once', async ($, on) => {
    const slow = async (args: Record<string, unknown>, clock: { sleep: (ms: number) => Promise<void> }): Promise<unknown> => {
      await clock.sleep(500)

      return answer({ atom_id: args.atom_id, outcome: 'fixed' })
    }
    const { set } = await opened($, on, { tools: { amend_memory: slow } })
    const ui = await pane($)

    await ui.press(`row:${SECOND}`)
    await ui.press(`reword:${SECOND}`)

    const entered = [1, 2, 3].map(() => ui.enter('Cap retries at three.').catch(() => undefined))

    await set.clock.advance(600)
    await Promise.all(entered)

    expect(set.of('amend_memory')).toHaveLength(1)
    expect((await ui.rows())[0]).toBe('▸ ◆ Decision · Cap retries at three. · updated')

    await ui.unmount()
  })

  test('a record Scribe took back can be put back from the window', async ($, on) => {
    const { set } = await kept($, on, { replies: [TWO, DROPPING] })

    await turn($, set, dev('no cap after all, retries are cheap'), claude('Done.', edit(FILE)))
    await press($, 'ok')
    await $.command.run(COMMAND)

    const ui = await pane($)

    expect(await ui.rows()).toEqual(['▸ ◆ Decision · Use a Redis lock for the retry queue.', '  ◆ Decision · Cap retries at five. · removed'])

    await ui.press(`row:${SECOND}`)
    await ui.press(`putback:${SECOND}`)
    await ui.press(`putback:${SECOND}`)

    expect((await ui.rows())[0]).toBe('▸ ◆ Decision · Cap retries at five. · put back')

    await ui.unmount()
  })

  test('a record removed with a receipt’s key is listed as removed only once Fylgja has taken it out', async ($, on) => {
    let isAway = true

    frame(on)

    const set = stage(on, {
      replies: [TWO],
      tools: {
        amend_memory: args =>
          isAway ? { ...answer('not_found: no such record'), isError: true } : answer({ atom_id: args.atom_id, outcome: 'removed' }),
      },
    })

    await $.session.start(START)
    await turn($, set, ...WORK)
    await press($, 'review')
    await pressTwice($, 'remove:1')
    await $.command.run(COMMAND)

    const ui = await pane($)

    expect(set.of('amend_memory')).toEqual([{ atom_id: SECOND, op: 'remove' }])
    expect(await ui.rows(), 'the removal failed: there is nothing to put back, and nothing says there is').toEqual([
      '▸ ◆ Decision · Use a Redis lock for the retry queue.',
    ])

    isAway = false
    await pressTwice($, 'remove:0')

    expect(await ui.rows()).toEqual(['▸ ◆ Decision · Use a Redis lock for the retry queue. · removed'])

    await ui.press(`row:${FIRST}`)

    expect(await ui.actions()).toEqual(['Put back'])

    await ui.unmount()
  })

  test('a change Fylgja does not take is said in the record’s row, and nothing is shown as done', async ($, on) => {
    const { set } = await opened($, on, { tools: { amend_memory: () => ({ ...answer('not_found: no such record'), isError: true }) } })
    const ui = await pane($)

    await ui.press(`row:${SECOND}`)
    await ui.press(`remove:${SECOND}`)
    await ui.press(`remove:${SECOND}`)

    expect(set.of('amend_memory'), 'asked once').toHaveLength(1)
    expect(await ui.rows()).toEqual([CAP_ROW, LOCK_ROW])
    expect(await ui.lines()).toContain(`! ${Ledger.TROUBLE.remove}`)
    expect(await ui.actions()).toEqual(['Reword', 'Remove'])
    expect(await shown($), 'it still counts').toBe(`${QUIET} · 2 kept`)

    await ui.press(`reword:${SECOND}`)

    expect(await ui.lines(), 'the next change to it takes the line down').not.toContain(`! ${Ledger.TROUBLE.remove}`)

    await ui.enter('Cap retries at three.')

    expect(set.of('amend_memory')).toHaveLength(2)
    expect((await ui.rows())[0]).toBe(CAP_ROW)
    expect(await ui.lines()).toContain(`! ${Ledger.TROUBLE.reword}`)
    expect(set.toasts, 'it is said in the window, and nowhere else').toEqual([])

    await ui.unmount()
  })

  test('a record that could not be put back stays listed as removed, and says so', async ($, on) => {
    let isAway = false
    let written = 0
    const { set } = await opened($, on, {
      tools: {
        remember: () => {
          if (isAway) {
            return { ...answer('search_index_unavailable: try again'), isError: true }
          }

          written += 1

          return answer({ atom_id: idOf(100 + written), outcome: 'created' })
        },
      },
    })
    const ui = await pane($)

    await ui.press(`row:${SECOND}`)
    await ui.press(`remove:${SECOND}`)
    await ui.press(`remove:${SECOND}`)

    isAway = true

    await ui.press(`putback:${SECOND}`)
    await ui.press(`putback:${SECOND}`)

    expect((await ui.rows())[1]).toBe('▸ ◆ Decision · Cap retries at five. · removed')
    expect(await ui.lines()).toContain(`! ${Ledger.TROUBLE.putback}`)
    expect(await ui.actions()).toEqual(['Put back'])
    expect(await shown($)).toBe(`${QUIET} · 1 kept`)
    expect(set.toasts).toEqual([])

    await ui.unmount()
  })

  test('when Scribe takes back the record whose sentence is being put right, the field goes and the arrows select again', async ($, on) => {
    const { set } = await opened($, on, { replies: [TWO, DROPPING] })
    const ui = await pane($)

    await ui.press(`row:${SECOND}`)
    await ui.press(`reword:${SECOND}`)
    await turn($, set, dev('no cap after all, retries are cheap'), claude('Done.', edit(FILE)))

    expect(all(await ui.tree(), 'Input')).toEqual([])
    expect(await ui.rows()).toEqual(['  ◆ Decision · Use a Redis lock for the retry queue.', '▸ ◆ Decision · Cap retries at five. · removed'])

    await scrolled($, -1)

    expect((await ui.rows())[0], 'the selection moves').toMatch(/^▸/)

    await ui.unmount()
  })
})

describe('the window and the band', () => {
  test('a question of Scribe’s is answered with its own keys while the window is open, and the window is as it was', async ($, on) => {
    const seen = frame(on)
    const set = stage(on, { replies: [ASKING] })

    await $.session.start(START)
    await turn($, set, ...WORK)

    expect(await shown($)).toMatch('? Why: ')

    await $.command.run(COMMAND)

    const ui = await pane($)

    await ui.press(`row:${FIRST}`)

    expect(await ui.lines()).toContain('No reason recorded.')
    expect(await shown($), 'the question is still up').toMatch('[1 One less service to run]')

    await press($, 'reason:0')

    expect(await shown($)).toMatch('[1 Press again to save this reason]')
    expect(await ui.actions(), 'a key armed in the band arms none in the window').toEqual(['Reword', 'Remove'])

    await press($, 'reason:0')

    expect(set.of('amend_memory')).toEqual([expect.objectContaining({ atom_id: FIRST, detail: 'One less service to run' })])
    expect(await shown($)).toMatch('✓ Reason saved')
    expect(await ui.lines(), 'and the window shows the reason').toContain('Why: One less service to run')
    expect([seen.opens.length, seen.closes], 'the band’s keys neither opened nor closed it').toEqual([1, []])

    await ui.unmount()
  })

  test('a key armed in the window arms none in the band, and a record changed in the window reads the same on a receipt', async ($, on) => {
    const seen = frame(on)
    const set = stage(on, { replies: [TWO] })

    await $.session.start(START)
    await turn($, set, ...WORK)
    await press($, 'review')
    await $.command.run(COMMAND)

    const ui = await pane($)

    await ui.press(`row:${SECOND}`)
    await ui.press(`remove:${SECOND}`)

    expect(await shown($), 'the receipt’s own Remove is not waiting').toMatch('[3 Fix] [4 Remove]')

    await ui.press(`remove:${SECOND}`)

    expect(await shown($), 'the receipt offers to put it back, as the window does').toMatch('[3 Put back]')
    expect(set.of('amend_memory')).toEqual([{ atom_id: SECOND, op: 'remove' }])
    expect(seen.closes).toEqual([])

    await ui.unmount()
  })
})

describe('the window where Scribe does not run', () => {
  test('with Scribe off the mark is text alone, and the command opens a window that says so in one line', async ($, on) => {
    const seen = frame(on)
    const set = stage(on, { replies: [TWO], kept: { 'scribe.off': true } })

    await $.session.start(START)
    await turn($, set, ...WORK)

    const band = await $.ui.mount(BAND)

    expect(all((await band.drawn()) as unknown as Node, 'Button'), 'nothing to press').toEqual([])
    expect((await band.find({ type: 'Text', text: MARK }))?.props).toEqual({ dimColor: true })

    await band.unmount()
    await $.command.run(COMMAND)

    expect(seen.opens).toHaveLength(1)

    const ui = await pane($)

    expect(await ui.lines()).toEqual([' ᚠ fylgja  | kept in this session | ', Ledger.QUIET.off, Ledger.LEGENDS.quiet])

    await ui.unmount()
  })

  test('signed out there is no mark to press, and the command opens a window that says so in one line', async ($, on) => {
    const seen = frame(on)

    stage(on, { connect: () => NEEDS_SIGN_IN })

    await $.session.start(START)

    expect(await shown($)).toBe(EMPTY)

    await $.command.run(COMMAND)

    expect(seen.opens).toHaveLength(1)

    const ui = await pane($, false)

    expect(await ui.lines()).toEqual(['ᚠ fylgja | kept in this session | ', Ledger.QUIET['signed-out'], Ledger.LEGENDS.awayQuiet])

    await ui.unmount()
  })

  test('turning Scribe off with its key closes the window', async ($, on) => {
    const seen = frame(on)
    const set = stage(on, { replies: [verdict({ records: [LOCK] })] })

    await $.session.start(START)
    await turn($, set, ...WORK)
    await press($, 'about')
    await $.command.run(COMMAND)
    await press($, 'off')
    await press($, 'off')

    expect(seen.closes).toEqual([PANE])
  })
})
