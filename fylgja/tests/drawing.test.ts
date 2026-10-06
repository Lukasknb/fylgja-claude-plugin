import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { idOf, MEETING_ID, NOTE_ID } from './fixtures'

const SURFACES = ['terminal', 'desktop'] as const
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
