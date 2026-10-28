import { describe, expect, test } from 'claude-code/testing'

import { answer, idOf } from './fixtures'
import { claude, decision, dev, edit, fact, finish, NOTHING, press, pressTwice, QUIET, send, shown, stage, START, turn, verdict } from './scribe-fixtures'

const TALK = [dev('Use Postgres for the queue lock.'), claude('Done.', edit('src/queue/lock.ts'))]
const PRIOR = fact(5, { content: 'Use Redis with Redlock for the job queue.', anchors: [{ path: 'src/queue/lock.ts' }] })
const REVERSAL = { form: 'reversal', record: 0, prior: idOf(5), options: ['One less service to run'] }

describe('what Fylgja found when it checked a record against the ones like it', () => {
  test('a record Fylgja merged into one that already said it is counted written, with no receipt and no question', async ($, on) => {
    const set = stage(on, {
      replies: [verdict({ records: [decision()] })],
      tools: {
        remember: () =>
          answer({
            atom_id: idOf(7),
            outcome: 'duplicate',
            merged_into: idOf(7),
            relation_id: idOf(70),
            note: 'A memory already said this, so this one was merged into it.',
          }),
      },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember')).toHaveLength(1)
    expect(await shown($)).toBe(QUIET)
  })

  for (const key of ['replaces', 'different', 'skip']) {
    test(`a record the developer answered “${key}” about is not checked again by Fylgja`, async ($, on) => {
      const set = stage(on, {
        replies: [verdict({ records: [decision()], question: REVERSAL }), NOTHING],
        tools: { recall: () => answer({ facts: [PRIOR] }) },
      })

      await $.session.start(START)
      await turn($, set, ...TALK)
      await (key === 'replaces' ? pressTwice($, key) : press($, key))

      expect(set.of('remember')).toHaveLength(1)
      expect(set.of('remember')[0]?.check_relations).toBe(false)
    })
  }

  test('a record nobody was asked about is left to Fylgja to check', async ($, on) => {
    const set = stage(on, { replies: [verdict({ records: [decision()] })] })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember')[0]?.check_relations).toBeUndefined()
  })
})

describe('the conversation a record is filed under', () => {
  test('a conversation that goes on under another id while a record is drafted files the record under the id it has then', async ($, on) => {
    let id = 'aaaaaaaa-0000-4000-8000-000000000001'
    const set = stage(on, {
      replies: [verdict({ records: [decision()] })],
      sessionId: () => id,
      tools: {
        // The conversation is resumed (or forked) under its own id while Scribe looks up the files.
        recall: () => {
          id = 'eeeeeeee-0000-4000-8000-000000000005'

          return answer({ facts: [] })
        },
      },
    })

    await $.session.start(START)
    await turn($, set, ...TALK)

    expect(set.of('remember').map(args => args.session_id)).toEqual(['eeeeeeee-0000-4000-8000-000000000005'])
  })

  test('right after a resume, while the id the session reads still lags behind the one Claude Code named, a record is filed under the named one', async ($, on) => {
    let id = 'aaaaaaaa-0000-4000-8000-000000000001'
    const set = stage(on, {
      replies: [verdict({ records: [decision()] }), verdict({ records: [decision({ content: 'Use B.' })] })],
      sessionId: () => id,
    })

    await $.session.start(START)
    await turn($, set, ...TALK)
    set.rows.length = 0
    // The resumed conversation is named as its first prompt is sent...
    id = 'ffffffff-0000-4000-8000-000000000006'
    await send($, 'Use Postgres for the queue lock.')
    // ...and the session's own reading lags behind it for the rest of the turn.
    id = 'aaaaaaaa-0000-4000-8000-000000000001'
    await finish($, set, ...TALK)

    expect(set.of('remember').map(args => args.session_id)).toEqual([
      'aaaaaaaa-0000-4000-8000-000000000001',
      'ffffffff-0000-4000-8000-000000000006',
    ])
  })
})
