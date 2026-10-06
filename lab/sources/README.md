# sources — "what did Claude base that on?"

Claude researches Fylgja with tools, and those tool calls stay Claude Code's ordinary folded rows. So after an answer you cannot see at a glance which records it rests on, or whether a record it cites was read at all. This experiment keeps a quiet ledger of Claude's Fylgja reads and shows it when you ask.

It only watches and draws. Every read goes to Fylgja exactly as Claude made it, and the result goes back to Claude exactly as it came. Nothing is added to what Claude reads. The plugin itself calls no Fylgja tool.

## Try it

```bash
claude --plugin-dir /home/lukas/dev/private/fylgja-mod-lab/lab/sources
```

Sign in with `/mcp` if asked. Then:

1. Ask something Claude must look up, for example "What did we decide about pricing, and where?" Let it answer.
2. Type `/sources`. A pane opens for the last answer.
3. Type `/sources all` for every answer of the conversation, newest first. Each is one line of counts. Press a line to unfold it.
4. In the pane, press "Put reference in prompt" on a row. The reference lands at the cursor of the prompt box. Nothing is sent.
5. Ask Claude to "cite the meeting about X with a link" for a record it has not opened, or paste a made-up link `https://fylgja.lknblab.dev/open/meeting/<any uuid>` and ask it to repeat the link. The link in the reply gets a small `◌` after it.

## What to look at

- **The rows.** One per record Claude opened, in the order read: glyph, title, date, then how it was reached. "found by a search (12 hits)", "listed in the timeline", "linked from another record", "opened directly". Is "how it was reached" right, and is it interesting?
- **The dim lines.** Searches with hits Claude did not open, searches that found nothing, lists it read (timeline, commitments), reads that failed or were not allowed.
- **"Cited in the answer".** Each Fylgja link in the reply, with `✓` and "read in this session", "read by a subagent in this session" or "returned by a search or a list, not opened"; or `◌` and "not read in this session".
- **The `◌` in replies.** Is it noticed? Is it understood without explanation? Does it ever appear on a record Claude did read?
- **"Open in Fylgja".** Only shown when the server sent a `link` for the record. Today's server sends none, so the rows show no link until the newer server is deployed.

## Settings

Both are in `/config` under this plugin.

- `markUnreadCitations` (default on): the `◌` after an unbacked link in a reply.
- `turnSummary` (default off): one line under an answer that used Fylgja, such as "3 records read · /sources". Counts only, never a title.

## The one thing it draws without being asked

The `◌` in replies bends the rule "quiet until asked". Nobody typed a command for it. It is there on purpose, to be judged: a citation that looks like every other citation is the one case where a person would not think to ask. The mark is one character after the link. The link itself is untouched and still opens. It is paint on the row only: the stored reply, and what Claude reads back, do not change. It is never drawn while the plugin cannot see the whole conversation. Switch it off with `markUnreadCitations`.

"Not read in this session" is a fact about this session, not an accusation. Claude may hold the record from earlier context, a pasted reference, or its memory files.

## Two ways to know what was read, and why both are kept

**Watching the call** (`tool.call` hook on Fylgja's eight read tools). It sees each read the moment it completes. It can tell a refusal from an error. It sees subagents' reads (`e.agentId`). It knows exactly where an answer ends (`turn.complete`). It needs no engine call when a reply is drawn. But it knows nothing from before the plugin loaded, and its memory is gone after a reload of the plugin.

**Reading the transcript** (`$.session.messages()`). It covers what happened before the plugin loaded, after a resume, and after a hot reload. But it cannot tell a refused call from a failed one, it holds no subagent reads, it must be awaited, and it splits "answers" at every user-role row, which may not always be a real prompt.

Neither is enough alone, so the roles are split:

- Answers **before** the plugin watched come from the transcript, read once at start, resume, clear or reload.
- Answers **since** come from the hook. They are never rebuilt from the transcript, because the hook's answer boundaries are exact.
- **Which records count as read** is the union of both, always. `/sources` reads the transcript again each time, so a read the hook missed still backs a citation.

If I had to keep one, I would keep the hook plus the one-time transcript read. The hook is the only source that is right about refusals and subagents, and the transcript is the only source that survives a reload.

## Decisions

- **A failed or refused read is not a read.** Its result text is not looked at, its ids back nothing, and it is shown as "1 read failed" or "1 read not allowed".
- **Subagent reads are kept apart.** Claude did not read those records; it read the subagent's report. They are shown under "Read by a subagent, not by Claude itself", tied to the answer that was under way when the subagent first read. They are not counted in the `turnSummary` line. They do back a citation, with their own wording.
- **Backing is by record id, session wide.** A record is backed if any successful Fylgja read in this conversation returned its id anywhere, even as a search hit or a line in a timeline.
- **When the conversation cannot be seen whole, nothing is called unread.** That is the case when the transcript is longer than the engine hands back (4096 rows), or begins with the summary of a compacted conversation. The pane says so and the `◌` in replies is not drawn.
- **Cleared, resumed, forked:** everything is dropped, titles included, and the new conversation is read afresh.
- **Search queries are kept** (in memory only) and shown in the dim line, because "searched “pricing” — 12 hits, 9 not opened" is far more useful than a bare count.
- **The pane follows new answers** while it is open. It was asked for; it does not open by itself.

## Not confirmed in a live session

The owner should check these first.

1. **The shape of a Fylgja tool's `result` at `tool.call`** and of `toolUses[].result` in `$.session.messages()`. The reader accepts an object, text blocks, `structuredContent`, `{ result: "<text>" }` and plain text, and prefers the `text` field ("the result as the model read it"). If rows are missing, this is the first suspect.
2. **Tool names.** The hook matches `mcp__plugin_fylgja_fylgja__*`, `mcp__fylgja__*` and `mcp__plugin_fylgja-lab-sources_fylgja__*` (this plugin's own `.mcp.json` entry, when no other Fylgja server is configured). The third name is a guess from how other plugin servers are named.
3. **`e.agentId` on a subagent's `tool.call`**, and that a subagent's `turn.complete` carries it. Stated in the declarations; the test engine passes it through; not seen live.
4. **`turn.complete` returning `{ text }`** shows the line under the answer and does not reach Claude or the transcript (the declarations say "the transcript's record is never rewritten").
5. **An `AssistantMessage` text rewrite redraws old replies** after `$.ui.invalidate('ui.render')`, including replies already printed to scrollback outside fullscreen. If not, `◌` only appears on replies drawn after the transcript was read.
6. **`classic.SessionStart` for resume and fork fires after the transcript was swapped.** If it fires before, the first read sees the old conversation; typing `/sources` reads it again and corrects the pane.
7. **`$.session.messages()` rows:** that a user-role row without tool results is a prompt (not a hidden attachment mid-turn), and that a `/sources` command row looks like one. Only affects how answers from before the plugin loaded are grouped.
8. **The compaction summary's opening words** ("This session is being continued from a previous conversation"). This is the only way the plugin notices a compaction that happened before it loaded. If the wording differs, a record read before the compaction is wrongly shown as "not read in this session".
9. **`$.state` as a redraw tick.** The pane reads one number while drawing and a write to it redraws the pane alone. The number is a counter, never customer data.
10. **`$.prompt.fill` with `mode: 'insert'` on the Desktop app.** If the app draws its own composer, the pane says "The prompt box could not take the reference just now."
11. **`Link` in a pane** opening `https://fylgja.lknblab.dev/open/...` on click, in the terminal and on Desktop.
12. **A registered command's `{}` answer** prints nothing in the transcript.

## What was given up

- No title, query or id is ever written anywhere but the screen: not to `$.store`, not to `$.state`, not to the log, not into the command's output (a command's output may be read by Claude).
- A record opened by name with no id in the result (a project's status) gets a row but no reference and no link.
- A live answer's citations are read from its final message only. A link Claude wrote between two tool calls and did not repeat at the end is not listed in the pane. It is still marked in the reply.
- Subagent reads from before a reload or resume are not shown; they are not in the main transcript.
- A row cannot offer "Open in Fylgja" unless the server sent the link. The plugin does not build addresses itself.

## Where this is useful, and where probably not

I think the citation check is the valuable half. An answer that says "as decided in [the pricing sync](…)" reads exactly the same whether Claude opened that meeting or pattern-matched a title from a search hit, and "returned by a search, not opened" versus "read" is a distinction a careful person wants before forwarding the answer. The `◌` in the reply puts that in front of them at the one moment it matters, and it costs one character. The ledger pane is useful mainly as the explanation behind a `◌`, and for the occasional "did it look at all?" after an answer that feels thin; "searched … — nothing found" next to a confident answer is a strong signal. It is probably not useful as a thing to open after every answer: the folded tool rows already tell most of the story, "how it was reached" is mildly interesting at best, and the opt-in summary line is noise for anyone who does not distrust the answer. The mark also has a real weakness: it can only say "not read in this session", and a person may read it as "made up" when Claude is in fact citing something from a pasted reference or an earlier, compacted part of the conversation. If that happens more than rarely in real use, the mark should go and the pane should stay.
