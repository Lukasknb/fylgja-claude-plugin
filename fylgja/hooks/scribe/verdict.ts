/**
 * Reading what Scribe's model answered, and holding it to what the plugin
 * will act on. The model never writes anything itself: its answer is checked
 * here first, and what does not pass is left out.
 */

import { isRecord } from '../payload'
import { isAnchorable, isCode, MAX_LATE_FILES } from './anchoring'
import type { GitState } from './anchoring'
import { reasonStatusOf } from './facts'
import { MAX_ALTERNATIVE_CHARS, MAX_ALTERNATIVES, MAX_ANCHORS, MAX_CONTENT_CHARS, MAX_DETAIL_CHARS } from './gate'
import { stateFields } from './gate'
import type { Part } from './gate'
import { proseOf } from './labels'
import { headingOf } from './plans'
import type { PlanDoc } from './plans'
import { anchorsOf } from './repo'
import { MAX_APPLIES_TO, MAX_ORGANIZATION } from './scope'
import type { Anchor, Ask, Draft, Fact, Place, ReasonStatus, RecordKind, Reported, Verdict } from './types'
import { OFFERED_MARK, shareIn } from './words'

/** No record's sentence is longer than this; a longer one is not written at all. */
export const MAX_CONTENT = MAX_CONTENT_CHARS

export const MAX_RECORDS = 3
export const MAX_TELLS = 2

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
  /** The records the lookups of this wake returned, by id. */
  facts: ReadonlyMap<string, Fact>
  /** The files this session touched or looked up, and its plans in the tree: what a record may be anchored to. */
  paths: ReadonlySet<string>
  plans: readonly PlanDoc[]
  /** Whether the developer's own words in this turn say there was no particular reason. */
  saidNoReason: boolean
  /**
   * Where each path of `paths` lies: its repository and its path from that
   * repository's root. When given, a record's anchors are held to one
   * repository and written from its root.
   */
  places?: ReadonlyMap<string, Place>
  /**
   * What git said of the session's files, by `stateKey`: a file it ignores,
   * and a document it was never given, is no anchor. A file it was not
   * asked about is judged by its path alone.
   */
  gitStates?: ReadonlyMap<string, GitState>
  /** The ids of Scribe's own records that point at no code yet: the only ones a later anchor is added to. */
  waiting?: ReadonlySet<string>
  /** The files the session wrote, changed or committed, by `stateKey`: the only ones a later anchor may be. */
  changed?: ReadonlySet<string>
  /** The repository a record without anchors is about: the one most of the turn's files lie in. Null with none. */
  home?: string | null
  /** The ids of the records Scribe itself wrote in this session: the only ones it may rewrite or take back. */
  own?: ReadonlySet<string>
  /** The repository each of those is filed under: a later anchor must lie in it. */
  ownRepos?: ReadonlyMap<string, string>
  /** Whether their words in this turn say it outright ("no particular reason", "just because"), with nobody having asked. */
  statedNoReason?: boolean
  /** How many questions Claude put to the developer they answered in this turn. */
  choices?: number
  /** What the assistant wrote in the questions the developer answered in this turn, options and all: the assistant's words. */
  offered?: string
  /** What the developer typed in this turn: their own words. */
  typed?: string
  /** The numbers of the agents' reports this wake was shown: the only ones a record may come out of. */
  reports?: ReadonlySet<number>
}

/** The key what git said of a file is held under: its repository and its path there. */
export function stateKey(place: Place): string {
  return `${place.repo}\u0000${place.path}`
}

/** Whether a file as the session names it may be an anchor: never a plan, notes or a scratch file (`anchoring.ts`). */
function mayAnchor(seen: Seen, path: string): boolean {
  const place = seen.places?.get(path)

  return place === undefined
    ? isAnchorable(path, undefined)
    : isAnchorable(place.path, seen.gitStates?.get(stateKey(place)))
}

/**
 * The anchors of a record held to one repository: the one most of them lie
 * in, the first named winning a tie, each written from that repository's
 * root. Anchors in any other repository are left off: a record is about one
 * repository, and is filed under it.
 */
function inOnePlace(anchors: readonly Anchor[], places: ReadonlyMap<string, Place>): { repo: string | null; anchors: Anchor[] } {
  const placed = anchors.flatMap(anchor => {
    const place = places.get(anchor.path)

    return place === undefined ? [] : [{ repo: place.repo, anchor: { ...anchor, path: place.path } }]
  })
  const counts = new Map<string, number>()

  for (const one of placed) {
    counts.set(one.repo, (counts.get(one.repo) ?? 0) + 1)
  }

  let repo: string | null = null

  for (const [name, count] of counts) {
    if (repo === null || count > (counts.get(repo) ?? 0)) {
      repo = name
    }
  }

  const seen = new Set<string>()
  const kept: Anchor[] = []

  for (const one of placed) {
    const key = `${one.anchor.path}\u0000${one.anchor.symbol ?? ''}`

    if (one.repo === repo && !seen.has(key)) {
      seen.add(key)
      kept.push(one.anchor)
    }
  }

  return { repo, anchors: kept }
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

/**
 * Whether `detail` only asks: every sentence of it a question, code spans
 * and quotations aside. A question gives no cause ("Isn't the absence rule
 * separate from partial confirmation?"), however much it sounds like one,
 * and is not written down as a reason.
 */
export function isAQuestion(detail: string): boolean {
  const said = proseOf(detail)
    .split(/(?<=[.!?])\s+/)
    .map(part => part.trim().replace(/["'”“)\s]+$/, ''))
    .filter(part => part !== '')

  return said.length > 0 && said.every(part => part.endsWith('?'))
}

function reasonOf(asked: ReasonStatus | null, detail: string, saidNoReason: boolean): { status: ReasonStatus; detail: string } {
  // "No particular reason" is the developer's to say; the model's word for
  // it stands only when their own words in this turn say so too.
  if (asked === 'no_strong_reason' && saidNoReason) {
    return { status: 'no_strong_reason', detail }
  }

  // A reason nobody gave is not written down as one, and a question is none.
  if (asked === 'not_stated' || asked === 'no_strong_reason' || detail === '' || isAQuestion(detail)) {
    return { status: 'not_stated', detail: '' }
  }

  return { status: 'stated', detail }
}

/**
 * A reason is the assistant's when this share of its words stand in what the
 * assistant wrote in a question the developer answered. Low on purpose: a
 * paraphrase keeps few of the words, and a mark too many says only that the
 * developer chose it, which they did.
 */
export const OFFERED_SHARE = 0.35

/** No sentence longer than this is sent at all; up to it, the server says what is wrong and it may be put right. */
const MAX_SENT_CONTENT = 1000

/** Whether the model said a record of its verdict is about how the work of this session is organised. */
function isAboutTheWork(value: unknown): boolean {
  return isRecord(value) && value.about === 'work'
}

/** A record as the plugin will write it, or undefined when it is no record. */
export function draftOf(value: unknown, seen: Seen): Draft | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string' || !KINDS.has(value.kind)) {
    return undefined
  }

  const kind = value.kind as RecordKind
  const content = sentence(value.content)

  if (content === '' || content.length > MAX_SENT_CONTENT) {
    return undefined
  }

  // How the work of this session is organised is no record. Only the model
  // can tell it from a team's rule about how changes ship, which words alone
  // cannot ("Schema changes ship in a separate PR so the expand migration
  // deploys first" is a decision), so its word decides.
  if (isAboutTheWork(value)) {
    return undefined
  }

  const plan = planOf(value.plan, seen.plans)
  const named = anchorsOf(value.anchors, MAX_ANCHORS - 1, seen.paths).filter(anchor => mayAnchor(seen, anchor.path))
  const held = seen.places === undefined ? { repo: null, anchors: named } : inOnePlace(named, seen.places)
  const { anchors } = held
  let repo = held.repo ?? seen.home ?? null
  const suffix =
    plan === undefined ? '' : ` (per ${plan.doc.title}${plan.heading === undefined ? '' : `, section ${plan.heading}`})`
  // Cut to what the server takes, with room for the plan's name after it.
  let detail =
    typeof value.detail === 'string'
      ? value.detail
          .trim()
          .slice(0, MAX_DETAIL_CHARS - suffix.length)
          .trim()
      : ''
  let reasonStatus: ReasonStatus | null = null

  if (kind === 'decision') {
    const reason = reasonOf(reasonStatusOf(value.reason_status), detail, seen.saidNoReason)

    detail = reason.detail
    reasonStatus = reason.status

    // In a turn where the developer answered a question of the assistant's:
    // a reason that mostly says over what the assistant wrote there (the
    // question, the options and what each was said to mean), and not what
    // the developer typed, is marked as the assistant's, which they chose.
    // Whether the model called the record a choice does not matter for it.
    const fromOffer = (seen.offered ?? '') === '' ? 0 : shareIn(detail, seen.offered ?? '')

    if (
      reasonStatus === 'stated' &&
      !detail.includes(OFFERED_MARK.trim()) &&
      fromOffer >= OFFERED_SHARE &&
      fromOffer > shareIn(detail, seen.typed ?? '')
    ) {
      detail = `${detail.slice(0, MAX_DETAIL_CHARS - suffix.length - OFFERED_MARK.length).trim()}${OFFERED_MARK}`
    }
  }

  if (plan !== undefined) {
    // A plan in the tree is a place a later reader can open; one outside it
    // will be gone, so only its name is carried, beside the reason.
    const at =
      plan.doc.path === null
        ? undefined
        : seen.places === undefined
          ? { repo, path: plan.doc.path }
          : seen.places.get(plan.doc.path)

    // The plan is an anchor only where it lies in the repository the record
    // is about, and only a document the repository keeps (an ADR, a spec):
    // a plan of the work is thrown away once the work is done.
    if (
      at !== undefined &&
      (at.repo === null || seen.places === undefined
        ? isAnchorable(at.path, undefined)
        : isAnchorable(at.path, seen.gitStates?.get(stateKey({ repo: at.repo, path: at.path })))) &&
      (repo === null || at.repo === null || at.repo === repo) &&
      !anchors.some(anchor => anchor.path === at.path)
    ) {
      anchors.push(plan.heading === undefined ? { path: at.path } : { path: at.path, symbol: plan.heading })
      repo ??= at.repo
    }

    if (detail !== '' && !detail.includes(plan.doc.title)) {
      detail = `${detail}${suffix}`
    }
  }

  const supersedes = idOf(value.supersedes)
  const updates = idOf(value.updates)
  const triggers = kind === 'gotcha' ? sentences(value.triggers, 5, 80) : []
  const appliesTo = sentences(value.applies_to, MAX_APPLIES_TO, MAX_ORGANIZATION)

  return {
    kind,
    content,
    detail,
    alternatives: kind === 'decision' ? sentences(value.alternatives, MAX_ALTERNATIVES, MAX_ALTERNATIVE_CHARS) : [],
    anchors,
    triggers,
    reasonStatus,
    // Only a recorded decision a lookup of this wake returned can be replaced.
    supersedes: kind === 'decision' && supersedes !== null && seen.facts.get(supersedes)?.kind === 'decision' ? supersedes : null,
    repo,
    // Only a record Scribe itself wrote in this session is rewritten in place.
    updates: updates !== null && seen.own?.has(updates) === true ? updates : null,
    // Only where the developer did answer a question in this turn.
    fromChoice: value.from_choice === true && (seen.choices ?? 0) > 0,
    ...(appliesTo.length === 0 ? {} : { appliesTo }),
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

  if (value.form === 'reversal' && prior !== null && seen.facts.get(prior)?.kind === 'decision') {
    draft.supersedes = prior

    return { form: 'reversal', record, prior, options }
  }

  return null
}

/**
 * The verdict the plugin acts on, read from the model's own.
 *
 * A record that is not one is left out and the rest stand. A record keeps
 * only the anchors the session itself touched, and names a record it
 * replaces, or one to tell about, only by an id a lookup of this wake
 * returned.
 */
export function verdictOf(value: Record<string, unknown>, seen: Seen): Verdict {
  if (value.outcome !== 'act') {
    return { records: [], question: null, tells: [], withdrawn: [], stated: [] }
  }

  // What came out of an agent's report is kept apart, and never written as it stands.
  const proposed = Array.isArray(value.records) ? value.records : []
  const reported = reportedOf(proposed, seen)
  const own = proposed.filter(record => !isFromReport(record))
  // A wake writes no more than `MAX_RECORDS` records, and beside them one for
  // each question the developer answered in the turn, up to `MAX_CHOICE_RECORDS`:
  // a choice they made is never what the limit drops.
  const room = { other: MAX_RECORDS, choice: Math.min(MAX_CHOICE_RECORDS, seen.choices ?? 0) }
  const given = own.slice(0, MAX_RECORDS + MAX_CHOICE_RECORDS).map(record => {
    const draft = draftOf(record, seen)

    if (draft === undefined) {
      return undefined
    }

    if (draft.fromChoice === true && room.choice > 0) {
      room.choice -= 1

      return draft
    }

    if (room.other > 0) {
      room.other -= 1

      return { ...draft, fromChoice: false }
    }

    return undefined
  })
  const records = given.filter((draft): draft is Draft => draft !== undefined)
  const decisions = records.filter(draft => draft.kind === 'decision')

  // The developer said, in so many words and unasked, that there was no
  // particular reason. With one decision in the turn it is that one's: it
  // is recorded as having none, and nobody is asked.
  if (seen.statedNoReason === true && decisions.length === 1 && decisions[0]?.reasonStatus === 'not_stated') {
    decisions[0].reasonStatus = 'no_strong_reason'
  }
  const tells: string[] = []

  for (const entry of Array.isArray(value.tells) ? value.tells : []) {
    const id = idOf(isRecord(entry) ? entry.id : entry)

    if (id !== null && seen.facts.has(id) && !tells.includes(id) && tells.length < MAX_TELLS) {
      tells.push(id)
    }
  }

  let question = askOf(value.question, given, records, seen)

  // Replacing a recorded decision is the developer's call, never the
  // model's alone: a record that names one it replaces is asked about. Where
  // the one question of this verdict is already another, it replaces nothing.
  for (const [record, draft] of records.entries()) {
    const isAsked = question?.form === 'reversal' && question.record === record

    if (draft.supersedes !== null && !isAsked) {
      if (question === null) {
        question = { form: 'reversal', record, prior: draft.supersedes, options: [] }
      } else {
        draft.supersedes = null
      }
    }
  }

  // A record that rewrites one of Scribe's own replaces nothing of anybody else's.
  for (const draft of records) {
    if (draft.updates !== null) {
      draft.supersedes = null
    }
  }

  if (question?.form === 'reversal' && records[question.record]?.updates !== null) {
    question = null
  }

  const rewritten = new Set(records.map(draft => draft.updates))
  const withdrawn: string[] = []

  for (const entry of Array.isArray(value.withdraw) ? value.withdraw : []) {
    const id = idOf(entry)

    if (
      id !== null &&
      seen.own?.has(id) === true &&
      !rewritten.has(id) &&
      !withdrawn.includes(id) &&
      withdrawn.length < MAX_WITHDRAWN
    ) {
      withdrawn.push(id)
    }
  }

  // Files that carry out one of Scribe's own earlier decisions: the record
  // must be its own, the files among those the session touched, and in the
  // repository the record is filed under.
  const anchored: { id: string; anchors: Anchor[] }[] = []

  for (const entry of Array.isArray(value.anchor) ? value.anchor.slice(0, MAX_LATE) : []) {
    const id = isRecord(entry) ? idOf(entry.id) : null
    const home = id === null ? undefined : seen.ownRepos?.get(id)

    if (id === null || home === undefined || seen.places === undefined || !isRecord(entry) || seen.waiting?.has(id) === false) {
      continue
    }

    // Only code the session changed, and only to a record still waiting for it: a file is added because it carries the decision out.
    const named = anchorsOf(entry.paths, MAX_ANCHORS, seen.paths).filter(anchor => mayAnchor(seen, anchor.path))
    const placed = inOnePlace(named, seen.places)
    const code = placed.anchors
      .filter(anchor => isCode(anchor.path) && (placed.repo === null || seen.changed?.has(stateKey({ repo: placed.repo, path: anchor.path })) !== false))
      .slice(0, MAX_LATE_FILES)

    if (placed.repo === home && code.length > 0) {
      anchored.push({ id, anchors: code })
    }
  }

  return {
    records,
    ...(reported.length === 0 ? {} : { reported }),
    question,
    tells,
    withdrawn,
    stated: sentences(value.stated, MAX_STATED, MAX_STATED_CHARS),
    anchored,
    proposed: Array.isArray(value.anchor) ? value.anchor.length : 0,
    aboutWork: own.slice(0, MAX_RECORDS + MAX_CHOICE_RECORDS).filter(isAboutTheWork).length,
  }
}

/** No more records are taken out of agents' reports by one verdict than this. */
export const MAX_REPORTED = 3

/** Whether the model said a record of its verdict came out of an agent's report. */
function isFromReport(value: unknown): boolean {
  return isRecord(value) && value.from_report !== undefined && value.from_report !== null
}

/** The number of a report as the model names it, `r2` or `2`; undefined for anything else. */
function reportNumber(value: unknown): number | undefined {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim().toLowerCase() : ''
  const found = /^r?(\d{1,6})$/.exec(text)

  return found === null ? undefined : Number(found[1])
}

/**
 * The records the model took out of agents' reports, each held to one of the
 * reports this wake was shown; one that names no such report is no record.
 */
function reportedOf(proposed: readonly unknown[], seen: Seen): Reported[] {
  const reported: Reported[] = []

  for (const value of proposed) {
    if (!isFromReport(value) || !isRecord(value) || reported.length >= MAX_REPORTED) {
      continue
    }

    const report = reportNumber(value.from_report)
    // Nothing of a report is the developer's choice, and nothing of it replaces or rewrites a record.
    const draft = draftOf({ ...value, from_choice: false, supersedes: null, updates: null }, seen)

    if (report !== undefined && seen.reports?.has(report) === true && draft !== undefined) {
      reported.push({ draft, report })
    }
  }

  return reported
}

/** Beside the records of a wake, no more records of the developer's own choices than this. */
export const MAX_CHOICE_RECORDS = 4

/** No more of Scribe's own records are given later anchors by one verdict than this. */
const MAX_LATE = 6

/** No more of Scribe's own records are taken back by one verdict than this. */
const MAX_WITHDRAWN = 2

/** No more things the developer stated are taken from one verdict than this, and none longer. */
const MAX_STATED = 3
const MAX_STATED_CHARS = 200

/**
 * A record Fylgja refused, put right by the model: the same record with the
 * one part the refusal was about taken from the model's answer, and every
 * other part as it was. A reworded sentence can so never bring a reason
 * with it that nobody gave, or a place nobody opened. Nor can a mended
 * reason: a record that had none gets none, and one that had one gets it
 * back no longer than it was. A record whose wording is put right names
 * what a label stood for, which takes more words than the label: its
 * sentence, its reason and its alternatives may each grow to what the
 * server takes, but a record that had no reason still gets none, it keeps
 * its reason status, and it gets no more alternatives than it had. A
 * decision whose reason or alternative said how things stand today keeps
 * its sentence, and of the two changes only what `refusal` names
 * (`withoutState`).
 * Undefined when the answer is no record, or changes nothing.
 */
export function correctedOf(draft: Draft, value: unknown, part: Part, seen: Seen, refusal?: string): Draft | undefined {
  const answered = draftOf(isRecord(value) ? { ...value, kind: draft.kind } : value, seen)

  if (answered === undefined) {
    return undefined
  }

  const had = draft.detail.trim()
  const detail =
    had !== '' && answered.detail.trim() !== '' && answered.detail.length <= draft.detail.length ? answered.detail : draft.detail
  // A record with no reason cannot be said to state one.
  const reasonStatus = detail.trim() === '' && answered.reasonStatus === 'stated' ? draft.reasonStatus : answered.reasonStatus
  const better: Draft =
    part === 'content'
      ? { ...draft, content: answered.content }
      : part === 'triggers'
        ? { ...draft, triggers: answered.triggers }
        : part === 'reason'
          ? { ...draft, detail, reasonStatus, alternatives: answered.alternatives }
          : part === 'alternatives'
            ? { ...draft, alternatives: answered.alternatives }
            : part === 'cause'
              ? { ...draft, ...withoutState(draft, answered, stateFields(refusal)) }
            : part === 'wording'
              ? {
                  ...draft,
                  content: answered.content,
                  detail: had !== '' && answered.detail.trim() !== '' ? answered.detail : draft.detail,
                  alternatives: answered.alternatives.slice(0, draft.alternatives.length),
                }
              : // Places put right stay in the repository the record is about.
                { ...draft, anchors: answered.repo === null || answered.repo === draft.repo ? answered.anchors : draft.anchors }

  return JSON.stringify(better) === JSON.stringify(draft) ? undefined : better
}

/**
 * The reason and the rejected alternatives of a decision refused because
 * one or both say how things stand today, as the model's answer leaves
 * them. Only what the refusal `named` is taken from the answer: a refusal
 * about an alternative never changes the reason, and one about the reason
 * never changes or drops an alternative.
 *
 * The cause behind a state takes more words than the state did, so the
 * reason may grow to what the server takes. An answer with no reason
 * leaves the decision with none on record (`not_stated`), which is what it
 * then is; a record that had no reason gets none, and one already said to
 * have no strong reason keeps saying so. The alternatives come back
 * reworded or fewer, never more.
 */
function withoutState(
  draft: Draft,
  answered: Draft,
  named: { reason: boolean; alternatives: boolean },
): Pick<Draft, 'detail' | 'reasonStatus' | 'alternatives'> {
  const alternatives = named.alternatives ? answered.alternatives.slice(0, draft.alternatives.length) : draft.alternatives

  if (!named.reason || draft.detail.trim() === '') {
    return { detail: draft.detail, reasonStatus: draft.reasonStatus, alternatives }
  }

  if (answered.detail.trim() !== '') {
    return { detail: answered.detail, reasonStatus: draft.reasonStatus, alternatives }
  }

  return {
    detail: '',
    reasonStatus: draft.reasonStatus === 'no_strong_reason' ? draft.reasonStatus : 'not_stated',
    alternatives,
  }
}

// What a person says when there is no why: that they do not know, or that
// nothing in particular decided it.
const NO_REASON =
  /\b(?:idk|dunno|no idea|no clue|not sure|unsure|(?:i |we )?(?:honestly |really )?(?:don'?t|do not|can'?t|cannot) (?:really )?(?:know|remember|recall|say)|no (?:particular|real|special|specific|strong|good|actual) reason|no reason|none|nothing in particular|nothing|arbitrary|it just worked|just worked|it works|just because|(?:just )?picked the first (?:one |thing )?that worked|first (?:one |thing )?that worked|whatever worked)\b/i

// Words that may come before it and after it without making it anything else.
const FILLER =
  "(?:honestly|frankly|tbh|to be honest|well|sorry|hm+|uh+|er+|oh|really|genuinely|literally|just|i guess|i think|i|we|i've|i have|have|at all|anymore|any more|why)"
const WHOLE = new RegExp(
  `^(?:${FILLER}[\\s,.]+)*(?:${NO_REASON.source})(?:[\\s,.;:!?-]+(?:${FILLER}|${NO_REASON.source}))*[\\s.!?\u2026]*$`,
  'i',
)

/**
 * Whether `text`, a person's own short answer to "why", says there was no
 * particular reason. That has to be the whole of the answer: "no idea", "no
 * idea, it just worked", "honestly, none". An answer that goes on to say
 * something is a reason and is kept as one: "none of the others support
 * ESM", "just because the API requires it".
 */
export function saysNoReason(text: string): boolean {
  const flat = text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

  return flat === '?' || (flat.length <= 160 && WHOLE.test(flat))
}

const OUTRIGHT =
  /\bno (?:particular|real|special|specific|strong|good|actual) reason\b|\b(?:for|there (?:is|was)) no reason\b|\bno reason(?: at all| really|,| for (?:it|that|this))|\bjust because\b|\barbitrar(?:y|ily)\b/i

/**
 * Whether the developer's words in a turn say outright, unasked, that there
 * was no particular reason. Narrower than `mentionsNoReason`: "not sure" or
 * "nothing" somewhere in a prompt says nothing about a reason.
 */
export function statesNoReason(text: string): boolean {
  return OUTRIGHT.test(text.replace(/[‘’]/g, "'"))
}

/** Whether the developer's words in a turn, however long, say somewhere that there was no particular reason. */
export function mentionsNoReason(text: string): boolean {
  return NO_REASON.test(text.replace(/[‘’]/g, "'"))
}
