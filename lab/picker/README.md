# picker — mention a meeting the way you mention a file

Type `@@` in the prompt box and a few letters. The Fylgja records that match
are listed above the prompt. One key puts the reference
(`{{fylgja:meeting Pricing sync|<id>}}`) into the draft, where the trigger
was. Nothing has to be copied from the desktop app.

Claude reads the draft exactly as it stands when you press Enter. The mod
adds nothing to it and changes nothing on the way.

## Try it

```bash
claude --plugin-dir /home/lukas/dev/private/fylgja-mod-lab/lab/picker
```

Sign in with `/mcp` if the list says so.

## What to type

| Type | What happens |
|-|-|
| `@@` | The six most recent meetings appear above the prompt, numbered. |
| `@@p` | One letter narrows those meetings. Nothing is searched yet. |
| `@@pric` | From two letters on, Fylgja is searched once you pause for 400 ms. Until the answer is there you see the recent meetings whose title holds what you typed, without numbers. |
| `2` | With numbers showing, a digit puts row 2 in the draft and closes the list. |
| `{{pric` | The same list, but every character is part of the query. Use it for titles with a number in them (`{{q3 plan`). No numbers are shown. |
| `/pick` or `/pick pric` | The same list in a pane with a field. Type, then press Enter to take the first row, or Tab to a row and Enter. |

Closing without choosing: delete the trigger, move the cursor out of the
query, start a new line, send the prompt, or click the `×` at the end of the
first row. After `×` the list stays closed until a new trigger is typed.

## What to look at

- The band is empty until a trigger is typed and empty again after a choice.
- One line per record: glyph, title, date dimmed. Six at most. `›` marks the highlighted row; the others are dimmed.
- Numbers appear only when the rows are final for what you typed. That is the moment a digit chooses.
- After a choice the reference is painted: `{{fylgja:` and `|<id>}}` dimmed, the label bold. The cursor sits after the space that follows it.
- Type fast, then stop: there is one search, for the final text.

## Choosing: which way is which

**1. The best way the API allows for certain: a digit, typed in the prompt.**
A typed character is an edit, so `prompt.edit` is raised for it. The hook
lets the edit through, then answers with the draft rewritten: trigger, query
and digit replaced by the reference and a space, cursor after it. One
keystroke, hands on the keys, no flicker, and the cursor is right even in the
middle of a draft. A digit only chooses after `@@`, only for a row that
exists, and only while the numbers are showing. Typed ahead of the answer it
is part of the query.

**2. The fallback: the pointer, or the band's own focus.** Each row is a
Button. A click reads the draft and writes it back with `$.prompt.fill`.
Without a mouse: `ctrl+x tab` moves focus to the band, then the row's digit
(its `hotkey`) or Tab and Enter presses it. This works wherever the band is
drawn, but it leaves the home row.

**3. Implemented, probably dead in the terminal: Tab, Enter, Up, Down,
Escape.** With the list open the hook consumes them: Up and Down move `›`,
Tab or Enter takes the highlighted row, Escape closes. Tests cover it. Whether
the keys ever arrive is the open question below. If they do, this becomes the
best way and `{{` gets a keyboard path too.

`/pick` is the baseline that depends on none of this.

### What the declarations say about keys

- **Can be captured:** any typed character, Backspace, and a bare cursor move (`start`/`end` are documented for "a bare cursor move"). A hook may answer without `next` to consume the key, or rewrite the box that `next` returned.
- **Named but not promised:** `e.key` uses the `Client` key shape, which lists `up`, `down`, `return`, `tab`. But the event fires for "a key the editor took as an edit, or a paste". Nothing says the composer treats Tab, Enter, Up or Down as edits.
- **Evidence against:** `skanehira/claude-vime`, a Japanese input method built on `prompt.edit`, states that Up, Down, Tab, ctrl+n and shift+arrows do not reach the mod, that Enter sends the prompt without reaching it, and that Esc never arrives. It chooses candidates by number for that reason. This mod does the same.
- **Cannot be captured:** a Button `hotkey` from the composer (only "a bare digit in an empty one"). Focus cannot be moved to the band by the mod while the draft holds text. No new key can be bound.

## Cost and speed

- The hook on the prompt box does no network work and awaits nothing but `next(e)`. It looks at the 61 characters before the cursor, and at the whole draft only with one plain search for `{{fylgja:`.
- Measured in `tests/speed.test.ts` with a 100,000-character draft, 300 keystrokes each: median 0.06–0.09 ms with no list; 0.09–0.15 ms with twenty references to paint and the list open; slowest keystroke under 0.5 ms. The budget is 50 ms. The test fails above 1 ms and 3 ms.
- `search` is billed. It is sent 400 ms after the last change, never under two characters, one at a time, at least 1.1 s apart (under 55 a minute), and not at all when you typed past it while it waited. Answers are kept five minutes, so deleting a letter costs nothing.
- `get_timeline` is read once when a list opens and kept for a minute.
- While the list is open the draft is read every 300 ms. That is how a sent prompt is noticed. It stops when the list closes.
- Titles and queries live in the running plugin only. Nothing is stored or logged.

## Not confirmed in a live session

Check these first, in this order.

1. **Does `prompt.edit` fire in the Desktop app?** If not, nothing opens there on `@@`; `/pick` still works. A next step would be watching the draft on a timer.
2. **Do Tab, Up, Down, Enter, Escape reach `prompt.edit`?** Expected: no. Open the list with `{{`, press Down. If `›` moves, they do.
3. **Does `@@` fight Claude Code's own `@` file menu?** It may open for `@@re`, cover the band or take keys. If so, `{{` is the better trigger.
4. **Does the rewritten box land?** Type `@@`, then `1`. The reference must replace `@@1`, cursor after the space.
5. **Is the paint drawn?** Label bold, the two ends dimmed, and still there after more typing.
6. **Does a paste raise `prompt.edit`?** Paste `@@retro`. If the list does not open until the next key, pastes raise none.
7. **Work started from a keystroke and finished later.** The search runs from a `$.clock.after` timer on the `$` kept from `session.start`, then calls `$.ui.invalidate`. The band should update without another key.
8. **How the band draws a row.** A plain Button with a `hotkey` should read `1: ◉ Title` on one line with the date after it. On Desktop a plain Button is a native button and may be taller than a line.
9. **A click on a row while a draft is typed.** The draft must be replaced by `$.prompt.fill`, and focus must return to the prompt.
10. **The timeline's text.** Meetings are parsed from lines of the form `- <date> · meeting · <title> · in <path> (id: <uuid>)`. Sessions come first in that text; with many sessions the 20,000-character cap could cut the meetings off.
11. **What `search` calls a note.** Hits are kept when `type` is `meeting`, `session`, `note` or `project`. If notes arrive as `document` they are not listed.
12. **`/pick`.** The pane should take focus (`focus: true` after a typed command), the field should have the cursor, Enter should work in it.

## What was given up

- A key choice does not go through `$.prompt.fill`. Answering the edit is atomic and can place the cursor; `fill` with `replace` always leaves the cursor at the end of the draft. So a *click* on a row in the middle of a long draft puts the reference in the right place but the cursor at the end.
- `search` takes one `kind` per call. Four billed calls per query was not worth it, so one call asks for twenty hits and the mod keeps the kinds a reference can name. A query that mostly matches facts and topics can show fewer than six rows.
- The list before any query holds meetings only.
- A digit after `@@` is ambiguous with a number in a title. `{{` is the way out.
- Escape most likely cannot close the list. The `×` and deleting the trigger can.

## Where this is useful, and where not

For the person who knows roughly what a meeting was called, `@@pri` then `1`
is faster than switching to the desktop app, and the recent-meetings list
makes "the one from this morning" two keys. That is real, and the digit
mechanism does not depend on anything unproven except the box rewrite. It is
weaker than Claude Code's own `@` in every way a native feature would not be:
no arrow keys, most likely no Tab, numbers that only appear after a pause,
and a second trigger to learn for titles with digits. It is probably not
worth it for sessions and projects, where the title is rarely what one
remembers, and it does nothing Claude cannot already do when asked "open the
pricing sync" — the gain is only that the person, not the model, picks the
record. If the Desktop app raises no `prompt.edit`, the in-prompt half is
terminal-only and `/pick` is the part to keep.
