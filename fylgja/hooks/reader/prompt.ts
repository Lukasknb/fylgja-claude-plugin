/**
 * The one message the image reader appends to the main conversation when it
 * forks it. The fork sees the conversation as Claude last sent it, the image
 * included, and answers with one JSON object; nothing it says reaches Claude.
 *
 * No effort is named on a fork (another level could cost a full cache write),
 * so haste is asked for in words instead.
 */

/** No more of the prompt's text is asked back than this, to prove the fork read the right message. */
export const ECHO_CHARS = 300

export const FORK_PROMPT = `[Background reader request, not from the developer. You have no tools: do not call any. Do not continue the developer's task. Answer straight away, without deliberating, with one JSON object and nothing else.]

Look at the most recent message in this conversation that the developer typed themselves (not tool results, not system reminders, not this request), and at the images attached to it.

Return a JSON object with exactly these keys:
- "echo": that message's text copied exactly, up to its first ${ECHO_CHARS} characters, leaving out image placeholders such as [Image #1]. "" if it has no text.
- "images_seen": how many images that same message carries, as you see them (0 if none).
- "image_visible": true only if you can actually see image content attached to that message right now; false otherwise. Never infer it from the text.
- "shows": what the images show, one of "coworker_chat" (a chat or message another person wrote), "app_ui" (a screen of the product or an app), "issue_tracker" (an issue or a ticket), "log_or_terminal" (a log, a terminal, a stack trace), "other".
- "legibility": how well you can read them: "clear", "partly" or "poor".
- "reporter_role": who reported what the images show, by role only: "colleague", "customer_via_colleague" (a colleague passing on what a customer said), "developer" (the developer's own), or "unknown".
- "quote": the words in the images that state the problem or what is wanted, copied verbatim in their original language, at most 400 characters; "" if there are none.
- "observed": in English, one or two sentences: what the images report or show going wrong, in your own words.
- "expected": in English, one sentence of at most 220 characters stating the expected behaviour of the product: a condition and an observable outcome ("When a user saves a draft offline, the draft is kept and synced once the connection returns."). Take it only from words in the images or from the developer's own words in that message; never infer or complete it, and use no status words ("fixed", "now", "should be changed"). null if neither states one.
- "expected_basis": "in_image" when "expected" comes from words in the images, "by_developer" when it comes from the developer's own words; null when "expected" is null.

Rules for every field: "observed" and "expected" are always in English, whatever language the images or the developer's words are in; only "quote" keeps its own language. No personal names (write "[name]"), no customer or company names, and no customer data values such as amounts, ids, emails or addresses (write "[value]"), in the quote too. Describe; never copy image data.`
