#!/usr/bin/env bash
# Runs Scribe over the scripted scenarios with a real model and a stand-in
# server, headless, with nothing installed. A copy of the plugin is made in a
# scratch folder: its hooks, the harness as its hooks module, and the stand-in
# as its `fylgja` server, so the calls carry the names they carry in a session.
#
#   run.sh <out-dir> [models] [runs] [timeout-seconds]
#   run.sh /tmp/scribe-run sonnet 3 900
#
# It spends the Claude plan of whoever runs it: about 20 model calls per model
# and run. The user's own settings are left out, so no installed plugin and
# no real knowledge base is part of it.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
plugin="$(cd "$here/../.." && pwd)"
out="${1:?out dir}"; models="${2:-sonnet}"; runs="${3:-3}"; limit="${4:-900}"
mkdir -p "$out/results" "$out/cwd"
copy="$out/plugin"
rm -rf "$copy"; mkdir -p "$copy/.claude-plugin" "$copy/hooks"
cp -r "$plugin/hooks/." "$copy/hooks/"
sed "s#'\.\./\.\./hooks/#'./#g" "$here/harness.ts" > "$copy/hooks/harness.ts"
echo '{ "modules": ["./harness.ts"] }' > "$copy/hooks/hooks.json"
echo '{ "name": "fylgja", "version": "0.0.0", "description": "Scribe scenario run." }' > "$copy/.claude-plugin/plugin.json"
cp "$here/stub-server.mjs" "$copy/stub-server.mjs"
# SCRIBE_ONLY="id,id" runs only the scenarios named.
# SCRIBE_SET=heldout runs the sessions of scenarios-heldout.mjs.
set="scenarios${SCRIBE_SET:+-$SCRIBE_SET}.mjs"
node -e "import('$here/$set').then(m => require('fs').writeFileSync('$out/scenarios.json', JSON.stringify(m.SCENARIOS.filter(s => !process.env.SCRIBE_ONLY || process.env.SCRIBE_ONLY.split(',').includes(s.id)))))"
cat > "$copy/.mcp.json" <<JSON
{ "mcpServers": { "fylgja": { "command": "node", "args": ["$copy/stub-server.mjs"],
  "env": { "SCRIBE_SCENARIOS": "$out/scenarios.json", "SCRIBE_STUB_LOG": "$out/stub.log" } } } }
JSON
cd "$out/cwd" || exit 2
for model in $models; do
  for run in $(seq 1 "$runs"); do
    result="$out/results/$model-$run.json"
    [ -s "$result" ] && [ "$(node -e "console.log(JSON.parse(require('fs').readFileSync('$result')).length)")" = "$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out/scenarios.json')).length)")" ] && continue
    timeout "$limit" claude -p "/scribe-scenarios $model $run $out/scenarios.json $result" \
      --plugin-dir "$copy" --permission-mode default --setting-sources project,local \
      --output-format json --debug-file "$out/$model-$run.debug.log" > "$out/$model-$run.out.json" 2> "$out/$model-$run.err.txt"
    echo "$model run $run: exit=$?"
  done
done
