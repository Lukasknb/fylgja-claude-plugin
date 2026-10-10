// Reads a recorded session for a replay and writes, into the output
// directory and nowhere else: the session's turns (`session.json` and its
// parts, `session-<n>.json`), and what
// the stand-in server holds (`scenarios.json`). Prints numbers only.
//
//   node replay-read.mjs <transcript.jsonl> <out-dir> [--seed <records.json>] [--root <dir>] [--remote <url>]
//
// The transcript is read, never written. What a session holds is somebody's
// work: nothing of it is printed, and it goes only into <out-dir>.
//
// A seed file gives the stand-in the records a knowledge base would already
// hold for the repository, so that a tell or a reversal can occur:
//
//   [{ "id": "<uuid>", "kind": "decision" | "gotcha" | "runbook" | "correction",
//      "content": "<one sentence>", "detail": "<the reason>",
//      "anchors": ["src/file.ts", { "path": "src/dir", "symbol": "name" }],
//      "alternatives": ["<what was ruled out>"], "reason_status": "stated",
//      "date": "2026-09-12" }]
//
// Only id, kind and content are needed.
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

import { reader } from './transcript.ts'

const [transcript, out, ...rest] = process.argv.slice(2)
const flag = name => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined)

/** The root of the working tree `cwd` is in and the address of its `origin`, read from the files git keeps; null outside a repository. */
function repoOf(cwd) {
  for (let dir = cwd; ; dir = dirname(dir)) {
    const dot = join(dir, '.git')

    if (existsSync(dot)) {
      let config = join(dot, 'config')

      // A worktree's `.git` is a file that names its own folder inside the repository it belongs to.
      if (statSync(dot).isFile()) {
        const named = /^gitdir:\s*(.+)$/m.exec(readFileSync(dot, 'utf8'))?.[1]?.trim() ?? ''
        const own = isAbsolute(named) ? named : resolve(dir, named)
        const common = existsSync(join(own, 'commondir'))
          ? resolve(own, readFileSync(join(own, 'commondir'), 'utf8').trim())
          : own

        config = join(common, 'config')
      }

      const text = existsSync(config) ? readFileSync(config, 'utf8') : ''
      const remote = /\[remote "origin"\][^[]*?\burl\s*=\s*(\S+)/.exec(text)?.[1] ?? null

      return { root: dir, remote, isWorktree: statSync(dot).isFile() }
    }

    if (dirname(dir) === dir) {
      return null
    }
  }
}

const reading = reader()

for await (const line of createInterface({ input: createReadStream(transcript, 'utf8'), crlfDelay: Infinity })) {
  reading.push(line)
}

const recorded = reading.done()
const cwd = recorded.turns.find(turn => turn.cwd !== null)?.cwd ?? recorded.cwd
const root = flag('--root')
const found =
  root !== undefined
    ? { root, remote: flag('--remote') ?? null, isWorktree: false }
    : cwd !== null && existsSync(cwd)
      ? repoOf(cwd)
      : null
const repo = found === null ? null : { root: found.root, remote: flag('--remote') ?? found.remote }
// The name the stand-in files its records under: the one Scribe will derive for the repository.
const name =
  repo === null
    ? null
    : (/([^/:]+\/[^/:]+?)(?:\.git)?\/?$/.exec(repo.remote ?? '')?.[1] ?? repo.root.replace(/\/+$/, '').split('/').at(-1))
const seed = flag('--seed') === undefined ? [] : JSON.parse(readFileSync(flag('--seed'), 'utf8'))
const records = seed.map(one => ({
  id: String(one.id).toLowerCase(),
  type: one.kind ?? 'decision',
  content: one.content,
  detail: one.detail ?? null,
  alternatives: one.alternatives ?? [],
  reason_status: one.reason_status ?? ((one.kind ?? 'decision') === 'decision' ? 'stated' : null),
  anchors: (one.anchors ?? []).map(anchor => (typeof anchor === 'string' ? { path: anchor } : anchor)),
  ...(one.date === undefined ? {} : { last_verified: `${one.date}T00:00:00Z` }),
  // Somebody else's, so that Scribe treats it as a record it did not write.
  origin: one.origin ?? 'assistant',
}))

// The engine reads no file over four megabytes, so the turns go into parts well under that.
const PART_BYTES = 3_000_000
const parts = [[]]
let size = 0

for (const turn of recorded.turns) {
  let text = JSON.stringify(turn)

  // One turn too large for a part keeps its rows and calls, with less of what each call held.
  if (text.length > PART_BYTES) {
    for (const row of turn.rows) {
      for (const use of row.toolUses) {
        use.text = use.text?.slice(0, 300)
        use.input = Object.fromEntries(
          Object.entries(use.input).map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 300) : value]),
        )
      }
    }

    text = JSON.stringify(turn)
  }

  if (size + text.length > PART_BYTES && parts.at(-1).length > 0) {
    parts.push([])
    size = 0
  }

  parts.at(-1).push(turn)
  size += text.length
}

// Which working tree each file the session touched lies in, as this machine has them today: a repository checked
// out inside another, a worktree and a checkout beside the session's own are each their own. A folder that is gone
// is in none.
const trees = {}
const looked = new Set()

for (const turn of recorded.turns) {
  for (const row of turn.rows) {
    for (const use of row.toolUses) {
      const file = use.input.file_path ?? use.input.notebook_path
      const folder = typeof file === 'string' && file.startsWith('/') ? dirname(file) : undefined

      if (folder !== undefined && !looked.has(folder)) {
        looked.add(folder)

        const tree = existsSync(folder) ? repoOf(folder) : null

        if (tree !== null) {
          trees[tree.root] = tree.remote
        }
      }
    }
  }
}

writeFileSync(
  join(out, 'session.json'),
  JSON.stringify({ sessionId: recorded.sessionId ?? 'replayed-session', repo, trees, parts: parts.length }),
)
parts.forEach((turns, at) => writeFileSync(join(out, `session-${at}.json`), JSON.stringify(turns)))
writeFileSync(join(out, 'scenarios.json'), JSON.stringify([{ id: 'replay', repo: name ?? 'none/none', records }]))

const prompts = recorded.turns.filter(turn => turn.kind === 'prompt').length
const times = recorded.turns.map(turn => turn.at).filter(at => at > 0)

writeFileSync(
  join(out, 'read.json'),
  JSON.stringify({
    version: recorded.version,
    turns: recorded.turns.length,
    prompts,
    others: recorded.turns.filter(turn => turn.kind === 'other').length,
    clears: recorded.turns.filter(turn => turn.kind === 'clear').length,
    compactions: recorded.turns.filter(turn => turn.kind === 'compact').length,
    plans: recorded.turns.filter(turn => turn.hasPlan).length,
    rows: recorded.turns.reduce((sum, turn) => sum + turn.rows.length, 0),
    toolCalls: recorded.turns.reduce((sum, turn) => sum + turn.rows.reduce((n, row) => n + row.toolUses.length, 0), 0),
    left: recorded.left,
    hours: times.length < 2 ? 0 : (Math.max(...times) - Math.min(...times)) / 3_600_000,
    isInRepository: repo !== null,
    isWorktree: found?.isWorktree ?? false,
    isDirectoryGone: cwd !== null && root === undefined && !existsSync(cwd),
    seeded: records.length,
    trees: Object.keys(trees).length,
  }),
)
console.log(
  `${recorded.turns.length} turns (${prompts} of the developer's), ${repo === null ? 'not in a repository' : 'in a repository'}`,
)
