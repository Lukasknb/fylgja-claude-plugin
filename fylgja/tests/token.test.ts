import { describe, expect, test } from 'claude-code/testing'

import { distinctById, tokensIn } from '../hooks/token'
import { MEETING_ID, NOTE_ID, token } from './fixtures'

describe('references in text', () => {
  test('each of the four kinds is read with its id and place', () => {
    for (const kind of ['meeting', 'session', 'note', 'project']) {
      const written = token(kind, 'Launch checklist', MEETING_ID)
      const [found] = tokensIn(`see ${written} please`)

      expect(found).toEqual({
        start: 4,
        end: 4 + written.length,
        text: written,
        kind,
        id: MEETING_ID,
        bar: 4 + written.indexOf('|'),
      })
    }
  })

  test('a reference without a title is read', () => {
    expect(tokensIn(token('meeting', '', MEETING_ID)).map(found => found.id)).toEqual([MEETING_ID])
  })

  test('a title keeps quotes and an ellipsis', () => {
    const written = token('note', 'Say "hi" to the team and everyone else we…', NOTE_ID)

    expect(tokensIn(written).map(found => found.text)).toEqual([written])
  })

  test('a malformed reference is not one', () => {
    const malformed = [
      '{{fylgja:meeting Standup|not-a-uuid}}',
      `{{fylgja:meeting Standup ${MEETING_ID}}}`,
      `{{fylgja:meeting Standup|${MEETING_ID.slice(0, 35)}}}`,
      `{{fylgja:commitment Ship it|${MEETING_ID}}}`,
      `{{fylgja:meeting Stand{up|${MEETING_ID}}}`,
      `{{fylgja:meeting Stand|up|${MEETING_ID}}}`,
      `{fylgja:meeting Standup|${MEETING_ID}}`,
      `{{fylgja:meetingStandup|${MEETING_ID}}}`,
    ]

    for (const text of malformed) {
      expect(tokensIn(text), text).toEqual([])
    }
  })

  test('the same record written twice is kept once, the first as written', () => {
    const first = token('meeting', 'Standup', MEETING_ID)
    const again = token('meeting', 'Another label', MEETING_ID.toUpperCase())
    const other = token('note', 'Plan', NOTE_ID)

    expect(distinctById(tokensIn(`${first} ${again} ${other}`)).map(found => found.text)).toEqual([first, other])
  })
})
