"""What Fylgja's server says of a memory, by the server's own code.

    python3 -I gate-check.py <path to apps/api/app/domain/services/memory_gate.py>

Reads one JSON object per line on stdin ({"kind", "content", "detail", "triggers", "reason_status", "alternatives"})
and writes one per line: {"refusal": null} when the server takes it, or the one line it answers when it does not.
The stand-in server asks this when it is told where the server's file is, so that its verdict on the shape of a record
is the server's and not a copy of it.
"""

import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("memory_gate", sys.argv[1])
gate = importlib.util.module_from_spec(spec)
sys.modules["memory_gate"] = gate
spec.loader.exec_module(gate)

for line in sys.stdin:
    if not line.strip():
        continue
    asked = json.loads(line)
    kind = asked.get("kind") or "gotcha"
    verdict = gate.check_memory(asked.get("content") or "", asked.get("detail"), kind, asked.get("triggers") or [])
    if verdict.ok:
        verdict = gate.check_decision_fields(kind, asked.get("detail"), asked.get("reason_status"), asked.get("alternatives") or [])
    refusal = None if verdict.ok else gate.refusal_text(verdict.reason_code, verdict.hint)
    print(json.dumps({"refusal": refusal}), flush=True)
