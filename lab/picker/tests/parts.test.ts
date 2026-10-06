import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { hitsOf, meetingsOf } from '../hooks/answers'
import { referenceOf } from '../hooks/candidate'
import { register } from '../hooks/register'
import { tokensIn } from '../hooks/token'
import { triggerAt } from '../hooks/trigger'
import { hit, hits, idOf, PRICING, RETRO, STANDUP, timeline, token } from './fixtures'

describe('the trigger', () => {
  const at = (text: string, cursor = text.length) => triggerAt(text, cursor)

  test('is @@ at the start of a word, or {{ anywhere, with the cursor after it', () => {
    expect(at('@@')).toEqual({ mark: '@@', start: 0, raw: '', query: '' })
    expect(at('see @@retro  plan ')).toEqual({
      mark: '@@',
      start: 4,
      raw: 'retro  plan ',
      query: 'retro plan',
    })
    expect(at('(@@q3')).toMatchObject({ mark: '@@', start: 1, query: 'q3' })
    expect(at('x{{Standup')).toMatchObject({
      mark: '{{',
      start: 1,
      query: 'Standup',
    })
    expect(at('see @@retro and more', 11)).toMatchObject({
      start: 4,
      query: 'retro',
    })
  })

  test('is nothing else', () => {
    for (const text of [
      '',
      '@',
      'a@@b',
      'mail lukas@@example',
      '@@@x',
      '@@a@b',
      '@@one\ntwo',
      '{{a}}',
      '{{a|b',
      '{{fylgja:meeting Sta',
      '{ {x',
    ]) {
      expect(at(text), text).toBeUndefined()
    }

    expect(at('@@retro', 1), 'the cursor inside the trigger').toBeUndefined()
    expect(at(`${token('meeting', 'Standup', idOf(3))} `), 'after a finished reference').toBeUndefined()
    expect(at(token('meeting', 'Standup', idOf(3)), 20), 'inside a finished reference').toBeUndefined()
    expect(at(`@@${'x'.repeat(61)}`), 'a query longer than a title').toBeUndefined()
    expect(at(`@@${'x'.repeat(60)}`)).toBeDefined()
  })
})

describe('reading Fylgja’s answers', () => {
  test('the timeline’s meetings are read in order, with date and id, the place they are filed under left out', () => {
    expect(meetingsOf(timeline([RETRO, PRICING, STANDUP]))).toEqual([
      {
        kind: 'meeting',
        id: RETRO.id,
        title: 'Engineering Retrospective',
        date: '2026-10-05',
      },
      {
        kind: 'meeting',
        id: PRICING.id,
        title: 'Pricing sync',
        date: '2026-10-02',
      },
      { kind: 'meeting', id: STANDUP.id, title: 'Standup', date: '2026-10-01' },
    ])
  })

  test('the timeline is read as bare text and as a structured result too', () => {
    const text = `- 2026-10-01 · meeting · Standup · in Zalion (id: ${STANDUP.id.toUpperCase()})`

    for (const answer of [text, { structuredContent: { result: text }, content: [], isError: false }]) {
      expect(meetingsOf(answer)?.map(one => [one.title, one.id])).toEqual([['Standup', STANDUP.id]])
    }

    expect(meetingsOf({ isError: true, content: [{ type: 'text', text }] })).toBeUndefined()
    expect(meetingsOf(42)).toBeUndefined()
    expect(meetingsOf('# Recent meetings\n\nNo meetings in this window.')).toEqual([])
  })

  test('a search’s structured result is read like its text', () => {
    const results = [
      hit('meeting', 'One', idOf(1)),
      hit('atom', 'Fact', idOf(2)),
      hit('note', 'Two', idOf(3), 'not a date'),
    ]
    const expected = [
      { kind: 'meeting', id: idOf(1), title: 'One', date: '2026-09-30' },
      { kind: 'note', id: idOf(3), title: 'Two', date: undefined },
    ]

    expect(hitsOf(hits(results))).toEqual(expected)
    expect(hitsOf({ structuredContent: { results }, content: [], isError: false })).toEqual(expected)
    expect(hitsOf({ results })).toEqual(expected)
  })

  test('at most six hits are kept', () => {
    const many = Array.from({ length: 20 }, (_, n) => hit('meeting', `M${n}`, idOf(n)))

    expect(hitsOf(hits(many))?.length).toBe(6)
  })
})

describe('the reference written', () => {
  test('is the one the Fylgja app copies', () => {
    const written = referenceOf({
      kind: 'meeting',
      id: RETRO.id,
      title: 'Engineering Retrospective',
      date: undefined,
    })

    expect(written).toBe(token('meeting', 'Engineering Retrospective', RETRO.id))
    expect(tokensIn(written).map(one => one.id)).toEqual([RETRO.id])
  })

  test('holds no brace or bar of a title’s, and no title at all when there is none', () => {
    expect(
      referenceOf({
        kind: 'note',
        id: idOf(1),
        title: 'a|b {c} ｛d｝ ｜',
        date: undefined,
      }),
    ).toBe(`{{fylgja:note a/b (c) (d) /|${idOf(1)}}}`)
    expect(
      referenceOf({
        kind: 'project',
        id: idOf(1),
        title: ' \n ',
        date: undefined,
      }),
    ).toBe(`{{fylgja:project|${idOf(1)}}}`)
  })
})

describe('what the plugin hooks', () => {
  type Hooked = { event: string; matcher: unknown }

  /** Every hook the plugin registers, as it names them. */
  function hooked(): Hooked[] {
    const seen: Hooked[] = []
    const on = (event: string, ...rest: unknown[]) => {
      seen.push({ event, matcher: rest.length === 2 ? rest[0] : undefined })

      return { catch: () => undefined }
    }

    register(on as unknown as On)

    return seen
  }

  test('it hooks no prompt on its way to Claude, no tool call, and nothing that rewrites the conversation', () => {
    expect(hooked().map(hook => hook.event)).toEqual([
      'session.start',
      'command.run',
      'prompt.edit',
      'ui.render',
      'ui.render',
    ])
  })

  test('it draws in the band above the prompt and in its own pane, nowhere else', () => {
    expect(
      hooked()
        .filter(hook => hook.event === 'ui.render')
        .map(hook => hook.matcher),
    ).toEqual([{ component: 'AbovePrompt' }, { component: 'Pane', requestId: 'fylgja-pick' }])
  })
})
