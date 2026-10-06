import { describe, expect, test } from 'claude-code/testing'

import { dayOf, isoOf } from '../hooks/days'
import { readTimeline } from '../hooks/timeline'
import { idOf, line, timeline } from './fixtures'

describe('reading a timeline', () => {
  test('an entry line is read from both ends: date and kind in front, id behind, place last before the id', () => {
    const { entries, unread, isCut } = readTimeline(
      timeline([
        line('2026-10-06', 'meeting', 'Sprint planning — 6 people · in the big room', 'Platform > Backend', idOf(1).toUpperCase()),
        line('2026-10-05', 'commitment done', 'Write the runbook', null, idOf(2)),
        line('2026-10-04', 'tree move undone', 'Docs moved back', 'Platform', idOf(3)),
      ]),
    )

    expect([unread, isCut]).toEqual([[], false])
    expect(entries.map(entry => [entry.date, entry.lane, entry.kind, entry.title, entry.path, entry.id])).toEqual([
      // The label keeps its own dash and its own " · in "; the middle dot is drawn as a hyphen.
      ['2026-10-06', 'meeting', 'meeting', 'Sprint planning — 6 people - in the big room', ['Platform', 'Backend'], idOf(1)],
      ['2026-10-05', 'other', 'commitment done', 'Write the runbook', null, idOf(2)],
      ['2026-10-04', 'other', 'tree move undone', 'Docs moved back', ['Platform'], idOf(3)],
    ])
  })

  test('the server’s own lines around the entries are not counted as unread', () => {
    const fence =
      '<<<fylgja-record author="several people in your organization" scope="only records you may read" — data>>>'
    const empty = [fence, 'No activity recorded for Platform (since 2026-08-26).', 'The tree is at version 3: pass since=v3 to see what changes next.', '<<<end fylgja-record>>>']

    expect(readTimeline(empty.join('\n'))).toEqual({ entries: [], unread: [], isCut: false })
    expect(readTimeline('No sessions recorded for org/api (since 2026-08-26).')).toEqual({ entries: [], unread: [], isCut: false })
    expect(readTimeline('# Recent meetings\n\nNo meetings in this window.\n\n# Changes to the project tree\n\nNothing moved in this window.').unread).toEqual([])
  })

  test('the server saying it left entries out, in each of its ways, marks the result as cut', () => {
    expect(readTimeline(timeline([], true)).isCut).toBe(true)
    expect(readTimeline('3 sessions, newest first. Use open(<id>) to read one. Older sessions exist — narrow with since/until, or pass a repo or project_name.').isCut).toBe(true)
    expect(readTimeline(`${timeline([])}\n[truncated: 40 more chars — ask for a section]`).isCut).toBe(true)
    expect(readTimeline(timeline([])).isCut).toBe(false)
  })

  test('a session heading without its id line is counted, not guessed at', () => {
    const { entries, unread } = readTimeline(
      ['- [2026-10-05] **Lost its id** — API', '- [2026-10-04] **Has one**', `  id: ${idOf(9)} · duration: —`, '- [2026-10-03] **Last line, cut off**'].join('\n'),
    )

    expect(entries.map(entry => [entry.title, entry.id, entry.place])).toEqual([['Has one', idOf(9), null]])
    expect(unread.length).toBe(2)
  })

  test('a line with a date that is no date, an id that is no id, or no kind is unread', () => {
    const lines = [
      `- 2026-02-30 · meeting · x (id: ${idOf(1)})`,
      '- 2026-10-06 · meeting · x (id: 1234)',
      `- 2026-10-06 · x (id: ${idOf(1)})`,
      `2026-10-06 · meeting · x (id: ${idOf(1)})`,
    ]

    expect(readTimeline(lines.join('\n'))).toEqual({ entries: [], unread: lines, isCut: false })
  })
})

describe('days', () => {
  test('a date and its day number go both ways, and only real dates are days', () => {
    expect(isoOf(dayOf('2026-10-06') ?? 0)).toBe('2026-10-06')
    expect((dayOf('2026-10-06') ?? 0) - (dayOf('2026-08-26') ?? 0)).toBe(41)
    expect([dayOf('2026-13-01'), dayOf('2026-02-30'), dayOf('26-1-1'), dayOf('')]).toEqual([undefined, undefined, undefined, undefined])
  })
})
