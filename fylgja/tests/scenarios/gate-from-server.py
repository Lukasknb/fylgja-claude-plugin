"""Write server-gate.json: the word lists and refusal texts of Fylgja's memory gate, read out of the server's own file.

    python3 -I gate-from-server.py <path to apps/api/app/domain/services/memory_gate.py> <commit>

The stand-in server refuses by this file, so that its lists are the server's and are never typed by hand. Run it again
whenever the server's gate changes; the commit it was read at is kept in the file.
"""

import importlib.util
import json
import pathlib
import sys

source, commit = sys.argv[1], sys.argv[2]
spec = importlib.util.spec_from_file_location("memory_gate", source)
gate = importlib.util.module_from_spec(spec)
sys.modules["memory_gate"] = gate
spec.loader.exec_module(gate)

out = {
    "commit": commit,
    "conditionals": list(gate.CONDITIONAL_OPENERS),
    "verbs": list(gate.VERB_OPENERS),
    "subjects": sorted(gate._SUBJECTS),
    "max_echoed_word": gate.MAX_ECHOED_WORD,
    "burst": {"assistant": gate.BURST_LIMIT, "scribe": gate.SCRIBE_BURST_LIMIT, "window_minutes": gate.BURST_WINDOW_MINUTES},
    "limits": {"content": gate.MAX_CONTENT_CHARS, "detail": gate.MAX_DETAIL_CHARS, "alternatives": gate.MAX_ALTERNATIVES, "alternative": gate.MAX_ALTERNATIVE_CHARS},
    "statement_verbs": gate._STATEMENT_VERBS.pattern,
    "status_phrases": gate._UNAMBIGUOUS_STATUS.pattern,
    "status_words": gate._AMBIGUOUS_STATUS.pattern,
    "hints": gate.HINT_BY_REASON,
    "examples": gate.EXAMPLE_BY_REASON,
}
target = pathlib.Path(__file__).with_name("server-gate.json")
target.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
