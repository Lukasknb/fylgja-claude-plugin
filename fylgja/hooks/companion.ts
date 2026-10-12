import { drawn } from './plain'

/**
 * The companion mark: one short line under the prompt that says Fylgja is
 * here, and that it is working for the account this machine is set up for.
 *
 * It only shows. Nothing is asked of Fylgja or of a model for it, nothing is
 * read or written, it takes no key and runs no timer: it is worked out from
 * what the plugin already holds, when something the plugin already handles
 * happens.
 */

/** What Scribe is at, as far as the mark says it. */
export type Doing = {
  /** Whether a look at the turn that just ended is under way. */
  isReading: boolean
  /** How many records Scribe wrote in this session that still stand. */
  kept: number
}

/** Fehu, U+16A0: the mark's one glyph. */
export const RUNE = 'ᚠ'

/** The mark is never longer than this. */
const MAX_MARK = 40

/**
 * The mark as it is shown: `ᚠ fylgja` at rest, `ᚠ· fylgja is reading`
 * while Scribe reads, `ᚠ fylgja · 2 kept` once records of the session stand.
 *
 * Its words and its count pass the sanitiser every drawn text passes. The
 * rune and the dots are the plugin's own marks and are put around them
 * after, as a chip's are: the sanitiser leaves no text a middle dot.
 *
 * @param doing what Scribe is at; undefined while Scribe does not run
 */
export function markOf(doing: Doing | undefined): string {
  if (doing?.isReading === true) {
    return `${RUNE}· ${drawn('fylgja is reading', MAX_MARK)}`
  }

  const name = `${RUNE} ${drawn('fylgja', MAX_MARK)}`

  return doing === undefined || doing.kept <= 0 ? name : `${name} · ${drawn(`${doing.kept} kept`, MAX_MARK)}`
}
