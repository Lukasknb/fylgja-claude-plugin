# map

The Fylgja project tree as a place you move through, inside Claude Code. It asks one question: is "where does this live, and what is known there right now?" worth having one command away?

## Try it

```bash
claude --plugin-dir /home/lukas/dev/private/fylgja-mod-lab/lab/map
```

Sign in to Fylgja with `/mcp` if the pane says so. Then type `/map`, or `/map <project name>`, or `/map` followed by a pasted `{{fylgja:project …}}` reference.

Click once inside the list. Then:

| Key | What it does |
|-|-|
| Up / Down, PageUp / PageDown, Home / End | move within the level |
| Right / Left | one level down / up |
| letters | jump to the row whose name starts with what you typed (letters within 0.9 s spell one name) |
| `~` | back to the top |
| Space | the preview switches between the definition and "what holds now" |
| `1` / `2` | open or close the open risks / the open commitments |
| Enter | put the project's reference (`{{fylgja:project name\|id}}`) into the prompt box at the cursor |
| `:` | put `in <top> / <area> / <project>: ` into the prompt box, for you to go on typing |

A click on a row highlights it; a second click enters it; a click in the parent column goes back up. The two buttons under the navigator (`reference → prompt`, `ask in this place`) do what Enter and `:` do.

## What to look at

- The columns. From 100 columns wide there are three (parent, current, preview); from 56 there are two (current, preview); below that the list sits above a short preview. The breadcrumb is the top line.
- A row. It is a name and one mark at its right end: `●` filed within a week, `○` within a month, `·` longer ago or never. The dim mark before the name is the band (`▪` orientation, `▫` workstream). Counts are only in the preview.
- Speed. The highlighted project's outline is read after the highlight has rested for 180 ms, so Right is usually instant. Holding an arrow key down reads nothing. A level that is not there yet says `loading…`.
- "What holds now" is read only when you press Space. It shows each question with its value and date, the open risks and commitments as counts that open, and the last three decisions.
- Proposed changes are a dim count. Nothing here accepts, rejects or changes anything.
- `open in Fylgja` appears in the preview only when the server sends a `link` for the project. Today's server does not, so today there is no link.
- The line above the prompt. It appears only while the pane is open but the surface has not seated it, and says where you are.

## What it does not do

It adds nothing to what Claude reads. `/map` answers with no text, because a command's output is read by Claude on the next turn. The two actions only put text into the prompt box and never submit. It calls two read tools, `get_project` (the flat list) and `open` (one level, or the state of one project). What it read stays in memory: at most 240 levels and 40 state views, dropped when sign-in lapses.

## What nobody has confirmed in a live session

Everything below passes in `claude plugin test`, which exercises the hooks and the surface module but never a real surface.

1. **Whether the navigator gets keys without a click.** The types say a `Client` receives keys "while a click has given it the focus". `/map` asks for pane focus, but that is the pane's focus, not the `Client`'s. The key line therefore starts with "click, then". If a click is not needed, or if Tab can give the focus, the line is wrong.
2. **Whether the Desktop app delivers `Client` keys and clicks at all.** The types describe key and pointer input in terminal terms and say `ui.message` comes from "`terminal`, or `desktop` once it has them". If Desktop draws the navigator but sends no keys, the map looks right and does nothing; only the two buttons work. There is no way to detect this from code, so it does not fall back by itself.
3. **Which key names arrive.** The code expects `up`, `down`, `left`, `right`, `return` (also `enter`), `pageup`, `pagedown`, `home`, `end`, `backspace`, and takes Space as either `' '` or `space`. Whether `~` and `:` arrive as those characters on every keyboard layout is untested.
4. **Whether the engine keeps some of these keys for itself** while the pane has focus (Up/Down scroll a tall pane, Enter presses a focused button, PageUp/Home scroll).
5. **Text selection inside the pane.** A `Client` holds the pointer from press to release, so the terminal probably cannot select text in the navigator. Nothing here re-implements selection or copy. The definition and "what holds now" may therefore not be copyable.
6. **How it feels at 80, 120 and 200 columns.** The tests check that two, three and three columns are laid out and that every line fits its column. They cannot show whether the widths read well, whether `Box` width and height count cells the same way on Desktop, or whether the inverse highlight is visible in every theme.
7. **Region height.** The `Client` is given no height; it draws as many rows as the pane's `bodyRows` minus three. Whether a docked pane reports a useful `bodyRows` is untested.
8. **`ui.fault` on a real failure.** In the tests the navigator is made to throw and the buttons take over at the same position. A module that fails to load on a real surface should take the same path.
9. **The unplaced line.** It relies on `$.ui.open` answering `isPlaced: false` and on the pane's first drawing arriving later. There is no key that seats a waiting pane, so the line can only say that `/map` asks again.
10. **The pointer.** Click rows are computed from the layout (breadcrumb on row 0, lists from row 1). If the region has an offset or a border the clicks are off by a row.
11. **Wide characters.** Names are cut and padded by code points; CJK or emoji names will misalign the recency mark.

## What is lost in the button fallback

Where there is no `Client` (VS Code, mobile) or after it failed, rows are buttons. There are no arrow keys and no type-to-jump, every move is a round trip to the plugin, and the parent column is gone. Hotkeys `u`, `t`, `o`, `w`, `1`, `2` work while the pane has the focus.

## A limit that comes from the server

The server lists projects flat, without their place in the tree, and has no call for "the top-level areas". The map opens up to six listed projects and takes each one's path to find its area. When listed projects are left over, the top column says areas may be missing. `/map <name>` reaches any project regardless. A project whose top-level area cannot be found by name (two projects share the name) is shown at the top itself. Children in the technical band are folded by the server into a count and a few names, so they cannot be highlighted; `/map <name>` puts you inside one instead.

## Where it could be useful, and where probably not

It could be useful just before asking something: you know the topic but not what the area is called or how the tree splits it, so you walk two levels, read one definition, and press Enter or `:` to start the question in the right place. The state view is a cheap "is anything open here?" check that costs Claude no tokens. It is probably not useful for anyone who already knows the project name, because typing it into the prompt is faster and Claude finds it. It is a poor replacement for the desktop Map: one level per call makes the first walk slow, there is no overview of the whole tree, and a pane that needs a click before it takes keys is not "one keystroke away". If the Desktop app turns out not to deliver keys, the experiment is terminal-only in practice.
