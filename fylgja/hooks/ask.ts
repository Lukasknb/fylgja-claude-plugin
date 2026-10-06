import type { Host } from './host'
import { payloadOf } from './payload'

/**
 * One Fylgja tool's answer as a JSON object, or undefined for every way it
 * can fail: a call that rejects, a result the tool marks as an error, or
 * text that is not the JSON object expected.
 */
export function ask(
  host: Host,
  server: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  return host.call(server, tool, args).then(payloadOf, () => undefined)
}
