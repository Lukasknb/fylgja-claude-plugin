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
    a title in quotes, and that one Fylgja has confirmed. The message is
    drawn at once with what is known; Fylgja is asked as Claude begins to
    answer, so the confirmed title shows a moment after you send. A
    message that comes back on screen after `/clear`, a resume or a fork
    is asked about when the next turn begins.
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
- A small mark on the line under the prompt, `ᚠ fylgja`, while Fylgja is
  connected through the plugin and signed in as the account this machine is
  set up for. It reads `ᚠ· fylgja is reading` while Scribe looks at the turn
  that just ended, and `ᚠ fylgja · 2 kept` while records Scribe wrote in
  this conversation still stand (it lists the last forty, and counts no
  further). Any other line the plugin puts there is shown in its place.
  The mark only shows: nothing is asked, read or written for it.

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
  or status. A record points only at files the session itself opened, at
  most twelve of them. It is about the repository those files lie in, not
  the folder the session started in: a repository checked out inside
  another, a worktree and a checkout next door are each their own (the
  nearest `.git` above the file decides, and the name is read from that
  repository's `origin`, or is its folder's name). A `.git` that is a
  file naming another folder is followed only into the working tree
  itself, into a submodule's folder under a repository the tree lies in,
  or into a worktree's folder that names this tree back in git's own
  note of it; one that names any other folder on the machine is not
  followed, and the checkout is then named by its folder. A record's files all
  lie in one repository, the one most of them are in; a record without
  files goes to the repository most of the turn's files are in. A turn
  that touched no file itself (you steering, agents doing the work) is
  about the repository the session has been working in: the one most of
  its files so far lie in, or the one it sits in. Only a session that
  sits in no repository and has touched no file of one records nothing.
  A decision is often recorded before the code that carries it out
  exists, and then points at no file. When a later turn of the same
  session touches the files that implement it, Scribe adds them to its
  own record as places, without a receipt (the opened list shows them,
  and a record's view says where a place was added by somebody other
  than its author). A place that is wrong is taken off with Fix on the
  record, or in Fylgja; Scribe adds places and never removes one.
  A commit is the moment for it: at the look after a commit, in the
  main conversation or by an agent the session started, the model is
  given Scribe's own records of the session that still have no place and
  the files changed in that repository since the commit before, and pairs
  them or pairs none; that is asked once per commit. Files an agent of
  the session wrote or changed count as files of the session for this:
  only their paths are taken, never what was written to them and nothing
  the agent said. Whether an agent's commit went through cannot be seen
  from its step, so its commit command is taken as the commit. A record
  that fits no file stays without a place: nothing is guessed.
  A choice you made between options Claude put to you is recorded with
  the options you turned down as its alternatives, when it is a decision
  by the same bar as any other: which of two designs, not which task
  first, whether to go ahead, or how to be told about progress. Such
  records do not count against the three a turn may write, up to four
  more, and you are never asked why about one. What is yours in such an
  answer is the label you picked, or what you typed instead of picking
  one; an answer counts as an option only when it is that option's exact
  label. What Claude said an option means is Claude's text: a reason
  taken from it is recorded with the mark "offered by the assistant,
  chosen by the developer", and never as your own words. That holds
  for a reason Scribe's model words itself, too: in a turn where you
  answered a question of Claude's, a reason of which a third or more of
  the words stand in what Claude wrote there, and fewer in what you
  typed, carries that mark.
  A tool call you turned down counts as yours only when its result is
  the engine's own for a rejection: it opens with the engine's sentence,
  and what the transcript stored beside it is the engine's text for one.
  What you said then is your correction. A command that failed and
  printed that sentence is a failed command, and nothing a tool of an
  MCP server returns is ever taken for your words.
  When a later turn of the same session changes a decision Scribe already
  recorded, Scribe rewrites its own record (`✓ Updated · …`) or takes it
  back (`✓ Withdrawn · …`) without asking: it is its own record, minutes
  old. `Withdrawn` has a key, `1 Put back` (press it twice), which sends
  the record again, whole, with its reason, what was ruled out and its
  places, so that Fylgja restores it. Its own means written by
  Scribe as new in this session: a record that came back from having
  been removed is not. And once you have touched a record with a key
  (Fix, an answer to why, an answer about replacing, Put back, Remove),
  it is yours: Scribe does not rewrite it, take it back or add places to
  it again in that session. A record from another session or another
  person is never touched that way; that is what the question below is
  for. Fylgja takes a record only in a certain form (one
  sentence, worded as a rule) and refuses rather than trims, saying why.
  When it refuses one for its form, Scribe hands its model that record and
  the refusal once (the refusal names what it matched, a word, a phrase
  or a length, whatever the rule, and may show how the sentence could
  open), takes only the part the refusal was about
  from the answer, so a reworded sentence brings no new reason with it, and sends
  it once more. Refused again, the record is let go. Then one line:

  `✓ Recorded · Use Postgres advisory locks for the job queue, not Redis.   1 Fix  2 Remove  0 OK`

  Fix opens the sentence in a field. Remove takes the record away again.
  A change Fylgja turns down is said in one line (`Not saved: another
  record already says this.`) and not tried again; one it could not make
  for trouble of its own is tried once more after the next turn. A decision a teammate
  has already recorded is theirs to change: the line then reads `Already
  recorded by someone else` and offers neither Fix nor Remove.
  Several records from one turn are one line, `✓ Recorded 3   1 Review`. A
  record you had removed and that is written again says `Restored`. The
  line goes by itself after twenty seconds, or when you send your next
  prompt. It never waits for you.
- **It asks why**, when a decision that matters came without a reason:

  `? Why: Use a sessions table, not signed cookies.   1 Sessions must be revocable  2 To list a user's devices  3 Other  4 No particular reason  0 Skip`

  Pick one (press its key twice), type your own, or say there was none.
  Then one line says the reason was saved, with Fix and Remove like any
  record's. "No particular reason" is
  an answer and is kept as one, in your words if you typed some ("no idea,
  it just worked"): a later reader sees that nothing in particular decided
  it, which is not the same as nobody having asked. A typed answer counts
  as "no reason" only when that is all it says; "none of the others
  support ESM" is a reason. When you say it unasked, in so many words
  ("no particular reason", "just because"), and the turn holds one
  decision, that decision is recorded the same way and nobody looks for
  a reason or asks. Skip saves nothing. It asks only for a
  reason you have not given. Before a question is put, and for every
  decision that came without a reason whether or not a question is due,
  one more small request looks for the reason in everything you wrote in
  the session and in the plan documents, and may answer only with your
  own words, quoted, or "absent". A quote is taken only if it stands in
  what you wrote, or in a plan, word for word; then the decision is
  recorded with that reason and you are not asked; a reason quoted from
  a plan says so, "(per <the plan's title>)". Only on "absent" is
  the question put. The request is held to about 40,000 characters:
  everything you wrote comes first and whole, then what Claude said the
  options mean that you picked, then what Claude said about
  this very decision, then only those sections of the plan documents that
  mention the decision's words, each cut to a length and marked. A quote
  is completed to the whole sentences it touches, so that a reason never begins or ends mid-sentence. A quote
  that only says the decision again is not a reason and is not taken:
  that is one with seven tenths of its words being the decision's own,
  or holding half of the decision's words, or with nothing left once the
  words of the question and of the options offered are set aside. The same request is shown what
  Claude wrote in the turn and the one before: when Claude gave the
  reason for something it proposed and you accepted it without
  objecting, that is recorded as the reason, marked "proposed by the
  assistant, accepted by the developer". Accepted is not the model's
  word alone: you must have written or chosen something after Claude
  wrote it. Where you have not, the decision is recorded without a
  reason, and Claude's reason is the first answer offered if you are
  asked. And a question is only for a
  decision that concerns code in hand or ruled something out; a decision
  with neither is recorded and nobody is asked. When the reason turns up
  in a later turn, the question goes and the record is given the reason.
- **It asks before anything is replaced.** Before a new decision is
  written, Fylgja is asked once what it already holds on the decision's
  subject (by the decision's own words, not only by the files in hand),
  and when something comes back one small request says whether the new
  decision goes against it, refines it or has nothing to do with it. So a
  decision you make in conversation, before any file is touched, is still
  held against what was recorded. When a new decision goes against
  a recorded one, the new one is not written until you have said which it
  is: `1 Yes, it replaces it  2 No, tell Claude  3 Different case  0 Skip`.
  Only the first key makes it the replacement, and the receipt then names
  what it replaced. Left unanswered, the new decision is recorded without
  replacing the old one: both stand, and the receipt of the new one says
  `may contradict an earlier decision` with the start of the earlier
  record's id. Fylgja's own linker may later propose the replacement for
  review in Fylgja; the plugin does nothing more about it.
- **It tells.** When Claude reads or changes a file that a recorded decision
  or gotcha is anchored to:

  `◆ Decision · Use the queue for outbound mail, never a direct SMTP call. · 2026-09-12   1 Open  2 Tell Claude  3 Knew this  0 Dismiss`

  Open opens the record inside the band and goes nowhere else: the
  reason, what was rejected, where (a place another member than the
  record's author added says so), who wrote it down (Scribe, Claude or a
  person) and the account it is in. A record written down in a session,
  which is every record Scribe or Claude makes, has no page in the Fylgja
  app, so there is no link to follow. Only a record read out of a meeting
  or a session carries one, and then one more row, `Open where it came
  from`, leads to that meeting or session. Tell Claude puts a quoted note
  in your prompt box for you to send or not: the record's sentence, its
  reason, and `Fylgja record 1a2b3c4d` with who wrote it down, so Claude
  can open it by that id; the link follows only where the record has one.
  It sends nothing, and leaves a box with text in it alone. Knew this
  keeps that record away on this machine for good.
- **It reads the plan.** If the session works from a plan (plan mode's own,
  or a markdown file that calls itself a plan, a design, a spec, an RFC, an
  ADR or a work package), that is where Scribe looks first for the reason.
  A decision whose reason is in the plan is recorded with that reason and
  names the plan; you are not asked. A plan in the repository becomes one
  of the record's anchors. A plan outside it will be gone for a later
  reader, so its reasoning is copied into the record.
- **It notes the commit.** After a `git commit` in this repository, the
  commit is attached to what the session recorded, Claude's own records
  included. Only a commit the command itself shows to be this repository's:
  a plain `git commit`, or one that names this repository's root. One made
  after `cd` into another folder or with `git -C` elsewhere is not, since
  a folder inside the tree may be a repository of its own.

What Scribe writes to Fylgja without a key of yours, all of it: a new
record; a rewrite or a withdrawal of a record it wrote as new in this
session and you have not touched; places added to such a record; and
the session's commit attached to the session's records. Everything else
(a replacement of a recorded decision, a reason, a fix, a removal,
putting a record back) is written on your key, pressed twice.

Staying out of the way is the point, and the limits are in the code:

- A question is only ever about a decision, never one whose reason the
  session or the plan gives, never twice about the same one, at most one
  when a turn ends, at most four in a session, and none at all once two
  went unanswered. It shows only when Claude has finished.
- What is recorded about a file is asked only of the session's own
  repository and of repositories in which the session, or an agent of
  it, wrote or changed a file. One it only reads in (a clone of
  somebody's plugin, another checkout) is not asked about.
- Finding out which repository a step's files lie in reads the disk and
  holds a step for at most 0.4 seconds; past that the files count as in
  no repository for that step, and what is found out is kept per folder
  for the session.
- At most one tell per turn, never the same record twice in a session.
  From the lookup by path alone, only a record anchored to the very file
  in hand. A record anchored to a folder above it is shown only when
  Scribe's model, reading the turn, judged that it bears on the work; it
  still counts as the turn's one tell.
- Nothing new comes up while you are typing: not a tell, not a question,
  not a receipt. Nothing takes the keyboard by itself.
- Every key that writes to Fylgja or settles something for good acts on
  the second press of the same key within five seconds: Remove, Knew this,
  Turn Scribe off, "Yes, it replaces it", Put back, a proposed reason and
  "No particular reason". The first press only makes the key say so. A digit
  typed alone into an empty prompt box presses a key of the band, and a
  question comes up just when you may be answering Claude with "1": so no
  single press ever writes, replaces, removes or silences. Keys that only
  open, skip, dismiss or fill the prompt box act at once.
- Type past what it offers three times in a row and it holds back the next
  offer, then two, then four, up to sixteen. Any key on an offer ends that.

Scribe runs only where you are at the prompt of a terminal or desktop
session, signed in to Fylgja. In a `claude -p` run or signed out it does
nothing at all: no model call, no call to Fylgja.

A session need not start inside a git repository. Started in a folder
that is none (one that holds several checkouts, say), these rules hold:

- Nothing is recorded, and no model is asked, before the session has
  touched a file of some repository. From then on a turn that touches no
  file is about the repository most of the session's files lie in.
- A record is filed under the repository its files lie in, as everywhere.
- Who is signed in is asked, and the account pinned or checked, when the
  session starts, as everywhere. That does not wait for a repository.
- The `.mcp.json` files from the start folder upward are checked when
  the session starts, and again when it moves (`cd`) into another
  folder. Claude Code loads no `.mcp.json` from a folder below the one
  the session is in, so a repository the session only reaches into
  cannot swap the connection (checked on Claude Code 2.1.296: an entry
  for Fylgja's address in a checkout below the start folder was not
  loaded). Scribe looks at it all the same: before anything about a
  repository other than the session's own is sent, the `.mcp.json` files
  from that repository's root upward are read, and a repository whose
  own configuration holds an entry that could stand in for the plugin's
  server is left alone, as if its files lay in no repository.

Before it asks a model anything in a session, one call of its own has to
get through to Fylgja. That first call is waited for up to eight seconds;
if it got no answer, the next turns try again and wait a second and a half
at most. If any call of Scribe's is refused (a rule of yours or your
organization's denies one of its tools), Scribe is off for that session and
says so once on the line under the prompt, until your next prompt:
`Scribe is off in this session: its calls to Fylgja are not let through here`.

**If Fylgja is also set up outside the plugin.** The plugin works only
through the connection it declares itself. If the same Fylgja address is
also configured anywhere else, Claude Code runs the two as one under that
other entry, with that entry's sign-in or token; and an entry that takes the
plugin's own connection name is answered as if it were the plugin's. A
repository you cloned could ship either in its `.mcp.json`, with a token
for somebody else's account, and what Scribe wrote would land there. Claude
Code does not say where a connection came from, so the plugin looks for
itself, before it trusts any answer:

- When a session starts, starts over (`/clear`, resume, fork) or moves to
  another directory, it reads every `.mcp.json` from the working directory
  up to the top of the file system: the files Claude Code loads project
  servers from. If one holds an entry that names Fylgja's host (any scheme,
  port or path, as a URL or inside a command), or an entry whose name is,
  holds, or starts like the plugin's connection name (`plugin…`), the
  project does not leave Fylgja to the plugin. A file that is there and
  cannot be read or parsed counts the same.
- And the connection Claude Code answers must be the plugin's own by name,
  `plugin:fylgja:fylgja`.

If either fails, the plugin stays out altogether for the session: Scribe
does not run (no call to Fylgja, no model call), no pasted reference is
looked up, Fylgja is not even asked whether it is connected, and one line
under the prompt says so until your next prompt:
`Fylgja is also set up outside the plugin here, so the plugin stays out: it only works through the connection it declares itself`.
Claude can still use the Fylgja tools of that other entry, as you set it
up. To use Scribe and the chips, remove the other entry and let the plugin
provide Fylgja.

What this does not close, because nothing inside a plugin can:

- **A second plugin that is also named `fylgja`.** Claude Code then has two
  plugins under one name, and which one's server answers is its choice.
  Install this plugin from its own marketplace only.
- **Entries in your own user-level configuration.** They are yours to
  trust. An entry of your own at Fylgja's address under another name is
  caught by the name check and the plugin stays out; one you named
  `plugin:fylgja:fylgja` yourself is taken for the plugin's.
- **The first account.** The plugin holds the connection to the first
  account it ever sees on a machine (below). It has no way to know that
  this first one is the right one.

### The account this machine is set up for

The first time the plugin connects to Fylgja on a machine it asks who is
signed in (`whoami`) and keeps the ids of that user, team and profile: the
pin. Names are not kept; they are asked for again and held in memory, to
show.

From then on, when a session starts and after `/clear`, a resume, a fork
or a new sign-in, the plugin asks who is signed in before it asks Fylgja
anything else. The start of a session waits a moment for the answer (a
second and a half at most) and then goes on without it. While the answer is the pinned account, nothing changes, and
Scribe's first line (`What is this`) and the opened list of what it
recorded say where records go: `Recorded to Acme as Ada Lovelace, profile
Work`.

If another user, team or profile answers (you signed in as someone else,
or something configured a token of its own), the plugin stays out
altogether for the session: no lookup, no record, no model call. One line
under the prompt names who is signed in, and a line above the prompt
offers to accept it:

`? Fylgja is signed in as another account than this machine is set up for. Now: Eve (Rival) #0a4f2c · before: Ada Lovelace (Acme) #7b4f19   1 Use this account from now on   0 Not now`

The six characters after `#` are the ends of the account's user, team and
profile ids, so two accounts under the same name can be told apart; a
name Fylgja sends is shown as plain text, cut short, and cannot carry a
`#` or brackets of its own. Accepting takes two presses of `1`. It
replaces the pin, and the plugin works for that account from then on.
`Not now` puts the question away until the next session; signing in as
the pinned account with `/mcp` ends it too.

This line is a notice about where your records would go, so it shows
even while you are typing. It takes no key then: while the prompt box
holds text the line has no keys at all and says `empty the prompt box to
answer`, and a digit you type is your text.

If Fylgja does not say who is signed in (the call fails, takes more than
eight seconds, or the server has no `whoami` yet), the plugin stays out
with
`Fylgja did not say which account is signed in, so the plugin stays out for now`.
That is not kept as an answer: the plugin asks again as the next turn
begins and at its end, calls nothing else until it knows, and takes the
line down and works as ever once the pinned account answers.

### What Scribe costs

Scribe thinks with Sonnet, on your own Claude plan. Claude Code shows no
cost line for these requests, so here is what they are.

- **When a model is asked.** Once at the end of a turn that you started
  with a prompt, or in which you decided something without typing one:
  you answered a question Claude put to you, approved a plan, or turned a
  plan or an action down with a word. Not for a turn a background task or
  a hook started in which you did none of that, not
  for a turn that changed no file and holds under 200 characters of talk
  (its lines are read with the next turn's), and no more than 30 times in
  any hour; past that Scribe is quiet until the hour has rolled on. A
  request that puts a refused record right outside such a look (after a
  key of yours wrote the record, or for a record that waited a turn)
  counts as one of the 30 by itself, and is not made once they are used
  up. The count is kept by each running Claude Code, so two sessions open
  at once have 30 each.
- **Usually:** one request per look of about 9,000 to 18,000 input
  tokens, half to two thirds of them read from the prompt cache, and 130
  to 350 output tokens, in one and a half to two and a half seconds
  (measured by replaying recorded working sessions; the short scripted
  sessions in `fylgja/tests/scenarios/RESULTS.md` come to about 2,500,
  which real sessions do not). The look for a reason is a request of up
  to about 33,000 characters as measured, 40,000 at most. In an hour of
  real work the replays made 5 to 7 requests, 55,000 to 125,000 input
  tokens.
- **Beside the look itself,** a turn may spend up to three small
  requests out of the same four: one to look for a decision's reason in
  what you wrote, one to say whether a new decision goes against a
  recorded one (only when Fylgja holds something on its subject), and
  one to put right a record the server refused.
- **At most, per turn:** 4 requests of at most about 31,000 input tokens
  each (123,000 characters: the instruction, up to 24,000 characters of
  plan text, 4 earlier turns in brief, 14,000 characters of this turn, 10
  records, 3 lookups of 4,000 characters each) and 1,500 output tokens
  each: about 123,000 input and 6,000 output tokens. All but the first
  request of a turn read most of that from the prompt cache. A refused
  record that is put right inside the look uses one of those 4, and so
  does the request that looks for a decision's reason in what you wrote
  (up to about 11,000 input tokens: 40,000 characters of your prompts,
  the picked options, Claude's proposal and the plan sections that
  mention the decision, and its instruction), the one that compares a
  decision with what is recorded (up to five records, about 2,000 input
  tokens) and the one that puts a refused record right (under 1,000).
  So the worst turn is four full looks, not a look and three small
  requests. On top of
  the 4, the end of a turn may put right up to 10 records that waited
  from earlier turns, and each key of yours that writes a record may do
  it once: one small request each (the record and the refusal, under
  1,000 input tokens, at most 700 output tokens).
- **At most, per hour:** 30 looks, a small request of the kind above
  counting as a look, so 120 requests, about 3.7 million input tokens and
  180,000 output tokens, the look for a reason, the comparison and the
  correction included: each is one of a look's four. That is the computed ceiling of
  a session that hits every limit at once on every turn for an hour.
- **Time:** each request has a limit of 25 seconds and a turn's whole look
  45; no call to Fylgja is waited for longer than 8 seconds. A server that
  never answers ends as a failure, not as a wait.

### What the replays showed, and where Scribe is weak

Scribe was replayed over recorded working sessions of the plugin's
author, against a stand-in knowledge base, with nobody at the keys.

- Of 129 records judged in the last three rounds, 115 were worth
  keeping, 13 trivial, 1 a near-duplicate; none was wrong and none was
  filed under the wrong repository. About one look in three wrote
  something.
- Everything was measured with nobody at the keys: every question went
  unanswered and no receipt was seen. How the band feels is not
  measured; the list at the end of this README is what a person has to
  check.
- The knowledge base started empty. Finding a recorded decision that a
  new one goes against was seen on three planted records, not on a
  base with thousands.
- A decision made while steering agents has no file yet. In the last
  round 7 of 12 such records gained their files later and all 7
  pairings were right; 5 stayed without a place and are found by their
  words only.
- An agent's commit is read from its command; Scribe runs no git, so
  "the commit's files" are the files changed since the commit before.
  What an agent decided on its own is not seen at all: only the paths
  it changed are.
- Six of seven looks for a reason found none, at 21,000 to 33,000
  characters each: the dearest request there is, for little.
- A one-off operation chosen from options (how one incident was
  recovered) is still sometimes recorded as a decision.
- Two runs over the same session agree on most records, not on all.
- A reason is marked as Claude's by counting shared words; one that
  restates an option in entirely other words carries no mark.
- A tool call you turned down is recognised by the engine's own text,
  which Claude Code may change; the plugin is given no other sign of it.
- Whether Fylgja takes a sentence is Fylgja's rule, which changed five
  times during this work. A record it refuses twice is lost, quietly.

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
  it and does the writing. A sentence over 220 characters is refused by
  Fylgja and handed back once to be shortened, one over 1,000 is not
  sent at all, an
  anchor outside the repository is left off, and a record named as replaced
  or worth telling must be one Fylgja really returned in that same look.
- Text from the session, from a plan and from Fylgja is handed to the model
  fenced as data with the instruction that it is never to be followed. A
  record that says "ignore the above" is a record that says so.
- It lets through, without asking you, exactly its own calls of eight
  tools (`whoami`, `recall`, `search`, `open`, `resolve`, `remember`,
  `amend_memory`, `attach_commit`) on the Fylgja server this plugin declares, and never past
  a rule of yours or your organization's that refuses them. Claude's calls
  to the very same tools, and every other tool call, are decided as they
  always were. Only the plugin's own connection (`plugin:fylgja:fylgja`)
  counts: the same address configured anywhere else is never covered, and
  Scribe does not run on it.
- Nothing is written, replaced, removed or silenced for good on a single
  press of a key.
- It does not redraw Claude's searches and reads of your knowledge base, open
  a pane, or pop up a notice. A failure anywhere in Scribe is silent and
  leaves the session as it is without it.

Chips, paint, receipts and the band are drawn in the terminal and the Claude
desktop app. Elsewhere nothing is drawn, and Scribe does not run.

## What leaves your machine, and what is kept

- **Only through the plugin's own connection.** Everything below goes to
  Fylgja through the connection this plugin declares
  (`plugin:fylgja:fylgja` in `/mcp`), and through no other. If the same
  Fylgja address is also set up outside the plugin, in your settings or in
  a `.mcp.json` of the repository you are in, Claude Code runs the two as
  one under that other entry and with its sign-in or token, which a cloned
  repository can set to somebody else's account. To find that out the
  plugin reads the `.mcp.json` files from the working directory upward,
  and its own, when a session starts; nothing of them is sent anywhere or
  kept. Where such an entry is found, or the connection is not the
  plugin's own by name, the plugin sends nothing at all: no reference is
  looked up (its chip stays `[◉ meeting · 45ada8aa]`), Scribe does not
  run, and one line under the prompt says so until your next prompt.
- **Sent to Fylgja:** the id of each reference in a message of yours that is
  drawn (one you typed or sent yourself), to look up its title, date and
  visibility for the chip. Nothing else of the message is sent, and a prompt
  handed over by a program (`claude -p`, the SDK) causes no lookup at all. It
  rides the Fylgja connection you signed in to with `/mcp`. While the sign-in
  line is up, Claude Code is asked every few seconds whether Fylgja is
  connected yet; that asks Claude Code and sends nothing to Fylgja.
- **When Fylgja is called.** Only from a moment Claude Code itself waits
  on the plugin: the start of a session, each step of a turn, a turn's
  end, and a key or a line of yours in the band. Never from a message
  being drawn, from typing, from sending a prompt, or from a timer. What
  a drawn message wants looked up waits for the next such moment, and
  none of them holds your prompt: the start of a session and a step wait
  a second and a half at most.
- **Sent to the model, by Scribe:** at the end of a turn, what happened in
  it: the prompts you sent, your answers to questions Claude put to you
  (the question, the options offered with what each was said to mean,
  and the one you chose), what you said when you turned a plan or an
  action down, Claude's replies, and one line per tool call
  (the tool, the file or the command, whether it worked; of what a shell
  command printed, the first 160 characters when it failed or made a
  commit, and nothing otherwise). Files read one after the other are one
  line, and Claude's own bookkeeping calls (its to-do list, its waiting
  on background tasks) are left out. Earlier turns of the session are
  sent again in brief, as what you and Claude said, at most four of them;
  a plan document nobody has read or changed for five looks is sent as
  its headings only. Scribe also keeps, in memory, up to twenty short
  sentences of reasons and constraints you stated in the session, and
  sends them along. And it keeps, in memory and for the session, the
  prompts you sent themselves and the labels of the options you picked,
  up to 30,000 characters of them, and beside them what Claude said the
  last twelve picked options mean (the oldest go first; a background task's report is
  never among them): they are sent, with the plan documents and one
  sentence of a decision, in the small request that looks for a reason
  you already gave before you are asked for it. No file's contents and no
  other tool output, with one exception: the text of a plan document as
  described above, at most three of them, 12,000 characters each and
  24,000 together. A background task's report, a skill's text and a
  summary after compaction are not your words and are left out. When a
  turn is too long, tool lines are dropped first, then Claude's oldest
  replies; what you wrote or chose is never what is dropped. With it go
  the Fylgja records Scribe looked up for that turn. This goes to your
  model provider through Claude Code, on your own Claude plan; how much,
  and how often, is under "What Scribe costs".
- **Asked of Fylgja first:** who is signed in (`whoami`), when a session
  starts and after each `/clear`, resume, fork or new sign-in, and again
  at each step and end of a turn for as long as no answer has come.
  Nothing is sent with the question.
- **Sent to Fylgja, by Scribe:** the repository as `owner/name` and the
  paths of the files Claude touched, to look up what is recorded about
  them (the session's own repository and each one it changed a file in
  is asked about its own files; to name a
  repository the plugin reads the `config` git keeps for it, on this
  machine, and takes the owner and name from its `origin`); at most three lookups a turn that the model asks for, one of them a
  search; for a new decision, its sentence (300 characters at most), to
  find what is already recorded on its subject; the records it writes, each with its sentence, reason,
  alternatives, file anchors, your session's id, and `author: scribe`; your
  answers to its questions; your Fix, Remove and Put back; and the sha of a commit
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
- **Kept on this machine:** the pin, under `fylgja.account`: the ids of
  the user, the team and the profile of the account this machine is set
  up for. Three ids, no name, no token.
- **Kept on this machine, by Scribe:** the ids of at most 500 records you
  marked `Knew this`, two counters for holding back after ignored offers,
  whether Scribe is switched off, and whether it has shown anything yet.
  Ids, numbers and switches; never a word of a prompt, a reply, a file, a
  plan or a record. The plugin writes no file of its own. Scribe writes
  five kinds of line to Claude Code's debug log, each at most once a
  session or an hour and each made of fixed words and a count: that its
  calls were refused, that the hour's share of looks is used up, that
  Fylgja does not know the repository under this spelling, that a record
  was not written because the session has touched no file of any
  repository, and that a prompt was sent which no row of the
  conversation holds.

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
`RESULTS.md` there holds the runs, each with the commit it belongs to.
Eleven further sessions (`SCRIBE_SET=heldout`): ten were written after
the prompt was first final and held out from shaping it, and one was
added later for a single path. The prompt has changed since, so they
are a regression check now and no longer a held-out measurement.
`live-run.sh` puts one real headless turn through the plugin's own hooks
against the stand-in, to read from the debug log that every call to
Fylgja was let through.

`replay.sh <transcript.jsonl> --out <dir>` puts one of your own recorded
sessions (the files Claude Code keeps under `~/.claude/projects/`)
through Scribe turn by turn and writes what Scribe would have done: a
timeline, the records, questions and tells, and what it cost. The
recording is only read, the knowledge base is the stand-in, and
everything written goes into `<dir>`, which must lie outside the
repository. Claude Code cannot be handed rows it did not produce, so the
replay drives Scribe's own modules in the order the plugin's hooks do;
the hook wiring, the account check and the chips are not part of it.
`--dry` asks no model and shows how the session is cut into wakes;
without it the run spends your plan, at most `--max-calls` (120) model
calls and `--max-wakes` (40) wakes.

### Still to confirm in a live session

The tests drive Scribe against a stand-in for Claude Code, and the scenario
run is headless. What only a signed-in interactive session can show, in
the order to do it: first what everything else rests on, then what you
see in ordinary work, and last what needs your setup changed.

1. Deploy the server before this plugin. On a server that has no
   `whoami` the whole plugin stays out, and Put back needs the server to
   restore a removed record that is sent again.
2. The name of the plugin's connection in an installed copy. Type `/mcp`
   in a session with the plugin installed from the marketplace (not
   `--plugin-dir`) and read the name Fylgja is listed under. It must be
   exactly `plugin:fylgja:fylgja`. Under any other form the plugin takes
   its own connection for an outside one: no chip is looked up, Scribe
   never runs, and the line about Fylgja being set up outside the plugin
   shows. `OWN_SERVER` in `fylgja/hooks/scribe/grant.ts` is the one
   place to change.
3. Sign-in and the pin: start a session signed in to Fylgja and check
   that Scribe's first line (`What is this`) names your account. Send a
   prompt with a pasted reference and check that its chip shows the
   confirmed title while Claude is still answering, with no permission
   dialog.
4. The debug log of that session (`claude --debug`): no `tool.check
   skipped: re-entry` and no `denied` for a `mcp__plugin_fylgja_fylgja__`
   tool. Scribe's own `whoami`, `recall`, `remember`, `amend_memory` and
   `attach_commit` go through with no dialog, and Claude's own
   `remember` still asks as before.
5. The band: that each line draws above the prompt in the terminal and
   in the desktop app, wraps sensibly at a narrow width, and that the
   digit keys press (after ctrl+x tab or a click; a bare digit in an
   empty box).
6. The two-press keys: that a single "2" or "3" typed into an empty box
   only changes what the key says, and that the second press acts.
7. The field for Fix and for a typed reason: that it takes the keyboard
   when its key is pressed, that Enter saves and Esc leaves.
8. Keys pressed in the band: that Fix, Remove, Put back and an answer
   reach Fylgja from there with no dialog. If the engine refuses a call
   made from a key press, Scribe takes that as a refusal like any other
   and is off for the session; if it only fails, the change is made at
   the end of the next turn. Check that neither happens in ordinary use.
9. That a tell appears while Claude is still working, a question only
   once it has finished, and none of them, nor a receipt, while the box
   has text in it.
10. Whether the wait at the end of a turn is felt. Scribe works after
    the turn's own end is reported, for a few seconds: check that the
    prompt box takes typing and a sent prompt starts at once meanwhile.
    The same for the lookup on every fourth step of a long turn, which
    may hold that step for up to a second and a half, and for the first
    lookup of a session, which is waited for up to eight seconds, once.
11. What the conversation's rows hold in an interactive session: that a
    prompt you typed is found again word for word (headless it is), so
    your words are told from a background task's report; that `Read`,
    `Write` and `ExitPlanMode` carry a plan's text as the tests assume
    (`Read` and `Write` do, headless); that an answer to a question of
    Claude's comes back as `"<question>"="<answer>"`; and that a tool
    call you turn down, with and without a word, is read as that (its
    result opens with "The user doesn't want to proceed with this tool
    use", and the row stores "User rejected tool use").
12. Agents: have an agent change a file and commit. A decision recorded
    before that should gain the file as a place at the next look (open
    the receipt's list), which shows that an agent's steps reach the
    plugin.
13. `Tell Claude`: that the note lands in the box, unsent, and that a box
    with text is left alone with the notice.
14. A record with no link, which is the usual case: a record Scribe or
    Claude wrote comes back from `recall` with `link` null. Check that
    `Open` shows it inside the band with who wrote it down and the
    account, that no link row is drawn, and that the `Tell Claude` note
    carries the sentence and `Fylgja record <first eight of its id>` and
    no link. Then a record read out of a meeting: that `Open where it
    came from` is there and opens that meeting in the Fylgja app.
15. A refused record: word a decision so that Fylgja refuses its sentence
    (`refused:not_imperative`, naming the opening word) and check that
    one more model call puts it right, that the receipt shows the
    sentence as written, and that a question, if one was due, is about
    that sentence. Every refusal of the live server opens with
    `refused:<code>` and names what it matched; Scribe reads the code
    and never shows the server's words. Check `atom_content_taken` on a
    Fix (the line says another record already says this) and `not_found`
    on a Remove of a record that is gone.
16. Withdrawn and Put back: change your mind about a decision Scribe
    recorded in the session so that it takes the record back, press
    `Put back` twice, and check in Fylgja that the record is there again
    with its reason, its alternatives and its places.
17. What a `/clear` does to the session's id: Scribe reads it again and
    carries the session's question counts over only if it is the same.
18. A deny rule of yours for any one of Scribe's tools: it must refuse
    Scribe and turn it off with the one line of status.
19. Another account: sign in as another account with `/mcp`, start a new
    session, and check the line under the prompt, the line above it,
    that it offers no key while the box holds text, that nothing is
    looked up or recorded, and that two presses of `1` accept the new
    account.
20. Fylgja configured both ways: add an entry with the same address to
    your settings or to a repository's `.mcp.json`, under any name, and
    once under the name `plugin:fylgja:fylgja`. The plugin must stay out
    with its one line of status, and nothing of it must reach that
    entry's account: no lookup of a pasted reference, no lookup or
    record of Scribe's. (Headless, with a stand-in over stdio, Claude
    Code answered the other entry's name and Scribe made no call.) With
    another address under the name `fylgja`, the plugin's own server is
    used and Scribe runs.
21. The mark: that `ᚠ fylgja` stands under the prompt once the session
    has started, that the rune draws in your terminal's font and in the
    desktop app, that it reads `ᚠ· fylgja is reading` for the seconds
    after a turn ends and never longer, that the count follows a record,
    a Remove and a Put back, and that it is gone under 19 and 20. The
    line takes plain text, so how dim it is drawn is Claude Code's.
