// Grades a scenario run against what each scenario expects and prints its
// tables, as RESULTS.md holds them.
//
//   node report.mjs <out-dir>
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { SCENARIOS } from './scenarios.mjs'

const out = process.argv[2]
const outcomes = readdirSync(join(out, 'results'))
  .filter(name => name.endsWith('.json'))
  .flatMap(name => JSON.parse(readFileSync(join(out, 'results', name), 'utf8')))
const models = [...new Set(outcomes.map(outcome => outcome.model))].sort()
const within = (n, [min, max]) => n >= min && n <= max
const isSilent = expect => expect.records[1] === 0 && expect.question === 'none' && expect.tells[1] === 0

/** What one run of one scenario came to, against what the scenario expects. */
function grade(scenario, outcome) {
  const { expect } = scenario
  const written = outcome.calls.filter(call => call.tool === 'remember').map(call => call.args)
  const amended = outcome.calls.filter(call => call.tool === 'amend_memory').map(call => call.args)
  const questions = outcome.shown.filter(seen => seen.kind.startsWith('question-')).map(seen => seen.kind.slice(9))
  const tells = outcome.shown.filter(seen => seen.kind === 'tell').length
  const prior = scenario.records?.[0]?.id
  const wrong = []

  if (outcome.error !== undefined) {
    wrong.push(`error ${outcome.error}`)
  }

  if (!within(written.length, expect.records)) {
    wrong.push(`${written.length} records`)
  }

  if (expect.kind !== undefined && !written.every(args => expect.kind.split('-or-').includes(args.kind))) {
    wrong.push(`kind ${written.map(args => args.kind).join(',')}`)
  }

  if (expect.status !== undefined && written.length > 0 && written[0].reason_status !== expect.status) {
    wrong.push(`status ${written[0].reason_status}`)
  }

  if (expect.question === 'none' && questions.length > 0) {
    wrong.push(`asked ${questions.join(',')}`)
  }

  if (expect.question === 'reason-or-none' && questions.some(form => form !== 'reason')) {
    wrong.push(`asked ${questions.join(',')}`)
  }

  if (
    expect.question === 'reversal-or-supersedes' &&
    !questions.includes('reversal') &&
    !written.some(args => args.supersedes === prior)
  ) {
    wrong.push('reversal not seen')
  }

  if (!within(tells, expect.tells)) {
    wrong.push(`${tells} tells`)
  }

  if (
    expect.planAnchor !== undefined &&
    !written.some(args => (args.anchors ?? []).some(anchor => anchor.path === expect.planAnchor))
  ) {
    wrong.push('plan not anchored')
  }

  if (
    expect.answer !== undefined &&
    questions.includes('reason') &&
    !amended.some(args => args.reason_status === expect.answer)
  ) {
    wrong.push('answer not saved')
  }

  return {
    isCorrect: wrong.length === 0,
    wrong,
    records: written.length,
    falseRecords: Math.max(0, written.length - expect.records[1]),
    questions: questions.length,
    falseQuestions: expect.question === 'none' ? questions.length : 0,
    tells,
    refused: 0,
  }
}

const graded = outcomes.map(outcome => {
  const scenario = SCENARIOS.find(one => one.id === outcome.id)

  return { outcome, scenario, ...grade(scenario, outcome) }
})
const sum = (list, pick) => list.reduce((total, one) => total + pick(one), 0)
const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? 0
const row = cells => `|${cells.join('|')}|`

console.log('#### Per model\n')
console.log(row(['', ...models]))
console.log(row(['-', ...models.map(() => '-')]))

const per = (label, value) =>
  console.log(row([label, ...models.map(model => value(graded.filter(one => one.outcome.model === model)))]))

per('Scenario runs', list => list.length)
per(
  'Correct outcome',
  list =>
    `${list.filter(one => one.isCorrect).length}/${list.length} (${Math.round((100 * list.filter(one => one.isCorrect).length) / list.length)}%)`,
)
per('False records (written where none, or more than expected)', list => sum(list, one => one.falseRecords))
per('False questions (asked where none is expected)', list => sum(list, one => one.falseQuestions))
per('Questions shown in the scenarios that expect silence (target 0)', list =>
  sum(
    list.filter(one => isSilent(one.scenario.expect)),
    one => one.questions,
  ),
)
per('Tells shown in the scenarios that expect silence (target 0)', list =>
  sum(
    list.filter(one => isSilent(one.scenario.expect)),
    one => one.tells,
  ),
)
per('Records written in all', list => sum(list, one => one.records))
per('Questions shown in all', list => sum(list, one => one.questions))
per('Tells shown in all', list => sum(list, one => one.tells))
per('Model calls', list => sum(list, one => one.outcome.modelCalls))
per('Model calls per wake', list =>
  (sum(list, one => one.outcome.modelCalls) / sum(list, one => one.scenario.turns.length)).toFixed(2),
)
per(
  'Latency per model call, median',
  list =>
    `${(median(list.filter(one => one.outcome.modelCalls > 0).map(one => one.outcome.ms / one.outcome.modelCalls)) / 1000).toFixed(1)} s`,
)
per(
  'Latency per model call, slowest',
  list =>
    `${(Math.max(...list.filter(one => one.outcome.modelCalls > 0).map(one => one.outcome.ms / one.outcome.modelCalls)) / 1000).toFixed(1)} s`,
)
per('Tokens per model call: input / output', list => {
  const calls = sum(list, one => one.outcome.modelCalls)

  return `${Math.round(sum(list, one => one.outcome.usage.input) / calls)} / ${Math.round(sum(list, one => one.outcome.usage.output) / calls)}`
})
per('Tokens per model call: cache read / cache write', list => {
  const calls = sum(list, one => one.outcome.modelCalls)

  return `${Math.round(sum(list, one => one.outcome.usage.cacheRead) / calls)} / ${Math.round(sum(list, one => one.outcome.usage.cacheWrite) / calls)}`
})
per('Tokens in all: input / output / cache read / cache write', list =>
  ['input', 'output', 'cacheRead', 'cacheWrite'].map(key => sum(list, one => one.outcome.usage[key])).join(' / '),
)

console.log('\n#### Per scenario\n')
console.log('Each cell: correct runs, then records written / questions shown / tells shown over all runs.\n')
console.log(row(['Scenario', 'Expected', ...models]))
console.log(row(['-', '-', ...models.map(() => '-')]))

for (const scenario of SCENARIOS.filter(one => graded.some(run => run.scenario === one))) {
  const { expect } = scenario
  const expected = [
    expect.records[1] === 0
      ? 'no record'
      : `${expect.records[0]}–${expect.records[1]} ${expect.kind ?? 'record'}${expect.status === undefined ? '' : `, ${expect.status}`}`,
    expect.question === 'none' ? 'no question' : `question: ${expect.question}`,
    expect.tells[1] === 0 ? 'no tell' : `${expect.tells[0]}–${expect.tells[1]} tell`,
  ].join('; ')

  console.log(
    row([
      scenario.title,
      expected,
      ...models.map(model => {
        const list = graded.filter(one => one.outcome.model === model && one.scenario === scenario)

        return `${list.filter(one => one.isCorrect).length}/${list.length}, ${sum(list, one => one.records)} / ${sum(list, one => one.questions)} / ${sum(list, one => one.tells)}`
      }),
    ]),
  )
}

const misses = graded.filter(one => !one.isCorrect)

console.log('\n#### What went wrong, run by run\n')
console.log(
  misses.length === 0
    ? 'Nothing.'
    : misses
        .map(one => `- ${one.outcome.model}, run ${one.outcome.run}, ${one.scenario.title}: ${one.wrong.join('; ')}`)
        .join('\n'),
)
