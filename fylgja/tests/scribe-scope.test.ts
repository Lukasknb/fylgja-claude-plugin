import { describe, expect, test } from 'claude-code/testing'

import { answer, idOf } from './fixtures'
import { pane } from './window-fixtures'
import { claude, decision, dev, edit, fact, press, REPO, shown, stage, START, turn, verdict } from './scribe-fixtures'

const FILE = 'src/erp/export.ts'
const TALK = [
  dev('Northwind puts two surcharges on one order line, so give every line three neutral surcharge slots.'),
  claude('Done, three slots per line in src/erp/export.ts.', edit(FILE)),
]
const SLOTS = decision({
  content: 'Give every purchase-order line three neutral surcharge slots, each with an id and a net amount.',
  detail: 'Northwind often puts two surcharges, or freight and packaging separately, on one line.',
  alternatives: ['one surcharge per line'],
  anchors: [{ path: FILE }],
  applies_to: ['northwind'],
})

/** Fylgja's answer to a write: a new record, holding for the organizations it knows by these names. */
const holdingFor =
  (...names: string[]) =>
  (args: Record<string, unknown>) =>
    answer({ atom_id: idOf(101), outcome: 'created', ...('applies_to' in args ? { applies_to: names } : {}) })

const COMMAND = {
  command: 'fylgja-kept',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
} as never

describe('where a record holds', () => {
  test('a record the session made clear holds for one customer is sent for it, and the card names it as Fylgja does', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [SLOTS] })], tools: { remember: holdingFor('Northwind') } })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember')[0]).toMatchObject({ repo: REPO, applies_to: ['northwind'] })
    expect(await shown($)).toMatch('For: Northwind')
  })

  test('a record that holds generally is sent without it, and its card names nobody', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [decision({ anchors: [{ path: FILE }] })] })] })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect('applies_to' in (set.of('remember')[0] ?? {})).toBe(false)
    expect(await shown($)).not.toMatch('For:')
  })

  test('the kept window shows where the opened record holds', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [SLOTS] })], tools: { remember: holdingFor('Northwind') } })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await press($, 'ok')
    await $.command.run(COMMAND)

    const ui = await pane($)

    expect(await ui.lines()).toContain('For: Northwind')

    await ui.unmount()
  })

  test('a server that does not take it gets the record without it, once, and is not sent it again this session', async ($, on) => {
    const untaken = {
      content: [
        {
          type: 'text',
          text: 'remember was called with invalid arguments — an argument this tool does not take (it takes: alternatives, anchors, author, base_dirty, base_sha, content, cwd, detail, hostname, kind, reason_status, recalled_atom_id, repo, scope, session_id, supersedes, triggers, volatility)',
        },
      ],
      isError: true,
    }
    let written = 0
    const set = stage(on, {
      replies: [verdict({ records: [SLOTS] }), verdict({ records: [{ ...SLOTS, content: 'Send the export as one file per warehouse.' }] })],
      tools: {
        remember: args => {
          if ('applies_to' in args) {
            return untaken
          }

          written += 1

          return answer({ atom_id: idOf(200 + written), outcome: 'created' })
        },
      },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await turn($, set, dev('and per warehouse?'), claude('Done.', edit(FILE)))

    expect(set.of('remember').map(args => args.applies_to)).toEqual([['northwind'], undefined, undefined])
    expect(written, 'both records are written').toBe(2)
    expect(await shown($), 'and no card names an organization Fylgja did not take').not.toMatch('For:')
  })

  test('a refusal for anything else is not taken for an old server: the next record is sent with it again', async ($, on) => {
    const refused = { content: [{ type: 'text', text: 'refused:not_imperative — say it as an instruction' }], isError: true }
    const set = stage(on, {
      replies: [verdict({ records: [{ ...SLOTS, content: 'Use A.' }, SLOTS] })],
      tools: { remember: args => (args.content === 'Use A.' ? refused : answer({ atom_id: idOf(301), outcome: 'created' })) },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember').map(args => [args.content, args.applies_to])).toEqual([
      ['Use A.', ['northwind']],
      [SLOTS.content, ['northwind']],
    ])
  })

  test('a recorded decision about the files in hand that holds for one customer says so on its card', async ($, on) => {
    const set = stage(on, {
      tools: { recall: () => answer({ repo: REPO, facts: [fact(1, { anchors: [{ path: FILE }], applies_to: ['Northwind'] })] }) },
    })

    await $.session.start(START)
    await turn($, set, dev('make the export faster'), claude('Faster now.', edit(FILE)))

    expect(await shown($)).toMatch('For: Northwind')
  })

  test('a record Scribe rewrites in place is sent where it holds too, and the card after the update says for whom', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [{ ...SLOTS, applies_to: [] }] }), verdict({ records: [{ ...SLOTS, updates: idOf(101) }] })],
      tools: {
        amend_memory: args => answer({ atom_id: args.atom_id, outcome: 'fixed', ...('applies_to' in args ? { applies_to: ['Northwind'] } : {}) }),
      },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await turn($, set, dev('that is only for Northwind, mind'), claude('Noted.', edit(FILE)))

    expect(set.of('amend_memory')[0]).toMatchObject({ atom_id: idOf(101), op: 'fix', applies_to: ['northwind'] })
    expect(await shown($)).toMatch('For: Northwind')
  })

  test('a server that does not take it with a rewrite gets the rewrite without it, once', async ($, on) => {
    const untaken = {
      content: [
        {
          type: 'text',
          text: 'amend_memory was called with invalid arguments — an argument this tool does not take (it takes: alternatives, anchors, atom_id, base_dirty, base_sha, content, detail, op, reason_status, remove_anchors)',
        },
      ],
      isError: true,
    }
    const set = stage(on, {
      replies: [verdict({ records: [{ ...SLOTS, applies_to: [] }] }), verdict({ records: [{ ...SLOTS, updates: idOf(101) }] })],
      tools: { amend_memory: args => ('applies_to' in args ? untaken : answer({ atom_id: args.atom_id, outcome: 'fixed' })) },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)
    await turn($, set, dev('that is only for Northwind, mind'), claude('Noted.', edit(FILE)))

    expect(set.of('amend_memory').map(args => args.applies_to)).toEqual([['northwind'], undefined])
    expect(await shown($)).toMatch('Updated')
  })
})
