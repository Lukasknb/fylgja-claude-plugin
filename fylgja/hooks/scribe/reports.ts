/**
 * The final reports agents of the session hand back, and the one rule that
 * decides whether something a report says is confirmed. Nothing here asks a
 * model: what the main conversation said is read as it was said.
 */

import type { Row } from './delta'
import { isPrompt } from './delta'
import { shareIn } from './words'

/** No more of the brief an agent was given is read than this, in characters. */
const MAX_BRIEF_CHARS = 800

/**
 * A line of the main conversation confirms a gotcha when this share of the
 * gotcha's words stand in it, once what it copies of the report is taken out.
 */
export const CONFIRM_SHARE = 0.4

/** A run of this many words in a row that the report holds too is copied from it, and is nobody's own words. */
export const COPIED_RUN = 6

/** The place of the main conversation's call of the Agent tool that started `agentId`; -1 when no row holds one. */
function startOf(rows: readonly Row[], agentId: string): number {
  return rows.findIndex(row => row.toolUses.some(use => use.agentId === agentId))
}

/**
 * Whether the main conversation started the agent with its Agent tool: only
 * then is what it hands back a report of this session's. An agent another
 * agent started, or a plugin, has no such call among the main rows.
 */
export function isStarted(rows: readonly Row[], agentId: string): boolean {
  return startOf(rows, agentId) !== -1
}

/**
 * What the agent was asked to do, as the call of the Agent tool that started
 * it says; empty when no row holds it.
 */
export function briefOf(rows: readonly Row[], agentId: string): string {
  const use = rows[startOf(rows, agentId)]?.toolUses.find(one => one.agentId === agentId)
  const said = [use?.input.description, use?.input.prompt].filter((one): one is string => typeof one === 'string' && one.trim() !== '')
  const brief = said.join('\n')

  return brief.length <= MAX_BRIEF_CHARS ? brief : `${brief.slice(0, MAX_BRIEF_CHARS)}…`
}

const tokens = (text: string): string[] => text.toLowerCase().match(/[a-z0-9_]+/g) ?? []

/**
 * `text` without what it copies of `report`: every run of `COPIED_RUN` words
 * in a row that the report holds as well is taken out. What is left is the
 * writer's own words.
 */
export function ownWords(text: string, report: string): string {
  const words = tokens(text)
  const theirs = tokens(report)
  const runs = new Set<string>()

  for (let at = 0; at + COPIED_RUN <= theirs.length; at += 1) {
    runs.add(theirs.slice(at, at + COPIED_RUN).join(' '))
  }

  const copied = new Array<boolean>(words.length).fill(false)

  for (let at = 0; at + COPIED_RUN <= words.length; at += 1) {
    if (runs.has(words.slice(at, at + COPIED_RUN).join(' '))) {
      copied.fill(true, at, at + COPIED_RUN)
    }
  }

  return words.filter((_, at) => !copied[at]).join(' ')
}

/**
 * Whether the main conversation confirmed `content`, a gotcha taken out of
 * the report `report` of `agentId`: after the call that started the agent,
 * Claude or the developer said it again in their own words. Claude passing
 * the report on as it stands confirms nothing, and neither does going on
 * with the work.
 *
 * @param prompts the developer's prompts, each as `plain` leaves it: what tells their rows from the others
 */
export function isConfirmed(
  rows: readonly Row[],
  agentId: string,
  report: string,
  content: string,
  prompts: ReadonlySet<string>,
): boolean {
  const from = startOf(rows, agentId)

  return (
    from !== -1 &&
    rows.slice(from + 1).some(row => {
      const said = row.role === 'assistant' || isPrompt(row, prompts) ? row.text : ''

      return said.trim() !== '' && shareIn(content, ownWords(said, report)) >= CONFIRM_SHARE
    })
  )
}
