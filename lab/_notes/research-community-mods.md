# Community Claude Code mods — survey, 2026-10-06

## 0. Read this first

**The premise "weeks old, expect few or none" is wrong.** Volume is large:

- One community index (`ryx2/slopshopper`, scraped today 14:50 UTC) lists **3,032 community mods in about 1,600 repos** (plus 4 Anthropic built-ins and 3 samples). I cloned that index and worked from it.
- Timeline as far as I could establish it: function hooks were in early access from mid-September (oldest dedicated mod repos are dated 2026-09-13..15 and their READMEs say "needs function hooks (early access)" / `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`). Third-party articles put the public launch at 2026-10-01 with v2.1.287; I did not confirm that date from an Anthropic source. Mod update dates in the index: about 10-20 per day through September, then 324 / 515 / 559 / 648 / 704 on Oct 2-6.
- Quality is very uneven. Most repos have 0-5 stars, were created Oct 2-5, and read as generated in one sitting (same README shape, same description voice, many near-duplicates: usage bars, context bars, pixel pets, image previews, risky-command guards). A small number are deep.

**How things were verified**

- "CONFIRMED" below = I read the mod's hooks module source. The source I read is slopshopper's scraped copy (`data/mods/<slug>.json`, today's snapshot), not a fresh fetch per repo. The scraper only admits a `hooks/hooks.json` with a `modules` array, and I saw that file in each copy I opened.
- For 28 repos I also checked the live repo with `gh api` (existence, stars, push date). For thimble, mr-banner and claude-image-view I fetched test files live from GitHub.
- The "hooks" and "`$` calls" lists come from slopshopper's stored `claude plugin validate --json` output for each mod, cross-checked against the source where I quote code.
- Nothing was executed or installed. Screenshot/GIF links are taken from READMEs; I did not open the images.
- Star counts on mods that live inside a larger repo (ruflo 73k, claude-code-templates 32k, repowise 7k, terminal-browser 3.7k, nixos-config 51) are the host repo's stars, not the mod's.

**What I searched**

- `gh search code` for: `"export function register(on"`, `"export async function register(on"`, `"$.ui.resolve(e)"`, `"on('ui.render'"`, `"on(\"ui.render\""`, `"$.ui.invalidate"`, `"$.command.register"`, `"$.ui.status"`, `"on('tool.call'"`, `"on('prompt.edit'"`, `"on('prompt.submit'"`, `"from 'claude-code/testing'"`. Code search itself returned almost only the two aggregators' JSON (GitHub code search indexes few new repos), which is how the aggregators surfaced.
- `gh search repos`: "claude code mods" by stars; topic `claude-code-mods`.
- WebSearch (extended) twice: community examples / awesome lists; launch threads.
- Not done: the other repo-search phrasings in the brief ("cc-mod", "claude-code-mod", "claude code hooks module"), Reddit/HN thread reading, per-repo fresh source fetches. The index made them low-yield; say so if they matter.

**Aggregators (use these instead of searching)**

| Aggregator | What it is |
|-|-|
| https://github.com/ryx2/slopshopper (site slopshopper.com) | Daily GitHub scrape, stores each mod's source, validate output and a sandboxed-replay preview. 3,039 entries. Best raw dataset. 0 stars. |
| https://github.com/karanb192/awesome-claude-code-mods | "Community catalogue of public Claude Code mods, scanned from GitHub". 231 stars, created 2026-09-15. Not read in detail. |
| https://github.com/SeongGwangJu/k-mods | Korean-curated, commit-pinned registry with per-mod audit JSON. 1 star. |
| https://github.com/baselane-sh/mods-catalog, https://github.com/wh000wh000/awesome-claude-mods, https://github.com/whyashthakker/awesome-claude-code-mods | Smaller catalogues (7-9 stars). Seen in search only. |

**Anthropic baseline (excluded from "community")**: `anthropics/claude-code-playground/claude-code/mods` (token-weather, blast-radius, replay-theater) and `anthropics/claude-code/mods` (diff, agents-md, sec-default, telemetry). The index also shows `anthropics/claude-plugins-official` shipping a `code-modernization` mod (Raster map, Input, Select), which is the largest first-party example I saw and is copied verbatim in at least two community repos.

**Corpus statistics (3,039 indexed mods, from stored validate output and a regex pass over sources)**

| Thing | Mods using it |
|-|-|
| `ui.render` AbovePrompt / Pane | 1,276 / 1,273 |
| PromptHint / Spinner / AssistantMessage / ToolUse / UserMessage / SessionMode / ToolResult / CommandOutput / ToolGroup | 186 / 140 / 140 / 125 / 111 / 107 / 97 / 76 / 73 |
| `$.process.run` | 707 (regex over source: 1,194) |
| `$.http.fetch` / `$.model.complete` / `$.model.fork` / `$.mcp.call` | 54 / 63 / 27 / 23 (validate); regex finds ~300 / ~360 / - / ~82 |
| `Client` surface module | 151 |
| `Raster` / `$.ui.blit` / `Image` / `Svg` | 236 / 144 / 127 / 316 |
| `Input` / `Select` / `Markdown` | 346 / 125 / 307 |
| hover styles / `position: absolute` | 153 / 449 |
| `prompt.edit` | 80-93 |
| `onLinkPress` / `pressableLinks` | 18 |
| `$.audio.*` | 90 (`speak`: 25) |
| `$.agent.register` | 10-15 |
| `session.send` / `session.receive` | ~59 |
| has tests (index flag) | 2,529 |

---

## 1. Most impressive / strangest (ranked, all CONFIRMED from source)

Ranking is by how far the mod pushes the interface, not by polish or stars.

### 1. thimble-cc-mod — cited answers with live-checked citation chips, cards inline in replies
- https://github.com/safety-research/thimble/tree/main/mods/thimble-cc-mod — org `safety-research`, 17 stars, pushed 2026-10-06. Self-described "an exploration".
- What it does: the model writes `[[value|ref]]` citations and `[[card:id]]` embeds. The mod redraws every assistant reply itself: each citation is a link-styled chip, red when a resolver says the ref is missing or the value differs, with a spinner while a forked subagent fixes or verifies it and a ✓/✗ after. Cards (bar, table, graph...) are drawn between the reply's paragraphs. Right-click menu on any target, drag-select with copy, "ask about this" side threads answered by a subagent out of the main chat.
- Looks like: no image found in the README excerpt I pulled; see the repo.
- API that makes it possible: `ui.render` on `AssistantMessage` returning a tree of `Client` surface modules (`module="./para.tsx"`, `./card.tsx`) with pointer handling; `turn.step` as an async generator rewriting the stream so raw `[[...]]` never shows; `session.append` restoring the text as the model wrote it; `prompt.edit` decorations; `$.agent.spawn`, `$.tool.call`, `$.session.append`, `$.ui.copy`, `$.ui.focus`; `ui.press`, `ui.message`.
- Size: ~270 KB of TypeScript across 9 hook files, four `*.test.ts` suites. The most technically serious mod I read. Not draw-only: it adds context on first prompt and rewrites replies.

### 2. vome-doom — your house as a Doom level; shooting a lamp turns it off
- https://github.com/Vortitron/home-assistant-mcp/tree/main/claude-plugin/vome-doom — 0 stars, pushed 2026-10-06.
- Builds `house.wad` from Home Assistant state, runs a Doom engine as a child process, blits frames into a pane, and on a hit calls `$.mcp.call(server, 'ha_call_service', {...})` against the Home Assistant MCP server. Handles "auto mode refused it".
- Media: the repo README shows a sibling dashboard pane GIF `docs/images/vome-dash.gif`; no Doom capture found.
- API: `Client` + `Raster` + `$.ui.blit`, `$.process.spawn`, `$.mcp.call`, `$.tool.list` to find the server.
- Risk: a game input causes real-world writes through MCP.

### 3. terminal-browser — a real browser in a pane that the agent can drive
- https://github.com/zenbu-labs/terminal-browser (`claude-code-plugin/`) — 3,671 stars on the host repo (created 2026-07, predates mods), pushed 2026-10-05.
- Pane showing live web pages via kitty-protocol `Image` and `$.ui.blit`; registers tools so Claude controls it; pointer and scroll forwarded (`ui.message`, `ui.scroll`); a bridge process over `$.http.fetch`.
- Media: https://github.com/user-attachments/assets/abe2f43e-fc50-4866-b753-33388967945d (from README).
- Similar: `jamubc/toolbox` `/browse`; `sebi75/agent-canvas` (headless Chrome board per session, `docs/demo.gif`); `yasinozmeen/claude-code-mods` vitrin (images, video, PDF, audio, pages from replies in a side pane).

### 4. intermission — Doom deathmatch while Claude works, handed back when the turn ends
- https://github.com/jarrodwatts/intermission — 99 stars, created and pushed 2026-10-02. Image: `intermission-preview.png` in the repo root.
- Opens on `turn.start`, pulls you out on `turn.complete`. Hooks `Spinner`, `AbovePrompt`, `Pane`; `$.process.spawn` engine, `$.ui.blit`, input via `$.fs.write`. Downloads an engine binary with `$.process.run`.
- Other Doom ports: `reporails/arcade` (`docs/doom.png`, also Minefield `docs/minefield.png`), `ChaseWNorton/claude-doom`, `MadAppGang/magus-alpha` claudoom (via tmux).

### 5. move-coach — webcam pose tracking with spoken coaching and optional EEG
- https://github.com/natea/move-coach — 0 stars, created 2026-10-05. Screenshots: `docs/screenshots/1-move-score-shoulder-rotation.png`, `2-solec-balance.png`, `5-squat-pose.png`.
- Pane with a camera feed and pose landmarks, scoring mobility tests; speech and a Muse EEG reader are child processes. `$.process.spawn`, `$.tool.register`, `$.prompt.submit`. Targets the desktop app.

### 6. spinlings — multiplayer creature card game above the prompt
- https://github.com/416rehman/spinlings — 0 stars, pushed 2026-10-06. 1.2 MB of source, CI and releases.
- Battles while Claude works; catch, fuse, trade, gift cards with other players over `$.http.fetch`. Hooks `Spinner`, `PromptHint`, `SessionMode`, `AbovePrompt`, `Pane`; `Client` hit-testing module, `Raster`/`Image`, `$.audio.play`, `$.store`.
- Other multiplayer: `jeffbruchado/tokeneater-mod`, `grozoww/idlecrash`, `adamnroman/claude-chatroom` (one public unmoderated chat room; "nothing from the room reaches Claude").

### 7. claude-share — share a live session by link; teammates join from their own Claude Code
- https://github.com/Paradigm-Study/claude-share — 0 stars, pushed 2026-10-06. ~244 KB.
- One session does the work, guests see every turn and can prompt it, host approves what runs. Hooks nearly everything: `session.append`, `turn.step`, `tool.check`, `prompt.submit`, `UserMessage` filtered on `origin.kind = plugin`, `AskUserQuestion`, `SessionMode`, `Spinner`, `PromptHint`. Relays through the project's public server by default — a privacy risk.

### 8. nightshift — Codex takes over the chat when the Claude limit runs out
- https://github.com/hacksurvivor/claude-mods (`mods/nightshift`) — 0 stars.
- Hooks `AssistantMessage`, `UserMessage`, `ToolResult`, `Spinner`, `SessionMode`, `tool.describe`, `turn.step`; `$.session.usage` to detect limits, `$.session.append`, `$.prompt.submit`, Codex voice and images through `$.process.spawn`.

### 9. phone — watch and drive a phone or emulator in a pane
- https://github.com/luisnquin/nixos-config (`pkgs/phone/plugin`) — README image https://github.com/user-attachments/assets/c188cc0a-9e9b-448f-b999-f28dfbc83ad9.
- `Client` + `Image` + `$.ui.blit` stream, `Input`, `$.ui.ask`, `prompt.edit`. Small (13 KB) and focused.

### 10. Alternative UIs and visualisations
- `davekiss/md` — markdown editor/reviewer pane: drafts stream in, comments anchored to words, accept/reject suggestions; registers `mcp__md__*` tools via `$.tool.register` and hooks each.
- `kesavreddy-commits/repoviewer`, `jamubc/toolbox` atlas — full file explorer/editor panes.
- `jamubc/toolbox` orbit — a globe of every host the session talks to, through a local proxy, with a deny list.
- `r3al1tym/isobar` — "weather map" of the session's change over a map of the codebase; `$.model.complete` captions.
- `NeelAPatel/Claude-Mod-ConversationAtlas` — live map of goal, detours, decisions; `$.model.fork`.
- `ofekbetzalel/claude-code-cli-rtl` — right-to-left Hebrew/Arabic/Persian by redrawing `UserMessage`, `AssistantMessage`, `CommandOutput`, plus `prompt.edit`.
- `skanehira/claude-vime` (11 stars) — a Japanese input method implemented in `prompt.edit`.
- `sezaakgun/cc-arcade` (40 stars, 2026-09-13, the earliest polished one; `docs/demo.gif`) — nine games above the prompt in a `Client` module; re-shipped in `davila7/claude-code-templates`.
- `szarkans/gamble-with-claude-code` — slots, roulette, blackjack betting the tokens you burned; `$.audio.play`; `docs/demo.gif`.
- `MonkeyBinBin/dotfiles` rpg-hud — session as an RPG HUD with a git "world map".
- `natsume-777/claude-mods` ui-sampler — not flashy but the most useful reference: "a labelled catalog of every place a mod can draw, every API it can call and every value it can read", 18 files, one per site/element/event family.

---

## 2. Catalogue of mods read in source (CONFIRMED)

| Mod | Repo | Stars / pushed | Draws | Hooks, calls, notes | Read |
|-|-|-|-|-|-|
| thimble-cc-mod | safety-research/thimble | 17 / Oct 6 | transcript rows, pane, band, prompt box | see §1.1; adds context on first prompt, spawns subagents | deep, tested, exploratory |
| claude-image-view | jarrodwatts/claude-image-view | 147 / Oct 3 | band above prompt | `session.start`, `AbovePrompt`; `$.clock.every(200)`, `$.prompt.read`, `$.fs.*`, `$.process.run(['id','-u'])`; `Image` thumbnails for `[Image #n]` | small, clean, tested; most-starred dedicated mod I saw |
| md-prompt | nogu66/md-prompt | 7 / Oct 3 | prompt box only | `prompt.edit`, `prompt.fill`, one command; `$.config.set`; paint-only by design | polished, ~100 KB of highlight logic, tested |
| run-command | bendrucker/claude (`plugins/run-command`) | 17 / Oct 6 | buttons under reply, list in band | `PromptHint`, `AssistantMessage`, `AbovePrompt`, `prompt.edit`, `ui.press`; `$.prompt.fill` | 4 KB, tidy |
| mr-banner | schreibse/claude-code-mods | 0 / Oct 4 | card under tool row | `tool.call`, `ToolUse`, `ToolGroup`; `$.mcp.call('gitlab', ...)`, `Link` | small, tested, exactly a "receipt" |
| file-preview | abonckus/claude-code-file-preview | 0 / Oct 5 | reply links, pane with search | `AssistantMessage` → `Markdown` with `pressableLinks`/`onLinkPress`; pane with `Input` fuzzy search; `ui.input`, `ui.press` | solid |
| claude-mdview | xuanji86/claude-mdview | 3 / Oct 3 | line under user and assistant rows, pane | `UserMessage` (matcher on `origin.kind === 'composer'`), `AssistantMessage`, `ToolUse`; registers a tool | solid |
| glance | hamzafer/claude-code-mods (`mods/glance`) | 123 / Oct 6 | one line above prompt | `session.start`, `AbovePrompt`, command; `$.clock.every`, `$.mcp.call` to calendar/Linear/Slack connectors, `$.process.run` | polished pack, CI |
| ayda mod | Ayda-Knowledge/ayda-plugin (`mod`) | 0 / Oct 5 | band, pane, citation card under MCP result | `tool.call` on own MCP tools, `AbovePrompt`, `Pane`, `ToolResult` matcher by tool regex; `$.mcp.connect`, `$.mcp.call` | product mod; closest commercial analogue to Fylgja (company knowledge with citations) |
| quote-buttons | 0xGondarxyz/claude-code-mods | 0 / Oct 4 | hover buttons on user rows | `UserMessage`; absolute-positioned hover box | small |
| reply-view | Yrzhe/claude-skills (`plugins/reply-view`) | 55 / Oct 6 | band | `turn.step`, `AbovePrompt`, `ui.scroll`; `Client`, `Image`, `onLinkPress`, `$.ui.copy` | solid |
| its-my-claude gcc-mods | alcatraz627/its-my-claude | 0 / Oct 6 | rewrites paths in replies, compact task rows | `AssistantMessage` props rewrite, `UserMessage` by `origin.kind` | large personal kit |
| shared-session, nightshift, vome-doom, intermission, terminal-browser, spinlings, phone, move-coach, md, cc-arcade | see §1 | | | | |

Not opened beyond index metadata, listed because they came up as notable: `vinta/hal-9000` grammar check in `prompt.edit` (138), `hamzafer` next-steps (`prompt.edit` + `$.model`), `petekp/claude-code-setup` session-inbox (47), `jpicklyk/task-orchestrator` mod (207), `repowise-dev/repowise` (7.1k host), `darrell-tw/darrelltw-mods` (60), `dgokcin/claude-pokemon-mod` (18), `scasella/claude-flightdeck` (17), `madisonrickert/jev-permission-gate` (26; auto-allows or denies tool calls with an external model — risky class), `DazzleML/claude-bookmarks`, `meganemura/jira-ticket-pane`, `rjohnt/linear-claude-mod`, `SaharCarmel/linear-mod`.

**Recurring risk patterns in the corpus**: `$.process.run` in roughly a third of mods; downloading and spawning engine binaries (Doom ports, browsers); proxies that set env (`orbit`); public relay servers (`claude-share`, `claude-chatroom`, `spinlings`); model-based auto-approval of tool calls (jev-* family); prompt/context injection (`prompt.submit` in 799 mods, `prompt.compose` 126, `prompt.context` 65). Mods are not sandboxed from the user's permissions.

## 3. UNCONFIRMED mentions (seen in a post, source not located)

- "Charlie Hills' free pack of 12 mods" (Mission Control, per-session pixel-art office desks, Safe Delete with undo) — from a web-search summary of third-party articles; no repo found.
- Launch figures (public release 2026-10-01; "1,740 public mods three days later"; Boris Cherny's X post with 833k views) — from the same third-party summaries (dev.to, stationx, onewave-ai), not from primary sources.
- `Storybloq/storybloq` (765 stars) has `plugins/storybloq/hooks/client-api.ts` containing `$.ui.invalidate`; probably a mod, hooks.json not checked.
- `fstandhartinger/limitpace`, `mishgoldenberg/claude-mods` (3) — surfaced in code search, described as mods, not opened.

## 4. NOT mods (matched the search strings, are something else)

- `marmyx77/lampboard` — macOS Swift app that inspects mods' trust (`ModTrust.swift`); not a mod.
- `chizhangucb/demo-apps` (`apps/claude-code-mods/src/lib/mod-runtime.ts`) — a web demo simulating the runtime.
- `insta-fusion/bettercallgpt` (`tests/test_launcher.py`), `luisfmontes/rainforest-mind` (a planning doc) — string hits only.
- `ryx2/slopshopper`, `SeongGwangJu/k-mods` — aggregators (slopshopper also ships six mods of its own).
- Older "mods" (tweakcc-style patchers, statusline scripts, settings.json hooks, output styles) did not surface in these searches at all; the term is now dominated by the new feature.

---

## 5. Relevant to Fylgja (draw-only mod: chips in the user row and prompt box, citation marks in replies, sign-in status, one-line receipts)

### 5.1 Prompt-box decorations (`prompt.edit`)
Two mods do exactly "paint, never change text". Both append to existing decorations and also handle `prompt.fill`.

`nogu66/md-prompt` — `plugins/md-prompt/hooks/register.tsx`:
```ts
on("prompt.edit", async ($, e, next) => {
  const box = await next(e)
  if (mode === "off") return box
  return { ...box, decorations: [...(box.decorations ?? []), ...paint(mode, box.text)] }
})
on("prompt.fill", ($, e, next) => {
  if (mode === "off" || e.mode !== "replace") return next(e)
  return next({ ...e, decorations: [...(e.decorations ?? []), ...paint(mode, e.text)] })
})
```
Its header comment is worth copying as a rule: only a `replace` fill carries the whole draft, so only then do offsets into `e.text` equal offsets into the box; and painting is wrapped in try/catch because "a hook that throws is skipped with a notice on every keystroke".

`safety-research/thimble` — `mods/thimble-cc-mod/hooks/register.tsx` (token chips in the prompt box, the direct analogue of record-reference chips):
```ts
function chipDecoration(raw: string, start = 0) {
  return { start, end: start + raw.length, underline: true, color: COLORS.link }
}
on('prompt.edit', async ($, e, next) => {
  const r = await next(e)
  const decorations = [...r.text.matchAll(/\[\[[^\[\]]+?\]\]/g)].map(m => chipDecoration(m[0], m.index ?? 0))
  return decorations.length ? { ...r, decorations: [...(r.decorations ?? []), ...decorations] } : r
})
```
Gotcha from `jarrodwatts/claude-image-view` (`hooks/register.tsx`): "Pasting an image raises no prompt.edit (the tag only shows up on the next keystroke), so the draft is polled instead" — it uses `$.clock.every(200, ...)` + `$.prompt.read()`. Check whether pasted record references behave the same.

### 5.2 Styling tokens inside user/assistant rows
- Wrap, do not replace: call `next(e)` and add under it (`arasovic` image-peek, `xuanji86/claude-mdview`). mdview narrows to the person's own prompts with `e.props.origin.kind !== 'composer'` and skips non-fullscreen terminals.
- Honour `e.props.isExpanded` (ctrl+o) by returning `next(e)` (`alcatraz627/its-my-claude`).
- Cheapest way to restyle text without owning the row: rewrite the prop and let the engine draw — `return next({ ...e, props: { ...e.props, text: rewritten } })` (its-my-claude, `AssistantMessage`). The model never sees this.
- Full control: thimble's `paint.ts` turns styled segments into nested `Text` and uses theme keys (`'remember'` for links, `'error'`, `'selectionBg'`, `'inactive'`, `'subtle'`) so colours follow light/dark/daltonized themes. Copy that mapping rather than hard-coding hex.
- thimble guards per surface: it draws every reply on `terminal` and `desktop`, elsewhere only replies that need it, and falls back to `Markdown` with real links where `Client` is not available.

### 5.3 Clickable links and deep links in replies
`abonckus/claude-code-file-preview` — `hooks/register.tsx`:
```tsx
<Markdown key="md" text={text}
  pressableLinks={links.filter(url => PREVIEWABLE.test(url))}
  onLinkPress={link => void show($, toPath(link.href))} />
```
Same shape in `scoobynko/usb-bootable-maker` md-view and `gggg5151/claude-desktop-links-to-vscode-mod`. All cap link count and text length before taking over a row, and md-view only takes the first block of a reply on the terminal (`isFirstOfReply`). I found **no mod using a custom URL scheme** in a `Link`/`href` (searched vscode/obsidian/linear/cursor/slack/zed/notion schemes). The types say a link outside `https:`/`http:`/`file:` draws as text, so a `fylgja://` link must be a pressable link handled in `onLinkPress` (then opened via `$.process.run(['xdg-open'|'open', url])`, as `ronanworks/claude-code-mods` does for files) or an https link.

### 5.4 Hover cards
`0xGondarxyz/claude-code-mods` quote-buttons — `hooks/register.tsx`, a card over a user row:
```tsx
<Box key={`qb-${e.requestId}`} flexDirection="column">
  {tree}
  <Box position="absolute" top={0} right={0} display="none" hover={{ display: 'flex' }}>
    <Button key="qb-quote" label="↩ quote" dimColor onPress={() => quote($, text)} />
  </Box>
</Box>
```
49 mods use this `display: none` + `hover: { display: 'flex' }` pattern; `aliemrevezir/mods` prompt-dock and `altamimiyasser/claude-code-bar` add `hover={{ scope, ... }}` to light one element from another. thimble instead tracks the pointer inside a `Client` and notes the engine "does not always report the pointer leaving", so it clears hover on press, reflow, or hover elsewhere.

### 5.5 Receipts for write tools, and background lookups that redraw a row
`schreibse/claude-code-mods` mr-banner — `mr-banner/hooks/register.tsx` is the whole pattern in 90 lines: observe in `tool.call` after `await next(e)`, store by `tool_use_id` in an atom, draw under the engine's row, and cover grouped calls too.
```tsx
on('tool.call', async ($, e, next) => {
  const result = await next(e)
  if (kind === null || result.deny !== undefined || result.isError) return result
  await update($, cards, all => ({ ...all, [e.tool_use_id]: card }))
  return result
})
on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
  const card = (await read($, cards))[e.props.tool_use_id]
  const row = await next(e)
  if (!card || e.props.isRunning) return row
  return <Box flexDirection="column">{row}{drawCard($, e, card)}</Box>
})
on('ui.render', { component: 'ToolGroup' }, ...)  // same, over e.props.calls
```
The atom write is what redraws the row; no explicit invalidate. Note it awaits an extra `$.mcp.call` inside `tool.call`, which delays the tool result reaching the model — for Fylgja do that lookup without awaiting (`void`), as thimble does with `enqueue($, unchecked)` from inside the render hook.

### 5.6 Rendering MCP tool results
- Match by tool-name regex, since the same server runs under several names — `Ayda-Knowledge/ayda-plugin` `mod/hooks/register.tsx`: `const ANSWERS = /^mcp__.*ayda.*__(ask|research_brief)$/i` then `on('ui.render', { component: 'ToolResult', props: { tool: ANSWERS } }, ...)`. Its header also states the reason the mod exists: "Claude Code does not show Ayda's MCP Apps, so this module draws two of them from the same tool results".
- Draw the result in the call row and blank the result row to avoid duplication — `xtrm-dev/specialists` specialists-ui and `Paradigm-Study/claude-share`: `on('ui.render', { component: 'ToolResult', props: { tool: /^mcp__...__/ } }, ...) => <Box />`.
- Ayda also notes "Claude Code refuses an MCP result above its size limit" and retries with a smaller page.
- `hamzafer` glance shows the minimal `$.mcp.call` wrapper (JSON in the first text block, keep last good items on failure and dim them).

### 5.7 Search/picker pane with an `Input`
`abonckus/claude-code-file-preview` — `hooks/register.tsx`:
```tsx
const Input = 'Input' in els ? els.Input : null // mobile draws no fields: no search there
<Input key="search" autoFocus placeholder="Fuzzy search…" value={query}
  onInput={(value: string) => void update($, find, f => ({ ...f, query: value }))}
  onSubmit={(value: string) => { const [first] = search(value, entries, 1); if (first) void jump(first.block) }} />
```
Also worth reading for pickers: `rjohnt/linear-claude-mod` and `SaharCarmel/linear-mod` (ticket panes with `Select`, click to load into the session), `meganemura/jira-ticket-pane` (fetch one issue, attach to next prompt), `davekiss/md` (file picker).

### 5.8 `Client` surface modules
thimble is the reference: `<Client key=... module="./para.tsx" width="100%" props={{...}} />`, the module typed as `ClientModule`/`ClientSurface`, no `$` inside, messages back through `ui.message`. Its `para.tsx` header documents a real cost: "A Client holds the pointer from press to release, so the terminal cannot select its text: the paragraph selects it itself" — it reimplements drag-select and copy. For chips in a user row that is a reason to prefer plain `Text`/`Button`/`Markdown` with hover styles over a `Client`.

### 5.9 Sign-in status
433 mods call `$.ui.status`; none I read models an auth state specifically. `luisnquin` phone and `michelr/dotclaude` gcp-reauth (index only) are the nearest. Ayda surfaces connection errors as a toast and a band line.

### 5.10 Testing with `claude plugin test`
2,529 of 3,039 indexed mods carry tests, but most are pure-function tests. Useful patterns:

`schreibse/claude-code-mods` — `mr-banner/hooks/register.test.tsx` (stand in for the engine, drive a tool call, mount the row, query the tree):
```tsx
import { test, expect } from 'claude-code/testing'
test('a card is drawn under the row beneath it, and only when the call is done', async ($, on) => {
  on('ui.render', { component: 'ToolUse' }, ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine row</Text> })
  on('tool.call', () => ({ result: { content: [{ type: 'text', text: MR }] }, text: MR }))
  await $.tool.call({ tool: 'mcp__gitlab__create_merge_request', tool_use_id: 't1', ... } as never)
  const done = await $.ui.mount({ plugin: 'mr-banner', surface: 'terminal', component: 'ToolUse', props })
  expect(await done.find({ text: 'engine row' })).toBeDefined()
  expect(await done.find({ type: 'Link' })).toBeDefined()
})
```
`jarrodwatts/claude-image-view` — `tests/claude-image-view.test.ts`: `mock.clock(on)` to step timers, and fake `prompt.read`, `env.get`, `session.id`, `fs.list` by registering hooks that return `{ value }`.
`safety-research/thimble` — `mods/thimble-cc-mod/tests/cites.test.ts`: `mock.env`, `mock.clock(on, { now })`, an in-memory filesystem via `on('fs.read', ...)`, pointer events on a mounted Client (`ui.pointer({ type: 'down', x, y, button: 'left', in: key })`), `pane.press({ key: 'verify' })`, and a contrast test for chart colours on light and dark.
`fstandhartinger/limitpace` swaps `claude-code/testing` for a local kit to run tests outside the CLI; not needed if `claude plugin test` is available.

### 5.11 Positioning note
Fylgja's "never injects context, never delays a prompt" stance is rare. Of the mods read, only md-prompt, claude-image-view and mr-banner are strictly draw-only, and md-prompt says so in its manifest ("Paint only: it never changes the text you typed"). Ayda is the nearest product neighbour and words its safety property the same way ("No model is in that path, so record text can never cause a write").
