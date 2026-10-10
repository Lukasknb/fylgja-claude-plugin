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
    # What a decision may not be: an account of what happened. Only the words the instruction names are taken;
    # the rule itself is too long to copy, and the stand-in asks the server's own code for it (gate-check.py).
    "narrative": {
        "first_person": sorted(gate.FIRST_PERSON),
        "report_openers": sorted(gate.REPORT_OPENERS),
        "progress_openers": sorted(getattr(gate, "PROGRESS_OPENERS", [])),
        "question_openers": sorted(getattr(gate, "QUESTION_OPENERS", [])),
        "hedges": sorted(getattr(gate, "HEDGES", [])),
        "rule": gate._DECISION_RULE,
        "rewrites": gate._DECISION_REWRITES,
    },
    "hints": gate.HINT_BY_REASON,
    "examples": gate.EXAMPLE_BY_REASON,
}

# Sentences of every shape the gate tells apart, with what the server itself says of each: the stand-in's own
# answers are checked against these (gate-selfcheck.mjs).
# Every sentence here is made up for the purpose.
SUBJECTS = ["The reducer", "Rows without a start", "The old job", "Lukas", "A deduplicated upload", "`is_default`", "Meetings uploaded by daemons"]
TAILS = ["rejects stale tokens", "stay NULL", "was killed", "chose Redis for the queue", "adds its uploader as an attendee", "finished without errors", "failed", "uses offset paging", "moved to Postgres", "is a Postgres advisory lock", "get their times from the daemon"]
SENTENCES = (
    [f"{subject} {tail}." for subject in SUBJECTS for tail in TAILS]
    + [f"{opener.capitalize()} the queue uses Postgres." for opener in sorted(gate.FIRST_PERSON | gate.REPORT_OPENERS)]
    + [f"{verb.capitalize()} the retry queue before the worker starts." for verb in ["use", "never", "backfill", "flag", "render", "translate", "gate", "identify", "name", "record", "reconstruct", "investigating", "fixed", "page", "launch"]]
    + [
        "Is the queue lock a Postgres advisory lock?",
        "The queue lock is on main now.",
        "The deploy went out this morning.",
        "The index moved two days ago.",
        "Use `was_live=False` for rows that were created before the cutover.",
        "Rows that were created before the cutover keep NULL.",
        "`src/a.py` (the worker) \"runs\" 08:00.",
        "Flag a silent transcript for review.",
        "PLA-266 pending.",
        "Use Postgres. It is already there.",
        "x" * 230,
    ]
)
out["cases"] = []
for kind in ("decision", "gotcha", "correction"):
    for sentence in SENTENCES:
        triggers = ["queue"] if kind == "gotcha" else []
        verdict = gate.check_memory(sentence, "because it is so" if kind == "decision" else None, kind, triggers)
        if verdict.ok:
            verdict = gate.check_decision_fields(kind, "because it is so" if kind == "decision" else None, None, [])
        out["cases"].append(
            {
                "kind": kind,
                "content": sentence,
                "triggers": triggers,
                "refusal": None if verdict.ok else gate.refusal_text(verdict.reason_code, verdict.hint),
            }
        )

target = pathlib.Path(__file__).with_name("server-gate.json")
target.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
