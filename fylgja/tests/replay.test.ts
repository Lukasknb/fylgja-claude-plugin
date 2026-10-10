import { describe, expect, test } from 'claude-code/testing'

import { observe, plain } from '../hooks/scribe/delta'
import { labelOf, recordedOf } from './scenarios/transcript'

const ROOT = '/work/app'
let serial = 0

/** A line of a recorded session, as the CLI writes one; every word of these is made up. */
function line(type: string, content: unknown, more: Record<string, unknown> = {}): string {
  serial += 1

  return JSON.stringify({
    type,
    uuid: `u-${serial}`,
    sessionId: 'session-1',
    cwd: ROOT,
    version: '2.1.296',
    timestamp: new Date(Date.UTC(2026, 9, 1, 9, serial)).toISOString(),
    message: { role: type, id: more.messageId ?? `m-${serial}`, content },
    ...more,
  })
}

const human = (text: string, more: Record<string, unknown> = {}) => line('user', text, { origin: { kind: 'human' }, ...more })
const says = (text: string, messageId?: string) =>
  line('assistant', [{ type: 'text', text }], messageId === undefined ? {} : { messageId })
const calls = (id: string, name: string, input: Record<string, unknown>, messageId?: string) =>
  line('assistant', [{ type: 'tool_use', id, name, input }], messageId === undefined ? {} : { messageId })
const returns = (id: string, content: unknown, isError = false) =>
  line('user', [{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }])

describe('a recorded session is read into the turns of its main conversation', () => {
  test('a prompt, Claude’s reply and its tool calls become the rows a session would hold, each call with what it returned', () => {
    const recorded = recordedOf([
      human('make the mailer retry'),
      says('Looking at the mailer.', 'm-a'),
      calls('t1', 'Read', { file_path: `${ROOT}/src/mail/send.ts` }, 'm-a'),
      returns('t1', [{ type: 'text', text: '1→export const RETRIES = 1' }]),
      calls('t2', 'Edit', { file_path: `${ROOT}/src/mail/send.ts`, old_string: '1', new_string: '3' }),
      returns('t2', 'no such string', true),
      says('It retries three times now.'),
    ])

    expect(recorded.sessionId).toBe('session-1')
    expect(recorded.turns.length).toBe(1)

    const [turn] = recorded.turns

    expect(turn).toMatchObject({ kind: 'prompt', source: 'human', prompt: 'make the mailer retry', cwd: ROOT })
    expect(turn?.rows.map(row => [row.role, row.text, row.toolUses.map(use => use.tool)])).toEqual([
      ['user', 'make the mailer retry', []],
      ['assistant', 'Looking at the mailer.', ['Read']],
      ['assistant', '', ['Edit']],
      ['assistant', 'It retries three times now.', []],
    ])
    expect(
      turn?.rows[1]?.toolUses[0]?.text,
      'one message written over two lines is one row, and holds what its call returned',
    ).toBe('1→export const RETRIES = 1')
    expect(turn?.rows[2]?.toolUses[0]).toMatchObject({ isError: true, text: 'no such string' })

    const seen = observe(turn?.rows ?? [], ROOT, new Set([plain('make the mailer retry')]))

    expect(seen.touched, 'and Scribe’s own reading finds the file').toEqual(['src/mail/send.ts'])
    expect(seen.developer).toMatch('make the mailer retry')
  })

  test('each prompt begins a turn; a notice from a background task begins one that is not the developer’s', () => {
    const recorded = recordedOf([
      human('first thing'),
      says('Done.'),
      line('user', '<task-notification>agent finished</task-notification>', { origin: { kind: 'task-notification' } }),
      says('Noted.'),
      human('second thing', { promptSource: 'queued' }),
      says('Done too.'),
    ])

    expect(recorded.turns.map(turn => [turn.kind, turn.source, turn.rows.length])).toEqual([
      ['prompt', 'human', 2],
      ['other', 'task-notification', 2],
      ['prompt', 'human', 2],
    ])
    expect(recorded.turns[1] === undefined ? '' : labelOf(recorded.turns[1])).toMatch(/^\(task-notification\)/)
  })

  test('rows of an agent, rows only Claude was shown and lines that are no rows are left out and counted', () => {
    const recorded = recordedOf([
      human('do it'),
      line('assistant', [{ type: 'text', text: 'an agent thinking aloud' }], { isSidechain: true }),
      line('user', 'an agent’s own prompt', { isSidechain: true }),
      line('user', '<local-command-caveat>not for the reader</local-command-caveat>', { isMeta: true }),
      line('user', [{ type: 'text', text: 'a skill’s text' }], { isMeta: true }),
      JSON.stringify({ type: 'file-history-snapshot', snapshot: {} }),
      JSON.stringify({ type: 'system', subtype: 'turn_duration', durationMs: 5 }),
      'not json at all',
      '',
      line('assistant', [{ type: 'thinking', thinking: 'private' }]),
      says('Done.'),
    ])

    expect(recorded.turns.length).toBe(1)
    expect(recorded.turns[0]?.rows.map(row => row.text)).toEqual(['do it', 'Done.'])
    expect(recorded.left).toEqual({ sidechain: 2, meta: 2, unreadable: 1, other: 2 })
  })

  test('a compaction is a point of its own: the one row that took the place of what came before', () => {
    const recorded = recordedOf([
      human('first thing'),
      says('Done.'),
      JSON.stringify({ type: 'system', subtype: 'compact_boundary', sessionId: 'session-1' }),
      line('user', 'This session is being continued from a previous conversation. Summary: things were done.', {
        isCompactSummary: true,
      }),
      human('carry on'),
      says('Carrying on.'),
    ])

    expect(recorded.turns.map(turn => turn.kind)).toEqual(['prompt', 'compact', 'prompt'])
    expect(recorded.turns[1]?.rows.length).toBe(1)
    expect(recorded.turns[1]?.rows[0]?.text).toMatch(/^This session is being continued/)
  })

  test('a /clear is a point of its own, and any other slash command reads as it was typed', () => {
    const recorded = recordedOf([
      human('first thing'),
      line(
        'user',
        '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>',
      ),
      line('user', '<local-command-stdout></local-command-stdout>'),
      line(
        'user',
        '<command-message>wp</command-message>\n<command-name>/wp</command-name>\n<command-args>tidy the queue</command-args>',
      ),
      says('On it.'),
    ])

    expect(recorded.turns.map(turn => [turn.kind, turn.prompt])).toEqual([
      ['prompt', 'first thing'],
      ['clear', ''],
      ['prompt', '/wp tidy the queue'],
    ])
  })

  test('a plan approved in plan mode is kept whole enough to be read as the plan', () => {
    const plan = `# Plan: queue lock\n\n${'Use an advisory lock because the worker already holds a connection. '.repeat(120)}`
    const recorded = recordedOf([human('plan the lock'), calls('p1', 'ExitPlanMode', { plan }), returns('p1', 'approved')])
    const [turn] = recorded.turns

    expect(turn?.hasPlan).toBe(true)
    expect(String(turn?.rows[1]?.toolUses[0]?.input.plan).length, 'longer than any other input is let be').toBe(plan.length)

    const seen = observe(turn?.rows ?? [], ROOT, new Set([plain('plan the lock')]))

    expect(seen.plans.length, 'and Scribe’s own reading takes it for the plan').toBe(1)
  })

  test('a plan document that was written is kept as a document; any other long input is clipped', () => {
    const text = `# Design: notifications\n\n${'x'.repeat(9000)}`
    const recorded = recordedOf([
      human('write the design down'),
      calls('w1', 'Write', { file_path: `${ROOT}/docs/design/notifications.md`, content: text }),
      returns('w1', 'File created'),
      calls('w2', 'Write', { file_path: `${ROOT}/src/big.ts`, content: 'y'.repeat(9000) }),
      returns('w2', 'z'.repeat(9000)),
    ])
    const [turn] = recorded.turns
    const [, design, code] = turn?.rows ?? []

    expect(String(design?.toolUses[0]?.input.content).length).toBe(text.length)
    expect(String(code?.toolUses[0]?.input.content).length).toBe(4000)
    expect(code?.toolUses[0]?.text?.length).toBe(2000)

    const seen = observe(turn?.rows ?? [], ROOT, new Set([plain('write the design down')]))

    expect(seen.plans.length).toBe(1)
    expect(seen.hasChange).toBe(true)
  })

  test('a commit made by a shell call is there for Scribe to find, by the line git printed', () => {
    const recorded = recordedOf([
      human('commit it'),
      calls('b1', 'Bash', { command: 'git commit -m "retry three times"' }),
      returns('b1', '[main 1a2b3c4] retry three times\n 1 file changed, 1 insertion(+), 1 deletion(-)'),
    ])
    const [turn] = recorded.turns
    const seen = observe(turn?.rows ?? [], ROOT, new Set([plain('commit it')]))

    expect(seen.commits).toEqual(['1a2b3c4'])
  })

  test('a session of an older build, which does not say what began a turn, has every plain prompt taken as the developer’s', () => {
    const recorded = recordedOf([
      line('user', 'make the mailer retry'),
      says('Done.'),
      line('user', '<task-notification>agent finished</task-notification>'),
      line('user', '[Request interrupted by user]'),
    ])

    expect(recorded.turns.map(turn => turn.kind)).toEqual(['prompt', 'other'])
  })

  test('a turn is named in few words: no more than sixty characters of its prompt', () => {
    const [turn] = recordedOf([human(`rename ${'the very long thing '.repeat(20)}`)]).turns

    expect(turn === undefined ? 0 : labelOf(turn).length).toBe(60)
  })
})
