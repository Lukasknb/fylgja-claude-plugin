// Holds the stand-in's reading of the gate to the server's own: every
// sentence in server-gate.json's `cases` carries what the server said of it
// when the file was generated, and the stand-in must say the same, word for
// word. Run after regenerating the file.
//
//   node gate-selfcheck.mjs
import { GATE, gate, refusalText } from './stub-gate.mjs'

let wrong = 0

for (const one of GATE.cases) {
  const rule = gate(one.kind, one.content, one.kind === 'decision' ? 'because it is so' : null, one.triggers, undefined, [])
  const said = rule === undefined ? null : refusalText(rule, one.content, one.kind)

  if (said !== one.refusal) {
    wrong += 1

    if (wrong <= 10) {
      console.log(`${one.kind}: ${one.content}\n  server:   ${one.refusal}\n  stand-in: ${said}`)
    }
  }
}

console.log(`${GATE.cases.length - wrong} of ${GATE.cases.length} agree with the server at ${GATE.commit}`)
process.exit(wrong === 0 ? 0 : 1)
