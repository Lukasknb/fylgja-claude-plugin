/**
 * Calendar days as whole numbers (days since 1970-01-01, UTC), so a window
 * and its columns are plain arithmetic.
 */

const DAY_MS = 86_400_000;

/** The day `ms` (milliseconds since the epoch) falls on. */
export function dayAt(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

/** `day` as `YYYY-MM-DD`. */
export function isoOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The day a `YYYY-MM-DD` string names, or undefined when it is not a real
 * date written that way (`2026-13-45` is not one).
 */
export function dayOf(iso: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return undefined;
  }

  const ms = Date.parse(`${iso}T00:00:00Z`);

  if (Number.isNaN(ms)) {
    return undefined;
  }

  const day = dayAt(ms);

  return isoOf(day) === iso ? day : undefined;
}

/** `day` as `MM-DD`, for an axis. */
export function shortOf(day: number): string {
  return isoOf(day).slice(5);
}
