import type { ReadTool } from "./tools";

/**
 * How one of Claude's Fylgja reads ended. Only `read` means Claude was given
 * something: a call that failed, or that the person or a rule did not allow,
 * gave it nothing.
 */
export type Status = "read" | "failed" | "denied";

/**
 * A record as much as a row shows of it. The title is the record's own text,
 * held as the server sent it and made safe only where it is drawn.
 */
export type Seen = {
  /** The record's id, lower-cased; undefined when the result named none. */
  id: string | undefined;
  kind: string;
  title: string;
  /** `YYYY-MM-DD`. */
  date: string | undefined;
  /** Where the record lives in the project tree, top first. */
  project: string | undefined;
  /** The address that opens the record in Fylgja, when the server sent one. */
  link: string | undefined;
};

/** A record with an id: a search hit, or anything a reference can be made for. */
export type Hit = Seen & { id: string };

/** One Fylgja read Claude made, and what came back. */
export type Call = {
  /** The id of the tool call: the same in the transcript and at the hook. */
  useId: string;
  tool: ReadTool;
  status: Status;
  /** The subagent that made the call; undefined for Claude's own. */
  agentId: string | undefined;
  /** What a search asked for. */
  query: string | undefined;
  /** The one record the call opened, when it opened one. */
  record: Seen | undefined;
  /** What a search found, in the order returned. */
  hits: Hit[];
  /** How many entries a list held (a timeline, commitments, recalled notes). */
  listed: number | undefined;
  /** Every record id the result named, lower-cased. */
  ids: string[];
};

/** What a result held, before it is tied to the call that fetched it. */
export type Reading = Pick<
  Call,
  "query" | "record" | "hits" | "listed" | "ids"
>;

export const NOTHING: Reading = {
  query: undefined,
  record: undefined,
  hits: [],
  listed: undefined,
  ids: [],
};
