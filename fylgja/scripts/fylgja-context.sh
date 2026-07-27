#!/usr/bin/env bash
# SessionStart hook — inject the repo's Fylgja operational-memory bucket at
# session start (push-based recall, requirements/15 §5). Recall is bucket-first
# and deterministic server-side; no prompt text is needed or sent.
# Fail-open: any error or missing auth prints nothing and exits 0.
set -uo pipefail

input=$(cat)
session_id=$(jq -r '.session_id // "unknown"' <<<"$input")
cwd=$(jq -r '.cwd // empty' <<<"$input")

# Guard against double-fires (e.g. overlapping matchers): once per session.
marker="${XDG_RUNTIME_DIR:-/tmp}/fylgja-ctx-${session_id}"
[ -e "$marker" ] && exit 0
touch "$marker" 2>/dev/null || true

repo_root=$(git -C "${cwd:-.}" rev-parse --show-toplevel 2>/dev/null) || repo_root="${cwd:-.}"
# Prefer the org/name form from the origin remote — the server's bucket
# matcher tolerates both it and the bare folder name.
origin=$(git -C "$repo_root" remote get-url origin 2>/dev/null || true)
if [ -n "$origin" ]; then
  repo=$(sed -E 's#\.git$##; s#^.*[:/]([^/]+/[^/]+)$#\1#' <<<"$origin")
else
  repo=$(basename "$repo_root")
fi

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# BROWSER=/bin/false: a hook must never pop an interactive OAuth browser window.
BROWSER=/bin/false timeout 12 "$script_dir/fylgja_mcp.py" \
  context "$repo" "$session_id" "$(hostname)" "$cwd" 2>/dev/null || true
exit 0
