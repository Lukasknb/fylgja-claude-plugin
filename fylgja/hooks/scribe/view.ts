/**
 * What the band shows, as rows of text and keys: the one description both
 * surfaces are drawn from. Every word that comes from a record or from the
 * model passes the sanitiser the chips use.
 */

import { glyphOf } from '../glyphs'
import { drawn } from '../plain'
import type { Band, Item, Receipt } from './band'
import type { Fact, Written } from './types'

export type Part = { text: string; tone?: 'dim' | 'strong' | 'good' | 'mark' } | { link: string; label: string }

/** A key of the band: the element's address, the digit that presses it, and its words. */
export type Key = { key: string; hotkey: string; label: string }

/** The band's one-line field. */
export type Field = {
  key: string
  label: string
  value: string
  placeholder: string
  submitLabel: string
}

export type Row = { parts: Part[]; keys?: Key[]; field?: Field }

export type View = { rows: Row[]; keys: Key[] }

const MAX_CONTENT = 220
const MAX_DETAIL = 600
const MAX_OPTION = 80

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

function headline(fact: Fact): Part[] {
  const kind = Object.hasOwn(KINDS, fact.kind) ? (KINDS[fact.kind] ?? 'Record') : 'Record'

  return [
    mark(glyphOf('decision')),
    { text: `${kind} · `, tone: 'strong' },
    { text: drawn(fact.content, MAX_CONTENT) },
    ...(fact.date === null ? [] : [{ text: ` · ${fact.date}`, tone: 'dim' } as const]),
  ]
}

function why(fact: Fact): Row[] {
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

function tell(band: Band, item: Item & { kind: 'tell' }): View {
  const { fact } = item
  const rest: Key[] = [
    { key: 'tell-claude', hotkey: '2', label: 'Tell Claude' },
    twice(band, 'knew', '3', 'Knew this', 'Press again: never show this'),
    { key: 'dismiss', hotkey: '0', label: 'Dismiss' },
  ]

  if (!item.isOpen) {
    return {
      rows: [{ parts: headline(fact) }],
      keys: withAbout(band, [{ key: 'open', hotkey: '1', label: 'Open' }, ...rest]),
    }
  }

  const rejected = fact.alternatives.map(alternative => drawn(alternative, MAX_OPTION)).filter(text => text !== '')
  const where = fact.anchors.map(anchor =>
    drawn(anchor.symbol === undefined ? anchor.path : `${anchor.path} (${anchor.symbol})`, MAX_CONTENT),
  )

  return {
    rows: [
      { parts: headline(fact) },
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
      ...(fact.link === null ? [] : [{ parts: [{ link: fact.link, label: 'Open in Fylgja' }] }]),
    ],
    keys: rest,
  }
}

function question(band: Band, item: Item & { kind: 'question' }): View {
  if (item.form === 'reversal') {
    return {
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
        { key: 'replaces', hotkey: '1', label: 'Yes, it replaces it' },
        { key: 'tell-claude', hotkey: '2', label: 'No, tell Claude' },
        { key: 'different', hotkey: '3', label: 'Different case' },
        { key: 'skip', hotkey: '0', label: 'Skip' },
      ]),
    }
  }

  const options = item.options.map(option => drawn(option, MAX_OPTION)).filter(text => text !== '')

  return {
    rows: [
      {
        parts: [mark('?'), { text: 'Why: ', tone: 'strong' }, { text: drawn(item.content, MAX_CONTENT) }],
      },
    ],
    keys: withAbout(band, [
      ...options.map((label, index) => ({
        key: `reason:${index}`,
        hotkey: String(index + 1),
        label,
      })),
      { key: 'other', hotkey: String(options.length + 1), label: 'Other' },
      {
        key: 'no-reason',
        hotkey: String(options.length + 2),
        label: 'No particular reason',
      },
      { key: 'skip', hotkey: '0', label: 'Skip' },
    ]),
  }
}

/** A key that acts only when pressed twice: what it says before, and once it is waiting for the second press. */
function twice(band: Band, key: string, hotkey: string, label: string, again: string): Key {
  return { key, hotkey, label: band.armed?.key === key ? again : label }
}

/** What one written record's line says: that it is new or back, its sentence, and what it replaced. */
function written(record: Written): Part[] {
  return [
    { text: drawn(record.content, MAX_CONTENT) },
    ...(record.replaced === null ? [] : [{ text: ` · replaces: ${drawn(record.replaced, MAX_OPTION)}`, tone: 'dim' } as const]),
  ]
}

function receipt(band: Band, shown: Receipt): View {
  const [only] = shown.records

  if (shown.records.length === 1 && only !== undefined) {
    return {
      rows: [
        {
          parts: [
            mark('✓'),
            { text: only.outcome === 'restored' ? 'Restored · ' : 'Recorded · ', tone: 'good' },
            ...written(only),
          ],
        },
      ],
      keys: withAbout(band, [
        { key: 'fix:0', hotkey: '1', label: 'Fix' },
        twice(band, 'remove:0', '2', 'Remove', 'Press again to remove'),
        { key: 'ok', hotkey: '0', label: 'OK' },
      ]),
    }
  }

  const head: Row = {
    parts: [mark('✓'), { text: `Recorded ${shown.records.length}`, tone: 'good' }],
  }

  if (!shown.isOpen) {
    return {
      rows: [head],
      keys: withAbout(band, [
        { key: 'review', hotkey: '1', label: 'Review' },
        { key: 'ok', hotkey: '0', label: 'OK' },
      ]),
    }
  }

  return {
    rows: [
      head,
      ...shown.records.map((record, index) => ({
        parts: [...(record.outcome === 'restored' ? [{ text: 'Restored · ', tone: 'dim' } as const] : []), ...written(record)],
        keys: [
          { key: `fix:${index}`, hotkey: String(index * 2 + 1), label: 'Fix' },
          twice(band, `remove:${index}`, String(index * 2 + 2), 'Remove', 'Press again to remove'),
        ],
      })),
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
 */
export function viewOf(band: Band, isWorking: boolean): View | undefined {
  if (band.isAboutOpen) {
    return {
      rows: ABOUT_ROWS,
      keys: [
        twice(band, 'off', '1', 'Turn Scribe off', 'Press again to turn Scribe off'),
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

  return band.receipt === null ? undefined : receipt(band, band.receipt)
}
