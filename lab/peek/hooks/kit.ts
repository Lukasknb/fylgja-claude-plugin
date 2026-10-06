import type { BoxProps, ButtonProps, ElementConstructor, LinkProps, MarkdownProps, TextProps } from 'claude-code'

/**
 * The elements this plugin draws with. Every surface that draws at all has
 * these five, so one drawing serves the terminal and the desktop app.
 */
export type Kit = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Link: ElementConstructor<LinkProps>
  Markdown: ElementConstructor<MarkdownProps>
}

/** How many cells `text` takes, near enough: one per character. */
export function widthOf(text: string): number {
  return Array.from(text).length
}

/** `text` in at most `max` cells, its end replaced by an ellipsis when cut. */
export function clip(text: string, max: number): string {
  const chars = Array.from(text)

  return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join('')}…`
}
