/**
 * Running git on the machine, the one way Scribe does it: by its argument
 * vector with no shell, in one working tree, and given up on quietly.
 *
 * git is asked not to take its index lock (`--no-optional-locks`), so a
 * commit the developer is making at the same moment is never in its way;
 * to read paths as they are written (`--literal-pathspecs`); and not to
 * start the file monitor a repository's settings may name. Each command is
 * waited for `GIT_TIMEOUT_MS` at most, whatever the host does about it.
 */

import { limited } from './time'
import type { After } from './time'

/** How long one git command may take. */
export const GIT_TIMEOUT_MS = 1500

/** What a command printed and how it ended, as `$.process.run` answers. */
export type Ran = { exitCode: number; stdout: string }

/** Runs a command by its argument vector, with no shell; rejects when it cannot start or outlives `timeoutMs`. */
export type Run = (argv: readonly string[], timeoutMs: number) => Promise<Ran>

/** What git answered to `args` in the working tree at `root`, or undefined when it could not start, failed or took too long. */
export function gitIn(run: Run, after: After, root: string, args: readonly string[]): Promise<Ran | undefined> {
  const argv = ['git', '--no-optional-locks', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-C', root, ...args]

  return limited(after, run(argv, GIT_TIMEOUT_MS), GIT_TIMEOUT_MS).catch(() => undefined)
}
