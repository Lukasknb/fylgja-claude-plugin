/**
 * Fylgja's own rules for what it stores, as its server holds them, so that
 * Scribe sends nothing the server would refuse: a refused write is a record
 * lost, and the server refuses rather than trims.
 *
 * These mirror the server's gate and its anchor rules and have to change
 * with them. They only ever leave things out; whatever passes here is still
 * the server's to judge.
 */

/** A record's sentence is at most this long. */
export const MAX_CONTENT_CHARS = 220

/** A record's detail is at most this long. */
export const MAX_DETAIL_CHARS = 1200

/** Rejected options a decision may list, and how long each may be. */
export const MAX_ALTERNATIVES = 6
export const MAX_ALTERNATIVE_CHARS = 220

/** Path anchors one write may send; over it the write is refused, not cut. */
export const MAX_ANCHORS = 12

export const MAX_PATH_CHARS = 400
export const MAX_SYMBOL_CHARS = 200

/** Words a memory's sentence may open with: an order starts with its verb, or with when it applies. */
const OPENERS: readonly string[] = [
  'after', 'always', 'before', 'do not', "don't", 'for', 'if', 'never', 'on', 'only', 'when',
  'add', 'assume', 'avoid', 'bind', 'build', 'call', 'cap', 'check', 'confirm', 'configure', 'copy', 'delete', 'deploy',
  'disable', 'drop', 'enable', 'ensure', 'expect', 'export', 'fetch', 'grant', 'install', 'keep', 'kill', 'label', 'leave',
  'limit', 'log', 'make', 'merge', 'mount', 'move', 'pass', 'pin', 'point', 'prefer', 'put', 'query', 'read', 'rebuild',
  'reboot', 'reindex', 'remove', 'rename', 'restart', 'restore', 'retry', 'reuse', 'revoke', 'rotate', 'route', 'run', 'send',
  'set', 'skip', 'split', 'stamp', 'start', 'stop', 'store', 'tag', 'treat', 'update', 'use', 'verify', 'wait', 'wrap', 'write',
] // prettier-ignore

const OPENS = new RegExp(`^(?:${OPENERS.map(opener => opener.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`)

// A decision or a correction may say what is so instead of ordering it.
const STATES = /\b(?:is|are|must|stays|becomes)\b/i

const SENTENCE_END = /[.!?](?:\s|$)/g
const BACKTICKED = /`[^`]*`/g

// Phrases that only ever report where something has got to, and words that
// do so next to the ticket, pull request or date whose state they give.
const STATUS = /\b(?:open PR|draft PR|in review|awaiting review|blocked on|waiting for|as of 20\d\d|is now live)\b/i
const STATUS_WORD = /\b(?:merged|pending|landed|WIP|awaiting|deployed on)\b/gi
const STATUS_ANCHOR = /#\d+|\b[A-Z]{2,6}-\d+\b|\b20\d\d-\d{2}-\d{2}\b|\b20\d\d\b/g
const TICKET = /#\d+|\b[A-Z]{2,6}-\d+\b/g
const STATUS_NEAR = 40
const MAX_TICKETS = 2

function readsAsStatus(text: string): boolean {
  if (STATUS.test(text)) {
    return true
  }

  const anchors = [...text.matchAll(STATUS_ANCHOR)].map(match => [match.index, match.index + match[0].length] as const)

  return [...text.matchAll(STATUS_WORD)].some(word =>
    anchors.some(([from, to]) => word.index + word[0].length >= from - STATUS_NEAR && word.index <= to + STATUS_NEAR),
  )
}

/**
 * Why the server would refuse a record's text, by its own name for the
 * rule; undefined when it would not. The first rule broken is the one named,
 * in the server's order.
 */
export function refusalOf(kind: string, content: string, detail: string, triggers: readonly string[]): string | undefined {
  const sentence = content.trim()
  const both = `${sentence}\n${detail}`
  const rules: readonly (readonly [string, boolean])[] = [
    ['too_long', sentence.length > MAX_CONTENT_CHARS],
    ['detail_too_long', detail.trim().length > MAX_DETAIL_CHARS],
    ['not_one_sentence', (sentence.replace(BACKTICKED, ' ').match(SENTENCE_END) ?? []).length > 1],
    ['status_not_memory', readsAsStatus(both) || (both.match(TICKET) ?? []).length > MAX_TICKETS],
    [
      'not_imperative',
      !(OPENS.test(sentence.toLowerCase()) || ((kind === 'decision' || kind === 'correction') && STATES.test(sentence))),
    ],
    ['no_trigger', kind === 'gotcha' && !triggers.some(trigger => trigger.trim() !== '')],
  ]

  return rules.find(([, isBroken]) => isBroken)?.[0]
}

const LINE_REFERENCE = /(?::\d+(?:-\d+)?(?::\d+)?|#L\d+(?:-L?\d+)?)$/
const CONTROL = /[\u0000-\u001f\u007f]/

/** `path` without a line or a range at its end: lines move with every edit, and the server takes none. */
export function withoutLine(path: string): string {
  return path.replace(LINE_REFERENCE, '')
}

/** Whether the server takes `path` as a path of the repository. */
export function isRepoPath(path: string): boolean {
  const segments = path.split('/')

  return (
    path !== '' &&
    path === path.trim() &&
    path.length <= MAX_PATH_CHARS &&
    !CONTROL.test(path) &&
    !path.includes('\\') &&
    !/^[A-Za-z]:/.test(path) &&
    !path.startsWith('/') &&
    !path.endsWith('/') &&
    !segments.includes('..') &&
    !segments.includes('.') &&
    !segments.includes('') &&
    !LINE_REFERENCE.test(path)
  )
}

/** A symbol as the server takes it: trimmed, a name and not a snippet; undefined when it is none. */
export function symbolOf(value: unknown): string | undefined {
  const symbol = typeof value === 'string' ? value.trim() : ''

  return symbol === '' || symbol.length > MAX_SYMBOL_CHARS || CONTROL.test(symbol) ? undefined : symbol
}
