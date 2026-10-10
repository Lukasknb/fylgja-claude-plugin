// Writes the report of a replay: one Markdown file and one JSON file per
// session, into the output directory, from what the passes left there.
//
//   node replay-report.mjs <out-dir> <name>
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [out, name] = process.argv.slice(2)
const read = JSON.parse(readFileSync(join(out, 'read.json'), 'utf8'))
const passes = ['none', 'ignore', 'answer'].flatMap(policy =>
  existsSync(join(out, `pass-${policy}.json`)) ? [JSON.parse(readFileSync(join(out, `pass-${policy}.json`), 'utf8'))] : [],
)
const POLICY = {
  none: 'no key is pressed and no typing is seen: prompts simply arrive',
  ignore: 'the person types every prompt and never touches the band',
  answer: 'every question is answered, with “No particular reason” and Skip in turn, and every tell is dismissed',
}
const median = list => (list.length === 0 ? 0 : [...list].sort((a, b) => a - b)[Math.floor((list.length - 1) / 2)])
const cell = text => String(text).replace(/\|/g, '/').replace(/\s+/g, ' ')
const sum = (steps, pick) => steps.reduce((total, step) => total + pick(step), 0)

/** What Scribe did in a turn, in a word or a few. */
function didOf(step) {
  const did = [
    ...(step.records.length > 0 ? [`recorded ${step.records.length}`] : []),
    ...((step.updated ?? []).length > 0 ? [`updated ${step.updated.length}`] : []),
    ...((step.withdrawn ?? []).length > 0 ? [`withdrew ${step.withdrawn.length}`] : []),
    ...(step.questions.length > 0 ? [`asked ${step.questions.length}`] : []),
    ...(step.tells.length > 0 ? [`told ${step.tells.length}`] : []),
    ...(step.corrected > 0 ? [`corrected ${step.corrected}`] : []),
    ...(step.refused > 0 ? [`refused ${step.refused}`] : []),
    ...(step.lost > 0 ? [`lost ${step.lost}`] : []),
  ]

  return did.length > 0
    ? did.join(', ')
    : step.kind === 'clear' || step.kind === 'compact'
      ? step.kind
      : step.isWoken
        ? 'nothing'
        : 'not looked at'
}

function summaryOf(pass) {
  const woken = pass.steps.filter(step => step.isWoken)
  const hours = read.hours

  return {
    policy: pass.policy,
    isDry: pass.isDry,
    off: pass.off,
    stopped: pass.stopped,
    error: pass.error,
    turnsReplayed: pass.steps.length,
    turnsSkipped: pass.skipped,
    wakes: woken.length,
    modelCalls: pass.modelCalls,
    tokens: {
      input: sum(pass.steps, step => step.usage.input),
      output: sum(pass.steps, step => step.usage.output),
      cacheRead: sum(pass.steps, step => step.usage.cacheRead),
      cacheWrite: sum(pass.steps, step => step.usage.cacheWrite),
    },
    charsSentMedian: median(woken.map(step => step.sent)),
    charsSentMax: Math.max(0, ...woken.map(step => step.sent)),
    deltaCharsMedian: median(woken.map(step => step.delta)),
    deltaCharsMax: Math.max(0, ...woken.map(step => step.delta)),
    // What a wake's first call weighs on average, part by part, in characters.
    weights: Object.fromEntries(
      ['instruction', 'plans', 'history', 'turn'].map(part => [
        part,
        woken.length === 0 ? 0 : Math.round(sum(woken, step => step.weights?.[part] ?? 0) / woken.length),
      ]),
    ),
    cappedTurns: pass.steps.filter(step => step.isCapped).length,
    wakeSecondsMedian: median(woken.map(step => step.ms)) / 1000,
    wakeSecondsMax: Math.max(0, ...woken.map(step => step.ms)) / 1000,
    records: pass.steps.flatMap(step => step.records.map(record => ({ turn: step.n, ...record }))),
    updates: pass.steps.flatMap(step => (step.updated ?? []).map(record => ({ turn: step.n, ...record }))),
    withdrawals: pass.steps.flatMap(step => (step.withdrawn ?? []).map(id => ({ turn: step.n, id }))),
    questions: pass.steps.flatMap(step => step.questions.map(question => ({ turn: step.n, ...question }))),
    tells: pass.steps.flatMap(step => step.tells.map(tell => ({ turn: step.n, ...tell }))),
    refusals: pass.calls.filter(call => call.isRefused).map(call => ({ tool: call.tool, code: call.outcome })),
    counters: pass.counters,
    itemsShownPerHour: hours > 0 ? (pass.counters.itemsShown ?? 0) / hours : null,
    notes: pass.notes,
  }
}

const summaries = passes.map(summaryOf)
const lines = [`# Scribe replayed over a recorded session`, '']

lines.push(
  `Session \`${name}\`, written by Claude Code ${read.version ?? 'of an unknown version'}: ${read.turns} turns over ${read.hours.toFixed(1)} hours (${read.prompts} begun by the developer, ${read.others} by something else, ${read.compactions} compactions, ${read.clears} clears, ${read.plans} with a plan from plan mode), ${read.rows} rows, ${read.toolCalls} tool calls. Left out: ${read.left.sidechain} rows of agents, ${read.left.meta} rows only Claude was shown.${read.isWorktree ? ' The session ran in a worktree.' : ''}`,
  '',
  'Scribe’s own code read the rows, built each delta, picked up plan documents, held its limits, checked each verdict, wrote, and ran the band. The rows were built from the recording, the clock between turns is the recording’s, the server is a stand-in on this machine that keeps what is written in memory, and nobody was at the band but the policy named with each pass. The plugin’s hook wiring, its account check and its chips were not run.',
  '',
)

if (!read.isInRepository && read.trees > 0) {
  lines.push(
    `The session started in a folder that is no repository; its files lie in ${read.trees} working trees this machine still has, and what Scribe records is filed under those.`,
    '',
  )
}

if (!read.isInRepository && !(read.trees > 0)) {
  lines.push(
    read.isDirectoryGone
      ? 'The directory the session ran in is gone, so its repository cannot be told. Pass `--root <dir>` and `--remote <url>` to say which it was. Nothing was replayed.'
      : 'The session did not run in a repository and touched no file of one that this machine still has: nothing was replayed.',
    '',
  )
}

for (const [at, pass] of passes.entries()) {
  const summary = summaries[at]

  lines.push(`## ${pass.isDry ? 'Dry pass' : 'Pass'}: ${POLICY[pass.policy]}`, '')

  if (pass.off !== null) {
    lines.push(`Scribe did not run: ${pass.off}.`, '')
    continue
  }

  if (pass.isDry) {
    lines.push(
      'No model was asked: every look came back empty, so this shows only how the session is cut into wakes and how much each would send.',
      '',
    )
  }

  if (pass.stopped !== null) {
    lines.push(`Stopped at ${pass.stopped}: ${pass.skipped} turns were not replayed.`, '')
  }

  if (pass.error !== null) {
    lines.push(`The pass ended early with an error (${pass.error}).`, '')
  }

  lines.push(
    '|Turn|Began|What it was|Scribe|Model calls|Seconds|Characters sent|Of those, not the instruction|',
    '|-|-|-|-|-|-|-|-|',
    ...pass.steps.map(
      step =>
        `|${step.n}|${step.at > 0 ? new Date(step.at).toISOString().slice(11, 16) : ''}|${cell(step.label)}|${didOf(step)}|${step.modelCalls}|${(step.ms / 1000).toFixed(1)}|${step.sent}|${step.delta}|`,
    ),
    '',
    '|Summary||',
    '|-|-|',
    `|Turns replayed / skipped|${summary.turnsReplayed} / ${summary.turnsSkipped}|`,
    `|Wakes|${summary.wakes}|`,
    `|Model calls|${summary.modelCalls}${pass.isDry ? ' (not made)' : ''}|`,
    `|Tokens: input / output / cache read / cache write|${summary.tokens.input} / ${summary.tokens.output} / ${summary.tokens.cacheRead} / ${summary.tokens.cacheWrite}|`,
    `|Characters sent per wake: median / most|${summary.charsSentMedian} / ${summary.charsSentMax}|`,
    `|Of those, not the standing instruction: median / most|${summary.deltaCharsMedian} / ${summary.deltaCharsMax}|`,
    `|Seconds per wake: median / longest|${summary.wakeSecondsMedian.toFixed(1)} / ${summary.wakeSecondsMax.toFixed(1)}|`,
    `|A wake's first call, in characters: instruction / plans / earlier wakes / this turn|${summary.weights.instruction} / ${summary.weights.plans} / ${summary.weights.history} / ${summary.weights.turn}|`,
    `|Turns worth a look that got none because the hour's share was used up|${summary.cappedTurns}|`,
    `|Records written|${summary.records.length}|`,
    `|Questions put in line (of at most ${pass.counters.maxQuestions} a session)|${summary.questions.length}, ${pass.counters.questions} shown, ${pass.counters.unanswered} left unanswered|`,
    `|Own records rewritten in place / taken back|${summary.updates.length} / ${summary.withdrawals.length}|`,
    `|Tells offered|${summary.tells.length}|`,
    `|Writes refused / records put right / records lost|${summary.refusals.length} / ${pass.counters.corrections} / ${pass.counters.lost}|`,
    `|Items shown, and per hour of the session|${pass.counters.itemsShown}${summary.itemsShownPerHour === null ? '' : `, ${summary.itemsShownPerHour.toFixed(1)}`}|`,
    `|Offers typed past in a row / offers to be let go for it|${pass.counters.typedPast} / ${pass.counters.skipsOwed}|`,
    `|Still waiting in the band / held back / pushed out of line|${pass.counters.waiting} / ${pass.counters.heldBack} / ${pass.counters.pushedOut}|`,
    `|The hour’s share of wakes used up|${pass.counters.hourlyCeilingHit === 1 ? 'yes' : 'no'}|`,
    '',
  )

  if (summary.records.length > 0) {
    lines.push('### Records written', '')

    for (const record of summary.records) {
      lines.push(
        `- Turn ${record.turn}, ${record.kind ?? 'record'}, filed under ${record.repo}${record.id ? `, id ${String(record.id).slice(0, 8)}` : ''}: ${record.content}`,
        `  - Reason (${record.reason_status ?? 'stated'}): ${record.detail ?? 'none'}`,
        `  - Alternatives: ${(record.alternatives ?? []).join('; ') || 'none'}`,
        `  - Anchors: ${(record.anchors ?? []).map(anchor => (anchor.symbol ? `${anchor.path} (${anchor.symbol})` : anchor.path)).join(', ') || 'none'}`,
        ...(record.supersedes ? [`  - Replaces: ${record.supersedes}`] : []),
      )
    }

    lines.push('')
  }

  if (summary.updates.length > 0 || summary.withdrawals.length > 0) {
    lines.push(
      '### Own records changed',
      '',
      ...summary.updates.map(
        update =>
          `- Turn ${update.turn}, rewrote ${String(update.atom_id).slice(0, 8)}: ${update.content} (reason ${update.reason_status ?? 'unchanged'}: ${update.detail ?? 'none'})`,
      ),
      ...summary.withdrawals.map(gone => `- Turn ${gone.turn}, took back ${gone.id.slice(0, 8)}`),
      '',
    )
  }

  if (summary.questions.length > 0) {
    lines.push(
      '### Questions',
      '',
      ...summary.questions.map(
        question =>
          `- Turn ${question.turn}, ${question.form}: ${question.text}${question.prior === null ? '' : ` (recorded: ${question.prior})`}. Options: ${question.options.join(' / ') || 'none'}`,
      ),
      '',
    )
  }

  if (summary.tells.length > 0) {
    lines.push('### Tells', '', ...summary.tells.map(tell => `- Turn ${tell.turn}: ${tell.text} (${tell.id.slice(0, 8)})`), '')
  }

  if (summary.refusals.length > 0) {
    lines.push('### Refusals', '', ...summary.refusals.map(refusal => `- ${refusal.tool}: ${refusal.code}`), '')
  }

  if (pass.notes.length > 0) {
    lines.push('### Scribe’s own notes', '', ...[...new Set(pass.notes)].map(note => `- ${note}`), '')
  }
}

writeFileSync(join(out, `${name}.md`), `${lines.join('\n')}\n`)
writeFileSync(
  join(out, `${name}.json`),
  JSON.stringify(
    { session: name, read, passes: summaries, timelines: passes.map(pass => ({ policy: pass.policy, steps: pass.steps })) },
    null,
    1,
  ),
)

// Numbers only, for whoever started the run.
for (const summary of summaries) {
  console.log(
    `${summary.isDry ? 'dry ' : ''}${summary.policy}: ${summary.turnsReplayed} turns replayed, ${summary.turnsSkipped} skipped, ${summary.wakes} wakes, ${summary.modelCalls} model calls${summary.isDry ? ' (not made)' : ''}, characters sent per wake median ${summary.charsSentMedian} most ${summary.charsSentMax} (without the instruction: median ${summary.deltaCharsMedian} most ${summary.deltaCharsMax})${summary.off === null ? '' : `, off: ${summary.off}`}${summary.stopped === null ? '' : `, stopped at ${summary.stopped}`}; weights ${JSON.stringify(summary.weights)}; capped ${summary.cappedTurns}`,
  )
}
