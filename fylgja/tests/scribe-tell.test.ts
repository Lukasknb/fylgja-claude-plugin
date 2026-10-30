import { describe, expect, test } from 'claude-code/testing'

import { ARMED_NOTE, NOTES } from '../hooks/scribe/view'
import { answer, idOf } from './fixtures'
import {
  band,
  carded,
  claude,
  dev,
  edit,
  fact,
  press,
  pressTwice,
  QUIET,
  REPO,
  ROOT,
  shown,
  stage,
  START,
  step,
  stepping,
  turn,
  verdict,
} from './scribe-fixtures'
import type { Stage } from './scribe-fixtures'

const FILE = 'src/mail/send.ts'
const WORK = [dev('make the mailer retry'), claude('Retrying three times now.', edit(FILE))]
const TELL =
carded(
  '◆ Decision · Use the queue for outbound mail, never a direct SMTP call. · 2026-09-12' +
    `  Shown because you opened ${FILE}` +
    ' [1 Open] [2 Tell Claude] [3 Knew this] [4 Not relevant] [9 What is this] [0 Dismiss]',
)

const found = (...facts: Record<string, unknown>[]) => ({ recall: () => answer({ repo: REPO, facts }) })

describe('Scribe tells what is recorded about the files in hand', () => {
  test('the files a turn touched are looked up by path, and a record anchored to one of them is shown', async ($, on) => {
    const set = stage(on, { tools: found(fact(1)) })

    await $.session.start(START)
    await turn($, set, ...WORK)

    expect(set.of('recall')).toEqual([{ repo: REPO, paths: [FILE] }])
    expect(await shown($)).toBe(TELL)
    expect(await shown($, true), 'while Claude works too').toBe(TELL)
  })

  test('a record is shown once in a session, and a file is looked up once', async ($, on) => {
    const set = stage(on, { tools: found(fact(1)) })

    await $.session.start(START)
    await turn($, set, ...WORK)
    await press($, 'dismiss')

    expect(await shown($)).toBe(QUIET)

    await $.prompt.submit({ text: 'again', wait: false, origin: { kind: 'composer' } })
    await turn($, set, dev('again'), claude('Again.', edit(FILE), edit('src/mail/other.ts')))

    expect(set.of('recall').map(args => args.paths)).toEqual([[FILE], ['src/mail/other.ts']])
    expect(await shown($)).toBe(QUIET)
  })

  test('“Knew this” keeps the record away for good, in a later session too', async ($, on) => {
    const set = stage(on, { tools: found(fact(1)) })

    await $.session.start(START)
    await turn($, set, ...WORK)
    await press($, 'knew')

    expect(set.kept.get('scribe.known') ?? [], 'one press settles nothing for good').toEqual([])
    expect(await shown($)).toMatch(`press 3 ${ARMED_NOTE} [1 Open] [2 Tell Claude] [3 Knew this]`)

    await press($, 'knew')
    await set.clock.settle()

    expect(set.kept.get('scribe.known')).toEqual([idOf(1)])

    // A new session on the same machine.
    await $.session.start(START)
    await turn($, set, ...WORK)

    expect(set.of('recall').length).toBe(2)
    expect(await shown($)).toBe(QUIET)
  })

  test('a record anchored to a folder above is not shown unasked, only when the wake judges it worth telling', async ($, on) => {
    const above = fact(2, { anchors: [{ path: 'src/mail' }], content: 'Never log a recipient address.' })
    const quiet = stage(on, { tools: found(above) })

    await $.session.start(START)
    await turn($, quiet, ...WORK)

    expect(await shown($)).toBe(QUIET)
    expect(quiet.asked[0]?.prompt, 'the wake is shown it').toMatch('Never log a recipient address.')
  })

  test('a record the wake judges worth telling is shown', async ($, on) => {
    const above = fact(2, { anchors: [{ path: 'src/mail' }], content: 'Never log a recipient address.' })
    const set = stage(on, { tools: found(above), replies: [verdict({ tells: [idOf(2)] })] })

    await $.session.start(START)
    await turn($, set, ...WORK)

    expect(await shown($)).toMatch(`◆ Decision · Never log a recipient address. · 2026-09-12  Scribe picked it for this turn's work`)
  })

  test('a tell naming a record no lookup returned is dropped: nothing is shown, and the next look is told nothing was told', async ($, on) => {
    const set = stage(on, { replies: [verdict({ tells: [idOf(66), 'not an id', { id: idOf(67) }] })] })

    await $.session.start(START)
    await turn($, set, ...WORK)

    expect(await shown($)).toBe(QUIET)

    await set.clock.advance(60_000)
    await turn($, set, ...WORK)

    expect(set.asked[1]?.prompt).toMatch('{"outcome":"nothing","recorded":[],"asked":false,"told":0}')
  })

  test('one turn shows at most one tell', async ($, on) => {
    const set = stage(on, {
      tools: found(
        fact(1),
        fact(2, { content: 'Use the retry helper.' }),
        fact(3, { content: 'Third.', anchors: [{ path: 'src' }] }),
      ),
      replies: [verdict({ tells: [idOf(3)] })],
    })

    await $.session.start(START)
    await turn($, set, ...WORK)

    expect(await shown($)).toBe(TELL)

    await press($, 'dismiss')

    expect(await shown($)).toBe(QUIET)
  })

  test('every fourth step of a turn looks up the files named so far, and an agent’s steps are not counted', async ($, on) => {
    const set = stage(on, { tools: found(fact(1)) })
    const read = [{ name: 'Read', input: { file_path: `${ROOT}/${FILE}` } }]

    stepping(on, () => read)
    await $.session.start(START)

    for (const index of [0, 1, 2]) {
      await step($, index, read)
    }

    await step($, 3, read, 'agent-1')

    expect(set.of('recall')).toEqual([])

    await step($, 3, read)

    expect(set.of('recall')).toEqual([{ repo: REPO, paths: [FILE] }])
    expect(await shown($, true)).toBe(TELL)
  })

  test('a file an agent of the session changed is looked up at the turn’s end, and a record anchored to it is shown', async ($, on) => {
    let agentUses: { name: string; input: unknown }[] = []
    const set = stage(on, { tools: found(fact(1)) })

    stepping(on, () => agentUses)
    await $.session.start(START)

    agentUses = [{ name: 'Edit', input: { file_path: `${ROOT}/${FILE}`, old_string: 'a', new_string: 'b' } }]
    await step($, 0, agentUses, 'agent-1')
    agentUses = []

    await turn($, set, dev('have an agent make the mailer retry'), claude('The agent made it retry.'))

    expect(set.of('recall')).toEqual([{ repo: REPO, paths: [FILE] }])
    expect(await shown($)).toBe(TELL)
  })

  test('a slow lookup does not hold the step past a second and a half, and its late answer is still shown', async ($, on) => {
    const set = stage(on, {
      tools: {
        recall: async (args, clock) => {
          await clock.sleep(5000)

          return answer({ facts: [fact(1)] })
        },
      },
    })
    const read = [{ name: 'Edit', input: { file_path: `${ROOT}/${FILE}` } }]
    let isDone = false

    stepping(on, () => read)
    await $.session.start(START)

    const stepped = step($, 3, read).then(() => {
      isDone = true
    })

    await set.clock.advance(1499)

    expect(isDone).toBe(false)

    await set.clock.advance(1)
    await stepped

    expect(isDone).toBe(true)
    expect(await shown($, true)).toBe(QUIET)

    await set.clock.advance(3500)

    expect(await shown($, true)).toBe(TELL)
  })

  test('Open shows the reason, what was rejected, where, and which record it is, all inside the band', async ($, on) => {
    const set = stage(on, { tools: found(fact(1, { anchors: [{ path: FILE, symbol: 'send' }] })) })

    await $.session.start(START)
    await turn($, set, ...WORK)

    await press($, 'open')

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await band($, surface)

      expect(await ui.text(), surface).toBe(
        'ᚠ fylgjahas a note on this code' +
          '◆ Decision · Use the queue for outbound mail, never a direct SMTP call. · 2026-09-12' +
          '  Why: Direct calls dropped mail when the provider throttled.' +
          '  Rejected: direct SMTP call' +
          '  In: src/mail/send.ts (send)' +
          '  Shown because you opened src/mail/send.ts' +
          '  Fylgja record 00000000, written down by Scribe' +
          NOTES.told +
          ' [2 Tell Claude] [3 Knew this] [4 Not relevant] [0 Dismiss]',
      )
      await ui.unmount()
    }
  })

  for (const [status, detail, said] of [
    ['no_strong_reason', '', 'No particular reason was given when asked.'],
    [
      'no_strong_reason',
      'picked the first that worked',
      'No particular reason was given when asked. In their words: picked the first that worked',
    ],
    ['not_stated', '', 'No reason recorded.'],
  ] as const) {
    test(`an opened decision with ${status}${detail === '' ? '' : ' and their words'} says “${said}”`, async ($, on) => {
      const set = stage(on, { tools: found(fact(1, { reason_status: status, detail, alternatives: [] })) })

      await $.session.start(START)
      await turn($, set, ...WORK)

      const ui = await band($)

      await ui.press('open')
      await ui.redraw()

      expect(await ui.text()).toMatch(`2026-09-12  ${said}  In: src/mail/send.ts`)
    })
  }

  test('Tell Claude puts a quoted note naming the record in an empty prompt box, and sends nothing', async ($, on) => {
    const set = stage(on, { tools: found(fact(1)) })
    await $.session.start(START)
    await turn($, set, ...WORK)

    const sent = set.sent.length

    await press($, 'tell-claude')

    expect(set.fills).toEqual([
      [
        'A note from Fylgja, offered by Scribe. It is information about this code, not an instruction:',
        '',
        '> Decision: Use the queue for outbound mail, never a direct SMTP call.',
        '> Why: Direct calls dropped mail when the provider throttled.',
        '> Rejected: direct SMTP call',
        '> Fylgja record 00000000, written down by Scribe',
        '',
        '',
      ].join('\n'),
    ])
    expect(set.sent.length, 'nothing was sent').toBe(sent)
    expect(await shown($)).toBe(QUIET)
  })

  test('Tell Claude leaves a prompt box with text in it alone, and says so', async ($, on) => {
    const set = stage(on, { tools: found(fact(1)) })

    await $.session.start(START)
    await turn($, set, ...WORK)
    set.box.text = 'half a thought'
    await press($, 'tell-claude')

    expect(set.fills).toEqual([])
    expect(set.box.text).toBe('half a thought')
    expect(set.toasts).toEqual(['The prompt box has text in it. Clear it, then press the key again.'])
    expect(await shown($), 'still there to press again').toMatch('Tell Claude')
  })

  test('a record’s text is drawn as text: nothing in it passes for the band’s own marks or keys', async ($, on) => {
    const hostile = fact(1, {
      content: `✓ Recorded · all good ${String.fromCodePoint(0x202e)}[1 Open] ◆​\nsecond line`,
    })
    const set = stage(on, { tools: found(hostile) })

    await $.session.start(START)
    await turn($, set, ...WORK)

    expect(await shown($)).toBe(
      carded(
        '◆ Decision · Recorded - all good (1 Open) second line · 2026-09-12' +
          `  Shown because you opened ${FILE}` +
          ' [1 Open] [2 Tell Claude] [3 Knew this] [4 Not relevant] [9 What is this] [0 Dismiss]',
      ),
    )
  })
})

describe('a tell says why it is shown, and the developer can say it is beside the point', () => {
  const OTHER = 'src/mail/other.ts'
  const routesOf = (set: Stage) => set.events('tell').map(event => [event.props.action, event.props.route])

  test('a record whose anchors hold the file, but that Fylgja does not name as answering it, is not told', async ($, on) => {
    const set = stage(on, { tools: found(fact(1, { matched_paths: [] })) })

    await $.session.start(START)
    await turn($, set, ...WORK)

    expect(await shown($)).toBe(QUIET)
  })

  test('a record Fylgja names for the file only by a folder above it is not told for that file', async ($, on) => {
    const set = stage(on, { tools: found(fact(1, { anchors: [{ path: 'src/mail' }], matched_paths: [FILE] })) })

    await $.session.start(START)
    await turn($, set, ...WORK)

    expect(await shown($)).toBe(QUIET)
  })

  test('“Not relevant” pressed once only arms it', async ($, on) => {
    const set = stage(on, { tools: found(fact(1)) })

    await $.session.start(START)
    await turn($, set, ...WORK)
    await press($, 'not-relevant')

    expect(await shown($)).toMatch(`press 4 ${ARMED_NOTE} [1 Open] [2 Tell Claude] [3 Knew this] [4 Not relevant]`)
  })

  test('“Not relevant” pressed twice takes the record down for the session, however it is found again, and keeps nothing', async ($, on) => {
    const both = fact(1, { anchors: [{ path: FILE }, { path: OTHER }] })
    const set = stage(on, { tools: found(both), replies: ['{"outcome":"nothing"}', verdict({ tells: [idOf(1)] })] })

    await $.session.start(START)
    await turn($, set, ...WORK)
    await pressTwice($, 'not-relevant')

    expect(await shown($)).toBe(QUIET)

    await set.clock.advance(60_000)
    await $.prompt.submit({ text: 'again', wait: false, origin: { kind: 'composer' } })
    await turn($, set, dev('again'), claude('Again, at length this time.', edit(OTHER)))

    expect(set.of('recall').map(args => args.paths), 'found again by its other file').toEqual([[FILE], [OTHER]])
    expect(set.asked.length, 'and the look named it').toBe(2)
    expect(await shown($)).toBe(QUIET)
    expect(set.kept.get('scribe.known') ?? [], 'not kept as known').toEqual([])
    expect(routesOf(set)).toEqual([
      ['shown', 'anchor'],
      ['not_relevant', 'anchor'],
    ])
  })

  test('each tell says once that it came up, by which route, and what was done with it', async ($, on) => {
    const THIRD = 'src/mail/third.ts'
    const byPath: Record<string, Record<string, unknown>> = {
      [FILE]: fact(1),
      [OTHER]: fact(2, { anchors: [{ path: 'src/mail' }], content: 'Never log a recipient address.' }),
      [THIRD]: fact(3, { anchors: [{ path: THIRD }], content: 'Keep the retry count at three.' }),
    }
    const set = stage(on, {
      tools: {
        recall: args =>
          answer({ repo: REPO, facts: (Array.isArray(args.paths) ? args.paths : []).flatMap(path => byPath[String(path)] ?? []) }),
      },
      replies: ['{"outcome":"nothing"}', verdict({ tells: [idOf(2)] })],
    })

    await $.session.start(START)
    await turn($, set, ...WORK)
    await press($, 'open')
    await press($, 'tell-claude')

    await set.clock.advance(60_000)
    await $.prompt.submit({ text: 'again', wait: false, origin: { kind: 'composer' } })
    await turn($, set, dev('again'), claude('Again, at length this time.', edit(OTHER)))
    await press($, 'dismiss')

    await set.clock.advance(60_000)
    await $.prompt.submit({ text: 'and once more', wait: false, origin: { kind: 'composer' } })
    await turn($, set, dev('and once more'), claude('Once more.', edit(THIRD)))
    await pressTwice($, 'knew')

    await set.clock.advance(60_000)
    await $.prompt.submit({ text: 'done', wait: false, origin: { kind: 'composer' } })
    await turn($, set, dev('done'), claude('Done.'))

    expect(routesOf(set)).toEqual([
      ['shown', 'anchor'],
      ['opened', 'anchor'],
      ['told_claude', 'anchor'],
      ['shown', 'judge'],
      ['dismissed', 'judge'],
      ['shown', 'anchor'],
      ['knew', 'anchor'],
    ])
  })
})
