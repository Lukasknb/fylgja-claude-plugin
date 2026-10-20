import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { register } from '../hooks/register'
import { engineDrew, idOf } from './fixtures'

const SURFACES = ['terminal', 'desktop'] as const
const NAMES = ['mcp__plugin_fylgja_fylgja__', 'mcp__fylgja__'] as const

const ENGINE = engineDrew('drawn by Claude Code')

/** Stands for Claude Code's own row, and keeps what each was asked to draw. */
function engineRow(on: On): unknown[] {
  const asked: unknown[] = []

  on('ui.render', ($, e) => {
    asked.push(e.props)

    return { type: 'Text', props: {}, children: [...ENGINE.children] }
  })

  return asked
}

const result = (tool: string, output: unknown, isErrored = false) =>
  ({
    plugin: 'fylgja',
    component: 'ToolResult',
    props: { tool_use_id: 'toolu_1', tool, output, isErrored },
  }) as const

/** The words of a drawn receipt, its mark aside. */
async function lineOf(ui: { drawn: () => Promise<unknown> }): Promise<string> {
  const words: string[] = []
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      words.push(node)
    } else if (typeof node === 'object' && node !== null && 'children' in node && Array.isArray(node.children)) {
      node.children.forEach(walk)
    }
  }

  walk(await ui.drawn())

  return words.join('')
}

const RECEIPTS: readonly (readonly [string, Record<string, unknown>, string])[] = [
  ['remember', { atom_id: idOf(1), outcome: 'created', supersede: 'not_requested' }, '✓ Remembered.'],
  ['remember', { atom_id: idOf(1), outcome: 'created', supersede: 'applied' }, '✓ Remembered. It replaces an older note.'],
  ['remember', { atom_id: idOf(1), outcome: 'reconfirmed', supersede: 'not_requested' }, '✓ Already known — confirmed again.'],
  ['remember', { atom_id: null, outcome: 'duplicate', supersede: 'not_requested' }, '✓ Already known — nothing new stored.'],
  ['remember', { atom_id: idOf(1), outcome: 'restored', supersede: 'not_requested', note: null }, '✓ Remembered again — it had been removed.'],
  [
    'remember',
    {
      atom_id: idOf(1),
      outcome: 'created',
      supersede: 'not_requested',
      anchors: { paths: [{ path: 'src/a.ts', symbol: null }], commits: [], paths_total: 1, commits_total: 0 },
      anchors_added: 1,
      reason_status: 'not_stated',
      known_repos: [],
      repo_hint: null,
      note: null,
    },
    '✓ Remembered.',
  ],
  ['save_knowledge', { external_key: 'k', outcome: 'created', reason: null }, '✓ Saved to Fylgja.'],
  ['save_knowledge', { external_key: 'k', outcome: 'updated', reason: null }, '✓ Updated in Fylgja.'],
  ['save_knowledge', { external_key: 'k', outcome: 'unchanged', reason: null }, '✓ Already saved — nothing changed.'],
  ['restructure', { status: 'applied', change_id: idOf(2), records_moved: null }, '✓ Structure changed.'],
  ['restructure', { status: 'applied', change_id: idOf(2), records_moved: 3 }, '✓ Structure changed. 3 records moved.'],
  ['restructure', { status: 'applied', change_id: idOf(2), records_moved: 1 }, '✓ Structure changed. 1 record moved.'],
  ['restructure', { status: 'proposed', change_id: idOf(2) }, '✓ Proposed — it waits for you in Fylgja.'],
  ['restructure', { status: 'exists', project_id: idOf(3) }, '✓ Already there — nothing changed.'],
  ['restructure', { status: 'unchanged' }, '✓ Nothing moved.'],
  ['review_suggestion', { relation_id: idOf(4), decision: 'accept', kind: 'supersedes' }, '✓ Suggestion accepted — the newer value stands.'],
  ['review_suggestion', { relation_id: idOf(4), decision: 'reject', kind: 'supersedes' }, '✓ Suggestion withdrawn — both stay as they are.'],
  ['amend_memory', { atom_id: idOf(1), outcome: 'fixed' }, '✓ Fixed in Fylgja.'],
  ['amend_memory', { atom_id: idOf(1), outcome: 'removed' }, '✓ Removed from Fylgja.'],
  ['amend_memory', { atom_id: idOf(1), outcome: 'removed', restored_prior_id: idOf(2) }, '✓ Removed from Fylgja. The older note stands again.'],
  ['amend_memory', { atom_id: idOf(1), outcome: 'unchanged' }, '✓ Already so — nothing changed.'],
  ['attach_commit', { attached: 2, atom_ids: [idOf(1), idOf(2)] }, '✓ Commit noted on 2 records.'],
  ['attach_commit', { attached: 1, atom_ids: [idOf(1)] }, '✓ Commit noted on 1 record.'],
  ['attach_commit', { attached: 0, atom_ids: [] }, '✓ Commit already noted — nothing new.'],
  ['define_term', { outcome: 'created', term: { term: 'WP' } }, '✓ Term added — unconfirmed until you confirm it in Fylgja.'],
  ['define_term', { outcome: 'updated', term: { term: 'WP' } }, '✓ Term updated in Fylgja.'],
  ['define_term', { outcome: 'unchanged', term: { term: 'WP' } }, '✓ Term already says that — nothing changed.'],
  ['define_term', { outcome: 'rename_suggested', term: { term: 'WP' } }, '✓ New name suggested — it waits for you in Fylgja.'],
]

describe('a write to Fylgja', () => {
  for (const [tool, output, line] of RECEIPTS) {
    test(`${tool} ${JSON.stringify(output.outcome ?? output.status ?? output.decision ?? output.attached)} draws “${line}”`, async ($, on) => {
      engineRow(on)

      for (const surface of SURFACES) {
        for (const name of NAMES) {
          // As a stored object, and as the JSON text the server sends.
          for (const stored of [output, JSON.stringify(output), { content: [{ type: 'text', text: JSON.stringify(output) }] }]) {
            const ui = await $.ui.mount({ ...result(name + tool, stored), surface })

            expect(await lineOf(ui), `${surface} ${name}`).toBe(line)
            await ui.unmount()
          }
        }
      }
    })
  }

  const unexpected: readonly (readonly [string, unknown])[] = [
    ['remember', { outcome: 'archived' }],
    // A write that did less than was asked keeps the row that says why.
    ['remember', { outcome: 'created', supersede: 'rejected', supersede_rejected_reason: 'the prior note is newer' }],
    ['remember', { outcome: 'created', supersede: 'not_requested', grounding_flagged: true }],
    ['remember', { outcome: 'reconfirmed', supersede: 'rejected', supersede_rejected_reason: 'no such note' }],
    ['save_knowledge', { external_key: 'k', outcome: 'skipped', reason: 'too short to keep' }],
    ['restructure', { status: 'applied', records_moved: 2, records_skipped: 1 }],
    // Something that was sent was not applied, or the repository may be another's spelling: the row says which.
    ['remember', { atom_id: idOf(1), outcome: 'duplicate', supersede: 'not_requested', note: 'this record is another member’s' }],
    ['remember', { atom_id: idOf(1), outcome: 'restored', supersede: 'not_requested', note: 'this record is another member’s' }],
    ['remember', { atom_id: idOf(1), outcome: 'created', supersede: 'not_requested', repo_hint: 'did you mean acme/web?' }],
    ['amend_memory', 'refused:not_imperative — content must start with an instruction'],
    ['attach_commit', 'record not found'],
    ['remember', 'Refused: say what to do, not what happened.'],
    ['remember', null],
    ['save_knowledge', { item_id: idOf(1) }],
    ['restructure', { status: 'started', project_id: idOf(3) }],
    ['review_suggestion', { decision: 'maybe' }],
    ['review_suggestion', [{ type: 'text', text: 'not json' }]],
    ['amend_memory', { outcome: 'not found' }],
    ['attach_commit', { attached: 'two' }],
    ['define_term', { outcome: 'refused', reason: 'a person confirmed this entry' }],
  ]

  for (const [tool, output] of unexpected) {
    test(`${tool} answering ${JSON.stringify(output).slice(0, 70)} is left to Claude Code`, async ($, on) => {
      const asked = engineRow(on)

      for (const surface of SURFACES) {
        const mounted = result(`mcp__plugin_fylgja_fylgja__${tool}`, output)
        const ui = await $.ui.mount({ ...mounted, surface })

        expect(await ui.drawn(), surface).toEqual(ENGINE)
        expect(asked.at(-1), surface).toEqual(mounted.props)
        await ui.unmount()
      }
    })
  }

  test('a write that errored is left to Claude Code', async ($, on) => {
    engineRow(on)

    const ui = await $.ui.mount({
      ...result('mcp__fylgja__remember', { outcome: 'created' }, true),
      surface: 'terminal',
    })

    expect(await ui.drawn()).toEqual(ENGINE)
  })
})

describe('a read from Fylgja', () => {
  const READS = ['search', 'open', 'get_meeting', 'get_project', 'get_timeline', 'get_commitments', 'recall', 'resolve']
  // A result shaped like a write's, so only the tool's name can keep the plugin's hands off it.
  const output = { outcome: 'created', status: 'applied', decision: 'accept', records: [], facts: [] }

  for (const read of READS) {
    test(`${read} is drawn by Claude Code alone, call and result`, async ($, on) => {
      const asked = engineRow(on)

      for (const surface of SURFACES) {
        for (const name of NAMES) {
          const stored = result(name + read, output)
          const row = await $.ui.mount({ ...stored, surface })

          expect(await row.drawn(), `${surface} ${name} result`).toEqual(ENGINE)
          expect(asked.at(-1)).toEqual(stored.props)
          await row.unmount()

          const call = {
            tool_use_id: 'toolu_1',
            tool: name + read,
            input: { query: 'x' },
            isRunning: false,
            isErrored: false,
            isInterrupted: false,
            output,
          }
          const use = await $.ui.mount({ plugin: 'fylgja', component: 'ToolUse', props: call, surface })

          expect(await use.drawn(), `${surface} ${name} call`).toEqual(ENGINE)
          expect(asked.at(-1)).toEqual(call)
          await use.unmount()
        }
      }
    })
  }

  test('a write’s call row is drawn by Claude Code; only its result is the receipt', async ($, on) => {
    const asked = engineRow(on)
    const call = {
      tool_use_id: 'toolu_1',
      tool: 'mcp__fylgja__remember',
      input: { content: 'x' },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    }

    const use = await $.ui.mount({ plugin: 'fylgja', component: 'ToolUse', props: call, surface: 'terminal' })

    expect(await use.drawn()).toEqual(ENGINE)
    expect(asked.at(-1)).toEqual(call)
  })

  test('another server’s tool of the same name is not Fylgja’s', async ($, on) => {
    engineRow(on)

    const ui = await $.ui.mount({ ...result('mcp__notes__remember', { outcome: 'created' }), surface: 'terminal' })

    expect(await ui.drawn()).toEqual(ENGINE)
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

  const READS = ['search', 'open', 'get_meeting', 'get_project', 'get_timeline', 'get_commitments', 'recall', 'resolve']
  const WRITES = ['remember', 'save_knowledge', 'restructure', 'review_suggestion', 'define_term', 'amend_memory', 'attach_commit']

  test('it draws in the transcript at three places only, at a tool row only for a write’s result, above the prompt, and in its one window', () => {
    const drawing = hooked().filter(hook => hook.event === 'ui.render')
    const components = drawing.map(hook => (hook.matcher as { component?: unknown } | undefined)?.component)

    expect(components).toEqual(['UserMessage', 'AssistantMessage', 'ToolResult', 'AbovePrompt', 'Pane'])
    expect(drawing[4]?.matcher, 'the one pane it draws is its own').toEqual({ component: 'Pane', requestId: 'fylgja-kept' })

    const tool = (drawing[2]?.matcher as { props: { tool: RegExp } }).props.tool

    for (const prefix of ['mcp__plugin_fylgja_fylgja__', 'mcp__fylgja__']) {
      for (const read of READS) {
        expect(tool.test(prefix + read), prefix + read).toBe(false)
      }

      for (const write of WRITES) {
        expect(tool.test(prefix + write), prefix + write).toBe(true)
      }
    }

    for (const other of ['mcp__fylgja__push_document', 'mcp__fylgja__remember_all', 'xmcp__fylgja__remember', 'Bash']) {
      expect(tool.test(other), other).toBe(false)
    }
  })

  test('it hooks the prompt box, the prompt as sent, the end of a conversation, the description of its own reporting tool, the permission check, a tool’s result, a turn’s steps and end, a change to its own settings, its own command, its own keys and its own window: nothing that rewrites the conversation', () => {
    expect(
      hooked()
        .map(hook => hook.event)
        .filter(event => event !== 'ui.render'),
    ).toEqual([
      'session.start',
      'command.run',
      'command.run',
      'session.end',
      'prompt.edit',
      'prompt.submit',
      'tool.describe',
      'tool.check',
      'tool.call',
      'turn.step',
      'config.set',
      'turn.complete',
      'ui.press',
      'ui.input',
      'ui.press',
      'ui.input',
      'ui.focus',
      'ui.scroll',
      'ui.close',
    ])

    // The end of a conversation only as it goes on in another.
    expect(hooked().find(hook => hook.event === 'session.end')?.matcher).toEqual({ reason: ['clear', 'resume'] })

    // Everything hooked for the window names that window, and the command hooked is the plugin's own.
    const own = hooked().filter(hook => ['command.run', 'ui.focus', 'ui.scroll', 'ui.close'].includes(hook.event))

    expect(own.map(hook => hook.matcher)).toEqual([
      { command: 'fylgja-kept' },
      { command: 'fylgja-search' },
      { component: 'Pane', requestId: 'fylgja-kept' },
      { component: 'Pane', requestId: 'fylgja-kept' },
      { id: 'fylgja-kept' },
    ])
  })
})
