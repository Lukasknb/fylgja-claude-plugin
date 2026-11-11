/**
 * The bar a record clears before the knowledge base keeps it, in the words
 * Fylgja's server states it in: to the coding assistant in its remember
 * tool, and to the model that judges the assistant's decisions. Scribe's
 * instruction states the same words, so the two hold one bar.
 *
 * Written by tests/scenarios/shape-from-gate.mjs out of the server's own
 * text (domain/services/memory_bar.py) as it stood at its commit 7d17db79.
 * Not edited by hand.
 */

/** The one test, as a question. */
export const BAR_QUESTION = 'would a later reader of the code or of the product ask "why is it like this?"'

/** The default answer to it. */
export const BAR_DEFAULT = 'Most work leaves nothing worth keeping: the default is not to write'

/** How the work is organised: never a record, however carefully it was weighed. */
export const WORK_ORGANISATION =
  'what goes in the backlog, an epic or a ticket and what to track or build next, which task comes first or what to do next, which branch, pull request or layer of a stack of pull requests a change goes in, how the work is split into pull requests or commits and in what order they land, and how a review or a merge is run'

/** Why work organisation never passes the test. */
export const WORK_ORGANISATION_WHY =
  'a later reader of the code never asks which branch, pull request, ticket or epic a change went in: the code is the same either way'

/** What else never clears the bar. */
export const BAR_NEVER: readonly string[] = [
  'doing what was asked when no alternative was weighed ("cache it", "add an index": a request carried out is not a decision)',
  'naming',
  'formatting',
  'routine edits',
  'a refactor with no choice in it',
  'what the code plainly says',
  'status ("tests pass", "PR opened")',
  'a discussion that reached no conclusion',
]

/** The exception: how changes ship, when it holds for every change of a kind. */
export const STANDING_RULE = "A standing rule of the team's about how every change of a kind ships IS a decision"
export const STANDING_RULE_EXAMPLES: readonly string[] = [
  'Schema changes ship in a separate PR from the code that uses them so the expand migration deploys first',
  'Hotfixes are cut from the release branch, not main',
  'Each PR stack is merged with Graphite so reviewers see small diffs',
]
export const STANDING_RULE_TEST =
  'The question is whether it holds for the next change too, or only for the one in hand'

/** What a decision that clears the bar looks like. */
export const BAR_EARNS: readonly string[] = [
  'a choice between alternatives that were really weighed, with what was rejected',
  'an approach that was tried or proposed and then rejected',
  'a constraint or a workaround the code now depends on',
]
