import { expect, test } from 'claude-code/testing'

import { meetingIn } from '../hooks/reference'
import { MEETING_ID, token } from './fixtures'

test('a meeting is read from a reference, a link or an id, and from nothing else', () => {
  expect(meetingIn(`  ${token('meeting', 'Standup', MEETING_ID)} `)).toEqual({ id: MEETING_ID })
  expect(meetingIn(`https://fylgja.lknblab.dev/open/meeting/${MEETING_ID}?x=1`)).toEqual({ id: MEETING_ID })
  expect(meetingIn(MEETING_ID.toUpperCase())).toEqual({ id: MEETING_ID })
  expect('problem' in meetingIn(`${MEETING_ID}0`)).toBe(true)
  expect('problem' in meetingIn(`see ${MEETING_ID}`)).toBe(true)
  expect('problem' in meetingIn(`https://fylgja.lknblab.dev/open/meeting/${MEETING_ID}abc`)).toBe(true)
  expect('problem' in meetingIn('{{fylgja:meeting Standup|not-an-id}}')).toBe(true)
})
