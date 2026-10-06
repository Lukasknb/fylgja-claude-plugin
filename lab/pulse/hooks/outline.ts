/**
 * Reads what `open` answers for a project: the project, and its children one
 * level down with how much is filed under each and when each was last active.
 */

import { isRecord } from "./payload";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** No project's name is kept longer than this. */
const MAX_NAME = 200;

/** More children than this are not kept; the picture says the rest were left out. */
export const MAX_CHILDREN = 60;

export type Child = {
  id: string;
  /** The child's name exactly as the server wrote it; made safe where it is drawn. */
  name: string;
  /** How many records are filed under it. */
  filed: number;
  /** How many children of its own it has. */
  children: number;
  lastActivity: string | null;
};

export type Outline = Child & {
  /** The names from the top of the tree down to this project, as the server wrote them. */
  path: string[];
  kids: Child[];
  /** Children the server did not list here: a further page, or ones it folded into a count. */
  unlisted: number;
  /** Whether the server listed more children than this view keeps or could read. */
  isShort: boolean;
};

function idOf(value: unknown): string | undefined {
  const id = typeof value === "string" ? value.toLowerCase() : "";

  return UUID.test(id) ? id : undefined;
}

function countOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function dateOf(value: unknown): string | null {
  return typeof value === "string" && DATE.test(value) ? value : null;
}

function nameOf(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= MAX_NAME
    ? value
    : undefined;
}

function childOf(value: unknown): Child | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = idOf(value.id);
  const name = nameOf(value.name);

  if (id === undefined || name === undefined) {
    return undefined;
  }

  return {
    id,
    name,
    filed: countOf(value.atoms),
    children: countOf(value.children),
    lastActivity: dateOf(value.last_activity),
  };
}

/**
 * The project outline in `payload`, or undefined when it is not one: another
 * kind of record, or an answer without the project's own name and id.
 *
 * A child the answer lists without a readable id or name is left out and the
 * outline says it is short, as it does when more are listed than are kept.
 */
export function outlineOf(
  payload: Record<string, unknown> | undefined,
): Outline | undefined {
  if (
    payload === undefined ||
    payload.kind !== "project" ||
    !isRecord(payload.subject)
  ) {
    return undefined;
  }

  const id = idOf(payload.subject.id);
  const name = nameOf(payload.subject.name);

  if (id === undefined || name === undefined) {
    return undefined;
  }

  const listed = Array.isArray(payload.children) ? payload.children : [];
  const read = listed.map(childOf).filter((child) => child !== undefined);
  const kids = read.slice(0, MAX_CHILDREN);
  const counts = isRecord(payload.counts) ? payload.counts : {};
  const above = Array.isArray(payload.subject.path)
    ? payload.subject.path.filter(
        (part) => typeof part === "string" && part !== "",
      )
    : [];
  const folded = isRecord(payload.technical)
    ? countOf(payload.technical.count)
    : 0;
  const hasNextPage =
    typeof payload.next_cursor === "string" && payload.next_cursor !== "";

  return {
    id,
    name,
    filed: countOf(counts.atoms),
    children: listed.length,
    lastActivity: dateOf(counts.last_activity),
    // The path ends in the project itself; an answer that leaves it off still names where it is.
    path: above[above.length - 1] === name ? above : [...above, name],
    kids,
    unlisted: folded + (hasNextPage ? 1 : 0),
    isShort:
      hasNextPage ||
      folded > 0 ||
      read.length < listed.length ||
      read.length > kids.length,
  };
}
