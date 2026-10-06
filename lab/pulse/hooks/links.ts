/**
 * The links that open records in the Fylgja app, for the entries under the
 * cursor.
 *
 * The timeline carries no links. A server that has the `resolve` tool
 * answers a record's link for its id; one that does not answers an error,
 * after which it is not asked again and no entry offers a link.
 */

import { askJson } from './answer'
import type { Host } from './host'
import { isRecord } from './payload'

/** How many ids one `resolve` call takes. */
const MAX_REFS = 20

/** How many answers are remembered; the oldest go first. */
const MAX_KNOWN = 500

const LINK = /^https:\/\/fylgja\.lknblab\.dev\/open\/[a-z_]{1,40}\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

export type Links = {
  /** By record id: its link, or null when the server gave none for it. */
  known: Map<string, string | null>
  /** Whether the server turned out not to answer links at all. */
  isOff: boolean
}

export function create(): Links {
  return { known: new Map(), isOff: false }
}

/**
 * A record's link, when it is exactly a link to that record in the Fylgja
 * app: this host, the `/open/<kind>/<id>` path, and the id that was asked
 * for. Anything else is no link.
 */
export function linkOf(record: Record<string, unknown>, id: string): string | null {
  const link = typeof record.link === 'string' ? record.link : ''

  return LINK.exec(link)?.[1] === id ? link : null
}

/**
 * Asks for the links of the ids not asked about yet. Returns whether
 * anything was learned.
 */
export async function learn(host: Host, links: Links, ids: readonly string[]): Promise<boolean> {
  const asked = [...new Set(ids)].filter(id => !links.known.has(id)).slice(0, MAX_REFS)

  if (links.isOff || asked.length === 0) {
    return false
  }

  const connection = await host.connect().catch(() => ({ isConnected: false as const, reason: 'failed' }))

  if (!connection.isConnected) {
    return false
  }

  const payload = await askJson(host, connection.server, 'resolve', { refs: asked })

  if (payload === undefined || !Array.isArray(payload.records)) {
    links.isOff = true

    return false
  }

  const answered = new Map<string, Record<string, unknown>>()

  for (const record of payload.records) {
    if (isRecord(record) && typeof record.ref === 'string') {
      answered.set(record.ref.toLowerCase(), record)
    }
  }

  for (const id of asked) {
    const record = answered.get(id)

    links.known.set(id, record === undefined || record.found !== true ? null : linkOf(record, id))
  }

  for (const id of links.known.keys()) {
    if (links.known.size <= MAX_KNOWN) {
      break
    }

    links.known.delete(id)
  }

  return true
}
