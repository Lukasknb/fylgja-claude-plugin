# peek

Read a Fylgja record without leaving the conversation.

- A reply that links to Fylgja records gets one dim line of chips under it, one chip per record. Hover a chip: a small card. Click a chip, or the link itself: the record opens in a pane beside the transcript.
- A message of yours that holds a pasted `{{fylgja:…}}` reference gets the same line of chips.
- `/peek <reference, link or id>` opens the same pane by hand. `/peek` alone reopens the last record.

It only draws and reads. Nothing is added to what Claude reads, no prompt or tool call is seen or delayed, and what was read stays in the plugin's memory.

## Try it

```bash
claude --plugin-dir /home/lukas/dev/private/fylgja-mod-lab/lab/peek
```

Use fullscreen mode in the terminal (hover and clicks need it), at least 110 columns wide for a docked pane. Sign in with `/mcp` if asked.

1. Type `/peek <a meeting id>`. A pane opens. Look at: "Open in Fylgja" at the top, title, date and project path, then Participants, Summary, Decisions, Key points, Commitments. Click a `▾` heading to fold it. Keys while the pane has focus: `c` copy reference, `r` refresh, `b` back, `f` forward, `x` close, Esc close.
2. Press **Copy reference**. The `{{fylgja:meeting <title>|<id>}}` reference appears in the prompt box at the cursor. Nothing is sent.
3. Type `/peek https://fylgja.lknblab.dev/open/project/<id>`. Click a `▸ child`. Press **← Back**, then **Forward →**.
4. Type `/peek <a note or session id>`. Its text is drawn as markdown. A link in it to another Fylgja record opens that record in the pane; any other link is shown as `label (address)`.
5. Ask Claude something that makes it cite records ("what did we decide about deploys? link the meetings"). Under the reply: `◉ meeting`, then a moment later `◉ <the meeting's real title>`. Hover the chip for the card (kind, date, title, project path, "2 decisions · 1 commitment"). Click the chip. Click the link in the text.
6. Paste a reference into a prompt and send it. The chip appears under your message.
7. Narrow the terminal below 110 columns and `/peek` again: the pane moves above the prompt. Where the surface places no pane at all, the same view is drawn in the band above the prompt.

To compare with Claude Code's own drawing of replies, set the option `replyLinks` to `engine` (in `/config`, or `pluginConfigs` under `fylgja-lab-peek@inline`). Then the reply is untouched and only the chips open the pane.

## What was decided, and why

**The card hangs off a chip, not off the link.** A hover needs an element of its own to start from. The reply's text is one `Markdown` element, which takes no hover, and on the terminal a `Text` nested in a `Text` "follows its group but cannot heat it". So a link inside a sentence cannot show a card without the plugin drawing every paragraph itself through a `Client` region, which takes text selection away from the terminal. One line of chips under the reply was the smallest thing that works. The cost: one extra dim line under every reply block that cites a record.

**Rewriting a reply so its links are pressable.** With `replyLinks: pressable` (the default) the reply block is drawn by this plugin as a `Markdown` element with the same text; only links to Fylgja records are listed as pressable, every other link keeps the surface's behaviour. What follows from the declarations:

- The stored message is untouched. Claude, `/copy`, a resume and the transcript file all see the reply as written.
- Selecting with the mouse copies what is drawn. The text is still plain drawn text (no `Client`), so the terminal selects it as before. A selection dragged across the chips line takes the chip labels along.
- A press is a plain single click; it "lands once no double-click followed", so there is a short wait before the pane opens. Ctrl-click, alt-click or cmd-click still open the link the old way, in the Fylgja app.
- `AssistantMessage` has no `isExpanded` prop, so the plugin cannot tell the ctrl+o view from the normal one. If the engine asks plugins to draw the ctrl+o transcript, the chips line shows there too. Not confirmed.
- The plugin's tree replaces the engine's row, so it redraws the reply's `●` mark and two-cell indent by hand on the terminal. This is a guess at the engine's look.
- A reply over 50,000 characters, a summary, and every reply on a surface without a pointer keep Claude Code's own drawing.

**Hover needs fullscreen mode in the terminal.** On the main screen rows are printed into scrollback and no pointer is reported, so there the plugin adds nothing to replies and messages, and asks Fylgja nothing. `/peek` still works there; the pane is placed above the prompt.

**When the card's data is fetched.** When a reply or message with records is first drawn, in the background, at most eight records per row, one call at a time, each record once. On today's server that is one `open` per record plus one `get_meeting` for a meeting (the counts), so the pane then opens without a further call. On the newer server one `resolve` names all of them and only meetings cost a `get_meeting`. A failed lookup is not repeated. Until an answer is in, the chip shows only the kind and there is no card.

**The Desktop app.** By the element tables everything used here exists there: `Box`, `Text`, `Button`, `Link`, `Markdown`, panes, the band. Chips become native buttons. The `●` mark is not drawn. Whether Desktop reveals a hover card, and whether `$.prompt.fill` reaches its prompt box, is unknown; if the fill is refused the pane shows the reference as text to select. `/peek` should work as in the terminal.

## Not confirmed in a live session

Check these first.

1. The hover card: an absolutely positioned `Box` with `bottom: 1`, drawn `display: none` inside a transcript row, is revealed over the rows above and not clipped by its own row. Same on Desktop.
2. How the redrawn reply looks next to engine-drawn replies (mark, indent, spacing), and whether it flickers while a reply streams.
3. `onLinkPress` on a `Markdown` inside an `AssistantMessage` row fires on a click, on the terminal and on Desktop.
4. `$.ui.open` called from a link press or a chip press counts as asked for by the person and is placed at any width.
5. A plain dim `Button` in a transcript row is clickable in the fullscreen terminal.
6. What ctrl+o shows for a reply this plugin redraws.
7. The shape `$.mcp.call` returns for the tools that answer with text (`open` on a note or session): text blocks, or a structured `{ result: "…" }`. Both are read.
8. `$.prompt.fill` with `mode: 'insert'` on Desktop.
9. `/peek` is a free command name, and a `command.run` answer of `{}` prints no line.
10. Pane focus after `/peek`, the hotkeys, and Esc closing the pane.
11. `borderStyle: 'round'` with `borderColor: 'suggestion'` is accepted for the card.
12. With the shipped `fylgja` plugin loaded too: both redraw replies and user messages. They should nest (its glyphs in the link labels, this plugin's chips under its row), and each does its own lookups.
13. When, in practice, a surface reports `isPlaced: false` so the band is used.

## Limits

- On today's server a meeting's card shows its project path only because the record is read with `open`; nothing here needs `resolve`, it only saves calls.
- A project shows one page of children. If there are more, a line says so.
- A person and other kinds get a minimal view or none. "Copy reference" gives a person's link, because the reference format has no person kind.
- Records are held for the session (40 at most) and not refreshed unless you press Refresh.

## Is it useful?

The pane is the part I would keep. Reading a meeting's decisions or a project's outline next to the conversation, then dropping its reference into the prompt, is a real loop: it replaces switching to the app and back, and it works before Claude has said anything (`/peek`). The chips are useful mostly as the reliable click target. The hover card is the weakest piece: it tells you little that the chip's verified title does not already say, it costs a background read per cited record, and it only exists in fullscreen mode. If the card stays, it should come from `resolve` alone (one cheap call) and drop the meeting counts. Redrawing the reply to make inline links pressable is the riskiest piece for the least gain: the chip one line below does the same job without touching Claude Code's own rendering, so `replyLinks: engine` may well be the better default once both have been seen side by side.
