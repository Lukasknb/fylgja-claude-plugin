/**
 * Reading what Scribe's model answered, and holding it to what the plugin
 * will act on. The model never writes anything itself: its answer is checked
 * here first, and what does not pass is left out.
 */

import { isRecord } from '../payload'
import { reasonStatusOf } from './facts'
import { headingOf } from './plans'
import type { PlanDoc } from './plans'
import { anchorsOf } from './repo'
import type { Anchor, Ask, Draft, Fact, ReasonStatus, RecordKind, Verdict } from './types'

/** No record's sentence is longer than this; a longer one is not written at all. */
export const MAX_CONTENT = 220

export const MAX_RECORDS = 3
export const MAX_TELLS = 2

const MAX_DETAIL = 1500
const MAX_ALTERNATIVES = 6
const MAX_ANCHORS = 12
const MAX_OPTION = 80

/** What the model asked for: a lookup, or its verdict as written. */
export type Reply =
  | { kind: 'lookup'; tool: string; args: Record<string, unknown> }
  | { kind: 'verdict'; value: Record<string, unknown> }
  | { kind: 'unreadable'; why: string }

/**
 * The one JSON object in `text`. A code fence around it and words before or
 * after it are let go; anything else is unreadable, and says why in words
 * that hold nothing of the reply.
 */
export function replyOf(text: string): Reply {
  const from = text.indexOf('{')
  const to = text.lastIndexOf('}')

  if (from === -1 || to < from) {
    return { kind: 'unreadable', why: 'the reply held no JSON object' }
  }

  let value: unknown

  try {
    value = JSON.parse(text.slice(from, to + 1))
  } catch {
    return {
      kind: 'unreadable',
      why: 'the reply was not one valid JSON object',
    }
  }

  if (!isRecord(value)) {
    return { kind: 'unreadable', why: 'the reply was not a JSON object' }
  }

  if (typeof value.tool === 'string') {
    return {
      kind: 'lookup',
      tool: value.tool,
      args: isRecord(value.args) ? value.args : {},
    }
  }

  if (value.outcome !== 'nothing' && value.outcome !== 'act') {
    return {
      kind: 'unreadable',
      why: '"outcome" was neither "nothing" nor "act"',
    }
  }

  return { kind: 'verdict', value }
}

/** What a verdict is checked against: only what this wake really saw. */
export type Seen = {
  /** Every record id a lookup of this wake returned. */
  citable: ReadonlySet<string>
  /** The records this wake holds whole, by id. */
  facts: ReadonlyMap<string, Fact>
  plans: readonly PlanDoc[]
  /** Whether the developer's own words in this turn say there was no particular reason. */
  saidNoReason: boolean
}

const KINDS: ReadonlySet<string> = new Set(['decision', 'gotcha', 'correction'])

function sentence(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function sentences(value: unknown, max: number, longest: number): string[] {
  return (Array.isArray(value) ? value : [])
    .map(sentence)
    .filter(entry => entry !== '' && entry.length <= longest)
    .slice(0, max)
}

function idOf(value: unknown): string | null {
  return typeof value === 'string' ? value.trim().toLowerCase() : null
}

/** The plan a record follows, and the heading in it, when the model named a plan this session holds. */
function planOf(value: unknown, plans: readonly PlanDoc[]): { doc: PlanDoc; heading: string | undefined } | undefined {
  const doc = isRecord(value) ? plans.find(plan => plan.n === value.doc) : undefined

  return doc === undefined || !isRecord(value)
    ? undefined
    : {
        doc,
        heading: typeof value.section === 'string' ? headingOf(doc, value.section) : undefined,
      }
}

function reasonOf(asked: ReasonStatus | null, detail: string, saidNoReason: boolean): { status: ReasonStatus; detail: string } {
  // "No particular reason" is the developer's to say; the model's word for
  // it stands only when their own words in this turn say so too.
  if (asked === 'no_strong_reason' && saidNoReason) {
    return { status: 'no_strong_reason', detail }
  }

  // A reason nobody gave is not written down as one.
  if (asked === 'not_stated' || asked === 'no_strong_reason' || detail === '') {
    return { status: 'not_stated', detail: '' }
  }

  return { status: 'stated', detail }
}

function draftOf(value: unknown, seen: Seen): Draft | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string' || !KINDS.has(value.kind)) {
    return undefined
  }

  const kind = value.kind as RecordKind
  const content = sentence(value.content)

  // Over-long is left out whole: a sentence cut short says something else.
  if (content === '' || content.length > MAX_CONTENT) {
    return undefined
  }

  const plan = planOf(value.plan, seen.plans)
  const anchors: Anchor[] = anchorsOf(value.anchors, MAX_ANCHORS - 1)
  let detail = typeof value.detail === 'string' ? value.detail.trim().slice(0, MAX_DETAIL) : ''
  let reasonStatus: ReasonStatus | null = null

  if (kind === 'decision') {
    const reason = reasonOf(reasonStatusOf(value.reason_status), detail, seen.saidNoReason)

    detail = reason.detail
    reasonStatus = reason.status
  }

  if (plan !== undefined) {
    // A plan in the tree is a place a later reader can open; one outside it
    // will be gone, so only its name is carried, beside the reason.
    if (plan.doc.path !== null && !anchors.some(anchor => anchor.path === plan.doc.path)) {
      anchors.push(plan.heading === undefined ? { path: plan.doc.path } : { path: plan.doc.path, symbol: plan.heading })
    }

    if (detail !== '' && !detail.includes(plan.doc.title)) {
      detail = `${detail} (per ${plan.doc.title}${plan.heading === undefined ? '' : `, section ${plan.heading}`})`
    }
  }

  const supersedes = idOf(value.supersedes)

  return {
    kind,
    content,
    detail,
    alternatives: kind === 'decision' ? sentences(value.alternatives, MAX_ALTERNATIVES, MAX_CONTENT) : [],
    anchors,
    triggers: kind === 'gotcha' ? sentences(value.triggers, 5, 80) : [],
    reasonStatus,
    supersedes: kind === 'decision' && supersedes !== null && seen.citable.has(supersedes) ? supersedes : null,
  }
}

function askOf(value: unknown, records: readonly (Draft | undefined)[], kept: readonly Draft[], seen: Seen): Ask | null {
  if (!isRecord(value) || typeof value.record !== 'number') {
    return null
  }

  const draft = records[value.record]
  const record = draft === undefined ? -1 : kept.indexOf(draft)

  // Only a decision is ever asked about.
  if (draft === undefined || record === -1 || draft.kind !== 'decision') {
    return null
  }

  const options = sentences(value.options, 3, MAX_OPTION)

  if (value.form === 'reason') {
    return draft.reasonStatus === 'not_stated' ? { form: 'reason', record, options } : null
  }

  const prior = idOf(value.prior)

  if (value.form === 'reversal' && prior !== null && seen.facts.has(prior)) {
    draft.supersedes = prior

    return { form: 'reversal', record, prior, options }
  }

  return null
}

/**
 * The verdict the plugin acts on, read from the model's own.
 *
 * A record that is not one is left out and the rest stand. A record keeps
 * only the anchors that lie in the tree, and names a record it replaces, or
 * one to tell about, only by an id this wake was really shown.
 */
export function verdictOf(value: Record<string, unknown>, seen: Seen): Verdict {
  if (value.outcome !== 'act') {
    return { records: [], question: null, tells: [] }
  }

  const given = (Array.isArray(value.records) ? value.records : []).slice(0, MAX_RECORDS).map(record => draftOf(record, seen))
  const records = given.filter((draft): draft is Draft => draft !== undefined)
  const tells: string[] = []

  for (const entry of Array.isArray(value.tells) ? value.tells : []) {
    const id = idOf(isRecord(entry) ? entry.id : entry)

    if (id !== null && seen.facts.has(id) && !tells.includes(id) && tells.length < MAX_TELLS) {
      tells.push(id)
    }
  }

  return {
    records,
    question: askOf(value.question, given, records, seen),
    tells,
  }
}

// What a person types when asked why and there is no why: a short answer
// that says they do not know or that nothing decided it.
const NO_REASON =
  /\b(?:idk|dunno|no idea|no clue|not sure|unsure|don'?t (?:really )?(?:know|remember|recall)|do not (?:know|remember|recall)|no (?:particular|real|special|specific|strong|good|actual) reason|no reason|none|nothing in particular|arbitrary|it just worked|just worked|just because|first (?:one |thing )?that worked|whatever worked)\b/i

// The words a short answer may open with before it says so.
const OPENING =
  /^(?:(?:honestly|frankly|tbh|to be honest|well|sorry|hm+|uh+|er+|oh|really|genuinely|literally|just|i|we|i've|have)[\s,.]+)*/i

/**
 * Whether `text`, a person's own short answer to "why", says there was no
 * particular reason. It has to open with it: "no idea, it just worked" does,
 * "the vendor had no idea how to fix it" is a reason.
 */
export function saysNoReason(text: string): boolean {
  const flat = text.replace(/[\u2018\u2019]/g, "'").trim()
  const said = flat.replace(OPENING, '')

  return flat === '?' || (flat.length <= 160 && [flat, said].some(words => NO_REASON.exec(words)?.index === 0))
}

/** Whether the developer's words in a turn, however long, say somewhere that there was no particular reason. */
export function mentionsNoReason(text: string): boolean {
  return NO_REASON.test(text.replace(/[‘’]/g, "'"))
}
