# Fylgja Claude Code plugin

Operational memory for every Claude Code session (requirements/15):

- **SessionStart** — injects the repo's operational-memory bucket (newest-verified
  first, honest-empty when the repo has none) plus the remember ritual and
  session provenance (`session_id`/`hostname`/`cwd` for `fylgja_remember`).
- **PreToolUse (Bash)** — checks risky-shaped commands against stored hazard
  triggers via `fylgja_precheck` before they run. Non-blocking.
- **MCP server** — registers `https://fylgja.lknblab.dev/mcp` in every project,
  so `fylgja_remember`/`fylgja_context`/`fylgja_precheck` and the knowledge
  tools are always available without per-repo `.mcp.json` entries.

All hooks fail open: no token, no network, or a server error mean silence,
never a blocked session.

## Install (per machine)

Requires `jq` and `uv` on PATH.

```bash
claude plugin marketplace add Lukasknb/fylgja-claude-plugin
claude plugin install fylgja@fylgja

# One-time auth (opens a browser — pick the account whose knowledge base
# this machine should write to; use an incognito window to avoid Zitadel
# auto-SSO picking the wrong one):
~/.claude/plugins/cache/fylgja/fylgja/*/scripts/fylgja_mcp.py login
```

Then authenticate the MCP server itself once via `/mcp` inside a session
(the hook token and the session MCP token are separate credentials).

## Knobs (env)

| Variable | Default | Meaning |
|-|-|-|
| `FYLGJA_MCP_URL` | `https://fylgja.lknblab.dev/mcp` | server endpoint |
| `FYLGJA_TOKEN_DIR` | `~/.config/fylgja/mcp-tokens` | hook OAuth token cache |
| `FYLGJA_CONTEXT_LIMIT` | `15` | max facts injected at session start |
