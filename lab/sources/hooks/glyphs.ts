/**
 * One glyph per kind of Fylgja record, the same wherever a record is drawn,
 * and the two marks a citation is judged with.
 */
const BY_KIND: Readonly<Record<string, string>> = {
  meeting: "◉",
  session: "⌁",
  note: "✎",
  project: "▤",
  person: "◐",
  topic: "◇",
  decision: "◆",
  document: "▭",
};

/** The glyph for a kind of record this build has no glyph of its own for. */
const OTHER = "□";

/** Stands by a cited record that a Fylgja tool returned in this session. */
export const BACKED = "✓";

/** Stands by a cited record that no Fylgja tool returned in this session. */
export const UNBACKED = "◌";

/** Every glyph a record is drawn with. */
export const GLYPHS: readonly string[] = [...Object.values(BY_KIND), OTHER];

/** The glyph for `kind`; one neutral glyph for every kind this build does not know. */
export function glyphOf(kind: string): string {
  return Object.hasOwn(BY_KIND, kind) ? (BY_KIND[kind] ?? OTHER) : OTHER;
}
