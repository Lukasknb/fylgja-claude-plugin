import type { Resolution } from './resolve'

/**
 * What Fylgja last said about the references seen in this conversation, by
 * record id, so the rows that show them need no lookup of their own.
 *
 * Held in the running plugin only, and only for as long as it is known to be
 * true: everything is forgotten when the conversation starts over and when
 * the person has to sign in. A row whose record is not held falls back to a
 * chip that claims nothing, and has it looked up.
 */
export type Memory = Map<string, Resolution>

const MAX_HELD = 500

export function create(): Memory {
  return new Map()
}

export function keep(memory: Memory, resolutions: readonly Resolution[]): void {
  for (const resolution of resolutions) {
    memory.delete(resolution.id)
    memory.set(resolution.id, resolution)
  }

  // The oldest go first once the conversation has seen more than it needs.
  for (const id of memory.keys()) {
    if (memory.size <= MAX_HELD) {
      break
    }

    memory.delete(id)
  }
}
