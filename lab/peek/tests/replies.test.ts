import { describe, expect, test } from 'claude-code/testing'

import {
  answer,
  buttonsIn,
  cardsIn,
  CONNECTED,
  HOSTILE_TITLE,
  idOf,
  linkTo,
  MEETING_ID,
  NEEDS_SIGN_IN,
  NEWER,
  NOTE_ID,
  openedMeeting,
  pane,
  PLUGIN,
  prompt,
  reply,
  scene,
  shownIn,
  SURFACES,
  TODAY,
  token,
} from './fixtures'

const LINK = linkTo('meeting', MEETING_ID)
const REPLY = `As agreed in [the retro](${LINK}), deploys freeze on Fridays.`

describe('a reply that cites a Fylgja record', () => {
  for (const surface of SURFACES) {
    test(`is drawn at once with a bare chip, and gets its card once Fylgja has answered (${surface})`, async ($, on) => {
      const started = scene(on, {
        tools: {
          ...TODAY,
          open: async (args, clock) => {
            await clock.sleep(300)

            return TODAY.open?.(args, clock)
          },
        },
      })
      const ui = await $.ui.mount(reply(REPLY, surface))

      // Nothing has answered yet: the reply is there, the chip claims nothing, there is no card.
      expect(await ui.find({ type: 'Markdown', text: REPLY }), surface).toBeDefined()
      expect(buttonsIn(await ui.drawn()), surface).toEqual(['◉ meeting'])
      expect(cardsIn(await ui.drawn()), surface).toEqual([])

      await started.clock.advance(300)
      await started.clock.settle()

      expect(buttonsIn(await ui.drawn()), surface).toEqual(['◉ Engineering Retrospective'])
      expect(cardsIn(await ui.drawn()), surface).toEqual([
        ['◉ meeting · 2026-09-30', 'Engineering Retrospective', 'Engineering > Platform', '2 decisions · 1 commitment', 'click to peek'],
      ])
      expect(started.forbidden).toEqual([])
    })
  }

  test('never waits for Fylgja: the reply is drawn while the server says nothing at all', async ($, on) => {
    const started = scene(on, {
      connect: async clock => {
        await clock.sleep(3_600_000)

        return CONNECTED
      },
    })

    // The clock is never moved: the drawing comes back without any wait ending.
    const ui = await $.ui.mount(reply(REPLY))

    expect(buttonsIn(await ui.drawn())).toEqual(['◉ meeting'])
    expect(started.calls).toEqual([])
  })

  test('asks about a record once, however often and wherever it is drawn', async ($, on) => {
    const started = scene(on)
    const first = await $.ui.mount(reply(REPLY))
    const second = await $.ui.mount(reply(`Again: [same meeting](${LINK}) and [once more](${LINK}).`))
    await started.clock.settle()
    await first.redraw()
    await second.redraw()
    await started.clock.settle()

    // Today's server has no `resolve`: that is found out once, then the record is read.
    expect(started.tools()).toEqual(['resolve', 'open', 'get_meeting'])
    expect(started.calls[0]?.args).toEqual({ refs: [MEETING_ID] })
    expect(buttonsIn(await second.drawn())).toEqual(['◉ Engineering Retrospective'])
  })

  test('a lookup that failed is not repeated by drawing the reply again', async ($, on) => {
    const started = scene(on, {
      tools: {
        open: () => {
          throw new Error('socket hang up')
        },
      },
    })
    const ui = await $.ui.mount(reply(REPLY))
    await started.clock.settle()

    for (let n = 0; n < 5; n += 1) {
      await ui.redraw()
      await started.clock.settle()
    }

    expect(started.tools()).toEqual(['resolve', 'open'])
    expect(buttonsIn(await ui.drawn())).toEqual(['◉ meeting'])
    expect(cardsIn(await ui.drawn())).toEqual([])
  })

  test('on a server with resolve, one call names every record and only a meeting is read for its counts', async ($, on) => {
    const started = scene(on, { tools: NEWER })
    const ui = await $.ui.mount(reply(`[retro](${LINK}), [checklist](${linkTo('note', NOTE_ID)}) and [gone](${linkTo('note', idOf(404))}).`))
    await started.clock.settle()

    expect(started.calls.map(call => [call.tool, call.args])).toEqual([
      ['resolve', { refs: [MEETING_ID, NOTE_ID, idOf(404)] }],
      ['get_meeting', { meeting_id: MEETING_ID, include: ['summary', 'decisions', 'key_points', 'action_items', 'participants'] }],
    ])
    expect(buttonsIn(await ui.drawn())).toEqual(['◉ Engineering Retrospective', '✎ Deploy checklist', '✎ note - not found'])
    expect(cardsIn(await ui.drawn())).toEqual([
      ['◉ meeting · 2026-09-30', 'Engineering Retrospective', 'Engineering > Platform', '2 decisions · 1 commitment', 'click to peek'],
      ['✎ note', 'Deploy checklist', 'click to peek'],
      ['✎ note', 'Not found, or not yours to read.'],
    ])
  })

  for (const surface of SURFACES) {
    test(`a click on the citation opens the record in the pane, and so does a click on its chip (${surface})`, async ($, on) => {
      const started = scene(on)
      const ui = await $.ui.mount(reply(REPLY, surface))
      await started.clock.settle()

      await ui.press({ key: 'peek-reply', link: { href: LINK } })
      await started.clock.settle()

      expect(started.opened, surface).toEqual([{ id: 'fylgja-peek', title: 'Fylgja peek', closeOnEscape: true }])

      const side = await $.ui.mount(pane(surface))

      expect(await side.find({ type: 'Text', text: '◉ Engineering Retrospective' }), surface).toBeDefined()
      expect(await side.find({ type: 'Link', text: 'Open in Fylgja' }), surface).toBeDefined()

      await ui.press({ key: `peek:${MEETING_ID}` })
      await started.clock.settle()

      expect(started.opened.length, surface).toBe(2)
      // The record was read for the card already; the clicks cost nothing more.
      expect(started.tools(), surface).toEqual(['resolve', 'open', 'get_meeting'])
      expect(started.submitted).toEqual([])
    })
  }

  test('only the links to records are answered by the plugin; every other link is left to the surface', async ($, on) => {
    const started = scene(on)
    const ui = await $.ui.mount(reply(`${REPLY} See also [the docs](https://example.com/docs).`))
    await started.clock.settle()
    const markdown = await ui.find({ type: 'Markdown' })

    expect(markdown?.props.pressableLinks).toEqual([LINK])
  })

  test('a link that only looks like Fylgja’s, a bare address and an image leave the reply to Claude Code', async ($, on) => {
    const started = scene(on)
    const path = `/open/meeting/${MEETING_ID}`
    const text = [
      `[a](https://fylgja.lknblab.dev@evil.example${path})`,
      `[b](https://fylgja.lknblab.dev.evil.example${path})`,
      `[c](https://evil.example/fylgja.lknblab.dev${path})`,
      `[d](https://fylgja.lknblab.dev:8443${path})`,
      `[e](http://fylgja.lknblab.dev${path})`,
      `[f](https://fylgja.lknblab.dev${path}/../../elsewhere)`,
      `[g](https://fylgja.lknblab.dev/open/meeting/1234)`,
      `![shot](${LINK}) bare ${LINK}`,
    ].join(' ')

    for (const surface of SURFACES) {
      const ui = await $.ui.mount(reply(text, surface))
      await started.clock.settle()

      expect(await ui.drawn(), surface).toEqual({ type: 'Text', props: {}, children: [`engine: ${text}`] })
    }

    expect([started.connects(), started.calls]).toEqual([0, []])
  })

  test('where nothing can be hovered or clicked, the reply is Claude Code’s own and Fylgja is asked nothing', async ($, on) => {
    const started = scene(on)
    const mainScreen = { ...reply(REPLY), viewport: { columns: 120, rows: 40, isFullscreen: false } }
    const unmeasured = { ...reply(REPLY), viewport: undefined }

    for (const row of [mainScreen, unmeasured]) {
      const ui = await $.ui.mount(row)
      await started.clock.settle()

      expect(await ui.drawn()).toEqual({ type: 'Text', props: {}, children: [`engine: ${REPLY}`] })
    }

    expect([started.connects(), started.calls]).toEqual([0, []])
  })

  test('a summary of the conversation is left alone', async ($, on) => {
    const started = scene(on)
    const row = reply(REPLY)
    const ui = await $.ui.mount({ ...row, props: { ...row.props, isSummary: true } })
    await started.clock.settle()

    expect(await ui.drawn()).toEqual({ type: 'Text', props: {}, children: [`engine: ${REPLY}`] })
    expect(started.calls).toEqual([])
  })

  test('with replyLinks set to engine, Claude Code keeps drawing the reply and the chips sit under it', { options: { replyLinks: 'engine' } }, async ($, on) => {
    const started = scene(on)
    const ui = await $.ui.mount(reply(REPLY))
    await started.clock.settle()

    expect(await ui.find({ type: 'Text', text: `engine: ${REPLY}` })).toBeDefined()
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    expect(buttonsIn(await ui.drawn())).toEqual(['◉ Engineering Retrospective'])

    await ui.press({ key: `peek:${MEETING_ID}` })
    await started.clock.settle()

    expect(started.opened.length).toBe(1)
  })

  test('a hostile title cannot pass as a chip, a card line, a second record or invisible text', async ($, on) => {
    const started = scene(on, {
      tools: { ...TODAY, open: () => answer(openedMeeting({ title: HOSTILE_TITLE, project: { path: [`Eng] [◉ "x"`, 'Platform‮'], id: idOf(1) } })) },
    })
    const ui = await $.ui.mount(reply(REPLY))
    await started.clock.settle()
    const shown = shownIn(await ui.drawn()).slice(2).join('\n')

    expect(buttonsIn(await ui.drawn())).toEqual([`◉ Retro) ( 'Fake' - 2026-01-01 …`])
    expect(cardsIn(await ui.drawn())[0]?.slice(1, 3)).toEqual([`Retro) ( 'Fake' - 2026-01-01 ((fylgja:meeti…`, `Eng) ( 'x' > Platform`])
    // Nothing invisible, no control character, no bracket or brace, no glyph and no middle dot of the title's own.
    expect(shown).not.toMatch(/[\u0000-\u0009\u000b-\u001f​‮­\u{e0000}-\u{e0fff}]/u)
    expect(shown).not.toMatch(/[[\]{}｜∙"]/u)
    expect(shown.match(/◉/g)?.length).toBe(2)
  })

  test('many citations get one line of chips: what does not fit is counted, and no more than eight are looked up', async ($, on) => {
    const started = scene(on, { tools: NEWER })
    const links = Array.from({ length: 30 }, (_, n) => `[m${n}](${linkTo('meeting', idOf(n))})`).join(' ')
    const ui = await $.ui.mount(reply(links))
    await started.clock.settle()
    const labels = buttonsIn(await ui.drawn())
    const more = shownIn(await ui.drawn()).at(-1)

    expect(labels.length < 30).toBe(true)
    expect(more).toBe(`+${30 - labels.length}`)
    expect(started.calls).toEqual([{ tool: 'resolve', args: { refs: Array.from({ length: 8 }, (_, n) => idOf(n)) } }])
  })
})

describe('signed out', () => {
  for (const surface of SURFACES) {
    test(`a reply is drawn with bare chips and no card, nothing is called, and the pane says how to sign in (${surface})`, async ($, on) => {
      const started = scene(on, { connect: () => NEEDS_SIGN_IN })
      const ui = await $.ui.mount(reply(REPLY, surface))
      await started.clock.settle()

      expect(buttonsIn(await ui.drawn()), surface).toEqual(['◉ meeting'])
      expect(cardsIn(await ui.drawn()), surface).toEqual([])

      await ui.press({ key: `peek:${MEETING_ID}` })
      await started.clock.settle()
      const side = await $.ui.mount(pane(surface))

      expect(await side.find({ text: 'Fylgja needs sign-in: type /mcp and pick fylgja, then press Retry.' }), surface).toBeDefined()
      expect(started.calls, surface).toEqual([])
      expect(started.forbidden, surface).toEqual([])
    })
  }

  test('drawing the reply again does not keep asking, and Retry after signing in shows the record and brings the cards', async ($, on) => {
    let isSignedIn = false
    const started = scene(on, { connect: () => (isSignedIn ? CONNECTED : NEEDS_SIGN_IN) })
    const ui = await $.ui.mount(reply(REPLY))
    await started.clock.settle()
    await ui.redraw()
    await ui.redraw()
    await started.clock.settle()

    expect(started.connects()).toBe(1)

    await ui.press({ key: `peek:${MEETING_ID}` })
    await started.clock.settle()
    isSignedIn = true
    const side = await $.ui.mount(pane())
    await side.press({ key: 'retry' })
    await started.clock.settle()

    expect(await side.find({ type: 'Text', text: '◉ Engineering Retrospective' })).toBeDefined()
    expect(cardsIn(await ui.drawn()).length).toBe(1)
  })

  test('what was read is dropped when sign-in is needed again: the next person may be someone else', async ($, on) => {
    let isSignedIn = true
    const started = scene(on, { connect: () => (isSignedIn ? CONNECTED : NEEDS_SIGN_IN) })
    const ui = await $.ui.mount(reply(REPLY))
    await started.clock.settle()

    expect(cardsIn(await ui.drawn()).length).toBe(1)

    isSignedIn = false
    const other = await $.ui.mount(reply(`[checklist](${linkTo('note', NOTE_ID)})`))
    await started.clock.settle()

    expect(buttonsIn(await ui.drawn())).toEqual(['◉ meeting'])
    expect(cardsIn(await ui.drawn())).toEqual([])
    expect(buttonsIn(await other.drawn())).toEqual(['✎ note'])
  })
})

describe('a pasted reference in the person’s own message', () => {
  const MESSAGE = `what did we decide in ${token('meeting', 'Pasted label', MEETING_ID)}?`

  for (const surface of SURFACES) {
    test(`keeps its row and gets a chip under it that opens the record (${surface})`, async ($, on) => {
      const started = scene(on)
      const ui = await $.ui.mount(prompt(MESSAGE, false, surface))
      await started.clock.settle()

      expect(await ui.find({ type: 'Text', text: `engine: ${MESSAGE}` }), surface).toBeDefined()
      // The chip shows the record's own title, never the label that was pasted.
      expect(buttonsIn(await ui.drawn()), surface).toEqual(['◉ Engineering Retrospective'])
      expect(cardsIn(await ui.drawn()).length, surface).toBe(1)

      await ui.press({ key: `peek:${MEETING_ID}` })
      await started.clock.settle()

      expect(started.opened.length, surface).toBe(1)
    })
  }

  test('is left alone when the message is expanded, and when it is not the person’s own', async ($, on) => {
    const started = scene(on)
    const own = prompt(MESSAGE)
    const rows = [prompt(MESSAGE, true), { ...own, props: { ...own.props, origin: { kind: 'sdk' } } }, { ...own, props: { ...own.props, origin: { kind: 'task-notification' } } }]

    for (const row of rows) {
      const ui = await $.ui.mount({ ...row, plugin: PLUGIN } as never)
      await started.clock.settle()

      expect(await ui.drawn()).toEqual({ type: 'Text', props: {}, children: [`engine: ${MESSAGE}`] })
    }

    expect([started.connects(), started.calls]).toEqual([0, []])
  })
})
