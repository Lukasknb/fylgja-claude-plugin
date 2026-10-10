#!/usr/bin/env bash
# Puts one recorded Claude Code session through Scribe, turn by turn, and
# reports what Scribe would have done.
#
#   replay.sh <transcript.jsonl> --out <dir> [--seed <records.json>] [--policy none|ignore|answer|all]
#             [--max-wakes N] [--max-calls N] [--dry] [--root <dir>] [--remote <url>]
#
# The transcript is only read. Everything this writes goes into <dir>, which
# must lie outside the repository: the session as read, a copy of the plugin,
# what each pass did, and the report (<session>.md and <session>.json). The
# knowledge base is the stand-in server on this machine: what Scribe writes
# stays in its memory and is listed in the report. `--seed` gives it records
# to hold beforehand; `replay-read.mjs` says what that file looks like.
#
# Without --dry this spends your Claude plan: Scribe's own model calls, about
# one per wake, at most --max-calls (120) over the whole run, and at most
# --max-wakes (40) wakes a pass. A run that could go over --max-calls is not
# started. --dry asks no model and shows how the session is cut into wakes.
# --policy says what the person at the band does (see replay.ts); `all` runs
# the three one after the other and so spends three times as much.
here="$(cd "$(dirname "$0")" && pwd)"
plugin="$(cd "$here/../.." && pwd)"
transcript="${1:?usage: replay.sh <transcript.jsonl> --out <dir> [--seed <records.json>] [--policy P] [--max-wakes N] [--max-calls N] [--dry]}"
shift
out=""; seed=""; policy="none"; wakes=40; calls=120; mode="live"; root=""; remote=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out="$2"; shift 2 ;;
    --seed) seed="$2"; shift 2 ;;
    --policy) policy="$2"; shift 2 ;;
    --max-wakes) wakes="$2"; shift 2 ;;
    --max-calls) calls="$2"; shift 2 ;;
    --root) root="$2"; shift 2 ;;
    --remote) remote="$2"; shift 2 ;;
    --dry) mode="dry"; shift ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
done
[ -n "$out" ] || { echo "--out <dir> is needed"; exit 2; }
[ -r "$transcript" ] || { echo "cannot read the transcript"; exit 2; }
case "$(realpath -m "$out")/" in "$(cd "$plugin/.." && pwd)"/*) echo "--out must lie outside the repository: a session's content is written there"; exit 2 ;; esac
mkdir -p "$out" && out="$(cd "$out" && pwd)"
case "$policy" in none|ignore|answer) policies="$policy" ;; all) policies="none ignore answer" ;; *) echo "unknown policy: $policy"; exit 2 ;; esac
name="$(basename "$transcript" .jsonl)"

node "$here/replay-read.mjs" "$transcript" "$out" ${seed:+--seed "$seed"} ${root:+--root "$root"} ${remote:+--remote "$remote"} || exit 2
rm -f "$out"/pass-*.json
number() { node -e "console.log(JSON.parse(require('fs').readFileSync('$out/read.json'))['$1'])"; }

if [ "$(number isInRepository)" != "true" ]; then
  node "$here/replay-report.mjs" "$out" "$name"
  echo "Scribe is off outside a repository: nothing was replayed. Report: $out/$name.md"
  exit 0
fi

# The spend guard: a wake is about one model call, and no pass has more wakes than turns or than --max-wakes.
turns="$(number turns)"
passes="$(echo $policies | wc -w)"
most=$(( (turns < wakes ? turns : wakes) * passes ))
if [ "$mode" = "live" ] && [ "$most" -gt "$calls" ]; then
  echo "not started: up to $most model calls ($passes pass(es) of up to $(( most / passes )) wakes) is over --max-calls $calls. Lower --max-wakes, raise --max-calls, or look first with --dry."
  exit 3
fi

copy="$out/plugin"
rm -rf "$copy"; mkdir -p "$copy/.claude-plugin" "$copy/hooks/replay" "$out/cwd"
cp -r "$plugin/hooks/." "$copy/hooks/"
sed "s#'\.\./\.\./hooks/#'../#g" "$here/replay.ts" > "$copy/hooks/replay/replay.ts"
sed "s#'\.\./\.\./hooks/#'../#g" "$here/transcript.ts" > "$copy/hooks/replay/transcript.ts"
echo '{ "modules": ["./replay/replay.ts"] }' > "$copy/hooks/hooks.json"
echo '{ "name": "fylgja", "version": "0.0.0", "description": "Scribe replay." }' > "$copy/.claude-plugin/plugin.json"
cp "$here/stub-server.mjs" "$here/server-gate.json" "$copy/"
cat > "$copy/.mcp.json" <<JSON
{ "mcpServers": { "fylgja": { "command": "node", "args": ["$copy/stub-server.mjs"],
  "env": { "SCRIBE_SCENARIOS": "$out/scenarios.json", "SCRIBE_STUB_LOG": "$out/stub.log" } } } }
JSON

cd "$out/cwd" || exit 2
left="$calls"
for one in $policies; do
  rm -f "$out/stub.log"
  timeout 3600 claude -p "/scribe-replay $out/session.json $out/pass-$one.json $one $wakes $left $mode" \
    --plugin-dir "$copy" --permission-mode default --setting-sources project,local \
    --output-format json --debug-file "$out/pass-$one.debug.log" < /dev/null > "$out/pass-$one.out.json" 2> "$out/pass-$one.err.txt"
  [ -s "$out/pass-$one.json" ] || { echo "the $one pass left no result (exit $?): see $out/pass-$one.out.json"; exit 1; }
  [ "$mode" = "live" ] && left=$(( left - $(node -e "console.log(JSON.parse(require('fs').readFileSync('$out/pass-$one.json')).modelCalls)") ))
  [ "$left" -gt 0 ] || break
done

node "$here/replay-report.mjs" "$out" "$name"
echo "Report: $out/$name.md"
