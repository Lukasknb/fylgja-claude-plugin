/**
 * Reading which meeting the person meant from what they typed after the
 * command: a reference copied from the Fylgja app, a link to a meeting, or a
 * bare id.
 */

import { tokensIn } from "./token";

const ID =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const LINK = new RegExp(`/open/([a-z_]+)/(${ID})(?![0-9a-fA-F-])`);
const BARE = new RegExp(`^(${ID})$`);

export type Meant = { id: string } | { problem: string };

/**
 * The meeting's id, lower-cased, or one plain line saying why none was read.
 *
 * Only the kind and the id of a reference are used. The title inside it is a
 * label somebody pasted and is never shown or trusted.
 */
export function meetingIn(typed: string): Meant {
  const text = typed.trim();
  const token = tokensIn(text)[0];

  if (token !== undefined) {
    return token.kind === "meeting"
      ? { id: token.id }
      : { problem: `That reference is a ${token.kind}, not a meeting.` };
  }

  const link = LINK.exec(text);

  if (link?.[1] !== undefined && link[2] !== undefined) {
    return link[1] === "meeting"
      ? { id: link[2].toLowerCase() }
      : { problem: "That link does not point to a meeting." };
  }

  const bare = BARE.exec(text);

  return bare?.[1] !== undefined
    ? { id: bare[1].toLowerCase() }
    : {
        problem:
          "No meeting in that: give a copied reference, a link to a meeting, or its id.",
      };
}
