/**
 * The search: the view of Fylgja's window that finds knowledge atoms by
 * what they say, one row per record, with the record that is selected
 * opened.
 *
 * It is up only because the developer asked for it with `/fylgja-search`,
 * and it asks Fylgja only when they press Enter in its field: never while
 * they type, one search at a time, and not again for the words whose
 * answer it is showing. Fylgja checks every search before it answers, and
 * that check is a model call the team pays for, so a search is something
 * the developer does, not something that happens. At most `MAX_HITS`
 * records come back for one, and the title bar says when there may be more.
 *
 * It only reads. Nothing here changes a record, and nothing it found is
 * handed to Claude: what goes into the prompt box is the reference of a
 * record the developer chose to cite, as a chip, and Claude opens it with
 * Fylgja's tools when it chooses to. What was searched for and what was
 * found are held in the running plugin only, and none of it is logged.
 *
 * What is here is its state, its description in the shapes every view of
 * the window is drawn from (see `listing.ts`, which also says how the
 * window is worked), and the few things it asks of Fylgja.
 */

import type { PromptDecoration } from 'claude-code'

import { ask } from './ask'
import * as Draft from './draft'
import { glyphOf } from './glyphs'
import { detailOf, hitsOf, MAX_HITS, sourceOf } from './hits'
import type { Detail, Hit, Source } from './hits'
import type { Host } from './host'
import { restored } from './known'
import { fitted, LEGENDS, roomFor, stepped } from './listing'
import type { Line, View } from './listing'
import { decorationsOf } from './paint'
import { drawn } from './plain'
import { CALL_TIMEOUT_MS, limited } from './scribe/time'
import { MAX_CONTENT, MAX_OPTION, why } from './scribe/view'
import type { Part } from './scribe/view'
import { serverOf } from './session'
import type { Session } from './session'
import { tokensIn } from './token'

/** Where a search stands: not asked yet, on its way, answered, or not answered. */
export type Phase = 'idle' | 'searching' | 'found' | 'failed'

/** What Fylgja said of one record beyond its hit, and of the record it was said in. */
type Opened = { detail: Detail; source?: Source }

export type Search = {
  /** Whether the window is open on this view, as far as the plugin was told. */
  isOpen: boolean
  /** Whether the window had the keys when it was last drawn. */
  hadKeys: boolean
  /** Whether the ring is in the field: what is typed goes there, and Enter there searches. */
  isTyping: boolean
  /** Counts the times the field was given the ring: each is a field of its own, holding the words last searched for. */
  openings: number
  /** The words last searched for. */
  query: string
  phase: Phase
  hits: Hit[]
  /** The id of the record that is selected; with none, the first is. */
  selected: string | undefined
  /** The id of the record whose keys are up. Only the selected record's ever are. */
  acting: string | undefined
  /** What Fylgja said of the records that were asked about, by id. Only an answer is kept: a read that failed is made again. */
  opened: Map<string, Opened>
  /** The ids of the records Fylgja was last asked about and did not answer for: said in their rows until they are asked about again. */
  unopened: Set<string>
  /** The ids of the records Fylgja is being asked about. */
  asking: Set<string>
  /** What the last press of a record's key came to, by its id: said in its row until the next. */
  said: Map<string, keyof typeof SAID>
  /** Counts the searches asked: an answer is kept only while no later one was asked. */
  asked: number
  /**
   * The session's count of the times everything known was dropped, as it
   * stood when this view last looked. What was found is one account's to
   * read: when the count has moved, it is let go.
   */
  epoch: number
}

/** A search is waited for this long: Fylgja checks it, then looks. */
export const SEARCH_TIMEOUT_MS = 20_000

/** No more of what is typed is searched for than this. */
export const MAX_QUERY = 200

/** A cited record's reference holds no more of its sentence than this: what the Fylgja app keeps of a title in the references it copies. */
const MAX_LABEL = 40

export function create(): Search {
  return {
    isOpen: false,
    hadKeys: false,
    isTyping: false,
    openings: 0,
    query: '',
    phase: 'idle',
    hits: [],
    selected: undefined,
    acting: undefined,
    opened: new Map(),
    unopened: new Set(),
    asking: new Set(),
    said: new Map(),
    asked: 0,
    epoch: 0,
  }
}

/** What the title bar says after Fylgja's name while this view is up. */
const NAME = 'search'

/** What the view says in place of rows. */
export const QUIET = {
  idle: 'Type what you are looking for, in the words it would have been said in, and press Enter. Nothing is searched while you type: one Enter is one search.',
  searching: 'Searching Fylgja…',
  none: 'Nothing found for that.',
  failed: 'The search did not go through. Nothing was found out; Enter in the field asks again.',
  away: 'Fylgja is not here for your account in this session: nothing can be searched.',
} as const

/** What a row says after one of its record's keys was pressed. */
export const SAID = {
  cited: 'In your prompt, as a reference Claude can open.',
  already: 'Already in your prompt.',
  refused: 'The prompt box did not take it. Nothing was put in.',
} as const

/** What a row says when Fylgja was asked about its record and did not answer. */
export const UNOPENED = 'Fylgja did not say more about this record. Enter on it asks again.'

const WAITING = 'Asking Fylgja…'

/** The line of keys in the states only this view has. */
export const SEARCH_LEGENDS = {
  field: 'enter search · esc leave the field',
  list: '↑↓ record, and the field above them · enter what can be done · esc close',
  none: '↑↓ the field · esc close',
  away: 'enter ask again · esc close',
} as const

/** The one key of the view where Fylgja is not here: it asks whether it is by now. */
export const AGAIN = 'again'
export const ASK_AGAIN = 'Ask again'

/** What the keys of a found record say. */
export const CITE = 'Cite in prompt'
const OPEN = 'Open in Fylgja'
export const OPEN_SOURCE = 'Open where it came from'

/** The address of the view's field: a field of its own for each time it is given the ring. */
export function fieldKey(search: Search): string {
  return `query:${search.openings}`
}

/** What is searched for, of what was typed: on one line, without the blanks around it, at most `MAX_QUERY` characters. */
export function queryOf(entered: string): string {
  return entered.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY)
}

/**
 * The view was asked for: it starts over, with nothing searched for and
 * nothing found. With no words to search for the ring goes to its field.
 */
export function begun(search: Search, hasQuery: boolean): void {
  search.isOpen = true
  search.hadKeys = false
  search.isTyping = !hasQuery
  search.openings += 1
  search.query = ''
  search.phase = 'idle'
  search.asked += 1
  forgotten(search)
}

/** What a search found is let go, with everything held about it. */
function forgotten(search: Search): void {
  search.hits = []
  search.selected = undefined
  search.acting = undefined
  search.opened.clear()
  search.unopened.clear()
  search.asking.clear()
  search.said.clear()
}

/**
 * Lets go of what was searched for and found when everything the session
 * knew was dropped since this view last looked: a sign-in, a sign-out or a
 * conversation that started over. Another account may be reading now, and
 * an answer still on its way is not kept either. Whether anything was let go.
 */
export function current(search: Search, epoch: number): boolean {
  if (search.epoch === epoch) {
    return false
  }

  search.epoch = epoch
  search.asked += 1
  search.query = ''
  search.phase = 'idle'
  search.isTyping = true
  search.openings += 1
  forgotten(search)

  return true
}

/**
 * Whether what is typed goes to the field: the ring is in it, and it is
 * drawn. Where Fylgja is not here there is no field, whatever was last
 * known of the ring.
 */
export function inField(search: Search, isHere: boolean): boolean {
  return isHere && search.isTyping
}

/** The window was closed, or shows its other view: what was half done here is let go, and an answer on its way is not waited for. */
export function closed(search: Search): void {
  search.isOpen = false
  search.hadKeys = false
  search.isTyping = false
  search.acting = undefined
  search.asked += 1

  if (search.phase === 'searching') {
    search.phase = 'idle'
  }
}

/** The row that is selected: the one picked, or the first while that one is not listed. */
function selectedIn(search: Search): Hit | undefined {
  return search.hits.find(hit => hit.id === search.selected) ?? search.hits[0]
}

/**
 * The selection came to rest on the record `id`, by an arrow or by the
 * focus ring landing on its row: the ring is out of the field, and keys
 * that were up are put away. Whether anything changed.
 */
export function rest(search: Search, id: string): boolean {
  const isSame = search.selected === id && search.acting === undefined && !search.isTyping

  search.selected = id
  search.acting = undefined
  search.isTyping = false

  return !isSame
}

/**
 * Moves the selection `by` rows, stopping at either end. The id of the
 * record now selected, or undefined when it did not move.
 */
export function step(search: Search, by: number): string | undefined {
  const to = stepped(
    search.hits.map(hit => hit.id),
    search.selected,
    by,
  )

  if (to !== undefined) {
    rest(search, to)
  }

  return to
}

/**
 * The ring was moved into the field, by the person or because a search
 * found nothing to move to: what is typed goes there. Whether anything changed.
 */
export function entered(search: Search): boolean {
  const isSame = search.isTyping && search.acting === undefined

  search.isTyping = true
  search.acting = undefined

  return !isSame
}

/**
 * Escape in the field leaves the field and no more: the next one closes
 * the window. The field left takes what was typed into it with it, and the
 * next one holds the words last searched for. Whether the ring was in it.
 */
export function leftField(search: Search, isHere: boolean): boolean {
  const wasTyping = inField(search, isHere)

  search.isTyping = false

  if (wasTyping) {
    search.openings += 1
  }

  return wasTyping
}

/**
 * The reference a found record is cited by, as the Fylgja app would copy
 * it: its kind, the start of its sentence as a label, and its id. The label
 * is made as the app makes one: on one line, without the reference's own
 * marks, at most `MAX_LABEL` characters and cut at a whole word. Undefined
 * for a kind of record a reference cannot name.
 */
function referenceOf(hit: Hit): string | undefined {
  const chars = Array.from(drawn(hit.sentence.replace(/[{}|]/g, ' '), MAX_CONTENT))
  const cut = chars.slice(0, MAX_LABEL)
  const boundary = chars[MAX_LABEL] === ' ' ? MAX_LABEL : cut.lastIndexOf(' ')
  const label = chars.length <= MAX_LABEL ? chars.join('') : `${(boundary > 0 ? cut.slice(0, boundary) : cut).join('').trimEnd()}…`
  const reference = `{{fylgja:${hit.kind}${label === '' ? '' : ` ${label}`}|${hit.id}}}`

  return tokensIn(reference)[0]?.text === reference ? reference : undefined
}

/**
 * The element the focus ring belongs on: the field while what is typed
 * goes there; else the selected record's row, or its first key while its
 * keys are up. Where Fylgja is not here it is the view's one key. Undefined
 * with no record and the ring out of the field.
 */
export function ringKey(search: Search, isHere: boolean): string | undefined {
  if (!isHere) {
    return AGAIN
  }

  if (search.isTyping) {
    return fieldKey(search)
  }

  const selected = selectedIn(search)

  if (selected === undefined) {
    return undefined
  }

  // A record Fylgja did not answer for keeps the ring on its row: Enter there asks again, and its key is an arrow away.
  const hasKey = search.acting === selected.id && !search.unopened.has(selected.id) && referenceOf(selected) !== undefined

  return hasKey ? `cite:${selected.id}` : `row:${selected.id}`
}

/** A word of the server's as a person reads it: `verify_before_relying` is "verify before relying". */
function worded(word: string): string {
  return drawn(word.replaceAll('_', ' '), 40)
}

/**
 * What a record is called in its row: the glyph of the kind of record the
 * search found, and the server's own word for what it holds, capitalised.
 * That word is `atom` until the record itself was read, and then what the
 * atom is: a decision, a gotcha, or a kind this build has never heard of.
 */
function kindOf(hit: Hit, detail: Detail | undefined): string {
  const name = worded(detail?.kind ?? hit.kind)

  return `${glyphOf(hit.kind)} ${name.slice(0, 1).toUpperCase()}${name.slice(1)}`
}

function labelled(label: string, value: string): Part[] {
  return [{ text: `${label}: `, tone: 'dim' }, { text: value }]
}

/** What the selected record holds, a line each: what its hit carries, and under it what Fylgja said when it was asked. */
function openedLines(search: Search, hit: Hit, isCut: boolean): Part[][] {
  const opened = search.opened.get(hit.id)
  const detail = opened?.detail
  const source = opened?.source
  const whole = drawn(detail?.sentence ?? hit.sentence, MAX_CONTENT * 2)
  const filed = hit.path.map(name => drawn(name, MAX_OPTION)).filter(name => name !== '')
  const about = hit.about.map(name => drawn(name, MAX_OPTION)).filter(name => name !== '')
  const aspect = hit.aspect.map(name => drawn(name, MAX_OPTION)).filter(name => name !== '')
  const rejected = (detail?.alternatives ?? []).map(one => drawn(one, MAX_OPTION)).filter(one => one !== '')
  const from = [
    drawn(source?.title ?? detail?.source?.title ?? '', MAX_OPTION),
    source === undefined ? '' : worded(source.kind),
    source?.date ?? '',
  ].filter(part => part !== '')
  const said = search.said.get(hit.id)

  return [
    // The whole sentence, where its row had no room for it or the search answered with its start alone.
    ...(isCut || (detail !== undefined && detail.sentence !== hit.sentence) ? [[{ text: whole }]] : []),
    ...(hit.newer === '' ? [] : [labelled('Holds now', drawn(hit.newer, MAX_CONTENT))]),
    ...(detail === undefined ? [] : why({ kind: detail.kind, detail: detail.reason, reasonStatus: detail.reasonStatus }).map(row => row.parts)),
    ...(rejected.length === 0 ? [] : [labelled('Rejected', rejected.join('; '))]),
    ...((detail?.decidedBy ?? '') === '' ? [] : [labelled('Decided by', drawn(detail?.decidedBy ?? '', MAX_OPTION))]),
    ...(from.length === 0 ? [] : [labelled('From', from.join(' · '))]),
    ...(hit.topic === '' ? [] : [labelled('Topic', drawn(hit.topic, MAX_OPTION))]),
    ...(aspect.length === 0 ? [] : [labelled('Answers', aspect.join(' > '))]),
    ...(filed.length === 0 && about.length === 0
      ? []
      : [labelled('Filed under', [filed.join(' > '), about.length === 0 ? '' : `about ${about.join(', ')}`].filter(part => part !== '').join(' · '))]),
    ...(said === undefined ? [] : [[{ text: SAID[said], ...(said === 'refused' ? {} : { tone: 'good' as const }) }]]),
  ]
}

/**
 * What the view shows now, laid out for `columns` cells.
 *
 * @param isFocused whether the window has the keys: the line of keys names them only then
 * @param isHere whether Fylgja is here for the account this machine is set up for
 * @param rows how many rows the window has room for; every row is drawn when it is not known
 */
export function viewOf(search: Search, columns: number, isFocused: boolean, isHere: boolean, rows = Number.MAX_SAFE_INTEGER): View {
  if (!isHere) {
    return {
      name: NAME,
      count: '',
      lines: [],
      quiet: QUIET.away,
      action: { key: AGAIN, label: ASK_AGAIN },
      isArmed: false,
      hasRule: true,
      legend: isFocused ? SEARCH_LEGENDS.away : LEGENDS.awayQuiet,
    }
  }

  const selected = selectedIn(search)
  const lines = search.hits.map((hit): Line => {
    const { id } = hit
    const isSelected = selected?.id === id
    const opened = search.opened.get(id)
    const kind = kindOf(hit, opened?.detail)
    const tail = hit.date ?? ''
    const whole = drawn(hit.sentence, MAX_CONTENT)
    const sentence = drawn(hit.sentence, roomFor(columns, kind, tail, MAX_CONTENT))
    const isActing = isSelected && search.acting === id
    const link = hit.link ?? opened?.source?.link ?? null

    return {
      id,
      isSelected,
      isDim: false,
      kind,
      sentence,
      tail,
      detail: isSelected ? openedLines(search, hit, sentence !== whole) : [],
      ...(isSelected && search.unopened.has(id) ? { trouble: UNOPENED } : {}),
      ...(isSelected && search.asking.has(id) ? { waiting: WAITING } : {}),
      actions: isActing && referenceOf(hit) !== undefined ? [{ key: `cite:${id}`, label: CITE }] : [],
      ...(isActing && link !== null ? { link: { href: link, label: hit.link === null ? OPEN_SOURCE : OPEN } } : {}),
    }
  })
  const open = lines.find(line => line.isSelected)
  const quiet =
    search.phase === 'idle'
      ? QUIET.idle
      : search.phase === 'searching'
        ? QUIET.searching
        : search.phase === 'failed'
          ? QUIET.failed
          : lines.length === 0
            ? QUIET.none
            : undefined
  const legend = !isFocused
    ? lines.length === 0
      ? LEGENDS.awayQuiet
      : LEGENDS.away
    : search.isTyping
      ? SEARCH_LEGENDS.field
      : lines.length === 0
        ? SEARCH_LEGENDS.none
        : (open?.actions.length ?? 0) > 0 || open?.link !== undefined
          ? LEGENDS.keys
          : SEARCH_LEGENDS.list
  const hasRule = fitted(lines, rows - 4 - (quiet === undefined ? 0 : 1))

  return {
    name: NAME,
    // As many as were asked for means the search may match more than it was given.
    count: lines.length === 0 ? '' : lines.length >= MAX_HITS ? `first ${MAX_HITS}, more may match` : `${lines.length} found`,
    field: {
      key: fieldKey(search),
      label: 'Search',
      value: search.query,
      placeholder: 'what was decided, in your words',
      submitLabel: 'search',
      isHeld: search.isTyping,
    },
    lines,
    ...(quiet === undefined ? {} : { quiet }),
    isArmed: false,
    hasRule,
    legend,
  }
}

/**
 * Enter in the field, with `typed` in it: Fylgja is asked once for the
 * atoms that say it. Nothing is asked for no words, while a search is on
 * its way, or for the words whose answer is being shown. The ring stays in
 * the field while Fylgja is asked, and the field is the same one until the
 * answer is read, so what is typed meanwhile is kept. With records found
 * the ring goes to the first of them; with none, and when the search did
 * not go through, it stays in the field for the next words. A search made
 * where Fylgja is not here did not go through; the view says that Fylgja is
 * not here for as long as that is so, and no longer.
 *
 * Call this from a hook that is being waited on: from anywhere else nothing
 * is asked, and the search ends as one that did not go through.
 */
export async function look(host: Host, session: Session, search: Search, typed: string): Promise<void> {
  const query = queryOf(typed)

  if (query === '' || search.phase === 'searching') {
    return
  }

  if (query === search.query && search.phase === 'found') {
    search.isTyping = search.hits.length === 0
    host.redraw()

    return
  }

  search.asked += 1

  const turn = search.asked

  forgotten(search)
  search.query = query
  search.phase = 'searching'
  // The field Enter was pressed in is empty again: a field of its own holds the words that are searched for, and the ring.
  search.isTyping = true
  search.openings += 1
  host.redraw()

  const server = await serverOf(host, session).catch(() => undefined)

  // Asking who is signed in may itself drop what was known; what is found from here on is found for whoever is signed in now.
  search.epoch = session.epoch

  const payload =
    server === undefined
      ? undefined
      : await limited(host.after, ask(host, server, 'search', { query, kind: 'atom', limit: MAX_HITS }), SEARCH_TIMEOUT_MS).catch(
          () => undefined,
        )

  // The view was closed or asked something else meanwhile: this answer is nobody's.
  if (turn !== search.asked) {
    return
  }

  const hits = payload === undefined ? undefined : hitsOf(payload)

  search.phase = hits === undefined ? 'failed' : 'found'
  search.hits = hits ?? []
  search.selected = search.hits[0]?.id
  search.isTyping = search.hits.length === 0
  host.redraw()
}

/**
 * Asks Fylgja what the record `id` holds beyond its hit: its reason, what
 * was ruled out, who decided, and where it was said: two reads that cost no
 * check, the record and then the record it was said in. It is asked when
 * the record's keys are brought up, and what was answered is kept for the
 * search. A read that failed is not kept: the next Enter on the row makes
 * it again, the record's or its source's, whichever is missing.
 */
async function open(host: Host, session: Session, search: Search, id: string): Promise<void> {
  const held = search.opened.get(id)

  if (search.asking.has(id) || (held !== undefined && (held.source !== undefined || held.detail.source === null))) {
    return
  }

  const turn = search.asked

  search.asking.add(id)
  search.unopened.delete(id)
  host.redraw()

  const server = await serverOf(host, session).catch(() => undefined)
  const read = (tool: string, args: Record<string, unknown>): Promise<Record<string, unknown> | undefined> =>
    server === undefined ? Promise.resolve(undefined) : limited(host.after, ask(host, server, tool, args), CALL_TIMEOUT_MS).catch(() => undefined)
  const answered = held === undefined ? await read('open', { ref: id }) : undefined
  const detail = held?.detail ?? (answered === undefined ? undefined : detailOf(answered, id))
  const origin = detail?.source ?? null
  const resolved = origin === null ? undefined : await read('resolve', { refs: [origin.id] })
  const source = origin === null || resolved === undefined ? undefined : sourceOf(resolved, origin.id)

  // The search was let go meanwhile, or another account is reading now: this answer is nobody's.
  if (turn !== search.asked || search.epoch !== session.epoch) {
    return
  }

  search.asking.delete(id)

  if (detail === undefined) {
    search.unopened.add(id)
  } else {
    search.opened.set(id, source === undefined ? { detail } : { detail, source })
  }

  host.redraw()
}

/** The prompt box, as the hook a key is pressed in reaches it. */
export type Box = {
  /** `$.prompt.read`: the draft and where the cursor is in it. */
  read: () => Promise<{ text: string; cursor: number }>
  /** `$.prompt.fill` at the cursor: `text` goes in where the person types next, and what they typed stays on either side. Whether the box took it. */
  insert: (text: string, decorations: PromptDecoration[]) => Promise<boolean>
}

/**
 * Puts the reference of the record `id` into the prompt box, where the
 * cursor is, as the chip a pasted reference becomes: the draft the developer
 * typed stays as it is around it, and the prompt is sent with the reference
 * as written. A record whose reference the draft already holds is not put
 * in twice. Nothing is sent, and nothing but the reference goes in.
 */
async function cite(search: Search, draft: Draft.Draft, box: Box, id: string): Promise<void> {
  const hit = search.hits.find(one => one.id === id)
  const reference = hit === undefined ? undefined : referenceOf(hit)

  if (reference === undefined) {
    return
  }

  const { text, cursor } = await box.read()

  if (tokensIn(restored(draft.known, text)).some(token => token.id === id)) {
    search.said.set(id, 'already')

    return
  }

  const at = Math.min(text.length, Math.max(0, cursor))
  const before = text.slice(0, at)
  // Set apart from what stands on either side of it, as a word is.
  const lead = before === '' || /\s$/.test(before) ? '' : ' '
  const trail = /^\s/.test(text.slice(at)) ? '' : ' '
  const cited = Draft.cited(draft, text, reference)
  const span = { start: lead.length, end: lead.length + cited.text.length }
  const filling = `${lead}${cited.text}${trail}`

  search.said.set(id, (await box.insert(filling, decorationsOf(filling, cited.isChip ? [span] : []))) ? 'cited' : 'refused')
}

/**
 * A key of the view was pressed: a row, which selects its record, brings up
 * what can be done with it and has Fylgja asked what more it holds; or the
 * key that cites it. Citing puts its keys away again, so Enter held down
 * cites once. Where Fylgja is not here the one key asks whether it is by
 * now, so a connection that was only away for a moment is found again
 * without the command being typed anew; words that were waiting to be
 * searched for are then searched for.
 */
export async function pressed(host: Host, session: Session, search: Search, draft: Draft.Draft, box: Box, key: string): Promise<void> {
  if (key === AGAIN) {
    const server = await serverOf(host, session).catch(() => undefined)

    if (server !== undefined && search.query !== '' && search.phase === 'failed') {
      await look(host, session, search, search.query)
    }

    host.redraw()

    return
  }

  const at = key.indexOf(':')
  const action = at === -1 ? key : key.slice(0, at)
  const id = key.slice(at + 1)

  if (!search.hits.some(hit => hit.id === id)) {
    return
  }

  if (action === 'row') {
    rest(search, id)
    search.acting = id
    search.said.delete(id)
    await open(host, session, search, id)
  } else if (action === 'cite' && search.acting === id) {
    try {
      await cite(search, draft, box, id)
    } catch {
      search.said.set(id, 'refused')
    }

    search.acting = undefined
  }

  host.redraw()
}
