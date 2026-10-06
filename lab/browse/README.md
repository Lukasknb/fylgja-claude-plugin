# browse: Fylgja as a pane beside the conversation

`/fylgja` opens a pane with a search field, five tabs and a list of records. A row expands in place. From there you can drop a reference to the record into the prompt box.

It only reads from Fylgja, and only after you typed the command or worked a control. Nothing is added to what Claude reads. No turn is started. The reference lands in the prompt box and stays there until you send or delete it.

## Try it

```bash
claude --plugin-dir /home/lukas/dev/private/fylgja-mod-lab/lab/browse
```

Sign in with `/mcp` if the pane says so. Then:

1. Type `/fylgja` and press Enter. It also works while Claude is busy. Nothing is printed in the transcript.
2. The pane opens on **Recent**: the meetings and sessions of the last two weeks.
3. Type in the search field. The search goes out 450 ms after you stop typing, from two characters on. Enter sends it at once.
4. `/fylgja pricing` opens the pane and searches for "pricing" straight away.

## Keys

The pane takes the keyboard when it opens. The search field has the focus first.

| Key | What it does |
|-|-|
| Tab | Next control: field, tabs, rows, the keys at the bottom |
| Up / Down | Previous / next control. On the first or last row shown, the list moves by one |
| Enter | In the field: search now. On a row: expand or collapse it. On a child project: step into it |
| PageUp / PageDown, wheel | Move the list |
| Esc | Back to the prompt box. The pane stays open |
| Ctrl+X Tab | Focus the pane again |
| Ctrl+X X | Close the pane |

While the field has the focus, every letter and digit goes into the field. Press Tab or Down once to leave it. Then these work:

| Key | What it does |
|-|-|
| `1` `2` `3` `4` `5` | Recent, Meetings, Sessions, Notes, Projects |
| `s` | Back to the search field |
| `e` | Expand the row the focus was last on, or collapse the expanded row |
| `i` | Put the expanded record's reference into the prompt box |
| `o` | Copy the expanded record's app link |
| `p` / `n` | Previous / next page of the list |
| `b` | Back out of a project you stepped into |
| `x` | Close the compact version above the prompt (only shown there) |

## What to look at

- **First glance.** A row is a glyph, the title, the date dimmed, and where the record is filed when that fits. Nothing else until you expand it.
- **Expanding.** A meeting shows the first lines of its summary and how many decisions and commitments it has. A session or note shows its first lines. A project shows its definition and the projects under it; press one to step in, `b` to step back.
- **Speed.** While a search is on its way the old rows stay, dimmed, under `searching…`. A keystroke never empties the list. A tab you already visited answers from memory without another call.
- **Honesty.** One line under the tabs says how things stand: `sign in with /mcp`, `rate limited: wait 12 s`, `nothing found`, `the first 20 records: the server cut the list`, `Fylgja did not answer this`.
- **The reference.** `i` inserts `{{fylgja:meeting Pricing sync|<uuid>}}` at the cursor. It never submits.
- **The app link.** Today's server sends no link, so the row says `no app link from this server`. The newer server sends one; then `open in Fylgja` is a link and `o` copies it. A link is never built here.
- **State.** Close the pane with Ctrl+X X and type `/fylgja` again: the query, the tab and the expanded row are back.
- **Narrow terminals.** Below 110 columns Claude Code puts the pane above the prompt by itself. Where it places no pane at all, the same view is drawn compactly in the band above the prompt.

## What it does not do

- **Notes cannot be filtered on the server.** `search` has no `kind` for notes. The Notes tab sends an unfiltered search and keeps the hits whose type is `note` or `document`. With nothing typed it lists nothing and says so.
- **Meetings and Sessions with nothing typed** show the two weeks from the Recent list, not everything.
- **A link cannot be opened from the keyboard.** A hotkey can only press a button, and a button cannot open an address without starting a program, which this plugin does not do. `o` copies the link instead.
- **A superseded search cannot be recalled.** `$.mcp.call` takes no abort signal. A query that already left is paid for; its answer is kept for later and not shown.
- **A project list is one page.** `get_project` returns up to 200 names. An outline's further pages are not fetched; the row says there are more.
- Topics, people and atoms show up in a search and can be expanded, but have no reference form, so `i` is not offered for them.

## Not confirmed in a live session

Everything below passes against stubs. None of it has been seen running.

1. `immediate: true` really runs `/fylgja` mid-turn, and an answer of `{}` prints no row at all.
2. `$.ui.open({ focus: true })` gives the pane the keys right after the command, and `autoFocus` lands on the field.
3. The `Input` is one body row tall. The layout reserves one spare row; if the field is taller than two rows the tree overflows and the arrows scroll instead of moving the focus.
4. Up / Down move the focus ring across plain `Button` rows, and the ring stays on the same row when the list moves under it. This is the whole "arrows walk the list" behaviour: the `ui.focus` hook moves the window by one when the ring reaches the edge.
5. `ui.focus` reports the row's `key` in `e.element` for moves the person makes with the arrows.
6. Answering `ui.scroll` with `{}` keeps the engine's window still while the wheel and page keys move this plugin's window (copied from the built-in diff mod).
7. A plain `Button` with a hotkey draws as `1: Recent`. The tab row's width is computed from that.
8. `$.ui.focus({ requestId, key: 'q' })` moves the ring back to the field (`s`).
9. `$.prompt.fill` in `insert` mode works while a pane has the focus, and in the Desktop app at all.
10. `$.ui.copy` works from a pane; on Desktop it is documented as having no path yet, so `o` will say the link could not be copied.
11. A `Link` inside a `Text` is clickable in the docked pane.
12. `isPlaced: false` is what an older Desktop answers, and the `AbovePrompt` band then shows the compact version. The band replaces whatever else would be drawn there while it is up.
13. The live `get_timeline` text matches the line shapes parsed here. Lines that do not match are skipped, so a reworded server gives a shorter list, not an error.
14. Whether `$.mcp.call` rejects or answers `isError` when signed out. Both are handled.
15. Another experiment registering `/fylgja` at the same time replaces this command, or is replaced by it.

## Where it could be useful

When you are mid-conversation and want to point Claude at one specific meeting or session, this is quicker than describing it: open the pane, type three letters, `i`, and the exact record is in your prompt. It also works as a glance at "what happened lately" without spending a turn. It is probably not useful as a reader: the detail is three lines by design, and anything longer belongs in the Fylgja app. The Notes tab is weak until the server can filter notes, and the project tab is a flat list at the top level because `get_project` gives no tree. If the arrow-key behaviour in point 4 does not hold, the pane is still usable with Tab, the page keys and the mouse, but it will feel clumsy and the list should then move into a `Client` region that reads the arrows itself.
