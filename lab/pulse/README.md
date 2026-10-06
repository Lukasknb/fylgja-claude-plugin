# pulse

An experiment. `/pulse` opens a pane with a picture of where the work has been.

It reads Fylgja and writes nothing. It adds nothing to what Claude reads. It draws only after you type the command or press a key in its pane.

## Try it

```bash
claude --plugin-dir /home/lukas/dev/private/fylgja-mod-lab/lab/pulse
```

Sign in to Fylgja with `/mcp` if asked. Then type one of:

```
/pulse                     everything recent, by top-level project
/pulse Platform            one project and everything under it (exact name, id, or a pasted project reference)
/pulse org/repo            one repository's sessions
```

The pane takes the keys while it has the focus (`Ctrl+X` then `Tab`, or a click, if it does not).

| Key | What it does |
|-|-|
| `h` `j` `k` `l` | Move the cursor left, down, up, right |
| `w` / `n` | Wider / narrower window: 2 weeks, 6 weeks, a quarter |
| `a` `m` `s` `d` `o` | All lanes, or only meetings, sessions, decisions, other |
| `v` | Switch between the heatmap and the constellation |
| `Enter` on "Step into …" | Step the whole picture into the project under the cursor |
| `u` | Step back up |
| `p` | Plain text instead of the picture, and back |
| `r` | Fetch the scope on screen again |

## What to look at

**The heatmap.** Rows are the project's direct children. Columns are days, or weeks when the window or the pane is too narrow for days. A cell is darker the more happened there. Blue is meetings, orange is sessions, purple is decisions, grey is everything else the timeline lists (commitments, tree changes). In a wide cell the three sit side by side; in a narrow one the colour is the busiest lane. A child with nothing in the window still has a row. That empty row is the point.

**Under the picture.** The cell under the cursor in words, then its entries: glyph, title, date. Each entry has "Put reference in prompt", which puts the reference at the cursor of the prompt box and submits nothing. Meetings and sessions get the `{{fylgja:…}}` reference. Decisions and other entries have no such reference, so the button says "Put id in prompt" and writes the kind and the id. "Open in Fylgja" shows only when the server answers a link for the record (see below).

**The constellation** (`v`). The same subtree as nodes. Size is how much is filed under a node. Shade is how recently it was active: full this week, lighter for this month, this quarter, longer ago. The largest five are named; the rest are named when the cursor is on them. Look for a large pale node (a lot filed, long quiet) and a small solid one (new and busy).

**The dim last line.** It says when the picture is built from a partial result, how many lines of the timeline could not be read, how many quieter rows are not shown, and how many places below are not drawn.

## Decisions worth knowing

**The cursor uses Buttons with letter hotkeys, not a `Client` region.** A mod cannot bind the arrow keys in a pane; only a `Client` region receives them raw. A `Client` gets keys only after a click gives it the focus, cannot hold a `Raster`, and its key input on the Desktop app is not confirmed anywhere. Buttons exist on every surface and their hotkeys work while the pane has the focus, with no click. So the cursor is `h j k l`. What was given up: the arrow keys themselves, which in a pane move between controls.

**Never by person.** Rows and nodes are places in the project tree. The code never reads, keeps, groups or ranks by who wrote, attended or ran anything, and there is no option for it. Note what follows from the server's own rules: sessions are visible to their owner only, so the session lane is your sessions, and the meeting lane is the meetings you may read.

**Calls.** `/pulse Platform` costs two reads: `open` for the outline and one `get_timeline` for six weeks. Moving the cursor, switching lanes and narrowing the window cost nothing. Widening fetches only the days not held. The first constellation of a project costs one `open` per child that has children, six at most. When the server says it left entries out, the window is split in two and each half asked for, seven `get_timeline` calls at most per fetch; the server caps each kind of entry on its own, so paging by "oldest date seen" would skip entries. What is still incomplete after that is said in the last line. Up to eight scopes are held in memory, 800 entries each, and all of it is dropped when Fylgja asks for sign-in.

**Links.** The timeline carries no links. When the cursor has rested on a cell for half a second, the ids of its listed entries are sent to `resolve` once. A link is shown only if it is exactly `https://fylgja.lknblab.dev/open/<kind>/<that id>`. Today's server has no `resolve`: it is asked once, the failure is remembered, and no entry offers a link.

**Colour.** The plain-text picture uses theme keys (`suggestion`, `claude`, `merged`, `inactive`), so it follows your theme. A `Raster` and an `Svg` cannot name theme keys. There the hues are fixed mid-tones that stand at least 3:1 from white and from a dark background (a test checks this), and intensity is a shade character or an opacity, which blends with whatever background is behind it. The mod does not read your settings to find out the theme.

## What nobody has confirmed in a live session

I could not start a session or reach the server. Everything below passed only through `claude plugin test` and the mount harness. Check these first.

1. **Hotkeys in the pane.** That Button `hotkey` letters fire in a focused pane, on the terminal and on Desktop, and that `focus: true` is granted after a typed `/pulse`.
2. **`autoFocus` on "Step into …".** That Enter presses it right after the pane opens, and that it does not pull the focus back on every redraw while you work the entry buttons.
3. **`Raster` in a pane.** That the cells are accepted: shade characters `░▒▓█`, `·`, `▸`, `▾`, `…`, and Latin, Greek and Cyrillic letters as one column each; the default-colour value `0x01000000` for foreground and background; a full redraw per key press being fast enough (no `$.ui.blit` is used). A docked pane is narrow: under about 56 columns six weeks fall back to weeks.
4. **`Svg` on Desktop.** That `isInteractive` shows the `<title>` on hover; that `prefers-color-scheme` inside the SVG follows the app; that the SVG's own `width`/`height` size it sensibly in the pane; that the frame's background is the app's.
5. **Theme keys.** That `suggestion`, `claude`, `merged` and `inactive` are four hues you can tell apart in your theme, and that `inverse` draws the cursor cell.
6. **`$.prompt.fill` insert mode on Desktop.** It may answer "no composer". The pane then says the prompt box is not taking text.
7. **Timers from a button press.** That `$.clock.after`, called through a `$` captured when the pane was drawn, still fires.
8. **`$.command.register` at `session.start`**, and again after a hot reload.
9. **The live server's text.** The line grammar, the count lines and the "more exist" wording were read from the server's source, not from a live answer. Also unconfirmed against the live server: `get_timeline` taking a project id as `project_name`, `until` as a datetime (`…T23:59:59`), and `open` with `detail: false` on a name typed after `/pulse`.
10. **`resolve` and links.** Not deployed. The path is tested against a stub only.
11. **`Link` in a terminal pane.** Whether your terminal opens the `https://` link on click.

## Which rendering path I saw

None on a real surface.

- **Raster:** tests decode the base64 cells back to characters and colours. I read the result as text and checked colours as numbers. I never saw it painted.
- **Svg:** tests check the source. I also rendered the source offline to PNG on white and on dark grey and looked at it; it was legible on both. That is not the Desktop app's frame, and the offline renderer ignored the colour-scheme rules.
- **Text:** tree only, through the mount harness, on terminal, desktop and mobile.

## Known gaps

- An entry line with no place from the server whose label itself ends in ` · in X > Y` would be counted under that place. Inside a project's picture it can only land on a real child of that project or on "(elsewhere)".
- Days are UTC days here. An entry the server dates tomorrow is put in the newest column.
- Week columns run in sevens from the start of the window, not Monday to Sunday.
- Without a project (`/pulse`, `/pulse org/repo`) there are no filed totals to read, so the constellation sizes nodes by activity in the window and says so.
- `get_timeline` for a repository returns sessions only; the other lanes are empty there.
- The outline lists one page of children. A project with more says so in the last line; the rest are not fetched.

## Is it useful?

Partly. A picture tells you three things the plain timeline cannot. First, absence: the timeline lists what happened, so a child that went quiet is simply not in it, while here it is an empty row. Second, rhythm: a burst before a deadline or a lane that stopped is visible at a glance and takes real reading to get from a list. Third, the constellation puts two numbers side by side that no single tool returns together, how much is filed and how recent, so a large stale area or a small hot one stands out. It probably is not useful for the question most people actually have, "what happened?": the list under the cursor is just the timeline filtered, and Claude answering from `get_timeline` is faster. It adds little for a project with two or three children, where a three-line table says the same. It counts entries, not importance, so one decisive meeting looks like one chatty one. And when a window comes back cut, an empty cell can mean "nothing happened" or "not fetched"; the last line says the picture is partial, but the picture itself cannot show where. I would keep the heatmap for trees with six or more children and a quarter's window, and treat the constellation as the more doubtful half until someone has looked at it on a real tree.
