import type { PromptOrigin } from 'claude-code'

/**
 * Whether a prompt is a person's own words: typed at the prompt, or sent from
 * their phone or browser to the session they left running.
 *
 * Nothing else makes this plugin look anything up or draw a chip. A prompt
 * handed over by a program (`claude -p`, the Agent SDK) is not counted:
 * whoever starts such a run need not be a person, and this plugin's lookups
 * ask no permission. Notices from background tasks, other sessions'
 * messages, scheduled prompts and other plugins' prompts are left alone for
 * the same reason. Claude reads a pasted reference the same everywhere, and
 * opens it with Fylgja's tools, which take a whole pasted reference.
 */
export function isOwnPrompt(origin: PromptOrigin): boolean {
  return origin.kind === 'composer' || origin.kind === 'bridge'
}
