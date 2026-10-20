import type { On, PromptEditResult } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MAX_HITS } from '../hooks/hits'
import { LEGENDS } from '../hooks/listing'
import * as Ledger from '../hooks/scribe/ledger'
import * as Search from '../hooks/search'
import { PANE, RINGLESS } from '../hooks/window'
import { answer, idOf, MEETING_ID, NEEDS_SIGN_IN, token } from './fixtures'
import { claude, decision, dev, edit, finish, MARK, press, send, shown, stage, START, turn, verdict } from './scribe-fixtures'
import type { StageOptions } from './scribe-fixtures'
import { all, frame, pane, ringOn, scrolled } from './window-fixtures'
import type { Node } from './window-fixtures'

const LOCK = idOf(1)
const CAP = idOf(2)
const LOCK_SENTENCE = 'Use a Redis lock for the retry queue.'
const CAP_SENTENCE = 'Cap retries at five.'
const SOURCE_LINK = `https://fylgja.lknblab.dev/open/meeting/${MEETING_ID}`

/** A knowledge atom as `search` answers for it: a pointer, with the start of what it says. */
function hit(id: string, sentence: string, more: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    score: 0.8,
    type: 'atom',
    title: 'Retry queue',
    link: null,
    date: '2026-09-30',
    project: { path: ['Platform', 'Queue'], id: idOf(900) },
    entities: [],
    content_preview: sentence,
    people: [],
    parent_id: idOf(800),
    variant_ids: [],
    resource: { tool: 'open', id },
    aspect_id: null,
    aspect_path: [],
    newer_value: null,
    may_be_replaced_by: [],
    ...more,
  }
}

/** What `search` answers: the hits, and that the filter asked for matched. */
function found(...results: Record<string, unknown>[]): unknown {
  return answer({ results, query: 'asked', total: results.length, filter_matched: true })
}

const TWO = found(hit(LOCK, LOCK_SENTENCE), hit(CAP, CAP_SENTENCE, { date: '2026-08-02' }))

/** What `open` answers for the lock: the decision whole, its reason, and the meeting it was said in. */
const OPENED = answer({
  kind: 'atom',
  focus: {
    atom: {
      id: LOCK,
      type: 'decision',
      content: LOCK_SENTENCE,
      disposition: 'confirmed',
      source_id: MEETING_ID,
      source_title: 'Queue review',
    },
    decision: { reason: 'Redis is already there.', reason_status: 'stated', alternatives: ['a Postgres advisory lock'], decided_by_name: 'Ada Lovelace' },
  },
  link: null,
})

const RESOLVED = answer({
  records: [
    { ref: MEETING_ID, found: true, id: MEETING_ID, kind: 'meeting', title: 'Queue review', date: '2026-09-30', visibility: 'shared with your team', link: SOURCE_LINK },
  ],
})

const TOOLS = { search: () => TWO, open: () => OPENED, resolve: () => RESOLVED }

const command = (args: string) =>
  ({ command: 'fylgja-search', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as never

const KEPT = { command: 'fylgja-kept', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as never

/** A session signed in to Fylgja, with the window not open. */
async function session($: Engine, on: On, options: StageOptions = {}) {
  const seen = frame(on)
  const set = stage(on, { tools: TOOLS, ...options })

  await $.session.start(START)

  return { seen, set }
}

/** A search Fylgja takes `ms` of the test's clock to answer. */
const slowly =
  (ms: number, result: unknown) =>
  async (args: Record<string, unknown>, clock: { sleep: (ms: number) => Promise<void> }): Promise<unknown> => {
    await clock.sleep(ms)

    return result
  }

const fieldOf = async (ui: Awaited<ReturnType<typeof pane>>): Promise<Node | undefined> => all(await ui.tree(), 'Input')[0]

const LOCK_ROW = `▸ ◆ Atom · ${LOCK_SENTENCE} · 2026-09-30`
const CAP_ROW = `  ◆ Atom · ${CAP_SENTENCE} · 2026-08-02`

describe('what was found', () => {
  /** Fylgja's answers, by the words searched for. */
  const ANSWERS: Record<string, unknown> = {
    retry: found(
      hit(LOCK, LOCK_SENTENCE, { entities: ['Acme'], aspect_path: ['Retry queue', 'Locking'], newer_value: { atom_id: CAP, value: 'Use a lease.' } }),
      hit(LOCK, 'the same record again'),
      { id: 'not-an-id', content_preview: 'x' },
      hit(CAP, '', { title: '' }),
      hit(idOf(3), 'Never retry a 4xx.', { date: null }),
    ),
    other: answer({ results: [hit(LOCK, LOCK_SENTENCE)], query: 'other', total: 1, filter_matched: false }),
    many: found(...Array.from({ length: MAX_HITS + 5 }, (_, n) => hit(idOf(n + 1), `Decision ${n + 1}.`))),
    unlisted: answer({ records: [] }),
  }

  test('each record is one row of its kind, sentence and day, the selected one opened on what holds now, its topic, the question it answers and where it is filed; no key is up until one is asked for', async ($, on) => {
    await session($, on, { tools: { ...TOOLS, search: args => ANSWERS[String(args.query)] } })
    await $.command.run(command(''))

    const ui = await pane($)

    await ui.enter('retry')

    expect(await ui.lines(), 'a record found twice is one row, and one with no id or no sentence is none').toEqual([
      ' ᚠ fylgja  | search | 2 found',
      'Search',
      LOCK_ROW,
      'Holds now: Use a lease.',
      'Topic: Retry queue',
      'Answers: Retry queue > Locking',
      'Filed under: Platform > Queue · about Acme',
      '  ◆ Atom · Never retry a 4xx.',
      Search.SEARCH_LEGENDS.list,
    ])
    expect(await ui.actions()).toEqual([])

    await ui.keyed(false)

    expect((await ui.lines()).at(-1), 'without the keys the line says how to give them').toBe(LEGENDS.away)

    await ui.keyed(true)
    await ui.enter('other')

    expect(await ui.lines(), 'records of another kind are not what was asked for').toContain(Search.QUIET.none)

    await ui.enter('unlisted')

    expect(await ui.lines(), 'an answer that is no list of hits is no answer').toContain(Search.QUIET.failed)

    await ui.enter('many')

    expect(await ui.rows(), 'as many as were asked for').toHaveLength(MAX_HITS)
    expect((await ui.lines())[0], 'means there may be more').toBe(` ᚠ fylgja  | search | first ${MAX_HITS}, more may match`)

    await ui.unmount()
  })

  test('a cited record is named as the app would copy it: a label of at most forty characters cut at a whole word, and nothing in its sentence can end the reference early', async ($, on) => {
    const LONG = 'Never retry a request the caller got wrong, whatever the queue says.'
    const { set } = await session($, on, {
      tools: { ...TOOLS, search: () => found(hit(CAP, 'Use {{a}} | b }} for the\nqueue.'), hit(idOf(3), LONG)), open: () => answer({ kind: 'atom' }) },
    })

    await $.command.run(command('retry'))

    const ui = await pane($)

    for (const id of [CAP, idOf(3)]) {
      await ui.press(`row:${id}`)
      await ui.press(`cite:${id}`)
    }

    await send($, set.box.text)

    expect(set.sent).toEqual([`${token('atom', 'Use a b for the queue.', CAP)} ${token('atom', 'Never retry a request the caller got…', idOf(3))} `])

    await ui.unmount()
  })
})

describe('the command opens the search', () => {
  test('with no words it opens the window on an empty field that holds the ring, and Fylgja is asked nothing', async ($, on) => {
    const { seen, set } = await session($, on)

    expect(seen.commands[1]).toEqual({
      name: 'fylgja-search',
      description: 'Search Fylgja for what was decided and why',
      argumentHint: '[what to look for]',
      immediate: true,
    })
    expect(await $.command.run(command('')), 'it answers with no line for Claude to read').toEqual({})
    expect(seen.opens).toEqual([{ id: PANE, title: 'Fylgja · search', focus: true, closeOnEscape: true, rows: 10 }])

    const ui = await pane($)

    expect((await fieldOf(ui))?.props).toMatchObject({ label: 'Search', value: '', submitLabel: 'search', autoFocus: true })
    expect(await ui.lines()).toEqual([' ᚠ fylgja  | search | ', 'Search', Search.QUIET.idle, Search.SEARCH_LEGENDS.field])
    expect(set.of('search'), 'nothing is searched until Enter').toEqual([])

    await ui.unmount()
  })

  test('with words it searches for them at once, with one call, and lists what was found with the first record selected', async ($, on) => {
    const { set } = await session($, on)

    await $.command.run(command('  retry   queue lock '))

    expect(set.of('search')).toEqual([{ query: 'retry queue lock', kind: 'atom', limit: MAX_HITS }])

    const ui = await pane($)

    expect(await ui.rows()).toEqual([LOCK_ROW, CAP_ROW])
    expect((await ui.lines())[0]).toBe(' ᚠ fylgja  | search | 2 found')
    expect((await fieldOf(ui))?.props, 'the field holds what was searched for, and not the ring').toMatchObject({ value: 'retry queue lock' })
    expect((await fieldOf(ui))?.props?.autoFocus).toBeUndefined()
    expect((await ui.lines()).at(-1)).toBe(Search.SEARCH_LEGENDS.list)
    expect(set.of('open'), 'nothing is read of a record nobody asked about').toEqual([])

    await ui.unmount()
  })

  test('it shows the window’s other view, and each command shows its own', async ($, on) => {
    const seen = frame(on)
    const set = stage(on, { tools: TOOLS, replies: [verdict({ records: [decision({ content: CAP_SENTENCE })] })] })

    await $.session.start(START)
    await turn($, set, dev('cap the retries'), claude('Done.', edit('src/queue/lock.ts')))
    await press($, 'ok')
    await $.command.run(command('retry'))

    const ui = await pane($)

    expect(await ui.rows()).toEqual([LOCK_ROW, CAP_ROW])
    expect(await shown($), 'while it is open the mark is text').toMatch(`${MARK} · 1 kept`)

    await $.command.run(KEPT)
    await ui.keyed(true)

    expect(await ui.rows()).toEqual([`▸ ◆ Decision · ${CAP_SENTENCE}`])
    expect((await ui.lines())[0]).toBe(` ᚠ fylgja  | ${Ledger.NAME} | 1 kept`)
    expect(seen.opens.map(open => [open.id, open.title, open.rows]), 'one pane, whichever view; it is asked to be as tall as what was found needs').toEqual([
      [PANE, 'Fylgja · search', 10],
      [PANE, 'Fylgja · search', 15],
      [PANE, 'Fylgja · kept', 9],
    ])

    await $.command.run(command(''))
    await ui.keyed(true)

    expect(await ui.rows(), 'and asked for again it starts over').toEqual([])
    expect(set.of('search')).toHaveLength(1)

    await ui.unmount()
  })
})

describe('Fylgja is searched on Enter and at no other time', () => {
  test('one Enter is one search with the words in the field; no words and the words already answered ask nothing, and an Enter while one is on its way waits for it', async ($, on) => {
    const { set } = await session($, on, {
      tools: { ...TOOLS, search: (args, clock) => (String(args.query).startsWith('slow') ? slowly(500, found(hit(CAP, CAP_SENTENCE)))(args, clock) : TWO) },
    })

    await $.command.run(command(''))

    const ui = await pane($)

    await ui.enter('   ')

    expect(set.of('search')).toEqual([])

    await ui.enter('retry queue')

    expect(set.of('search')).toEqual([{ query: 'retry queue', kind: 'atom', limit: MAX_HITS }])
    expect(await ui.rows()).toEqual([LOCK_ROW, CAP_ROW])

    await ui.enter(' retry  queue ')

    expect(set.of('search'), 'what is shown answers it').toHaveLength(1)

    const field = String((await fieldOf(ui))?.props?.key)
    const slow = ui.enterIn(field, 'slow').catch(() => undefined)

    await set.clock.advance(100)

    const during = (await fieldOf(ui))?.props

    expect(await ui.lines(), 'while Fylgja is asked the window says so').toContain(Search.QUIET.searching)
    expect(await ui.rows()).toEqual([])
    expect(during, 'the ring stays in the field, which holds the words asked for').toMatchObject({ value: 'slow', autoFocus: true })

    await set.clock.advance(500)
    await slow

    expect((await fieldOf(ui))?.props?.key, 'and it is the same field when the answer comes: what was typed meanwhile is kept').toBe(during?.key)

    expect(set.of('search').map(args => args.query)).toEqual(['retry queue', 'slow'])
    expect(await ui.rows()).toEqual([`▸ ◆ Atom · ${CAP_SENTENCE} · 2026-09-30`])

    const slower = ui.enter('slow again').catch(() => undefined)

    await set.clock.advance(100)

    expect(await ui.lines()).toContain(Search.QUIET.searching)

    const another = ui.enterIn(String((await fieldOf(ui))?.props?.key), 'another').catch(() => undefined)

    await set.clock.advance(100)

    expect(set.of('search').map(args => args.query), 'an Enter while a search is on its way asks nothing while it is').toEqual([
      'retry queue',
      'slow',
      'slow again',
    ])

    await set.clock.advance(500)
    await Promise.all([slower, another])

    expect(set.of('search').map(args => args.query), 'it is the next search once that one is answered: one at a time').toEqual([
      'retry queue',
      'slow',
      'slow again',
      'another',
    ])
    expect(
      set.logged.filter(line => line !== RINGLESS),
      'and nothing of it is written to a log: at most the fixed line about a ring that could not be moved',
    ).toEqual([])
    expect(set.sent, 'or sent to Claude').toEqual([])

    await ui.unmount()
  })

  test('no more than a bounded stretch of what was typed is searched for', async ($, on) => {
    const { set } = await session($, on)

    await $.command.run(command('x'.repeat(Search.MAX_QUERY + 50)))

    expect(String(set.of('search')[0]?.query)).toHaveLength(Search.MAX_QUERY)
  })

  test('nothing found, a search that did not go through and a search that never answers are each said in one line, with the ring in the field', async ($, on) => {
    const answers: Record<string, () => unknown> = {
      none: () => found(),
      broken: () => ({ content: [{ type: 'text', text: 'rate limit exceeded' }], isError: true }),
    }
    const { set } = await session($, on, {
      tools: {
        ...TOOLS,
        search: (args, clock) => (args.query === 'silent' ? slowly(Search.SEARCH_TIMEOUT_MS * 2, TWO)(args, clock) : answers[String(args.query)]?.()),
      },
    })

    await $.command.run(command(''))

    const ui = await pane($)

    await ui.enter('none')

    expect(await ui.lines()).toEqual([' ᚠ fylgja  | search | ', 'Search', Search.QUIET.none, Search.SEARCH_LEGENDS.field])
    expect((await fieldOf(ui))?.props).toMatchObject({ value: 'none', autoFocus: true })

    await ui.enter('broken')

    expect(await ui.lines()).toEqual([' ᚠ fylgja  | search | ', 'Search', Search.QUIET.failed, Search.SEARCH_LEGENDS.field])
    expect(JSON.stringify(await ui.tree()), 'what the server said is not shown').not.toMatch('rate limit')

    const silent = ui.enter('silent').catch(() => undefined)

    await set.clock.advance(Search.SEARCH_TIMEOUT_MS + 1)

    expect(await ui.lines(), 'it is waited for no longer than that').toContain(Search.QUIET.failed)

    await set.clock.advance(Search.SEARCH_TIMEOUT_MS)
    await silent

    expect(await ui.rows(), 'and an answer that comes after is nobody’s').toEqual([])
    expect(
      set.logged.filter(line => line !== RINGLESS),
      'nothing of what was typed or answered is logged: at most the fixed line about a ring that could not be moved',
    ).toEqual([])

    await ui.unmount()
  })

  test('signed out it says so in one line, has no field and asks nothing, with or without words', async ($, on) => {
    const seen = frame(on)
    const set = stage(on, { tools: TOOLS, connect: () => NEEDS_SIGN_IN })

    await $.session.start(START)

    for (const words of ['retry queue', '']) {
      await $.command.run(command(words))

      const ui = await pane($)

      expect(await ui.lines()).toEqual([' ᚠ fylgja  | search | ', Search.QUIET.away, Search.ASK_AGAIN, Search.SEARCH_LEGENDS.away])
      expect(await fieldOf(ui)).toBeUndefined()

      await ui.unmount()
    }

    expect(seen.opens).toHaveLength(2)
    expect(set.of('search')).toEqual([])
  })

  test('a connection that was away for a moment is found again with the window’s one key, and the words that waited are searched for', async ($, on) => {
    let isAway = true
    const seen = frame(on)
    const set = stage(on, { tools: TOOLS, connect: () => (isAway ? { isConnected: false, reason: 'failed' } : { isConnected: true, server: 'plugin:fylgja:fylgja' }) })

    await $.session.start(START)
    await $.command.run(command('retry'))

    const ui = await pane($)

    expect(await ui.lines()).toContain(Search.QUIET.away)
    expect(set.of('search')).toEqual([])

    await ui.press(Search.AGAIN)

    expect(await ui.lines(), 'still away: it says so still').toContain(Search.QUIET.away)

    isAway = false
    await ui.press(Search.AGAIN)

    expect(set.of('search')).toEqual([{ query: 'retry', kind: 'atom', limit: MAX_HITS }])
    expect(await ui.rows()).toEqual([LOCK_ROW, CAP_ROW])
    expect((await fieldOf(ui))?.props, 'and the field is back').toMatchObject({ value: 'retry' })
    expect(seen.closes).toEqual([])

    await ui.unmount()
  })

  test('what was found is let go when the account signs out and in again: no row, detail or key of the search before is shown', async ($, on) => {
    let state: Record<string, unknown> = { isConnected: true, server: 'plugin:fylgja:fylgja' }
    const seen = frame(on)
    const set = stage(on, { tools: TOOLS, connect: () => state })

    await $.session.start(START)
    await $.command.run(command('retry'))

    const ui = await pane($)

    await ui.press(`row:${LOCK}`)

    expect(await ui.actions()).toEqual([Search.CITE])

    // Signed out, as a hook that is waited on finds out; then signed in again.
    state = NEEDS_SIGN_IN
    await finish($, set)
    await ui.keyed(true)

    expect(await ui.rows()).toEqual([])
    expect(await ui.lines()).toContain(Search.QUIET.away)

    state = { isConnected: true, server: 'plugin:fylgja:fylgja' }
    await finish($, set)
    await ui.keyed(true)

    expect(await ui.rows(), 'nothing of the search before').toEqual([])
    expect(await ui.actions()).toEqual([])
    expect(await ui.lines()).toEqual([' ᚠ fylgja  | search | ', 'Search', Search.QUIET.idle, Search.SEARCH_LEGENDS.field])
    expect((await fieldOf(ui))?.props, 'and the field holds none of its words').toMatchObject({ value: '' })
    expect(set.of('search')).toHaveLength(1)
    expect(seen.closes).toEqual([])

    await ui.unmount()
  })
})

describe('a found record', () => {
  test('the arrows go from record to record and up into the field; a scroll key moves the selection', async ($, on) => {
    await session($, on)
    await $.command.run(command('retry'))

    const ui = await pane($)

    expect((await ui.keys()).map(key => key.props?.key), 'the rows are the only keys').toEqual([`row:${LOCK}`, `row:${CAP}`])

    await ringOn($, `row:${CAP}`)

    expect(await ui.rows()).toEqual([`  ◆ Atom · ${LOCK_SENTENCE} · 2026-09-30`, `▸ ◆ Atom · ${CAP_SENTENCE} · 2026-08-02`])

    await scrolled($, -1)

    expect((await ui.rows())[0]).toBe(LOCK_ROW)

    await ringOn($, String((await fieldOf(ui))?.props?.key))

    expect((await ui.lines()).at(-1), 'the ring in the field makes what is typed the field’s').toBe(Search.SEARCH_LEGENDS.field)

    await ringOn($, `row:${LOCK}`)

    expect((await ui.lines()).at(-1)).toBe(Search.SEARCH_LEGENDS.list)

    await ui.unmount()
  })

  test('Enter on it brings up what can be done and has Fylgja asked once what it holds: its kind, reason, what was ruled out and where it was said', async ($, on) => {
    const { set } = await session($, on)

    await $.command.run(command('retry'))

    const ui = await pane($)

    await ui.press(`row:${LOCK}`)

    expect(set.of('open')).toEqual([{ ref: LOCK }])
    expect(set.of('resolve')).toEqual([{ refs: [MEETING_ID] }])
    expect(await ui.lines()).toEqual([
      ' ᚠ fylgja  | search | 2 found',
      'Search',
      `▸ ◆ Decision · ${LOCK_SENTENCE} · 2026-09-30`,
      'Why: Redis is already there.',
      'Rejected: a Postgres advisory lock',
      'Decided by: Ada Lovelace',
      'From: Queue review · meeting · 2026-09-30',
      'Topic: Retry queue',
      'Filed under: Platform > Queue',
      `${Search.CITE} | ${Search.OPEN_SOURCE}`,
      CAP_ROW,
      LEGENDS.keys,
    ])
    expect(await ui.actions(), 'the one key reads; nothing here changes a record').toEqual([Search.CITE])
    expect(all(await ui.tree(), 'Link').map(link => link.props), 'its page is a link, on Fylgja’s own host').toEqual([{ href: SOURCE_LINK, label: Search.OPEN_SOURCE }])

    await ui.press(`row:${CAP}`)
    await ui.press(`row:${LOCK}`)

    expect(set.of('open').map(args => args.ref), 'a record is asked about once').toEqual([LOCK, CAP])
    expect(set.of('search')).toHaveLength(1)
    expect(set.of('remember').concat(set.of('amend_memory')), 'and nothing is written').toEqual([])

    await ui.unmount()
  })

  test('a record Fylgja says no more about says so in one line and can still be cited; the next Enter on it asks again', async ($, on) => {
    let isDown = true
    const refused = { content: [{ type: 'text', text: 'try again' }], isError: true }
    const { set } = await session($, on, { tools: { ...TOOLS, open: () => (isDown ? refused : OPENED) } })

    await $.command.run(command('retry'))

    const ui = await pane($)

    await ui.press(`row:${LOCK}`)

    expect(await ui.lines()).toContain(`! ${Search.UNOPENED}`)
    expect(await ui.actions()).toEqual([Search.CITE])

    isDown = false
    await ui.press(`row:${LOCK}`)

    expect(set.of('open').map(args => args.ref), 'a read that failed is made again').toEqual([LOCK, LOCK])
    expect(await ui.lines()).toContain('Why: Redis is already there.')
    expect(await ui.lines()).not.toContain(`! ${Search.UNOPENED}`)

    await ui.press(`row:${LOCK}`)

    expect(set.of('open'), 'and one that was answered is not').toHaveLength(2)

    await ui.unmount()
  })

  test('when only the read of where it was said failed, the next Enter makes that read again, and the link is there', async ($, on) => {
    let isDown = true
    const { set } = await session($, on, { tools: { ...TOOLS, resolve: () => (isDown ? { content: [{ type: 'text', text: 'try again' }], isError: true } : RESOLVED) } })

    await $.command.run(command('retry'))

    const ui = await pane($)

    await ui.press(`row:${LOCK}`)

    expect(all(await ui.tree(), 'Link')).toEqual([])
    expect(await ui.lines(), 'what the record itself said is shown').toContain('From: Queue review')

    isDown = false
    await ui.press(`row:${LOCK}`)

    expect([set.of('open').length, set.of('resolve').length]).toEqual([1, 2])
    expect(all(await ui.tree(), 'Link').map(link => link.props?.href)).toEqual([SOURCE_LINK])

    await ui.unmount()
  })

  test('a link that does not go to a record on Fylgja’s own host is not drawn', async ($, on) => {
    await session($, on, {
      tools: {
        ...TOOLS,
        resolve: () =>
          answer({ records: [{ ref: MEETING_ID, found: true, id: MEETING_ID, kind: 'meeting', title: 'Queue review', date: null, link: 'https://evil.example/open/meeting/x' }] }),
      },
    })
    await $.command.run(command('retry'))

    const ui = await pane($)

    await ui.press(`row:${LOCK}`)

    expect(all(await ui.tree(), 'Link')).toEqual([])

    await ui.unmount()
  })
})

describe('citing a found record', () => {
  test('its reference goes into the prompt box once, as a chip where the cursor is, and what was typed stays around it', async ($, on) => {
    const { set } = await session($, on)
    const chip = `‹◆ ${LOCK_SENTENCE}›`

    await $.command.run(command('retry'))

    const ui = await pane($)

    set.box.text = 'why do we lock here?'
    set.box.cursor = 'why do we'.length

    await ui.press(`row:${LOCK}`)
    await ui.press(`cite:${LOCK}`)

    expect(set.box.text).toBe(`why do we ${chip} lock here?`)
    expect(set.fills, 'one write, of the reference and nothing else').toEqual([` ${chip}`])
    expect(await ui.lines()).toContain(Search.SAID.cited)
    expect(await ui.actions(), 'its keys are put away: Enter held down cites once').toEqual([])

    await ui.press(`row:${LOCK}`)
    await ui.press(`cite:${LOCK}`)

    expect(set.fills, 'a record the draft already holds is not put in twice').toHaveLength(1)
    expect(await ui.lines()).toContain(Search.SAID.already)

    // The chip is one the box knows: it is painted at the next edit, and the prompt is sent with the reference as written.
    const prompt = $.prompt as unknown as { edit: (input: Record<string, unknown>) => Promise<PromptEditResult> }
    const after = await prompt.edit({ origin: { kind: 'composer' }, text: set.box.text, cursor: set.box.text.length, start: set.box.text.length, end: set.box.text.length, inputText: '!' })
    const at = after.text.indexOf(chip)

    expect(after.text).toBe(`why do we ${chip} lock here?!`)
    expect(after.decorations).toEqual([{ start: at, end: at + chip.length, backgroundColor: 'suggestion', color: 'inverseText', bold: true }])

    await send($, after.text)

    expect(set.sent).toEqual([`why do we ${token('atom', LOCK_SENTENCE, LOCK)} lock here?!`])
    expect(set.of('search'), 'and none of it searched again').toHaveLength(1)

    await ui.unmount()
  })

  test('into an empty box it goes alone, and a second record goes in after the first', async ($, on) => {
    const { set } = await session($, on)

    await $.command.run(command('retry'))

    const ui = await pane($)

    await ui.press(`row:${LOCK}`)
    await ui.press(`cite:${LOCK}`)
    await ui.press(`row:${CAP}`)
    await ui.press(`cite:${CAP}`)

    expect(set.box.text).toBe(`‹◆ ${LOCK_SENTENCE}› ‹◆ ${CAP_SENTENCE}› `)

    await ui.unmount()
  })

  test('a box that does not take it says so, and nothing is shown as done', async ($, on) => {
    const { set } = await session($, on, { isBoxHeld: true })

    await $.command.run(command('retry'))

    const ui = await pane($)

    await ui.press(`row:${LOCK}`)
    await ui.press(`cite:${LOCK}`)

    expect(await ui.lines()).toContain(Search.SAID.refused)
    expect(set.box.text).toBe('')

    await ui.unmount()
  })
})

describe('what is typed never acts on a found record', () => {
  test('no key of the search is a letter or a digit, in any state it can be in, and the one field is the search field', async ($, on) => {
    await session($, on)
    await $.command.run(command(''))

    const ui = await pane($)
    const typed = async (): Promise<unknown[]> =>
      (await ui.keys()).flatMap(key => [key.props?.hotkey, key.props?.action]).filter(value => value !== undefined)
    const fields = async (): Promise<unknown[]> => all(await ui.tree(), 'Input').map(field => field.props?.label)

    expect([await typed(), await fields()], 'the empty field').toEqual([[], ['Search']])

    await ui.enter('retry')

    expect([await typed(), await fields()], 'the list').toEqual([[], ['Search']])

    await ui.press(`row:${LOCK}`)

    expect([await typed(), await fields(), await ui.actions()], 'the record’s keys').toEqual([[], ['Search'], [Search.CITE]])

    await ui.press(`cite:${LOCK}`)

    expect([await typed(), await fields(), await ui.actions()], 'after it was cited').toEqual([[], ['Search'], []])

    await ui.unmount()
  })

  // The test kit raises no close of the window by the person, and shows no test where the plugin puts the focus
  // ring: so Escape and the ring are asked of the search's own state, as the plugin's hooks ask it.
  test('Escape in the field leaves the field and no more, and the next one closes the window; signed out the first closes it', () => {
    const search = Search.create()

    for (const hasWords of [true, false]) {
      Search.begun(search, hasWords)

      expect(Search.leftField(search, false), 'signed out there is no field to leave').toBe(false)
      expect(Search.ringKey(search, false), 'and the ring is on its one key').toBe(Search.AGAIN)
    }

    Search.begun(search, false)

    const first = Search.fieldKey(search)

    expect(Search.leftField(search, true), 'the first is the field’s: the window stays').toBe(true)
    expect([search.isOpen, search.isTyping]).toEqual([true, false])
    expect(Search.fieldKey(search), 'the next field is one of its own: what was typed into the one left is gone').not.toBe(first)
    expect(Search.ringKey(search, true), 'with nothing found the ring is on nothing').toBeUndefined()
    expect(Search.leftField(search, true), 'the second is the window’s').toBe(false)

    Search.entered(search)

    expect(Search.ringKey(search, true)).toBe(Search.fieldKey(search))
  })

  test('an answer that comes after the window turned to its other view is shown nowhere', async ($, on) => {
    const { set } = await session($, on, { tools: { ...TOOLS, search: slowly(500, TWO) } })

    await $.command.run(command(''))

    const ui = await pane($)
    const asked = ui.enter('retry').catch(() => undefined)

    await set.clock.advance(100)
    await $.command.run(KEPT)
    await set.clock.advance(500)
    await asked
    await $.command.run(command(''))
    await ui.keyed(true)

    expect(set.of('search')).toHaveLength(1)
    expect(await ui.rows()).toEqual([])
    expect(await ui.lines()).toContain(Search.QUIET.idle)

    await ui.unmount()
  })
})
