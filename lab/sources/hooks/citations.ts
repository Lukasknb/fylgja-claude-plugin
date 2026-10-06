/**
 * The links to Fylgja records Claude wrote in a reply: finding them, and
 * marking the ones that were not read. Paint only: the reply as stored, and
 * as Claude reads it back, is never changed.
 */

import { UNBACKED } from "./glyphs";
import { FYLGJA_HOST, RECORD_LINK } from "./links";

/** A reply block longer than this is left as it is. */
const MAX_LENGTH = 100_000;

/** One record a reply links to. */
export type Cited = {
  kind: string;
  /** The record's id, lower-cased. */
  id: string;
  /** The words Claude put on the link; empty for a bare address. */
  label: string;
  link: string;
};

// Either a markdown link straight to a record, `[label](<address>)`, or the
// bare address. The address is the host followed at once by the path, so a
// user name, a port or a look-alike host around it does not match, and
// nothing may follow the id that would make it another address. An image is
// not a link. The label is bounded and holds no bracket, which keeps the
// search linear.
const PATTERN = new RegExp(
  `(?<!!)\\[([^\\[\\]\\n]{0,300})\\]\\((${RECORD_LINK})\\)` +
    `|(?<![\\w/(<\\[@.:-])(${RECORD_LINK})(?![\\w/?#=&%@:-]|\\.[\\w/.]|\\))`,
  "g",
);

const HAS_LINK = `https://${FYLGJA_HOST}/open/`;

type Found = Cited & { start: number; end: number };

function linksIn(markdown: string): Found[] {
  if (markdown.length > MAX_LENGTH || !markdown.includes(HAS_LINK)) {
    return [];
  }

  const found: Found[] = [];

  for (const match of markdown.matchAll(PATTERN)) {
    // Groups 1-4 are the markdown form (label, address, kind, id), 5-7 the bare one.
    const link = match[2] ?? match[5];
    const kind = match[3] ?? match[6];
    const id = match[4] ?? match[7];

    if (link !== undefined && kind !== undefined && id !== undefined) {
      found.push({
        kind,
        id: id.toLowerCase(),
        label: match[1] ?? "",
        link,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  return found;
}

/** Every record `markdown` links to, each once, in the order first written. */
export function citedIn(markdown: string): Cited[] {
  const cited = new Map<string, Cited>();

  for (const { kind, id, label, link } of linksIn(markdown)) {
    const held = cited.get(id);

    // A later link with words on it names the record better than a bare address.
    if (held === undefined || (held.label === "" && label !== "")) {
      cited.set(id, { kind, id, label, link });
    }
  }

  return [...cited.values()];
}

/**
 * A reply's markdown with a small mark after every link to a record that
 * `isReturned` does not know, or undefined when nothing is to be marked.
 *
 * The link itself is left exactly as written, so it opens where it always
 * did, and a link already followed by the mark is not marked twice.
 */
export function withMarks(
  markdown: string,
  isReturned: (id: string) => boolean,
): string | undefined {
  const mark = ` ${UNBACKED}`;
  let marked = "";
  let at = 0;

  for (const link of linksIn(markdown)) {
    if (isReturned(link.id) || markdown.startsWith(mark, link.end)) {
      continue;
    }

    marked += markdown.slice(at, link.end) + mark;
    at = link.end;
  }

  return at === 0 ? undefined : marked + markdown.slice(at);
}
