# aside

A side question to Fylgja that never touches the main conversation.

While Claude is in the middle of a long task you type `/aside who owns the billing migration?`. A pane opens and answers there. No turn starts, nothing is printed into the transcript, nothing is added to what Claude reads, and Claude's work is not interrupted.

## This experiment calls a model. Read this first.

The other experiments in this lab never call `$.model.*`. This one does, on purpose, so its value can be judged.

- Each question makes one `$.model.complete` call: alias `haiku`, effort `low`, at most 400 output tokens, stopped after 20 seconds.
- That call spends **your own Claude plan or API usage**, like any other request your session makes.
- It **sends the text of the records the mod read** (up to 9,000 characters; 16,000 after "Widen") **to the model provider**, exactly as an ordinary Claude turn that reads those records with Fylgja's tools would.
- Nothing else leaves the machine. Nothing is written to disk, to `$.store` or to a log. Questions, answers and record text live in the mod's memory and are gone when the session ends or the plugin reloads.

## Try it

```bash
claude --plugin-dir /home/lukas/dev/private/fylgja-mod-lab/lab/aside
```

Sign in to Fylgja with `/mcp` if asked. Then:

1. Give Claude something long to do. While it works, type `/aside what did we decide about retries?` and press Enter.
2. Watch the pane. It says `Searching Fylgja (one search)…`, then `Reading 4 records…`, then `Read 4 records. Asking the small model…`, then the answer.
3. Under the answer is the list of sources. Each row has the record's glyph, title and date, `Open in Fylgja` when the server gave a link, and `Put reference in prompt`.
4. Type a follow-up in the field at the bottom (focus the pane with a click or Ctrl+X Tab). Press `New thread` first if the next question has nothing to do with this one.
5. Press `Hand to Claude`. A one-line pointer with the record references lands in the prompt box. It is not sent. Send it or delete it.
6. Use `‹ older` and `newer ›` to walk this session's asides (the last 20).
7. Press `Widen (one more search)` when the answer missed. This is the only way a question is ever searched twice.

## What to look at

- **The main conversation.** Scroll the transcript after an aside: there is no row for the command. Ask Claude afterwards "what did I just ask Fylgja?" — it should not know.
- **The answer and its numbers.** Every sentence shown ends in `[n]`, and `n` is a row in the sources list below. A sentence the model wrote without a number, or with a number that is not a record the mod read, is taken out, and the pane says how many were (`2 sentences without a source left out.`). If nothing survives, the pane says `Nothing found in what I read.` and still lists what it read.
- **The sources list.** It is built from the search and the reads, never from the model's text. Rows marked `not cited` were read but not used. `search excerpt only` means the read failed and the model saw only the search's 280-character preview. `cut` means the record was longer than the read cap.
- **The honest lines.** Signed out, not connected, no match, rate limited (with the seconds to wait), the model timed out or was rate limited (the hits are shown anyway), an unexpected answer from the server.

## How it keeps the answer honest

- The search and the reads are done by the mod, not by the model: one `search` (limit 8), then the top 4 hits with `get_meeting` (summary, decisions, key points) for meetings and `open` for everything else. At most 3,000 characters per record.
- The records go to the model inside `<record>` tags that a record's own text cannot close, with a system prompt that names them as data, not instructions. Invisible characters are removed first.
- The model may only cite by number. The mod maps numbers back to the records it read and drops everything else.
- The answer is drawn as Markdown after links, addresses, curly braces and the record glyphs are removed, so it cannot contain a link, a `{{fylgja:…}}` reference or something that looks like a source row.
- `Hand to Claude` and `Put reference in prompt` put in references to the records, not the answer. If Claude needs the content it reads the records itself.

What this does **not** prove: that a cited sentence is true to its record. The model can still misread a record, or be talked by a record's text into a wrong sentence and put that record's own number on it. The number tells you where to check; it is not a check.

## A follow-up carries

The previous question, the previous answer as shown, and the ids of the (at most two) records that answer cited. Those records are taken from the session's memory and not read again. The search for a follow-up is one search for "previous question + follow-up", because a follow-up like "who owns it?" finds nothing alone.

## Not confirmed in a live session

Everything below passes against stubs. None of it has been seen running.

1. **`immediate: true` really runs `/aside` mid-turn**, and a `command.run` hook that returns `{}` (no `text`, no `context`) leaves no transcript row and no "no hook answered" line. This is the whole point of the experiment; check it first.
2. **Work that continues after the command hook returned.** The search, reads and model call run after `command.run` has answered, still using that hook's `$`. The shipped mod does the same from a render hook, but not from an immediate command during a turn.
3. **`$.model.complete` while the main turn is streaming**: that it runs concurrently, that `haiku` is allowed under the person's settings, and what it costs on a subscription.
4. **`$.ui.open` from an immediate command** places the pane at any width (the types say a command the person typed counts as "asked"), and the pane redraws on `$.ui.invalidate('ui.render')` as each step ends.
5. **The `Input` in a pane while Claude is working**: that it can be focused and typed into mid-turn, that `value` set to `''` after a submit clears the field, and that redraws between keystrokes do not eat typing.
6. **`$.prompt.fill` in `insert` mode from a pane button mid-turn**, with a draft already in the box. And whether the shipped Fylgja mod then draws the inserted reference as a chip.
7. **The band fallback**: when `$.ui.open` answers `isPlaced: false`, the same drawing goes to the band above the prompt with a `close` button. Untested how tall that is in a real terminal.
8. **`Markdown` in a pane** on the terminal and the desktop, and that it draws `[1]` as plain text.
9. **The live server's shapes**: that `search` answers a rate limit as an error result whose text says `Wait N seconds`, what `$.mcp.call` does when sign-in lapsed, and the `link` field of the newer server.
10. **`Link` to `https://fylgja.lknblab.dev/open/…`** opening the desktop app from the terminal and from the Desktop app.

## Where it could be useful, and where probably not

Useful, I think, for the small factual question that comes up while something else is running: who owns a thing, what was decided, when did we talk about it. It costs one search and a fraction of a cent, it does not derail a long turn, and the answer comes with the two or three records to open. The sources list alone is worth something even when the model says nothing. It is probably not useful for anything that needs judgement or more than a few records: the small model sees at most four short reads, cannot ask for more, and the strict "every sentence must cite" rule throws away connecting sentences, so answers read clipped. It is also a second way to ask the same thing Claude can already ask with Fylgja's tools; if most asides end in "Hand to Claude", the pane is only a detour and a plain search pane without a model would do the same job with no model call and no trust question at all.

## Layout

```
hooks/register.ts    the four hooks and every engine call
hooks/flow.ts        one question: search, read, ask the model
hooks/retrieve.ts    the search and the bounded reads
hooks/answer.ts      the prompt, and what is kept of the reply
hooks/asides.ts      this session's asides, in memory
hooks/pane.ts        the drawing
hooks/reference.ts   what goes into the prompt box
hooks/plain.ts, glyphs.ts, token.ts, payload.ts   copied from ../../fylgja/hooks (plain.ts gained `lines`, `flat`, `prose`)
```
