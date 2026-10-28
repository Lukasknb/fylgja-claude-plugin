/**
 * What the band shows, as rows of text and keys: the one description both
 * surfaces are drawn from. Every word that comes from a record or from the
 * model passes the sanitiser the chips use.
 */

import { glyphOf } from '../glyphs'
import { drawn } from '../plain'
import { armOf } from './band'
import type { Band, Item, Receipt } from './band'
import { changedLine } from './facts'
import { forLine } from './scope'
import type { Fact, Written } from './types'

export type Part = { text: string; tone?: 'dim' | 'strong' | 'good' | 'mark' } | { link: string; label: string }

/**
 * A key of the band: the element's address, the digit that presses it, and
 * its words. A quiet key only puts the card away. An armed key was pressed
 * once and acts when it is pressed again in time: it keeps its words and its
 * place, and is only marked.
 */
export type Key = { key: string; hotkey: string; label: string; tone?: 'quiet'; isArmed?: true }

/** The band's one-line field. */
export type Field = {
  key: string
  label: string
  value: string
  placeholder: string
  submitLabel: string
}

export type Row = { parts: Part[]; keys?: Key[]; field?: Field }

/**
 * What the card above the prompt holds, and which of two registers it is
 * drawn in. One that asks is waiting for the person; one that tells is not,
 * and must not look as if it were.
 */
export type View = {
  rows: Row[]
  keys: Key[]
  register: 'asks' | 'tells'
  /** What the card is, in a few words after Fylgja's name. */
  head: string
  /** What happens when the person does nothing, or how the card leaves. */
  note?: string
}

/** What a card says while one of its keys waits for its second press. */
export const ARMED_NOTE = 'again within five seconds and it is done. Nothing is changed until then.'

/** The key of `view` that waits for its second press, if one does. */
export function armedIn(view: View): Key | undefined {
  return [...view.keys, ...view.rows.flatMap(row => row.keys ?? [])].find(key => key.isArmed === true)
}

const QUIET_KEYS: ReadonlySet<string> = new Set(['about', 'about-ok', 'cancel', 'dismiss', 'ok', 'skip'])

/** Marks the keys that only put the card away, so they are drawn as the lesser ones. */
function toned(view: View): View {
  const quiet = (key: Key): Key => (QUIET_KEYS.has(key.key) ? { ...key, tone: 'quiet' } : key)

  return {
    ...view,
    keys: view.keys.map(quiet),
    rows: view.rows.map(row => (row.keys === undefined ? row : { ...row, keys: row.keys.map(quiet) })),
  }
}

/** What each card says about being left alone: how it leaves, and what doing nothing comes to. */
export const NOTES = {
  receipt: 'Nothing to do. It goes by itself in a moment, or with your next prompt.',
  told: 'Nothing to do. It goes with your next prompt.',
  reason: 'Leave it and it goes with your next prompt. The decision stays recorded, without a reason.',
  reversal: 'Leave it and it goes with your next prompt. The new decision is then recorded beside the old one.',
  holds: 'Leave it and it goes with your next prompt. The record stays as it is, marked as possibly out of date.',
  report: 'Leave it and it goes with your next prompt. Nothing is recorded.',
  field: 'Enter saves it. Cancel leaves everything as it is.',
} as const

/** What the card of a decision asked about says once the answer is given and something is to be said of it. */
export const SAID = {
  'given-up': 'Nothing is changed in Fylgja until a decision that replaces it is recorded. It stays marked.',
  unconfirmed: 'Fylgja did not take the confirmation. The record stays marked as possibly out of date.',
  gone: 'Fylgja no longer returns this record for its files: replaced or removed, perhaps. Nothing was written.',
  unchecked: 'It could not be checked: its files hold more records than Fylgja returns at once. Nothing was written.',
} as const

export const MAX_CONTENT = 220
const MAX_DETAIL = 600
export const MAX_OPTION = 80

const ABOUT: Key = { key: 'about', hotkey: '9', label: 'What is this' }

const KINDS: Readonly<Record<string, string>> = {
  decision: 'Decision',
  gotcha: 'Gotcha',
  correction: 'Correction',
}

/** What is said in place of a decision's reason when it has none. */
export const NO_STRONG_REASON = 'No particular reason was given when asked.'
export const NOT_STATED = 'No reason recorded.'

function mark(text: string): Part {
  return { text: `${text} `, tone: 'mark' }
}

function withAbout(band: Band, keys: Key[]): Key[] {
  return band.offersAbout ? [...keys.slice(0, -1), ABOUT, ...keys.slice(-1)] : keys
}

/** What a kind of record is called where one is drawn; `Record` for a kind this build does not know. */
export function kindName(kind: string): string {
  return Object.hasOwn(KINDS, kind) ? (KINDS[kind] ?? 'Record') : 'Record'
}

function headline(fact: Fact): Part[] {
  return [
    mark(glyphOf('decision')),
    { text: `${kindName(fact.kind)} · `, tone: 'strong' },
    { text: drawn(fact.content, MAX_CONTENT) },
    ...(fact.date === null ? [] : [{ text: ` · ${fact.date}`, tone: 'dim' } as const]),
  ]
}

/** The row that says a record's code changed after it was last confirmed, and in which file; none for any other record. */
function changed(fact: Fact): Row[] {
  const line = changedLine(fact, drawn)

  return line === undefined ? [] : [{ parts: [{ text: line, tone: 'dim' }] }]
}

/** A record's reason as it is said where the record is opened: the reason, or that there is none and whether anybody was asked. */
export function why(fact: Pick<Fact, 'kind' | 'detail' | 'reasonStatus'>): Row[] {
  const detail = drawn(fact.detail, MAX_DETAIL)

  // A decision nobody could give a reason for says so; it is a finding, and
  // not the same as a reason nobody was asked for.
  if (fact.reasonStatus === 'no_strong_reason') {
    return [
      {
        parts: [
          {
            text: detail === '' ? NO_STRONG_REASON : `${NO_STRONG_REASON} In their words: ${detail}`,
          },
        ],
      },
    ]
  }

  if (detail !== '') {
    return [{ parts: [{ text: 'Why: ', tone: 'dim' }, { text: detail }] }]
  }

  return fact.kind === 'decision' ? [{ parts: [{ text: NOT_STATED, tone: 'dim' }] }] : []
}

const WRITERS: Readonly<Record<string, string>> = {
  scribe: 'written down by Scribe',
  assistant: 'written down by Claude',
  person: 'written down by a person',
  extraction: 'read out of a meeting or session',
}

/** A record's short id: the start of its id, as Fylgja's own tools show it. */
export function shortId(id: string): string {
  return id.slice(0, 8)
}

/** Which record this is and who wrote it down: what stands where a link would, for a record that has no page. */
export function provenanceOf(fact: Fact): string {
  const writer = Object.hasOwn(WRITERS, fact.origin) ? WRITERS[fact.origin] : undefined

  return `Fylgja record ${shortId(fact.id)}${writer === undefined ? '' : `, ${writer}`}`
}

/** The one dim line that says a record holds for some organizations alone; none for a record that holds generally. */
function holds(names: readonly string[] | undefined): Row[] {
  return (names ?? []).length === 0
    ? []
    : [{ parts: [{ text: drawn(forLine(names ?? []), MAX_CONTENT), tone: 'dim' }] }]
}

/** What the band says of the records on files the briefs of `agents` agents name. */
export function briefLine(count: number, agents = 1): string {
  return `${count} ${count === 1 ? 'record' : 'records'} on files ${agents === 1 ? "this agent's brief names" : "these agents' briefs name"}`
}

/**
 * The records on files an agent's brief names, as one card: how many, and
 * opened, each record with the line that says its code changed and who
 * wrote it down.
 */
function brief(band: Band, item: Item & { kind: 'tell' }, facts: readonly Fact[], agents: number): View {
  const tellAgent: Key = { key: 'tell-agent', hotkey: '1', label: 'Tell agent' }
  const dismiss: Key = { key: 'dismiss', hotkey: '0', label: 'Dismiss' }
  const count: Row = { parts: [mark(glyphOf('decision')), { text: briefLine(facts.length, agents), tone: 'strong' }] }

  if (!item.isOpen) {
    return {
      register: 'tells',
      head: 'has notes on the code an agent is given',
      note: NOTES.told,
      rows: [count],
      keys: withAbout(band, [tellAgent, { key: 'open', hotkey: '2', label: 'Open' }, dismiss]),
    }
  }

  return {
    register: 'tells',
    head: 'has notes on the code an agent is given',
    note: NOTES.told,
    rows: [
      count,
      ...facts.flatMap(fact => [
        { parts: headline(fact) },
        ...holds(fact.appliesTo),
        ...changed(fact),
        { parts: [{ text: provenanceOf(fact), tone: 'dim' } as const] },
      ]),
    ],
    keys: [tellAgent, dismiss],
  }
}

function tell(band: Band, item: Item & { kind: 'tell' }): View {
  const { fact } = item

  if (item.brief !== undefined) {
    return brief(band, item, item.brief.facts, new Set(item.brief.briefs.map(one => one.prompt)).size)
  }

  const rest: Key[] = [
    { key: 'tell-claude', hotkey: '2', label: 'Tell Claude' },
    twice(band, 'knew', '3', 'Knew this'),
    { key: 'dismiss', hotkey: '0', label: 'Dismiss' },
  ]

  if (!item.isOpen) {
    return {
      register: 'tells',
      head: 'has a note on this code',
      note: NOTES.told,
      // A record whose code changed since says so before it is opened: it is not to be read as settled.
      // Nor is one that holds for some organizations alone to be read as general.
      rows: [{ parts: headline(fact) }, ...holds(fact.appliesTo), ...changed(fact)],
      keys: withAbout(band, [{ key: 'open', hotkey: '1', label: 'Open' }, ...rest]),
    }
  }

  const rejected = fact.alternatives.map(alternative => drawn(alternative, MAX_OPTION)).filter(text => text !== '')
  // Anyone on the team may add a place to a record; one its author did not add says so.
  const where = fact.anchors.map(
    anchor =>
      drawn(anchor.symbol === undefined ? anchor.path : `${anchor.path} (${anchor.symbol})`, MAX_CONTENT) +
      (fact.addedByOthers.includes(anchor.path) ? ' (added by another member)' : ''),
  )

  return {
    register: 'tells',
    head: 'has a note on this code',
    note: NOTES.told,
    rows: [
      { parts: headline(fact) },
      ...holds(fact.appliesTo),
      ...changed(fact),
      ...why(fact),
      ...(rejected.length === 0
        ? []
        : [
            {
              parts: [{ text: 'Rejected: ', tone: 'dim' } as const, { text: rejected.join('; ') }],
            },
          ]),
      ...(where.length === 0
        ? []
        : [
            {
              parts: [{ text: 'In: ', tone: 'dim' } as const, { text: where.join(', ') }],
            },
          ]),
      { parts: [{ text: provenanceOf(fact), tone: 'dim' }] },
      // Only a record read out of a meeting or a session has a page to open.
      ...(fact.link === null ? [] : [{ parts: [{ link: fact.link, label: 'Open where it came from' }] }]),
    ],
    keys: rest,
  }
}

function question(band: Band, item: Item & { kind: 'question' }): View {
  if (item.form === 'reversal') {
    return {
      register: 'asks',
      head: 'does this replace an earlier decision?',
      note: NOTES.reversal,
      rows: [
        {
          parts: [
            mark('?'),
            {
              text: 'This looks like it replaces a recorded decision.',
              tone: 'strong',
            },
          ],
        },
        {
          parts: [{ text: 'Now: ', tone: 'dim' }, { text: drawn(item.draft.content, MAX_CONTENT) }],
        },
        {
          parts: [
            { text: 'Recorded: ', tone: 'dim' },
            { text: drawn(item.prior.content, MAX_CONTENT) },
            ...(item.prior.date === null ? [] : [{ text: ` · ${item.prior.date}`, tone: 'dim' } as const]),
          ],
        },
      ],
      keys: withAbout(band, [
        twice(band, 'replaces', '1', 'Yes, it replaces it'),
        { key: 'tell-claude', hotkey: '2', label: 'No, tell Claude' },
        { key: 'different', hotkey: '3', label: 'Different case' },
        { key: 'skip', hotkey: '0', label: 'Skip' },
      ]),
    }
  }

  if (item.form === 'report') {
    const { draft } = item

    // A choice only an agent's report says it made: nothing is written unless the developer keeps it.
    return {
      register: 'asks',
      head: 'keep what an agent decided?',
      note: NOTES.report,
      rows: [
        { parts: [mark('?'), { text: 'Agent chose: ', tone: 'strong' }, { text: drawn(draft.content, MAX_CONTENT) }] },
        { parts: [{ text: 'Not what it was asked to do, or a choice nobody made with you.', tone: 'dim' }] },
      ],
      // Keeping it writes to Fylgja, so it waits for its second press.
      keys: withAbout(band, [
        twice(band, 'keep', '1', 'Keep, record it'),
        { key: 'tell-claude', hotkey: '2', label: 'Not wanted, tell Claude' },
        { key: 'skip', hotkey: '0', label: 'Skip' },
      ]),
    }
  }

  if (item.form === 'holds') {
    const { fact } = item

    // The answer was given: one line says what came of it, and nothing is waited for.
    if (item.said !== undefined) {
      return {
        register: 'tells',
        head: item.said === 'given-up' ? 'noted that this no longer holds' : 'did not confirm this',
        note: NOTES.told,
        rows: [{ parts: headline(fact) }, { parts: [{ text: SAID[item.said] }] }],
        keys: [{ key: 'ok', hotkey: '0', label: 'OK' }],
      }
    }

    return {
      register: 'asks',
      head: 'is this decision still true?',
      note: NOTES.holds,
      rows: [
        {
          parts: [
            mark('?'),
            { text: 'Still true: ', tone: 'strong' },
            { text: drawn(fact.content, MAX_CONTENT) },
            ...(fact.date === null ? [] : [{ text: ` · ${fact.date}`, tone: 'dim' } as const]),
          ],
        },
        ...changed(fact),
      ],
      // Confirming it writes to Fylgja, so it waits for its second press; saying it no longer holds writes nothing by itself.
      keys: withAbout(band, [
        twice(band, 'holds', '1', 'Still holds'),
        { key: 'no-longer', hotkey: '2', label: 'No longer holds' },
        { key: 'skip', hotkey: '0', label: 'Skip' },
      ]),
    }
  }

  const options = item.options.map(option => drawn(option, MAX_OPTION)).filter(text => text !== '')

  return {
    register: 'asks',
    head: 'why was this decided?',
    note: NOTES.reason,
    rows: [
      {
        parts: [mark('?'), { text: 'Why: ', tone: 'strong' }, { text: drawn(item.content, MAX_CONTENT) }],
      },
    ],
    keys: withAbout(band, [
      ...options.map((label, index) =>
        twice(band, `reason:${index}`, String(index + 1), label),
      ),
      { key: 'other', hotkey: String(options.length + 1), label: 'Write my own' },
      twice(band, 'no-reason', String(options.length + 2), 'No particular reason'),
      { key: 'skip', hotkey: '0', label: 'Skip' },
    ]),
  }
}

const HEADS = {
  created: 'Recorded · ',
  restored: 'Restored · ',
  reasoned: 'Reason saved · ',
  held: 'Already recorded by someone else · ',
  updated: 'Updated · ',
  withdrawn: 'Withdrawn · ',
} as const

/** What a receipt's card says it is, after Fylgja's name. */
export const HEADLINES = {
  created: 'wrote this down',
  restored: 'put this back',
  reasoned: 'saved the reason',
  held: 'found this already recorded',
  updated: 'brought this up to date',
  withdrawn: 'took this back',
} as const

/**
 * A key that acts only when pressed twice. While it waits for the second
 * press it says what it said before: the keys of a card are read by their
 * place and their words, and neither may move under a finger.
 */
function twice(band: Band, key: string, hotkey: string, label: string): Key {
  return band.armed?.key === armOf(band, key) ? { key, hotkey, label, isArmed: true } : { key, hotkey, label }
}

/** What one written record's line says: that it is new or back, its sentence, and what it replaced. */
function written(record: Written): Part[] {
  return [
    { text: drawn(record.content, MAX_CONTENT) },
    ...(record.replaced === null ? [] : [{ text: ` · replaces: ${drawn(record.replaced, MAX_OPTION)}`, tone: 'dim' } as const]),
    // Written beside a recorded decision it may go against, because nobody said whether it replaces it.
    ...(record.against === undefined
      ? []
      : [{ text: ` · may contradict an earlier decision ${shortId(record.against)}`, tone: 'dim' } as const]),
  ]
}

function receipt(band: Band, shown: Receipt, destination: string | undefined): View {
  const [only] = shown.records

  if (shown.records.length === 1 && only !== undefined) {
    return {
      register: 'tells',
      head: HEADLINES[only.outcome],
      note: NOTES.receipt,
      rows: [
        {
          parts: [mark('✓'), { text: HEADS[only.outcome], tone: 'good' }, ...written(only)],
        },
        ...holds(only.appliesTo),
      ],
      // A record another member holds is theirs to change: there is nothing to fix or remove from here.
      // One that Scribe took back can be put back, and is then the developer's to keep.
      keys: withAbout(band, [
        ...(only.outcome === 'held'
          ? []
          : only.outcome === 'withdrawn'
            ? [twice(band, 'putback:0', '1', 'Put back')]
            : [{ key: 'fix:0', hotkey: '1', label: 'Fix' }, twice(band, 'remove:0', '2', 'Remove')]),
        { key: 'ok', hotkey: '0', label: 'OK' },
      ]),
    }
  }

  const head: Row = {
    parts: [mark('✓'), { text: `Recorded ${shown.records.length}`, tone: 'good' }],
  }

  if (!shown.isOpen) {
    return {
      register: 'tells',
      head: HEADLINES.created,
      note: NOTES.receipt,
      rows: [head],
      keys: withAbout(band, [
        { key: 'review', hotkey: '1', label: 'Review' },
        { key: 'ok', hotkey: '0', label: 'OK' },
      ]),
    }
  }

  return {
    register: 'tells',
    head: HEADLINES.created,
    note: NOTES.told,
    rows: [
      head,
      ...shown.records.map((record, index) => ({
        parts: [
          ...(record.outcome === 'created' ? [] : [{ text: HEADS[record.outcome], tone: 'dim' } as const]),
          ...written(record),
          ...((record.appliesTo ?? []).length === 0
            ? []
            : [{ text: ` · ${drawn(forLine(record.appliesTo ?? []), MAX_OPTION)}`, tone: 'dim' } as const]),
          // Where it points, places added later included.
          ...((record.anchors ?? []).length === 0
            ? []
            : [
                {
                  text: ` · ${(record.anchors ?? [])
                    .slice(0, 4)
                    .map(anchor => drawn(anchor.path, MAX_OPTION))
                    .join(', ')}`,
                  tone: 'dim',
                } as const,
              ]),
        ],
        keys:
          record.outcome === 'held'
            ? []
            : record.outcome === 'withdrawn'
              ? [twice(band, `putback:${index}`, String(index * 2 + 1), 'Put back')]
              : [
                  { key: `fix:${index}`, hotkey: String(index * 2 + 1), label: 'Fix' },
                  twice(band, `remove:${index}`, String(index * 2 + 2), 'Remove'),
                ],
      })),
      ...(destination === undefined
        ? []
        : [{ parts: [{ text: `Recorded to ${drawn(destination, MAX_OPTION)}`, tone: 'dim' } as const] }]),
    ],
    keys: [{ key: 'ok', hotkey: '0', label: 'Close' }],
  }
}

const ABOUT_ROWS: Row[] = [
  {
    parts: [
      {
        text: 'Scribe follows this session and records decisions with their reasons in Fylgja, so whoever reads the code later can find out why.',
      },
    ],
  },
  {
    parts: [
      {
        text: 'It reads along through your own Claude plan: what happened in the session, and the records it looks up, go to the model for that.',
      },
    ],
  },
  {
    parts: [
      {
        text: 'Turn it off here for this machine, or with the plugin option “scribe”.',
        tone: 'dim',
      },
    ],
  },
]

/**
 * What the band shows now, or undefined for nothing.
 *
 * @param isWorking whether Claude is working: a question waits until it is not
 * @param destination the team, person and profile records go to, when known
 */
export function viewOf(band: Band, isWorking: boolean, destination?: string): View | undefined {
  const view = untoned(band, isWorking, destination)

  return view === undefined ? undefined : toned(view)
}

function untoned(band: Band, isWorking: boolean, destination?: string): View | undefined {
  if (band.isAboutOpen) {
    return {
      register: 'tells',
      head: 'what Scribe is',
      rows: [
        ...ABOUT_ROWS,
        ...(destination === undefined ? [] : [{ parts: [{ text: `Records go to ${drawn(destination, MAX_OPTION)}.` }] }]),
      ],
      keys: [
        twice(band, 'off', '1', 'Turn Scribe off'),
        { key: 'about-ok', hotkey: '0', label: 'OK' },
      ],
    }
  }

  if (band.editing !== null) {
    const field: Field =
      band.editing.what === 'fix'
        ? {
            key: 'fix-text',
            label: 'Fix',
            value: drawn(band.editing.value, MAX_CONTENT),
            placeholder: 'one sentence',
            submitLabel: 'save',
          }
        : {
            key: 'reason-text',
            label: 'Why',
            value: '',
            placeholder: 'the reason, in a line',
            submitLabel: 'save',
          }

    return {
      register: 'asks',
      head: band.editing.what === 'fix' ? 'the record, as it should read' : 'the reason, in your words',
      note: NOTES.field,
      rows: [{ parts: [], field }],
      keys: [{ key: 'cancel', hotkey: '0', label: 'Cancel' }],
    }
  }

  const item = band.current

  if (item?.kind === 'question' && !isWorking) {
    return question(band, item)
  }

  if (item?.kind === 'tell') {
    return tell(band, item)
  }

  return band.receipt === null ? undefined : receipt(band, band.receipt, destination)
}
