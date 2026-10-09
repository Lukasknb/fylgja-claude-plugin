import { payloadOf } from './payload'

/** One line saying what a write to Fylgja did. */
export type Receipt = {
  line: string
  /** False when the write found nothing to change. */
  isChange: boolean
}

function moved(count: unknown): string {
  if (typeof count !== 'number' || count <= 0) {
    return ''
  }

  return ` ${count} ${count === 1 ? 'record' : 'records'} moved.`
}

function remembered(result: Record<string, unknown>): Receipt | undefined {
  const isPlain =
    (result.supersede === undefined || result.supersede === 'not_requested' || result.supersede === 'applied') &&
    (result.grounding_flagged === undefined || result.grounding_flagged === false) &&
    // Something that was sent was not applied, or the repository may be another's spelling: the row says which.
    (result.note === undefined || result.note === null) &&
    (result.repo_hint === undefined || result.repo_hint === null)

  // A replacement Fylgja refused, or a note it flagged for review, comes with
  // a reason the person should read in full.
  if (!isPlain) {
    return undefined
  }

  const replaced = result.supersede === 'applied' ? ' It replaces an older note.' : ''

  switch (result.outcome) {
    case 'created':
      return { line: `Remembered.${replaced}`, isChange: true }
    case 'reconfirmed':
      return { line: `Already known — confirmed again.${replaced}`, isChange: replaced !== '' }
    case 'restored':
      return { line: `Remembered again — it had been removed.${replaced}`, isChange: true }
    case 'duplicate':
      return { line: 'Already known — nothing new stored.', isChange: false }
    default:
      return undefined
  }
}

function saved(result: Record<string, unknown>): Receipt | undefined {
  switch (result.outcome) {
    case 'created':
      return { line: 'Saved to Fylgja.', isChange: true }
    case 'updated':
      return { line: 'Updated in Fylgja.', isChange: true }
    case 'unchanged':
      return { line: 'Already saved — nothing changed.', isChange: false }
    default:
      // Skipped, or anything else: the result says why.
      return undefined
  }
}

function restructured(result: Record<string, unknown>): Receipt | undefined {
  // Records it named but left where they are make the change a partial one.
  if (typeof result.records_skipped === 'number' && result.records_skipped > 0) {
    return undefined
  }

  switch (result.status) {
    case 'applied':
      return { line: `Structure changed.${moved(result.records_moved)}`, isChange: true }
    case 'proposed':
      return { line: 'Proposed — it waits for you in Fylgja.', isChange: false }
    case 'exists':
      return { line: 'Already there — nothing changed.', isChange: false }
    case 'unchanged':
      return { line: 'Nothing moved.', isChange: false }
    default:
      return undefined
  }
}

function reviewed(result: Record<string, unknown>): Receipt | undefined {
  switch (result.decision) {
    case 'accept':
      return { line: 'Suggestion accepted — the newer value stands.', isChange: true }
    case 'reject':
      return { line: 'Suggestion withdrawn — both stay as they are.', isChange: true }
    default:
      return undefined
  }
}

function amended(result: Record<string, unknown>): Receipt | undefined {
  switch (result.outcome) {
    case 'fixed':
      return { line: 'Fixed in Fylgja.', isChange: true }
    case 'removed':
      // Taking a replacement away makes the note it replaced the current one again.
      return {
        line:
          typeof result.restored_prior_id === 'string'
            ? 'Removed from Fylgja. The older note stands again.'
            : 'Removed from Fylgja.',
        isChange: true,
      }
    case 'unchanged':
      return { line: 'Already so — nothing changed.', isChange: false }
    default:
      return undefined
  }
}

function attached(result: Record<string, unknown>): Receipt | undefined {
  if (typeof result.attached !== 'number' || result.attached < 0) {
    return undefined
  }

  return result.attached === 0
    ? { line: 'Commit already noted — nothing new.', isChange: false }
    : { line: `Commit noted on ${result.attached} ${result.attached === 1 ? 'record' : 'records'}.`, isChange: true }
}

function defined(result: Record<string, unknown>): Receipt | undefined {
  switch (result.outcome) {
    case 'created':
      return { line: 'Term added — unconfirmed until you confirm it in Fylgja.', isChange: true }
    case 'updated':
      return { line: 'Term updated in Fylgja.', isChange: true }
    case 'unchanged':
      return { line: 'Term already says that — nothing changed.', isChange: false }
    case 'rename_suggested':
      return { line: 'New name suggested — it waits for you in Fylgja.', isChange: false }
    default:
      return undefined
  }
}

const READERS: Readonly<Record<string, (result: Record<string, unknown>) => Receipt | undefined>> = {
  remember: remembered,
  save_knowledge: saved,
  restructure: restructured,
  review_suggestion: reviewed,
  amend_memory: amended,
  attach_commit: attached,
  define_term: defined,
}

/**
 * The receipt for one of Fylgja's write tools, read from the result its row
 * stores. Undefined, so the row is drawn as it always was, when the tool is
 * not one of them, when the result is not the shape that tool answers with,
 * and whenever the write did less than was asked: a receipt never says more
 * than happened.
 *
 * A receipt is made of fixed words and counts; nothing a record holds is in it.
 *
 * @param tool the tool's full name, under either name the server runs as
 * @param output the stored result
 */
export function receiptOf(tool: string, output: unknown): Receipt | undefined {
  const name = /^mcp__(?:plugin_fylgja_fylgja|fylgja)__(.+)$/.exec(tool)?.[1]
  const reader = name !== undefined && Object.hasOwn(READERS, name) ? READERS[name] : undefined
  const result = reader === undefined ? undefined : payloadOf(output)

  return reader === undefined || result === undefined ? undefined : reader(result)
}
