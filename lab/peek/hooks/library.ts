import { factOfRecord, factOfResolved, merged, resolvedById } from './facts'
import type { Fact } from './facts'
import type { Host } from './host'
import { answerOf } from './payload'
import type { Answer } from './payload'
import { meetingOf, otherOf, pageOf, personOf, projectOf } from './record'
import type { Rec } from './record'
import type { Ref } from './refs'

/** Why a record could not be shown. */
export type Failure = 'signed-out' | 'not-found' | 'unreachable' | 'unreadable'

export type Loaded = { state: 'loading' } | { state: 'ready'; record: Rec } | { state: 'failed'; reason: Failure }

/**
 * Everything this plugin knows about Fylgja's records while it runs: the
 * facts the cards show and the records the pane shows.
 *
 * Held in the running plugin's memory only, bounded, never written anywhere.
 * All of it is dropped when the person has to sign in (they may sign in as
 * someone else) and when the conversation starts over.
 */
export type Library = {
  facts: Map<string, Fact>
  records: Map<string, Loaded>
  /** Records whose card is waiting to be looked up, in the order first drawn. */
  queue: Ref[]
  /** Ids whose card was asked about, or is about to be: a card is looked up once. */
  asked: Set<string>
  isWorking: boolean
  /** Whether the server has `resolve`, the one call that names many records; undefined until tried. */
  hasResolve: boolean | undefined
  /** Whether the last answer about the server was that it needs sign-in. Nothing is looked up for a card while it does. */
  isSignedOut: boolean
  /** Counts the times everything was dropped; an answer that started before a drop is not kept. */
  epoch: number
}

const MAX_FACTS = 300
const MAX_RECORDS = 40
/** How many references one `resolve` call asks about. */
const MAX_REFERENCES = 20
/** How many of one row's records have a card looked up. */
export const MAX_PER_ROW = 8

const MEETING_SECTIONS = ['summary', 'decisions', 'key_points', 'action_items', 'participants']

export function create(): Library {
  return {
    facts: new Map(),
    records: new Map(),
    queue: [],
    asked: new Set(),
    isWorking: false,
    hasResolve: undefined,
    isSignedOut: false,
    epoch: 0,
  }
}

/** Drops everything known and everything under way. */
export function startOver(library: Library): void {
  library.epoch += 1
  library.facts.clear()
  library.records.clear()
  library.queue = []
  library.asked.clear()
  library.hasResolve = undefined
}

function put<V>(map: Map<string, V>, id: string, value: V, max: number): void {
  map.delete(id)
  map.set(id, value)

  // The oldest go first once more is held than a conversation needs.
  for (const oldest of map.keys()) {
    if (map.size <= max) {
      break
    }

    map.delete(oldest)
  }
}

function keepFact(library: Library, fact: Fact): void {
  put(library.facts, fact.id, merged(library.facts.get(fact.id), fact), MAX_FACTS)
}

/** The server's name, or why it cannot be asked. Never rejects. */
async function serverOf(host: Host, library: Library): Promise<{ server: string } | { failure: Failure }> {
  const connection = await host.connect().catch(() => undefined)

  if (connection?.isConnected === true) {
    if (library.isSignedOut) {
      // Signed in again: the cards that were left blank are worth asking about now.
      library.isSignedOut = false
      library.asked.clear()
    }

    return { server: connection.server }
  }

  if (connection?.reason === 'auth') {
    // Whoever signs in next may be someone else: nothing read so far is theirs to see.
    startOver(library)
    library.isSignedOut = true

    return { failure: 'signed-out' }
  }

  return { failure: 'unreachable' }
}

/** One read. A call that rejects is an answer too: there is nothing to read. */
function ask(host: Host, server: string, tool: string, args: Record<string, unknown>): Promise<Answer | undefined> {
  return host.call(server, tool, args).then(answerOf, () => undefined)
}

function failureOf(answer: Answer | undefined): Failure {
  if (answer === undefined) {
    return 'unreachable'
  }

  return answer.is === 'refused' ? (answer.isNotFound ? 'not-found' : 'unreachable') : 'unreadable'
}

/**
 * Reads one record with today's tools.
 *
 * A meeting whose place in the project tree is already known is read with
 * `get_meeting` alone, every section at once. Anything else is read with
 * `open`, which answers for every kind and says which kind it is; a meeting
 * read that way gets its participants and commitments from one more
 * `get_meeting`, and is shown without them when that call fails.
 */
async function read(host: Host, server: string, ref: Ref, known: Fact | undefined): Promise<Rec | Failure> {
  if (known?.state === 'found' && known.kind === 'meeting' && known.path.length > 0) {
    const answer = await ask(host, server, 'get_meeting', { meeting_id: ref.id, include: MEETING_SECTIONS })
    const meeting = answer?.is === 'json' ? meetingOf(answer.json, ref.id) : undefined

    return meeting === undefined ? failureOf(answer) : { ...meeting, path: known.path }
  }

  const answer = await ask(host, server, 'open', { ref: ref.id })

  if (answer?.is === 'text') {
    return pageOf(answer.text, ref.id, ref.kind) ?? 'unreadable'
  }

  if (answer?.is !== 'json') {
    return failureOf(answer)
  }

  const kind = typeof answer.json.kind === 'string' ? answer.json.kind : ref.kind

  if (kind === 'project') {
    return projectOf(answer.json, ref.id) ?? otherOf(answer.json, ref.id) ?? 'unreadable'
  }

  if (kind === 'person') {
    return personOf(answer.json, ref.id) ?? 'unreadable'
  }

  if (kind !== 'meeting') {
    return otherOf(answer.json, ref.id) ?? 'unreadable'
  }

  const meeting = meetingOf(answer.json, ref.id)

  if (meeting === undefined) {
    return 'unreadable'
  }

  const more = await ask(host, server, 'get_meeting', { meeting_id: ref.id, include: ['action_items', 'participants'] })
  const rest = more?.is === 'json' ? meetingOf(more.json, ref.id) : undefined

  return rest === undefined
    ? meeting
    : { ...meeting, participants: rest.participants, commitments: rest.commitments, has: rest.has, isCut: meeting.isCut || rest.isCut }
}

/**
 * Reads a record for the pane, unless it is held or on its way already.
 * Draws again when the reading starts and when it ends; never rejects.
 *
 * @param isForced reads again even when the record is held
 */
export async function load(host: Host, library: Library, ref: Ref, isForced = false): Promise<void> {
  const held = library.records.get(ref.id)

  if (held?.state === 'loading' || (held?.state === 'ready' && !isForced)) {
    return
  }

  put(library.records, ref.id, { state: 'loading' }, MAX_RECORDS)
  host.redraw()

  const reached = await serverOf(host, library)
  const epoch = library.epoch
  const result = 'failure' in reached ? reached.failure : await read(host, reached.server, ref, library.facts.get(ref.id)).catch(() => 'unreadable' as const)

  // Everything was dropped while Fylgja was asked: this answer is no longer wanted.
  if (epoch !== library.epoch) {
    return
  }

  if (typeof result === 'string') {
    put(library.records, ref.id, { state: 'failed', reason: result }, MAX_RECORDS)

    if (result === 'not-found') {
      keepFact(library, { state: 'missing', id: ref.id })
    }
  } else {
    put(library.records, ref.id, { state: 'ready', record: result }, MAX_RECORDS)
    keepFact(library, factOfRecord(result))
  }

  host.redraw()
}

/** Asks `resolve` about a batch. True when it answered as `resolve` does. */
async function resolveBatch(host: Host, library: Library, server: string, batch: readonly Ref[]): Promise<boolean> {
  const answer = await ask(host, server, 'resolve', { refs: batch.map(ref => ref.id) })
  const entries = answer?.is === 'json' ? resolvedById(answer.json) : undefined

  if (entries === undefined) {
    return false
  }

  for (const ref of batch) {
    const entry = entries.get(ref.id)
    const fact = entry === undefined ? undefined : factOfResolved(entry, ref.id)

    if (fact !== undefined) {
      keepFact(library, fact)
    }
  }

  return true
}

async function lookUp(host: Host, library: Library, batch: readonly Ref[]): Promise<void> {
  const reached = await serverOf(host, library)
  const epoch = library.epoch

  if ('failure' in reached) {
    // Nothing is said in a reply's row about it; the pane says it when the
    // person opens one. The rows are drawn again only to take down the cards
    // of what a lapsed sign-in just dropped.
    library.queue = []

    if (reached.failure === 'signed-out') {
      host.redraw()
    }

    return
  }

  if (library.hasResolve !== false) {
    const isAnswered = await resolveBatch(host, library, reached.server, batch)

    if (epoch !== library.epoch) {
      return
    }

    // A server without `resolve` is asked record by record from here on.
    library.hasResolve = library.hasResolve === true || isAnswered

    if (isAnswered) {
      host.redraw()
    }
  }

  for (const ref of batch) {
    if (epoch !== library.epoch) {
      return
    }

    const fact = library.facts.get(ref.id)
    // `resolve` says everything a card shows except a meeting's counts.
    const isEnough = fact?.state === 'missing' || (fact?.state === 'found' && fact.kind !== 'meeting')

    if (!isEnough) {
      await load(host, library, { id: ref.id, kind: fact?.state === 'found' ? fact.kind : ref.kind })
    }
  }
}

async function work(host: Host, library: Library): Promise<void> {
  // Let every row of one drawing pass add its records before the first batch leaves.
  await Promise.resolve()

  while (library.queue.length > 0) {
    await lookUp(host, library, library.queue.splice(0, MAX_REFERENCES)).catch(() => undefined)
  }
}

/**
 * Has the cards of the records a drawn row names looked up, unless that is
 * done or under way. Returns at once: the row is drawn now with what is
 * known, and drawn again as answers arrive.
 *
 * One call at a time, at most `MAX_PER_ROW` records per row, each record
 * asked about once. So a row drawn a hundred times, on every resize and
 * reload, still asks once, and a failed lookup is not repeated.
 */
export function want(host: Host, library: Library, refs: readonly Ref[]): void {
  if (!library.isSignedOut) {
    for (const ref of refs.slice(0, MAX_PER_ROW)) {
      if (!library.asked.has(ref.id) && !library.facts.has(ref.id)) {
        library.asked.add(ref.id)
        library.queue.push({ id: ref.id, kind: ref.kind })
      }
    }
  }

  if (library.queue.length > 0 && !library.isWorking) {
    library.isWorking = true
    void work(host, library)
      .catch(() => undefined)
      .finally(() => {
        library.isWorking = false
        // Records a row added while the last batch was finishing.
        want(host, library, [])
      })
  }
}
