# scrub

"What exactly was said?" Move through a meeting's transcript like a video timeline, without leaving the session.

It is read-only. It adds nothing to what Claude reads and changes nothing Claude does. It draws only after you type `/scrub`.

## Try it

```bash
claude --plugin-dir /home/lukas/dev/private/fylgja-mod-lab/lab/scrub
```

Sign in to Fylgja with `/mcp` if the pane asks. Then type one of:

- `/scrub` — lists the most recent meetings. Press a digit or click one.
- `/scrub {{fylgja:meeting Pricing sync|<id>}}` — a reference copied from the Fylgja app.
- `/scrub https://fylgja.lknblab.dev/open/meeting/<id>` — a link to a meeting.
- `/scrub <id>` — the bare id.
- `/scrub --plain <any of the above>` — the pane with buttons instead of the interactive timeline.

**Click inside the pane once.** Keys reach the timeline only after a click has given it the focus. Escape gives the focus back.

## What to look at

From top to bottom:

1. Title and date.
2. Where the playhead is, and how far the meeting is known to go.
3. The bar. One cell per slice of time. Each speaker has a colour. `┃` is the playhead. `┄` is time that is not loaded.
4. Marks under the bar: `◆` a decision, `▸` a commitment, where the server recorded when it was made.
5. A time scale. The right end shows the latest moment seen so far, with `≥` until the end is found.
6. A line of hints, or `loading…`, or one plain line when something went wrong.
7. The transcript around the playhead. The row at the playhead is bold, marked `▶`, and wraps over up to three rows.
8. Buttons: play, speed, quote this row, decisions.

| Key | What it does |
|-|-|
| Left / Right | one row back / on |
| Shift+Left / Shift+Right, `[` / `]`, PageUp / PageDown | ten rows |
| Home / End | first / last row loaded so far |
| `n` / `p` | next / previous decision that has a place on the bar |
| Space | play and pause: steps through the rows, longer rows held longer |
| `s` | speed: 1×, 2×, 4× |
| `q` or Enter | put a quote of this row into the prompt box |
| `d` | list the decisions and commitments; a digit goes to one |

With the mouse: click or drag on the bar to move the playhead. Click a transcript row to put the playhead there. Over a part of the bar that is not loaded a ghost mark `┆` follows the pointer; the read happens when you let go.

The quote looks like this, at the cursor of the prompt box. It is never submitted:

```
"we ship the annual plan first" — Ada, {{fylgja:meeting Pricing sync|<id>}} at 12:40
```

## How it is built

- `hooks/timeline.ts` is a surface module (a `Client`). It holds the playhead, play state and speed in its own local state, so a key or a drag is answered on the drawing thread with no round trip.
- It posts a small message to the hooks only when it needs something: more rows (once the playhead is eight rows from a loaded edge), a far moment, a quote. Only numbers travel in a message. The hooks find every text themselves.
- The hooks read `get_meeting` with `transcript_window`, hold one run of at most 200 rows in memory, and read one window ahead after every open and every jump. A key never causes a read by itself. In the tests, 160 key presses through a 130-row meeting cost 8 reads.
- The answer to a message hands the timeline what is known at once. When a read lands, the pane is drawn again and the new rows arrive as new props.
- All server text is sanitised once, when it is read.

## What the server does not give, and what that means

- **The meeting's length.** It is not in the answer. The bar spans the latest moment seen so far and grows as you walk. The end is found only by reading past the last row and getting nothing new. The pane says "at least" until then.
- **When a decision was made.** Today's server sends `decided_at` as a date only. So on today's server **no marks appear on the bar**, `n`/`p` do nothing, and the list shows every decision as "moment not recorded". The code reads `start_seconds` or `at_seconds` (a moment) and `position` or `segment_position` (a row) on decisions and action items if the server ever sends them. These field names are a guess. This half of the experiment is only proven against stubs.
- **A row's end.** Rows carry a start only. A band on the bar runs until the next row starts, so silence is drawn as the last speaker.
- **Speaker names.** Rows carry a tag. A bare number is shown as `voice 3`.

## Not confirmed in a live session

Nothing here has run in a real session. Check these first:

1. **`Client` on the terminal at all.** No published mod uses one. The tests drive it through the test kit only.
2. **`Client` in the Desktop app.** The declarations say desktop has `Client`, but describe pointer and key events in terminal terms. Do keys arrive? Does a drag? Does `post` reach the hooks?
3. **Focus.** Do keys arrive only after a click inside the region? Does `focus: true` on the pane help? Does Escape leave cleanly?
4. **Key names.** Space is handled as `' '` and as `'space'`. Shift+arrow is expected as `{ key: 'left', shift: true }`. `[` and `]` are the second pair in case Shift does not arrive.
5. **Arrow keys.** In a pane, Up/Down and PageUp/PageDown normally scroll. Whether Left/Right, PageUp/PageDown, Home/End reach a focused `Client` or are taken by the pane is unknown. `[`, `]`, `n`, `p` do not depend on that.
6. **Pointer.** tmux passes no pointer events through, so there the bar cannot be clicked. Sub-cell positions (`fine`) exist only in kitty, Ghostty, iTerm2, WezTerm and foot; elsewhere a click lands on a whole cell.
7. **Buttons inside a `Client`.** The region captures the pointer after a press. Whether its own Buttons still get their press is unknown. Every Button also has a key.
8. **Row arithmetic.** A click on a transcript row is matched by its row number in the region. That assumes every line the module draws takes exactly one row (all are truncated, none wraps). A wide character or a different Desktop font would shift it.
9. **Play timing.** Playback uses `surface.every(200, …)`, started on Space and stopped on pause. Whether the frame clock keeps time while the pane is not focused is unknown.
10. **`{ props }` as the answer to `ui.message`.** If it does not reach the instance, the later redraw still does.
11. **State across a redraw.** The module keeps what its listeners read in a module-level record. That assumes the module is loaded once per surface and stays loaded.
12. **A fault.** `ui.fault` switches the pane to the plain one until the plugin reloads. In the tests a fault is forced by laying the region out 300,000 columns wide. No real load failure has been seen.
13. **`ui.close`.** Closing the pane should drop the meeting from memory. The test kit cannot raise that event, so this is untested.
14. **The command printing nothing.** `/scrub` answers `{}` so that no text reaches Claude. Whether the session then shows an empty row is unknown.
15. **Colours.** Speaker colours are fixed mid-tone hex values, not theme keys, because a theme has too few distinct keys. They should read on dark and light themes; a no-colour terminal shows one flat bar.
16. **The picker.** `/scrub` alone parses `- <date> · meeting · <title> (id: <uuid>)` lines out of `get_timeline`'s text. That format is read from the server's code, not from a live answer.

## What the plain pane loses

`/scrub --plain`, a surface without `Client` (VS Code, mobile), or a failed timeline gets a plain pane: a still strip (a `Raster` of cells in the terminal, an `Svg` elsewhere), the rows around the playhead, and Buttons for row back, row on, earlier, later, quote, and one per decision.

Lost: every key, dragging and clicking the bar, clicking a row, play mode and speed, the ghost mark, and the instant feel. Every press is a round trip to the hooks and a redraw. Kept: reading ahead, the bounded memory, the quote, going to a decision. Gained: text in the pane can be selected with the mouse again, which the interactive timeline prevents because it captures the pointer.

On the Desktop app the interactive timeline draws its bar with text cells, the same as in the terminal. A surface module cannot draw an `Svg`. The `Svg` strip is only in the plain pane.

## Where this could be useful, and where probably not

It could be useful right after Claude cites a meeting and you want the actual words before you rely on them: paste the reference, jump near the moment, read twenty lines, and put one exact line back into your prompt with its source attached. Play mode is a pleasant way to skim five minutes of a meeting you missed. It is probably not useful as a way to find a moment: there is no search inside the transcript, the bar is blind until you have walked there, and without recorded moments on decisions there is nothing to jump to. The timeline is honest about a meeting only as far as it has been read. For "what was decided", the summary Claude already gets is faster. If the server sent a duration and a moment per decision, the bar would be worth much more; without them this is mostly a transcript reader with a good quote button.
