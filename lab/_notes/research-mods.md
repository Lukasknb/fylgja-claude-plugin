# Claude Code mods: primary-source research (local build 2.1.291)

Date: 2026-10-06. Scope: the depth the overview/reference/events/api pages lack.

## 0. Sources and how they were obtained

All paths are under `/tmp/claude-1000/-home-lukas-dev-private-worktracker/2383b913-3260-4db6-9742-514529519841/scratchpad/mods-src/`.

|Short name|Path|What|
|-|-|-|
|DTS|`types-local-2.1.291/claude-code/index.d.ts`|Declarations written by the LOCAL 2.1.291 build (15,507 lines). First line: `// Written by Claude Code 2.1.291.` Authoritative copy for this report.|
|DTS-tools|`types-local-2.1.291/claude-code-tools/index.d.ts`|Built-in tools' inputs/results (5,238 lines)|
|DTS-mcp|`types-local-2.1.291/claude-code-mcp/index.d.ts`|MCP tool inputs (empty: no MCP server was connected in the headless run)|
|tsconfig|`types-local-2.1.291/tsconfig.json`|Generated compiler options|
|DTS-gh|`types-github/claude-code.d.ts`|GitHub copy, `// Written by Claude Code 2.1.277.` (13,186 lines). Older; not used where it differs.|
|docs|`docs/{interface,gallery,create,test,admin,troubleshoot,overview,reference,events,api}.md`|`.md` variants of the doc pages|
|built-in mods|`gh-claude-code/mods/{diff,agents-md,sec-default,telemetry}/`|Sources from anthropics/claude-code main|
|playground mods|`gh-playground/claude-code/mods/{token-weather,blast-radius,replay-theater}/`|Sources from anthropics/claude-code-playground main|

How the local types were obtained: the create page says the engine writes them "each time Claude Code loads or reloads a mod from a directory you pass to `--plugin-dir`". No interactive session was needed. I wrote a 7-line no-op mod of my own under `scratchpad/typegen/typegen-probe/` and ran one headless command, `claude -p "/typegen-probe" --plugin-dir <that dir>`, from the scratchpad. The mod's `command.run` hook answers the command itself, so no model turn ran. That wrote `.claude-plugin/types/` beside the probe, which I copied to `types-local-2.1.291/`. `claude plugin validate` alone does NOT write the types (checked). Nothing was installed or enabled; nothing downloaded was executed.

Two static `claude plugin validate` probes on scratch files (`scratchpad/typegen/validate-probe/`) back a few answers below; they are marked "probe".

Marking: **VERIFIED** = quote plus source. **UNCERTAIN** = not stated by a source, or inferred. `DTS L123` means line 123 of the local declarations.

### Version drift worth knowing

- GitHub DTS is 2.1.277 and says types are "Written by `/plugin-types`" into `.claude/types`. The 2.1.291 header says "Written by the engine each time it loads a mod from a folder the person owns, beside that mod as .claude-plugin/types/claude-code/index.d.ts". Local DTS is 2,300 lines longer. Trust local.
- The built-in `diff` mod's `.tsx` files carry `/* @jsx h */` pragmas, while DTS 2.1.291 L14311 says a module "carries no `@jsx` pragma of its own" (the engine prepends it). Do not copy the pragma.
- The playground `token-weather` reads `e.hasSurvey` and `e.bodyColumns` on the event; the 2.1.291 contract puts them at `e.props.hasSurvey` / `e.props.bodyColumns` (DTS L9924). The sample still runs only because both fall back to defaults. Treat the playground samples as pattern illustrations, not as type-correct for 2.1.291.
- reference.md says it describes v2.1.289. `prompt.mention`, `PromptDecoration`, `Button.variant`/`role`, `PromptHint.tail`, `onScreen` are in the local DTS and absent from the reference tables.

---

## 1. Render sites

### 1.1 Envelope (all sites) — VERIFIED (DTS L9384-9417)

```ts
export type RenderInputOf<C extends RenderComponent, P extends RenderSurface> = {
  surface: P;            // 'terminal' | 'desktop' | 'mobile' | 'vscode'
  component: C;
  requestId: string;     // tool_use_id for a dialog or tool row, message id for a message, agent id for a spinner
  viewport?: RenderViewport;   // { columns, rows, isFullscreen? }
  props: RenderPropsOf[C];
};
export type RenderComponent = 'AskUserQuestion' | 'UserMessage' | 'AssistantMessage' | 'ToolUse' | 'ToolResult'
  | 'ToolGroup' | 'ToolProgress' | 'CommandOutput' | 'Spinner' | 'TurnDuration' | 'InfoNotice' | 'SessionMode'
  | 'PromptHint' | 'AbovePrompt' | 'Pane';
```

"`surface` ... is what the client declared, a rendering fact and not a trust signal: do not key policy on it."

### 1.2 Exact `e.props` per site — VERIFIED (DTS L9432-10027)

`onScreen?: OnScreen | null` appears on every transcript-row site (`{ first, last, of }`, `null` while drawn outside the viewport; read-only: "A rewrite carries it on as received; one that changes or drops it is refused").

|Site|`e.props`|Raised on|
|-|-|-|
|`UserMessage`|`text: string`, `origin: PromptOrigin` (read-only), `isExpanded: boolean` (read-only), `task?: UserMessageTask`, `from?: UserMessageFrom`, `onScreen?`|every surface|
|`AssistantMessage`|`text: string` (markdown, one block), `isFirstOfReply: boolean`, `isSummary?: true` (read-only), `onScreen?`|every surface|
|`ToolUse`|`tool_use_id: string` (read-only), `tool: string`, `input: unknown`, `isRunning: boolean`, `isErrored: boolean`, `isInterrupted: boolean`, `output?: unknown`, `onScreen?`|every surface|
|`ToolResult`|`tool_use_id: string` (read-only), `tool: string` (read-only), `output: unknown`, `isErrored: boolean` (read-only), `onScreen?`|every surface|
|`ToolGroup`|`calls: ReadonlyArray<ToolGroupCall>`, `isActive: boolean`, `isExpanded: boolean`, `onScreen?`|every surface|
|`CommandOutput`|`command: string` (read-only), `args: string` (read-only), `text: string` (markdown), `isErrored: boolean` (read-only), `onScreen?`|every surface|
|`AskUserQuestion`|`tool: string`, `questions: unknown[]`, `metadataSource?: string`|every surface|
|`PromptHint`|`isDraft: boolean` (read-only), `isWorking: boolean` (read-only), `hint: string`, `tail?: string`|terminal and desktop only|
|`AbovePrompt`|`hasSurvey: boolean`, `isWorking: boolean`, `maxRows: number`, `bodyColumns: number`, `scroll: SiteScroll`, `view: SiteView` (all read-only)|terminal and desktop only|
|`Pane`|`title: string`, `isFocused: boolean`, `bodyColumns: number`, `placement: 'dock' \| 'inline'`, `scroll: SiteScroll`, `view: SiteView` (all read-only)|every surface|

Supporting types:

```ts
export type ToolGroupCall = { tool_use_id?: string; tool: string; input: unknown; isRunning: boolean;
  isErrored: boolean; isInterrupted: boolean; output?: unknown };          // DTS L12631
export type SiteScroll = { offset: number; bodyRows: number };             // DTS L11513
export type SiteView = { agentId?: string };                               // DTS L11537
type UserMessageFrom = { name: string };                                   // DTS L14163
type UserMessageTask = { id?: string; status?: string; type?: string; toolUseId?: string; durationMs?: number };
```

Semantics quoted from the declarations:

- `UserMessage`: "A user-role transcript row: the person's prompt (`> ...`), a background task's notification, or a message another agent, teammate or session sent. `origin`, `task` and `from` tell them apart and are read-only; a rewrite of `text` draws in the row alone: the stored message, and the model's framing of another party's words as that party's, stay as they were." `text` rewrite: "printable text, drawn up to its first 100000 characters". `isExpanded` remark: "A hook that draws a compact row of its own passes when true, so ctrl+o shows all."
- `AssistantMessage`: "One block of an assistant reply in the transcript ... A rewrite changes the drawing and leaves the stored message alone (ctrl+o)."
- `ToolUse`: "the call was decided by `tool.call`, so a rewrite here changes the row alone." `input`: "The call's input, as the model sent it." `output`: "The stored result once the call has resolved (`{ stdout, stderr, ... }` for Bash: `BuiltinToolResults[tool]`); undefined while it runs. For a call that errored, was refused or an abort cut, it is the text the model read ... An expanded group's rows draw it inline; a standalone row's is its own `ToolResult`."
- `ToolResult`: "The result block drawn under a standalone tool row in the transcript, which the tool's own result renderer draws from `output`. A rewrite of `output` is checked against the tool's output schema (one that does not fit draws nothing; one the renderer cannot read hits the row's error boundary). The stored result is untouched."
- `ToolGroup`: "A run of tool calls the transcript folds into one count line ... A hook that sets `isExpanded` unfolds the group where it is, and each row it unfolds into is a `ToolUse` drawing a `ToolUse` hook then sees." `isExpanded` is "The one prop of the three a rewrite changes on the screen." Remark: "In fullscreen mode the ctrl+o transcript does not fold runs".
- `CommandOutput`: "A rewrite of `text` draws there and the stored row keeps what the model reads; a hook's own tree draws in the row's place, the transcript's width."
- `AskUserQuestion`: `questions` rewrite "must still fit the tool's schema or the original is drawn". interface.md: "A tree for the dialog has to hold the reference exactly once, with your elements above it. Otherwise, Claude Code draws its own dialog."
- `PromptHint`: "A hook rewrites `hint`, drawn in the line's place, sets `tail` to add to the line as the engine draws it, or draws its own tree". `tail`: "The terminal keeps the engine's line (its pills stay live) and draws `tail` dim at its end ... no other surface draws it yet." Remark: "On the terminal, until a new answer lands the last keeps its row (the engine's line before any)."
- `AbovePrompt`: "The band directly above the prompt input ... A hook draws a tree, or passes; one instance. The person collapses it (ctrl+x ctrl+a, `[-]`) or focuses it (a click, ctrl+x tab)". `maxRows`: slot "capped at half the terminal's rows, the prompt's included". `bodyColumns` = column width "less the engine's five at the right end".
- `Pane`: "one instance per id (`requestId`), its body the hook's tree, one shown, the rest tabs." `placement`: "`dock` beside the transcript (the terminal in fullscreen from 110 columns), or `inline` above the prompt."

The permission dialog is not a render site: "The permission dialog is drawn by the engine alone, since its answer authorises an action; a plugin adds context with `$.ui.notice`." (DTS L9033)

### 1.3 What a `ui.render` hook may return — VERIFIED

```ts
export type RenderResultOf = { [C in RenderComponent]: RenderElement };   // DTS L10033
// the engine's own drawing:
{ type: 'engine'; ref: number }   // "the number core answered from next(e) ... 0 draws the original props"
```

Event doc (DTS L3902): "`next(e)` resolves to the drawing: return it, wrap it, draw your own, or rewrite `props`. An invalid tree, or a throw while drawn, draws the engine's; `--plugin-dir` is told."

|Choice|Code|
|-|-|
|Leave alone|`return next(e)`|
|Rewrite props|`return next({ ...e, props: { ...e.props, text } })` ("A rewrite is validated by the component and an invalid one draws the original")|
|Wrap|`const theirs = await next(e); return Box({ flexDirection: 'column', children: [theirs, Text({ children: ['mine'] })] })`|
|Replace|return your own tree, never call `next`|

Constraint on wrapping: a `Text` "holds strings and inline elements, never an engine node" (DTS L11899), so the engine ref can only be a child of a `Box`.

**Returning `null` to hide a row — UNCERTAIN, and the types say no.** The hook's result type is `RenderElement`; `null`/`undefined` are not members, and a "result of the wrong shape" gets the hook skipped (troubleshoot.md, `hook skipped`). No source documents a "hide this row" answer for message/tool rows. What is documented:
- `ToolProgress.hint`: "`\"\"` draws nothing."
- `ToolResult.output` rewrite that does not fit the schema "draws nothing" (a side effect, not an API).
- `ToolGroup.isExpanded` toggles fold/unfold.
- An empty tree is expressible: `Box({ display: 'none' })` or `Box({})` are valid `BoxProps` (`display?: 'flex' | 'none'`). Whether the transcript collapses the row to zero height is not stated. Must be tried in a session.

### 1.4 Filtering by tool name — VERIFIED

Matchers are deep partials with RegExp leaves (DTS L5688): "the shape of the `e` the hook wants, a partial of it at any depth. A leaf is `===` or a RegExp (`{ command: /^p4 / }`); an array is any-of; an object is a partial of an OBJECT". The DTS itself uses a nested `props` matcher: "a hook matches `{ props: { kind: \"background_hint\" } }`" (L9743). For fields typed `unknown` (a tool's input/output), `MatcherData` allows the same four kinds, unchecked.

```js
on('ui.render', { component: 'ToolUse', props: { tool: /^mcp__plugin_fylgja_fylgja__/ } }, hook)
on('ui.render', { component: 'ToolResult', props: { tool: /^mcp__plugin_fylgja_fylgja__/ } }, hook)
// or branch inside: if (!e.props.tool.startsWith('mcp__plugin_fylgja_fylgja__')) return next(e)
```

Probe: `claude plugin validate` printed `tool.call{tool=/"^mcp__plugin_fylgja_fylgja__"/}` for a RegExp matcher, so RegExp matchers survive static analysis.

**How plugin MCP tools are named.** `McpToolName = \`mcp__${string}__${string}\`` (DTS L5907). `$.mcp.connect` result: server name is "usually `plugin:<plugin>:<server>`" (L5800), and `$.mcp.call` accepts "the tool-name spelling `claude_ai_Gmail`" for "claude.ai Gmail" (L2638), i.e. non-identifier characters become `_`. So a `fylgja` server shipped by the `fylgja` plugin is `plugin:fylgja:fylgja` in /mcp and its tools are `mcp__plugin_fylgja_fylgja__<tool>`. Corroboration: this very session lists tools named `mcp__plugin_posthog_posthog__exec` and `mcp__plugin_context7_context7__authenticate`. VERIFIED for the pattern; the exact Fylgja names were not observed (the plugin was not loaded), so confirm with `$.tool.list()`. Note a non-plugin server named `fylgja` is `mcp__fylgja__*`; match both if users may have either.

A mod-registered tool (`$.tool.register`) is `mcp__<plugin>__<name>` (DTS L2969) — different prefix from a plugin's MCP server tool.

### 1.5 Reading the tool's full input AND full result at the row

- Input: **VERIFIED** — `ToolUse.props.input` is "The call's input, as the model sent it"; also on each `ToolGroupCall`. `ToolResult` has no `input`; join by `tool_use_id` (same as `requestId`).
- Result: **VERIFIED that the stored result is there** — `ToolUse.props.output` / `ToolResult.props.output` is "The tool's own result object ... the record `tool.call` resolved as `result`".
- Result **shape for an MCP tool: UNCERTAIN.** `ToolResultOf<Name>` is `unknown` for MCP: "`unknown` covers an MCP tool" (DTS L12710). Nothing in the declarations says whether an MCP tool's stored record is the raw `{ content, structuredContent, isError }`, the joined text, or a content-block array. `tool.call`'s result separately carries `text` = "the result as the model reads it (text blocks joined), present whatever the tool, where `result`'s shape varies per tool". The only place `structuredContent` is typed for MCP is `$.mcp.call`'s `McpToolResult` (L5912). Log `e.props.output` once from a real Fylgja call to settle this; do not design around `output.structuredContent` until then.
- Headless caveat: "Headless (`-p`), a tool may store the record less its bulk (Bash blanks `stdout`), and a subagent's transcript stores none" (DTS L12735, about `$.session.messages()` results).

### 1.6 Async work inside `ui.render`

**VERIFIED that it is allowed.** The hook is `async`, `$` calls are legal inside it (built-in diff: `const { Box, ... } = await $.ui.resolve(e)`; interface.md: `const n = await read($, count)` inside the render hook), and "A hook's own execution time ... not counting time inside `next` or a mods API call other than `$.clock.sleep`" is what the 10 s budget meters (reference.md Limits; DTS `HookBudget.ms: 10_000`).

**VERIFIED restriction:** `$.state.set` is "Refused while a `ui.render` hook draws (write from `onPress` or another event)" (DTS L3337).

**UNCERTAIN: what is on screen while an async render is pending.** Not stated for transcript rows. The only hint is the `PromptHint` remark: "until a new answer lands the last keeps its row (the engine's line before any)".

Recommendation that follows from the caching model below: do not call `$.mcp.call` in `ui.render`. The answer is cached per input value, so a network call there runs once per props/width change per row and on every plugin reload for every row. Fetch in `tool.call` (after `await next(e)`), in a button `onPress`, or in `prompt.submit`, put the result in a module `Map` or `$.state`, and let the render hook read it. For data the row already has (`e.props.output`), nothing needs precomputing.

### 1.7 Redraws and caching, including old transcript rows — VERIFIED

- "Fires when the engine is about to draw a component: once per input value (props, viewport width), plugin load or `$.ui.invalidate(\"ui.render\")`. A repaint reuses the answer; a clock invalidates." (DTS L3903)
- "Also on a write of `$.state` it read while drawn, at the redraw rate; an invalidate is any plugin's whose matcher may select it."
- `$.ui.invalidate('ui.render')` redraws "the instances this plugin's matchers on it may select: one naming no `requestId`, every instance of its component" (L2305). So a hook registered on `{ component: 'ToolUse' }` re-runs for every tool row on each invalidate. To limit blast radius, key per-row state on a `StateFamily` (section 6): only rows that read the written member redraw.
- Throttle: "ten a second at most, thirty in the terminal for its shown pane, expanded band and prompt hint (sooner calls fold)".
- Width: "a change of width re-draws every hooked site once the resize settles"; height alone "re-draws nothing".
- `onScreen` is "Reported once drawn and again when it changes: on a scroll, for the messages at the viewport's edges only", and "While `null` the terminal holds the site at the rows it last laid out". That is the hook for cheap off-screen rows.
- Old rows after a resume/reload: the hook re-runs for them ("plugin load"), and it gets the stored `input`/`output` in props, so rows from earlier turns redraw without any mod memory. Module variables do not survive a reload; `$.state` resets on `/clear`, `/resume`, `/branch`. Anything a row needs beyond its own props must come from `$.store` or be recomputed. `$.session.messages()` returns the newest 4,096 entries with `toolUses[].result` for backfill.
- **UNCERTAIN:** whether rows already printed into native scrollback (non-fullscreen main screen) are ever repainted. The declarations distinguish "the interactive screen" and say `$.ui.toast` degrades "Where the transcript is printed into scrollback (nothing to float over)"; nothing states that a scrollback row re-renders. Expect restyled old rows only in fullscreen mode.

---

## 2. Token chips in the user's prompt

### 2.1 Display `{{MEETING:abc123}}` as a chip while Claude gets the token or an expansion — VERIFIED mechanism

Two independent hooks: one on what Claude reads, one on what the row draws.

```js
const TOKEN = /\{\{MEETING:([A-Za-z0-9_-]+)\}\}/g
const titles = new Map()            // id -> title; persist in $.store to survive reloads

export function register(on) {
  // 1) What Claude reads: keep the typed text, attach a hidden block
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer') return next(e)          // only the person's own Enter
    const ids = [...e.text.matchAll(TOKEN)].map(m => m[1])
    if (ids.length === 0) return next(e)
    const blocks = []
    for (const id of ids) {
      const r = await $.mcp.call('plugin:fylgja:fylgja', 'get_meeting', { id })
      if (!r.isError) {
        const text = r.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
        titles.set(id, titleOf(r))
        blocks.push('Meeting ' + id + ':\n' + text)
      }
    }
    return next({ ...e, context: [...(e.context ?? []), ...blocks] })
  })

  // 2) What the row draws
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.origin.kind !== 'composer' || e.props.isExpanded) return next(e)
    if (!TOKEN.test(e.props.text)) return next(e)
    TOKEN.lastIndex = 0
    // cheapest: keep the engine's row, change only its text
    return next({ ...e, props: { ...e.props, text: e.props.text.replace(TOKEN, (_, id) => '[' + (titles.get(id) ?? id) + ']') } })
  })
}
```

Quotes that carry it:
- `PromptSubmitInput.context`: "What the model reads beside the prompt and the user never sees, each entry one block after the prompt as typed ... A hook attaches on the way down: `next({ ...e, context: [...(e.context ?? []), mine] })` ... none empty, any length: past 100,000 characters (200,000 together) the model reads a head and path." (DTS L8749)
- `UserMessage.text`: "a rewrite of `text` draws in the row alone: the stored message ... stay as they were."
- Alternative if the stored message should change too: `next({ ...e, text })` in `prompt.submit` — "Rewrite with `next({ ...e, text })` (the user message on screen follows)" (L4026).
- Hidden context is stored: `PromptAttachmentOrigin` has `kind: 'plugin'` — "Text a plugin's hook attached through a chain's `context` ... The chains that carry one: `prompt.submit`, `prompt.mention`, `tool.call`" (L7959). So the expansion is an attachment row in the transcript and survives resume/compaction rules like any attachment.

For a real styled chip, return your own tree instead of rewriting `text`:

```js
const { Box, Text } = $.ui.resolve(e)
return Box({ flexDirection: 'row', flexWrap: 'wrap', children: [
  Text({ dimColor: true, children: ['> '] }),
  ...partsOf(e.props.text).map(p => p.id
    ? Text({ backgroundColor: 'claude', color: 'inverseText', bold: true, children: [' ' + (titles.get(p.id) ?? p.id) + ' '] })
    : Text({ children: [p.text] })),
] })
```

Limits:
- A replaced tree loses the engine's own row chrome (prompt glyph, background, attachments marker); you redraw them. The `text` rewrite keeps the chrome but is plain text only (no per-span style).
- `Text` children are strings and inline elements; a `Link` can sit inline. `backgroundColor` "fills only as wide as the text" (gallery.md).
- Context added after `next` resolved "is not attached (the prompt had entered), and is logged". Attach on the way down.
- A `prompt.submit` hook that throws or times out is skipped and the prompt goes through unexpanded ("a broken plugin never blocks one"). `claude plugin validate` flags it as `gating hook without .catch` (probe).
- The 10 s budget does not count the `$.mcp.call` wait, but the person waits for it before the turn starts. Bound it and fall through.
- `$.prompt.submit` from a plugin: "`@file` mentions and pasted images are not expanded for a plugin's prompt".
- Drawing is terminal + Desktop only (overview.md "Where mods run"). In VS Code, `-p`, cloud: the hooks run (Claude gets the context) but the chip is not drawn.

### 2.2 Hooks on text while it is still in the prompt box

|Hook / call|What it gives|Verdict|
|-|-|-|
|`prompt.edit` event|Every edit of the main prompt box before it lands; can rewrite the splice, rewrite the resulting box, consume the key, and return paint ranges|**Inline decoration: YES. Paste interception: YES.** VERIFIED|
|`$.prompt.fill`|Write into the draft (`replace`/`append`/`insert` at cursor), optionally with paint ranges|VERIFIED|
|`$.prompt.read`|`{ text, cursor }` of the draft|VERIFIED|
|`prompt.fill` event|Intercept another plugin's fill|VERIFIED|
|`$.prompt.suggest` / `prompt.suggest`|The dim ghost suggestion in an EMPTY box, Tab to take|Not a typeahead. VERIFIED|
|`prompt.mention` event|Fires per `@path` the prompt names, before the file is read; can add `context`, redirect `path`, or deny|File mentions only. VERIFIED|
|`PromptHint` site|The dim line under the prompt; `isDraft` says the box holds text; `hint`/`tail` rewrite or own tree|A place to show a live hint. VERIFIED|
|`AbovePrompt` site|The band above the prompt|A place to show a candidate list. VERIFIED|

`prompt.edit` (DTS L4058, L8221-8296):

```ts
export type PromptEditInput = {
  origin: { kind: 'composer' };
  key?: ClientKeyEvent;      // "absent for a paste and for a burst of keys folded into one edit"
  text: string;              // the draft BEFORE the edit
  cursor: number;
  start: number; end: number;   // the span replaced
  inputText: string;         // "the typed or pasted text, '' for a deletion or a move"
};
export type PromptEditResult = PromptBox & { decorations?: PromptDecoration[] };
export type PromptDecoration = { start: number; end: number }
  & Pick<TextProps, 'color' | 'backgroundColor' | 'dimColor' | 'bold' | 'italic' | 'underline' | 'strikethrough'>;
```

"`next(e)` resolves the box the editor shows. ... Rewrite `inputText` going down or the box coming up; `{ text: e.text, cursor: e.cursor }` without `next` consumes." Decorations: "One styled run a surface paints over the prompt draft: `[start, end)` ... Paint only." and "Kept on the same characters while the next edit's answer is pending, then replaced by that answer's list (or by none)."

```js
// Paint every {{MEETING:id}} token in the draft, and turn a pasted Fylgja URL into a token
on('prompt.edit', async ($, e, next) => {
  const pasted = e.key === undefined && /^https:\/\/fylgja\.lknblab\.dev\/meetings\/(\w+)$/.exec(e.inputText.trim())
  const r = await next(pasted ? { ...e, inputText: '{{MEETING:' + pasted[1] + '}}' } : e)
  const mine = [...r.text.matchAll(/\{\{MEETING:[\w-]+\}\}/g)]
    .map(m => ({ start: m.index, end: m.index + m[0].length, color: 'claude', bold: true }))
  return { ...r, decorations: [...(r.decorations ?? []), ...mine] }
})
```

Limits of `prompt.edit`:
- Budget is **50 milliseconds** of the hook's own time (reference.md Limits). `$` calls do not count, but every keystroke waits on the hook. Keep it synchronous; never call the network from it.
- Decoration is paint only: it cannot replace `{{MEETING:abc123}}` with a title while keeping the token as the value. To show a title in the box, the box text itself must hold it (for example insert `@meeting(Quarterly review)#abc123` and expand at `prompt.submit`).
- Decorations are re-supplied per edit; with no `prompt.edit` hook they are "gone at the draft's next change" (so `$.prompt.fill({ decorations })` alone does not persist).
- **UNCERTAIN on Desktop.** The event is for "the main prompt box" with origin `composer`. `PromptFillResult.refusal` documents `no_composer` for "headless, or a surface that draws its own composer". Which surfaces draw their own composer is not listed; the Desktop app plausibly does. Assume terminal-only until tested.
- **UNCERTAIN:** `prompt.edit` is absent from reference.md's "what a hook can return" beyond `next(e)`; the DTS is the only source for decorations.

**Autocomplete / typeahead (an `@`-style meeting picker): no native API. VERIFIED absent** — no event or method in the declarations adds entries to the engine's typeahead or `@` menu; "The prompt is Claude Code's own" (interface.md screen map); "Your mod never reads the keyboard itself". What can be built from parts:

1. `prompt.edit` watches the draft for a trigger (e.g. `@m ` or `{{`), records the query in module state / `$.state`, and returns. It must not fetch.
2. A `$.clock.after(150, ...)` debounce (started outside the hook's own time) calls `$.mcp.call(server, 'search_meetings', { q })`, stores candidates, calls `$.ui.invalidate('ui.render')`.
3. `AbovePrompt` draws the candidates as `Button`s; `onPress` calls `$.prompt.fill({ text: token, mode: 'insert', decorations })` after trimming the trigger with a `replace` fill built from `$.prompt.read()`.
4. Selection problem: while typing, keys go to the prompt. A digit `hotkey` on a band button fires only "when the user types that digit alone into an empty prompt and pauses". So candidates are picked with the mouse, or after `ctrl+x tab` moves focus to the band. There is no arrow-key-in-composer picker. `focus: true` on a pane is refused while "text in the composer".
5. Consuming Tab/arrow in `prompt.edit` to drive a picker: UNCERTAIN. The event fires for "a key the editor took as an edit"; `start`/`end` cover "a bare cursor move", so arrows probably arrive, but whether Tab or Enter do is not stated, and "A mod can't bind Tab or the arrow keys to anything else" (interface.md, about panes).

Simpler alternatives that are fully supported: a `/meeting <query>` command (`$.command.register` with `argumentHint`) that opens a pane with an `Input` (search as you type, section 4.4) and inserts the token with `$.prompt.fill`; or let the person type `@fylgja:<id>` and expand at `prompt.submit`.

`prompt.mention` (new, DTS L8471-8544): "Fires once per path a prompt names after an `@`, a directory aside, before the engine reads it ... Add `context` to what `next` gave, read another `path` with `next({ ...e, path })`, or answer `{ deny: reason }`". `e.mention` is "What followed the `@`, a path as the person typed it". A hook "that answers without `next` had no file read" and may answer `{ type: null, context: [...] }`. Whether a non-file string such as `@meeting/abc123` is raised at all is UNCERTAIN ("as the engine resolved it"; "whether a file is there is the read's to find" suggests unresolved-but-path-shaped mentions are raised, which would make `@fylgja/<id>` a native-feeling token, but this needs a session test).

### 2.3 Exactly what the four calls do — VERIFIED

```ts
read:  () => Promise<PromptBox>                       // { text: string; cursor: number }  UTF-16 offsets
fill:  (input: PromptFillArgs) => Promise<PromptFilled>
//   PromptFillArgs = { text: string; mode?: 'replace' | 'append' | 'insert'; decorations?: PromptDecoration[] }
//   PromptFilled   = { isFilled: boolean; refusal?: 'no_composer' | 'dialog'; text: string; cursor: number }
selection: () => Promise<UiSelection | undefined>     // { text: string; requestId?: string }
copy:  (args: UiCopyArgs) => Promise<UiCopyResult>    // { text: string; surface?: RenderSurface }
//   UiCopyResult = { isCopied: true } | { isCopied: false; reason: 'no-surface' | 'no-clipboard' | 'refused' }
```

- `$.prompt.read`: "Never rejects: `{ text: '', cursor: 0 }` where the session draws no box (a -p run, an SDK host) or none is mounted yet." No selection: "the terminal's box has none of its own".
- `$.prompt.fill`: "`replace` (the default) over it, `append` after it, `insert` at the cursor ... `isFilled: false` under a dialog or headless." The box "takes it without the code points a terminal draws as nothing". It does not submit; the person presses Enter. To hand the model text with the next prompt, the DTS itself points to `prompt.submit` context.
- `$.ui.selection`: "what the person last selected with the mouse: the text as a copy would take it, and the transcript row it lies in." `requestId` is "Absent when the selection spans several rows, lies outside the transcript (the prompt, a pane)". `undefined` "where none is seen: fullscreen off, -p, a surface that answers none".
- `$.ui.copy`: clipboard write only, never read. "The terminal writes as `/copy` does; a remote surface has no path yet." OSC 52 "does not report back", so `isCopied: true` can be a false positive.

There is no clipboard read and no raw key hook outside `prompt.edit` and a focused `Client`.

---

## 3. Elements

### 3.1 Which surface has which element — VERIFIED (DTS L3734-3804)

"All carry `Box`, `Text`, `Button`, `Link`, `Code`, `Markdown`; every remote surface `Svg`; all but mobile `Input` and `Select`; terminal and desktop `Client`; terminal `Raster` and `Image`."

|Element|terminal|desktop|vscode|mobile|
|-|-|-|-|-|
|Box, Text, Button, Link, Code, Markdown|yes|yes|yes|yes|
|Input, Select|yes|yes|yes|no|
|Svg|no|yes|yes|yes|
|Client|yes|yes|no|no|
|Raster, Image|yes|no|no|no|

The `vscode` and `mobile` tables exist in the types, but overview.md says drawing happens only in the terminal and the Desktop app. Using an element the surface lacks refuses the whole tree ("On a surface whose table lacks it the tree is refused"), so branch on `e.surface`.

### 3.2 Full prop lists — VERIFIED

**Box** (DTS L862): `key`, `hover: BoxHoverProps`, `position: 'relative' | 'absolute'`, `top`, `left`, `right`, `bottom` (integer cells, may be negative), `flexDirection: 'row' | 'column' | 'row-reverse' | 'column-reverse'`, `flexGrow`, `flexShrink`, `flexWrap: 'nowrap' | 'wrap' | 'wrap-reverse'`, `alignItems: 'flex-start' | 'center' | 'flex-end' | 'stretch'`, `alignSelf: 'flex-start' | 'center' | 'flex-end' | 'auto'`, `justifyContent: 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around' | 'space-evenly'`, `gap`, `columnGap`, `rowGap`, `width`, `height`, `minWidth`, `minHeight` (number or string percentage), `margin`, `marginX`, `marginY`, `marginTop`, `marginBottom`, `marginLeft`, `marginRight`, `padding`, `paddingX`, `paddingY`, `paddingTop`, `paddingBottom`, `paddingLeft`, `paddingRight`, `borderStyle: string`, `borderColor: Color`, `borderDimColor: boolean`, `backgroundColor: Color`, `overflow: 'visible' | 'hidden'`, `display: 'flex' | 'none'`, `children`.

No `maxWidth`/`maxHeight`, no per-side borders, no `onPress` on a Box. "Props are an allowlisted subset of Ink's Box/Text props ... a tree with any other prop fails validation as a whole and the engine's own component is drawn".

**Text** (L12228): `hover: TextHoverProps`, `color`, `backgroundColor`, `dimColor`, `bold`, `italic`, `underline`, `strikethrough`, `inverse`, `wrap: 'wrap' | 'end' | 'middle' | 'truncate' | 'truncate-start' | 'truncate-middle' | 'truncate-end'`, `children` (strings and inline elements). One string child ≤ 10,000 characters (reference.md).

**Button** (L1021): `key?` (defaults to the label), `label?` (or the one string child in JSX), `hotkey?` (one digit or lowercase letter), `action?` (an engine keybinding action name such as `"app:cycleDiffBase"`), `plain?: true`, `dimColor?: boolean`, `variant?: 'primary' | 'secondary'`, `role?: 'dismiss'`, `autoFocus?: true`, `hover?: TextHoverProps`, `onPress: (e: UiPressArgument) => void`. A leaf. **No `href`.**

**Link** (L5537): `href: string`, `label?: string`, `children?` (inline text).

**Markdown** (L5593): `key?`, `text: string`, `dimColor?: boolean`, `onLinkPress?: (link: PressedLink, e: UiPressArgument) => void`, `pressableLinks?: readonly string[]` (≤ 256 entries of ≤ 2048 chars). A leaf; "`key` ... Required with `onLinkPress`". "a `<context>` block, hidden in a reply's own text, is drawn here as written." "Not drawn around the approval dialog."

**Code** (L1577): `source: string`, `language?`, `path?` (language inference only, "never read"), `startLine?`, `format?: 'source' | 'diff'`, `wrap?: 'wrap' | 'truncate-end'`.

**Input** (L5366): `key: string`, `label?`, `placeholder?`, `value?`, `submitLabel?` (default `submit`), `autoFocus?: true`, `onInput?: (value: string, e: UiInputArgument) => void`, `onSubmit: (value: string, e: UiInputArgument) => void`. One line only. `onSubmit` is required by the type.

**Select** (L10160): `key: string`, `label?`, `options: readonly { value: string; label?: string }[]` (at least one, values unique), `value?`, `autoFocus?: true`, `onSelect: (value: string, e: UiSelectArgument) => void`.

**Svg** (L11937): `source: string` (≤ 131,072 chars), `alt: string` (required), `width?`, `height?` (CSS px), `isInteractive?: boolean`. "The surface never lets the markup reach the page (the engine bounds it; the desktop and the editor draw it as an image, or in a sandboxed frame when `isInteractive`...)". `isInteractive` "never enables script or event-handler attributes"; it enables `:hover`, SMIL, `<title>` tooltips.

**Client** (L1450): `key: string`, `module: string` (string literal path), `props?: unknown` (JSON ≤ 100,000 chars), `width?`, `height?` (count or percentage), `flexGrow?`.

**Raster** (L8934): `key: string`, `columns` (1-512), `rows` (1-256), `cells: string` (base64 of little-endian u32 triplets `[codePoint, fg, bg]`). "no children, `hover` or `onPress` yet". Palette "paints 1024 distinct color pairs at once and the rest as their nearest".

**Image** (L5210): `key?`, `source: ImageSource` (`{ png }` | `{ rgba, width, height }` | `{ file, format, ... }` | `{ shm, format, width, height }`; ≤ 2 MiB decoded), `columns` (1-255), `rows` (1-255), `alt: string` (required).

Tree bounds (stated for Client trees, "every tree's bounds"): "20,000 nodes, 32 deep, 100,000 characters serialized". Code/Markdown: "one drawing draws 100000 characters in all".

### 3.3 Colors, theme tokens, hover, borders — VERIFIED

```ts
export type Color = ThemeKey | (string & {});
export type ThemeKey = 'text' | 'inverseText' | 'inactive' | 'subtle' | 'suggestion' | 'remember' | 'success'
  | 'error' | 'warning' | 'merged' | 'claude' | 'permission' | 'planMode' | 'autoAccept' | 'promptBorder'
  | 'bashBorder' | 'ide' | 'diffAdded' | 'diffRemoved' | 'diffAddedDimmed' | 'diffRemovedDimmed'
  | 'diffAddedWord' | 'diffRemovedWord';
```

"a theme key, which follows the person's theme, or any other string, a raw color (a name such as `\"red\"`, or hex) ... Another key the theme holds resolves too". "What a surface draws for one it does not know is its own."

Hover (no hook runs; pure data the surface applies):
- A `Box` with a `key` is a hover scope: "while the pointer is anywhere over it, its own `hover` and that of every element beneath it apply."
- `BoxHoverProps`: `scope?`, `borderStyle?` ("Restyles a border the Box has; it adds none"), `borderColor?`, `borderDimColor?`, `backgroundColor?`, `display?: 'flex'` (reveals a Box drawn `display: 'none'`), `top/left/right/bottom` (moves an absolutely positioned Box).
- `TextHoverProps`: `scope?`, `color`, `backgroundColor`, `dimColor`, `bold`, `italic`, `underline`, `strikethrough`, `inverse`. On `Text` and `Button` it is "Refused outside a keyed Box unless it names a `scope`."
- `scope`: "every element it draws with the same `scope`, in any site, lights while any is hovered, reveals included. A Pane row and a mark on a transcript message can share one." 1-64 chars. This enables hover cards and cross-site highlighting with zero round trips:

```jsx
<Box key="k"><Text>glyph</Text>
  <Box position="absolute" top={-2} left={2} display="none" hover={{ display: 'flex' }}>the card</Box>
</Box>
```

- Hover needs pointer reporting; in practice the fullscreen terminal and the Desktop app. Not stated for the main-screen terminal: UNCERTAIN.

Borders: `borderStyle` is typed `string`. The sources show only `'round'`. The Ink set (`single`, `double`, `round`, `bold`, `singleDouble`, `doubleSingle`, `classic`) is likely but NOT listed anywhere in the docs or declarations: UNCERTAIN. A wrong value fails validation of the whole tree, with the reason printed under `--plugin-dir`.

### 3.4 `Client` — what it is, what it adds, sandbox, messaging

VERIFIED (DTS L1355-1560, L9288-9306, L3950-3972):

- "A region one of the plugin's SURFACE MODULES, named by path, draws and handles input for on the drawing thread, without `$`". A surface module is a second file of the plugin whose default export (or its one PascalCase export) is:

```ts
export type ClientModule<P extends JsonValue = JsonValue, S = unknown> =
  (props: P, surface: ClientSurface<S>) => RenderElement;

export type ClientSurface<S = unknown> = {
  readonly elements: ClientElements;            // terminal table minus Client, Raster, Image
  readonly state: S | undefined;                // local, kept across the plugin's redraws
  setState: (next: S) => void;                  // redraw next frame, coalesced
  readonly columns: number; readonly rows: number;
  every: (ms: number, fn: () => void) => () => void;                 // frame-clock timer
  onPointer: (fn: (event: ClientPointerEvent) => void) => () => void; // down/move/up/enter/leave, cell coords, fine sub-cell
  onKey: (fn: (event: ClientKeyEvent) => void) => () => void;         // while a click gave it focus; Escape never arrives
  post: (data: JsonValue) => void;              // -> ui.message in the hooks module
};
```

- `module` must be "a string literal relative to this file: `module: \"./<name>.tsx\"` ... a variable there is refused at load, as is a path outside the plugin".
- What it can do that a server-side tree cannot: local state with no round trip to the hooks worker (`setState`), animation on the surface's frame clock (`every`), raw pointer events with capture and sub-cell positions (kitty, Ghostty, iTerm2, WezTerm, foot; "tmux passes none through"), raw key events while focused (so arrow keys and letters inside the region), and its own timers. A hooks-module tree gets none of those: it only gets `onPress`/`onInput`/`onSelect` callbacks and redraws at 10-30 Hz.
- What it cannot do: "No `$` here". No nested `Client`, no `Raster`, no `Image`. No DOM, even on Desktop: "The desktop carries it as data"; the module returns the same plain-data element tree. Globals: "A surface module's environment (Client) has the same globals and a `console`; neither has timers". No `eval`, no `new Function`, no `WebAssembly`, no network, no fs.
- Limits: the function runs "a second per call at most"; "A throw, an overrun or a tree past the bounds unmounts it"; three `setState` renders in a row with no input between "is a render loop: the instance unmounts".
- Messaging: `surface.post(data)` → `ui.message` in the hooks module, "only this plugin's hooks see it", "one per frame at most. A later post in the same frame replaces an undelivered one". `next.origin` names `client`; "`data` is input to validate, not a fact". The hook answers `{}` or `{ props }`: "hands the posting instance its next props directly, its local state kept, with no `ui.render` run".

```ts
export type UiMessageArgument = { surface: RenderSurface; component: RenderComponent; requestId: string;
  element: string /* the Client's key */; module: string; data: unknown };
export type UiMessageResult = { props?: unknown };
```

- Failure: `ui.fault` with `e.phase` `load | render | run` and `e.reason`; the engine redraws the site once so the hook can leave the `Client` out. Needs 2.1.289+.
- Terminal vs Desktop: Client exists on both tables. Remote details are thin: "a remote `Client`'s module, presses and posts (ui_client_module, ui_client_press, ui_message) name no surface. They are the desktop's alone today". `UiMessageArgument.surface` says "`terminal`, or `desktop` once it has them", which reads as if desktop posts were not fully there when that comment was written. Pointer `fine` and key events are described in terminal terms only. Desktop parity of pointer/key input: UNCERTAIN.
- Testing: `$.ui.mount(...)` returns `key`, `pointer`, `post`, `advance` members to drive a Client (section 9).

Neither docs nor samples contain a worked Client example; none of the seven published mods uses one.

### 3.5 What `Link` opens; can a Button open `fylgja://meeting/ID`?

- **Link — VERIFIED.** "A hyperlink every surface draws: an OSC 8 span on the terminal (its text then the URL in dim where unsupported), an anchor on desktop." `href`: "Where the link goes, as written: any scheme, host and port; at most 2048 characters ... A blank or no string, and on a remote surface anything but the `https:` URL its wire promises: the text is drawn plain ... A click opens what the terminal, or the surface, opens." gallery.md: "Whether a click opens it depends on the user's terminal."
  - Terminal: `Link({ href: 'fylgja://meeting/ID', label: 'Open in Fylgja' })` is emitted as an OSC 8 hyperlink. Whether a click launches the handler depends on the terminal emulator and the OS scheme registration: UNCERTAIN per terminal.
  - Desktop/other remote surfaces: a non-`https:` href "is drawn plain". So `fylgja://` is dead text there; use an `https://fylgja.lknblab.dev/...` URL.
- **Markdown links — VERIFIED.** "a link not `https:`, `http:` or `file:` draws as text." With `onLinkPress` the plugin answers presses itself: "a press on one raises `ui.press` with `e.link`, the surface opens none"; "A press is a plain single click where the surface reports clicks (the fullscreen terminal)".
- **Button — VERIFIED it has no URL prop.** A Button can open a custom scheme only by running code in `onPress`:

```js
Button({ key: 'open-' + id, label: 'Open', onPress: () => $.process.run(['xdg-open', 'fylgja://meeting/' + id]) })
```

  `$.process.run` takes an argv with no shell, runs "as the user the session runs as", and the namespace is marked "CLI only" (DTS L3425). In the Desktop app's local Code tab the engine is the bundled CLI, so it should work there, but that is an inference: UNCERTAIN. It adds `$.process.run` to the mod's `calls:` line, which an org reviewer treats as risky (section 9.8). On macOS the argv is `['open', url]`.
- Cross-surface recommendation: `Link` with an `https://` deep link (works everywhere, no risky call), plus an optional Button + `$.process.run` for the native scheme in the terminal.

---

## 4. Panes and the small UI calls

### 4.1 `$.ui.open` — VERIFIED (DTS L2410, L7148-7217, L13697)

```ts
open: (pane: PaneOpenArgs) => Promise<UiOpenResult>
export type PaneOpenArgs = { id: string; title?: string; focus?: true; closeOnEscape?: true; holdToasts?: true;
  rows?: number; columns?: number };
export type UiOpenResult = { isPlaced: true } | { isPlaced: false; reason: string };
close: (pane: { id: string }) => Promise<void>
panes: () => Promise<readonly UiPane[]>   // { id, title, isShown, isFocused, isPlaced } — this plugin's own only
```

- `id`: "1-64 of letters, digits, `_` and `-`. One pane per id: opening an open id delivers the new title, never a second instance."
- **Placement is not an option.** The surface decides: "docked beside a fullscreen transcript from 110 columns, else inline above the prompt." The hook reads `e.props.placement`. `rows` applies inline only ("the dock ignores it"; default "a third"); `columns` applies docked only. Both are "A request, not a grant: a size the person dragged or keyed ... wins".
- `focus`, `closeOnEscape`, `holdToasts` accept only `true`; passing `false` throws (`ui.open: focus is true or left out`), which skips the hook and produces "registered /x but no command.run hook answered it".
- `focus`: "A request, not a grant: the surface focuses (and raises) the pane only while the prompt has the keys over an empty composer."
- Multiple panes: yes, several ids; "one shown, the rest tabs"; `title` is "Its tab's label while more than one pane is open (with one, the engine draws no title)"; "A click on a tab, or Tab onto it and Enter, shows that pane." In-pane tabs are your own row of Buttons (the `hello-tabs` tutorial).
- Asked vs unasked: "Asked (the hook of a command the person typed or a prompt they entered, a Button, Input or Select they worked; never a timer, `session.start`, a queued prompt, nor `focus`) a pane is placed at any width ... Unasked it is placed from 144 terminal columns (110 for an id the person opened from this plugin before, in this session or an earlier one, and has not closed by hand since) and waits undrawn below that, no `ui.render` raised". "a `-p` run places all."
- `isPlaced: false` also for "a session whose attached surfaces place no panes" (an older desktop). Fallback pattern from the samples: draw the same view in `AbovePrompt` when `isPlaced === false` (blast-radius, replay-theater).
- A reloaded module finds its pane via `$.ui.panes()`: "The engine's record, not the module's".
- `ui.close` event: `e.origin.kind` is `plugin`, `person`, or `unload`; a hook "answering without `next` keeps the pane open, save on an unload".

### 4.2 Focus, keyboard, hotkeys — VERIFIED (interface.md + DTS)

- Focus arrives by `focus: true` from a command/press, `Ctrl+X` then `Tab`, or a click.
- Tab: next control. Up/Down: move between controls, or scroll when the tree is taller than the site. Enter: press/submit/pick. PageUp/PageDown/Home/End: scroll. `Ctrl+X` arrow: resize. `Ctrl+X X`: close. Esc: return focus (closes too with `closeOnEscape`).
- "A mod can't bind Tab or the arrow keys to anything else". A `Client` region is the only way to receive arrows/letters as raw keys.
- `hotkey`: one digit or lowercase letter, active "while the plugin's site holds the focus". "While an `Input` has the focus, every printable key goes to the field." Two buttons on one hotkey: later wins.
- `action`: binds a Button to one of the engine's own keybinding actions so its chord presses the Button from the prompt, "on the terminal while mounted, no dialog up and no engine handler of the action mounted". It cannot define a new chord: "unknown names refused". No API registers a new global hotkey.
- `$.ui.focus({ requestId, key })`: moves the ring onto an element "while it holds the keys"; `ui.focus` event fires before the ring moves (a hook can redirect or refuse).
- `autoFocus: true` on one control per site.

### 4.3 Scrolling — VERIFIED

- "A tree taller than the pane scrolls as a whole." The engine owns the window; the hook reads `e.props.scroll.offset` / `bodyRows`.
- `$.ui.scroll({ in, to, block })`: "a render instance by `requestId`, an element by `key`, a site's edge" (`to: 'start' | 'end'`). "A transcript row moves only while this call answers the person's own input".
- `ui.scroll` event: `next(e)` moves the window; answering `{}` without `next` "leaves it undrawn, so a hook drawing its own rows under a header moves them by `e.by` and invalidates" — the virtualized-list pattern (fixed header plus your own row window). The built-in diff mod hooks `ui.scroll` and `ui.focus` this way.
- For long lists, window the rows yourself against `bodyRows`; the 20,000-node bound applies.

### 4.4 Lists with per-row buttons and search-as-you-type — VERIFIED pattern

```js
let query = '', rows = [], pending = null

on('ui.render', { component: 'Pane' }, async ($, e, next) => {
  if (e.requestId !== 'meetings') return next(e)
  const { Box, Text, Button, Input, Link } = $.ui.resolve(e)
  const width = e.props.bodyColumns
  return Box({ flexDirection: 'column', children: [
    Input({ key: 'q', label: 'Search', placeholder: 'title, person, project', value: query, autoFocus: true,
      submitLabel: 'search',
      onInput: (value) => { query = value; schedule($) },     // every change
      onSubmit: (value) => { query = value; search($) } }),
    ...rows.slice(0, e.props.scroll.bodyRows - 1).map(m => Box({ key: 'row-' + m.id, flexDirection: 'row', columnGap: 1, children: [
      Button({ key: 'ins-' + m.id, label: '+', plain: true, onPress: () => $.prompt.fill({ text: '{{MEETING:' + m.id + '}} ', mode: 'insert' }) }),
      Text({ wrap: 'truncate-end', children: [m.title.slice(0, width - 20)] }),
      Text({ dimColor: true, hover: { dimColor: false }, children: [m.date] }),
    ] })),
  ] })
})
```

Rules that bite:
- `Input.value` is "The text the field holds when drawn; the person's typing replaces it until the hook draws another." If you redraw on each `onInput`, pass the current query back as `value` or the field resets.
- Every control needs a unique `key` per row. A keyed row `Box` is also a hover scope.
- Debounce with `$.clock.after` (no `setTimeout` exists). The redraw throttle is 30/s for the shown pane.
- `onInput`/`onSubmit` run in the hooks module; "No model turn unless it asks one."
- Another mod can observe or rewrite the typing via `ui.input` ("its hook runs before your callback, so it sees what the user types into your `Input`").
- `Input` is a single line; there is no multi-line field, checkbox, or table element. Tables are rows of fixed-width `Text`; `Markdown` renders tables ("its own renderer, links, tables, fences").

### 4.5 The small calls — VERIFIED signatures (DTS L2283-2518)

```ts
ask:    (question: string, options?: readonly string[] | AskOptions) => Promise<string>
//        AskOptions = { options?: readonly string[]; header?: string /* <=12 chars */; multiSelect?: true }
notice: (tool_use_id: string, text: string | undefined) => void
toast:  (text: string, options?: { timeoutMs?: number }) => void
status: (text: string | undefined) => void
log:    (text: string, options?: { to?: 'transcript' | 'debug' }) => void
blit:   (args: UiBlitArgs) => Promise<UiBlitResult>     // RasterBlitArgs | ImageBlitArgs
invalidate: (event: 'ui.render' | 'prompt.section' | 'prompt.context' | 'prompt.attachment'
                  | 'tool.describe' | 'command.describe' | 'config.describe') => void
```

- `$.ui.ask`: the engine's AskUserQuestion dialog; "2-4 option labels ... fewer than two are padded with Yes/No; free text is the dialog's Other"; resolves to the label, comma-joined labels for multi-select, or the typed text ("so compare it with the labels exactly"). "Rejects when dismissed, and in a `-p` run". It is dispatched as "A `tool.call` of `AskUserQuestion` through every hook but the calling one". The wait does not count against the hook budget.
- `$.ui.notice`: "one line under the dialog open for `tool_use_id`" — the only way to add text to a permission prompt. "A call that is not open is refused".
- `$.ui.toast`: top-right box, default 4000 ms, first 2000 chars drawn (10,000 remotely); "A click takes it off, the pointer over it holds it"; one line on the notification bar where the transcript is in scrollback.
- `$.ui.status`: "One per plugin; `undefined` removes it." Drawn as `⚠ <mod>: text` under the prompt (api.md).
- `$.ui.log`: dim transcript line "not sent to the model"; `{ to: 'debug' }` for the debug log; a `-p`/SDK host receives it as `ui_log`.
- `$.ui.blit`: repaint a mounted `Raster` (`{ requestId, key, columns, rows, cells }`) or swap a keyed `Image` source without running `ui.render`; "up to 120 a second taken, some sixty shown". Terminal only.

---

## 5. `$.mcp.call`, `$.mcp.connect`, `$.session.authorize`

### 5.1 Signatures and result — VERIFIED (DTS L2629-2664, L5784-5927)

```ts
call:    (server: string, tool: string, args?: Record<string, unknown>) => Promise<McpToolResult>
connect: (server: string) => Promise<McpConnectResult>

export type McpToolResult = { content: McpContentBlock[]; isError: boolean; structuredContent?: unknown };
export type McpContentBlock = { type: string /* text | image | audio | resource | resource_link */;
  text?: string; uri?: string; mimeType?: string; [field: string]: unknown };

type McpConnectResult =
  | { isConnected: true; server: string }
  | { isConnected: false; reason: 'unlisted' | 'unapproved' | 'disabled' | 'policy' | 'auth' | 'failed'; message: string };
```

- `structuredContent`: "The server's structured result, when its tool declares an output schema." So a mod calling the Fylgja server directly gets structured data if the tool declares `outputSchema`.
- Server naming: `server` is "the server's name as /mcp lists it (`claude.ai Gmail`; the tool-name spelling `claude_ai_Gmail` is accepted too)". For a plugin-shipped server that name is "usually `plugin:<plugin>:<server>`", or "the name the session already runs the same server under" (dedup). `tool` is the bare tool name on that server. The call is positional, "not the `{ tool: \"mcp__server__tool\", ... }` shape a `tool.call` hook sees". Robust pattern: `const c = await $.mcp.connect('fylgja'); if (c.isConnected) await $.mcp.call(c.server, 'tool', args)`.
- `$.mcp.connect(server)` takes "the server's key in this plugin's manifest" and only works for "the MCP servers this plugin's own manifest lists" (`unlisted` otherwise). "a server already connected answers at once." "Never rejects for a refusal".

### 5.2 Does it ride the session's authenticated connection? — VERIFIED

"Calls `tool` on one of the engine's connected MCP servers with the engine's own connection and credentials. A `cached` server is dialed on first use." The mod never sees the OAuth token and needs no auth of its own. OAuth done via `/mcp` is what the call uses.

Permission handling — sources disagree:
- DTS L2634: "No permission prompt: the plugin's call, seen by the hooks above it, is the grant."
- admin.md: "`$.mcp.call` | Calls a tool on a connected MCP server, under the session's permission rules".

Read together: no interactive prompt, but org policy mods and (per the admin page) rules can still refuse it. Whether a user `deny` rule on `mcp__plugin_fylgja_fylgja__x` blocks `$.mcp.call`: UNCERTAIN. Contrast with `$.tool.call({ tool: 'mcp__...', ...args })`, which runs "the permission check and its dialog, then the tool" and yields a `ToolCallResult`.

### 5.3 When the server needs sign-in

- **Detect: VERIFIED.** `$.mcp.connect('fylgja')` resolves `{ isConnected: false, reason: 'auth', message }` ("`auth`: needs sign-in"). `message` is "one plain sentence, to log or toast".
- **Trigger: no API. VERIFIED absent.** Nothing in `$.mcp`, `$.session`, or the event list starts an MCP OAuth flow or reports a connection state change. There is no `mcp.*` event besides the op events `mcp.call`/`mcp.connect` (every `$` call is an event for hooks above).
- **`$.session.authorize` is unrelated to MCP: VERIFIED.**

```ts
authorize: () => Promise<SessionAuthorization>
export type SessionAuthorization = { handle: string; kind: 'bearer' | 'api-key' } | null;
```

  "Holds the session's Anthropic credential on the host and answers an opaque handle and its kind; the secret never reaches the plugin. The handle is spent through `$.http.fetch(url, { auth: handle })`, which sets the credential header, only for a first-party host. Null with no first-party credential (a 3P provider, a gateway, no login)." It "rides https only" and is refused under `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`. It exists so built-ins (telemetry) can call Anthropic's own endpoints. It cannot authenticate to fylgja.lknblab.dev, and it does not expose the Fylgja/Zitadel token. A mod has no way to read the MCP OAuth token, so direct `$.http.fetch` to the Fylgja REST API has no credential; go through `$.mcp.call`.
- What `$.mcp.call` does against a server that needs sign-in (reject vs `isError: true`): UNCERTAIN. Wrap in try/catch and check `isError`.
- Workable UX from documented parts: on `auth`, `$.ui.toast('Fylgja: sign in with /mcp')` and/or `$.prompt.suggest({ text: '/mcp' })` (shown only while the box is empty). `$.command.run({ command: 'mcp' })` exists ("Runs a slash command as if the person typed `/command args` ... queued and run once the session is idle"; "Rejects ... inside a hook the turn is waiting on"), so a Button's `onPress` could open the /mcp panel: plausible but untested, UNCERTAIN.
- Observation from this session (not a documented contract): an unauthenticated server here exposes pseudo-tools `mcp__fylgja__authenticate` / `mcp__fylgja__complete_authentication`. A mod could notice that through `$.tool.list()`. UNCERTAIN as an API.
- Related classic events exist: `classic.Elicitation` ("Fired when an MCP server requests user input. Hooks can auto-respond (accept/decline) instead of showing the dialog") and `classic.ElicitationResult` (DTS L3808-3840).

---

## 6. `$.state`, atoms, `$.store`

### 6.1 Reactive model — VERIFIED (DTS L3308-3348, L649-690, L3661-3684, L11640-11775)

```ts
state: {
  get: <P, K>(ref: StateRef<P, K>) => Promise<StateRead<StateValue<P, K>>>;        // { value: T | undefined; version: number }
  set: <P, K>(ref: StateRef<P, K>, value: StateValue<P, K>, options?: { ifVersion?: number }) => Promise<StateSetResult>;
}                                                                                  // { isSet: boolean; version: number }
// helpers imported from 'claude-code' (the one bare import allowed):
export const atom: AtomFunction      // atom({ plugin, key } as const, initial[, { shape }]) -> Atom<T>
export const read: ReadFunction      // await read($, atomOrDerivedOrRef)
export const update: UpdateFunction  // update($, atom, fn): read, apply, write with ifVersion, retry on a miss
export const derive: DeriveFunction  // derive([a, b], (av, bv) => ...) cached by source versions
export const memberOf: MemberOfFunction // memberOf(family, e): the member keyed by e.requestId
```

- "Named values held by the host for the session, each with a version: plain data that survives a hot reload of the plugin's code. A `get` made while a `ui.render` hook draws subscribes that instance: a later `set` draws it again, nobody calling `$.ui.invalidate`."
- "Every `get` of one dispatch reads one moment, whatever is written meanwhile."
- Writes: "which must be this plugin's own; the sites that read it while drawing are drawn again, at the redraw rate. Refused while a `ui.render` hook draws ... JSON data ... never `undefined`."
- Compare-and-set: `ifVersion`; `update` wraps the retry loop.
- `plugin` and `key` "must be literals in source (`claude plugin validate` lists them); only a family member's `id` may be computed." Undeclared values fail validation (`hello-tabs.count is not declared`).
- `derive` "holds nothing on the host: the cache is the plugin's own, lost with a reload".
- `Shaped<T>` / `atom(..., { shape })`: a version tag so reloaded code "finds the value absent" when the shape changed.

### 6.2 `PluginState` in `types/index.d.ts` — VERIFIED

```ts
// <plugin>/types/index.d.ts, named by "types": "./types/index.d.ts" in plugin.json
declare module 'claude-code' {
  interface PluginState {
    fylgja: {
      query: string
      results: { id: string; title: string }[]
      isOpen: StateFamily<boolean>        // one value per id
    }
  }
}
export type StateFamily<T> = { readonly byId: T };   // marker; the ref must carry id: string
```

`StateFamily` is the per-row tool: `const open = await read($, memberOf(isOpen, e))` reads the member for the row being drawn (`e.requestId`, i.e. the `tool_use_id`), and a write to that member redraws only the rows that read it. That is the right primitive for "expand/collapse this Fylgja tool result" without redrawing every tool row.

### 6.3 Sharing and lifetime — VERIFIED

|Store|Scope|Lifetime|Notes|
|-|-|-|-|
|module variable|one loaded module instance|until reload (every save under `--plugin-dir`; `calls` resets)|tests start with fresh module state|
|`$.state`|one session, host-held|until session end, `/clear`, `/resume`, `/branch`|"Any plugin reads any value; its owner alone writes it." Another plugin changes it by hooking `state.set` and rewriting `e.value`|
|`$.store`|one plugin, all sessions on the machine|until deleted, or untouched for `cleanupPeriodDays`|JSON file under `~/.claude/plugins/store/`; 4 MiB total; `get` then `set` is not atomic|

- `$.state` is NOT shared across sessions. Cross-session sharing is `$.store` only, with last-writer-wins races ("Give each item its own key"; "Read again right before you write").
- After `/clear`, `/resume`, `/branch`, `session.start` does not fire; reload from `$.store` in `on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, ...)`.
- `$.store.set` round-trips through JSON: "a Date is its ISO string, an `undefined` field is dropped, a Map or Set is `{}`."
- There is no `$.store` change notification; another session's write is seen only on the next `get`.

---

## 7. `$.tool.register`, `tool.describe`, `tool.call`

### 7.1 Result object shape — VERIFIED (DTS L12365-12458)

```ts
export type ToolCallResult<Name extends string = string> =
  | { deny: string }
  | { result: ToolResultOf<Name>; context?: readonly string[]; ref?: number; text?: string; isReadOnly?: true }
  | { isError: true; result: unknown; text?: string; ref?: number; context?: readonly string[]; isReadOnly?: true };
```

- "From core the result is `{ ref, result, text }` or, when the tool reported an error, `{ ref, result, text, isError }`".
- `result`: "The tool's output: from core the tool's record ... from a hook, its own. Core validates a hook's answer against the tool's output schema when it has one, maps it for the model with the tool's own mapper, and records it in the transcript as the tool's result."
- `text`: "Set by core: the result as the model reads it (text blocks joined), present whatever the tool".
- `ref`: "names the messages core produced for the call (they stay on the host side). A hook that returns the object it got makes core use them verbatim."
- For an MCP tool `result` is typed `unknown` (see 1.5).

Event input: `e.tool`, `e.tool_use_id`, the arguments spread flat (`e.id`, `e.query`), plus `e.agentId` in a subagent. `tool`, `tool_use_id`, `agentId` are reserved. `DTS-mcp` types the arguments of connected MCP tools after a save with the server connected, so `e.tool === 'mcp__plugin_fylgja_fylgja__search'` narrows `e`.

### 7.2 Wrapping an MCP tool's result (trim for Claude, keep full for the UI)

**Returning a modified result after `await next(e)` — VERIFIED as allowed** (events.md: "You can also change the result: `await next(e)`, then return a copy of the result with a field replaced"; DTS: "from a hook, its own").

```js
const full = new Map()   // tool_use_id -> full result, for the UI

on('tool.call', { tool: /^mcp__plugin_fylgja_fylgja__/ }, async ($, e, next) => {
  const r = await next(e)
  if (r.deny || r.isError) return r
  full.set(e.tool_use_id, r.result)
  $.ui.invalidate('ui.render')
  return { result: trimmed(r.result), context: r.context }     // drop ref and text: this is the hook's own answer
}).catch(async ($, e, next) => next(e))   // not a guard: if the wrapper fails, let the call through untrimmed
```

Caveats:
- **`ref` interplay: UNCERTAIN.** If you spread `r` and only change `result`, the object still carries core's `ref`, and "A hook that returns the object it got makes core use them verbatim". Whether core then honours your changed `result` or its own stored messages is not stated. Return a fresh object without `ref`/`text` when you mean to replace.
- The replacement is what gets stored: core "records it in the transcript as the tool's result". So `ToolUse.props.output` on later draws (and after resume) is the TRIMMED result. The full copy lives only where the mod put it; a module `Map` dies on reload, so persist to `$.store` if old rows must show full data (mind the 4 MiB cap), or re-fetch with `$.mcp.call` on demand.
- The replacement must validate "against the tool's output schema when it has one" and is mapped "with the tool's own mapper". For an MCP tool with an `outputSchema`, a trimmed object must still fit it. What shape core expects back for an MCP tool is the same open question as 1.5.
- `context` must be carried through: "Kept whole from `next`".
- A deny returned after `next` "undoes nothing: a tool that ran has run".

**Cleaner alternative: rewrite what the model reads at `session.append`, leave the record alone — VERIFIED by quotes, behaviour to be confirmed.**

```js
on('session.append', { door: 'tool-result' }, async ($, e, next) => {
  if (e.origin.kind !== 'tool' || !e.origin.tool.startsWith('mcp__plugin_fylgja_fylgja__')) return next(e)
  const content = e.message.content.map(b => b.type === 'tool_result' ? { ...b, content: slim(b.content) } : b)
  return next({ ...e, message: { ...e.message, content } })
})
```

- "Fires once per row a conversation of this session keeps (a prompt, a response block, a tool result, a notice), before it is stored. `next({ ...e, message })` rewrites `content`: stored and sent after." (L4262)
- "Not on `e`, so stored as made: a tool result's structured record, the row's timestamps ..." (L10231). So the model-facing `tool_result` blocks are rewritable while the structured record (what `ToolUse.props.output` shows) is kept whole. That is exactly "trim for Claude, full for the UI" with no side cache.
- Rewritable: "text blocks, a tool_result's `content` and `is_error`. Media blocks may be dropped or moved, not changed or added. Thinking, tool_use, unknown kinds and every tool_result's `tool_use_id` are put back."
- Costs: the hook sees every row of the conversation (admin.md flags `session.append` as "the mod can rewrite each row of the conversation before it's stored"); "The screen, an SDK stream or Remote Control may show the row just before its rewrite". The hook must relay: "one that answers without `next`, or another row, is skipped."
- UNCERTAIN: that `ToolUse.props.output` is fed from the untouched structured record rather than from the rewritten content. The two quotes imply it; confirm in a session.

### 7.3 Adding context for Claude without denying — VERIFIED

`context?: readonly string[]` on the result: "What the model reads after the tool's result and the user never sees. From core, none. One reminder, as a PostToolUse hook's is, after the managed tier's review; none on a plugin's own `$.tool.call`. Kept whole from `next`, none empty, any length: past 100,000 (200,000 together) head + path."

```js
on('tool.call', { tool: 'Read' }, async ($, e, next) => {
  const result = await next(e)
  if (result.deny) return result
  return { ...result, context: [...(result.context ?? []), 'This file is covered by meeting abc123 decisions: ...'] }
})
```

This is the built-in agents-md pattern verbatim (`gh-claude-code/mods/agents-md/hooks/register.ts` L245-253: `{ ...result, context: [...(result.context ?? []), ...attached.map(Frames.nestedFrame)] }`). Here spreading `result` (keeping `ref`) is what Anthropic's own code does, so adding `context` to core's object is safe.

Other `tool.call` facts:
- Rewrite arguments: `next({ ...e, query: fixed })`; "a rewrite is checked against [the tool's] schema". In auto mode a rewritten input can be denied with "a hook changed this call's input after the model wrote it".
- Retry: call `next(e)` again.
- Answer without running: `{ result }` — no permission prompt, tool does not run.
- `e.consent` (reserved key, for `$.tool.call`): "the person's own words for the press that raised the call ... which the permission path reads as the user's request."
- A guard that fails is skipped and the tool runs; attach `.catch(($, e, next) => next.called ? next(e) : { deny: 'no' })`.

### 7.4 `$.tool.register` and `tool.describe` — VERIFIED

```ts
register: (tool: ToolSpec) => Promise<{ tool: string }>          // full name mcp__<plugin>__<name>
export type ToolSpec = { name: string; description: string; inputSchema?: Record<string, unknown> };
list:  () => Promise<ToolInfo[]>                                 // { name, description, mcp: boolean }
check: (input: { tool, input }) => Promise<ToolCheckResult>      // { decision, reason?, rule?, ceiling? }; runs nothing
export type ToolDescribeInput  = { tool: string; description: string; isDeferred?: true; provider: Origin };
export type ToolDescribeResult = { description: string; isDeferred?: boolean };
```

- `register`: "Declares a tool the model can call from the next prompt on ... Serve it with a `tool.call` hook on `{ tool: \"mcp__<plugin>__<name>\" }` that returns the result (a call no hook answers fails); a name registered again is replaced. Rejects until the session binds, at `session.start`." There is no `outputSchema` and no annotations field on `ToolSpec`. Under an org MCP allowlist, sec-default "refuses a user-tier tool.register".
- `tool.describe`: "Fires once per tool, when the engine first renders the tool's schema in a session ... Cached for the session until `$.ui.invalidate(\"tool.describe\")`: an unstable answer spends the model's prompt cache. An explicit `isDeferred` moves the tool behind ToolSearch (true) or into the prompt's list (false)." Useful for Fylgja: pin the two or three most-used MCP tools with `isDeferred: false` and sharpen their descriptions without touching the server. `provider` for a configured MCP server's tool is `mcp:<server>`. A managed MCP server's descriptions are protected by sec-default.

---

## 8. One paragraph each

**`$.model.complete`** — `(request: { model, prompt, system?, maxTokens?, effort?, timeoutMs? }, options?: { signal }) => Promise<ModelCompleteResult>`. One stateless text completion "through the session's own API client and credentials": "No tools, no history, no system prompt beyond the CLI's identity block and `request.system`". `model` is an alias (`haiku`) or a full id, "allowlist-checked like a `--model` value". `maxTokens` defaults to 1024 (cap 64,000 or the model's limit), `effort` is `low|medium|high|xhigh|max`. Provider failures never reject: branch on `isAnswered` and `reason` (`api-error` with `status`/`error`, `empty-reply`, `aborted`); `usage` (four token counts) is on every arm. Only a request the engine refuses to send rejects. The wait is free against the hook budget; bound it with `timeoutMs`. It bills the user's plan or API key, and it goes to Anthropic (or the configured provider), which matters for Fylgja's EU/data posture if meeting content is put in the prompt.

**`$.model.fork`** — `({ prompt }) => Promise<ModelForkResult>`. "Runs one tool-less completion over the session's OWN transcript as the main thread last sent it, so the API serves that prefix from its cache": same model, system prompt, tools and messages with `prompt` appended, "every tool denied, its own tail never cached, the prefix billed afresh once the entry lapsed or after `/model`". Extra arm `reason: 'nothing-to-fork'` before the first response and after `/clear`. Use it for "summarize what we just decided" side questions that need the conversation; it is cheap only while the cache entry is warm.

**`$.model.classify`** — `(text, labels: readonly string[] (2+), options?: { model }) => Promise<string | undefined>`. One completion "with a fixed classifier prompt"; resolves to the label or `undefined` "when the answer named none of `labels`". Unlike `complete`, "A failed request, an abort or a reply with no text rejects". Default model is "the engine's small fast model". Good for gating (is this prompt about a meeting?) at `prompt.submit`, at the price of a model call per prompt.

**`$.agent.register`** — `(spec: AgentSpec) => Promise<{ agent: string }>`. Defines a subagent type `<plugin>:<name>` "the Agent tool dispatches from the next turn on". `AgentSpec` carries every agent-file field: `name`, `description`, `prompt` (replaces the system prompt), `tools`, `disallowedTools`, `model`, `effort`, `permissionMode`, `mcpServers`, `hooks`, `maxTurns`, `skills`, `initialPrompt` (with `{{intent}}`), `memory`, `background`, `omitClaudeMd`, `isolation: 'worktree' | 'remote'`. Re-registering replaces; unloading the plugin removes it. An `agent.offer` hook answering `{ isOffered: false }` hides the type from the model while the plugin can still spawn it, which gives a private worker (the DTS example pairs it with a `mcp__lab__run` tool).

**`$.agent.spawn`** — `({ prompt, description?, subagentType?, model?, name?, cwd? }) => Promise<{ model, agentId } | { deny }>`. Starts a subagent "in the background under this call's origin"; the call resolves when it has started, and "its answer is its `turn.complete`" (match `e.agentId`). `$.agent.list()` returns `AgentInfo[]` with status `pending|running|waiting|idle|completed|failed|killed`; `$.session.messages({ agentId })` reads its transcript; `$.session.send({ to: { agentId }, text })` talks to it. The `agent.spawn` event lets a hook pick the model or deny any spawn, teammates included.

**`$.audio`** — `play(clip, options?)` plays `{ asset }` (a file in the plugin dir), `{ url }` (engine-fetched) or `{ base64, mime }`, with `shouldLoop`, `gain`, and an abort signal; "clips are not queued, so two calls play together". `speak(text, { voice? })` uses "the platform's own synthesizer (`say` on macOS)", queued among utterances. Platform reality: "`afplay` plays it on macOS, and a Linux or Windows terminal, having no player, plays nothing"; `speak` rejects "when there is no synthesizer". On this Linux box both are effectively no-ops.

**`session.attach` / `session.detach`** — observe-only events for remote clients joining or leaving "the session's roster of attached surfaces" (the Desktop app connecting, a phone via Remote Control). Input `{ surface, clientId, viewport? }`, detach adds `reason: 'detach' | 'end'`; `next(e)` echoes `{ clientId }` and "a hook's own value changes nothing". "the terminal's attachment is the REPL's binding and raises nothing." Use: open or re-seat a pane when a surface that can draw it appears. A detach with reason `end` runs inside `session.end`'s short bound.

**`session.measure`** — observe-only push of `$.session.usage()`'s figures: `{ context, rateLimits, cost?, changed: UsageUnit[] }`, fired "after each main-thread turn, and when a rate-limit window moves a whole point", "One at a time, a burst folding into one more". No `context.breakdown`; call `$.session.usage({ breakdown: 'full' | 'summary', columns })` for that. It replaces polling for context-fill or limit warnings (token-weather predates it and polls on `turn.complete`).

**`$.session.surfaces` / `repo` / `id`** — `surfaces(): Promise<readonly RenderSurface[]>` lists "every surface the session draws on, each once: `terminal` under the REPL first, then the remote ones"; "Empty in a plain -p run"; `surface()` is deprecated. `repo(): Promise<SessionRepo | null>` returns `{ root, remote, internal, name }` read from the working copy on each call (`root` is the main working tree for a worktree; `internal`/`name` concern Anthropic's own repo allowlist and are `false`/`null` elsewhere). `id()` is "the session's id (the transcript file's name)". Others in the namespace: `cwd`, `root` (project root, follows `/cd` and worktree moves), `model`, `turns`, `usage`, `version` (`{ version, base, builtAt }`), `messages`, `compact`, `send`, `append`, `authorize`. For Fylgja, `id()` + `repo()` + `cwd()` are the keys to link a Claude Code session to a captured dev session without parsing transcripts.

**`prompt.attachment`** — fires "once per message the engine injects for the model on its own (a reminder, a mode transition, a listing, a mentioned file, a hook's context), as a request carries it". Input is a union on `type` with `origin: { kind: 'engine' } | { kind: 'hook', event } | { kind: 'plugin', event }` and, for `plan_mode*` types, a typed `detail`. Return `{ text }` to rewrite or `{ text: null }` to drop. "The answer holds per attachment for the process (asked again on resume or `$.ui.invalidate`); the transcript keeps the engine's record." It is how a mod edits or removes system reminders, the rendered text of an `@file`, or another plugin's injected context; unstable answers cost prompt cache.

**`attribution.text`** — fires "when the engine composes a git text the model is to write (`kind`: `commit`, `pr`, `exemption`, `remedy`)"; input `{ kind, text }`, result `{ text }`. Example in the DTS: `on("attribution.text", { kind: "commit" }, () => ({ text: "" }))`. That is a code-level way to enforce this repo's "no co-author lines" rule (the `Co-Authored-By` trailer and the PR footer) instead of relying on instructions. "A hook that fails passes it through."

**`skill.prompt`** — fires "when the engine expands a skill's prompt for the model (`/name`, the Skill tool, a preload)": "the same event at each". Input `{ skill, text }`, result `{ text }`. A mod can append live data to a skill at expansion (for example current Fylgja context into the plugin's own skills), swap a skill's text, or audit which skills run. Matcher: `{ skill: 'commit' }`. Text that changes between requests spends the prompt cache.

---

## 9. Authoring constraints

### 9.1 Module format — VERIFIED

- Entry: `hooks/hooks.json` → `"modules": ["./register.js"]` (an array with ONE path, relative to `hooks.json`). The file exports `register(on, options)`; `Register = (on: On, options: PluginOptions) => unknown`, "Its return is dropped, a promise awaited".
- Extensions: `.ts, .tsx, .jsx, .js, .mjs, .cjs, .mts, .cts`, "an ES module whatever its suffix: there is no `require`."
- **TypeScript and JSX are handled natively**: "You don't need Node.js, a bundler, or a build step, because Claude Code loads `.js` and `.ts` files directly." Types are stripped, not checked at load; type-check with `tsc -p <mod>` against the generated `tsconfig.json`.
- Runtime: "A hooks module runs in an environment of its own: no DOM, no Node." Installed mods "share one worker thread" (troubleshoot.md); the debug log shows `loaded (worker, environment 2, tier user)`. A hook that blocks the thread gets the mod unloaded ("it crashed the hooks worker").

### 9.2 Imports, npm, bundling — VERIFIED (probe)

- Local files: yes, "Import only from files inside the plugin directory, by relative path." The built-in diff mod spans dozens of files across subfolders with `index.ts` barrels and extensionless imports; my probe's `import { chip } from './util'` passed validation.
- npm packages: **no**. Probe output: `cannot import "lodash" (from hooks/register.tsx): a hooks module imports its own files by relative path and "claude-code", nothing else`. The one bare import is `claude-code` (types, plus `atom`, `read`, `update`, `derive`, `memberOf`).
- Dynamic `import()`: refused ("A module holding `import()` does not load").
- Bundling: not documented. A pre-bundled single `.js` is just a local file, so pure-JS dependencies can be vendored by bundling; but the bundle must still satisfy static analysis (literal `on('event', ...)`, literal `$.ns.method(...)`, no `$` aliasing, no `eval`/`new Function`, no Node built-ins, no `WebAssembly`), and minifiers that rename or wrap `$`/`on` will break it. UNCERTAIN in practice; vendoring source files is the safe route.

### 9.3 Static-analysis rules (load-time, same as `validate`) — VERIFIED (create.md)

- Write `$.<namespace>.<method>(...)` in full. `const ui = $.ui` fails with `$.ui is used as a value`; no destructuring, no computed index.
- `$` may be passed to a function "declared at the top level of the same file" (reported as `$.store.get (via loadNotes)`). "Passing `$` to a method, a function defined inside the hook, or a function you import from another of your files fails validation" (`read`/`update` from `claude-code` are the exception). The diff mod works around this by building a `Host` object of closures in `register.ts` (`gh-claude-code/mods/diff/hooks/host/host.ts`) and passing that to its other files.
- Event names in `on(...)` are string literals; no loops over names. Do not shadow `on`.
- One registration per event per matcher: two unmatched `on('session.start')` fail the load.
- `$.env.get/set` names and `$.state` `plugin`/`key` are literals. `Client` `module` is a literal path.

### 9.4 JSX — VERIFIED (DTS L14296-14340)

- Classic runtime with globals `h` and `Fragment`: "The JSX factory (classic runtime, `@jsx h`; the engine prepends the pragma)". tsconfig: `"jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment"`. Not React; there are no hooks, components are plain functions returning element data.
- "there are no intrinsic (string) tags": every tag is a constructor from `$.ui.resolve(e)`, destructured first. `<>...</>` is "a column Box around the children".
- A module "never declares, imports or takes as a parameter anything named `h` or `Fragment` where it writes JSX, and carries no `@jsx` pragma of its own".
- `false`, `null`, `undefined` children are dropped; numbers are stringified.

### 9.5 Globals — VERIFIED (DTS L14296-14432)

`h`, `Fragment`, `AbortSignal` (`abort`, `timeout`, `any`), `AbortController`, `TextEncoder`, `TextDecoder`, `URL` (with `canParse`), `URLSearchParams`, `atob`, `btoa`, `structuredClone`, `crypto` (`subtle.digest` only, `randomUUID`, `getRandomValues`), `performance.now()`. ES2023 built-ins (the samples use `Uint8Array.prototype.toBase64` / `fromBase64`). "these and no others". Absent: `setTimeout`/`setInterval` (use `$.clock`), `fetch` (use `$.http.fetch`), `process`, `Buffer`, `require`, `console` in a hooks module (a surface module has one; log with `$.ui.log(text, { to: 'debug' })`), `eval`, `new Function`, `WebAssembly` ("a module that needs compiled code runs it in a process of its own through `$.process.run`").

### 9.6 `userConfig` → `options`, and `dependencies` — VERIFIED

- `register(on, options)`: `PluginOptions = Readonly<Record<string, string | number | boolean | readonly string[]>>`, "the values of the `userConfig` fields the manifest declares, with defaults filled in". A required field with no value fails the load (`options do not fit plugin.json userConfig`). "A string field that declares `options` holds one of them: `/config` draws it as a picker". When options change the module reloads and "`register` runs again with the new object. Hooks close over it." Values live in `pluginConfigs` keyed by `<name>@<marketplace>`, or `<name>@inline` under `--plugin-dir`. Example manifest: agents-md's `userConfig.instructionFiles` (`type`, `title`, `description`, `required`, `default`, `options`).
- `$.config.list()`/`$.config.set()` and the `config.set`/`config.describe` events cover `/config` rows, plugin `userConfig` fields included.
- `dependencies` in `plugin.json`: (a) ordering, "a mod runs before the mods it lists under `dependencies`"; (b) typing, the engine writes "one entry per plugin the mod's plugin.json lists under \"dependencies\" (that plugin's own contract): what it adds to `$` in engine.create". A plugin exposes a namespace by hooking `engine.create` and shipping a `types` contract that declares it on `EngineInterface`; a `user`-tier step may add nouns but not replace or withhold others'.

### 9.7 Tests — VERIFIED (test.md, DTS `claude-code/testing`)

```ts
import { describe, expect, mock, test, tier } from 'claude-code/testing'
export const test: (name: string, ...rest: [body] | [options: TestOptions, body]) => void
export type TestBody = ($: Engine, on: On) => unknown
export type TestOptions = { plugins?: readonly Plugin[]; timeoutMs?: number; options?: PluginOptions }
```

- Run: `claude plugin test [dir]` — "Runs every *.test.ts and *.test.tsx under dir, each file in a child of this binary ... Exits 1 when a test fails." No session, sign-in, or network. 5 s per test unless `timeoutMs`.
- The test's `$` is the engine: each method FIRES the event of that name through the mod's hooks: `$.tool.call({ tool: 'Bash', command: 'ls' })`, `$.command.run({ command, args })`, `$.prompt.submit(...)`, `$.session.start({ surface: 'terminal', isInteractive: true, cwd })`, `$.turn.complete(...)`, `$.turn.step(...)` (a stream), `$.classic.Stop(...)`, and the rest of `EventCalls`.
- The test's `on` registers STUBS beneath the mod. For a mods API call, name it without `$.` and return `{ value }` (or `{ deny: reason }` to make it reject): `on('mcp.call', ($, e) => ({ value: { content: [{ type: 'text', text: '...' }], isError: false, structuredContent: {...} } }))`, `on('store.get', ($, e) => ({ value: saved.get(e.key) }))`. For an engine event, return that event's own result: `on('tool.call', () => ({ result: 'ok' }))`, `on('prompt.submit', ($, e) => ({ text: e.text }))`, `on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))`.
- Rules: register every stub before the first call on `$`; `session.start` does not fire by itself; an unanswered call throws `no implementation for <name>`; a stub that returns a bare value fails with `returned neither { value } nor { deny }`. `$.ui.invalidate` and `$.state` are answered by the kit.
- Mocks: `mock.clock(on, { now? })` → `advance(ms)`, `set(ms)`, `now()`, `settle()`, `sleep(ms)`; `mock.store(on, entries)`; `mock.env(on, vars)`.
- Drawing: `const ui = await $.ui.mount({ plugin, component, requestId, surface, viewport, props })` returns `drawn()`, `find(query)`, `findAll`, `press({ key })`, `input({ key, text, kind? })`, `select({ key, value })`, `key(event)`, `pointer(event)`, `post(data)`, `advance(ms)`, `resize(size)`, `redraw(props?)`, `unmount()`. Run the same body over `['terminal', 'desktop']` to check per-surface validity. "It exercises the mod ... never a surface's paint".
- Policy tests: `tier('prepend')` at file top; `{ plugins: [{ name, register, tier? }] }` to seat inline mods; `options` to pass `userConfig` values.
- `expect`: `toBe`, `toEqual`, `toMatch`, `toMatchObject`, `toContain`, `toBeDefined`, `toBeUndefined`, `toThrow`, `.not`.

### 9.8 Hot reload, validate output, what a reviewer flags — VERIFIED (probe + docs)

- `claude --plugin-dir ./mod`: watches the directory and reloads the hooks module on save; each reload re-runs `register`, re-fires `session.start` for that mod, resets module variables, cancels timers, keeps `$.state` and open panes. A broken save prints `reload failed, the previous version stays loaded:`. Tree-validation refusals are printed in the transcript only in this mode. Non-interactive: `CLAUDE_CODE_PLUGIN_DIR_WATCH=1`. For apps without a flag (Desktop): `CLAUDE_CODE_PLUGIN_DIRS`. Installed plugins are cached by version; edits do not reach them. The mod directory is a protected path for Claude's own edits. `/reload-plugins` reloads on demand.
- `claude plugin validate <dir> [--strict] [--json]`. Actual 2.1.291 output for my probe:

```text
  ❯ ./register.tsx hooks: tool.call{tool=/"^mcp__plugin_fylgja_fylgja__"/}, prompt.submit, prompt.edit, ui.render{component=UserMessage}
  ❯ ./register.tsx gating hook without .catch: tool.call{tool=/"^mcp__plugin_fylgja_fylgja__"/}
  ❯ ./register.tsx gating hook without .catch: prompt.submit
  ❯ ./register.tsx calls: $.mcp.call, $.ui.resolve

✔ Validation passed
```

  Also possible: `env reads:`, `env writes:`, `state reads:`, `state writes:`. The `gating hook without .catch` line is not in the doc pages; it is real output. `--json` gives `{ success, strict, target, manifest: { errors, warnings, notes, gatingHooks }, contents: [{ file, type: 'hooks', errors, warnings, notes: [...], gatingHooks: [{ module, pattern, hook, hasCatch }] }] }`.
- The same lists reach a policy mod as `plugin.register`'s `e.uses = { events, calls, env?, state? }`, calls spelled `fs.read` without `$.`.
- What an org reviewer is told to look for (admin.md "Review what a mod can do"):

|On the `calls:` line|Why|
|-|-|
|`$.fs.read`, `$.fs.write`|"Reads or writes files anywhere the user can"|
|`$.process.run`, `$.process.spawn`|"Starts programs as the user"|
|`$.http.fetch`|"Makes network requests"|
|`$.env.get`, `$.settings.read`|"can hold API keys"|
|`$.env.set`|changes what later commands and MCP servers run|
|`$.mcp.call`|"Calls a tool on a connected MCP server"|
|`$.model.complete`|"Uses the user's plan or API key"|
|`$.prompt.submit`|"can send it as the user's own words"|
|`$.session.send`|messages another session's or subagent's Claude|

  On the `hooks:` line: `tool.call` and `prompt.submit` ("sees every tool call and every prompt, and can change them"), `session.append` ("can rewrite each row of the conversation"), `ui.render{component=AskUserQuestion}`, `tool.check` ("can approve or deny a tool call before a permission prompt appears"). The admin page's own example policy mod blocks `process.run` and `process.spawn`.
  Implication for a Fylgja mod: `$.mcp.call` + `prompt.submit` + `tool.call` are unavoidable and already flagged; keep `$.process.run` (the `xdg-open` button), `$.http.fetch`, `$.fs.*`, and `session.append` out unless they earn their place, and narrow `tool.call` with a matcher so the `hooks:` line reads `tool.call{tool=/^mcp__plugin_fylgja_fylgja__/}` rather than a bare `tool.call`.
- Plugin `name` must not look like Anthropic's (`claude-` prefix fails validation).

---

## 10. Unsupported, experimental, pitfalls

Stability:
- DTS line 4: "EARLY ACCESS: this surface may change between releases without notice." create.md: "The events and methods can change between releases, so trust these files over any page". mods/README: "the API these mods are written against may change between releases without notice."
- Anthropic can disable installed mods remotely: "`hooks modules are turned off in this process` — Anthropic has turned installed mods off remotely. No setting on your machine turns them back on."
- Version floor: CLI 2.1.287, Desktop 2.1.286; `ui.fault` needs 2.1.289. `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` is ignored from 2.1.287.

Where mods run (overview.md "Where mods run"):

|Place|Hooks run|Drawing|
|-|-|-|
|Terminal CLI|yes|yes|
|Desktop app Code tab (not WSL)|yes|yes, except terminal-only elements (`Raster`, `Image`)|
|Desktop WSL session|no ("plugins aren't available in WSL sessions")|no|
|VS Code extension chat panel|yes|no|
|`claude -p` and the Agent SDK|yes|no|
|Remote Control (claude.ai, mobile)|yes, in the session on your machine|in the terminal on your machine|
|Cloud session|yes, if the plugin reaches the cloud session|no|

So any feature that depends on drawing (chips, panes, prompt decoration) silently does nothing in VS Code, `-p`, SDK and cloud, while the `prompt.submit`/`tool.call` logic still runs there. Design the model-facing behaviour to be correct with no UI. In `-p`: `$.ui.ask` rejects, `$.prompt.read` is empty, `$.prompt.fill` returns `no_composer`, `$.ui.selection` is `undefined`, `$.session.surfaces()` is empty, stored tool records may be trimmed.

Surface-specific:
- Terminal only: `Raster`, `Image`, `$.ui.blit`, sites `ToolProgress`, `TurnDuration`, `InfoNotice`; `PromptHint.tail`; Button `action` chords; `$.ui.copy` ("a remote surface has no path yet").
- Terminal + desktop only: `Spinner`, `SessionMode`, `PromptHint`, `AbovePrompt`, `Client`.
- Desktop/remote only: `Svg`. In the terminal "a pane that returns only an `Svg` opens empty".
- `Link` on a remote surface: `https:` only.
- `$.process`: "CLI only". `$.audio`: macOS only in practice.
- Mouse hover and Markdown link presses need a surface that reports the pointer ("the fullscreen terminal").

Prompt cache:
- events.md: text from `prompt.section`, `prompt.context`, `skill.prompt` hooks "that changes between requests invalidates the prompt cache".
- `prompt.section`: "Cached until `$.ui.invalidate(\"prompt.section\")`: an unstable answer spends the prompt cache every call".
- `tool.describe`: "an unstable answer spends the model's prompt cache".
- `prompt.compose`: sections are `shared` or `session`; "`shared` text reads the same for everyone on this build and model ... text that varies hits that cache for nobody"; a list with a `shared` section after a `session` one skips the hook.
- `prompt.submit` `context` rides the user turn, after the cached prefix, so per-prompt meeting context does not invalidate the cache. Prefer it over system-prompt edits for dynamic data.
- `$.model.fork` is cheap only while the cache entry is warm; "billed afresh once the entry lapsed or after `/model`".

Timeouts and failure semantics:
- 10 s of the hook's own time per event; 50 ms for `prompt.edit`; 1 s for a `.catch`; `session.end` hooks share about 1.5 s; `$.process.run` 30 s default, 10 min max. Waiting on `next` or a `$` call is free, except `$.clock.sleep`, and "Time spent awaiting a promise of your own does count."
- A failed hook is SKIPPED, which fails open: a guard that throws lets the tool run and the prompt through. Add `.catch` to every gating hook; `validate` lists the ones without.
- `session.start` is "Not after `/clear`, `/resume`, or `/branch`"; a hook that throws mid-`session.start` (for example `$.command.register` on a built-in's name) skips the rest of that hook. Register commands last or in try/catch.
- `focus: false` (or any `false` for the `true`-only flags) throws.
- `await $.prompt.submit(...)` resolves when the new turn starts: "don't `await` it in a handler that runs while Claude is working."
- `$.command.run` "Rejects ... inside a hook the turn is waiting on."
- Installed mods share one worker; a non-yielding loop gets the mod unloaded; three unattributed crashes unload every non-built-in mod until `/reload-plugins`.
- Auto mode: rewriting a tool input in `tool.call`/`turn.step` can yield "a hook changed this call's input after the model wrote it".
- An invalid tree fails as a whole and the engine draws its own; the reason is visible only under `--plugin-dir` or in the debug log.

Security and data:
- "None of these controls sandboxes a mod. A mod you allow runs as the user". Deny rules do not cover a mod's own `$.fs`/`$.process` calls.
- Org controls: `allowManagedModsOnly` blocks user mods, `--plugin-dir` mods and Claude-written mods; `disableSideloadFlags` rejects `--plugin-dir`; `disableAllHooks`, `--safe-mode`, `--bare`, an untrusted directory all stop mods. sec-default loads on machines with managed settings or Team/Enterprise sign-in and prevents a user mod from changing the system prompt, managed hooks, managed MCP tool descriptions, or lifting deny rules. A Fylgja mod shipped to Zalion would count as a user's mod unless the org lists the plugin as managed.
- `$.settings.read()` returns everything unfiltered, "`env` and the helper commands included". Not needed for Fylgja; avoid it.
- Customer-data note for this project: `$.ui.log`, `$.ui.toast`, the debug log, and `$.store` (a plain JSON file under `~/.claude/plugins/store/`) are all places meeting content could end up at rest outside Fylgja. Cache ids and titles at most.

Explicitly not possible (stated or absent from the full API):
- Changing the permission prompt (only `$.ui.notice` adds a line).
- Owning or replacing the prompt box, adding entries to the engine's typeahead or `@` menu, new global keybindings, binding Tab/arrows (outside a `Client`).
- Reading the clipboard; reading the MCP OAuth token; triggering MCP sign-in.
- Pressing another mod's button ("The mods API has no method that presses another mod's button").
- npm imports, dynamic import, Node APIs, DOM, timers, WebAssembly, eval.
- Returning `null` from `ui.render` (not in the type).
- Multi-line inputs, checkboxes, images on Desktop (use `Svg`), images in the terminal on Desktop.

Open items to settle in one interactive `--plugin-dir` session (all marked UNCERTAIN above):
1. Shape of `ToolUse.props.output` and `tool.call` `result` for a Fylgja MCP tool (is `structuredContent` there?).
2. Whether an empty/`display: 'none'` Box collapses a transcript row.
3. Whether `prompt.edit` (decorations) fires in the Desktop app; whether Tab/Enter reach it.
4. `session.append` tool-result rewrite: does `ToolUse.props.output` stay full?
5. Returning `{ ...r, result: changed }` with core's `ref` still attached: which wins.
6. `$.mcp.call` on a server needing sign-in: reject or `isError`. Does a user deny rule apply.
7. Terminal handling of an OSC 8 `fylgja://` link; `$.process.run(['xdg-open', ...])` from the Desktop app.
8. `prompt.mention` for a non-file `@token`.
9. `borderStyle` values beyond `round`.
10. What is drawn while an async `ui.render` is pending; whether main-screen scrollback rows ever repaint.
