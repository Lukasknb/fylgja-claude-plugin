import { describe, expect, test } from 'claude-code/testing'

import {
  answer,
  band,
  buttonsIn,
  CHILD_ID,
  CONNECTED,
  fenced,
  HOSTILE_TITLE,
  idOf,
  linkTo,
  meeting,
  MEETING_ID,
  NOTE_ID,
  openedMeeting,
  pane,
  PROJECT_ID,
  refusal,
  scene,
  SESSION,
  SESSION_ID,
  shownIn,
  SURFACES,
  TODAY,
  token,
  typePeek,
} from './fixtures'

describe('/peek', () => {
  for (const surface of SURFACES) {
    test(`shows a meeting section by section, each foldable, with its own link at the top (${surface})`, async ($, on) => {
      const started = scene(on)

      expect(await $.session.start(SESSION)).toEqual({ cwd: '/work/repo' })
      expect(await typePeek($, MEETING_ID)).toEqual({})
      await started.clock.settle()

      // The person typed the command, so the pane may take the keyboard.
      expect(started.opened).toEqual([{ id: 'fylgja-peek', title: 'Fylgja peek', closeOnEscape: true, focus: true }])

      const ui = await $.ui.mount(pane(surface))
      const link = await ui.find({ type: 'Link' })

      expect(link?.props).toEqual({ href: linkTo('meeting', MEETING_ID), label: 'Open in Fylgja' })
      expect(shownIn(await ui.drawn())).toEqual([
        'Copy reference',
        'Refresh',
        'Close',
        '1/1',
        'Open in Fylgja',
        '◉ Engineering Retrospective',
        'meeting · 2026-09-30 · Engineering > Platform · shared with your team',
        '▾ Participants (2)',
        'Ada Lovelace, Grace Hopper',
        '▾ Summary',
        'The team looked back at the release.\n\nTwo things went wrong and one went well.',
        '▾ Decisions (2)',
        '• Freeze deploys on Fridays',
        '• Move the runner to the new host',
        '▾ Key points (2)',
        '• Deploys were slow',
        '• The rollback worked',
        '▾ Commitments (1)',
        '• Write the runbook',
        ' - Grace Hopper - due 2026-10-14 - open',
      ])

      await ui.press({ key: 'fold:decisions' })
      await ui.press({ key: 'fold:summary' })
      const folded = shownIn(await ui.drawn())

      expect(folded).toContain('▸ Decisions (2)')
      expect(folded).toContain('▸ Summary')
      expect(folded).not.toContain('• Freeze deploys on Fridays')
      expect(folded).toContain('• Deploys were slow')

      await ui.press({ key: 'fold:decisions' })

      expect(shownIn(await ui.drawn())).toContain('• Freeze deploys on Fridays')
      expect(started.forbidden).toEqual([])
      expect(started.submitted).toEqual([])
    })
  }

  test('takes a pasted reference, a link, a markdown link and a bare id, and opens the same record', async ($, on) => {
    const started = scene(on)
    const link = linkTo('meeting', MEETING_ID)

    for (const typed of [token('meeting', 'Any label', MEETING_ID), link, `<${link}>`, `[the retro](${link})`, `  ${MEETING_ID.toUpperCase()} `]) {
      expect(await typePeek($, typed), typed).toEqual({})
    }

    await started.clock.settle()
    const ui = await $.ui.mount(pane())

    expect(started.opened.length).toBe(5)
    expect(await ui.find({ text: '◉ Engineering Retrospective' })).toBeDefined()
    // One record, read once, and one entry in the history.
    expect(started.tools()).toEqual(['open', 'get_meeting'])
    expect(shownIn(await ui.drawn())).toContain('1/1')
  })

  test('says what it takes when the argument names no record, and asks Fylgja nothing', async ($, on) => {
    const started = scene(on)

    for (const typed of ['the retro', 'https://example.com/open/meeting/' + MEETING_ID, '{{fylgja:meeting|nope}}', '1234', `${MEETING_ID} and more`]) {
      const said = await typePeek($, typed)

      expect(said.text, typed).toMatch(/^That names no Fylgja record\. Usage: \/peek </)
    }

    expect((await typePeek($, '')).text).toMatch(/^Nothing peeked at yet\. Usage: \/peek </)
    expect([started.connects(), started.calls, started.opened]).toEqual([0, [], []])
  })

  test('with no argument reopens the last record after the pane was closed', async ($, on) => {
    const started = scene(on)
    await typePeek($, MEETING_ID)
    await started.clock.settle()
    const ui = await $.ui.mount(pane())
    await ui.press({ key: 'close' })

    expect(started.closed).toEqual(['fylgja-peek'])

    expect(await typePeek($, '')).toEqual({})
    await started.clock.settle()

    expect(started.opened.length).toBe(2)
    expect(await ui.find({ text: '◉ Engineering Retrospective' })).toBeDefined()
    expect(started.tools()).toEqual(['open', 'get_meeting'])
  })

  test('answers at once while Fylgja says nothing, and the pane says it is reading', async ($, on) => {
    scene(on, {
      connect: async clock => {
        await clock.sleep(3_600_000)

        return CONNECTED
      },
    })

    // The clock is never moved: the command returns without any wait ending.
    expect(await typePeek($, MEETING_ID)).toEqual({})

    const ui = await $.ui.mount(pane())

    expect(shownIn(await ui.drawn())).toEqual(['Close', '1/1', '□ Reading from Fylgja…'])
  })
})

describe('a project in the pane', () => {
  test('lists what is under it one level deep; a child can be stepped into and back out of', async ($, on) => {
    const started = scene(on)
    await typePeek($, linkTo('project', PROJECT_ID))
    await started.clock.settle()
    const ui = await $.ui.mount(pane())

    expect(shownIn(await ui.drawn())).toEqual([
      'Copy reference',
      'Refresh',
      'Close',
      '1/1',
      'Open in Fylgja',
      '▤ Platform',
      'project · 2026-09-30 · Engineering · shared with your team',
      'Everything that keeps the product running.',
      '12 meetings · last activity 2026-09-30',
      'Under it',
      '▸ Deploys',
      '2 under it · 2026-09-28',
    ])

    await ui.press({ key: `child:${CHILD_ID}` })
    await started.clock.settle()
    const inside = shownIn(await ui.drawn())

    expect(inside).toContain('▤ Deploys')
    expect(inside).toContain('project · 2026-09-30 · Engineering > Platform · shared with your team')
    expect(inside).toContain('Nothing is filed under it.')
    expect(buttonsIn(await ui.drawn())).toEqual(['← Back', 'Copy reference', 'Refresh', 'Close'])

    await ui.press({ key: 'back' })
    await started.clock.settle()

    expect(shownIn(await ui.drawn())).toContain('▤ Platform')
    expect(buttonsIn(await ui.drawn())).toContain('Forward →')

    await ui.press({ key: 'forward' })
    await started.clock.settle()

    expect(shownIn(await ui.drawn())).toContain('▤ Deploys')
    // Stepping back and forward shows what was read; nothing is read twice.
    expect(started.calls.map(call => call.args.ref)).toEqual([PROJECT_ID, CHILD_ID])
  })
})

describe('a note or a session in the pane', () => {
  for (const surface of SURFACES) {
    test(`is drawn as markdown; a link to another record is the pane’s to answer, any other link shows its address (${surface})`, async ($, on) => {
      const started = scene(on)
      await typePeek($, token('note', '', NOTE_ID))
      await started.clock.settle()
      const ui = await $.ui.mount(pane(surface))
      const body = await ui.find({ type: 'Markdown' })

      expect(shownIn(await ui.drawn()).slice(4, 7)).toEqual(['Open in Fylgja', '✎ Deploy checklist', 'note · Engineering > Platform · private to you'])
      expect(body?.props.text).toBe(
        [
          '**Kind:** note · **Origin:** saved · **Status:** current · **Project:** Platform',
          '',
          '## Before',
          'Check the **runner** first.',
          `See [the retro](${linkTo('meeting', MEETING_ID)}) and the docs (https://example.com/docs).`,
        ].join('\n'),
      )
      expect(body?.props.pressableLinks).toEqual([linkTo('meeting', MEETING_ID)])

      await ui.press({ key: 'peek-body', link: { href: linkTo('meeting', MEETING_ID) } })
      await started.clock.settle()

      expect(shownIn(await ui.drawn())).toContain('◉ Engineering Retrospective')
      expect(shownIn(await ui.drawn())).toContain('2/2')
    })
  }

  test('a session is read from its text: its heading, its date, and that it is private', async ($, on) => {
    const started = scene(on)
    await typePeek($, SESSION_ID)
    await started.clock.settle()
    const ui = await $.ui.mount(pane())
    const shown = shownIn(await ui.drawn())

    expect(shown.slice(4, 7)).toEqual(['Open in Fylgja', '⌁ Session — Platform — Fix the runner — 2026-10-01', 'session · 2026-10-01 · private to you'])
    expect((await ui.find({ type: 'Link' }))?.props.href).toBe(linkTo('session', SESSION_ID))
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toMatch(/## Summary\nThe runner was pulled and restarted\.$/)
  })

  test('hostile text cannot hide a link, draw invisibly, or pass for the pane’s own controls', async ($, on) => {
    const evil = [
      `# ${HOSTILE_TITLE}`,
      '',
      '[Open in Fylgja](https://evil.example/login)',
      '[nested [label]](https://evil.example/a)',
      '![pixel](https://evil.example/track.png)',
      '[ref-style][x]',
      '',
      '[x]: https://evil.example/b',
      `invisible​‮ text and a bell\u0007`,
      `[look-alike](https://fylgja.lknblab.dev.evil.example/open/meeting/${MEETING_ID})`,
    ].join('\n')
    const started = scene(on, { tools: { ...TODAY, open: () => answer(fenced(evil)) } })
    await typePeek($, linkTo('note', NOTE_ID))
    await started.clock.settle()
    const ui = await $.ui.mount(pane())
    const text = String((await ui.find({ type: 'Markdown' }))?.props.text)

    expect(text).toBe(
      [
        'Open in Fylgja (https://evil.example/login)',
        '[nested [label]] (https://evil.example/a)',
        'pixel (image)',
        '[ref-style][x]',
        '',
        '\\[x\\]: https://evil.example/b',
        'invisible text and a bell ',
        `look-alike (https://fylgja.lknblab.dev.evil.example/open/meeting/${MEETING_ID})`,
      ].join('\n'),
    )
    // No link in the text is the pane's to answer, and the one real link is the pane's own.
    expect((await ui.find({ type: 'Markdown' }))?.props.pressableLinks).toBeUndefined()
    expect((await ui.findAll({ type: 'Link' })).map(link => link.props.href)).toEqual([linkTo('note', NOTE_ID)])
    expect(shownIn(await ui.drawn())[5]).toBe(`✎ Retro) ( 'Fake' - 2026-01-01 ((fylgja:meeting Evil|${idOf(666)})) | x|y - end`)
  })
})

describe('Copy reference', () => {
  test('puts the record’s reference into the prompt box at the cursor, and sends nothing', async ($, on) => {
    const started = scene(on)
    await typePeek($, MEETING_ID)
    await started.clock.settle()
    const ui = await $.ui.mount(pane())
    await ui.press({ key: 'copy' })
    await started.clock.settle()

    expect(started.filled).toEqual([{ text: `${token('meeting', 'Engineering Retrospective', MEETING_ID)} `, mode: 'insert' }])
    expect(started.submitted).toEqual([])
    expect(shownIn(await ui.drawn())).toContain('The reference is in the prompt box. Nothing was sent.')
  })

  test('writes one well-formed reference whatever the title holds', async ($, on) => {
    const started = scene(on, { tools: { ...TODAY, open: () => answer(openedMeeting({ title: HOSTILE_TITLE })) } })
    await typePeek($, MEETING_ID)
    await started.clock.settle()
    const ui = await $.ui.mount(pane())
    await ui.press({ key: 'copy' })
    await started.clock.settle()
    const text = started.filled[0]?.text ?? ''

    // One opening, one bar, one closing: the title added no second reference and no second id.
    expect(text).toMatch(new RegExp(`^\\{\\{fylgja:meeting [^{}|\\n]{1,200}\\|${MEETING_ID}\\}\\} $`))
    expect(text).not.toContain(idOf(666))
  })

  test('where the prompt box takes nothing, the reference is shown in the pane to select', async ($, on) => {
    const started = scene(on, { takesFill: false })
    await typePeek($, NOTE_ID)
    await started.clock.settle()
    const ui = await $.ui.mount(pane('desktop'))
    await ui.press({ key: 'copy' })
    await started.clock.settle()

    expect(shownIn(await ui.drawn()).slice(4, 6)).toEqual(['The prompt box did not take it. Select the reference here:', token('note', 'Deploy checklist', NOTE_ID)])
    expect(started.forbidden).toEqual([])
  })
})

describe('when Fylgja does not answer as expected', () => {
  const cases: [string, () => unknown, string][] = [
    ['a record that is not there', () => refusal('record not found'), 'Not found, or not yours to read.'],
    ['a refusal', () => refusal('Rate limit reached. Wait 12 seconds before calling again.'), 'Fylgja did not answer.'],
    [
      'a call that fails',
      () => {
        throw new Error('socket hang up')
      },
      'Fylgja did not answer.',
    ],
    ['an answer of another shape', () => answer({ rows: [1, 2, 3] }), 'Fylgja answered with something this build cannot show.'],
    ['an answer for another record', () => answer(openedMeeting({ id: idOf(7) })), 'Fylgja answered with something this build cannot show.'],
    ['an answer that is no tool result', () => 42, 'Fylgja answered with something this build cannot show.'],
    ['empty text', () => answer(''), 'Fylgja answered with something this build cannot show.'],
  ]

  for (const [name, open, line] of cases) {
    test(`${name} is one plain line in the pane, with a way to try again`, async ($, on) => {
      let isBroken = true
      const started = scene(on, { tools: { ...TODAY, open: (args, clock) => (isBroken ? open() : TODAY.open?.(args, clock)) } })

      expect(await typePeek($, MEETING_ID)).toEqual({})
      await started.clock.settle()
      const ui = await $.ui.mount(pane())

      expect(shownIn(await ui.drawn())).toEqual(['Retry', 'Close', '1/1', line])

      isBroken = false
      await ui.press({ key: 'retry' })
      await started.clock.settle()

      expect(shownIn(await ui.drawn())).toContain('◉ Engineering Retrospective')
      expect(started.forbidden).toEqual([])
    })
  }

  test('a meeting whose second read fails is shown without the sections that read would have brought', async ($, on) => {
    const started = scene(on, { tools: { ...TODAY, get_meeting: () => refusal('Rate limit reached.') } })
    await typePeek($, MEETING_ID)
    await started.clock.settle()
    const ui = await $.ui.mount(pane())
    const shown = shownIn(await ui.drawn())

    expect(shown).toContain('▾ Decisions (2)')
    expect(shown.slice(shown.indexOf('▾ Participants'), shown.indexOf('▾ Summary'))).toEqual(['▾ Participants', 'Not read.'])
    expect(shown.slice(-2)).toEqual(['▾ Commitments', 'Not read.'])
  })

  test('a record Fylgja cut short says so', async ($, on) => {
    const started = scene(on, { tools: { ...TODAY, get_meeting: args => answer(meeting({ included: args.include, truncated: true })) } })
    await typePeek($, MEETING_ID)
    await started.clock.settle()
    const ui = await $.ui.mount(pane())

    expect(shownIn(await ui.drawn())).toContain('▾ Commitments (1)')
    expect((await ui.findAll({ text: 'Fylgja cut this record short; the rest is in the app.' })).length > 0).toBe(true)
  })
})

describe('where no pane can be placed', () => {
  for (const surface of SURFACES) {
    test(`the same view is drawn in the band above the prompt, until it is closed (${surface})`, async ($, on) => {
      const started = scene(on, { placesPane: false })
      const above = await $.ui.mount(band(surface))

      // Nothing was asked for yet: the band is whatever it was.
      expect(await above.drawn()).toEqual({ type: 'Text', props: {}, children: ['engine: AbovePrompt'] })

      await typePeek($, MEETING_ID)
      await started.clock.settle()
      const shown = shownIn(await above.drawn())

      expect(shown.slice(0, 6)).toEqual(['Copy reference', 'Refresh', 'Close', '1/1', 'Open in Fylgja', '◉ Engineering Retrospective'])

      await above.press({ key: 'fold:summary' })

      expect(shownIn(await above.drawn())).toContain('▸ Summary')

      await above.press({ key: 'close' })

      expect(await above.drawn()).toEqual({ type: 'Text', props: {}, children: ['engine: AbovePrompt'] })
    })
  }

  test('a placed pane leaves the band alone', async ($, on) => {
    const started = scene(on)
    const above = await $.ui.mount(band())
    await typePeek($, MEETING_ID)
    await started.clock.settle()

    expect(await above.drawn()).toEqual({ type: 'Text', props: {}, children: ['engine: AbovePrompt'] })
  })
})

describe('a pane that is open before anything was peeked at', () => {
  test('says how to start', async ($, on) => {
    scene(on)
    const ui = await $.ui.mount(pane())

    expect(shownIn(await ui.drawn())).toEqual(['Nothing peeked at yet. Type /peek and a reference, a link or an id, or click a Fylgja link in a reply.'])
  })
})

describe('a conversation that starts over', () => {
  test('drops what was read, and an open pane reads its record again', async ($, on) => {
    const started = scene(on)
    await typePeek($, MEETING_ID)
    await started.clock.settle()
    const ui = await $.ui.mount(pane())
    await $.classic.SessionStart({ source: 'clear' } as never)
    await started.clock.settle()

    expect(shownIn(await ui.drawn())).toContain('◉ Engineering Retrospective')
    expect(started.tools()).toEqual(['open', 'get_meeting', 'open', 'get_meeting'])
  })
})

describe('other kinds of record', () => {
  test('a person is shown by name, role and what happened lately; a kind without a view says so', async ($, on) => {
    const person = {
      kind: 'person',
      scope: 'only records you may read',
      full_name: 'Grace Hopper',
      role: 'Staff engineer',
      organization: 'Zalion',
      interactions: [{ id: idOf(1), meeting_id: MEETING_ID, date: '2026-09-30', summary: 'Took the runbook', update_type: 'commitment' }],
    }
    const decision = { kind: 'decision', id: idOf(3), what: 'Freeze deploys on Fridays', decided_at: '2026-09-30' }
    const started = scene(on, { tools: { open: args => answer(args.ref === idOf(2) ? person : decision) } })
    await typePeek($, linkTo('person', idOf(2)))
    await started.clock.settle()
    const ui = await $.ui.mount(pane())

    expect(shownIn(await ui.drawn()).slice(4)).toEqual([
      'Open in Fylgja',
      '◐ Grace Hopper',
      'person',
      'Staff engineer - Zalion',
      'Lately',
      '• Took the runbook',
      ' - 2026-09-30',
    ])

    await ui.press({ key: 'copy' })
    await typePeek($, idOf(3))
    await started.clock.settle()

    // A person has no pasted-reference form, so its link is what goes into the prompt box.
    expect(started.filled).toEqual([{ text: `${linkTo('person', idOf(2))} `, mode: 'insert' }])
    expect(shownIn(await ui.drawn()).slice(4)).toEqual(['◆ Freeze deploys on Fridays', 'decision', 'The pane has no view for a decision yet.'])
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
  })
})

describe('at session start', () => {
  test('the command is offered, nothing is asked of Fylgja and nothing is drawn', async ($, on) => {
    const started = scene(on)

    expect(await $.session.start(SESSION)).toEqual({ cwd: '/work/repo' })
    await started.clock.settle()

    expect(started.registered).toEqual([
      { name: 'peek', description: 'Read a Fylgja record in a pane beside the conversation', argumentHint: '[reference, link or id]' },
    ])
    expect([started.connects(), started.calls, started.opened, started.forbidden]).toEqual([0, [], [], []])
  })
})
