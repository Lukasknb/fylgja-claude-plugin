# Fylgja for Claude Code

Fylgja in every Claude Code session: the knowledge base as tools, and a few
quiet touches that make working with it feel at home.

- **The Fylgja tools, everywhere.** The plugin registers
  `https://fylgja.lknblab.dev/mcp` in every project, so no repo needs its own
  `.mcp.json` entry. Claude decides what to look up, and when.
- **Pasted references read well.** Copy a meeting, session, note or project
  for Claude in the Fylgja app and paste it into a prompt. It becomes a short
  chip in the prompt box, and is drawn in your message as a chip with the
  record's real title and date. Claude gets the reference exactly as you
  pasted it and opens it with the Fylgja tools.
- **Sign-in is never a guess.** While Fylgja needs it, one line under the
  prompt says so.
- **Scribe keeps the why.** A background reader follows the session and
  records each decision in Fylgja with its reason, what was rejected and the
  code it concerns, so whoever reads that code later can find out why it is
  the way it is. When a decision has no reason it asks, once and briefly.
  When you work in a file that has a recorded decision or gotcha, it tells
  you. It runs beside the conversation, never in it.

## Install

Needs Claude Code 2.1.295 or newer.

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

- A pasted reference becomes a chip in the prompt box. You see
  `‹◉ Engineering Retrospective›` in place of the long `{{fylgja:…}}` text.
  When you press Enter, the reference goes to Claude exactly as you pasted
  it.
  - The chip shows the title bare, as pasted. Only your sent message shows
    a title in quotes, and that one Fylgja has confirmed.
  - A chip is its whole text, from `‹` to `›`. Text you type before or
    after it is ordinary text.
  - Two different records with the same title get the start of their id
    added, so you can tell them apart.
  - Backspace right after a chip, or Delete right before it, removes the
    whole chip.
  - If you edit inside a chip it becomes plain text: it is dimmed, loses
    its fill, and Claude gets that text and no reference. Put the text
    right again, or paste again, and it is the chip again.
  - If your edit makes a chip read exactly as another chip shown in this
    session, it is that other chip.
  - A prompt you bring back into the box in the same session (history, a
    queued prompt) keeps its chips, and is sent with its references.
  - A prompt from an earlier session, or after the plugin was reloaded,
    carries the title only. Its chips are dimmed with no fill, and are sent
    as typed. Paste the reference again if Claude should have it.
  - Only an exact chip text the plugin has shown since it was loaded is
    read as a reference, wherever it stands in the prompt, pasted text
    included. Everything else is sent as typed.
  - One paste makes at most fifty chips. Further references stay as
    written and are only painted. They are sent as pasted all the same.
  - If the prompt box does not accept chips, references stay as written
    and are only painted.
- In your message it is a chip too: `[◉ meeting · 45ada8aa]` for a moment, then
  `[◉ "Engineering Retrospective" · 2026-09-30]` once Fylgja has confirmed
  it, or `[◉ meeting · not found]` when it is not there or not yours to read.
  The quoted title is the record's own, never the label that was pasted.
  Expand the message to see it as sent; copying a drawn message with the
  mouse copies the chip, not the reference.
- Links to Fylgja records in Claude's replies carry the record's glyph. They
  stay ordinary links.
- One line when Claude writes to Fylgja: `✓ Remembered.`, `✓ Fixed in
  Fylgja.`, `✓ Commit noted on 2 records.` A write that did less than was
  asked keeps Claude Code's own row, which says why.

## Scribe

Scribe is the one part that does more than draw. At the end of a turn you
started it reads what happened, thinks about it with a small model on your
own Claude plan, and works with Fylgja. Most turns it does nothing, and you
see nothing. What it shows, it shows in the band above the prompt, one thing
at a time.

- **It records.** A choice between real alternatives, a rejected approach,
  a workaround, a departure from the plan, a correction of yours, a gotcha
  that cost time: written to Fylgja at once, with the reason, what was
  rejected, and the files it concerns. Not naming, formatting, routine edits
  or status. A record points only at files the session itself opened. Then
  one line:

  `✓ Recorded · Use Postgres advisory locks for the job queue, not Redis.   1 Fix  2 Remove  0 OK`

  Fix opens the sentence in a field. Remove takes the record away again.
  Several records from one turn are one line, `✓ Recorded 3   1 Review`. A
  record you had removed and that is written again says `Restored`. The
  line goes by itself after twenty seconds, or when you send your next
  prompt. It never waits for you.
- **It asks why**, when a decision that matters came without a reason:

  `? Why: Use a sessions table, not signed cookies.   1 Sessions must be revocable  2 To list a user's devices  3 Other  4 No particular reason  0 Skip`

  Pick one, type your own, or say there was none. "No particular reason" is
  an answer and is kept as one, in your words if you typed some ("no idea,
  it just worked"): a later reader sees that nothing in particular decided
  it, which is not the same as nobody having asked. A typed answer counts
  as "no reason" only when that is all it says; "none of the others
  support ESM" is a reason. Skip saves nothing.
- **It asks before anything is replaced.** When a new decision goes against
  a recorded one, the new one is not written until you have said which it
  is: `1 Yes, it replaces it  2 No, tell Claude  3 Different case  0 Skip`.
  Only the first key makes it the replacement, and the receipt then names
  what it replaced. Left unanswered, it is written beside the old one.
- **It tells.** When Claude reads or changes a file that a recorded decision
  or gotcha is anchored to:

  `◆ Decision · Use the queue for outbound mail, never a direct SMTP call. · 2026-09-12   1 Open  2 Tell Claude  3 Knew this  0 Dismiss`

  Open shows the reason, what was rejected and where, with a link to the
  record. Tell Claude puts a quoted note in your prompt box for you to send
  or not; it sends nothing, and leaves a box with text in it alone. Knew
  this keeps that record away on this machine for good.
- **It reads the plan.** If the session works from a plan (plan mode's own,
  or a markdown file that calls itself a plan, a design, a spec, an RFC, an
  ADR or a work package), that is where Scribe looks first for the reason.
  A decision whose reason is in the plan is recorded with that reason and
  names the plan; you are not asked. A plan in the repository becomes one
  of the record's anchors. A plan outside it will be gone for a later
  reader, so its reasoning is copied into the record.
- **It notes the commit.** After a `git commit` in this repository, the
  commit is attached to what the session recorded, Claude's own records
  included. A commit made somewhere else (`git -C /other`, `cd /other &&
  git commit`) is not.

Staying out of the way is the point, and the limits are in the code:

- A question is only ever about a decision, never one whose reason the
  session or the plan gives, never twice about the same one, at most one
  when a turn ends, at most four in a session, and none at all once two
  went unanswered. It shows only when Claude has finished.
- At most one tell per turn, never the same record twice in a session.
  Unasked, only for a record anchored to the very file in hand.
- Nothing new comes up while you are typing: not a tell, not a question,
  not a receipt. Nothing takes the keyboard by itself.
- Remove, Knew this and Turn Scribe off act on the second press of the same
  key within five seconds; the first only makes the key say so. A digit
  typed alone into an empty prompt box presses a key of the band, so
  answering Claude with "2" can never remove a record.
- Type past what it offers three times in a row and it holds back the next
  offer, then two, then four, up to sixteen. Any key on an offer ends that.

Scribe runs only where you are at the prompt of a terminal or desktop
session inside a git repository, signed in to Fylgja. In a `claude -p` run,
outside a repository or signed out it does nothing at all: no model call,
no call to Fylgja.

Before it asks a model anything in a session, one call of its own has to
get through to Fylgja. If it does not (a rule of yours or your
organization's refuses it), Scribe is off for that session and says so once
on the line under the prompt, until your next prompt:
`Scribe is off in this session: its calls to Fylgja are not let through here`.

### What Scribe costs

Scribe thinks with Sonnet, on your own Claude plan. Claude Code shows no
cost line for these requests, so here is what they are.

- **When a model is asked.** Once at the end of a turn that you started
  with a prompt. Not for a turn a background task or a hook started, not
  for a turn that changed no file and holds under 200 characters of talk
  (its lines are read with the next turn's), and no more than 30 times in
  any hour; past that Scribe is quiet until the hour has rolled on.
- **Usually:** one request per turn of about 2,500 input tokens, of
  which about 2,200 are read from the prompt cache, and
  15 to 320 output tokens, in one to four seconds (measured over the
  scripted sessions in `fylgja/tests/scenarios/RESULTS.md`).
- **At most, per turn:** 4 requests of at most about 31,000 input tokens
  each (123,000 characters: the instruction, up to 24,000 characters of
  plan text, 8 earlier turns in brief, 14,000 characters of this turn, 10
  records, 3 lookups of 4,000 characters each) and 1,500 output tokens
  each: about 123,000 input and 6,000 output tokens. All but the first
  request of a turn read most of that from the prompt cache.
- **At most, per hour:** 30 turns, so 120 requests, about 3.7 million
  input tokens and 180,000 output tokens. That is the computed ceiling of
  a session that hits every limit at once on every turn for an hour.
- **Time:** each request has a limit of 25 seconds and a turn's whole look
  45; no call to Fylgja is waited for longer than 8 seconds. A server that
  never answers ends as a failure, not as a wait.

### Turning Scribe off

- The plugin option **Scribe** (`/config`, or `scribe: false` under this
  plugin's options) turns it off.
- The first thing Scribe ever shows on a machine carries a `What is this`
  key; the line it opens has `Turn Scribe off` (press it twice), which
  holds for this machine from that moment.

Everything else in this README goes on working with Scribe off.

## What it never does

- It adds nothing to what Claude reads, and changes nothing Claude does. No
  context is attached to a prompt or a tool call, no row is added to the
  conversation, no prompt is sent for you, no tool is offered to Claude, no
  agent is started, and no prompt, reply or tool call is rewritten. The one
  change to a prompt is that each chip is put back as the reference you
  pasted. The one way anything from Scribe reaches Claude is you pressing
  `Tell Claude` and then sending what it put in the box.
- It never delays a prompt. Putting the references back needs no network,
  and taking down an offer you typed past needs none either. If either
  fails, the prompt is sent as typed. The lookup for a message's chip is
  started by the message once it is drawn; if Fylgja is slow, unreachable or
  signed out, the chip simply stays as it is.
- Scribe's model never writes. It answers with a verdict; the plugin checks
  it and does the writing. A record over 220 characters is not written, an
  anchor outside the repository is left off, and a record named as replaced
  or worth telling must be one Fylgja really returned in that same look.
- Text from the session, from a plan and from Fylgja is handed to the model
  fenced as data with the instruction that it is never to be followed. A
  record that says "ignore the above" is a record that says so.
- It lets through, without asking you, exactly its own calls of seven
  tools (`recall`, `search`, `open`, `resolve`, `remember`, `amend_memory`,
  `attach_commit`) on the Fylgja server this plugin declares, and never past
  a rule of yours or your organization's that refuses them. Claude's calls
  to the very same tools, and every other tool call, are decided as they
  always were. If you already run that same Fylgja endpoint as a server of
  your own, Claude Code runs the two as one under your name for it, and
  that is then the server meant. A server that only shares the name and
  points somewhere else is never covered.
- Nothing recorded is replaced without your key, and nothing is removed or
  silenced for good on a single press.
- It does not redraw Claude's searches and reads of your knowledge base, open
  a pane, or pop up a notice. A failure anywhere in Scribe is silent and
  leaves the session as it is without it.

Chips, paint, receipts and the band are drawn in the terminal and the Claude
desktop app. Elsewhere nothing is drawn, and Scribe does not run.

## What leaves your machine, and what is kept

- **Sent to Fylgja:** the id of each reference in a message of yours that is
  drawn (one you typed or sent yourself), to look up its title, date and
  visibility for the chip. Nothing else of the message is sent, and a prompt
  handed over by a program (`claude -p`, the SDK) causes no lookup at all. It
  rides the Fylgja connection you signed in to with `/mcp`. While the sign-in
  line is up, Claude Code is asked every few seconds whether Fylgja is
  connected yet.
- **Sent to the model, by Scribe:** at the end of a turn, what happened in
  it: the prompts you sent, Claude's replies, and one line per tool call
  (the tool, the file or the command, whether it worked, and the first 160
  characters of what a shell command printed). No file's contents and no
  other tool output, with one exception: the text of a plan document as
  described above, at most three of them, 12,000 characters each and
  24,000 together. A background task's report, a skill's text and a
  summary after compaction are not your words and are left out. With it go
  the Fylgja records Scribe looked up for that turn. This goes to your
  model provider through Claude Code, on your own Claude plan; how much,
  and how often, is under "What Scribe costs".
- **Sent to Fylgja, by Scribe:** the repository as `owner/name` and the
  paths of the files Claude touched, to look up what is recorded about
  them; at most three lookups a turn that the model asks for, one of them a
  search; the records it writes, each with its sentence, reason,
  alternatives, file anchors, your session's id, and `author: scribe`; your
  answers to its questions; your Fix and Remove; and the sha of a commit
  made in the session.
- **Kept:** what the chips show is held in memory by the running plugin for
  the conversation. It is dropped on `/clear`, on resume, when you have to
  sign in again, and when the session ends. The chip texts shown in the
  prompt box, and the reference behind each, are held in memory too: at
  most 500, the least recently seen dropped first, until the plugin is
  reloaded or the session ends. They outlive `/clear`, so a prompt you
  bring back still carries its references. No prompt text is kept. What
  Scribe read of the session, the plan documents and the records are held
  in memory too and go with the conversation.
- **Kept on this machine, by Scribe:** the ids of at most 500 records you
  marked `Knew this`, two counters for holding back after ignored offers,
  whether Scribe is switched off, and whether it has shown anything yet.
  Ids, numbers and switches; never a word of a prompt, a reply, a file, a
  plan or a record. The plugin writes no file of its own. Scribe writes
  three kinds of line to Claude Code's debug log, each at most once a
  session or an hour and each made of fixed words and a count: that its
  calls were refused, that the hour's share of looks is used up, and that
  Fylgja does not know the repository under this spelling.

## Working on it

The hooks are TypeScript that Claude Code loads as it is; there is no build.

```bash
claude plugin validate ./fylgja --strict
claude plugin test ./fylgja
```

The type check needs the declarations Claude Code writes for a plugin it
loads from a folder: start `claude --plugin-dir ./fylgja` once, which lays
them in `fylgja/.claude-plugin/types/` (ignored by git), then

```bash
npx -p typescript tsc -p fylgja
```

`fylgja/tests/scenarios/` is a separate run, not part of the tests: Scribe
over seventeen scripted sessions with a real model and a stand-in server,
to see how often it is right and how often it speaks when it should not.
`run.sh` spends your Claude plan (about 25 model calls per run);
`RESULTS.md` there is the last run.

### Still to confirm in a live session

The tests drive Scribe against a stand-in for Claude Code, and the scenario
run is headless. What only a signed-in interactive session can show:

1. The band: that each line draws above the prompt in the terminal and in
   the desktop app, wraps sensibly at a narrow width, and that the digit
   keys press (after ctrl+x tab or a click; a bare digit in an empty box).
2. The two-press keys: that a single "2" or "3" typed into an empty box
   only changes what the key says, and that the second press acts.
3. The field for Fix and for a typed reason: that it takes the keyboard
   when its key is pressed, that Enter saves and Esc leaves.
4. Whether the wait at the end of a turn is felt. Scribe works after the
   turn's own end is reported, usually for one to four seconds: check that
   the prompt box takes typing and a sent prompt starts at once meanwhile.
5. The same for the lookup on every fourth step of a long turn, which may
   hold that step for up to a second and a half, and for the first lookup
   of a session, which is waited for up to eight seconds.
6. The permission rule on the live server: that Scribe's own `recall`,
   `remember`, `amend_memory` and `attach_commit` go through with no dialog,
   that Claude's own `remember` still asks as before, and that a deny rule
   of yours for one of these tools still refuses Scribe and turns it off
   with the one line of status.
7. The same where Fylgja is also configured as a server of your own (a
   `fylgja` entry in your settings or `.mcp.json`). Headless, with a
   stand-in over stdio, Claude Code ran the two as one under the person's
   name and Scribe's calls went through; a server of the same name with
   another command stayed apart. Confirm both with the real server over
   HTTP: same URL, calls go through with no dialog; another URL under the
   same name, the plugin's own server is used.
8. Keys pressed in the band: that Fix, Remove and an answer reach Fylgja
   from there. If the engine refuses a call made from a key press, Scribe
   keeps it and makes it at the end of the next turn; check which happens.
9. That a tell appears while Claude is still working, a question only once
   it has finished, and none of them, nor a receipt, while the box has text
   in it.
10. What the conversation's rows hold in an interactive session: that a
    prompt you typed is found again word for word (headless it is), so
    your words are told from a background task's report, and that `Read`,
    `Write` and `ExitPlanMode` carry a plan's text as the tests assume
    (`Read` and `Write` do, headless).
11. `Tell Claude`: that the note lands in the box, unsent, and that a box
    with text is left alone with the notice.
12. What a `/clear` does to the session's id: Scribe reads it again and
    carries the session's question counts over only if it is the same.
