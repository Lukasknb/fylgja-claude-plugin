# Fylgja for Claude Code

Fylgja in every Claude Code session: the knowledge base as tools, and a few
quiet touches that make working with it feel at home.

- **The Fylgja tools, everywhere.** The plugin registers
  `https://fylgja.lknblab.dev/mcp` in every project, so no repo needs its own
  `.mcp.json` entry. Claude decides what to look up, and when.
- **Pasted references read well.** Copy a meeting, session, note or project
  for Claude in the Fylgja app and paste it into a prompt. It is painted in
  the prompt box, and drawn in your message as a chip with the record's real
  title and date. Claude gets the reference exactly as you pasted it and
  opens it with the Fylgja tools.
- **Sign-in is never a guess.** While Fylgja needs it, one line under the
  prompt says so.

## Install

Needs Claude Code 2.1.291 or newer.

```bash
claude plugin marketplace add Lukasknb/fylgja-claude-plugin
claude plugin install fylgja@fylgja
```

Then sign in once: type `/mcp` in a session, pick `fylgja`, and choose the
account whose knowledge base this machine should use. That is the only
sign-in. While it is missing, one line under the prompt says
`sign in with /mcp`, and goes away within a few seconds once you have.

## What you will see

Very little, on purpose.

- A pasted reference is painted in the prompt box as you type. In your
  message it is a chip: `[◉ meeting · 45ada8aa]` for a moment, then
  `[◉ "Engineering Retrospective" · 2026-09-30]` once Fylgja has confirmed
  it, or `[◉ meeting · not found]` when it is not there or not yours to read.
  The quoted title is the record's own, never the label that was pasted.
  Expand the message to see it as sent; copying a drawn message with the
  mouse copies the chip, not the reference.
- Links to Fylgja records in Claude's replies carry the record's glyph. They
  stay ordinary links.
- One line when Claude writes to Fylgja: `✓ Remembered.` A write that did
  less than was asked keeps Claude Code's own row, which says why.

## What it never does

- It adds nothing to what Claude reads. Nothing in the plugin sees a prompt
  on its way to Claude: no context is attached and nothing is fetched for
  Claude on your behalf.
- It never delays a prompt. The lookup for a chip is started by the message
  once it is drawn; if Fylgja is slow, unreachable or signed out, the chip
  simply stays as it is.
- It does not redraw Claude's searches and reads of your knowledge base, open
  a pane, put anything above the prompt, or pop up a notice.

Chips, paint and receipts are drawn in the terminal and the Claude desktop
app. Elsewhere nothing is drawn, and nothing else changes.

## What leaves your machine, and what is kept

- **Sent to Fylgja:** the id of each reference in a message of yours that is
  drawn (one you typed or sent yourself), to look up its title, date and
  visibility for the chip. Nothing else of the message is sent, and a prompt
  handed over by a program (`claude -p`, the SDK) causes no lookup at all. It
  rides the Fylgja connection you signed in to with `/mcp`. While the sign-in
  line is up, Claude Code is asked every few seconds whether Fylgja is
  connected yet.
- **Kept:** what the chips show is held in memory by the running plugin for
  the conversation. It is dropped on `/clear`, on resume, when you have to
  sign in again, and when the session ends. The plugin writes no file and no
  log line.

## Working on it

The hooks are TypeScript that Claude Code loads as it is; there is no build.

```bash
claude plugin validate ./fylgja --strict
claude plugin test ./fylgja
```
