/**
 * What crosses between the hooks module and the navigator: the view handed
 * down, sized to stay well under what one `Client` may carry, and the
 * message that comes back, checked before anything acts on it.
 */

import { placeOf } from './atlas'
import type { Atlas } from './atlas'
import { isRecord } from './payload'
import { isId, levelOf, ROOT } from './shape'
import type { Fetch, Knowledge, Message, Place, Position, View } from './shape'

/** A `Client` carries at most 100,000 characters of props; the places take up to this much of it. */
const BUDGET = 60_000

/**
 * The view for where the person is: every level on their path, the
 * highlighted project, and as many of the highlighted project's siblings as
 * are already known and fit, nearest first, so moving the highlight shows a
 * preview at once.
 */
export function viewOf(atlas: Atlas, columns: number, rows: number): View {
  const { position } = atlas
  const level = placeOf(atlas, levelOf(position))
  const siblings = level?.rows ?? []
  const at = Math.max(
    0,
    siblings.findIndex(row => row.id === position.pick),
  )
  const nearest = siblings
    .map((row, index) => ({ id: row.id, far: Math.abs(index - at) }))
    .sort((a, b) => a.far - b.far)
  const places: Record<string, Place> = {}
  const knowledge: Record<string, Knowledge> = {}
  const fetches: Record<string, Fetch> = {}
  let left = BUDGET

  for (const id of position.path) {
    const place = placeOf(atlas, id)

    if (place !== undefined) {
      places[id] = place
      left -= JSON.stringify(place).length
    }
  }

  for (const { id } of nearest) {
    const place = atlas.places.get(id)
    const size = place === undefined ? 0 : JSON.stringify(place).length

    if (place !== undefined && places[id] === undefined && size <= left) {
      places[id] = place
      left -= size
    }
  }

  const picked = siblings[at]?.id
  const known = picked === undefined ? undefined : atlas.knowledge.get(picked)

  if (picked !== undefined && known !== undefined) {
    knowledge[picked] = known
  }

  for (const id of [...position.path, ...siblings.map(row => row.id)]) {
    for (const key of [`o:${id}`, `s:${id}`]) {
      const fetch = atlas.fetches.get(key)

      if (fetch !== undefined) {
        fetches[key] = fetch
      }
    }
  }

  return {
    epoch: atlas.epoch,
    position,
    places,
    knowledge,
    fetches,
    note: atlas.note !== '' ? atlas.note : atlas.miss,
    mayMissTops: atlas.mayMissTops,
    columns,
    rows,
  }
}

/**
 * What tells two views apart for the navigator. Its own position is left
 * out: the navigator keeps that itself and only follows a new `epoch`.
 */
export function signatureOf(view: View): string {
  return JSON.stringify({ ...view, position: null })
}

function positionOf(value: unknown): Position | undefined {
  if (!isRecord(value) || !Array.isArray(value.path) || value.path.length < 1 || value.path.length > 32) {
    return undefined
  }

  const [top, ...below] = value.path as unknown[]
  const isPick = value.pick === '' || isId(value.pick)

  if (top !== ROOT || !below.every(isId) || !isPick) {
    return undefined
  }

  return {
    path: [ROOT, ...(below as string[])],
    pick: value.pick as string,
    showsState: value.showsState === true,
    risksOpen: value.risksOpen === true,
    commitmentsOpen: value.commitmentsOpen === true,
  }
}

/** The message in what the navigator posted, or undefined when it is not one. */
export function messageOf(data: unknown): Message | undefined {
  if (!isRecord(data) || typeof data.epoch !== 'number') {
    return undefined
  }

  const position = positionOf(data.position)

  if (position === undefined) {
    return undefined
  }

  const message: Message = { epoch: data.epoch, position }

  return data.act === 'reference' || data.act === 'scope' ? { ...message, act: data.act } : message
}
