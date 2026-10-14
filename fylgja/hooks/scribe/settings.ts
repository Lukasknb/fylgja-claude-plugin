/**
 * Scribe's two settings in `/config`: how often it looks inside a turn, and
 * which model it thinks with. Each is a picker over fixed words; the words
 * are what the developer sees, and what they stand for is read here.
 *
 * A change in the `/config` menu is taken at once (`config.set`); `/config`
 * is also read once a turn, for a change that came another way.
 */

/** The `userConfig` field of how often Scribe looks, as `plugin.json` names it. */
export const CADENCE_FIELD = 'scribeCadence'

/** The `userConfig` field of the model Scribe thinks with. */
export const MODEL_FIELD = 'scribeModel'

/**
 * How often Scribe looks inside a turn: after so many steps of the main
 * conversation, or never before the turn ends. The words are the picker's.
 */
export const CADENCES: Readonly<Record<string, number | null>> = {
  'Every 5 steps': 5,
  'Every 10 steps': 10,
  'Turn end only': null,
}

export const DEFAULT_CADENCE = 'Every 5 steps'

/** The smallest count of steps, of which every other is a multiple: a step at no multiple of it looks at no setting. */
export const CADENCE_STEP = 5

/** The model each word of the picker stands for, as an alias `$.model.complete` resolves. */
export const MODELS: Readonly<Record<string, string>> = {
  Haiku: 'haiku',
  Sonnet: 'sonnet',
  Opus: 'opus',
}

export const DEFAULT_MODEL = 'Sonnet'

/** How many steps a look inside a turn comes after; null for none before the turn ends. A value not on the list is the default. */
export function cadenceOf(value: unknown): number | null {
  const chosen = typeof value === 'string' && Object.hasOwn(CADENCES, value) ? CADENCES[value] : CADENCES[DEFAULT_CADENCE]

  return chosen ?? null
}

/** The model a value of the picker names; a value not on the list is the default. */
export function modelOf(value: unknown): string {
  const chosen = typeof value === 'string' && Object.hasOwn(MODELS, value) ? MODELS[value] : undefined

  return chosen ?? (MODELS[DEFAULT_MODEL] as string)
}
