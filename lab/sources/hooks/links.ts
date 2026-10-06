/**
 * The address of a Fylgja record, and the id every record goes by.
 */

/**
 * The host Fylgja's records are opened on. It is the host of the server in
 * this plugin's `.mcp.json` and has to change with it: an address counts as
 * a Fylgja record only when it goes exactly there.
 */
export const FYLGJA_HOST = "fylgja.lknblab.dev";

export const UUID =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/** `https://<host>/open/<kind>/<uuid>`, the kind and the id captured. */
export const RECORD_LINK = `https://${FYLGJA_HOST.replace(/\./g, "\\.")}/open/([a-z_]{1,40})/(${UUID})`;

const WHOLE_LINK = new RegExp(`^${RECORD_LINK}$`);
const WHOLE_ID = new RegExp(`^${UUID}$`);
const ANY_ID = new RegExp(UUID, "g");

/** `value` as a record id, lower-cased, or undefined when it is not one. */
export function idOf(value: unknown): string | undefined {
  return typeof value === "string" && WHOLE_ID.test(value)
    ? value.toLowerCase()
    : undefined;
}

/** The first record id written anywhere in `value`: a bare id, or one inside a pasted reference. */
export function firstIdIn(value: unknown): string | undefined {
  return typeof value === "string"
    ? value.match(ANY_ID)?.[0]?.toLowerCase()
    : undefined;
}

/**
 * Every distinct record id written in `text`, lower-cased, in the order
 * written, up to `max`.
 */
export function idsIn(text: string, max: number): string[] {
  const found = new Set<string>();

  for (const match of text.matchAll(ANY_ID)) {
    if (found.size >= max) {
      break;
    }

    found.add(match[0].toLowerCase());
  }

  return [...found];
}

/**
 * `value` as the address of the record `id`, or undefined. Only an address
 * on Fylgja's own host that names that very record is kept, so nothing a
 * record holds can make a row open another place.
 */
export function linkOf(
  value: unknown,
  id: string | undefined,
): string | undefined {
  if (typeof value !== "string" || id === undefined) {
    return undefined;
  }

  const match = WHOLE_LINK.exec(value);

  return match?.[2]?.toLowerCase() === id ? value : undefined;
}
