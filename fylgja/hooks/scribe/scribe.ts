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
 * alone. What it keeps on the machine is ids, counters and two switches.
 */

import type { Doing } from '../companion'
import { isRecord, payloadOf } from '../payload'
import { drawn } from '../plain'
import * as Band from './band'
import { changesOf, filesOf, isPrompt, observe, plain } from './delta'
import type { Offer, Row } from './delta'
import { factsOf, isAnchoredTo, knownReposIn } from './facts'
import { REFUSED } from './grant'
import { codeOf, MAX_ANCHORS, PASSING, teaches } from './gate'
import { correct, MAX_LOOKUPS, MAX_STEPS, reasonIn, relationOf, STEP_TIMEOUT_MS, WAKE_DEADLINE_MS, wake } from './loop'
import type { LoopHost, Proposal } from './loop'
import * as Plans from './plans'
import { foldedBlock, MAX_SHOWN, pastBlock, planBlock, SYSTEM, wakeText } from './prompt'
import type { Block } from './prompt'
import { relativeTo, repoNameOf } from './repo'
import { CALL_TIMEOUT_MS, limited } from './time'
import type { Draft, Fact, Place, Verdict, Written } from './types'
import { correctedOf, MAX_CONTENT, mentionsNoReason, saysNoReason, statesNoReason } from './verdict'
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
  /** `$.prompt.read`: the text in the prompt box. */
  box: () => Promise<string>
  /** `$.prompt.fill`: puts `text` in the prompt box and sends nothing; whether the box took it. */
  fill: (text: string) => Promise<boolean>
  /** `$.store.get`. */
  stored: (key: string) => Promise<unknown>
  /** `$.store.set`. */
  store: (key: string, value: unknown) => Promise<void>
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
  /** The counts of the session a conversation started over in, to pick up again if it is the same session. */
  carry: { sessionId: string; tally: Band.Tally } | undefined
  plans: Plans.Plans
  /** The prompts the developer sent, as `plain` leaves them: what tells their words from every other row. */
  prompts: Set<string>
  /** Whether the developer has sent a prompt since Scribe last came to a verdict. */
  hasPrompt: boolean
  /** How many rows of the conversation a wake has been through; -1 when not known. */
  consumed: number
  /** The last row a wake went through, so rows that were rewritten under it are noticed. */
  mark: string | undefined
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
  /** Commits already attached. */
  commits: Set<string>
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
  /** Records handed back to the model once to be put right, and those lost for good after a refusal. */
  corrections: number
  dropped: number
}

/** The keys kept on this machine. */
export const STORE = {
  off: 'scribe.off',
  known: 'scribe.known',
  typedPast: 'scribe.typedPast',
  skip: 'scribe.skip',
  hasShown: 'scribe.hasShown',
} as const

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
const FLUSH_BUDGET_MS = 20_000
const PROBE = 'README.md'

export function create(options: Options): Scribe {
  return {
    options,
    model: MODEL,
    isInteractive: false,
    identity: undefined,
    band: Band.create(),
    carry: undefined,
    plans: Plans.create(),
    prompts: new Set(),
    hasPrompt: false,
    consumed: -1,
    mark: undefined,
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
    stated: [],
    unplaced: 0,
    spoken: [],
    unspoken: 0,
    acted: new Set(),
    hasActed: false,
    proposals: [],
    earlier: [],
    offered: [],
    offers: [],
    editedRepos: new Set(),
    edited: new Map(),
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
    isGranted: false,
    hasAsked: false,
    said: new Set(),
    epoch: 0,
    turn: 0,
    refused: 0,
    corrections: 0,
    dropped: 0,
  }
}

/**
 * The conversation started over (`/clear`, a resume, a fork): nothing of the
 * one before is held, and who the session is, is asked again, because its id
 * may be another now. What is kept on the machine stays, and so do the
 * session's counts if it turns out to be the same session.
 */
export function startOver(scribe: Scribe): void {
  const { kept } = scribe.band

  if (scribe.identity !== null && scribe.identity !== undefined) {
    scribe.carry = { sessionId: scribe.identity.sessionId, tally: Band.tallyOf(scribe.band) }
  }

  scribe.epoch += 1
  scribe.identity = undefined
  scribe.band = { ...Band.create(), kept }
  scribe.plans = Plans.create()
  scribe.prompts.clear()
  scribe.hasPrompt = false
  scribe.consumed = -1
  scribe.mark = undefined
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
  scribe.filesIn.clear()
  scribe.stated = []
  scribe.spoken = []
  scribe.unspoken = 0
  scribe.acted.clear()
  scribe.hasActed = false
  scribe.offered = []
  scribe.offers = []
  scribe.editedRepos.clear()
  scribe.edited.clear()
  scribe.commitsToPair = []
  scribe.agentRepo = null
  scribe.proposals = []
  scribe.earlier = []
  scribe.anchored.clear()
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

/** A session began: whether a person is at it, and whether it draws where the band is. */
export function started(scribe: Scribe, isInteractive: boolean, surface: string | null): void {
  startOver(scribe)
  scribe.carry = undefined
  scribe.isGranted = false
  scribe.hasAsked = false
  scribe.isInteractive = isInteractive && (surface === 'terminal' || surface === 'desktop')
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

  // The same session after a `/clear` has had its questions and its tells;
  // a new one starts with none.
  if (carry?.sessionId === sessionId) {
    Object.assign(band, carry.tally)
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
  const server = await connected(host)

  if (server === undefined) {
    throw new Error('Fylgja is not connected')
  }

  const result = await limited(host.after, host.call(server, tool, args), CALL_TIMEOUT_MS).catch((error: unknown) => {
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
  }

  const blocks = isRecord(result) && result.isError === true && Array.isArray(result.content) ? result.content : []
  const words = blocks.map(block => (isRecord(block) && typeof block.text === 'string' ? block.text : '')).join('')

  return { answer, refusal: answer === undefined ? words : undefined }
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

/** What sending one record came to: what was written, or the code Fylgja refused it by and its words. */
type Sent = { written: Written | undefined; code: string | undefined; refusal: string | undefined }

/**
 * Writes one record, once. What was written, or the code Fylgja refused it
 * by and its words. A refusal is counted.
 *
 * @param prior the recorded decision it replaces, when the developer said it does
 */
async function send(host: ScribeHost, scribe: Scribe, who: Identity, draft: Draft, prior?: Fact): Promise<Sent> {
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
  }

  let answer: Record<string, unknown> | undefined
  let refusal: string | undefined

  try {
    ;({ answer, refusal } = await tried(host, scribe, 'remember', args))
  } catch {
    answer = undefined
  }

  const none = (code?: string): Sent => ({ written: undefined, code, refusal })

  const outcome = answer?.outcome

  if (outcome !== 'created' && outcome !== 'restored' && outcome !== 'duplicate' && outcome !== 'reconfirmed') {
    scribe.refused += 1

    return none(codeOf(refusal))
  }

  // Its own is what it wrote as new. A record that came back from having been removed was somebody's before.
  const isOwn = outcome === 'created' && typeof answer?.atom_id === 'string'

  scribe.recorded = [...scribe.recorded, { id: isOwn ? String(answer?.atom_id) : null, content: draft.content }].slice(
    -MAX_LISTED,
  )

  if (typeof answer?.atom_id !== 'string') {
    return none()
  }

  // Fylgja says when what was sent was not applied because the record is
  // another member's: theirs to change, so it is shown as held and offers
  // neither Fix nor Remove.
  const isTheirs = outcome !== 'created' && typeof answer.note === 'string' && answer.note.trim() !== ''

  // Held already by the developer's own record: nothing was written, so
  // there is nothing to show or undo.
  if (!isTheirs && outcome !== 'created' && outcome !== 'restored') {
    return none()
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
    return { written, code: undefined, refusal: undefined }
  }

  scribe.written = [...scribe.written, written].slice(-MAX_LISTED)

  if (outcome === 'created') {
    scribe.mine.add(written.id)
  }

  return { written, code: undefined, refusal: undefined }
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

    if ('draft' in work) {
      const one = await written(host, scribe, who, work.draft, await lone(host, scribe))

      // Written beside a decision it may go against, because nobody said whether it replaces it: the receipt says so.
      Band.receive(scribe.band, one === undefined ? [] : [work.against === undefined ? one : { ...one, against: work.against }])
    } else {
      await call(host, scribe, work.tool, work.args).catch(() => undefined)
    }
  }
}

/** Brings up what may now be shown, and sees to what was let go unseen. */
function settle(host: ScribeHost, scribe: Scribe): void {
  const { band } = scribe
  const settled = Band.settle(band)

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

/** What is left of a wake for putting refused records right: model calls, time, and what a record is checked against. */
type Budget = { steps: number; until: number; seen: Seen; isLastTry?: true; lookups?: number }

/**
 * What a write outside a wake may spend on putting a refused record right:
 * one model call, with its own time limit. Such a write is the developer's
 * own key, or a record that was waiting for it. The call is one of the
 * hour's share, as a wake is: with the share used up there is none.
 */
async function lone(host: ScribeHost, scribe: Scribe): Promise<Budget> {
  const inTree = scribe.plans.docs.flatMap(doc => (doc.path === null ? [] : [doc.path]))
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
 * counted. A refusal that is the server's own trouble is tried once more at
 * the next turn's end, as it is. This spends the wake's own model calls and
 * time, and none when the wake has used them up.
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
    }

    return undefined
  }

  const first = await send(host, scribe, who, draft, prior)
  const part = first.written === undefined ? teaches(first.code) : undefined

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

  if (budget.steps <= 0 || left <= 0) {
    scribe.dropped += 1

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
    record: {
      kind: draft.kind,
      content: draft.content,
      detail: draft.detail,
      reason_status: draft.reasonStatus,
      alternatives: draft.alternatives,
      anchors: draft.anchors,
      triggers: draft.triggers,
    },
    refusal: first.refusal ?? '',
    timeoutMs: Math.min(STEP_TIMEOUT_MS, left),
  })
  const better = answer === 'drop' || answer === undefined ? undefined : correctedOf(draft, answer, part, budget.seen)
  const second = better === undefined ? undefined : (await send(host, scribe, who, better, prior)).written

  if (second === undefined) {
    scribe.dropped += 1
  }

  return second
}

/**
 * Rewrites one of Scribe's own records of this session in place: the same
 * decision as it now stands. What the receipt shows, or undefined when
 * Fylgja did not take the change. A question still waiting about that
 * record's reason goes once the reason is there.
 */
async function rewrite(host: ScribeHost, scribe: Scribe, draft: Draft): Promise<Written | undefined> {
  const own = scribe.written.find(one => one.id === draft.updates)

  if (own === undefined || !scribe.mine.has(own.id)) {
    return undefined
  }

  const { content } = draft
  const args: Record<string, unknown> = {
    atom_id: own.id,
    op: 'fix',
    content,
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
    outcome: 'updated',
    replaced: null,
  }

  scribe.written = scribe.written.map(one => (one.id === own.id ? now : one))
  scribe.recorded = scribe.recorded.map(one => (one.id === own.id ? { id: one.id, content } : one))

  if (draft.reasonStatus !== 'not_stated') {
    Band.withdrawQuestion(scribe.band, own.id)
  }

  return now
}

/**
 * Takes back one of Scribe's own records of this session, because the
 * decision it held was dropped. What the receipt shows, or undefined when
 * it is not Scribe's or Fylgja did not remove it.
 */
async function takeBack(host: ScribeHost, scribe: Scribe, id: string): Promise<Written | undefined> {
  const own = scribe.written.find(one => one.id === id)

  if (own === undefined || !scribe.mine.has(id)) {
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
  Band.withdrawQuestion(scribe.band, id)

  return { ...own, outcome: 'withdrawn', replaced: null }
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

  if (own === undefined || !scribe.mine.has(id)) {
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

  for (const [index, draft] of verdict.records.entries()) {
    const isAskedOf = question?.record === index
    const prior = isAskedOf && question.form === 'reversal' ? facts.get(question.prior) : undefined

    // A decision that came without a reason: before anybody is asked, the
    // reason is looked for in what the developer wrote and in the plans.
    const checked = await withReason(host, scribe, draft, budget)

    // Scribe's own record of this session, as the decision now stands: rewritten in place, with no key and no second record.
    if (draft.updates !== null) {
      const own = await rewrite(host, scribe, checked.draft)

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

    if (against !== undefined) {
      const ask: Band.Question = {
        kind: 'question',
        form: 'reversal',
        draft: checked.draft,
        prior: against,
        options: [],
        isTouched: false,
      }

      if (Band.offerQuestion(band, ask, draft.content)) {
        scribe.asked = [...scribe.asked, draft.content].slice(-MAX_LISTED)
        continue
      }
    }

    // A decision that may replace a recorded one is written once the
    // developer has said which it is. When they cannot be asked, it is
    // written beside the old one: nothing is ever replaced without their key.
    if (prior !== undefined) {
      const ask: Band.Question = {
        kind: 'question',
        form: 'reversal',
        draft,
        prior,
        options: question?.options ?? [],
        isTouched: false,
      }

      if (Band.offerQuestion(band, ask, draft.content)) {
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
      Band.offerQuestion(
        band,
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
  const { epoch } = scribe
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
    const facts = factsOf(await call(host, scribe, 'recall', { repo, paths: files.length === 0 ? [PROBE] : files }))

    if (epoch !== scribe.epoch) {
      return
    }

    for (const fact of facts) {
      if (scribe.written.some(own => own.id === fact.id)) {
        continue
      }

      scribe.anchored.set(fact.id, fact)

      if (isAnchoredTo(fact, files)) {
        Band.offerTell(scribe.band, fact)
      }
    }
  }

  settle(host, scribe)
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
 * compaction, or anything else that rewrites the conversation, leaves that
 * count pointing into another list; then, and when nothing is known yet,
 * they begin at the developer's last prompt.
 */
function startOf(scribe: Scribe, rows: readonly Row[]): number {
  const { consumed } = scribe

  if (consumed >= 0 && consumed <= rows.length && (consumed === 0 || markOf(rows[consumed - 1]) === scribe.mark)) {
    return consumed
  }

  for (let at = rows.length - 1; at >= 0; at -= 1) {
    const row = rows[at]

    if (row !== undefined && isPrompt(row, scribe.prompts)) {
      return at
    }
  }

  return rows.length
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
 */
function mayWake(host: ScribeHost, scribe: Scribe, now: number): boolean {
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

  if (once(scribe, 'ceiling')) {
    host.debug(`Scribe: ${MAX_WAKES_PER_HOUR} wakes in the last hour; quiet until the hour has rolled on`)
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
      scribe.editedRepos.add(place.repo)
    }
  }
}

/** A commit was made in `repo`: it holds what was changed there since the one before. */
function committed(scribe: Scribe, repo: string): void {
  const files = [...(scribe.edited.get(repo) ?? [])]

  scribe.edited.delete(repo)

  if (files.length > 0) {
    scribe.commitsToPair = [...scribe.commitsToPair, { repo, files }].slice(-MAX_PENDING_COMMITS)
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
 * A turn of the main conversation ended. Scribe reads what happened since
 * it last looked, looks up the files touched, runs one wake over it, acts on
 * the verdict, and attaches any commit the turn made to the session's
 * records.
 *
 * A model is asked only for a turn the developer started, that has
 * something in it, and only once a call of Scribe's own has got through to
 * Fylgja. A wake that did not come to a verdict, or was not begun, leaves
 * the rows unread, so the next turn's wake has them too.
 */
export async function completed(host: ScribeHost, scribe: Scribe): Promise<void> {
  scribe.band.isWorking = false
  scribe.band.hasAskedThisTurn = false
  scribe.turn += 1

  const who = await identityOf(host, scribe)

  // Signed out, nothing is read and no model is asked.
  if (who === null || (await connected(host)) === undefined) {
    return
  }

  const rows = await host.rows()
  const from = startOf(scribe, rows)
  const seen = observe(rows.slice(from), who.root, scribe.prompts)

  // Held from here on: a wake that comes to nothing leaves these rows for the next.
  scribe.consumed = from
  scribe.mark = markOf(rows[from - 1])

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
  const here = await placesOf(host, scribe, who, seen.files)

  await placesOf(
    host,
    scribe,
    who,
    scribe.plans.docs.flatMap(doc => (doc.key.startsWith('/') ? [doc.key] : [])),
  )
  // What was written or changed, per repository, since its last commit; and
  // the commits made since the last look, each with those files. A commit is
  // the moment a decision recorded before its code existed can be given its
  // place: the next look is asked to pair them, once.
  noteEdits(scribe, who, seen.changed, await placesOf(host, scribe, who, seen.changed))
  wanted(scribe, who, here)

  if (who.repo !== null && seen.commits.some(sha => !scribe.commits.has(sha))) {
    committed(scribe, who.repo)
  }

  // The developer's rows are told from every other by the prompt they sent.
  // Where no row holds it, their words are not labelled as theirs; that is
  // worth knowing, and says nothing of what was written.
  if (scribe.hasPrompt && seen.developer === '' && once(scribe, 'no-prompt-row')) {
    host.debug(
      'Scribe: a prompt was sent and no row of the conversation holds it; the turn is read without what the developer wrote',
    )
  }

  // The first call of a session is waited for: whether it gets through
  // decides whether Scribe runs at all. After that a slow lookup does not
  // hold the turn's end.
  if (scribe.isGranted) {
    await within(
      host,
      lookUp(host, scribe, who).catch(() => undefined),
      LOOKUP_WAIT_MS,
    )
  } else {
    const first = lookUp(host, scribe, who, true).catch(() => undefined)

    // Waited for in full once. A server that did not answer then is not
    // given more than a moment at each later turn's end.
    await (scribe.hasAsked ? within(host, first, LOOKUP_WAIT_MS) : first)
    scribe.hasAsked = true
  }

  if (scribe.identity === null || !scribe.isGranted) {
    return
  }

  await flush(host, scribe, who)

  const now = await host.now()
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
      spoke(scribe, act.words.replace(/\s+/g, ' ').trim())
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

  if ((scribe.hasPrompt || scribe.hasActed) && isWorthAsking && mayWake(host, scribe, now)) {
    scribe.wakingSince = now
    scribe.wakeTimes.push(now)

    try {
      const { epoch } = scribe

      // The look is under way from here: the mark says it is reading.
      host.mark()

      const shown = [...scribe.anchored.values()].slice(0, MAX_SHOWN)
      const plans = planBlock(scribe.plans.docs, scribe.wakes)
      const past = scribe.past.map((block, at) => (at === scribe.past.length - 1 ? { ...block, cache: true as const } : block))
      const allowed = new Set(scribe.places.keys())
      // Scribe's own records of the session that point at no file yet, and the first commit that has some to place.
      const unplaced = new Map(
        scribe.written.flatMap(one =>
          scribe.mine.has(one.id) && (one.anchors ?? []).length === 0 && typeof one.repo === 'string'
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
      const woken = await wake(host, {
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
          },
        ),
        repo: judged.home ?? who.repo,
        shown,
        seen: judged,
      })

      if (woken.ending === 'verdict' && epoch === scribe.epoch) {
        const before = scribe.written.length

        scribe.consumed = rows.length
        scribe.mark = markOf(rows.at(-1))
        scribe.hasPrompt = false
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
        })
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
    } finally {
      // Every look ends here, whatever it came to: the mark stops saying it is reading.
      scribe.wakingSince = 0
      host.mark()
    }
  }

  // A commit made in this repository is attached to what the session
  // recorded: Scribe's records and Claude's own. Fylgja attaches it once.
  for (const sha of seen.commits) {
    if (!scribe.commits.has(sha)) {
      scribe.commits.add(sha)
      // A commit at the session's own root is its repository's; a session with none attaches none.
      if (who.repo !== null) {
        await call(host, scribe, 'attach_commit', { repo: who.repo, sha, session_id: who.sessionId }).catch(() => undefined)
      }
    }
  }

  settle(host, scribe)
  await flush(host, scribe, who)
  settle(host, scribe)
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
    band.receipt = shown.records.length === 0 ? null : shown
    await amend(host, scribe, { atom_id: written.id, op: 'remove' })
  } else if (action === 'putback' && written?.outcome === 'withdrawn') {
    await putBack(host, scribe, shown, written)
  }
}

/**
 * Puts back a record Scribe took back: it is sent again as it was, and
 * Fylgja restores the one it removed. From then on it is the developer's:
 * Scribe does not take it back a second time.
 */
async function putBack(host: ScribeHost, scribe: Scribe, shown: Band.Receipt, gone: Written): Promise<void> {
  const who = scribe.identity

  if (who === null || who === undefined) {
    return
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
    host.toast('The record could not be put back.')

    return
  }

  touched(scribe, sent.written.id)
  // Back as it was; where another member holds the same record, theirs is shown as theirs.
  const back: Written = sent.written.outcome === 'held' ? sent.written : { ...sent.written, outcome: 'restored' }

  shown.records = shown.records.map(one => (one === gone ? back : one))
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
 * and saving a reason the model proposed. Keys that only open, skip, dismiss
 * or fill the prompt box act at once.
 */
function needsSecondPress(key: string): boolean {
  return key === 'knew' || key === 'off' || key === 'replaces' || key === 'no-reason' || /^(?:remove|reason|putback):/.test(key)
}

/** A key of the band was pressed. */
export async function pressed(host: ScribeHost, scribe: Scribe, key: string): Promise<void> {
  const { band } = scribe
  const who = scribe.identity

  if (who === null || who === undefined) {
    return
  }

  if (needsSecondPress(key)) {
    if (!Band.confirmed(band, key, await host.now())) {
      const { armed } = band

      // The first press only makes the key say what a second will do, for a
      // few seconds. It is no sign of attention either: a stray digit is
      // exactly what it guards against.
      host.after(Band.ARM_MS, () => {
        if (scribe.band === band && band.armed === armed) {
          band.armed = null
          host.redraw()
        }
      })
      host.redraw()

      return
    }
  } else {
    band.armed = null
  }

  const isKeptChanged = Band.touch(band)
  const known = band.kept.known.length
  const item = band.current

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
