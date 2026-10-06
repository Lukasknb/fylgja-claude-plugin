import type { On, PromptEditInput, PromptEditResult } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { idOf, MEETING_ID, NOTE_ID, scene, token } from './fixtures'

const SURFACES = ['terminal', 'desktop'] as const
const MEETING = token('meeting', 'Pasted label', MEETING_ID)
const LINK = `https://fylgja.lknblab.dev/open/meeting/${MEETING_ID}`

/** Stands for Claude Code's own row: it shows the text it was handed. */
function engineRow(on: On): void {
  on('ui.render', ($, e) => {
    const props = e.props as { text?: string; tool?: string }

    return { type: 'Text', props: {}, children: [`engine: ${props.text ?? props.tool ?? ''}`] }
  })
}

const assistantMessage = (text: string) =>
  ({ plugin: 'fylgja', component: 'AssistantMessage', props: { text, isFirstOfReply: true } }) as const

/**
 * One edit of the prompt box, sent through the plugin's hooks. The test
 * engine fires `prompt.edit` as it fires every event, but its declared type
 * leaves the event out, so the call is typed here.
 */
function edit($: Engine, input: PromptEditInput): Promise<PromptEditResult> {
  const prompt = $.prompt as unknown as { edit: (input: PromptEditInput) => Promise<PromptEditResult> }

  return prompt.edit(input)
}

describe('a reference in the prompt box', () => {
  const pasted = (text: string, inputText: string): PromptEditInput => ({
    origin: { kind: 'composer' },
    text,
    cursor: text.length,
    start: text.length,
    end: text.length,
    inputText,
  })

  test('is painted part by part, the draft left as it is, and Fylgja is asked nothing', async ($, on) => {
    const started = scene(on)
    on('prompt.edit', ($, e) => ({
      text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
      cursor: e.start + e.inputText.length,
    }))

    const box = await edit($, pasted('see ', `${MEETING} `))
    const start = 4
    const bar = start + MEETING.indexOf('|')

    expect(box).toEqual({
      text: `see ${MEETING} `,
      cursor: `see ${MEETING} `.length,
      decorations: [
        { start, end: start + '{{fylgja:'.length, dimColor: true },
        { start: start + '{{fylgja:'.length, end: bar, bold: true },
        { start: bar, end: start + MEETING.length, dimColor: true },
      ],
    })
    expect(box.text.slice(start + 9, bar)).toBe('meeting Pasted label')
    expect(box.text.slice(bar, start + MEETING.length)).toBe(`|${MEETING_ID}}}`)
    expect([started.connects(), started.calls, started.statuses]).toEqual([0, [], []])
  })

  test('paint another hook asked for is kept', async ($, on) => {
    const theirs = { start: 0, end: 3, color: 'claude' }
    on('prompt.edit', ($, e) => ({ text: e.text + e.inputText, cursor: 0, decorations: [theirs] }))

    const box = await edit($, pasted('see ', MEETING))

    expect(box.decorations?.length).toBe(4)
    expect(box.decorations?.[0]).toEqual(theirs)
  })

  test('a draft without references gets no paint', async ($, on) => {
    on('prompt.edit', ($, e) => ({ text: e.text + e.inputText, cursor: e.cursor + e.inputText.length }))

    expect(await edit($, pasted('plain ', 'text {{fylgja:meeting|nope}}'))).toEqual({
      text: 'plain text {{fylgja:meeting|nope}}',
      cursor: 34,
    })
  })
})

describe('a link to a Fylgja record in a reply', () => {
  test('gets its glyph, and nothing else in the reply changes', async ($, on) => {
    engineRow(on)
    const rest =
      'see [the docs](https://example.com/open/docs).\n' +
      `![shot](${LINK}) [short id](https://fylgja.lknblab.dev/open/meeting/1234) bare ${LINK}`
    const reply = `As agreed in [the retro](${LINK}) and [the plan](https://fylgja.lknblab.dev/open/note/${NOTE_ID}), ${rest}`
    const marked = `As agreed in [◉ the retro](${LINK}) and [✎ the plan](https://fylgja.lknblab.dev/open/note/${NOTE_ID}), ${rest}`

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...assistantMessage(reply), surface })

      expect(await ui.drawn(), surface).toEqual({ type: 'Text', props: {}, children: [`engine: ${marked}`] })
      await ui.unmount()
    }
  })

  test('every kind of record link has a glyph of its own', async ($, on) => {
    engineRow(on)
    const kinds = ['meeting', 'session', 'note', 'project', 'person']
    const reply = kinds.map((kind, n) => `[${kind}](https://fylgja.lknblab.dev/open/${kind}/${idOf(n)})`).join(' ')

    const ui = await $.ui.mount({ ...assistantMessage(reply), surface: 'terminal' })
    const row = await ui.find({ type: 'Text' })
    const line = String(row?.children?.[0] ?? '')
    const glyphs = [...line.matchAll(/\[(\S) (\w+)\]/g)].map(match => match[1])

    expect(glyphs.length).toBe(5)
    expect(new Set(glyphs).size).toBe(5)
  })

  test('a link that only looks like Fylgja’s is not marked', async ($, on) => {
    engineRow(on)
    const path = `/open/meeting/${MEETING_ID}`
    const reply = [
      `[a](https://fylgja.lknblab.dev@evil.example${path})`,
      `[b](https://fylgja.lknblab.dev.evil.example${path})`,
      `[c](https://evil.example/fylgja.lknblab.dev${path})`,
      `[d](https://fylgja.lknblab.dev:8443${path})`,
      `[e](https://user@fylgja.lknblab.dev${path})`,
      `[f](http://fylgja.lknblab.dev${path})`,
      `[g](https://fylgja-lknblab.dev${path})`,
      `[h](https://fylgja.lknblab.dev${path}/../../elsewhere)`,
    ].join(' ')

    const ui = await $.ui.mount({ ...assistantMessage(reply), surface: 'terminal' })

    expect(await ui.drawn()).toEqual({ type: 'Text', props: {}, children: [`engine: ${reply}`] })
  })

  test('a reply without such a link is passed through untouched', async ($, on) => {
    engineRow(on)
    const reply = `Nothing to cite. A bare ${LINK} is not a link, and [this](https://example.com) goes elsewhere.`

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...assistantMessage(reply), surface })

      expect(await ui.drawn(), surface).toEqual({ type: 'Text', props: {}, children: [`engine: ${reply}`] })
      await ui.unmount()
    }
  })

  test('a reply made of brackets is drawn without delay', async ($, on) => {
    engineRow(on)
    const reply = `${'['.repeat(40_000)}${'[x'.repeat(20_000)}[the retro](${LINK})`

    const before = performance.now()
    const ui = await $.ui.mount({ ...assistantMessage(reply), surface: 'terminal' })
    const row = await ui.find({ type: 'Text' })

    expect(String(row?.children?.[0]).endsWith(`[◉ the retro](${LINK})`)).toBe(true)
    expect(performance.now() - before < 1000).toBe(true)
  })
})
