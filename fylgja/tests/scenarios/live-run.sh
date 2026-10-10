#!/usr/bin/env bash
# One real headless turn through the plugin's own hooks, against the
# stand-in server: to read from Claude Code's debug log that every call the
# plugin makes to Fylgja is let through (no `skipped: re-entry`, no `denied`),
# and from the stand-in's log that they arrive in order: who is signed in,
# then a pasted reference, then Scribe's lookup.
#
#   live-run.sh <out-dir>
#
# It spends your Claude plan: one short turn of Claude's and at most one
# request of Scribe's. A headless session has no person at it and draws
# nothing, so the copy of the plugin made here differs from the plugin in
# three lines, and only there: the prompt counts as the person's own, its
# references are noted as a drawn message would note them, and a surface
# that draws the band is taken as given.
here="$(cd "$(dirname "$0")" && pwd)"
plugin="$(cd "$here/../.." && pwd)"
out="${1:?usage: live-run.sh <out-dir>}"
id=00000000-0000-4000-8000-000000000701

rm -rf "$out"; mkdir -p "$out/plugin/.claude-plugin" "$out/repo/src"
out="$(cd "$out" && pwd)"
cp -r "$plugin/hooks" "$out/plugin/"
cp "$plugin/.claude-plugin/plugin.json" "$out/plugin/.claude-plugin/"
cp "$here/stub-server.mjs" "$here/stub-gate.mjs" "$here/server-gate.json" "$out/plugin/"
sed -i "s/scribe.isInteractive = isInteractive && (surface === 'terminal' || surface === 'desktop')/scribe.isInteractive = true/" "$out/plugin/hooks/scribe/scribe.ts"
sed -i "s/return origin.kind === 'composer' || origin.kind === 'bridge'/return true/" "$out/plugin/hooks/origin.ts"
sed -i "s/surfaces: () => \$.session.surfaces(),/surfaces: () => Promise.resolve(['terminal']),/" "$out/plugin/hooks/register.ts"
sed -i "0,/          Session.prompted(hostOf(\$, session), session)/s//          want(session, referencesIn(e.text))\n          Session.prompted(hostOf(\$, session), session)/" "$out/plugin/hooks/register.ts"
[ "$(grep -c "isInteractive = true" "$out/plugin/hooks/scribe/scribe.ts")$(grep -c "return true" "$out/plugin/hooks/origin.ts")$(grep -c "Promise.resolve(\['terminal'\])" "$out/plugin/hooks/register.ts")$(grep -c "want(session, referencesIn(e.text))" "$out/plugin/hooks/register.ts")" = "1111" ] || { echo "the plugin's code has moved: the three lines this run changes were not found"; exit 2; }

cat > "$out/scenarios.json" <<JSON
[{ "id": "live", "repo": "probe/live", "records": [{ "id": "$id", "type": "decision", "content": "Keep the retry count at three.", "detail": "More than three hid outages.", "anchors": [{ "path": "src/app.ts" }], "origin": "scribe" }] }]
JSON
cat > "$out/plugin/.mcp.json" <<JSON
{ "mcpServers": { "fylgja": { "command": "node", "args": ["$out/plugin/stub-server.mjs"],
  "env": { "SCRIBE_SCENARIOS": "$out/scenarios.json", "SCRIBE_STUB_LOG": "$out/stub.log" } } } }
JSON
cd "$out/repo" || exit 2
git init -q . && git remote add origin git@github.com:probe/live.git
printf 'export const RETRIES = 3\n' > src/app.ts
git add -A && git -c user.name=probe -c user.email=probe@example.invalid commit -qm init
timeout 240 claude -p "Read src/app.ts, then change RETRIES to 5 in it because the upstream API now needs five tries to settle. This relates to {{fylgja:note Retry count|$id}}. Answer in one line." \
  --model sonnet --plugin-dir "$out/plugin" --permission-mode acceptEdits --setting-sources project,local --no-session-persistence \
  --output-format json --debug-file "$out/debug.log" < /dev/null > "$out/out.json" 2> "$out/err.txt"
echo "exit=$?"
echo "calls that reached the stand-in, in order:"
node -e "for (const line of require('fs').readFileSync('$out/stub.log', 'utf8').trim().split('\n')) { const call = JSON.parse(line); console.log(' ', call.tool, call.isError ? 'refused' : 'ok') }"
echo "skipped: re-entry in the debug log: $(grep -c 'skipped: re-entry' "$out/debug.log")"
echo "denied in the debug log: $(grep -ci 'denied' "$out/debug.log")"
echo "calls let through by the plugin's own rule: $(grep -c 'allow by plugin fylgja' "$out/debug.log")"
