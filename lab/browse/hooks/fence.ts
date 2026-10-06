/**
 * A text read from Fylgja arrives between two marker lines; the first says
 * who wrote the record, who may read it and, on a newer server, the link
 * that opens it. This takes the markers off.
 */

const OPEN = "<<<fylgja-record";
const CLOSE = "<<<end fylgja-record>>>";

// The link sits after the scope, which the server writes itself, so a
// record's author or text cannot put another in its place.
const LINK = /scope="[^"]*" link="([^"\s]+)" — /;

export type Unfenced = {
  /** The record's own text, without the marker lines. */
  body: string;
  /** The link the first marker line carries, as written; not yet checked. */
  link: string | undefined;
};

export function unfence(text: string): Unfenced {
  const lines = text.trim().split("\n");
  const head = lines[0] ?? "";

  if (!head.startsWith(OPEN)) {
    return { body: text, link: undefined };
  }

  const last = lines.at(-1)?.trim() === CLOSE ? lines.length - 1 : lines.length;

  return { body: lines.slice(1, last).join("\n"), link: LINK.exec(head)?.[1] };
}
