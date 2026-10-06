/**
 * What one Fylgja read returned, as much as the ledger keeps: the record it
 * opened, the hits it found, how long a list was, and every record id it
 * named. The result is only read; nothing here changes it.
 */

import { NOTHING } from "./call";
import type { Hit, Reading, Seen } from "./call";
import { bodyOf, entriesIn, recordOfText } from "./fenced";
import { firstIdIn, idOf, idsIn, linkOf } from "./links";
import { isRecord, payloadOf } from "./payload";
import type { ReadTool } from "./tools";

/** A result longer than this is read up to here. The server cuts every read at 20,000 characters. */
const MAX_TEXT = 120_000;
const MAX_IDS = 400;
const MAX_HITS = 50;
const MAX_TITLE = 300;
const MAX_QUERY = 200;

function text(value: unknown, max = MAX_TITLE): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.slice(0, max)
    : undefined;
}

function dateOf(value: unknown): string | undefined {
  return typeof value === "string"
    ? /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0]
    : undefined;
}

function kindOf(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z_]{1,40}$/.test(value)
    ? value
    : undefined;
}

function pathOf(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.path)) {
    return undefined;
  }

  const names = value.path.filter(
    (name): name is string => typeof name === "string",
  );

  return names.length === 0 ? undefined : names.join(" > ").slice(0, MAX_TITLE);
}

/** The text of a result as Claude read it: the joined text blocks, however the result is stored. */
function rawOf(result: unknown, joined: string | undefined): string {
  if (joined !== undefined) {
    return joined;
  }

  if (typeof result === "string") {
    return result;
  }

  const blocks = Array.isArray(result)
    ? result
    : isRecord(result) && Array.isArray(result.content)
      ? result.content
      : [];
  const fromBlocks = blocks
    .map((block) =>
      isRecord(block) && block.type === "text" && typeof block.text === "string"
        ? block.text
        : "",
    )
    .join("");

  if (fromBlocks !== "") {
    return fromBlocks;
  }

  // A text result may be stored wrapped as `{ result: "<text>" }`.
  const structured =
    isRecord(result) && isRecord(result.structuredContent)
      ? result.structuredContent
      : result;

  return isRecord(structured) && typeof structured.result === "string"
    ? structured.result
    : "";
}

/** A record described by a JSON object: one search hit, one resolved reference, or a whole opened record. */
function seenOf(
  value: Record<string, unknown>,
  fallbackKind: string,
  askedId: string | undefined,
): Seen | undefined {
  const subject = isRecord(value.subject) ? value.subject : {};
  const resource = isRecord(value.resource) ? value.resource : {};
  const id =
    idOf(resource.id) ??
    idOf(value.id) ??
    idOf(value.document_id) ??
    idOf(subject.id) ??
    askedId;
  const title =
    text(value.title) ??
    text(value.full_name) ??
    text(value.what) ??
    text(subject.name);

  if (id === undefined && title === undefined) {
    return undefined;
  }

  return {
    id,
    kind: kindOf(value.kind) ?? kindOf(value.type) ?? fallbackKind,
    title: title ?? "",
    date: dateOf(value.date) ?? dateOf(value.decided_at),
    project: pathOf(value.project) ?? pathOf(subject),
    link: linkOf(value.link, id),
  };
}

function hitsOf(list: unknown): Hit[] {
  const hits: Hit[] = [];

  for (const entry of Array.isArray(list) ? list.slice(0, MAX_HITS) : []) {
    const seen =
      isRecord(entry) && entry.found !== false
        ? seenOf(entry, "record", undefined)
        : undefined;

    if (seen?.id !== undefined) {
      hits.push({ ...seen, id: seen.id });
    }
  }

  return hits;
}

function lengthOf(list: unknown): number | undefined {
  return Array.isArray(list) ? list.length : undefined;
}

/**
 * What `tool` returned for `input`.
 *
 * @param result the result as stored: an object, a list of text blocks, or text
 * @param joined the result's text as Claude read it, when the caller has it
 */
export function readingOf(
  tool: ReadTool,
  input: Record<string, unknown>,
  result: unknown,
  joined: string | undefined,
): Reading {
  const raw = rawOf(result, joined).slice(0, MAX_TEXT);
  const body = bodyOf(raw);
  const json =
    body === undefined ? (payloadOf(result) ?? payloadOf(raw) ?? {}) : {};
  const reading: Reading = { ...NOTHING, hits: [], ids: idsIn(raw, MAX_IDS) };
  const askedId =
    firstIdIn(input.ref) ?? firstIdIn(input.meeting_id) ?? firstIdIn(input.id);

  switch (tool) {
    case "search":
      return {
        ...reading,
        query: text(input.query, MAX_QUERY),
        hits: hitsOf(json.results),
      };
    case "open":
    case "get_meeting":
      return {
        ...reading,
        record:
          body === undefined
            ? seenOf(
                json,
                tool === "get_meeting" ? "meeting" : "record",
                askedId,
              )
            : recordOfText(body, askedId),
      };
    case "get_project":
      return body === undefined
        ? { ...reading, listed: lengthOf(json.projects) }
        : { ...reading, record: recordOfText(body, undefined) };
    case "get_timeline":
      return {
        ...reading,
        listed: body === undefined ? undefined : entriesIn(body),
      };
    case "get_commitments":
      return { ...reading, listed: lengthOf(json.commitments) };
    case "recall":
      return {
        ...reading,
        listed: lengthOf(json.facts) ?? lengthOf(json.matches),
      };
    case "resolve":
      return {
        ...reading,
        hits: hitsOf(json.records),
        listed: lengthOf(json.records),
      };
  }
}
