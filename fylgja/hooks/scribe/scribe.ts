/**
 * Scribe: it follows the session and works with Fylgja so that whoever
 * reads the code later can find out why it was built that way. It records
 * decisions with their reasons, asks when a decision has none, and tells
 * the developer what is already recorded about the files in hand.
 *
 * It only ever listens and writes to Fylgja. Nothing here adds to what
 * Claude reads; the one way anything of it reaches Claude is the developer
 * pressing "Tell Claude", which puts a note in the prompt box and sends
 * nothing.
 *
 * What it holds of the session and of records is held in the running plugin
 * alone. What it keeps on the machine is ids, counters and two switches,
 * among them the ids of the records each conversation kept (`saved.ts`).
 */

import type { Doing } from '../companion'
import { detailOf } from '../hits'
import type { View as Listed } from '../listing'
import { isRecord, payloadOf } from '../payload'
import { drawn } from '../plain'
import { SCHEMA } from '../telemetry-schema'
import { wordOf } from '../telemetry'
import type { Report, Word } from '../telemetry'
import { isCode, isWaiting, MAX_GIT_PATHS, statesOf } from './anchoring'
import type { GitState } from './anchoring'
import * as Band from './band'
import { baseOf, isUnknownBase, rootOf } from './base'
import type { Base } from './base'
import { gitIn } from './git'
import type { Run } from './git'
import { carried, listedOf, saidOf } from './carry'
import { changesOf, filesOf, hasOpenQuestion, isAnswer, isPrompt, observe, plain } from './delta'
import type { Landed, Offer, Row } from './delta'
import { changedLine, factsOf, isAnchoredTo, knownReposIn } from './facts'
import { REFUSED } from './grant'
import { leaningOf, leaningRefusal } from './labels'
import type { Leaning } from './labels'
import * as Ledger from './ledger'
import { codeOf, MAX_ANCHORS, PASSING, teaches } from './gate'
import { correct, MAX_LOOKUPS, MAX_STEPS, reasonIn, relationOf, STEP_TIMEOUT_MS, WAKE_DEADLINE_MS, wake } from './loop'
import type { LoopHost, NamingSession, Proposal, Usage } from './loop'
import * as Plans from './plans'
import { foldedBlock, MAX_SHOWN, pastBlock, planBlock, SYSTEM, wakeText } from './prompt'
import type { Block } from './prompt'
import { relativeTo, repoNameOf } from './repo'
import { INDEX, indexed, indexOf, keyOf, marksOf, MAX_READ, MAX_RECORDS, MAX_SAVED, nearest, PREFIX, recordOf, savedOf } from './saved'
import type { Saved, SavedRecord } from './saved'
import { cleared } from './staged'
import type { Index } from './staged'
import { CALL_TIMEOUT_MS, limited, TimedOut } from './time'
import type { Draft, Fact, Place, Verdict, Written } from './types'
import { correctedOf, MAX_CONTENT, mentionsNoReason, saysNoReason, statesNoReason } from './verdict'
import { stateKey } from './verdict'
import type { Seen } from './verdict'
import { NO_STRONG_REASON, NOT_STATED, provenanceOf, viewOf } from './view'
import type { View } from './view'

/** The engine calls Scribe makes, bound from one hook's `$`. */
export type ScribeHost = LoopHost & {
  /** The name Fylgja's server is called under, or undefined while it is not connected. */
  server: () => Promise<string | undefined>
  /**
   * `$.mcp.call`: one tool call on the session's own Fylgja connection.
   * Rejects with an error whose message is `REFUSED` when the call was not
   * let through, and with any other error when it failed.
   */
  call: (server: string, tool: string, args: Record<string, unknown>) => Promise<unknown>
  /** `$.ui.invalidate('ui.render')`. */
  redraw: () => void
  /** `$.ui.toast`. */
  toast: (text: string) => void
  /** `$.ui.status`: the plugin's one line under the prompt; undefined removes it. */
  status: (text: string | undefined) => void
  /** The mark above the prompt is brought up to date with what Scribe is at. It only shows, and never fails. */
  mark: () => void
  /** A line for the debug log alone. Counts and fixed words; never anything a person or a record wrote. */
  debug: (text: string) => void
  /** Notes one event of the plugin's own working (`telemetry.ts`): numbers, flags and words of fixed lists. Never fails, never waited for. */
  report: Report
  /** `$.prompt.read`: the text in the prompt box. */
  box: () => Promise<string>
  /** `$.prompt.fill`: puts `text` in the prompt box and sends nothing; whether the box took it. */
  fill: (text: string) => Promise<boolean>
  /** `$.store.get`. */
  stored: (key: string) => Promise<unknown>
  /** `$.store.set`. */
  store: (key: string, value: unknown) => Promise<void>
  /** `$.store.delete`. */
  unstore: (key: string) => Promise<void>
  /** `$.store.keys`. */
  keys: () => Promise<string[]>
  /** `$.session.id`. */
  sessionId: () => Promise<string>
  /** `$.session.repo`. */
  repo: () => Promise<{ root: string; remote: string | null } | null>
  /** `$.session.cwd`. */
  cwd: () => Promise<string>
  /** Whether a file or folder is at `path` (`$.fs.stat`). */
  exists: (path: string) => Promise<boolean>
  /**
   * `$.fs.read`: a file's text; rejects when it cannot be read. Used for one
   * thing: the files git keeps about a repository, to read its name.
   */
  read: (path: string) => Promise<string>
  /**
   * Whether no `.mcp.json` from `root` upward holds an entry that could
   * stand in for the plugin's server (see `project.ts`). Asked of a working
   * tree other than the session's own before anything about it is sent.
   */
  vouched: (root: string) => Promise<boolean>
  /** `$.session.surfaces`. */
  surfaces: () => Promise<readonly string[]>
  /**
   * `$.process.run`, with no shell. Used for one thing: git, asked which
   * commit a working tree is at and whether a decision's files are changed
   * there, before the decision is written (`base.ts`).
   */
  run: Run
  /** `$.session.messages`: the main conversation's rows. */
  rows: () => Promise<readonly Row[]>
  /** The team, person and profile the connection writes to, in words; undefined while not known. */
  destination: () => string | undefined
}

/**
 * The session as Fylgja is told of it. A session started in a folder that
 * is no repository has none of its own: its root is that folder, and what
 * it records is filed under the repositories its files lie in.
 */
type Identity = { sessionId: string; repo: string | null; root: string }

/** A working tree on this machine: where it begins, and the repository it is a checkout of, as `owner/name`. */
type Tree = { root: string; repo: string }

/** A commit made in the session's own repository: its sha, the files it holds as paths from that repository's root, and the rule they were reported by. */
type Commit = { sha: string; paths: string[]; rule: Word<'commit', 'rule'> }

/** A recorded decision whose code changed, waiting its turn; `asks` is false once another of its batch was asked about. */
type Doubted = { fact: Fact; repo: string; asks: boolean }

/** Something to do on Fylgja that could not be done when it was asked for, kept for the next turn. */
type Deferred = ({ tool: string; args: Record<string, unknown> } | { draft: Draft; against?: string }) & {
  /** The turn it was put off in, when it is not to be done before a later one ends. */
  notIn?: number
}

export type Options = { isOn: boolean }

/**
 * The model Scribe thinks with. One model, not a choice: the smaller one was
 * tried on the same scripted sessions and stayed silent where a decision came
 * without a reason, which is the very thing Scribe is there to catch.
 */
export const MODEL = 'sonnet'

export type Scribe = {
  options: Options
  /** The model asked; `MODEL` everywhere but in a run that compares models. */
  model: string
  /** Whether a person is at a prompt Scribe can draw above. */
  isInteractive: boolean
  /** Undefined until asked for; null when Scribe is off for this session. */
  identity: Identity | null | undefined
  band: Band.Band
  /** The window of what was kept: whether it is open, what is selected in it, and what was removed and can be put back. */
  ledger: Ledger.Ledger
  /** The counts of the session a conversation started over in, to pick up again if it is the same session. */
  carry: { sessionId: string; tally: Band.Tally } | undefined
  plans: Plans.Plans
  /** The prompts the developer sent, as `plain` leaves them: what tells their words from every other row. */
  prompts: Set<string>
  /** Whether the developer has sent a prompt since Scribe last came to a verdict, at a turn's end or inside one. */
  hasPrompt: boolean
  /** How many rows of the conversation a wake has been through; -1 when not known. */
  consumed: number
  /** The last row a wake went through, so rows that were rewritten under it are noticed. */
  mark: string | undefined
  /**
   * The rows a compaction took out of the conversation before any look had
   * been through them, oldest first: the next look reads them ahead of the
   * rows it finds. At most `MAX_HELD`, the newest.
   */
  held: readonly Row[]
  /** How many times the conversation was compacted: a look that was under way across one knows by it. */
  compactions: number
  /** Whether this conversation has been compacted: only then is there anything to carry over. */
  hasCompacted: boolean
  /**
   * The rows the last compaction left, each as its mark, in order, until a
   * look has been through them: what the rows that came after are told
   * from, however many rows the engine has put among them.
   */
  seam: readonly string[] | undefined
  /** The records the context last listed for Claude, each with the words it was quoted in; undefined when it listed none. */
  noted: readonly [string, string][] | undefined
  /** When the wake under way began; 0 with none under way. */
  wakingSince: number
  /** When each wake of the last hour began. */
  wakeTimes: number[]
  /** The earlier wakes, each the block it stays, and how many were folded away before them. */
  past: Block[]
  folded: { wakes: number; block: Block | undefined }
  wakes: number
  written: Written[]
  /**
   * The ids of the records that are Scribe's own to rewrite, take back or
   * add places to: written by it as new in this session, and not touched by
   * the developer since. One that came back from having been removed, one
   * that was already held, and one the developer fixed, answered about, put
   * back or removed with a key is never among them.
   */
  mine: Set<string>
  /** What was recorded, for the model not to repeat; one with an id is Scribe's own to rewrite or take back. */
  recorded: { id: string | null; content: string }[]
  /** The sentences asked about. */
  asked: string[]
  /** Files waiting to be looked up, each with the repository it lies in. */
  paths: Place[]
  /** Every file the session touched, as its repository and its path there: looked up once. */
  lookedUp: Set<string>
  /**
   * Where each file the session touched lies, by the path a tool line
   * writes for it and by its full path: what a record may be anchored to,
   * and under which repository it is then filed.
   */
  places: Map<string, Place>
  /** How many files the session has touched in each repository, for a turn that touches none itself. */
  filesIn: Map<string, number>
  /** The working tree each folder seen so far lies in; null for a folder in none. */
  trees: Map<string, Tree | null>
  /**
   * What git said of the files of `places`, by `stateKey`: a file it ignores
   * and a document it was never given are no anchors. A file is asked about
   * once; an untracked document again, since it may be added.
   */
  gitStates: Map<string, GitState>
  /** What the developer has stated in the session so far: reasons, constraints, standing preferences. */
  stated: string[]
  /** Records that were not written because the turn touched no file of any repository. */
  unplaced: number
  /**
   * Everything the developer wrote in the session, prompt by prompt, oldest
   * first: where a reason is looked for before anybody is asked for it. Held
   * in the running plugin only.
   */
  spoken: string[]
  /** How many of the oldest prompts were let go to keep that within its length. */
  unspoken: number
  /** What the developer decided without typing a prompt, each once: a turn's rows are read again until a wake has been through them. */
  acted: Set<string>
  /** Whether they decided something since Scribe last came to a verdict. */
  hasActed: boolean
  /**
   * Whether a step of the turn in hand put a question to the developer whose
   * answer has not been seen in the rows yet.
   */
  isAsking: boolean
  /**
   * Whether a look inside the turn in hand came to a verdict. The developer
   * answered a question in that turn, so it is theirs, and what came after
   * the answer is looked at when the turn ends.
   */
  hasAnsweredInTurn: boolean
  /** The look under way and those waiting behind it, as one; null with none. One look runs at a time. */
  looking: Promise<void> | null
  /** Stops the looks begun inside the turn in hand, when the turn ends; null with none begun. */
  cut: AbortController | null
  /**
   * Whether a look inside the turn in hand put a question to the developer.
   * It is that turn's one question: the look at its end asks none.
   */
  hasAskedInside: boolean
  /**
   * What the assistant wrote in the turn in hand and in the one before, for
   * one purpose: a reason it gave for something it proposed, which the
   * developer then accepted, is looked for here.
   */
  proposals: Proposal[]
  /** What it wrote in the turn before, kept until the next wake. */
  earlier: Proposal[]
  /** The words of the questions the developer was asked and of the option labels: never a reason for anything. */
  offered: string[]
  /**
   * The questions the developer answered by picking an option, with what
   * the assistant said the picked options mean: the assistant's text, kept
   * apart from the developer's words.
   */
  offers: Offer[]
  /** The repositories in which the session wrote or changed a file: only these, and its own, are asked what they hold. */
  editedRepos: Set<string>
  /**
   * The files written or changed in each repository since its last commit,
   * by the main conversation or by an agent of the session, each as a tool
   * line writes it: what a commit there holds.
   */
  edited: Map<string, Set<string>>
  /**
   * Every file the session wrote, changed or committed, by `stateKey`: the
   * only files a later anchor may be. One it merely read is not where a
   * decision was carried out.
   */
  changedPlaces: Set<string>
  /** Commits made since the last look, each with the files it holds: asked about once, at the next look. */
  commitsToPair: { repo: string; files: string[] }[]
  /** The repository an agent of the session last changed a file in: where a commit it makes belongs. */
  agentRepo: string | null
  /** How many pairings of a record with files the model proposed, before any was checked. */
  lateProposed: number
  /** How many places were added later to records written before the code they concern existed. */
  lateAnchors: number
  /** How many times a new decision was compared with records on its subject, and how often it went against one. */
  compared: number
  opposed: number
  /** How many times a decision without a reason was checked against what the developer wrote, and how often a reason was there. */
  checked: number
  found: number
  /** The records the lookups found since the last wake. */
  anchored: Map<string, Fact>
  deferred: Deferred[]
  /** Commits already seen in the rows: each is attached once. */
  commits: Set<string>
  /**
   * Commits seen in the rows and not yet attached, oldest first, each with
   * the files it holds as paths from its repository's root. The look that
   * sees a commit may end before it attaches it; whichever look comes next
   * does.
   */
  toAttach: Commit[]
  /** Whether Fylgja's server takes the files of a commit: true until it turned a commit down for them. */
  takesPaths: boolean
  /** Whether Fylgja's server takes the commit a decision was written at: true until it turned a write down for it. */
  takesBase: boolean
  /**
   * Recorded decisions whose code a commit changed after they were last
   * confirmed, not yet asked about: one of them is asked about when a look
   * ends, and the others are told like any other record.
   */
  doubted: Doubted[]
  /**
   * Recorded decisions the developer said no longer hold, by id, each with
   * its one sentence, its day, and the wake it was said before: shown to
   * the next `DENIED_WAKES` looks as given up, or until the decision that
   * takes its place is put to the developer as its replacement. Kept
   * through a compaction and let go on a `/clear`; nothing of it is written
   * to Fylgja.
   */
  denied: Map<string, { content: string; date: string | null; since: number }>
  /**
   * What the shell commands of the session since its last commit say of the
   * commit to come, and where they left the shell: carried from look to
   * look, so that a commit is read with what was staged turns before it.
   */
  index: Index
  /** The files the session created since its last commit, as absolute paths: staging what git tracks does not take them. */
  created: Set<string>
  /**
   * The ids of the records Fylgja attached a commit of this session to: the
   * session's own, Scribe's and Claude's alike. None of them is asked about.
   */
  own: Set<string>
  /** Whether a call of Scribe's own has got through to Fylgja in this session. */
  isGranted: boolean
  /** Whether Fylgja has been asked at all in this session, got through or not. */
  hasAsked: boolean
  /** Things said once: in the debug log, or on the status line. */
  said: Set<string>
  /** Counts the times the session started over; an answer from before is dropped. */
  epoch: number
  /** Counts the turns that ended. */
  turn: number
  /** Writes Fylgja refused or that failed. */
  refused: number
  /** Records Fylgja took as sent, new or already held. */
  wrote: number
  /** The code of the first write Fylgja refused since this was last cleared; `none` for one refused with no code. */
  refusedBy: string | undefined
  /** Whether what is being done now was put off from an earlier turn and is tried again. */
  isRetrying: boolean
  /** Records handed back to the model once to be put right, and those lost for good after a refusal. */
  corrections: number
  dropped: number
  /** Those lost for good, by the rule Fylgja refused them by: said in the window of what was kept, and nowhere else. */
  lost: Map<string, number>
  /**
   * The conversation the plugin was loaded for: the one whose records an
   * earlier load kept are picked up again (see `recover`). Undefined until
   * the session starts, and when its id cannot be read.
   */
  loadedFor: string | undefined
  /** Whether those records are still to be picked up in the conversation in hand, are being, or need not be. */
  recovery: 'pending' | 'running' | 'done'
  /** The records an earlier load kept that wait to be listed again; undefined until they are looked for. */
  waiting: SavedRecord[] | undefined
  /** The conversation those records were kept under: this one's own, or one it went on from, until this one's own is written. */
  waitingFrom: string | undefined
  /** How many turns had ended when the plugin was loaded. */
  loadedAt: number
  /** Records the plugin itself did not write (`letGo`), and why the first since this was last cleared was not. */
  letGo: number
  letGoBy: DropReason | undefined
}

/** Why the plugin itself did not write a record: one word of the report's fixed list. */
export type DropReason = (typeof SCHEMA.events.look.first_drop_reason.oneOf)[number]

/** The keys kept on this machine. */
export const STORE = {
  off: 'scribe.off',
  known: 'scribe.known',
  typedPast: 'scribe.typedPast',
  skip: 'scribe.skip',
  hasShown: 'scribe.hasShown',
  /** The index of the conversations whose records are kept, each under `PREFIX` and its id (`saved.ts`). */
  lists: INDEX,
} as const

/** No more records are asked of Fylgja at once when an earlier load's are picked up: they share the session's allowance of calls. */
const OPEN_WIDTH = 4

/** How long a turn's end waits for them before it looks. */
const RECOVER_WAIT_MS = 1500

/** A receipt nobody touched goes after this long. */
export const RECEIPT_MS = 20_000

/** A lookup by path holds a turn no longer than this; its answer is still used when it comes later. */
export const LOOKUP_WAIT_MS = 1500

/** Paths are looked up on every this-many-th step of a turn, and at its end. */
export const LOOKUP_EVERY = 4

/** No more wakes than this begin in any one hour; past it Scribe is quiet until the hour has rolled on. */
export const MAX_WAKES_PER_HOUR = 30

/**
 * A turn that changed no file and in which the developer and Claude wrote
 * fewer characters than this between them is not worth a model call. Its
 * rows are read with the next turn's.
 */
export const QUIET_TURN_CHARS = 200

/** No more earlier wakes are sent again than this; older ones are folded into one line. */
export const MAX_PAST = 4

/** No more of one earlier wake is sent again than this: what the developer and Claude said, without the tool calls. */
export const MAX_PAST_CHARS = 1200

/** No more things the developer stated are kept for a session than this; the oldest go first. */
export const MAX_STATED = 20

/** No more of what the developer wrote is kept for a session than this, in characters; the oldest prompts go first. */
export const MAX_SPOKEN_CHARS = 30_000

/** No more files of one commit are listed to a look than this. */
const MAX_COMMIT_FILES = 60

/** No more files are sent to Fylgja with one commit than this: as many as its server matches of one call. */
export const MAX_COMMIT_PATHS = 200

/** No more records whose code changed wait to be asked about than this; the oldest are let go. */
const MAX_DOUBTED = 5

/** No more records the developer said no longer hold are kept for the looks to come than this; the oldest are let go. */
const MAX_DENIED = 5

/** A record the developer said no longer holds is shown to this many looks: what takes its place is said soon after, or not at all. */
export const DENIED_WAKES = 3

/** The most records Fylgja returns for one lookup by path, asked for where one particular record is looked for. */
const MOST_RECALLED = 25

/** No more ids of the session's own records are kept than this. */
const MAX_OWN = 500

/** No more questions and option names are kept for telling a reason from an echo of the question. */
const MAX_OFFERED = 80

/** No more answered questions are kept with what their picked options were said to mean. */
const MAX_OFFERS = 12

/**
 * Finding out which repository a step's files lie in holds the turn no
 * longer than this. It reads the disk (folders upward, git's settings, a
 * `.mcp.json`), and a mount that has gone away answers nothing: past the
 * bound the step's files count as lying in no repository.
 */
export const PLACE_WAIT_MS = 400

/** No more records on a decision's subject are compared with it than this. */
const MAX_COMPARED = 5

/** No more of the assistant's replies are handed to the look for a reason than this, and no more of each. */
const MAX_PROPOSALS = 6
const MAX_PROPOSAL_CHARS = 2500

/** One lookup of files asks about no more repositories than this; the rest wait for the next. */
const MAX_LOOKUP_REPOS = 3

/** What the status line says, until the next prompt, when Scribe's calls are not let through. */
export const OFF_STATUS = 'Scribe is off in this session: its calls to Fylgja are not let through here'

const HOUR_MS = 3_600_000
const MAX_LOOKUP_PATHS = 30
const MAX_DEFERRED = 10
const MAX_LISTED = 40
const MAX_PROMPTS = 100
/** How many rows a compaction took away unread are held for the next look: far more than a turn has. */
export const MAX_HELD = 600
/** Said in the debug log when rows held for the next look were let go for their number; the count follows. */
export const HELD_DROPPED = 'Scribe: rows compacted away before it looked at them were let go for their number, none of them written or chosen by the developer:'
const FLUSH_BUDGET_MS = 20_000
const PROBE = 'README.md'

export function create(options: Options): Scribe {
  return {
    options,
    model: MODEL,
    isInteractive: false,
    identity: undefined,
    band: Band.create(),
    ledger: Ledger.create(),
    carry: undefined,
    plans: Plans.create(),
    prompts: new Set(),
    hasPrompt: false,
    consumed: -1,
    mark: undefined,
    held: [],
    compactions: 0,
    hasCompacted: false,
    seam: undefined,
    noted: undefined,
    wakingSince: 0,
    wakeTimes: [],
    past: [],
    folded: { wakes: 0, block: undefined },
    wakes: 0,
    written: [],
    mine: new Set(),
    recorded: [],
    asked: [],
    paths: [],
    lookedUp: new Set(),
    places: new Map(),
    filesIn: new Map(),
    trees: new Map(),
    gitStates: new Map(),
    stated: [],
    unplaced: 0,
    spoken: [],
    unspoken: 0,
    acted: new Set(),
    hasActed: false,
    isAsking: false,
    hasAnsweredInTurn: false,
    looking: null,
    cut: null,
    hasAskedInside: false,
    proposals: [],
    earlier: [],
    offered: [],
    offers: [],
    editedRepos: new Set(),
    edited: new Map(),
    changedPlaces: new Set(),
    commitsToPair: [],
    agentRepo: null,
    lateProposed: 0,
    lateAnchors: 0,
    compared: 0,
    opposed: 0,
    checked: 0,
    found: 0,
    anchored: new Map(),
    deferred: [],
    commits: new Set(),
    toAttach: [],
    takesPaths: true,
    takesBase: true,
    doubted: [],
    denied: new Map(),
    index: cleared(false),
    created: new Set(),
    own: new Set(),
    isGranted: false,
    hasAsked: false,
    said: new Set(),
    epoch: 0,
    turn: 0,
    refused: 0,
    wrote: 0,
    refusedBy: undefined,
    isRetrying: false,
    corrections: 0,
    dropped: 0,
    lost: new Map(),
    loadedFor: undefined,
    recovery: 'done',
    waiting: undefined,
    waitingFrom: undefined,
    loadedAt: 0,
    letGo: 0,
    letGoBy: undefined,
  }
}

/**
 * The conversation started over (`/clear`, a resume, a fork): nothing of the
 * one before is held, and who the session is, is asked again, because its id
 * may be another now. What is kept on the machine stays, and so do the
 * session's counts if it turns out to be the same session.
 *
 * The records Scribe kept go with the rest. A developer who cleared the
 * conversation meant to, and a resumed or branched one lists its own: no
 * word of a record is ever stored, and they are in Fylgja all the same.
 * Only where the conversation goes on under the id the plugin was loaded
 * for are the ids an earlier load kept looked for again (`recover`). A
 * compaction is not such a start; see `compacted`.
 */
export function startOver(scribe: Scribe): void {
  const { kept } = scribe.band

  if (scribe.identity !== null && scribe.identity !== undefined) {
    scribe.carry = { sessionId: scribe.identity.sessionId, tally: Band.tallyOf(scribe.band) }
  }

  scribe.epoch += 1
  scribe.recovery = 'pending'
  scribe.waiting = undefined
  scribe.waitingFrom = undefined
  scribe.identity = undefined
  scribe.band = { ...Band.create(), kept }
  // The records it listed were the conversation's before. Whether it is open is Claude Code's to say, and is not changed here.
  scribe.ledger = { ...Ledger.create(), isOpen: scribe.ledger.isOpen }
  scribe.plans = Plans.create()
  scribe.prompts.clear()
  scribe.hasPrompt = false
  scribe.consumed = -1
  scribe.mark = undefined
  scribe.held = []
  scribe.hasCompacted = false
  scribe.seam = undefined
  scribe.wakingSince = 0
  scribe.past = []
  scribe.folded = { wakes: 0, block: undefined }
  scribe.written = []
  scribe.mine.clear()
  scribe.recorded = []
  scribe.asked = []
  scribe.paths = []
  scribe.lookedUp.clear()
  scribe.places.clear()
  scribe.gitStates.clear()
  scribe.filesIn.clear()
  scribe.stated = []
  scribe.spoken = []
  scribe.unspoken = 0
  scribe.acted.clear()
  scribe.hasActed = false
  scribe.isAsking = false
  scribe.hasAnsweredInTurn = false
  scribe.cut?.abort()
  scribe.cut = null
  scribe.hasAskedInside = false
  scribe.offered = []
  scribe.offers = []
  scribe.editedRepos.clear()
  scribe.edited.clear()
  scribe.changedPlaces.clear()
  scribe.commitsToPair = []
  scribe.agentRepo = null
  scribe.proposals = []
  scribe.earlier = []
  scribe.anchored.clear()
  scribe.doubted = []
  // The developer cleared the conversation on purpose: what they said of a record in it goes with it.
  scribe.denied.clear()
  scribe.deferred = []
}

/**
 * What the mark above the prompt may say of Scribe: whether a look is under
 * way, and how many records it wrote in this session still stand. Undefined
 * while Scribe does not run in this conversation.
 */
export function doing(scribe: Scribe): Doing | undefined {
  return scribe.identity === null || scribe.identity === undefined
    ? undefined
    : { isReading: scribe.wakingSince !== 0, kept: scribe.written.length }
}

/** Whether Scribe is known not to run in this conversation: switched off, or its session not one it works in. */
export function isOff(scribe: Scribe): boolean {
  return scribe.identity === null || !scribe.options.isOn
}

/** A session began: whether a person is at it, and whether it draws where the band is. */
export function started(scribe: Scribe, isInteractive: boolean, surface: string | null): void {
  startOver(scribe)
  scribe.carry = undefined
  scribe.isGranted = false
  scribe.hasAsked = false
  scribe.takesPaths = true
  scribe.takesBase = true
  scribe.index = cleared(false)
  scribe.created.clear()
  scribe.own.clear()
  scribe.isInteractive = isInteractive && (surface === 'terminal' || surface === 'desktop')
}

/**
 * The plugin was loaded for the conversation `id`: on the session's start,
 * which is also how Claude Code starts a plugin again whose copy it lost
 * and how a conversation moved to the background goes on. What an earlier
 * load kept for it is picked up by `recover`.
 */
export function loaded(scribe: Scribe, id: string | undefined): void {
  scribe.loadedFor = id
  scribe.loadedAt = scribe.turn
}

/**
 * The conversation went on under the id `id` before any turn ended since the
 * plugin was loaded, and was started over for it. Where Claude Code reads
 * out the id of the conversation a background job resumed before the job's
 * own, that is still the conversation the plugin was loaded for: its records
 * are looked for again under the id it goes on with, by its rows. A
 * `/clear` has none of the rows before, so nothing is found for it.
 */
export function followed(scribe: Scribe, id: string): void {
  if (scribe.loadedFor !== undefined && scribe.turn === scribe.loadedAt) {
    scribe.loadedFor = id
  }
}

/**
 * Writes which records this conversation kept, as `saved.ts` keeps them:
 * their ids and fixed words, under a key of the conversation's own, with
 * the marks of its rows. Those an earlier load kept that are not listed yet
 * stay with them, whatever kept them from being listed. The rows are read
 * first, so that the conversation's own entry is read and written with
 * nothing between. Not waited for, and never fails.
 */
function save(host: ScribeHost, scribe: Scribe): void {
  const who = scribe.identity
  const key = who === null || who === undefined ? undefined : keyOf(who.sessionId)

  if (who === null || who === undefined || key === undefined) {
    return
  }

  const { epoch } = scribe
  const write = async (): Promise<void> => {
    const marks = marksOf(await host.rows().catch(() => []))
    // What waits was kept under another conversation, and this one's own is not written yet by this load.
    const isTheirs = scribe.waitingFrom !== undefined && scribe.waitingFrom !== who.sessionId
    // Not looked for yet, or found elsewhere: what the store holds for this conversation is read, with nothing between it and the write.
    const own = (scribe.waiting === undefined && scribe.recovery !== 'done') || isTheirs ? savedOf(await host.stored(key)) : undefined

    if (epoch !== scribe.epoch) {
      return
    }

    const now: SavedRecord[] = scribe.written.map(one => ({
      id: one.id,
      kind: one.kind,
      outcome: one.outcome,
      ...(isWaiting(one) ? { waiting: true as const } : {}),
    }))
    // The list of a conversation it went on from never takes the place of one this conversation already has.
    const base = isTheirs && own !== undefined ? own.records : (scribe.waiting ?? own?.records ?? [])
    const waiting = base.filter(one => !now.some(record => record.id === one.id))
    const records = [...waiting, ...now].slice(-MAX_RECORDS)

    if (records.length === 0) {
      await host.unstore(key)

      return
    }

    await host.store(key, { id: who.sessionId, at: await host.now(), ...marks, records })

    if (epoch === scribe.epoch) {
      scribe.waitingFrom = who.sessionId
    }

    // The oldest are let go. Another session may write the index meanwhile: then only its pruning is lost.
    const { index, dropped } = indexed(indexOf(await host.stored(INDEX)), who.sessionId)

    await host.store(INDEX, index)
    await Promise.all(dropped.flatMap(id => keyOf(id) ?? []).map(one => host.unstore(one)))
    await pruned(host, key)
  }

  void write().catch(() => undefined)
}

/** Runs `work` on each of `items`, no more than `width` at a time; the results in order. */
async function pooled<T, R>(items: readonly T[], width: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let next = 0
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const at = next

      next += 1
      results[at] = await work(items[at] as T)
    }
  }

  await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane))

  return results
}

/**
 * Lets go of the conversations past the newest `MAX_SAVED` by when they were
 * written, among them any the index lost, never the one just written. Read
 * only when there are more keys than that.
 */
async function pruned(host: ScribeHost, mine: string): Promise<void> {
  const keys = (await host.keys()).filter(key => key.startsWith(PREFIX))

  if (keys.length <= MAX_SAVED) {
    return
  }

  const all = await Promise.all(keys.map(async key => ({ key, at: savedOf(await host.stored(key))?.at ?? 0 })))
  const old = all
    .filter(one => one.key !== mine)
    .sort((one, two) => two.at - one.at)
    .slice(MAX_SAVED - 1)

  await Promise.all(old.map(one => host.unstore(one.key)))
}

/** The conversations kept on this machine, read from their own keys: those the index lists first, newest first, then any it lost. */
async function savedAll(host: ScribeHost): Promise<Saved[]> {
  const listed = indexOf(await host.stored(INDEX)).flatMap(id => keyOf(id) ?? []).toReversed()
  const keys = [...new Set([...listed, ...(await host.keys()).filter(key => key.startsWith(PREFIX)).toReversed()])]

  return (await Promise.all(keys.slice(0, MAX_READ).map(async key => savedOf(await host.stored(key))))).flatMap(one => one ?? [])
}

/**
 * Picks up the records an earlier load of the plugin kept in this
 * conversation, when the plugin was loaded afresh for it: Claude Code
 * started a plugin again whose copy it lost, or the conversation was moved
 * to the background and goes on in a job of its own. They are found by the
 * conversation's id, or by the rows of the nearest one it went on from
 * (`saved.ts`), and asked of Fylgja, `OPEN_WIDTH` at a time; only a record
 * Fylgja says is not there is let go. They are listed before the ones
 * written since, and none of them is Scribe's own to rewrite or take back.
 * Any other answer, or a call that did not get through, leaves that record
 * waiting, and kept on this machine, for the next try: the session's start,
 * the window opened, a turn's end. Never fails.
 */
export async function recover(host: ScribeHost, scribe: Scribe): Promise<void> {
  if (scribe.recovery !== 'pending') {
    return
  }

  const { epoch } = scribe
  let state: 'pending' | 'done' = 'done'

  scribe.recovery = 'running'

  try {
    if (isOff(scribe) || !scribe.isInteractive || scribe.loadedFor === undefined || (await host.sessionId()) !== scribe.loadedFor) {
      return
    }

    const rows = await host.rows()

    // A conversation with no rows yet has kept nothing; one whose rows are not read yet is looked at again later.
    if (rows.length === 0) {
      state = 'pending'

      return
    }

    const held = new Set([...scribe.written, ...scribe.ledger.gone].map(one => one.id))
    const from = scribe.waiting === undefined ? nearest(await savedAll(host), scribe.loadedFor, rows) : undefined
    const wanted = scribe.waiting ?? (from?.records ?? []).filter(one => !held.has(one.id))

    if (epoch !== scribe.epoch) {
      return
    }

    scribe.waitingFrom ??= from?.id
    scribe.waiting = wanted

    if (wanted.length === 0) {
      return
    }

    const who = await identityOf(host, scribe)

    if (who === null || epoch !== scribe.epoch) {
      state = 'pending'

      return
    }

    // Each record comes back, is let go because Fylgja says it is not there, or waits.
    const back = await pooled(wanted, OPEN_WIDTH, async (one): Promise<Written | 'gone' | 'waits'> => {
      try {
        const { answer, refusal } = await tried(host, scribe, 'open', { ref: one.id })
        const detail = answer === undefined ? undefined : detailOf(answer, one.id)

        return detail !== undefined ? recordOf(one, detail) : answer === undefined && failureOf('open', refusal ?? '') === 'not_found' ? 'gone' : 'waits'
      } catch {
        return 'waits'
      }
    })

    if (epoch !== scribe.epoch) {
      return
    }

    const standing = new Set(scribe.written.map(one => one.id))
    const found = back.flatMap(one => (typeof one === 'string' || standing.has(one.id) ? [] : [one]))

    scribe.waiting = wanted.filter((_, at) => back[at] === 'waits')
    state = scribe.waiting.length > 0 ? 'pending' : 'done'
    scribe.written = [...found, ...scribe.written].slice(-MAX_LISTED)
    // Said already: the model is not to write them again.
    scribe.recorded = [...found.map(one => ({ id: null, content: one.content })), ...scribe.recorded].slice(-MAX_LISTED)

    if (found.length > 0) {
      host.mark()
      host.redraw()
    }
  } catch {
    state = 'pending'
  } finally {
    if (epoch === scribe.epoch) {
      scribe.recovery = state
    }
  }

  // Kept under this conversation's own id from here on, those still waiting with them, so a later load finds them by it.
  if (epoch === scribe.epoch && (scribe.waiting?.length ?? 0) + scribe.written.filter(one => one.isPartial === true).length > 0) {
    save(host, scribe)
  }
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

/**
 * Writes what is kept on this machine. The records marked as known are
 * added to what is there, never written over it: another session open on
 * the same machine may have marked its own since this one last read.
 */
function keep(host: ScribeHost, band: Band.Band): void {
  const { kept } = band
  const known = async (): Promise<void> => {
    const theirs = ids(await host.stored(STORE.known))

    kept.known = [...new Set([...theirs, ...kept.known])].slice(-Band.MAX_KNOWN)
    await host.store(STORE.known, kept.known)
  }

  // Not waited for: nothing that follows depends on it.
  void Promise.all([
    known(),
    host.store(STORE.typedPast, kept.typedPast),
    host.store(STORE.skip, kept.skip),
    host.store(STORE.hasShown, kept.hasShown),
  ]).catch(() => undefined)
}

/** The root of the working tree `cwd` is in: the nearest folder upward that holds a `.git`. */
async function treeOf(host: ScribeHost, cwd: string): Promise<string | undefined> {
  let folder = cwd.replace(/\/+$/, '')

  for (let level = 0; level < 40 && folder !== ''; level += 1) {
    if (await host.exists(`${folder}/.git`)) {
      return folder
    }

    folder = folder.slice(0, folder.lastIndexOf('/'))
  }

  return undefined
}

/** An absolute path without its `.` and `..` parts. */
function tidy(path: string): string {
  const parts: string[] = []

  for (const part of path.split('/')) {
    if (part === '..') {
      parts.pop()
    } else if (part !== '' && part !== '.') {
      parts.push(part)
    }
  }

  return `/${parts.join('/')}`
}

const REMOTE = /\[remote "origin"\][^[]*?\burl\s*=\s*(\S+)/

/**
 * The address of the `origin` of the repository whose working tree begins
 * at `root`, read from the files git keeps; null when it has none or they
 * cannot be read. A worktree's `.git` is a file naming its own folder inside
 * the repository it belongs to, and that repository's settings are read.
 */
async function remoteOf(host: ScribeHost, root: string): Promise<string | null> {
  const origin = (config: string): string | null => REMOTE.exec(config)?.[1] ?? null

  try {
    return origin(await host.read(`${root}/.git/config`))
  } catch {
    // Not a folder: a worktree, or a repository checked out inside another.
  }

  try {
    const named = /^gitdir:\s*(.+)$/m.exec(await host.read(`${root}/.git`))?.[1]?.trim() ?? ''
    const own = tidy(named.startsWith('/') ? named : `${root}/${named}`)

    if (!(await isOwnGitDir(host, root, own))) {
      return null
    }

    // A worktree's folder names the repository's own; anything else it names is not followed.
    const common = await host.read(`${own}/commondir`).then(
      text => tidy(text.trim().startsWith('/') ? text.trim() : `${own}/${text.trim()}`),
      () => own,
    )

    return origin(await host.read(`${common === own || own.startsWith(`${common}/`) ? common : own}/config`))
  } catch {
    return null
  }
}

/**
 * Whether the folder a `.git` file names is really this working tree's own.
 * The file is the checkout's to write, and a hostile one could name any
 * folder on the machine to have its `config` read. It is followed in three
 * cases only:
 * - it lies inside the working tree itself;
 * - it is a submodule's: `<above>/.git/modules/…`, where `<above>` is a
 *   folder the working tree lies in;
 * - it is a worktree's: `<repository>/.git/worktrees/<name>`, and that
 *   folder's own `gitdir` file, which git writes there and the checkout
 *   cannot, names this working tree's `.git` back.
 */
async function isOwnGitDir(host: ScribeHost, root: string, own: string): Promise<boolean> {
  if (own.startsWith(`${root}/`)) {
    return true
  }

  const above = /^(.*)\/\.git\/modules\//.exec(own)?.[1]

  if (above !== undefined && root.startsWith(`${above}/`)) {
    return true
  }

  if (!/\/\.git\/worktrees\/[^/]+$/.test(own)) {
    return false
  }

  const back = await host.read(`${own}/gitdir`).then(
    text => tidy(text.trim()),
    () => undefined,
  )

  return back === `${root}/.git`
}

/**
 * The working tree `folder` lies in: the nearest folder upward that holds a
 * `.git`, and the repository it is a checkout of. So a repository checked
 * out inside another, a worktree and a checkout beside the session's own are
 * each their own. Asked of the machine once per folder.
 */
async function treeAt(host: ScribeHost, scribe: Scribe, who: Identity, folder: string): Promise<Tree | null> {
  const walked: string[] = []
  let tree: Tree | null = null
  let at = folder.replace(/\/+$/, '')

  for (let level = 0; level < 40 && at !== ''; level += 1) {
    const known = scribe.trees.get(at)

    if (known !== undefined) {
      tree = known
      break
    }

    walked.push(at)

    if (await host.exists(`${at}/.git`).catch(() => false)) {
      // The session's own tree is named as the session names it.
      const repo = at === who.root && who.repo !== null ? who.repo : repoNameOf(await remoteOf(host, at), at)
      // The session's own tree was looked at when the session started. Any
      // other is looked at here, before anything about it is sent: a
      // repository whose own `.mcp.json` could stand in for the plugin's
      // server is left alone, as if its files lay in no repository.
      const isVouched = at === who.root || (await host.vouched(at).catch(() => false))

      tree = repo === undefined || !isVouched ? null : { root: at, repo }
      break
    }

    at = at.slice(0, at.lastIndexOf('/'))
  }

  for (const one of walked) {
    scribe.trees.set(one, tree)
  }

  return tree
}

/**
 * Where each of `files` lies: its repository and its path from that
 * repository's root. A file in no repository has no place. Each place is
 * kept under the two ways a tool line may write the file: from the root of
 * the session's own tree, and in full.
 *
 * @param files absolute paths
 */
async function placesOf(host: ScribeHost, scribe: Scribe, who: Identity, files: readonly string[]): Promise<Place[]> {
  const places: Place[] = []

  for (const file of files.slice(0, MAX_PLACED)) {
    let place = scribe.places.get(file)

    if (place === undefined) {
      const tree = await treeAt(host, scribe, who, file.slice(0, file.lastIndexOf('/')))
      const path = tree === null ? undefined : relativeTo(tree.root, file)

      if (tree === null || path === undefined) {
        continue
      }

      place = { repo: tree.repo, path }
      scribe.places.set(file, place)
      scribe.filesIn.set(place.repo, (scribe.filesIn.get(place.repo) ?? 0) + 1)

      const fromHere = relativeTo(who.root, file)

      if (fromHere !== undefined) {
        scribe.places.set(fromHere, place)
      }
    }

    places.push(place)
  }

  return places
}

/** No more files of one turn are placed than this. */
const MAX_PLACED = 200

/** The repository most of `places` lie in, the session's own winning a tie; null with none. */
function homeOf(places: readonly Place[], own: string | null): string | null {
  const counts = new Map<string, number>()

  for (const place of places) {
    counts.set(place.repo, (counts.get(place.repo) ?? 0) + 1)
  }

  let home: string | null = null

  for (const [repo, count] of counts) {
    const most = home === null ? 0 : (counts.get(home) ?? 0)

    if (count > most || (count === most && repo === own)) {
      home = repo
    }
  }

  return home
}

/**
 * Who Scribe is working for in this conversation, or null when it is off:
 * by its option or its switch, with nobody at the prompt, where the band is
 * not drawn, or outside a repository. Asked once per conversation.
 */
async function identityOf(host: ScribeHost, scribe: Scribe): Promise<Identity | null> {
  if (scribe.identity !== undefined) {
    return scribe.identity
  }

  scribe.identity = null

  if (!scribe.options.isOn || !scribe.isInteractive) {
    return null
  }

  const surfaces = await host.surfaces()

  if (!surfaces.includes('terminal') && !surfaces.includes('desktop')) {
    return null
  }

  if ((await host.stored(STORE.off)) === true) {
    return null
  }

  const repo = await host.repo()
  const cwd = await host.cwd()
  // In a repository the session is that repository's. In a folder that is
  // none (one that holds several checkouts, say) it has no repository of
  // its own and still follows the work into the ones its files lie in.
  const root = repo === null ? cwd.replace(/\/+$/, '') : await treeOf(host, cwd)
  const name = repo === null ? null : repoNameOf(repo.remote, repo.root)

  if (root === undefined || root === '' || name === undefined) {
    return null
  }

  const [known, typedPast, skip, hasShown] = await Promise.all([
    host.stored(STORE.known),
    host.stored(STORE.typedPast),
    host.stored(STORE.skip),
    host.stored(STORE.hasShown),
  ])
  const sessionId = await host.sessionId()
  const { band, carry } = scribe

  band.kept = {
    known: ids(known).slice(-Band.MAX_KNOWN),
    typedPast: typeof typedPast === 'number' && typedPast > 0 ? Math.floor(typedPast) : 0,
    skip: typeof skip === 'number' && skip > 0 ? Math.min(16, Math.floor(skip)) : 0,
    hasShown: hasShown === true,
  }

  // A `/clear`, a resume or a fork goes on under another session id, and
  // starts with no questions or tells. A start over under the same id (one
  // Claude Code raised before its id moved on) keeps the ones it has had.
  if (carry?.sessionId === sessionId) {
    Object.assign(band, carry.tally)
  } else if (carry !== undefined) {
    // Another session: which records were the session's own was said of the one before.
    scribe.own.clear()
  }

  scribe.carry = undefined
  scribe.identity = { sessionId, repo: name, root }

  return scribe.identity
}

/**
 * The name Fylgja's server is called under, or undefined when Scribe is not
 * to call it: not connected, connected through an entry that is not the
 * plugin's own (which the session decides, for the whole plugin), or not
 * saying in time.
 */
function connected(host: ScribeHost): Promise<string | undefined> {
  return limited(host.after, host.server(), CALL_TIMEOUT_MS).catch(() => undefined)
}

function once(scribe: Scribe, what: string): boolean {
  const isFirst = !scribe.said.has(what)

  scribe.said.add(what)

  return isFirst
}

// How many calls each host made that did not get to Fylgja, were not let
// through or were not answered in time. A host is one hook's, or one look's:
// what failed for a key press or a step's lookup is not counted against a look.
const MISSED = new WeakMap<ScribeHost, number>()

function missedBy(host: ScribeHost): number {
  return MISSED.get(host) ?? 0
}

/** What one call to Fylgja came to: its answer, or the server's own words for why it did not do it. */
type Tried = { answer: Record<string, unknown> | undefined; refusal: string | undefined }

/**
 * One tool call on Fylgja, waited for no longer than a fixed time. Rejects
 * when Fylgja is not connected, when the call is not let through, when it
 * fails to get there and when it does not answer in time. A call the server
 * itself turned down is no failure of the call: its words come back as the
 * refusal, to be read here and shown to nobody.
 */
async function tried(host: ScribeHost, scribe: Scribe, tool: string, args: Record<string, unknown>): Promise<Tried> {
  const began = performance.now()
  // What came of the call, in one word of a fixed list; none of what was sent or answered.
  const came = (outcome: Word<'call', 'outcome'>, refusal?: string): void => {
    const name = wordOf(SCHEMA.events.call.tool.oneOf, tool, undefined)

    if (name !== undefined) {
      host.report('call', {
        tool: name,
        outcome,
        duration_ms: performance.now() - began,
        is_retry: scribe.isRetrying,
        ...(outcome === 'refused' ? { refusal_code: refusalCodeOf(refusal) } : {}),
      })
    }
  }
  const server = await connected(host)

  if (server === undefined) {
    MISSED.set(host, missedBy(host) + 1)
    came('not_connected')

    throw new Error('Fylgja is not connected')
  }

  const result = await limited(host.after, host.call(server, tool, args), CALL_TIMEOUT_MS).catch((error: unknown) => {
    MISSED.set(host, missedBy(host) + 1)
    came(error instanceof TimedOut ? 'timed_out' : error instanceof Error && error.message === REFUSED ? 'not_let_through' : 'failed')

    // A call that is not let through, whichever it is, ends Scribe for
    // the session: it does not go on reading and asking a model for
    // records it may not write.
    if (error instanceof Error && error.message === REFUSED) {
      switchOff(host, scribe)
    }

    throw error
  })
  const answer = payloadOf(result)

  scribe.isGranted = true

  // Fylgja knows the repository under another spelling. Which repository
  // this is, is the session's to say, so nothing is switched; it is noted.
  if (knownReposIn(answer) > 0 && once(scribe, 'known-repos')) {
    host.debug(`Fylgja holds nothing under this repository's name and offers ${knownReposIn(answer)} it knows`)
    host.report('error', { component: 'scribe', kind: 'known_repos_offered' })
  }

  const blocks = isRecord(result) && result.isError === true && Array.isArray(result.content) ? result.content : []
  const words = blocks.map(block => (isRecord(block) && typeof block.text === 'string' ? block.text : '')).join('')

  if (answer === undefined) {
    came(failureOf(tool, words), words)
  } else {
    came(wordOf(SCHEMA.events.call.outcome.oneOf, answer.outcome, 'answered'))
  }

  return { answer, refusal: answer === undefined ? words : undefined }
}

/**
 * What kind of error answer a tool gave, read from the fixed words the
 * server opens each kind with and never from what follows them: a refusal
 * by a rule (`refused:<code>`), a call over its allowance, arguments the
 * tool does not take, a record that is not there, or a failure of the
 * server's own. Anything else is a refusal without a code.
 */
function failureOf(tool: string, words: string): Word<'call', 'outcome'> {
  const code = codeOf(words)

  if (code !== undefined) {
    return code === 'rate_limited' ? 'rate_limited' : code === 'not_found' ? 'not_found' : 'refused'
  }

  return words.startsWith('too many ')
    ? 'rate_limited'
    : words.startsWith(`${tool} was called with invalid arguments`)
      ? 'invalid_arguments'
      : words.startsWith('record not found')
        ? 'not_found'
        : words.startsWith('Error calling tool') || words.startsWith(`${tool} failed on the server`)
          ? 'server_fault'
          : 'refused'
}

/** The code a refusal opens with, as one of the listed ones: `other` for a code not listed, `none` for a refusal with no code. */
function refusalCodeOf(refusal: string | undefined): Word<'call', 'refusal_code'> {
  const code = codeOf(refusal)

  return code === undefined ? 'none' : wordOf(SCHEMA.events.call.refusal_code.oneOf, code, 'other')
}

/** One tool call on Fylgja, for its answer alone; see `tried`. */
async function call(
  host: ScribeHost,
  scribe: Scribe,
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  return (await tried(host, scribe, tool, args)).answer
}

const LINES: Readonly<Record<string, string>> = {
  atom_content_taken: 'Not saved: another record already says this.',
  atom_content_removed: 'Not saved: a record that was removed already holds this text.',
  edit_conflict: 'Not saved yet: the record was changed by someone else just now. It is tried once more after the next turn.',
  search_index_unavailable: 'Not saved yet: Fylgja could not reach its search index. It is tried once more after the next turn.',
  not_found: 'Not saved: the record is gone, or is not yours to change.',
}

/**
 * What the developer is told when Fylgja turned a change to a record down,
 * read from the code its refusal opens with: a short line of fixed words,
 * never the server's text. A refusal with no code, or one not known here, is
 * said as no more than that it was turned down.
 */
export function refusalLine(refusal: string): string {
  const code = codeOf(refusal)

  if (code === undefined) {
    return 'Not saved: Fylgja turned the change down.'
  }

  return Object.hasOwn(LINES, code)
    ? (LINES[code] ?? '')
    : teaches(code) === undefined
      ? 'Not saved: Fylgja turned the change down.'
      : `Not saved: Fylgja turned the new text down (${code}).`
}

/**
 * Scribe stops for the session: a call of its own was not let through. It
 * says so once, on the line under the prompt, and does nothing more.
 */
function switchOff(host: ScribeHost, scribe: Scribe): void {
  scribe.identity = null
  scribe.band = { ...Band.create(), kept: scribe.band.kept }
  scribe.deferred = []

  if (once(scribe, 'off')) {
    host.status(OFF_STATUS)
    host.debug('Scribe: its own call to Fylgja was refused; off for this session')
    host.report('error', { component: 'scribe', kind: 'not_let_through' })
  }

  host.redraw()
}

function defer(scribe: Scribe, work: Deferred): void {
  scribe.deferred = [...scribe.deferred, work].slice(-MAX_DEFERRED)
}

/**
 * A change to a record the developer asked for. Whether it was made.
 *
 * A change Fylgja turned down is said in one plain line and left at that.
 * One that did not reach Fylgja, or that it could not make for trouble of
 * its own, is tried once more at the end of the next turn, and never again.
 */
async function amend(host: ScribeHost, scribe: Scribe, args: Record<string, unknown>): Promise<boolean> {
  try {
    const { answer, refusal } = await tried(host, scribe, 'amend_memory', args)

    if (answer === undefined) {
      host.toast(refusalLine(refusal ?? ''))

      // The server's own trouble, not the change's: once more, later, as it is.
      if (PASSING.includes(codeOf(refusal) ?? '')) {
        defer(scribe, { tool: 'amend_memory', args })
      }
    }

    return answer !== undefined
  } catch {
    // Off for the session, nothing is kept to try again.
    if (scribe.identity !== null) {
      defer(scribe, { tool: 'amend_memory', args })
    }

    return false
  }
}

/**
 * The commit the working tree a decision's files lie in is at, and whether
 * one of those files is changed there; undefined for anything but a
 * decision about files, on a server that does not take it, and whenever git
 * does not say at once.
 */
async function baseFor(host: ScribeHost, scribe: Scribe, who: Identity, draft: Draft): Promise<Base | undefined> {
  if (!scribe.takesBase || draft.kind !== 'decision' || draft.anchors.length === 0 || draft.repo === null) {
    return undefined
  }

  const root = rootOf(scribe.places, draft.repo, draft.anchors, who)

  return root === undefined ? undefined : baseOf(host.run, host.after, root, draft.anchors.map(anchor => anchor.path))
}

/**
 * What sending one record came to: what was written, or the code Fylgja
 * refused it by and its words. `isTaken` says Fylgja took it, whether or not
 * anything new was written for it.
 */
type Sent = { written: Written | undefined; code: string | undefined; refusal: string | undefined; isTaken: boolean }

/**
 * Writes one record, once. What was written, or the code Fylgja refused it
 * by and its words. A refusal is counted.
 *
 * @param prior the recorded decision it replaces, when the developer said it does
 * @param recalled the id of the record this is, when the developer said a
 *   record Fylgja returned still holds: that record is confirmed again, and
 *   nothing new is written
 */
async function send(
  host: ScribeHost,
  scribe: Scribe,
  who: Identity,
  draft: Draft,
  prior?: Fact,
  recalled?: string,
): Promise<Sent> {
  const args: Record<string, unknown> = {
    content: draft.content,
    // The repository the record is about, which need not be the one the session sits in.
    repo: draft.repo,
    kind: draft.kind,
    author: 'scribe',
    session_id: who.sessionId,
    ...(draft.detail === '' ? {} : { detail: draft.detail }),
    ...(draft.anchors.length === 0 ? {} : { anchors: draft.anchors }),
    ...(draft.alternatives.length === 0 ? {} : { alternatives: draft.alternatives }),
    ...(draft.triggers.length === 0 ? {} : { triggers: draft.triggers }),
    ...(draft.reasonStatus === null ? {} : { reason_status: draft.reasonStatus }),
    ...(prior === undefined ? {} : { supersedes: prior.id }),
    ...(recalled === undefined ? {} : { recalled_atom_id: recalled }),
  }

  let answer: Record<string, unknown> | undefined
  let refusal: string | undefined
  // The commit the code is at goes with a new decision; a confirmation writes nothing new.
  const base = recalled === undefined ? await baseFor(host, scribe, who, draft) : undefined

  try {
    ;({ answer, refusal } = await tried(host, scribe, 'remember', base === undefined ? args : { ...args, ...base }))

    if (answer === undefined && base !== undefined && isUnknownBase(refusal ?? '')) {
      scribe.takesBase = false
      host.debug('Scribe: Fylgja does not take the commit a decision was written at here; decisions are written without it in this session')
      ;({ answer, refusal } = await tried(host, scribe, 'remember', args))
    }
  } catch {
    answer = undefined
  }

  const none = (code?: string, isTaken = false): Sent => ({ written: undefined, code, refusal, isTaken })

  const outcome = answer?.outcome

  if (outcome !== 'created' && outcome !== 'restored' && outcome !== 'duplicate' && outcome !== 'reconfirmed') {
    scribe.refused += 1
    scribe.refusedBy ??= refusalCodeOf(refusal)

    return none(codeOf(refusal))
  }

  scribe.wrote += 1

  // Its own is what it wrote as new. A record that came back from having been removed was somebody's before.
  const isOwn = outcome === 'created' && typeof answer?.atom_id === 'string'

  scribe.recorded = [...scribe.recorded, { id: isOwn ? String(answer?.atom_id) : null, content: draft.content }].slice(
    -MAX_LISTED,
  )

  if (typeof answer?.atom_id !== 'string') {
    return none(undefined, true)
  }

  // Fylgja says when what was sent was not applied because the record is
  // another member's: theirs to change, so it is shown as held and offers
  // neither Fix nor Remove.
  const isTheirs = outcome !== 'created' && typeof answer.note === 'string' && answer.note.trim() !== ''

  // Held already by the developer's own record: nothing was written, so
  // there is nothing to show or undo.
  if (!isTheirs && outcome !== 'created' && outcome !== 'restored') {
    return none(undefined, true)
  }

  const written: Written = {
    id: answer.atom_id,
    kind: draft.kind,
    content: draft.content,
    reasonStatus: draft.reasonStatus,
    detail: draft.detail,
    alternatives: draft.alternatives,
    triggers: draft.triggers,
    outcome: isTheirs || (outcome !== 'created' && outcome !== 'restored') ? 'held' : outcome,
    replaced: prior !== undefined && answer.supersede === 'applied' ? prior.content : null,
    repo: draft.repo,
    anchors: draft.anchors,
  }

  if (written.outcome === 'held') {
    return { written, code: undefined, refusal: undefined, isTaken: true }
  }

  scribe.written = [...scribe.written, written].slice(-MAX_LISTED)

  if (outcome === 'created') {
    scribe.mine.add(written.id)
  }

  save(host, scribe)

  return { written, code: undefined, refusal: undefined, isTaken: true }
}

/**
 * The developer changed, answered about, put back or removed this record
 * with a key: from here on it is theirs, and Scribe neither rewrites it,
 * takes it back nor adds places to it for the rest of the session.
 */
function touched(scribe: Scribe, id: string): void {
  scribe.mine.delete(id)
  scribe.recorded = scribe.recorded.map(one => (one.id === id ? { id: null, content: one.content } : one))
}

/**
 * Takes a receipt down once nobody has touched it for a while. One that was
 * behind something else all that time is given the time again. A receipt of
 * a conversation that has since started over is not this timer's.
 */
function expire(host: ScribeHost, scribe: Scribe, band: Band.Band, serial: number): void {
  host.after(RECEIPT_MS, () => {
    if (scribe.band !== band || band.receipt?.serial !== serial || band.receipt.isOpen || band.editing !== null) {
      return
    }

    if (band.current !== null || band.armed !== null) {
      expire(host, scribe, band, serial)

      return
    }

    band.receipt = null
    host.redraw()
  })
}

/**
 * Does what could not be done when it was asked for. Each is tried once more
 * and then let go; what there is no time for waits for the next turn.
 */
async function flush(host: ScribeHost, scribe: Scribe, who: Identity): Promise<void> {
  const waiting = scribe.deferred
  const startedAt = await host.now()

  scribe.deferred = []

  for (const [at, work] of waiting.entries()) {
    if (work.notIn === scribe.turn) {
      defer(scribe, work)
      continue
    }

    if ((await host.now()) - startedAt > FLUSH_BUDGET_MS) {
      scribe.deferred = [...waiting.slice(at), ...scribe.deferred].slice(-MAX_DEFERRED)

      break
    }

    scribe.isRetrying = true

    try {
      if ('draft' in work) {
        const one = await written(host, scribe, who, work.draft, await lone(host, scribe))

        // Written beside a decision it may go against, because nobody said whether it replaces it: the receipt says so.
        Band.receive(scribe.band, one === undefined ? [] : [work.against === undefined ? one : { ...one, against: work.against }])
      } else {
        await call(host, scribe, work.tool, work.args).catch(() => undefined)
      }
    } finally {
      scribe.isRetrying = false
    }
  }
}

// When each question came up, by this process's own clock: how long its answer took is counted from then.
const SHOWN = new WeakMap<Band.Question, number>()

/** Notes the question now on show, once: that it came up, and which kind it is. */
function shownNow(host: ScribeHost, scribe: Scribe): void {
  const item = scribe.band.current

  if (item?.kind === 'question' && !SHOWN.has(item)) {
    SHOWN.set(item, performance.now())
    host.report('question', { stage: 'shown', form: item.form })
  }
}

/** Notes how a question that was on show ended: by which kind of key, and how long after it came up. */
function answeredBy(host: ScribeHost, item: Band.Question, key: Word<'question', 'key'>): void {
  const since = SHOWN.get(item)

  host.report('question', {
    stage: 'answered',
    form: item.form,
    key,
    ...(since === undefined ? {} : { ms_until_answered: performance.now() - since }),
  })
}

/** The kind of answer a key of the band is to a question; undefined for a key that answers nothing. */
function answerOf(item: Band.Question, key: string): Word<'question', 'key'> | undefined {
  if (key === 'skip') {
    return 'skip'
  }

  if (item.form === 'reason') {
    return key.startsWith('reason:') ? 'option' : key === 'no-reason' ? 'no_reason' : undefined
  }

  if (item.form === 'holds') {
    return key === 'holds' ? 'still_holds' : key === 'no-longer' ? 'no_longer_holds' : undefined
  }

  return key === 'replaces' ? 'replaces' : key === 'different' ? 'different' : key === 'tell-claude' ? 'told_claude' : undefined
}

/**
 * Puts a question in line (`Band.offerQuestion`). When a rule holds it
 * back, which rule is noted: it is why nothing was asked.
 */
function ask(host: ScribeHost, scribe: Scribe, question: Band.Question, about: string): boolean {
  const { band } = scribe
  const by: Word<'question', 'held_back_by'> | undefined = band.hasAskedThisTurn
    ? 'turn_asked'
    : band.asked.has(about.toLowerCase())
      ? 'asked_before'
      : band.questions >= Band.MAX_QUESTIONS
        ? 'session_share'
        : band.unanswered >= Band.MAX_UNANSWERED
          ? 'unanswered'
          : undefined
  const isInLine = Band.offerQuestion(band, question, about)

  if (!isInLine && by !== undefined) {
    host.report('question', { stage: 'held_back', form: question.form, held_back_by: by })
  }

  return isInLine
}

/** Takes down the question about why the record `id` was decided (`Band.withdrawQuestion`), and notes it when that question was on show. */
function withdraw(host: ScribeHost, scribe: Scribe, id: string): void {
  const shown = scribe.band.current

  Band.withdrawQuestion(scribe.band, id)

  if (shown?.kind === 'question' && scribe.band.current !== shown) {
    answeredBy(host, shown, 'withdrawn')
  }
}

/** Brings up what may now be shown, and sees to what was let go unseen. */
function settle(host: ScribeHost, scribe: Scribe): void {
  const { band } = scribe
  const settled = Band.settle(band)

  shownNow(host, scribe)

  for (const item of settled.dropped) {
    // The question is let go; the decision it was about is still recorded,
    // beside the one it might have replaced.
    if (item.kind === 'question' && item.form === 'reversal') {
      defer(scribe, { draft: { ...item.draft, supersedes: null }, against: item.prior.id })
    }
  }

  if (settled.receipt !== undefined) {
    expire(host, scribe, band, settled.receipt)
  }

  if (settled.isKeptChanged) {
    keep(host, band)
  }

  // A record written, removed or put back has been through here by now.
  host.mark()
  host.redraw()
}

/**
 * What is left of a wake for putting refused records right: model calls,
 * time, and what a record is checked against. `window` is what the wake read
 * of the session and what Scribe still holds from before it; a write outside
 * a wake has none.
 */
type Budget = { steps: number; until: number; seen: Seen; isLastTry?: true; lookups?: number; window?: NamingSession }

/**
 * What a write outside a wake may spend on putting a refused record right:
 * one model call, with its own time limit. Such a write is the developer's
 * own key, or a record that was waiting for it. The call is one of the
 * hour's share, as a wake is: with the share used up there is none.
 */
async function lone(host: ScribeHost, scribe: Scribe): Promise<Budget> {
  const inTree = scribe.plans.docs.flatMap(doc => (doc.path === null ? [] : [doc.path]))

  // A record put right here is held to the same places as one of a look.
  await askGit(host, scribe)

  const now = await host.now()

  scribe.wakeTimes = scribe.wakeTimes.filter(at => now - at < HOUR_MS)

  return {
    steps: scribe.wakeTimes.length < MAX_WAKES_PER_HOUR ? 1 : 0,
    until: now + STEP_TIMEOUT_MS,
    seen: {
      plans: scribe.plans.docs,
      saidNoReason: false,
      paths: new Set([...scribe.places.keys(), ...inTree]),
      places: scribe.places,
      gitStates: scribe.gitStates,
      facts: new Map(),
    },
    isLastTry: true,
  }
}

/**
 * Writes one record of a wake's verdict. A refusal that says what is wrong
 * with the record is used once: the model is handed the record and the
 * refusal, and nothing else, and what it puts right is checked and sent
 * once. Refused again, or dropped by the model, the record is let go and
 * counted. A record refused for a label only the session knew is a case
 * where the model is handed the session too, since what the label
 * stands for is nowhere else; where there is no session to hand over, the
 * record is let go and counted, and no model is asked to guess. A decision
 * refused because its reason or a rejected alternative says how things
 * stand today is handed the session as well, when there is one: the cause
 * behind the state is seldom in the record. Without one it is still put
 * right, by what the record says or by losing the reason. A refusal
 * that is the server's own trouble is tried once more at
 * the next turn's end, as it is. This spends the wake's own model calls and
 * time, and none when the wake has used them up. A label only the session
 * knew is looked for before anything is sent at all (`named`).
 */
async function written(
  host: ScribeHost,
  scribe: Scribe,
  who: Identity,
  draft: Draft,
  budget: Budget,
  prior?: Fact,
): Promise<Written | undefined> {
  // A record is about a repository. One from a session that has no repository of its own and has touched no file of any is about none, and is not written.
  if (draft.repo === null) {
    scribe.unplaced += 1

    if (once(scribe, 'unplaced')) {
      host.debug('Scribe: a record was not written because the session has touched no file of any repository')
      host.report('error', { component: 'scribe', kind: 'no_repository' })
    }

    return undefined
  }

  // A label only the session knew is caught here, before anything is sent.
  const leaning = leaningOf(draft, sessionOf(budget))

  return leaning === undefined
    ? await sent(host, scribe, who, draft, budget, prior)
    : await named(host, scribe, who, draft, budget, leaning, prior)
}

/**
 * A record that names something by a label only the session knew, put
 * right once from the session the way one the server refused for it is,
 * before anything is sent. A sure label, one the session itself set up as
 * a label ("L4" where it listed "L1 —", "L2 —"), that is still there
 * afterwards lets the record go, counted. A likely one ("Phase 2", "the
 * stack's L4" where the session never set it up) never does: the record is
 * sent as the model left it, or as it was.
 */
async function named(
  host: ScribeHost,
  scribe: Scribe,
  who: Identity,
  draft: Draft,
  budget: Budget,
  leaning: Leaning,
  prior?: Fact,
): Promise<Written | undefined> {
  const left = budget.until - (await host.now())
  const refusal = leaningRefusal(leaning.label)
  let better: Draft | undefined

  if (budget.steps > 0 && left > 0 && budget.window !== undefined) {
    budget.steps -= 1
    scribe.corrections += 1

    if (budget.isLastTry === true) {
      scribe.wakeTimes.push(await host.now())
    }

    const answer = await correct(host, {
      model: scribe.model,
      record: handedOver(draft),
      refusal,
      timeoutMs: Math.min(STEP_TIMEOUT_MS, left),
      session: budget.window,
    })

    better = answer === 'drop' || answer === undefined ? undefined : correctedOf(draft, answer, 'wording', budget.seen, refusal)
  }

  const isMended = better !== undefined && leaningOf(better, sessionOf(budget))?.isSure !== true

  if (leaning.isSure && !isMended) {
    letGo(scribe, 'label_stayed')

    return undefined
  }

  return await sent(host, scribe, who, isMended && better !== undefined ? better : draft, budget, prior)
}

/** The session's lines a wake holds, which a label is held against; none outside a wake. */
function sessionOf(budget: Budget): readonly string[] {
  return budget.window === undefined ? [] : [...budget.window.earlier, ...budget.window.recent]
}

/** A record as the model that puts it right is handed it. */
function handedOver(draft: Draft): Record<string, unknown> {
  return {
    kind: draft.kind,
    content: draft.content,
    detail: draft.detail,
    reason_status: draft.reasonStatus,
    alternatives: draft.alternatives,
    anchors: draft.anchors,
    triggers: draft.triggers,
  }
}

/** `draft` sent, and put right once when Fylgja refuses it for something a rewording can mend (`written`). */
async function sent(
  host: ScribeHost,
  scribe: Scribe,
  who: Identity,
  draft: Draft,
  budget: Budget,
  prior?: Fact,
): Promise<Written | undefined> {
  const first = await send(host, scribe, who, draft, prior)
  const part = first.written === undefined ? teaches(first.code, first.refusal) : undefined

  if (first.written !== undefined || first.code === undefined) {
    return first.written
  }

  if (part === undefined) {
    if (PASSING.includes(first.code) && budget.isLastTry !== true) {
      // Not at this turn's end: the server is given time.
      defer(scribe, { draft, notIn: scribe.turn })
    }

    return undefined
  }

  const left = budget.until - (await host.now())

  if (budget.steps <= 0 || left <= 0 || (part === 'wording' && budget.window === undefined)) {
    lose(scribe, first.code)

    return undefined
  }

  budget.steps -= 1
  scribe.corrections += 1

  // Outside a wake the call is counted against the hour by itself.
  if (budget.isLastTry === true) {
    scribe.wakeTimes.push(await host.now())
  }

  const answer = await correct(host, {
    model: scribe.model,
    record: handedOver(draft),
    refusal: first.refusal ?? '',
    timeoutMs: Math.min(STEP_TIMEOUT_MS, left),
    ...((part === 'wording' || part === 'cause') && budget.window !== undefined ? { session: budget.window } : {}),
    ...(part === 'cause' ? { isAboutACause: true } : {}),
  })
  const better = answer === 'drop' || answer === undefined ? undefined : correctedOf(draft, answer, part, budget.seen, first.refusal)
  // What surely leans on the session after it was put right is not sent at all.
  const second =
    better === undefined || leaningOf(better, sessionOf(budget))?.isSure === true ? undefined : (await send(host, scribe, who, better, prior)).written

  if (second === undefined) {
    lose(scribe, first.code)
  }

  return second
}

/**
 * Rewrites one of Scribe's own records of this session in place: the same
 * decision as it now stands. What the receipt shows, or undefined when
 * Fylgja did not take the change. A question still waiting about that
 * record's reason goes once the reason is there.
 *
 * @param isByHand the developer asked for the change with a key: any record
 *   of the session that stands may be rewritten then, and is theirs after
 * @param lines the session, as the wake read it: what a label is held against
 */
async function rewrite(
  host: ScribeHost,
  scribe: Scribe,
  draft: Draft,
  isByHand = false,
  lines: readonly string[] = [],
): Promise<Written | undefined> {
  const own = scribe.written.find(one => one.id === draft.updates)

  if (own === undefined || (!isByHand && !scribe.mine.has(own.id))) {
    return undefined
  }

  // The model's rewording is held to the same rule as its first wording,
  // where it surely leans on the session; what the developer wrote
  // themselves is theirs.
  if (!isByHand && leaningOf(draft, lines)?.isSure === true) {
    letGo(scribe, 'label_stayed')

    return undefined
  }

  const { content } = draft
  // The places it had are kept, and the ones the rewrite names added: the server replaces the list it is sent.
  const had = own.anchors ?? []
  const anchors = [...had, ...draft.anchors.filter(anchor => !had.some(one => one.path === anchor.path && one.symbol === anchor.symbol))].slice(
    0,
    MAX_ANCHORS,
  )
  const args: Record<string, unknown> = {
    atom_id: own.id,
    op: 'fix',
    content,
    ...(anchors.length === had.length ? {} : { anchors }),
    ...(draft.detail === '' ? {} : { detail: draft.detail }),
    ...(draft.alternatives.length === 0 ? {} : { alternatives: draft.alternatives }),
    ...(draft.reasonStatus === null ? {} : { reason_status: draft.reasonStatus }),
  }
  let outcome: unknown

  try {
    outcome = (await tried(host, scribe, 'amend_memory', args)).answer?.outcome
  } catch {
    outcome = undefined
  }

  if (outcome !== 'fixed' && outcome !== 'unchanged') {
    scribe.refused += 1

    return undefined
  }

  const now: Written = {
    ...own,
    content,
    reasonStatus: draft.reasonStatus,
    // As Fylgja now holds it: a part the change did not send stays as it was.
    detail: draft.detail === '' ? own.detail : draft.detail,
    alternatives: draft.alternatives.length === 0 ? own.alternatives : draft.alternatives,
    anchors,
    outcome: 'updated',
    replaced: null,
  }

  scribe.written = scribe.written.map(one => (one.id === own.id ? now : one))
  scribe.recorded = scribe.recorded.map(one => (one.id === own.id ? { id: one.id, content } : one))
  save(host, scribe)

  if (draft.reasonStatus !== 'not_stated') {
    withdraw(host, scribe, own.id)
  }

  if (isByHand) {
    touched(scribe, own.id)
  }

  return now
}

/**
 * Takes back one of Scribe's own records of this session, because the
 * decision it held was dropped. What the receipt shows, or undefined when
 * it is not Scribe's or Fylgja did not remove it. A record taken back is
 * noted for the window of what was kept, where it can be put back.
 *
 * @param isByHand the developer asked for it with a key: any record of the
 *   session that stands may be taken back then
 */
async function takeBack(host: ScribeHost, scribe: Scribe, id: string, isByHand = false): Promise<Written | undefined> {
  const own = scribe.written.find(one => one.id === id)

  if (own === undefined || (!isByHand && !scribe.mine.has(id))) {
    return undefined
  }

  let outcome: unknown

  try {
    outcome = (await tried(host, scribe, 'amend_memory', { atom_id: id, op: 'remove' })).answer?.outcome
  } catch {
    outcome = undefined
  }

  if (outcome !== 'removed') {
    scribe.refused += 1

    return undefined
  }

  scribe.written = scribe.written.filter(one => one.id !== id)
  scribe.mine.delete(id)
  scribe.recorded = scribe.recorded.filter(one => one.id !== id)
  withdraw(host, scribe, id)
  save(host, scribe)

  const gone: Written = { ...own, outcome: 'withdrawn', replaced: null }

  // One picked up after a load again is not known whole, and is not sent back as if it were.
  if (own.isPartial !== true) {
    Ledger.shelve(scribe.ledger, gone)
  }

  return gone
}

/**
 * A decision as it is written, after its reason was looked for. One that
 * came without a reason is checked once against everything the developer
 * wrote in the session and against the plan documents, by a model call of
 * the wake's own: a reason found there, in their very words, makes the
 * decision stated. `isAbsent` says the look was made and found none: only
 * then may the developer be asked.
 */
async function withReason(
  host: ScribeHost,
  scribe: Scribe,
  draft: Draft,
  budget: Budget,
): Promise<{ draft: Draft; isAbsent: boolean; suggestion?: string }> {
  if (draft.kind !== 'decision' || draft.reasonStatus !== 'not_stated') {
    return { draft, isAbsent: false }
  }

  // With nothing to look in, there is nothing to find.
  if (
    scribe.spoken.length === 0 &&
    scribe.plans.docs.length === 0 &&
    scribe.proposals.length === 0 &&
    scribe.offers.length === 0
  ) {
    return { draft, isAbsent: true }
  }

  const left = budget.until - (await host.now())

  // No call left in this wake: the decision is written as it is, and nobody is asked on a guess.
  if (budget.steps <= 0 || left <= 0) {
    return { draft, isAbsent: false }
  }

  budget.steps -= 1
  scribe.checked += 1

  const found = await reasonIn(host, {
    model: scribe.model,
    decision: draft.content,
    spoken: scribe.spoken,
    unspoken: scribe.unspoken,
    plans: scribe.plans.docs,
    proposals: scribe.proposals,
    offers: scribe.offers,
    asked: scribe.offered,
    timeoutMs: Math.min(STEP_TIMEOUT_MS, left),
  })

  if (found === undefined) {
    return { draft, isAbsent: true }
  }

  // The assistant gave a reason and the developer has said nothing since:
  // nobody accepted it, so it is no reason on record. It is what they are asked about first.
  if ('suggestion' in found) {
    return { draft, isAbsent: true, suggestion: found.suggestion }
  }

  scribe.found += 1

  return { draft: { ...draft, detail: found.reason, reasonStatus: 'stated' }, isAbsent: false }
}

/**
 * The recorded decision a new one goes against, when there is one. Fylgja is
 * asked once what it holds on the decision's subject (its lookup by words,
 * in the repository the decision is about), and one model call of the
 * wake's own says how the decision stands to what came back. Records of
 * Scribe's own from this session are left out: those it rewrites itself.
 * Undefined when nothing is held, when nothing is contradicted, and when the
 * wake has no lookup or no call left.
 */
async function opposedBy(
  host: ScribeHost,
  scribe: Scribe,
  draft: Draft,
  facts: ReadonlyMap<string, Fact>,
  budget: Budget,
): Promise<Fact | undefined> {
  if (draft.kind !== 'decision' || draft.repo === null || (budget.lookups ?? 0) <= 0) {
    return undefined
  }

  budget.lookups = (budget.lookups ?? 0) - 1

  const held = factsOf(
    await call(host, scribe, 'recall', { repo: draft.repo, query: draft.content.slice(0, 300) }).catch(() => undefined),
  )
    .filter(fact => fact.kind === 'decision' && !scribe.written.some(own => own.id === fact.id))
    .slice(0, MAX_COMPARED)
  const left = budget.until - (await host.now())

  if (held.length === 0 || budget.steps <= 0 || left <= 0) {
    return undefined
  }

  budget.steps -= 1
  scribe.compared += 1

  const found = await relationOf(host, {
    model: scribe.model,
    decision: draft.content,
    facts: held,
    timeoutMs: Math.min(STEP_TIMEOUT_MS, left),
  })
  const prior = found?.relation === 'contradicts' ? held.find(fact => fact.id === found.id) : undefined

  if (prior !== undefined) {
    scribe.opposed += 1
    // Held with the wake's own records, so that the question and its keys find it.
    ;(facts as Map<string, Fact>).set(prior.id, prior)
  }

  return prior
}

/**
 * Asks git about the session's files it has not yet said enough of: which
 * of them it ignores and which it was never given, so that neither becomes
 * a record's anchor (`anchoring.ts`). One run per working tree, no more
 * files than `MAX_GIT_PATHS` in all, each run as `git.ts` runs git. A run that fails says nothing: the name alone then decides.
 */
async function askGit(host: ScribeHost, scribe: Scribe): Promise<void> {
  const byRoot = new Map<string, Place[]>()
  const asked = new Set<string>()

  for (const [file, place] of scribe.places) {
    const key = stateKey(place)
    const state = scribe.gitStates.get(key)

    // Only the full path says where the tree begins.
    if (
      asked.size >= MAX_GIT_PATHS ||
      !file.startsWith('/') ||
      !file.endsWith(`/${place.path}`) ||
      state === 'tracked' ||
      state === 'ignored' ||
      // Untracked code is a place all the same; only a document is asked again, since it may be added.
      (state === 'untracked' && isCode(place.path)) ||
      asked.has(key)
    ) {
      continue
    }

    const root = file.slice(0, file.length - place.path.length - 1)

    byRoot.set(root, [...(byRoot.get(root) ?? []), place])
    asked.add(key)
  }

  // Each tree at once, none waited for past its limit: a git that hangs costs the look a moment, never the turn.
  await Promise.all(
    [...byRoot].map(async ([root, places]) => {
      const paths = places.map(one => one.path)
      const ran = await gitIn(host.run, host.after, root, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--ignored=traditional',
        '--',
        ...paths,
      ])
      const printed = ran?.exitCode === 0 ? ran.stdout : undefined

      if (printed === undefined) {
        return
      }

      const states = statesOf(printed, paths)

      for (const place of places) {
        const state = states.get(place.path)

        if (state !== undefined) {
          scribe.gitStates.set(stateKey(place), state)
        }
      }
    }),
  )
}

/**
 * Adds places to one of Scribe's own records of this session: files a later
 * turn touched that carry out a decision recorded before they existed. The
 * record's own anchors are kept and the new ones added, up to what the
 * server takes. Nothing is shown for it: the record says the same.
 */
async function anchorMore(
  host: ScribeHost,
  scribe: Scribe,
  id: string,
  anchors: readonly Draft['anchors'][number][],
): Promise<void> {
  const own = scribe.written.find(one => one.id === id)

  // Only a record still waiting for its code: one that has it is not given more by a guess.
  if (own === undefined || !scribe.mine.has(id) || !isWaiting(own)) {
    return
  }

  const had = own.anchors ?? []
  const fresh = anchors.filter(anchor => !had.some(one => one.path === anchor.path && one.symbol === anchor.symbol))
  const all = [...had, ...fresh].slice(0, MAX_ANCHORS)

  if (all.length === had.length) {
    return
  }

  let outcome: unknown

  try {
    outcome = (await tried(host, scribe, 'amend_memory', { atom_id: id, op: 'fix', anchors: all })).answer?.outcome
  } catch {
    outcome = undefined
  }

  if (outcome === 'fixed' || outcome === 'unchanged') {
    scribe.lateAnchors += all.length - had.length
    scribe.written = scribe.written.map(one => (one.id === id ? { ...one, anchors: all } : one))
    // The window's "In:" line now names the code, and the list is saved as no longer waiting for it.
    save(host, scribe)
    host.redraw()
  }
}

/** Acts on a wake's verdict: writes its records, and puts its question and its tells in line. */
async function apply(
  host: ScribeHost,
  scribe: Scribe,
  who: Identity,
  verdict: Verdict,
  facts: ReadonlyMap<string, Fact>,
  budget: Budget,
): Promise<void> {
  const { band } = scribe
  const { question } = verdict

  for (const said of verdict.stated) {
    if (!scribe.stated.includes(said)) {
      scribe.stated = [...scribe.stated, said].slice(-MAX_STATED)
    }
  }

  for (const late of verdict.anchored ?? []) {
    await anchorMore(host, scribe, late.id, late.anchors)
  }

  for (const id of verdict.withdrawn) {
    const gone = await takeBack(host, scribe, id)

    if (gone !== undefined) {
      Band.receive(band, [gone])
    }
  }

  for (let n = 0; n < (verdict.aboutWork ?? 0); n += 1) {
    letGo(scribe, 'about_work')
  }

  for (const [index, draft] of verdict.records.entries()) {
    const isAskedOf = question?.record === index
    const prior = isAskedOf && question.form === 'reversal' ? facts.get(question.prior) : undefined

    // A decision that came without a reason: before anybody is asked, the
    // reason is looked for in what the developer wrote and in the plans.
    const checked = await withReason(host, scribe, draft, budget)

    // Scribe's own record of this session, as the decision now stands: rewritten in place, with no key and no second record.
    if (draft.updates !== null) {
      const own = await rewrite(host, scribe, checked.draft, false, sessionOf(budget))

      if (own !== undefined) {
        Band.receive(band, [own])
      }

      continue
    }

    if (isAskedOf) {
      scribe.asked = [...scribe.asked, draft.content].slice(-MAX_LISTED)
    }

    // A new decision is held against what is already recorded on its
    // subject, not only on its files: one that goes against a record is the
    // developer's to settle, as when the wake itself saw the record.
    const against = prior === undefined ? await opposedBy(host, scribe, checked.draft, facts, budget) : undefined

    // A record the developer gave up has met the decision that may take its
    // place: from here it is the question's to settle, and is shown as given up no longer.
    scribe.denied.delete((prior ?? against)?.id ?? '')

    if (against !== undefined) {
      const asks: Band.Question = {
        kind: 'question',
        form: 'reversal',
        draft: checked.draft,
        prior: against,
        options: [],
        isTouched: false,
      }

      if (ask(host, scribe, asks, draft.content)) {
        scribe.asked = [...scribe.asked, draft.content].slice(-MAX_LISTED)
        continue
      }
    }

    // A decision that may replace a recorded one is written once the
    // developer has said which it is. When they cannot be asked, it is
    // written beside the old one: nothing is ever replaced without their key.
    if (prior !== undefined) {
      const asks: Band.Question = {
        kind: 'question',
        form: 'reversal',
        draft,
        prior,
        options: question?.options ?? [],
        isTouched: false,
      }

      if (ask(host, scribe, asks, draft.content)) {
        continue
      }
    }

    // What is written may be the record put right: the question, if there is one, is about that one.
    const one = await written(host, scribe, who, { ...checked.draft, supersedes: null }, budget)

    if (one === undefined) {
      continue
    }

    Band.receive(band, [one])

    // Asked only when the reason was looked for and is nowhere, and only
    // about a decision a later reader of the code would trip over: one that
    // concerns code in hand or ruled something out. The bar for asking is
    // higher than the bar for recording.
    // And never about a choice the developer made themselves between options
    // put to them: what they chose and what they turned down is on record.
    const isWorthAsking =
      (checked.draft.anchors.length > 0 || checked.draft.alternatives.length > 0) && checked.draft.fromChoice !== true

    if (
      isAskedOf &&
      question.form === 'reason' &&
      one.reasonStatus === 'not_stated' &&
      one.outcome !== 'held' &&
      checked.isAbsent &&
      isWorthAsking
    ) {
      ask(
        host,
        scribe,
        {
          kind: 'question',
          form: 'reason',
          id: one.id,
          content: one.content,
          // What the assistant gave as the reason, which nobody has accepted yet, is put first.
          options: checked.suggestion === undefined ? question.options : [checked.suggestion, ...question.options].slice(0, 3),
          isTouched: false,
        },
        one.content,
      )
    }
  }

  for (const id of verdict.tells) {
    const fact = facts.get(id)

    if (fact !== undefined && !scribe.written.some(own => own.id === id)) {
      Band.offerTell(band, fact)
    }
  }
}

/**
 * Asks Fylgja what is recorded about the files waiting to be looked up. A
 * record anchored to one of those very files is offered to the developer;
 * one anchored to a folder above is kept for the next wake to judge.
 *
 * @param isProbe with no file waiting, ask all the same, about a file every
 *   repository has: whether the call gets through is what is asked
 */
async function lookUp(host: ScribeHost, scribe: Scribe, who: Identity, isProbe = false): Promise<void> {
  const waiting = scribe.paths.slice(0, MAX_LOOKUP_PATHS)
  // Each repository is asked about its own files, from its own root.
  const byRepo = new Map<string, string[]>()

  for (const place of waiting) {
    if (byRepo.has(place.repo) || byRepo.size < MAX_LOOKUP_REPOS) {
      byRepo.set(place.repo, [...(byRepo.get(place.repo) ?? []), place.path])
    }
  }

  scribe.paths = [...waiting.filter(place => !byRepo.has(place.repo)), ...scribe.paths.slice(MAX_LOOKUP_PATHS)]

  if (byRepo.size === 0) {
    // With no repository of its own and no file of one touched yet, there is nothing to ask about.
    if (!isProbe || who.repo === null) {
      return
    }

    byRepo.set(who.repo, [])
  }

  for (const [repo, files] of byRepo) {
    if ((await recalled(host, scribe, repo, files)) === undefined) {
      return
    }
  }

  settle(host, scribe)
}

/**
 * Asks Fylgja what is recorded about `files` of `repo` and takes in what it
 * answers. A record anchored to one of those very files is offered to the
 * developer, unless it is a decision whose code changed after it was last
 * confirmed: that one waits to be asked about (`askHolds`). A record
 * Scribe wrote in this session is neither, and one that is the session's
 * own in Fylgja's books (Claude's, say) is never one to ask about.
 *
 * @param isAgain the files were asked about before, and are asked about
 *   again because a commit changed them: only the records marked for it are
 *   taken in
 * @returns the ids of the records it answered with; undefined when the
 *   conversation is no longer the one that asked
 */
async function recalled(
  host: ScribeHost,
  scribe: Scribe,
  repo: string,
  files: readonly string[],
  isAgain = false,
): Promise<string[] | undefined> {
  const { epoch } = scribe
  // Asked again for particular records, it is asked for as many as Fylgja
  // gives of one lookup: a marked record past that number is not found here.
  const facts = factsOf(
    await call(host, scribe, 'recall', {
      repo,
      paths: files.length === 0 ? [PROBE] : files,
      ...(isAgain ? { limit: MOST_RECALLED } : {}),
    }),
  )

  if (epoch !== scribe.epoch) {
    return undefined
  }

  for (const fact of facts) {
    const isOwn = scribe.own.has(fact.id)

    if (scribe.written.some(own => own.id === fact.id) || (isAgain && (fact.changed === null || isOwn))) {
      continue
    }

    scribe.anchored.set(fact.id, fact)

    if (!isAnchoredTo(fact, files)) {
      continue
    }

    if (fact.changed !== null && fact.kind === 'decision' && !isOwn) {
      scribe.doubted = [...scribe.doubted.filter(one => one.fact.id !== fact.id), { fact, repo, asks: true }].slice(-MAX_DOUBTED)
    } else {
      Band.offerTell(scribe.band, fact)
    }
  }

  return facts.map(fact => fact.id)
}

/**
 * Asks whether one recorded decision still holds, of those whose code a
 * commit changed after they were last confirmed. It is a question like any
 * other, held to the same limits: one a turn, never the same decision
 * twice in a session, none past the session's share. So where the turn has
 * had its question, they wait for the next look.
 *
 * One is asked about, and no count of the others is put on its card: they
 * are offered as any record about the code in hand is, one a turn, each
 * saying that its code changed. A second question would be the louder way
 * to say the same, and a number on the card names nothing that could be
 * acted on. One that the turn's tell has no room for waits for a later
 * turn's, and is told then, not asked about.
 */
function askHolds(host: ScribeHost, scribe: Scribe): void {
  const { band } = scribe
  const waiting: Doubted[] = []
  let isAsked = false

  for (const one of scribe.doubted) {
    const { fact, repo } = one

    // Written by this session since it was looked up, or found to be the session's own: never asked about.
    if (scribe.written.some(own => own.id === fact.id) || scribe.own.has(fact.id)) {
      continue
    }

    if (one.asks && !isAsked) {
      // This turn has had its question: it waits for the next look.
      if (band.hasAskedThisTurn) {
        waiting.push(one)
        continue
      }

      if (ask(host, scribe, { kind: 'question', form: 'holds', fact, repo, isTouched: false }, fact.content)) {
        isAsked = true
        continue
      }
    }

    // Told once, or known for good: there is nothing left to say of it. Otherwise this turn's tell is taken.
    if (!Band.offerTell(band, fact) && !band.told.has(fact.id) && !band.kept.known.includes(fact.id)) {
      waiting.push({ ...one, asks: false })
    }
  }

  // The others of a batch one was asked about are told, never asked about in their turn.
  scribe.doubted = isAsked ? waiting.map(one => ({ ...one, asks: false })) : waiting
}

/** Waits for `work`, but no longer than `ms`. `work` goes on either way. */
function within(host: ScribeHost, work: Promise<unknown>, ms: number): Promise<void> {
  return limited(host.after, work, ms).then(
    () => undefined,
    () => undefined,
  )
}

/**
 * `placesOf`, waited for no longer than `PLACE_WAIT_MS`; undefined when it
 * took longer. What it finds out later is still kept, per folder, for the
 * session, so the next step that names the folder has it at once.
 */
function placed(host: ScribeHost, scribe: Scribe, who: Identity, files: readonly string[]): Promise<Place[] | undefined> {
  return files.length === 0
    ? Promise.resolve([])
    : limited(host.after, placesOf(host, scribe, who, files), PLACE_WAIT_MS).catch(() => undefined)
}

/** Notes files the session touched, each in its repository: to be looked up once. */
function wanted(scribe: Scribe, who: Identity, places: readonly Place[]): void {
  for (const place of places) {
    const key = `${place.repo}\u0000${place.path}`

    // A repository the session only reads in (a clone of somebody's plugin,
    // another checkout it looks something up in) is not asked about.
    if (place.repo !== who.repo && !scribe.editedRepos.has(place.repo)) {
      continue
    }

    if (!scribe.lookedUp.has(key)) {
      scribe.lookedUp.add(key)
      scribe.paths.push(place)
    }
  }
}

/**
 * One step of the main conversation ended. The files it names are noted,
 * and on every fourth step they are looked up; a slow answer does not hold
 * the turn.
 */
export async function stepped(
  host: ScribeHost,
  scribe: Scribe,
  index: number,
  uses: readonly { name: string; input: unknown }[],
): Promise<void> {
  if (scribe.identity === null) {
    return
  }

  // A question put to the developer: the step that follows it has their answer.
  scribe.isAsking ||= uses.some(use => use.name === 'AskUserQuestion')

  const who = await identityOf(host, scribe)

  if (who === null) {
    return
  }

  // Bounded: the disk is read here, and the turn is not held by it.
  const places = (await placed(host, scribe, who, filesOf(uses, who.root))) ?? []

  // A file the step writes or changes makes its repository one the session works in.
  for (const file of changesOf(uses, who.root).files) {
    const place = scribe.places.get(file)

    if (place !== undefined && places.includes(place)) {
      scribe.editedRepos.add(place.repo)
    }
  }

  wanted(scribe, who, places)

  if ((index + 1) % LOOKUP_EVERY !== 0 || scribe.paths.length === 0 || (await connected(host)) === undefined) {
    return
  }

  await within(
    host,
    lookUp(host, scribe, who).catch(() => undefined),
    LOOKUP_WAIT_MS,
  )
}

/** What tells one row from another, without holding it: enough to notice that the rows were rewritten. */
function markOf(row: Row | undefined): string | undefined {
  return row === undefined ? undefined : `${row.role}|${row.text.length}|${row.toolUses.length}|${row.text.slice(0, 80)}`
}

/**
 * Where the rows not yet seen begin: after the ones a wake went through. A
 * compaction sets that count itself, and keeps the rows it left to tell the
 * later ones from where the engine's list is not the one it was handed (see
 * `compacted`). Anything else that rewrites the conversation leaves the
 * count pointing into another list; then, and when nothing is known yet,
 * they begin at the developer's last prompt.
 */
function startOf(scribe: Scribe, rows: readonly Row[]): number {
  const { consumed } = scribe

  if (consumed >= 0 && consumed <= rows.length && (consumed === 0 || markOf(rows[consumed - 1]) === scribe.mark)) {
    return consumed
  }

  // The rows a compaction left are looked for in their order, whatever stands among them and whichever of them
  // the engine no longer has: what follows the last one found is new.
  if (scribe.seam !== undefined) {
    let next = 0
    let after = -1

    for (let at = 0; at < rows.length && next < scribe.seam.length; at += 1) {
      const hit = scribe.seam.indexOf(markOf(rows[at]) ?? '', next)

      if (hit !== -1) {
        next = hit + 1
        after = at + 1
      }
    }

    if (after !== -1) {
      return after
    }
  }

  for (let at = rows.length - 1; at >= 0; at -= 1) {
    const row = rows[at]

    if (row !== undefined && isPrompt(row, scribe.prompts)) {
      return at
    }
  }

  return rows.length
}

/** What Scribe has in hand of a conversation that is about to be compacted. */
export type Compacting = {
  /** The rows no look has been through, oldest first. */
  unseen: readonly Row[]
  /** The working tree's root: what a row's files are named from. */
  root: string
  epoch: number
}

/**
 * The conversation is about to be compacted: `rows` is what the summary is
 * made of. The rows no look has been through yet are picked out, so that
 * they can be held when the compaction stands; a look made here instead
 * would hold the compaction up for as long as a model takes to answer.
 * Nothing is changed yet, because a compaction may still be called off.
 *
 * Undefined where Scribe does not run: such a conversation has nothing of
 * Scribe's to carry over.
 */
export async function compacting(host: ScribeHost, scribe: Scribe, rows: readonly Row[]): Promise<Compacting | undefined> {
  const who = await identityOf(host, scribe)

  if (who === null) {
    return undefined
  }

  // Read last, with nothing awaited after it: a look that ends meanwhile has moved the count by then.
  return { unseen: rows.slice(startOf(scribe, rows)), root: who.root, epoch: scribe.epoch }
}

/**
 * `rows` cut to `MAX_HELD`, oldest first. What the developer wrote, chose
 * or turned down is never what goes: without it the next look could not
 * tell whose turn it reads. The oldest of the other rows go first.
 */
function heldOf(rows: readonly Row[], root: string, prompts: ReadonlySet<string>): readonly Row[] {
  let over = rows.length - MAX_HELD

  return over <= 0
    ? rows
    : rows.filter(row => {
        if (over <= 0) {
          return true
        }

        const seen = observe([row], root, prompts)

        if (seen.developer.length > 0 || seen.acts.length > 0) {
          return true
        }

        over -= 1

        return false
      })
}

/**
 * The conversation was compacted and now reads `rows`. What Scribe holds of
 * the session stays as it is: its records, their count above the prompt and
 * the window that lists them are the session's, not the conversation's.
 *
 * The rows no look had been through are held for the next one, and every
 * row the conversation holds now counts as gone through: what is in the
 * summary and in the rows kept beside it was either looked at or is held.
 * The engine may hold the compacted conversation with rows of its own
 * among these (the command that asked for it, what it reads again), so the
 * rows are kept as marks too, and the next look finds the last of them.
 */
export function compacted(
  host: ScribeHost,
  scribe: Scribe,
  before: Compacting,
  rows: readonly Row[],
  trigger: Word<'compaction', 'trigger'>,
): void {
  // The conversation started over while it was being compacted: nothing of the one before is held.
  if (before.epoch !== scribe.epoch) {
    return
  }

  const all = [...scribe.held, ...before.unseen]
  const held = heldOf(all, before.root, scribe.prompts)

  scribe.held = held
  scribe.compactions += 1
  scribe.hasCompacted = true
  scribe.consumed = rows.length
  scribe.mark = markOf(rows.at(-1))
  scribe.seam = rows.flatMap(row => markOf(row) ?? [])

  if (held.length < all.length) {
    host.debug(`${HELD_DROPPED} ${all.length - held.length}`)
    host.report('error', { component: 'compaction', kind: 'held_rows_dropped' })
  }

  host.report('compaction', {
    trigger,
    is_scribe_running: true,
    records_carried: scribe.written.length,
    rows_held: held.length,
    rows_dropped: all.length - held.length,
  })
}

/**
 * What the context of the conversation says of the session's records, or
 * undefined when it says nothing: before the first compaction Claude has
 * the conversation itself, a session that kept nothing has nothing to
 * list, and one that is signed out or has Scribe off is not spoken for.
 * What it lists is noted, so that a later change to it is noticed.
 */
export async function context(host: ScribeHost, scribe: Scribe): Promise<string | undefined> {
  scribe.noted = undefined

  if (!scribe.hasCompacted || (await reader(host, scribe)) === null) {
    return undefined
  }

  const text = carried(scribe.written)

  scribe.noted = text === undefined ? undefined : listedOf(scribe.written)

  return text
}

/**
 * Whether what the context lists is no longer so: a record it quotes was
 * removed, or its sentence or its reason reads differently now. A record
 * kept since is no such change, and neither is a file added to one. The
 * context says what the session had saved when it was compacted, the new
 * record and the new file are in the conversation Claude has, and
 * computing the context again costs the conversation its place in the
 * prompt cache; the next compaction lists them.
 *
 * @param isHere whether the session is signed in to Fylgja as the account this machine is set up for
 */
export function isStale(scribe: Scribe, isHere: boolean): boolean {
  if (scribe.noted === undefined) {
    return false
  }

  // Signed out, or Scribe switched off, since: the session is not spoken for any more.
  if (!isHere || !scribe.hasCompacted || isOff(scribe)) {
    return true
  }

  const now = new Map(scribe.written.map(record => [record.id, record.outcome === 'withdrawn' ? '' : saidOf(record)]))

  return scribe.noted.some(([id, entry]) => now.get(id) !== entry)
}

function summaryOf(verdict: Verdict, written: readonly Written[]): string {
  return JSON.stringify({
    outcome:
      verdict.records.length === 0 && verdict.question === null && verdict.tells.length === 0 && verdict.withdrawn.length === 0
        ? 'nothing'
        : 'act',
    recorded: written.map(one => one.content),
    asked: verdict.question !== null,
    told: verdict.tells.length,
    // What it changed of its own: records rewritten in place, and records taken back.
    ...(verdict.records.some(draft => draft.updates !== null)
      ? { updated: verdict.records.filter(draft => draft.updates !== null).length }
      : {}),
    ...(verdict.withdrawn.length === 0 ? {} : { withdrawn: verdict.withdrawn.length }),
  })
}

/**
 * What Scribe still holds of the session from before the turn in hand, line
 * by line: the plan documents and the earlier wakes in brief. It is where a
 * label a later turn uses was explained.
 */
function earlierLines(scribe: Scribe): string[] {
  return [...scribe.plans.docs.map(doc => doc.text), ...scribe.past.map(block => block.text)]
    .flatMap(text => text.split('\n'))
    .filter(line => line.trim() !== '' && !/^(?:<<<|>>>|Earlier wake \d+:|\[your verdict then\])/.test(line))
}

/**
 * A record the plugin itself did not write: the model said it is about how
 * the work is organised, or it still named something by a label only the
 * session knew. Counted for the window of what was kept and for the look's
 * report, by that reason alone.
 */
function letGo(scribe: Scribe, reason: DropReason): void {
  scribe.letGo += 1
  scribe.letGoBy ??= reason
  lose(scribe, reason)
}

/** A record lost for good after Fylgja refused it, counted under the rule it was refused by. */
function lose(scribe: Scribe, code: string): void {
  scribe.dropped += 1
  scribe.lost.set(code, (scribe.lost.get(code) ?? 0) + 1)
}

/**
 * An earlier wake's lines as a later wake needs them to follow the thread:
 * what the developer and Claude said, each cut short, the newest kept when
 * there is more than fits. The tool calls are left out: what they led to is
 * in what was said and in what was recorded.
 */
function gist(lines: readonly string[]): string[] {
  const kept: string[] = []
  let size = 0

  for (const line of [...lines].reverse()) {
    if (line.startsWith('[tool]')) {
      continue
    }

    const short = line.length > 300 ? `${line.slice(0, 300)}…` : line

    if (size + short.length > MAX_PAST_CHARS) {
      break
    }

    kept.unshift(short)
    size += short.length
  }

  return kept
}

/**
 * Whether a wake may begin now: none is under way, and the hour has not had
 * its share. The hour's share used up is said once in the debug log.
 *
 * @param isAnswered the rows hold an answer of the developer's that no look
 *   has been begun for. Such a look is counted in the hour's share and never
 *   refused by it: a person has to answer each question, so there are only
 *   so many.
 */
function mayWake(host: ScribeHost, scribe: Scribe, now: number, isAnswered: boolean): boolean {
  // A wake always ends, by its own limits; one that somehow did not is not
  // let stand in the way of every later one.
  if (scribe.wakingSince !== 0 && now - scribe.wakingSince < 2 * WAKE_DEADLINE_MS) {
    return false
  }

  scribe.wakeTimes = scribe.wakeTimes.filter(at => now - at < HOUR_MS)

  if (scribe.wakeTimes.length < MAX_WAKES_PER_HOUR) {
    scribe.said.delete('ceiling')

    return true
  }

  if (isAnswered) {
    return true
  }

  if (once(scribe, 'ceiling')) {
    host.debug(`Scribe: ${MAX_WAKES_PER_HOUR} wakes in the last hour; quiet until the hour has rolled on`)
    host.report('error', { component: 'scribe', kind: 'wake_ceiling' })
  }

  return false
}

/** Notes files written or changed, each under its repository, as a tool line writes it. */
function noteEdits(scribe: Scribe, who: Identity, files: readonly string[], places: readonly Place[]): void {
  for (const file of files) {
    const place = scribe.places.get(file)

    if (place !== undefined && places.includes(place)) {
      const shown = relativeTo(who.root, file) ?? file

      scribe.edited.set(place.repo, new Set([...(scribe.edited.get(place.repo) ?? []), shown]))
      scribe.changedPlaces.add(stateKey(place))
      scribe.editedRepos.add(place.repo)
    }
  }
}

/**
 * A commit was made in `repo`: it holds what was changed there since the one
 * before.
 *
 * @returns those files, each as a tool line writes it
 */
function committed(scribe: Scribe, repo: string): string[] {
  const files = [...(scribe.edited.get(repo) ?? [])]

  scribe.edited.delete(repo)

  if (files.length > 0) {
    scribe.commitsToPair = [...scribe.commitsToPair, { repo, files }].slice(-MAX_PENDING_COMMITS)
  }

  return files
}

/**
 * A commit was made at the session's own root, in `repo`: the files it is
 * reported with, as paths from the repository's root, no more than are sent
 * with one commit.
 *
 * Scribe runs no git, so what a commit holds is not known to it. What it
 * has is two things: the files the session changed, and the number of
 * files git itself printed for the commit. A file is reported only when
 * the two agree. Marking somebody's record as changed by a commit that did
 * not touch its file is worse than missing one, so wherever they do not
 * agree nothing is reported, and a commit goes unreported more often than
 * it need be: that is the price, and it is paid on purpose.
 *
 * The candidates are the files the session wrote or changed since the
 * commit before and before this commit's own command, in the main
 * conversation or by an agent, that lie in the working tree the commit was
 * made in: not in a repository checked out inside it, and not in another
 * working tree of the same repository.
 *
 * - Git printed no number on the line after the commit's own, or the shell
 *   was not at the working tree's root when it was made: nothing.
 * - The commit took the whole tree, by its own `-a` or after an add of the
 *   whole tree from its root with nothing named (`add -A`, `add .`, `add
 *   -u`), and no other command since the commit before did anything to
 *   what is staged: the candidates, when they are as many as git counted.
 *   They are then the commit, all of them. Where only what git tracks was
 *   taken (`-a`, `-u`), a file the session created is not among them: the
 *   write tool says when it made a file that was not there, and a file it
 *   does not say so of counts as one that was.
 * - Any other commit, a bare one too: it takes what was staged, and the
 *   candidates' number says nothing, since what is counted may be some
 *   other file. Only where the commands since the commit before named the
 *   staged files one by one (`namedAfter`), every one of those is a
 *   candidate and they are as many as git counted: those files.
 * - Otherwise nothing.
 *
 * What the commands staged is carried from look to look until a commit is
 * seen, so a commit is read with what was staged turns before it.
 *
 * At every commit its candidates are let go, reported or not: each may be
 * in it, and none is pinned on a later commit. A file changed after the
 * commit's command was never among them, and is the next commit's.
 */
function reportedWith(scribe: Scribe, who: Identity, repo: string, commit: Landed): Pick<Commit, 'paths' | 'rule'> {
  const isNew = new Set([...scribe.created].map(file => relativeTo(who.root, file) ?? file))
  const files = committed(scribe, repo)
  const inTree = (file: string): string[] => {
    const place = scribe.places.get(file)

    return place?.repo === repo && relativeTo(who.root, file) === place.path ? [place.path] : []
  }
  const candidates = new Set(files.flatMap(inTree))
  // What a staging of the tracked files takes: not the files the session is known to have created.
  const tracked = new Set(files.filter(file => !isNew.has(file)).flatMap(inTree))

  scribe.created.clear()

  if (commit.count === null || commit.isAway !== false) {
    return { paths: [], rule: commit.count === null ? 'none_count_unknown' : 'none_away' }
  }

  const named = commit.named === null ? [] : [...new Set(commit.named)]
  const whole = commit.whole === 'tracked' ? tracked : candidates

  if (commit.whole !== false && !commit.hasStaged) {
    return whole.size === commit.count
      ? { paths: [...whole].slice(0, MAX_COMMIT_PATHS), rule: 'count_match' }
      : { paths: [], rule: 'none_count_mismatch' }
  }

  return named.length === commit.count && named.every(path => candidates.has(path))
    ? { paths: named.slice(0, MAX_COMMIT_PATHS), rule: 'named_set' }
    : { paths: [], rule: 'none_named_mismatch' }
}

/**
 * How Fylgja's server words its refusal of an argument it does not know,
 * when that argument is a commit's files: the argument's name, and that it
 * was not expected.
 */
const UNKNOWN_PATHS = /\bpaths\b[\s\S]{0,200}?unexpected[ _]keyword[ _]argument|unexpected[ _]keyword[ _]argument[\s\S]{0,200}?\bpaths\b/i

/**
 * Attaches one commit to what the session recorded in `repo`, Scribe's
 * records and Claude's own, and tells Fylgja which files the commit holds
 * (`reportedWith`): it marks the other decisions anchored to those very
 * files as ones whose code changed, and answers with the ones it marked.
 * Those files are then asked about again, thirty at a time, until every
 * record it named has come back.
 *
 * A server that does not know of a commit's files turns the call down, and
 * says that it is that argument it does not know. Only then is the commit
 * attached without them, as it always was, and no later commit of the
 * session sends any: nothing else of Scribe changes for it. A call that
 * failed for any other reason says nothing about the server, and the next
 * commit is sent with its files.
 */
async function attach(host: ScribeHost, scribe: Scribe, who: Identity, repo: string, commit: Commit): Promise<void> {
  const args = { repo, sha: commit.sha, session_id: who.sessionId }
  const paths = scribe.takesPaths ? commit.paths : []
  let isFallback = false
  // How the commit went, in counts: which rule its files were reported by, how many went, and what Fylgja did with them.
  const went = (answered: Record<string, unknown> | undefined): void => {
    const count = (value: unknown): number => (typeof value === 'number' ? value : 0)

    host.report('commit', {
      rule: commit.rule,
      files_sent: isFallback ? 0 : paths.length,
      is_old_server_fallback: isFallback,
      is_attached: answered !== undefined,
      ...(answered === undefined
        ? {}
        : { attached: count(answered.attached), flagged: ids(answered.flagged).length + count(answered.flagged_more) }),
    })
  }
  let answer: Record<string, unknown> | undefined
  let refusal: string | undefined

  try {
    ;({ answer, refusal } = await tried(host, scribe, 'attach_commit', paths.length === 0 ? args : { ...args, paths }).catch(
      (error: unknown): Tried => {
        // The same refusal, where the call itself is failed for it.
        if (paths.length > 0 && error instanceof Error && UNKNOWN_PATHS.test(error.message)) {
          return { answer: undefined, refusal: error.message }
        }

        throw error
      },
    ))

    if (answer === undefined && paths.length > 0 && UNKNOWN_PATHS.test(refusal ?? '')) {
      scribe.takesPaths = false
      isFallback = true
      host.debug('Scribe: Fylgja does not take the files of a commit here; commits are attached without them in this session')
      host.report('error', { component: 'scribe', kind: 'old_server_paths' })
      ;({ answer, refusal } = await tried(host, scribe, 'attach_commit', args))
    }
  } catch (error) {
    went(undefined)

    throw error
  }

  went(answer)

  // What the commit was attached to is the session's own, whoever wrote it down.
  scribe.own = new Set([...scribe.own, ...ids(answer?.atom_ids).map(id => id.toLowerCase())].slice(-MAX_OWN))

  const marked = new Set(ids(answer?.flagged).map(id => id.toLowerCase()))

  for (let from = 0; marked.size > 0 && from < paths.length; from += MAX_LOOKUP_PATHS) {
    const found = await recalled(host, scribe, repo, paths.slice(from, from + MAX_LOOKUP_PATHS), true).catch(() => undefined)

    if (found === undefined) {
      break
    }

    for (const id of found) {
      marked.delete(id)
    }
  }
}

/** No more commits wait to be asked about than this; the oldest are let go. */
const MAX_PENDING_COMMITS = 5

/**
 * One step of an agent the session started ended. Only the paths of the
 * files it writes or changes are taken, never their content and nothing the
 * agent said: they are files of this session, a record may point at them,
 * and a commit the agent makes holds them. Nothing is looked up or asked
 * here.
 *
 * Whether an agent's commit went through cannot be seen from its step: the
 * command is taken as the commit, and the files changed in that repository
 * since the last one as what it holds.
 */
export async function agentStepped(
  host: ScribeHost,
  scribe: Scribe,
  uses: readonly { name: string; input: unknown }[],
): Promise<void> {
  if (scribe.identity === null) {
    return
  }

  const who = await identityOf(host, scribe)

  if (who === null) {
    return
  }

  const { files, hasCommit } = changesOf(uses, who.root)
  // Bounded as in the main conversation's step; past the bound the files count as in no repository.
  const places = (await placed(host, scribe, who, files)) ?? []

  noteEdits(scribe, who, files, places)
  scribe.agentRepo = places.at(-1)?.repo ?? scribe.agentRepo

  if (hasCommit && scribe.agentRepo !== null) {
    committed(scribe, scribe.agentRepo)
  }
}

/**
 * Puts a look behind the one under way, so that one runs at a time: two at
 * once would read the same rows as new. Each reads where the rows not yet
 * seen begin when its own turn comes, so it has what the look before it
 * left and nothing that look went through. One whose conversation started
 * over since `epoch`, the one it was begun in, is not run.
 *
 * A look always ends, by its own limits; one that somehow did not is waited
 * for no longer than two looks may take, and then no longer stands in the
 * way of the ones behind it.
 */
function inTurn(host: ScribeHost, scribe: Scribe, epoch: number, look: () => Promise<void>): Promise<void> {
  const run = (): Promise<void> => (epoch === scribe.epoch ? look() : Promise.resolve())
  const mine = (scribe.looking === null ? Promise.resolve() : within(host, scribe.looking, 2 * WAKE_DEADLINE_MS)).then(run)
  const ended = mine.catch(() => undefined)

  scribe.looking = ended
  void ended.then(() => {
    if (scribe.looking === ended) {
      scribe.looking = null
    }
  })

  return mine
}

/** Who Scribe works for, when it may read and ask now: null when it is off, or signed out. */
async function reader(host: ScribeHost, scribe: Scribe): Promise<Identity | null> {
  const who = await identityOf(host, scribe)

  // Signed out, nothing is read and no model is asked.
  return who === null || (await connected(host)) === undefined ? null : who
}

/**
 * A step of the main conversation begins: Claude is working, whoever began
 * the turn. A turn a background task began has no prompt to say so.
 */
export function began(scribe: Scribe): void {
  scribe.band.isWorking = true
}

/**
 * A step of the main conversation begins. When a step before it put a
 * question to the developer and the rows now hold their answer, Scribe looks
 * right then, as it does at a turn's end: most decisions are made in such
 * an answer, and the turn may go on for a long time after it.
 *
 * The step does not wait for this, and neither does the turn. What it
 * resolves with says only that the look has ended.
 */
export async function stepping(host: ScribeHost, scribe: Scribe): Promise<void> {
  if (!scribe.isAsking) {
    return
  }

  const { epoch } = scribe
  const who = await reader(host, scribe)

  if (who === null) {
    return
  }

  scribe.cut ??= new AbortController()

  const cut = scribe.cut.signal

  await inTurn(host, scribe, epoch, () => look(host, scribe, who, epoch, cut))
}

/**
 * How long a turn's end waits for a look begun inside the turn to end, once
 * it has been told to stop. The end of a turn has little time of its own,
 * and waiting for work begun elsewhere is paid from it.
 */
export const INSIDE_WAIT_MS = 2000

/**
 * A turn of the main conversation ended. Scribe looks at what happened
 * since it last looked.
 *
 * A look begun inside the turn that has not come to its verdict is stopped,
 * and ends at once: it leaves its rows as it found them, and this look reads
 * them with the rest. One that is past its verdict, writing down what it
 * came to, cannot be stopped and is given a moment. If it needs longer, no
 * look is made now: two would write at once. The rows that came after it
 * are then read at the next turn's end, whoever begins that turn, and not
 * before.
 */
export async function completed(host: ScribeHost, scribe: Scribe): Promise<void> {
  scribe.band.isWorking = false
  // One question a turn: where a look inside the turn asked, that was it.
  scribe.band.hasAskedThisTurn = scribe.hasAskedInside
  scribe.hasAskedInside = false
  scribe.turn += 1
  // Whatever the turn asked the developer is in its rows by now, answered or not.
  scribe.isAsking = false
  scribe.cut?.abort()
  scribe.cut = null

  // The conversation the turn was in: one that starts over while Scribe gets ready is not looked at under it.
  const { epoch } = scribe
  let isRead = true

  try {
    const who = await reader(host, scribe)

    if (who === null) {
      // No look is made of this turn, so none will take the rows held for one.
      scribe.held = []

      return
    }

    // What an earlier load kept in this conversation is listed, and known to the look, before the look writes anything; for a moment at most.
    await within(host, recover(host, scribe), RECOVER_WAIT_MS)

    // The marks of a conversation that kept records follow its rows, so a fork of it later is told from its siblings.
    if (scribe.written.length > 0) {
      save(host, scribe)
    }

    if (scribe.looking !== null) {
      await within(host, scribe.looking, INSIDE_WAIT_MS)
    }

    if (scribe.looking !== null) {
      // What waited for Claude to finish may come up now.
      settle(host, scribe)
      // The turn stays the developer's: its remaining rows are looked at when the next turn ends.
      isRead = false

      return
    }

    await inTurn(host, scribe, epoch, () => look(host, scribe, who, epoch))
  } finally {
    if (isRead) {
      scribe.hasAnsweredInTurn = false
    }
  }
}

/**
 * One look. Scribe reads what happened since it last looked, looks up the
 * files touched, runs one wake over it, acts on the verdict, and attaches
 * any commit made to the session's records.
 *
 * A model is asked only for a turn that is the developer's (they started
 * it, or decided something in it), that has something in it, and only once
 * a call of Scribe's own has got through to Fylgja. A wake that did not come
 * to a verdict, or was not begun, leaves the rows unread, so the next look
 * has them too.
 *
 * @param cut given to a look made inside a turn, for an answer the
 *   developer gave to a question of Claude's; it aborts when the turn ends.
 *   With no such answer among the rows not yet seen, nothing is done: they
 *   wait for the turn's end. Such a look either goes all the way or leaves
 *   everything as it found it. Stopped, come to no verdict, or with a call
 *   to Fylgja that did not get through while it wrote down what it came to,
 *   it leaves its rows unread and the answer as one no look was begun for:
 *   the turn's end looks at them as if this look had never been tried.
 */
async function look(host: ScribeHost, scribe: Scribe, who: Identity, epoch: number, cut?: AbortSignal): Promise<void> {
  const isInside = cut !== undefined

  if (cut?.aborted === true) {
    return
  }

  const rows = await host.rows()

  // Started over while the rows were read: they, and `who`, may be another conversation's.
  if (epoch !== scribe.epoch) {
    return
  }

  const from = startOf(scribe, rows)
  const { held, compactions } = scribe
  // What a compaction took away unread comes first: it is older than every row that is there now.
  const unseen = held.length === 0 ? rows.slice(from) : [...held, ...rows.slice(from)]
  const seen = observe(unseen, who.root, scribe.prompts, scribe.index)
  // An answer to a question of Claude's that no look has been begun for.
  const isAnswered = seen.acts.some(act => isAnswer(act) && !scribe.acted.has(act.key))

  if (isInside) {
    scribe.isAsking = hasOpenQuestion(unseen)

    if (!isAnswered) {
      return
    }
  }

  const { turn } = scribe
  const hadAsked = scribe.band.hasAskedThisTurn
  // What a look inside a turn puts back when it does not go all the way.
  const found: Found = {
    consumed: scribe.consumed,
    mark: scribe.mark,
    seam: scribe.seam,
    hasActed: scribe.hasActed,
    hasPrompt: scribe.hasPrompt,
    hasAnsweredInTurn: scribe.hasAnsweredInTurn,
    commitsToPair: scribe.commitsToPair,
    earlier: scribe.earlier,
    anchored: new Map(),
    acts: [],
    taken: undefined,
  }
  let isWhole = false
  const tally: Tally = { ending: 'stopped', noReply: undefined, steps: 0, lookups: 0, usage: undefined, proposed: 0 }
  const began = performance.now()
  const { wrote, refused, letGo: before } = scribe

  scribe.refusedBy = undefined
  scribe.letGoBy = undefined

  try {
    isWhole = await looked(host, scribe, who, { epoch, rows, from, unseen, compactions, seen, isAnswered, found, cut, tally })
  } finally {
    host.report('look', {
      trigger: isInside ? 'answered_question' : 'turn_end',
      ending: tally.ending,
      ...(tally.noReply === undefined ? {} : { no_reply_reason: tally.noReply }),
      is_whole: isWhole,
      duration_ms: performance.now() - began,
      steps: tally.steps,
      lookups: tally.lookups,
      ...(tally.usage === undefined
        ? {}
        : {
            input_tokens: tally.usage.input,
            output_tokens: tally.usage.output,
            cache_read_tokens: tally.usage.cacheRead,
            cache_write_tokens: tally.usage.cacheWrite,
          }),
      rows_read: unseen.length,
      rows_held: held.length,
      drafts_proposed: tally.proposed,
      drafts_written: scribe.wrote - wrote,
      drafts_refused: scribe.refused - refused,
      ...(scribe.refusedBy === undefined
        ? {}
        : { first_refusal_code: wordOf(SCHEMA.events.look.first_refusal_code.oneOf, scribe.refusedBy, 'other') }),
      drafts_dropped: scribe.letGo - before,
      ...(scribe.letGoBy === undefined ? {} : { first_drop_reason: scribe.letGoBy }),
      calls_missed: missedBy(host),
    })

    if (isInside && !isWhole && epoch === scribe.epoch) {
      if (compactions === scribe.compactions) {
        scribe.consumed = found.consumed
        scribe.mark = found.mark
        scribe.seam = found.seam
        scribe.held = held
      } else if (found.taken !== undefined) {
        // Compacted meanwhile: the count is the compaction's, and the rows this look read are in no conversation any more.
        scribe.held = [...found.taken, ...scribe.held]
      }

      scribe.hasActed = found.hasActed
      scribe.hasPrompt = found.hasPrompt
      scribe.hasAnsweredInTurn = found.hasAnsweredInTurn
      scribe.commitsToPair = found.commitsToPair
      scribe.earlier = found.earlier

      for (const [id, fact] of found.anchored) {
        scribe.anchored.set(id, fact)
      }

      for (const act of found.acts) {
        const at = scribe.spoken.lastIndexOf(wordsOf(act))

        scribe.acted.delete(act.key)

        if (at !== -1) {
          scribe.spoken.splice(at, 1)
        }
      }
    }

    // A question it put in line is the one question of the turn it was made in.
    if (isInside && turn === scribe.turn && !hadAsked && scribe.band.hasAskedThisTurn) {
      scribe.hasAskedInside = true
    }
  }
}

/**
 * `work`, or undefined as soon as `cut` aborts. `work` goes on either way;
 * a model call it has under way is cut by the same signal, and whatever it
 * comes to after that is let go.
 */
function unless<T>(cut: AbortSignal | undefined, work: Promise<T>): Promise<T | undefined> {
  return cut === undefined
    ? work
    : new Promise((resolve, reject) => {
        if (cut.aborted) {
          resolve(undefined)
        }

        cut.addEventListener('abort', () => resolve(undefined))
        work.then(resolve, reject)
      })
}

/** An act's words as they are kept with the developer's prompts. */
function wordsOf(act: { words: string }): string {
  return act.words.replace(/\s+/g, ' ').trim()
}

/** What a look changes before it has gone all the way, as it was found: a look inside a turn may have to put it back. */
type Found = Pick<Scribe, 'consumed' | 'mark' | 'seam' | 'hasActed' | 'hasPrompt' | 'hasAnsweredInTurn' | 'commitsToPair' | 'earlier'> & {
  /** The records the lookups had found when the verdict came. */
  anchored: Map<string, Fact>
  /** What the developer decided that this look was the first to see. */
  acts: { key: string; words: string }[]
  /** The rows this look read, once its verdict counted them as gone through. */
  taken: readonly Row[] | undefined
}

/** What a look has in hand once it has read the rows. */
type Sight = {
  /** The conversation the look was begun in: what it comes to is let go once that one has started over. */
  epoch: number
  rows: readonly Row[]
  from: number
  /** The rows this look reads: what a compaction took away unread, then the rows from `from` on. */
  unseen: readonly Row[]
  /** How many times the conversation had been compacted when the rows were read. */
  compactions: number
  seen: ReturnType<typeof observe>
  isAnswered: boolean
  found: Found
  cut: AbortSignal | undefined
  tally: Tally
}

/** What a look came to, as it is reported: how it ended, and what its wake took. Counts alone. */
type Tally = {
  ending: Word<'look', 'ending'>
  noReply: Word<'look', 'no_reply_reason'> | undefined
  steps: number
  lookups: number
  usage: Usage | undefined
  /** The records the verdict held. */
  proposed: number
}

/**
 * The body of a look, from the rows read to its last call. Whether it went
 * all the way: it came to a verdict, and a look inside a turn wrote down
 * what the verdict held with every call to Fylgja getting through.
 */
async function looked(host: ScribeHost, scribe: Scribe, who: Identity, sight: Sight): Promise<boolean> {
  const { epoch, rows, from, unseen, compactions, seen, isAnswered, found, cut, tally } = sight
  const isInside = cut !== undefined
  // Whether the turn has ended since: read anew each time, as it changes while this waits.
  const isStopped = (): boolean => cut?.aborted === true
  let isWhole = false

  // Held from here on: a wake that comes to nothing leaves these rows for the next.
  scribe.consumed = from
  scribe.mark = markOf(rows[from - 1])
  scribe.seam = undefined

  for (const plan of seen.plans) {
    if ('text' in plan) {
      Plans.keep(scribe.plans, plan.key, plan.path, plan.text)
    } else {
      Plans.edit(scribe.plans, plan.key, plan.before, plan.after)
    }

    // Read or changed in this turn: sent whole for the wakes that follow.
    scribe.plans.docs = scribe.plans.docs.map(doc => (doc.key === plan.key ? { ...doc, touchedAt: scribe.wakes } : doc))
  }

  // Which repository each file of the turn lies in: a record is filed under
  // the one its files are in, and each repository is asked about its own.
  // Everything a look inside a turn waits for before its verdict is let go
  // of the moment the turn ends, so that the turn's end finds no look under
  // way and reads the rows itself.
  const here = await unless(cut, placesOf(host, scribe, who, seen.files))

  await unless(
    cut,
    placesOf(
      host,
      scribe,
      who,
      scribe.plans.docs.flatMap(doc => (doc.key.startsWith('/') ? [doc.key] : [])),
    ),
  )

  const changed = await unless(cut, placesOf(host, scribe, who, seen.changed))

  if (here === undefined || changed === undefined || isStopped()) {
    return false
  }

  // What was written or changed, per repository, since its last commit; and
  // the commits made since the last look, each with those files. A commit is
  // the moment a decision recorded before its code existed can be given its
  // place: the next look is asked to pair them, once.
  // Noted now, each once, and attached at the end of a look: this one's, or
  // a later one's when this one is stopped or its rows are read again. Each
  // commit is given the files changed before it, in the order of the rows;
  // what was changed after the last one waits for the next.
  for (const commit of seen.landed) {
    // Seen by a look before this one: its files were noted then.
    if (scribe.commits.has(commit.sha)) {
      continue
    }

    noteEdits(scribe, who, commit.before, changed)
    scribe.commits.add(commit.sha)

    for (const file of commit.created) {
      scribe.created.add(file)
    }

    // Made after the shell was taken out of the working tree: it is some
    // other repository's commit, and is neither attached here nor given files.
    if (commit.isAway === 'outside') {
      continue
    }

    scribe.toAttach = [
      ...scribe.toAttach,
      { sha: commit.sha, ...(who.repo === null ? { paths: [], rule: 'none_no_repo' as const } : reportedWith(scribe, who, who.repo, commit)) },
    ].slice(-MAX_PENDING_COMMITS)
  }

  noteEdits(scribe, who, seen.loose, changed)
  scribe.index = seen.index

  for (const file of seen.created) {
    scribe.created.add(file)
  }

  wanted(scribe, who, here)

  // The developer's rows are told from every other by the prompt they sent.
  // Where no row holds it, their words are not labelled as theirs; that is
  // worth knowing, and says nothing of what was written.
  if (scribe.hasPrompt && seen.developer === '' && once(scribe, 'no-prompt-row')) {
    host.debug(
      'Scribe: a prompt was sent and no row of the conversation holds it; the turn is read without what the developer wrote',
    )
    host.report('error', { component: 'scribe', kind: 'no_prompt_row' })
  }

  // The first call of a session is waited for: whether it gets through
  // decides whether Scribe runs at all. After that a slow lookup does not
  // hold the turn's end.
  if (scribe.isGranted) {
    await unless(
      cut,
      within(
        host,
        lookUp(host, scribe, who).catch(() => undefined),
        LOOKUP_WAIT_MS,
      ),
    )
  } else {
    const first = lookUp(host, scribe, who, true).catch(() => undefined)

    // Waited for in full once. A server that did not answer then is not
    // given more than a moment at each later turn's end.
    await unless(cut, scribe.hasAsked ? within(host, first, LOOKUP_WAIT_MS) : first)

    // The turn ended meanwhile: its end asks for itself, and waits in full.
    if (isStopped()) {
      return false
    }

    scribe.hasAsked = true
  }

  if (scribe.identity === null || !scribe.isGranted || isStopped()) {
    tally.ending = isStopped() ? 'stopped' : 'not_granted'

    return false
  }

  // What waits from earlier turns is a turn's end's to do.
  if (!isInside) {
    await flush(host, scribe, who)
  }

  const now = await host.now()

  // The conversation started over while the files were looked up: what
  // these rows hold is the one before's, and nothing of it goes into the
  // new one or to a model.
  if (epoch !== scribe.epoch) {
    return false
  }

  // What the developer decided without typing: an answer to a question put
  // to them, a plan approved, a plan or a call turned down with a word. Kept
  // with their prompts, each once, and enough to make the turn theirs: a
  // turn a background task began is looked at when they decided something in it.
  // Of each, only their own words are kept with their prompts: the label
  // they picked or what they typed, never the question and never what an
  // option was said to mean.
  for (const act of seen.acts) {
    if (!scribe.acted.has(act.key)) {
      scribe.acted.add(act.key)
      found.acts.push(act)
      spoke(scribe, wordsOf(act))
      scribe.hasActed = true
    }
  }

  scribe.offered = [...new Set([...scribe.offered, ...seen.offered])].slice(-MAX_OFFERED)
  // What the picked options were said to mean is the assistant's: kept apart, each question once.
  scribe.offers = [
    ...scribe.offers,
    ...seen.offers.filter(offer => !scribe.offers.some(had => had.question === offer.question)),
  ].slice(-MAX_OFFERS)

  const isWorthAsking = seen.lines.length > 0 && (seen.hasChange || seen.words >= QUIET_TURN_CHARS || scribe.hasActed)

  // What the assistant said in this turn and the one before it, cut to a length.
  // Each with whether the developer wrote or chose anything after it: only then can they have accepted what it proposed.
  const isTheirs = (line: string): boolean => line.startsWith('[developer')
  const replies: Proposal[] = seen.lines.flatMap((line, at) =>
    line.startsWith('[claude] ')
      ? [{ text: line.slice(9, 9 + MAX_PROPOSAL_CHARS), isFollowed: seen.lines.slice(at + 1).some(isTheirs) }]
      : [],
  )
  const hasSpoken = seen.lines.some(isTheirs)

  scribe.proposals = [...scribe.earlier.map(one => ({ ...one, isFollowed: one.isFollowed || hasSpoken })), ...replies].slice(
    -MAX_PROPOSALS,
  )

  // The developer's turn, with something in it; and then within the hour's share of wakes.
  const isDue = (scribe.hasPrompt || scribe.hasActed || scribe.hasAnsweredInTurn) && isWorthAsking
  const isWoken = isDue && mayWake(host, scribe, now, isAnswered)

  tally.ending = !isDue ? 'skipped_gate' : !isWoken ? 'skipped_cap' : 'stopped'

  if (isWoken) {
    scribe.wakingSince = now
    scribe.wakeTimes.push(now)

    try {
      // The look is under way from here: the mark says it is reading.
      host.mark()

      // A record the developer said no longer holds is shown first, to a few looks, and then let go.
      for (const [id, one] of scribe.denied) {
        if (scribe.wakes - one.since >= DENIED_WAKES) {
          scribe.denied.delete(id)
        }
      }

      // As Fylgja last returned it where this look has it, and by its sentence alone where it has not.
      const denied = [...scribe.denied].map(
        ([id, one]): Fact =>
          scribe.anchored.get(id) ?? {
            id,
            kind: 'decision',
            content: one.content,
            detail: '',
            alternatives: [],
            anchors: [],
            addedByOthers: [],
            reasonStatus: null,
            date: one.date,
            origin: '',
            link: null,
            changed: null,
          },
      )
      const shown = [...denied, ...[...scribe.anchored.values()].filter(fact => !scribe.denied.has(fact.id))].slice(0, MAX_SHOWN)
      const plans = planBlock(scribe.plans.docs, scribe.wakes)
      const past = scribe.past.map((block, at) => (at === scribe.past.length - 1 ? { ...block, cache: true as const } : block))
      const allowed = new Set(scribe.places.keys())
      // Scribe's own decisions of the session that point at no code yet, and the first commit that has some to place.
      await askGit(host, scribe)

      const unplaced = new Map(
        scribe.written.flatMap(one =>
          scribe.mine.has(one.id) && isWaiting(one) && typeof one.repo === 'string'
            ? [[one.id, one] as const]
            : [],
        ),
      )
      const mine = scribe.written.filter(one => scribe.mine.has(one.id))
      const due = scribe.commitsToPair.find(
        commit => commit.files.length > 0 && [...unplaced.values()].some(one => one.repo === commit.repo),
      )
      const pairing =
        due === undefined
          ? undefined
          : {
              repo: due.repo,
              files: due.files.slice(0, MAX_COMMIT_FILES),
              records: [...unplaced.values()]
                .filter(one => one.repo === due.repo)
                .map(one => ({ id: one.id, content: one.content })),
            }
      const judged = {
        plans: scribe.plans.docs,
        saidNoReason: mentionsNoReason(seen.developer),
        statedNoReason: statesNoReason(seen.developer),
        offered: seen.offeredText,
        typed: seen.developer,
        paths: allowed,
        places: scribe.places,
        gitStates: scribe.gitStates,
        waiting: new Set(unplaced.keys()),
        changed: scribe.changedPlaces,
        // A turn that touched no file itself (the developer steering, agents
        // doing the work) is about the repository the session has been
        // working in: the one most of its files so far lie in, or its own.
        home:
          homeOf(here, who.repo) ??
          homeOf(
            [...scribe.filesIn].flatMap(([repo, count]) => Array.from({ length: count }, () => ({ repo, path: '' }))),
            who.repo,
          ) ??
          who.repo,
        own: new Set(mine.map(one => one.id)),
        ownRepos: new Map(mine.flatMap(one => (typeof one.repo === 'string' ? [[one.id, one.repo] as const] : []))),
        choices: seen.choices,
      }
      const woken = await unless(cut, wake(host, {
        model: scribe.model,
        system: SYSTEM,
        fixed: [
          ...(plans === undefined ? [] : [plans]),
          ...(scribe.folded.block === undefined ? [] : [scribe.folded.block]),
          ...past,
        ],
        current: wakeText(
          who.repo ?? 'none: the session started in a folder that is no repository',
          seen.lines,
          seen.dropped,
          shown,
          {
            recorded: scribe.recorded.map(one => ({ ...one, hasPlace: one.id === null ? undefined : !unplaced.has(one.id) })),
            commit: pairing,
            stated: scribe.stated,
            asked: scribe.asked,
            told: [...scribe.band.told].slice(-MAX_LISTED),
            denied: denied.map(fact => fact.id),
          },
        ),
        repo: judged.home ?? who.repo,
        shown,
        seen: judged,
        ...(cut === undefined ? {} : { signal: cut }),
      }))

      if (woken !== undefined) {
        tally.steps = woken.steps
        tally.lookups = woken.lookups
        tally.usage = woken.usage
        tally.ending = woken.ending === 'no-reply' ? 'no_reply' : woken.ending === 'verdict' ? 'stopped' : woken.ending
        tally.noReply = woken.noReply
      }

      // A verdict that comes once the turn has ended is let go: the turn's end is reading these rows by then.
      if (woken?.ending === 'verdict' && epoch === scribe.epoch && !isStopped()) {
        tally.ending = 'verdict'
        tally.proposed = woken.verdict.records.length

        const before = scribe.written.length
        const missed = missedBy(host)

        for (const [id, fact] of scribe.anchored) {
          found.anchored.set(id, fact)
        }

        found.taken = unseen

        if (compactions === scribe.compactions) {
          scribe.consumed = rows.length
          scribe.mark = markOf(rows.at(-1))
          scribe.held = []
        } else {
          // Compacted under this look: the rows it read were held with the rest, and the count is the compaction's.
          scribe.held = scribe.held.slice(unseen.length)
        }

        scribe.hasPrompt = false
        // What comes after the answer is the developer's turn too: its end is looked at as theirs.
        scribe.hasAnsweredInTurn = isInside
        scribe.hasActed = false
        // Each commit is asked about once: the ones this look could be asked about are done with.
        scribe.commitsToPair = []
        scribe.lateProposed += woken.verdict.proposed ?? 0
        scribe.earlier = replies.slice(-MAX_PROPOSALS)
        scribe.anchored.clear()
        scribe.wakes += 1
        await apply(host, scribe, who, woken.verdict, woken.facts, {
          steps: MAX_STEPS - woken.steps,
          lookups: MAX_LOOKUPS - woken.lookups,
          until: woken.startedAt + WAKE_DEADLINE_MS,
          seen: { ...judged, facts: woken.facts },
          window: { recent: seen.lines, earlier: earlierLines(scribe) },
        })
        isWhole = !isInside || missedBy(host) === missed

        // A look whose rows will be read again is not kept as one that was
        // made. What it did write is on record, and listed as recorded.
        if (isWhole) {
          scribe.past = [
            ...scribe.past,
            pastBlock(scribe.wakes, gist(seen.lines), summaryOf(woken.verdict, scribe.written.slice(before))),
          ]

          // The oldest are folded into one line, in one piece, so the blocks
          // that stay are read from the prompt cache until the next cut.
          if (scribe.past.length > MAX_PAST) {
            const gone = scribe.past.length - MAX_PAST / 2

            scribe.past = scribe.past.slice(gone)
            scribe.folded.wakes += gone
            scribe.folded.block = foldedBlock(scribe.folded.wakes, scribe.recorded.length)
          }
        }
      }
    } finally {
      // Every look ends here, whatever it came to: the mark stops saying it is reading.
      scribe.wakingSince = 0
      host.mark()
    }
  }

  // The turn ended meanwhile. What this look came to stands as it is, and
  // what it wrote is shown. The commits it saw stay noted, and the look
  // that comes next attaches them.
  if (isStopped()) {
    settle(host, scribe)

    return isWhole
  }

  // A commit made in this repository is attached to what the session
  // recorded: Scribe's records and Claude's own. Fylgja attaches it once.
  // One whose call did not get to Fylgja stays noted for the next look. One
  // that Fylgja did not answer in time is let go: it is not waited for twice.
  for (const commit of scribe.toAttach) {
    // A commit at the session's own root is its repository's; a session with none attaches none.
    const isDone =
      who.repo === null ||
      (await attach(host, scribe, who, who.repo, commit).then(
        () => true,
        (error: unknown) => error instanceof TimedOut,
      ))

    if (isDone) {
      scribe.toAttach = scribe.toAttach.filter(one => one !== commit)
    }
  }

  // Last, so that a question the look itself came to is this turn's one question.
  askHolds(host, scribe)
  settle(host, scribe)

  if (!isInside) {
    await flush(host, scribe, who)
    settle(host, scribe)
  }

  return isWhole
}

/** Keeps something the developer wrote or chose, for the session, within its length: the oldest go first. */
function spoke(scribe: Scribe, text: string): void {
  if (text === '') {
    return
  }

  scribe.spoken.push(text)

  for (let size = scribe.spoken.reduce((sum, one) => sum + one.length, 0); size > MAX_SPOKEN_CHARS && scribe.spoken.length > 1;) {
    size -= scribe.spoken.shift()?.length ?? 0
    scribe.unspoken += 1
  }
}

/**
 * The developer sent a prompt. Only what is already in hand is worked on,
 * and nothing is waited for: the prompt goes on at once.
 *
 * @param text the prompt as it goes to Claude; held in the running plugin to
 *   tell the developer's rows from every other, and nowhere else
 */
export function prompted(host: ScribeHost, scribe: Scribe, text: string): void {
  const { band } = scribe
  const wasQuiet = band.current === null && band.receipt === null && band.queue.length === 0 && band.held.length === 0
  const item = Band.submitted(band)

  // Taken down unanswered by the prompt that was sent past it.
  if (item?.kind === 'question') {
    answeredBy(host, item, 'expired')
  }

  scribe.hasPrompt = true
  scribe.prompts.add(plain(text))

  // The developer's own words are kept for the session: a reason they gave
  // is looked for here before they are asked for it.
  spoke(scribe, plain(text))

  for (const old of scribe.prompts) {
    if (scribe.prompts.size <= MAX_PROMPTS) {
      break
    }

    scribe.prompts.delete(old)
  }

  // What was said once on the status line has been there long enough.
  if (scribe.said.has('off') && once(scribe, 'off-cleared')) {
    host.status(undefined)
  }

  if (wasQuiet) {
    return
  }

  if (item?.kind === 'question' && item.form === 'reversal') {
    defer(scribe, { draft: { ...item.draft, supersedes: null }, against: item.prior.id })
  }

  keep(host, band)
  settle(host, scribe)
}

/** The prompt box changed. Once it is empty again, what waited for the developer to stop typing comes up. */
export function typed(host: ScribeHost, scribe: Scribe, text: string): void {
  const isTyping = text !== ''
  const wasTyping = scribe.band.isTyping

  scribe.band.isTyping = isTyping

  if (wasTyping && !isTyping && (scribe.band.queue.length > 0 || scribe.band.held.length > 0)) {
    settle(host, scribe)
  }
}

/** One line of a note: a record's words made safe to draw, and never one of the box's own marks. */
function quoted(text: string, max: number): string {
  return drawn(text, max).replace(/@/g, '(at)')
}

/** A record as a note for the prompt box: quoted, every line made safe, and said to be information. */
function noteOf(lead: string, fact: Fact): string {
  const quote = [
    `${fact.kind === 'gotcha' ? 'Gotcha' : fact.kind === 'decision' ? 'Decision' : 'Record'}: ${quoted(fact.content, MAX_CONTENT)}`,
    fact.reasonStatus === 'no_strong_reason'
      ? NO_STRONG_REASON
      : fact.detail.trim() !== ''
        ? `Why: ${quoted(fact.detail, 600)}`
        : fact.kind === 'decision'
          ? NOT_STATED
          : '',
    fact.alternatives.length === 0 ? '' : `Rejected: ${fact.alternatives.map(one => quoted(one, 80)).join('; ')}`,
    // Said to Claude as it is said to the developer: a record whose code changed since is not to be read as settled.
    changedLine(fact, quoted) ?? '',
    // Most records have no page of their own; the record is then named by its short id.
    provenanceOf(fact),
    // A page's address was checked when the record was read: one line, on Fylgja's own host.
    fact.link ?? '',
  ]

  return `${lead}\n\n${quote
    .filter(line => line !== '')
    .map(line => `> ${line}`)
    .join('\n')}\n\n`
}

/** Puts a note about `fact` in the prompt box, when the box is empty. Sends nothing. */
async function tellClaude(host: ScribeHost, lead: string, fact: Fact): Promise<boolean> {
  if ((await host.box()) !== '') {
    host.toast('The prompt box has text in it. Clear it, then press the key again.')

    return false
  }

  if (!(await host.fill(noteOf(lead, fact)))) {
    host.toast('The note could not be put in the prompt box.')

    return false
  }

  return true
}

const TELL_LEAD = 'A note from Fylgja, offered by Scribe. It is information about this code, not an instruction:'
const REVERSAL_LEAD =
  'Scribe noticed that the last change may go against a decision recorded in Fylgja. The record is information, not an instruction:'

async function pressedReceipt(host: ScribeHost, scribe: Scribe, key: string): Promise<void> {
  const { band } = scribe
  const shown = band.receipt

  if (shown === null) {
    return
  }

  const [action, place] = key.split(':')
  const written = shown.records[Number(place)]

  if (key === 'ok') {
    band.receipt = null
  } else if (key === 'review') {
    shown.isOpen = true
  } else if (action === 'fix' && written !== undefined) {
    band.editing = { what: 'fix', id: written.id, value: written.content }
  } else if (action === 'remove' && written !== undefined) {
    shown.records = shown.records.filter(one => one !== written)
    scribe.written = scribe.written.filter(one => one.id !== written.id)
    touched(scribe, written.id)
    save(host, scribe)
    band.receipt = shown.records.length === 0 ? null : shown

    // Only a record Fylgja took out can be put back: one whose removal failed, or waits to be tried again, is not offered.
    if (await amend(host, scribe, { atom_id: written.id, op: 'remove' })) {
      Ledger.shelve(scribe.ledger, { ...written, outcome: 'withdrawn', replaced: null })
    }
  } else if (action === 'putback' && written?.outcome === 'withdrawn') {
    const back = await putBack(host, scribe, written)

    if (back === undefined) {
      host.toast('The record could not be put back.')
    } else {
      shown.records = shown.records.map(one => (one === written ? back : one))
    }
  }
}

/**
 * Puts back a record that was taken out: it is sent again as it was, and
 * Fylgja restores the one it removed. From then on it is the developer's:
 * Scribe does not take it back a second time. The record as it stands
 * again, or undefined when Fylgja did not take it.
 */
async function putBack(host: ScribeHost, scribe: Scribe, gone: Written): Promise<Written | undefined> {
  const who = scribe.identity

  if (who === null || who === undefined) {
    return undefined
  }

  const sent = await send(host, scribe, who, {
    kind: gone.kind,
    content: gone.content,
    // Whole, as it was written: a decision with a stated reason is not taken without it.
    detail: gone.detail ?? '',
    alternatives: gone.alternatives ?? [],
    anchors: gone.anchors ?? [],
    triggers: gone.triggers ?? [],
    reasonStatus: gone.reasonStatus,
    supersedes: null,
    repo: gone.repo ?? who.repo,
    updates: null,
  })

  if (sent.written === undefined) {
    return undefined
  }

  touched(scribe, sent.written.id)
  scribe.ledger.gone = scribe.ledger.gone.filter(one => one.id !== gone.id)

  // Back as it was; where another member holds the same record, theirs is shown as theirs.
  if (sent.written.outcome === 'held') {
    return sent.written
  }

  const back: Written = { ...sent.written, outcome: 'restored' }

  // Among the session's records it reads as put back too, whatever id Fylgja gave it.
  scribe.written = scribe.written.map(one => (one.id === back.id ? back : one))
  save(host, scribe)

  return back
}

async function pressedTell(host: ScribeHost, scribe: Scribe, item: Band.Tell, key: string): Promise<void> {
  const { band } = scribe

  if (key === 'open') {
    item.isOpen = true
  } else if (key === 'tell-claude') {
    if (await tellClaude(host, TELL_LEAD, item.fact)) {
      Band.clear(band)
    }
  } else if (key === 'knew') {
    Band.know(band, item.fact.id)
    Band.clear(band)
  } else if (key === 'dismiss') {
    Band.clear(band)
  }
}

/** Saves the developer's answer to "why" on the record it was asked about, and shows that it was saved. */
async function reasoned(
  host: ScribeHost,
  scribe: Scribe,
  item: Band.ReasonQuestion,
  answer: { detail?: string; reason_status: 'stated' | 'no_strong_reason' },
): Promise<void> {
  // Their answer makes the record theirs, whether or not Fylgja takes it at once.
  touched(scribe, item.id)

  if (await amend(host, scribe, { atom_id: item.id, op: 'fix', ...answer })) {
    // The record as the session holds it has the reason from here on: what the window shows, and what is put back.
    scribe.written = scribe.written.map(one =>
      one.id === item.id ? { ...one, reasonStatus: answer.reason_status, detail: answer.detail ?? one.detail } : one,
    )
    Band.receive(scribe.band, [
      {
        id: item.id,
        kind: 'decision',
        content: item.content,
        reasonStatus: answer.reason_status,
        outcome: 'reasoned',
        replaced: null,
      },
    ])
  }
}

/**
 * Whether Fylgja still returns `fact` as a record that stands, asked by the
 * files it is anchored to, for as many records as Fylgja gives of one
 * lookup: `settled` when it does and no longer reads as changed, `gone`
 * when it does not and fewer than that many came back, `unchecked` when
 * that many came back without it, so that it may stand among the ones not
 * returned. Rejects when Fylgja could not be asked.
 */
async function standingOf(
  host: ScribeHost,
  scribe: Scribe,
  repo: string,
  fact: Fact,
): Promise<'changed' | 'settled' | 'gone' | 'unchecked'> {
  const paths = fact.anchors.map(anchor => anchor.path).slice(0, MAX_LOOKUP_PATHS)
  const answer = await call(host, scribe, 'recall', { repo, paths, limit: MOST_RECALLED })
  const returned = Array.isArray(answer?.facts) ? answer.facts.length : 0
  const now = factsOf(answer).find(one => one.id === fact.id)

  return now !== undefined ? (now.changed === null ? 'settled' : 'changed') : returned < MOST_RECALLED ? 'gone' : 'unchecked'
}

/**
 * The developer answered whether a recorded decision still holds.
 *
 * "Still holds" confirms the record again, the way anything is written to
 * Fylgja: it is sent as it stands with the id it was returned under, and
 * Fylgja moves the day it was last confirmed, so the mark that its code
 * changed is gone. A record sent that way and no longer standing would be
 * written as a new one, so Fylgja is asked first whether it still returns
 * the record: one that was replaced or removed since is not sent at all,
 * and neither is one that could not be looked for among all it returned.
 * Nothing is shown for a confirmation that went through. One that did not
 * (the record is gone, Fylgja refused it, or could not be reached) is said
 * on the card in one line, and the record stays marked.
 *
 * "No longer holds" writes nothing, and the card says so. Only the author
 * of a record can change it, and what takes its place is not known here:
 * the record is shown to the next few looks as one the developer gave up,
 * through a compaction and not past a `/clear`, and the decision that
 * replaces it then comes the way every
 * replacement does, as the question whether it replaces the recorded one,
 * which only the developer's key settles. The record keeps its mark.
 *
 * "Skip" leaves the record as it is, marked.
 */
async function pressedHolds(host: ScribeHost, scribe: Scribe, who: Identity, item: Band.HoldsQuestion, key: string): Promise<void> {
  const { band } = scribe
  const { fact } = item

  // The card has said what came of the answer: any key puts it away.
  if (item.said !== undefined) {
    Band.clear(band)
  } else if (key === 'holds') {
    const standing = await standingOf(host, scribe, item.repo, fact).catch(() => undefined)

    if (standing === undefined || standing === 'gone' || standing === 'unchecked') {
      item.said = standing ?? 'unconfirmed'

      return
    }

    // Confirmed by somebody else meanwhile: there is nothing left to do.
    const sent =
      standing === 'settled'
        ? undefined
        : await send(
            host,
            scribe,
            who,
            {
              kind: 'decision',
              content: fact.content,
              detail: fact.detail,
              alternatives: fact.alternatives,
              // Its places stay as they are: none is sent, so none is added.
              anchors: [],
              triggers: [],
              reasonStatus: fact.reasonStatus,
              supersedes: null,
              repo: item.repo,
              updates: null,
            },
            undefined,
            fact.id,
          )

    if (sent !== undefined && !sent.isTaken) {
      item.said = 'unconfirmed'

      return
    }

    Band.clear(band)
    // As Fylgja now holds it, wherever this session shows it again.
    fact.changed = null

    // Written anew after all, because it stopped standing between the two calls: shown as anything written is.
    if (sent?.written !== undefined && sent.written.outcome !== 'held') {
      Band.receive(band, [sent.written])
    }
  } else if (key === 'no-longer') {
    item.said = 'given-up'
    scribe.denied.delete(fact.id)
    scribe.denied.set(fact.id, { content: fact.content, date: fact.date, since: scribe.wakes })

    for (const id of [...scribe.denied.keys()].slice(0, -MAX_DENIED)) {
      scribe.denied.delete(id)
    }
  } else if (key === 'skip') {
    band.unanswered += 1
    Band.clear(band)
  }
}

async function pressedQuestion(host: ScribeHost, scribe: Scribe, who: Identity, item: Band.Question, key: string): Promise<void> {
  const { band } = scribe

  if (item.form === 'reason') {
    const option = key.startsWith('reason:') ? item.options[Number(key.slice(7))] : undefined

    if (option !== undefined) {
      Band.clear(band)
      await reasoned(host, scribe, item, { detail: option, reason_status: 'stated' })
    } else if (key === 'other') {
      band.editing = { what: 'reason' }
    } else if (key === 'no-reason') {
      Band.clear(band)
      await reasoned(host, scribe, item, { reason_status: 'no_strong_reason' })
    } else if (key === 'skip') {
      band.unanswered += 1
      Band.clear(band)
    }

    return
  }

  if (item.form === 'holds') {
    await pressedHolds(host, scribe, who, item, key)

    return
  }

  if (key === 'tell-claude') {
    // Nothing is written: the developer is taking it up with Claude.
    if (await tellClaude(host, REVERSAL_LEAD, item.prior)) {
      Band.clear(band)
    }

    return
  }

  if (key !== 'replaces' && key !== 'different' && key !== 'skip') {
    return
  }

  band.unanswered += key === 'skip' ? 1 : 0
  Band.clear(band)

  // Only this key makes the new decision the replacement of the old one.
  const one = await written(host, scribe, who, item.draft, await lone(host, scribe), key === 'replaces' ? item.prior : undefined)

  if (one === undefined) {
    return
  }

  // Written on their word about what it is to the old one: theirs from here on.
  if (key !== 'skip') {
    touched(scribe, one.id)
  }

  Band.receive(band, [one])

  // It replaces the old decision, and nobody has said why: that is asked
  // next, as part of the same answer.
  if (key === 'replaces' && one.reasonStatus === 'not_stated') {
    band.current = {
      kind: 'question',
      form: 'reason',
      id: one.id,
      content: one.content,
      options: item.options,
      isTouched: true,
    }
  }
}

/**
 * Whether a key writes to Fylgja or settles something for good, and so acts
 * only on its second press: removing a record, silencing one for good,
 * turning Scribe off, making a decision the replacement of a recorded one,
 * confirming that a recorded decision still holds, and saving a reason the
 * model proposed. Keys that only open, skip, dismiss or fill the prompt box
 * act at once, and so does saying that a recorded decision no longer holds:
 * it writes nothing.
 */
function needsSecondPress(key: string): boolean {
  return (
    key === 'knew' ||
    key === 'off' ||
    key === 'replaces' ||
    key === 'holds' ||
    key === 'no-reason' ||
    /^(?:remove|reason|putback):/.test(key)
  )
}

/**
 * Whether the key armed as `arm` is on its second press and may act. The
 * first press only marks the key where it stands, for a few seconds, and a
 * line of its own says what a second will do; the key keeps its words. It
 * is no sign of attention either: a stray digit is exactly what it guards
 * against.
 *
 * @param holder the band or the window of what was kept, whichever the key is in
 */
async function isSecondPress(host: ScribeHost, scribe: Scribe, holder: Band.Arming, arm: string): Promise<boolean> {
  if (Band.confirmedIn(holder, arm, await host.now())) {
    return true
  }

  const { armed } = holder

  host.after(Band.ARM_MS, () => {
    // A band or a window of a conversation that has since started over is not this timer's.
    if ((scribe.band === holder || scribe.ledger === holder) && holder.armed === armed) {
      holder.armed = null
      host.redraw()
    }
  })
  host.redraw()

  return false
}

/** A key of the band was pressed. */
export async function pressed(host: ScribeHost, scribe: Scribe, key: string): Promise<void> {
  const { band } = scribe
  const who = scribe.identity

  if (who === null || who === undefined) {
    return
  }

  if (needsSecondPress(key)) {
    if (!(await isSecondPress(host, scribe, band, Band.armOf(band, key)))) {
      return
    }
  } else {
    band.armed = null
  }

  const isKeptChanged = Band.touch(band)
  const known = band.kept.known.length
  const item = band.current
  const hadSaid = item?.kind === 'question' && item.form === 'holds' && item.said !== undefined

  if (key === 'about') {
    band.isAboutOpen = true
  } else if (key === 'about-ok') {
    band.isAboutOpen = false
    band.offersAbout = false
  } else if (key === 'off') {
    // Off for this machine, from this moment: nothing more is read or shown.
    startOver(scribe)
    scribe.identity = null
    void host.store(STORE.off, true).catch(() => undefined)
  } else if (key === 'cancel') {
    band.editing = null
  } else if (band.editing !== null || band.isAboutOpen) {
    return
  } else if (item?.kind === 'question' && !band.isWorking) {
    await pressedQuestion(host, scribe, who, item, key)
  } else if (item?.kind === 'tell') {
    await pressedTell(host, scribe, item, key)
  } else {
    await pressedReceipt(host, scribe, key)
  }

  // A question the key settled: it is gone from the band, or its card now says what came of the answer.
  if (item?.kind === 'question' && !hadSaid) {
    const answer = answerOf(item, key)
    const isSettled = scribe.band.current !== item || (item.form === 'holds' && item.said !== undefined)

    if (answer !== undefined && isSettled) {
      answeredBy(host, item, answer)
    }
  }

  if (isKeptChanged || band.kept.known.length !== known) {
    keep(host, band)
  }

  settle(host, scribe)
}

/** Enter was pressed in the band's field. */
export async function entered(host: ScribeHost, scribe: Scribe, key: string, value: string): Promise<void> {
  const { band } = scribe
  const { editing } = band
  const text = value.replace(/\s+/g, ' ').trim()

  if (scribe.identity === null || scribe.identity === undefined || editing === null) {
    return
  }

  if (key === 'fix-text' && editing.what === 'fix') {
    if (text === '' || text.length > MAX_CONTENT) {
      host.toast(`One sentence of at most ${MAX_CONTENT} characters.`)

      return
    }

    for (const written of [...scribe.written, ...band.held, ...(band.receipt?.records ?? [])]) {
      if (written.id === editing.id) {
        written.content = text
      }
    }

    band.editing = null
    touched(scribe, editing.id)
    await amend(host, scribe, { atom_id: editing.id, op: 'fix', content: text })
  } else if (
    key === 'reason-text' &&
    editing.what === 'reason' &&
    band.current?.kind === 'question' &&
    band.current.form === 'reason'
  ) {
    if (text === '') {
      return
    }

    const asked = band.current

    Band.clear(band)
    answeredBy(host, asked, 'own_words')

    // "No idea" is an answer too: it is kept as one, in their words, and
    // never passed off as a reason.
    await reasoned(host, scribe, asked, { detail: text, reason_status: saysNoReason(text) ? 'no_strong_reason' : 'stated' })
  }

  settle(host, scribe)
}

/** What the band shows now; undefined for nothing, and always while Scribe is off. */
export function view(scribe: Scribe, isWorking: boolean, destination?: string): View | undefined {
  return scribe.identity === null || scribe.identity === undefined ? undefined : viewOf(scribe.band, isWorking, destination)
}

/**
 * What the window of what was kept shows now, laid out for `columns` cells.
 *
 * @param rows how many rows the window has room for
 * @param isFocused whether the window has the keys
 * @param isHere whether Fylgja is here for the account this machine is set up for
 */
export function ledger(scribe: Scribe, columns: number, rows: number, isFocused: boolean, isHere: boolean): Listed {
  Ledger.tidy(scribe.written, scribe.ledger)

  return Ledger.viewOf(
    scribe.written,
    scribe.ledger,
    columns,
    isFocused,
    !isHere ? 'signed-out' : isOff(scribe) ? 'off' : undefined,
    rows,
    scribe.lost,
  )
}

/** The rows of the window of what was kept, in the order they are listed. */
export function ledgerEntries(scribe: Scribe): Ledger.Entry[] {
  Ledger.tidy(scribe.written, scribe.ledger)

  return Ledger.entriesOf(scribe.written, scribe.ledger)
}

/** A record a receipt on the band holds is brought up to what it has become, so the band and the window say the same. */
function shownAs(band: Band.Band, now: Written): void {
  const same = (one: Written): Written => (one.id === now.id ? now : one)

  band.held = band.held.map(same)

  if (band.receipt !== null) {
    band.receipt.records = band.receipt.records.map(same)
  }
}

/**
 * One change to the record `id`, made for the window: no second one is
 * started for that record while this one is on its way to Fylgja, so a key
 * held down, or pressed again before the answer, asks once. Whether it ran.
 */
async function alone(host: ScribeHost, ledger: Ledger.Ledger, id: string, change: () => Promise<void>): Promise<boolean> {
  if (ledger.busy.has(id)) {
    return false
  }

  ledger.busy.add(id)
  host.redraw()

  try {
    await change()
  } finally {
    ledger.busy.delete(id)
  }

  return true
}

/**
 * A key of the window of what was kept was pressed: a row, which selects
 * its record and brings up what can be done with it, or one of those keys.
 * Removing a record and putting one back act on their second press, as the
 * band's keys that settle something for good do. Each change is made by the
 * one way Scribe has to make it, and waited for: a change Fylgja did not
 * take is said in the record's row, and the row stays as it was.
 */
export async function ledgerPressed(host: ScribeHost, scribe: Scribe, key: string): Promise<void> {
  const { ledger } = scribe
  const at = key.indexOf(':')
  const action = at === -1 ? key : key.slice(0, at)
  const id = at === -1 ? '' : key.slice(at + 1)

  if (action === 'row' || action === 'cancel') {
    if (action === 'row') {
      Ledger.rest(ledger, id)
      ledger.acting = id
    }

    ledger.editing = undefined
    ledger.armed = null
    host.redraw()

    return
  }

  // A change to this record is on its way: the key does nothing until it is answered, and arms nothing.
  if (scribe.identity === null || scribe.identity === undefined || ledger.busy.has(id)) {
    return
  }

  if (needsSecondPress(key)) {
    if (!(await isSecondPress(host, scribe, ledger, key))) {
      return
    }
  } else {
    ledger.armed = null
  }

  // The record a key belongs to is the selected one, and stays it whatever becomes of it.
  ledger.selected = id
  ledger.acting = id
  ledger.trouble.delete(id)

  if (action === 'reword' && scribe.written.some(one => one.id === id)) {
    Ledger.edit(ledger, id)
  } else if (action === 'remove') {
    await alone(host, ledger, id, async () => {
      const gone = await takeBack(host, scribe, id, true)

      if (gone === undefined) {
        ledger.trouble.set(id, Ledger.TROUBLE.remove)
      } else {
        shownAs(scribe.band, gone)
      }

      host.report('window_action', { view: 'kept', action: 'remove', outcome: gone === undefined ? 'trouble' : 'done' })
    })
  } else if (action === 'putback') {
    await alone(host, ledger, id, async () => {
      const gone = ledger.gone.find(one => one.id === id)
      const back = gone === undefined ? undefined : await putBack(host, scribe, gone)

      if (back === undefined) {
        ledger.trouble.set(id, Ledger.TROUBLE.putback)
      } else {
        // Fylgja may give it back under another id; the selection follows the record.
        ledger.selected = back.id
        shownAs(scribe.band, back)
      }

      host.report('window_action', { view: 'kept', action: 'put_back', outcome: back === undefined ? 'trouble' : 'done' })
    })
  }

  if (action !== 'reword') {
    Ledger.settled(ledger)
  }

  // The count the mark shows follows what stands.
  host.mark()
  host.redraw()
}

/**
 * The window's field was left without Enter: the sentence stays as it is.
 * Whether a field was open.
 */
export function ledgerLeftField(scribe: Scribe): boolean {
  const wasOpen = scribe.ledger.editing !== undefined

  scribe.ledger.editing = undefined

  return wasOpen
}

/**
 * Enter was pressed in the window's field: the selected record's sentence
 * as it should read. It is rewritten in place, the way Scribe rewrites a
 * record of its own, with nothing but the sentence changed.
 */
export async function ledgerEntered(host: ScribeHost, scribe: Scribe, value: string): Promise<void> {
  const { ledger } = scribe
  const id = ledger.editing
  const own = scribe.written.find(one => one.id === id)
  const text = value.replace(/\s+/g, ' ').trim()

  if (scribe.identity === null || scribe.identity === undefined || id === undefined || ledger.busy.has(id)) {
    return
  }

  ledger.editing = undefined

  if (text === '' || text.length > MAX_CONTENT) {
    ledger.trouble.set(id, Ledger.TROUBLE.length)
  } else if (own === undefined) {
    ledger.trouble.set(id, Ledger.TROUBLE.reword)
  } else if (text !== own.content) {
    await alone(host, ledger, id, async () => {
      const now = await rewrite(
        host,
        scribe,
        {
          kind: own.kind,
          content: text,
          // Only the sentence is sent: a part the change does not send stays as it was.
          detail: '',
          alternatives: [],
          anchors: own.anchors ?? [],
          triggers: own.triggers ?? [],
          reasonStatus: own.reasonStatus,
          supersedes: null,
          repo: own.repo ?? null,
          updates: own.id,
        },
        true,
      )

      if (now === undefined) {
        ledger.trouble.set(id, Ledger.TROUBLE.reword)
      } else {
        ledger.trouble.delete(id)
        shownAs(scribe.band, now)
      }

      host.report('window_action', { view: 'kept', action: 'reword', outcome: now === undefined ? 'trouble' : 'done' })
    })
  }

  Ledger.settled(ledger)
  host.redraw()
}
