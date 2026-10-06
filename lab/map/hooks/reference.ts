import type { Place } from './shape'

/**
 * The reference to a project as the Fylgja app copies it for Claude:
 * `{{fylgja:project <name>|<uuid>}}`. The name is a label for the person;
 * the id is what names the project.
 */
export function referenceOf(name: string, id: string): string {
  const label = name
    .replace(/[{}|\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)

  return `{{fylgja:project${label === '' ? '' : ` ${label}`}|${id}}}`
}

/**
 * The start of a question about one place, for the person to finish:
 * `in <top> / <area> / <project>: `. It is only text in the prompt box.
 */
export function scopeOf(place: Pick<Place, 'path' | 'name'>): string {
  const names = place.path.length > 0 ? place.path : [place.name]

  return `in ${names.join(' / ')}: `
}
