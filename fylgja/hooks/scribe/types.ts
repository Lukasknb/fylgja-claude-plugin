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
  /**
   * The repository the record is about, as `owner/name`: the one its anchors
   * lie in; with no anchor, the one most of the turn's files lie in; with
   * no file in the turn, the one most of the session's files so far lie in,
   * or the session's own. Null when there is none of these; such a record
   * is not written.
   */
  repo: string | null
  /** The id of one of Scribe's own records of this session that this one rewrites in place; null for a new record. */
  updates: string | null
  /**
   * Whether it records a choice the developer made between options Claude
   * put to them. Such a record is never dropped for the number of records a
   * wake may write, and nobody is asked why about it.
   */
  fromChoice?: boolean
}

/** Where a file lies: its repository as `owner/name`, and its path from that repository's root. */
export type Place = { repo: string; path: string }

/** The one question a wake may ask about a record it proposed, by that record's place in the list. */
export type Ask =
  { form: 'reason'; record: number; options: string[] } | { form: 'reversal'; record: number; prior: string; options: string[] }

/** What a wake came to. Nothing in all three is the usual answer. */
export type Verdict = {
  records: Draft[]
  question: Ask | null
  /** Ids of records worth telling the developer about, each one a lookup returned. */
  tells: string[]
  /** Ids of Scribe's own records of this session whose decision was dropped: they are removed. */
  withdrawn: string[]
  /** Reasons and constraints the developer stated in this turn, each a short sentence. */
  stated: string[]
  /** Files of this session that carry out a decision Scribe recorded earlier in it: added to that record as anchors. */
  anchored?: { id: string; anchors: Anchor[] }[]
  /** How many such pairings the model proposed, before any was checked. */
  proposed?: number
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
  /**
   * The files among its anchors that a commit touched after the record was
   * last confirmed, the most recently touched first: what it says may no
   * longer be so. Null for a record no such commit was reported for, which
   * is every record of a server that does not say.
   */
  changed: string[] | null
}

/** A record Scribe wrote in this session. */
export type Written = {
  id: string
  kind: RecordKind
  content: string
  reasonStatus: ReasonStatus | null
  /**
   * Whether it is new, one that had been removed and is back, one whose
   * reason the developer just gave, one another member of the team already
   * holds (theirs to change, so it can be neither fixed nor removed from
   * here), or one of Scribe's own of this session that it rewrote in place
   * or took back because the session moved on.
   */
  outcome: 'created' | 'restored' | 'reasoned' | 'held' | 'updated' | 'withdrawn'
  /** The sentence of the recorded decision it replaced, when it replaced one. */
  replaced: string | null
  /** The repository it is filed under, and the places it points at: what a later anchor is checked against and added to. */
  repo?: string | null
  anchors?: Anchor[]
  /** Its reason, what was ruled out and its triggers, as written: held so that a record taken back can be put back whole. */
  detail?: string
  alternatives?: string[]
  triggers?: string[]
  /**
   * The id of a recorded decision it may go against: it was written beside
   * that one because the question whether it replaces it went unanswered.
   */
  against?: string
}
