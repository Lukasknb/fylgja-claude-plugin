/**
 * Reading what a Fylgja tool answered, whichever shape it arrives in: the
 * result of a direct call, or the record a transcript row stores.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsed(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)

    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function joined(blocks: readonly unknown[]): string {
  return blocks
    .map(block => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('')
}

/**
 * The JSON object a tool answered with, or undefined when it reported an
 * error or answered with anything else.
 *
 * The structured result is preferred when present; otherwise the text blocks
 * are joined and parsed. A bare JSON string, a bare list of blocks and an
 * object that is already the answer are read the same way.
 */
export function payloadOf(result: unknown): Record<string, unknown> | undefined {
  if (typeof result === 'string') {
    return parsed(result)
  }

  if (Array.isArray(result)) {
    return parsed(joined(result))
  }

  if (!isRecord(result) || result.isError === true) {
    return undefined
  }

  if (isRecord(result.structuredContent)) {
    return result.structuredContent
  }

  return Array.isArray(result.content) ? parsed(joined(result.content)) : result
}

/**
 * The text a tool answered with when its answer is prose, without the two
 * fence lines the server wraps a record in; undefined when it reported an
 * error or answered with no text.
 */
export function textOf(result: unknown): string | undefined {
  if (!isRecord(result) || result.isError === true || !Array.isArray(result.content)) {
    return undefined
  }

  const text = joined(result.content)
    .split('\n')
    .filter(line => !line.startsWith('<<<fylgja-record') && !line.startsWith('<<<end fylgja-record'))
    .join('\n')

  return text.trim() === '' ? undefined : text
}
