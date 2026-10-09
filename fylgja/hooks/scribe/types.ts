/**
 * The shapes Scribe's files hand each other. Everything here holds text of
 * the session or of a record, so none of it is ever stored or logged: it
 * lives in the running plugin and goes when the session does.
 */

/** Whether a decision's reason is known: given, never asked or answered, or asked and there is none. */
export type ReasonStatus = 'stated' | 'not_stated' | 'no_strong_reason'

export type RecordKind = 'decision' | 'gotcha' | 'correction'

/** A place in the code a record concerns: a path relative to the tree's root, and a symbol in it. */
export type Anchor = { path: string; symbol?: string }

/** A record the model proposed and the plugin checked, before it is written. */
export type Draft = {
  kind: RecordKind
  /** One sentence, at most 220 characters. */
  content: string
  /** For a decision, its reason; empty when none is known. */
  detail: string
  /** What was considered and not chosen; a decision's alone. */
  alternatives: string[]
  anchors: Anchor[]
  /** Words a later shell command would hold; a gotcha's alone. */
  triggers: string[]
  /** A decision's alone; null on every other kind. */
  reasonStatus: ReasonStatus | null
  /** The id of a recorded decision this one replaces, one a lookup of this wake returned. */
  supersedes: string | null
}

/** The one question a wake may ask about a record it proposed, by that record's place in the list. */
export type Ask =
  { form: 'reason'; record: number; options: string[] } | { form: 'reversal'; record: number; prior: string; options: string[] }

/** What a wake came to. Nothing in all three is the usual answer. */
export type Verdict = {
  records: Draft[]
  question: Ask | null
  /** Ids of records worth telling the developer about, each one a lookup returned. */
  tells: string[]
}

/** A record as Fylgja returned it, as much as the band shows. Its texts are held as received and made safe where drawn. */
export type Fact = {
  id: string
  kind: string
  content: string
  detail: string
  alternatives: string[]
  anchors: Anchor[]
  /** The paths among its anchors that another member than its author added: not the author's word on where it applies. */
  addedByOthers: string[]
  reasonStatus: ReasonStatus | null
  /** The day it was last confirmed or written, `YYYY-MM-DD`. */
  date: string | null
  /** Who wrote it down, as the server names them: `scribe`, `assistant`, `person` or `extraction`. */
  origin: string
  /**
   * The page of the meeting or session the record was read out of, on
   * Fylgja's own host. Null for a record that was remembered directly, which
   * is most of what Scribe shows: such a record has no page of its own.
   */
  link: string | null
}

/** A record Scribe wrote in this session. */
export type Written = {
  id: string
  kind: RecordKind
  content: string
  reasonStatus: ReasonStatus | null
  /**
   * Whether it is new, one that had been removed and is back, one whose
   * reason the developer just gave, or one another member of the team
   * already holds: theirs to change, so it can be neither fixed nor removed
   * from here.
   */
  outcome: 'created' | 'restored' | 'reasoned' | 'held'
  /** The sentence of the recorded decision it replaced, when it replaced one. */
  replaced: string | null
}
