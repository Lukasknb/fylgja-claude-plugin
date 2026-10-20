/**
 * Whether the project the session runs in leaves Fylgja's connection to the
 * plugin.
 *
 * Claude Code loads every `.mcp.json` from the working directory up to the
 * top of the file system. An entry there can stand in for the plugin's own
 * server in two ways the engine does not tell apart from the real thing: it
 * can point at the same address, and the engine then runs the two as one
 * with that entry's headers; and it can take the plugin's own connection
 * name, and the engine then answers that name for a connection made with
 * the entry's headers. A cloned repository can ship either, with a token
 * for an account of its own choosing. Nothing says afterwards where the
 * connection came from, so the files are read before any answer is trusted.
 */

import { FYLGJA_HOST } from './citations'
import { isRecord } from './payload'
import { OWN_SERVER } from './scribe/grant'

/** The engine calls the reading of a project's files makes. */
export type Files = {
  /** Whether a file is at `path` (`$.fs.stat`). */
  exists: (path: string) => Promise<boolean>
  /** `$.fs.read`: the file's text; rejects when it cannot be read. */
  read: (path: string) => Promise<string>
  /** The text of the plugin's own `.mcp.json`. */
  declared: () => Promise<string>
}

/** No more folders are climbed than this. */
const MAX_LEVELS = 64

function servers(parsed: unknown): [string, unknown][] {
  if (!isRecord(parsed)) {
    return []
  }

  // The file's own shape, and the bare map of servers some tools write.
  return [...Object.entries(isRecord(parsed.mcpServers) ? parsed.mcpServers : {}), ...Object.entries(parsed)]
}

/** The hosts the plugin's own declaration names, and the host its records are opened on. */
async function hostsOf(files: Files): Promise<string[]> {
  const hosts = new Set([FYLGJA_HOST])

  try {
    for (const [, server] of servers(JSON.parse(await files.declared()))) {
      const url = isRecord(server) && typeof server.url === 'string' && URL.canParse(server.url) ? new URL(server.url) : undefined

      if (url !== undefined && url.hostname !== '') {
        hosts.add(url.hostname.toLowerCase())
      }
    }
  } catch {
    // The plugin's own file could not be read: the host its links go to is still known.
  }

  return [...hosts]
}

/** Whether `text` names `host` as a host: not as part of a longer name. */
function names(text: string, host: string): boolean {
  let from = text.indexOf(host)

  while (from !== -1) {
    const before = text[from - 1] ?? ''
    const after = text[from + host.length] ?? ''

    if (
      !/[a-z0-9.-]/.test(before) &&
      !/[a-z0-9-]/.test(after) &&
      !(after === '.' && /[a-z0-9]/.test(text[from + host.length + 1] ?? ''))
    ) {
      return true
    }

    from = text.indexOf(host, from + 1)
  }

  return false
}

/**
 * Whether one entry of a project's `.mcp.json` could stand in for the
 * plugin's own server: by its name (the plugin's connection name, anything
 * holding it, anything starting with `plugin`, in either spelling of the
 * separators), or by naming a host of Fylgja's anywhere in it, whatever the
 * scheme, port or path, and whether as a `url` or inside a command.
 */
function standsIn(name: string, entry: unknown, hosts: readonly string[]): boolean {
  const plain = name.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  const own = OWN_SERVER.replace(/[^a-z0-9]+/g, '_')
  const text = (JSON.stringify(entry) ?? '').toLowerCase()

  return plain.startsWith('plugin') || plain.includes(own) || hosts.some(host => names(text, host))
}

/**
 * Whether no `.mcp.json` from `cwd` upward holds an entry that could stand
 * in for the plugin's server. A file that is there and cannot be read, or
 * does not parse, counts as one that does: what the engine made of it is
 * not known.
 */
export async function isLeftToPlugin(files: Files, cwd: string): Promise<boolean> {
  let folder = cwd.replace(/\/+$/, '')
  let hosts: string[] | undefined

  for (let level = 0; level < MAX_LEVELS; level += 1) {
    const path = `${folder}/.mcp.json`

    if (await files.exists(path)) {
      let parsed: unknown

      try {
        parsed = JSON.parse(await files.read(path))
      } catch {
        return false
      }

      if (!isRecord(parsed)) {
        return false
      }

      hosts ??= await hostsOf(files)

      for (const [name, entry] of servers(parsed)) {
        if (name !== 'mcpServers' && standsIn(name, entry, hosts)) {
          return false
        }
      }
    }

    if (folder === '') {
      return true
    }

    folder = folder.slice(0, folder.lastIndexOf('/'))
  }

  // Deeper than any real tree: not read to the top, so not vouched for.
  return false
}
