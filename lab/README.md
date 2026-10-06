# Fylgja mod lab

Experiments: each folder here is a small, self-contained Claude Code plugin with a mod, built to find out what is useful. None of them is shipped; the real plugin lives in `../fylgja/`.

Try one (several `--plugin-dir` flags may be combined):

```bash
claude --plugin-dir /home/lukas/dev/private/fylgja-mod-lab/lab/<name>
```

Then sign in to Fylgja with `/mcp` if asked. Each experiment's own README says what to type.

## Rules every experiment follows

These are the product's rules, and they hold in the lab too.

1. **Nothing is added to what Claude reads, and nothing Claude does is changed.** No context attached to prompts, no prompt or tool call rewritten, no tool registered for Claude, no turn started. Fylgja gives Claude tools; Claude decides what to fetch. An experiment is for the person at the keyboard.
2. **Quiet until asked.** An experiment draws only after something the person did: a command they typed, a link or chip they clicked, a trigger they typed in the prompt box. Claude's own tool calls are never redrawn. Nothing appears on a timer or at session start except a sign-in hint.
3. **Never delay a prompt.** No awaited network work on the path of a submitted prompt or a keystroke.
4. **Customer data stays in memory.** Titles, summaries, transcript text and search queries are never written to `$.store`, the debug log, a file, or an exception message. Module memory only, bounded.
5. **Read-only towards Fylgja and everything else.** Only read tools are called. No `$.process.*`, `$.http.*`, `$.fs.*`, `$.env.*`, `$.settings.read`, `$.prompt.submit`, `session.append`, `tool.check`, `$.tool.register`.
6. **Server text is untrusted.** Everything that came from the server is sanitised before it is drawn (copy `plain.ts` from `../fylgja/hooks/`), and never decides control flow beyond its documented fields.
7. **Fail quietly.** Signed out, server off, unexpected shape: say one plain line in the experiment's own pane (or nothing), never throw into the session.

## Layout of one experiment

```
lab/<name>/
  .claude-plugin/plugin.json     name "fylgja-lab-<name>"
  .mcp.json                      the same Fylgja server entry as ../fylgja/.mcp.json
  hooks/hooks.json               {"modules": ["./register.ts"]}
  hooks/*.ts                     the mod; relative imports only
  tests/*.test.ts                behaviour tests, MCP calls stubbed
  README.md                      what it is, what to type, what to look at, what is unproven
```

`_notes/` holds the reference material: `research-mods.md` (the mods API as of Claude Code 2.1.291, with signatures), `types/` (the declarations that build writes), `research-mcp-capture.md` (every Fylgja MCP tool and its result shape), `research-community-mods.md` (what other people built, with techniques worth copying).
