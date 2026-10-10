// Checks the stand-in's verdicts against the server's own, sentence by
// sentence, over the made-up sentences in server-gate.json's `cases`, each
// of which carries what the server said of it when the file was generated.
//
//   SCRIBE_SERVER_GATE=<path to the server's memory_gate.py> node gate-selfcheck.mjs
//
// With the server's file named, every verdict must be the server's, word for
// word. Without it, this says how many verdicts differ because the rule for
// a decision that reads as an account is not applied.
import { GATE, refusalOf, SERVER } from './stub-gate.mjs'

let wrong = 0

for (const one of GATE.cases) {
  const said =
    refusalOf(one.kind, one.content, one.kind === 'decision' ? 'because it is so' : null, one.triggers, undefined, []) ?? null

  wrong += said === one.refusal ? 0 : 1
}

console.log(
  `${GATE.cases.length - wrong} of ${GATE.cases.length} verdicts are the server's at ${GATE.commit}` +
    (SERVER === undefined ? " (the server's file is not named: decisions that read as accounts are let through)" : ''),
)
process.exit(SERVER !== undefined && wrong > 0 ? 1 : 0)
