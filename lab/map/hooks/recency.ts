import type { Recency } from './shape'

const DAY_MS = 86_400_000

/**
 * How lately something happened: within the last week, within the last
 * month, or longer ago. A date that cannot be read, and no date, are quiet.
 */
export function recencyOf(day: unknown, nowMs: number): Recency {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(day)) {
    return 'quiet'
  }

  const then = Date.parse(`${day.slice(0, 10)}T00:00:00Z`)

  if (Number.isNaN(then)) {
    return 'quiet'
  }

  const days = (nowMs - then) / DAY_MS

  return days <= 7 ? 'fresh' : days <= 31 ? 'month' : 'quiet'
}
