import type { On, PromptEditInput, PromptEditResult } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { engineDrew, MEETING_ID, scene, token, userMessage } from './fixtures'
import { band, claude, decision, dev, edit, START, stage, turn, verdict } from './scribe-fixtures'

const INVISIBLE = { options: { invisible: true } }

const TALK = [dev('Use Postgres for the queue lock.'), claude('Done.', edit('src/queue/lock.ts'))]
const UNEXPLAINED = decision({ detail: '', reason_status: 'not_stated' })
const ASKING = verdict({ records: [UNEXPLAINED], question: { form: 'reason', record: 0, options: ['One less service to run'] } })

/** Claude Code's own editor: the edit asked for, the cursor after it. */
function engine(on: On): void {
  on('prompt.edit', ($, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
}

/** One paste into an empty prompt box, through the plugin's hook. */
function paste($: Engine, text: string): Promise<PromptEditResult> {
  const prompt = $.prompt as unknown as { edit: (input: PromptEditInput) => Promise<PromptEditResult> }

  return prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: text })
}

describe('the plugin made invisible', () => {
  test('Scribe still records a decision with no reason, and asks nobody why', INVISIBLE, async ($, on) => {
    const set = stage(on, { replies: [ASKING] })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember')[0]).toMatchObject({ reason_status: 'not_stated', kind: 'decision' })
    expect(await (await band($)).isEmpty(), 'no question, no receipt, no mark').toBe(true)
    expect(await (await band($, 'terminal', true)).isEmpty(), 'nor while Claude works').toBe(true)
    expect([set.toasts, set.statuses.filter(line => line !== undefined)]).toEqual([[], []])
  })

  test('a pasted reference stays as it was pasted, with no chip and no paint', INVISIBLE, async ($, on) => {
    scene(on)
    engine(on)
    const pasted = token('meeting', 'Pasted label', MEETING_ID)

    expect(await paste($, pasted)).toEqual({ text: pasted, cursor: pasted.length })
  })

  test('a sent message is drawn by Claude Code as it is', INVISIBLE, async ($, on) => {
    scene(on)
    const sent = `see ${token('meeting', 'Pasted label', MEETING_ID)}`

    const ui = await $.ui.mount({ ...userMessage(sent), surface: 'terminal' })

    expect(await ui.drawn()).toEqual(engineDrew(`engine: ${sent}`))
    await ui.unmount()
  })

  test('switched on in /config, the question that waited goes and none comes after', async ($, on) => {
    const set = stage(on, { replies: [ASKING, ASKING] })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(await (await band($)).text()).toMatch('Why')

    await $.config.set({
      key: 'fylgja.invisible',
      value: true,
      previous: false,
      provider: { plugin: 'fylgja', tier: 'user' },
      origin: { kind: 'composer' },
    } as never)

    expect(await (await band($)).isEmpty()).toBe(true)

    await turn($, set, dev('Use a sessions table, not signed cookies.'), claude('Done.', edit('src/auth/sessions.ts')))

    expect(set.of('remember').length, 'the second decision is recorded too').toBe(2)
    expect(await (await band($)).isEmpty()).toBe(true)
  })
})
