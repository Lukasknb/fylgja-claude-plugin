#!/usr/bin/env bash
# PreToolUse/Bash hook — surface stored operational hazards for risky-shaped
# commands before they run (requirements/15 §5, fylgja_precheck). Non-blocking:
# matches are injected as additionalContext; the command always proceeds.
# Fail-open: any error or missing auth exits 0 with no output.
set -uo pipefail

input=$(cat)
cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
[ -z "$cmd" ] && exit 0

# Local pre-gate: only risky-shaped commands are worth a network round-trip.
gate='(^|[;&| ])(ssh|scp|rsync|docker|kubectl|psql|alembic|systemctl|terraform|cloudflared)([ ;]|$)|gh (workflow|run|api)|deploy|spacetime|--clear|--force|-rf |rm -r|drop |truncate|fylgja'
if ! grep -qiE "$gate" <<<"$cmd"; then
  exit 0
fi

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
out=$(BROWSER=/bin/false timeout 5 "$script_dir/fylgja_mcp.py" precheck "$cmd" 2>/dev/null) || true
[ -z "$out" ] && exit 0

jq -n --arg ctx "$out" '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $ctx}}'
exit 0
