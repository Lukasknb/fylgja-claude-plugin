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

function textOf(blocks: readonly unknown[]): string {
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
    return parsed(textOf(result))
  }

  if (!isRecord(result) || result.isError === true) {
    return undefined
  }

  if (isRecord(result.structuredContent)) {
    return result.structuredContent
  }

  return Array.isArray(result.content) ? parsed(textOf(result.content)) : result
}
