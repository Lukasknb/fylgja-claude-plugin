import type { On, PromptEditInput, PromptEditResult } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { answer, idOf, meetingRecord, MEETING_ID, NOTE_ID, rowOf, scene, token, UNSEEN, userMessage } from './fixtures'

const MEETING = token('meeting', 'Pasted label', MEETING_ID)
const NOTE = token('note', 'Launch plan', NOTE_ID)
const CHIP = '‹◉ Pasted label›'
const NOTE_CHIP = '‹✎ Launch plan›'
const FILL = { backgroundColor: 'suggestion', color: 'inverseText', bold: true }

/** Claude Code's own editor: it makes the edit asked for and puts the cursor after what went in. */
function plainEditor(on: On): void {
  on('prompt.edit', ($, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))
}

/** Stands for the session: every prompt that entered is kept as it arrived. */
function entering(on: On): string[] {
  const entered: string[] = []

  on('prompt.submit', ($, e) => {
    entered.push(e.text)

    return { text: e.text, context: e.context }
  })

  return entered
}

/**
 * A prompt box driven the way a person drives one. Each edit goes through
 * the plugin's hooks and the box then holds what came back, as Claude
 * Code's does. The test engine fires `prompt.edit` as it fires every event,
 * but its declared type leaves the event out, so the call is typed here.
 */
function promptBox($: Engine) {
  const prompt = $.prompt as unknown as { edit: (input: PromptEditInput) => Promise<PromptEditResult> }
  const box: PromptEditResult = { text: '', cursor: 0 }

  const edit = async (start: number, end: number, inputText: string, key?: string): Promise<PromptEditResult> => {
    const input = { origin: { kind: 'composer' as const }, text: box.text, cursor: box.cursor, start, end, inputText }
    const shown = await prompt.edit(key === undefined ? input : { ...input, key: { key } })

    box.text = shown.text
    box.cursor = shown.cursor
    box.decorations = shown.decorations

    return shown
  }

  return {
    box,
    edit,
    /** Puts `text` in at the cursor in one edit, as a paste does. */
    paste: (text: string) => edit(box.cursor, box.cursor, text),
    /** Types `text` at the cursor, one key at a time. */
    type: async (text: string) => {
      for (const char of text) {
        await edit(box.cursor, box.cursor, char, char)
      }
    },
    backspace: () => edit(box.cursor - 1, box.cursor, '', 'backspace'),
    /** The box holds `text` without any edit having been seen: a recalled prompt, or an answer not used. */
    holds: (text: string) => {
      box.text = text
      box.cursor = text.length
      box.decorations = undefined
    },
    /** The texts painted as chips. */
    chips: () =>
      (box.decorations ?? []).filter(run => run.backgroundColor !== undefined).map(run => box.text.slice(run.start, run.end)),
    /** Moves the cursor without changing the draft. */
    moveTo: (cursor: number) => edit(cursor, cursor, '', 'left'),
    /** The painted stretches of the draft, each with its text. */
    painted: () => (box.decorations ?? []).map(({ start, end, ...style }) => ({ text: box.text.slice(start, end), ...style })),
    /** Enter: the prompt as typed goes to the session; what entered comes back. */
    submit: async () =>
      (await $.prompt.submit({ text: box.text, wait: false, origin: { kind: 'composer' } })).text ?? '',
  }
}

describe('a reference pasted into the prompt box', () => {
  test('becomes a chip painted as one run, the cursor after it, and Fylgja is asked nothing', async ($, on) => {
    const started = scene(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.type('see ')
    const shown = await ui.paste(MEETING)

    expect(shown).toEqual({ text: `see ${CHIP}`, cursor: 4 + CHIP.length, decorations: [{ start: 4, end: 4 + CHIP.length, ...FILL }] })
    expect(ui.painted()).toEqual([{ text: CHIP, ...FILL }])
    expect([started.connects(), started.calls, started.statuses, started.forbidden]).toEqual([0, [], [], []])
  })

  test('goes to Claude exactly as it was pasted, and nothing else of the prompt changes', async ($, on) => {
    const entered = entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.type('what did we decide in ')
    await ui.paste(MEETING)
    await ui.type(' about SSO?')

    expect(ui.box.text).toBe(`what did we decide in ${CHIP} about SSO?`)
    expect(await ui.submit()).toBe(`what did we decide in ${MEETING} about SSO?`)
    expect(entered).toEqual([`what did we decide in ${MEETING} about SSO?`])
  })

  test('without a title shows its kind and the start of its id', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)
    const bare = token('note', '', NOTE_ID)

    await ui.paste(bare)

    expect(ui.painted()).toEqual([{ text: '‹✎ note · 0b1f6c1e›', ...FILL }])
    expect(await ui.submit()).toBe(bare)
  })

  test('a long title is cut short in the chip and whole in what Claude gets', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)
    const long = token('meeting', 'S3 Access Permissions and SSO Role Mapping for the Platform Team, part two', MEETING_ID)

    await ui.paste(long)

    expect(ui.box.text).toBe('‹◉ S3 Access Permissions and SSO Role Mapping for the Platform…›')
    expect(await ui.submit()).toBe(long)
  })

  test('several pasted at once, in the middle of a draft, each become a chip and each go back', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.type('compare  please')
    await ui.moveTo(8)
    await ui.paste(`${MEETING} with ${NOTE}`)

    expect(ui.box.text).toBe(`compare ${CHIP} with ${NOTE_CHIP} please`)
    expect(ui.box.cursor).toBe(`compare ${CHIP} with ${NOTE_CHIP}`.length)
    expect(ui.painted()).toEqual([{ text: CHIP, ...FILL }, { text: NOTE_CHIP, ...FILL }])

    await ui.moveTo(0)
    await ui.type('Now ')

    expect(ui.painted()).toEqual([{ text: CHIP, ...FILL }, { text: NOTE_CHIP, ...FILL }])
    expect(await ui.submit()).toBe(`Now compare ${MEETING} with ${NOTE} please`)
  })

  test('that arrives in pieces becomes a chip with the key that completes it', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(MEETING.slice(0, 30))
    await ui.paste(MEETING.slice(30, -1))

    expect(ui.box.text).toBe(MEETING.slice(0, -1))
    expect(ui.painted()).toEqual([])

    await ui.type('}')

    expect([ui.box.text, ui.box.cursor]).toEqual([CHIP, CHIP.length])
    expect(await ui.submit()).toBe(MEETING)
  })

  test('paint another hook asked for stays on its own characters', async ($, on) => {
    on('prompt.edit', ($, e) => {
      const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)

      return { text, cursor: text.length, decorations: [{ start: text.length - 4, end: text.length, color: 'claude' }] }
    })
    const ui = promptBox($)

    await ui.paste(`${MEETING} done`)

    expect(ui.painted()).toEqual([{ text: 'done', color: 'claude' }, { text: CHIP, ...FILL }])
  })
})

describe('two references that would read the same', () => {
  const first = token('meeting', 'Weekly sync', idOf(1))
  const second = token('meeting', 'Weekly sync', idOf(2))

  test('are told apart in the box, and each goes back as itself wherever it is moved', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(`${first} or ${second}`)

    expect(ui.box.text).toBe('‹◉ Weekly sync› or ‹◉ Weekly sync · 00000000›')

    // The second is moved in front of the first: cut out whole, put back whole.
    const moved = '‹◉ Weekly sync · 00000000›'
    await ui.edit(ui.box.text.length - moved.length, ui.box.text.length, '')
    await ui.moveTo(0)
    await ui.paste(`${moved} `)

    expect(ui.chips()).toEqual([moved, '‹◉ Weekly sync›'])
    expect(await ui.submit()).toBe(`${second} ${first} or `)
  })

  test('are told apart across prompts too', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(first)
    expect(await ui.submit()).toBe(first)

    ui.holds('')
    await ui.paste(second)

    expect(ui.box.text).toBe('‹◉ Weekly sync · 00000000›')
    expect(await ui.submit()).toBe(second)
  })

  test('the same reference pasted twice reads the same twice, and both go back', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(first)
    await ui.type(' and ')
    await ui.paste(first)

    expect(ui.box.text).toBe('‹◉ Weekly sync› and ‹◉ Weekly sync›')
    expect(await ui.submit()).toBe(`${first} and ${first}`)
  })

  test('a title cannot pose as the part that tells them apart', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)
    const posing = token('meeting', 'Weekly sync · 00000000', idOf(3))

    await ui.paste(`${first} ${second} ${posing}`)

    expect(ui.chips()).toEqual(['‹◉ Weekly sync›', '‹◉ Weekly sync · 00000000›', '‹◉ Weekly sync - 00000000›'])
    expect(await ui.submit()).toBe(`${first} ${second} ${posing}`)
  })
})

describe('text that only looks like a chip', () => {
  const SPRINT = token('meeting', 'Sprint', idOf(1))
  const REVIEW = token('meeting', 'Sprint review', idOf(2))
  const DIM = { dimColor: true }

  test('shaped like one but never shown by this plugin, is dimmed, never filled, and sent as typed', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    // As a prompt recalled from an earlier session reads: its chips are text now.
    await ui.paste(`summarise ${CHIP} and ‹◉ meeting · 45ada8aa›`)

    expect(ui.painted()).toEqual([{ text: CHIP, ...DIM }, { text: '‹◉ meeting · 45ada8aa›', ...DIM }])
    expect(await ui.submit()).toBe(`summarise ${CHIP} and ‹◉ meeting · 45ada8aa›`)
  })

  test('already in the draft is not made a reference by a paste that would read the same', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.type(`${CHIP} is from yesterday, `)
    await ui.paste(MEETING)

    expect(ui.chips()).toEqual(['‹◉ Pasted label · 45ada8aa›'])
    expect(await ui.submit()).toBe(`${CHIP} is from yesterday, ${MEETING}`)
  })

  test('typing after a chip never makes it another record’s chip', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(REVIEW)
    expect(await ui.submit()).toBe(REVIEW)

    ui.holds('')
    await ui.paste(SPRINT)
    await ui.type(' review notes please')

    expect(ui.box.text).toBe('‹◉ Sprint› review notes please')
    expect(ui.chips()).toEqual(['‹◉ Sprint›'])
    expect(await ui.submit()).toBe(`${SPRINT} review notes please`)
  })

  test('text typed right against a chip stays outside it', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(MEETING)
    await ui.type('s · x')
    await ui.moveTo(0)
    await ui.type('re')

    expect(ui.chips()).toEqual([CHIP])
    expect(await ui.submit()).toBe(`re${MEETING}s · x`)
  })

  test('an edit inside a chip leaves text, not the other record whose title it now starts with', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(`${SPRINT} vs ${REVIEW}`)
    await ui.edit(ui.box.text.length - 2, ui.box.text.length - 1, '')

    expect(ui.box.text).toBe('‹◉ Sprint› vs ‹◉ Sprint revie›')
    expect(ui.painted()).toEqual([{ text: '‹◉ Sprint revie›', ...DIM }, { text: '‹◉ Sprint›', ...FILL }])
    expect(await ui.submit()).toBe(`${SPRINT} vs ‹◉ Sprint revie›`)
  })

  test('an edit that makes a chip read exactly as another chip shown makes it that chip', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(`${SPRINT} vs ${REVIEW}`)
    await ui.edit(ui.box.text.length - 8, ui.box.text.length - 1, '')

    expect(ui.chips()).toEqual(['‹◉ Sprint›', '‹◉ Sprint›'])
    expect(await ui.submit()).toBe(`${SPRINT} vs ${SPRINT}`)
  })

  test('glyphs and titles in text copied from elsewhere are left alone, however short a shown title is', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)
    const yes = token('meeting', 'Yes', idOf(3))
    const q3 = token('meeting', 'Q3', idOf(4))
    const copied = 'open ◉ Q3 planning review, survey: ◉ Yes  ○ No, ‹◉ Yes and ◉ Q3›, ‹◉ Yes ›'

    await ui.paste(`${yes} ${q3} `)
    await ui.paste(copied)

    expect(ui.chips()).toEqual(['‹◉ Yes›', '‹◉ Q3›'])
    expect(await ui.submit()).toBe(`${yes} ${q3} ${copied}`)
  })

  test('a whole copy of a chip this plugin showed is that reference, painted as one', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(MEETING)
    await ui.paste(` and ${CHIP}`)

    expect(ui.chips()).toEqual([CHIP, CHIP])
    expect(await ui.submit()).toBe(`${MEETING} and ${MEETING}`)
  })
})

describe('a prompt that comes back into the box', () => {
  const VERIFIED = '[◉ "Engineering Retrospective" · 2026-09-30]'

  test('recalled after it was sent, has its chip and is sent with its reference again', async ($, on) => {
    const started = scene(on, { resolve: () => answer({ records: [meetingRecord()] }) })
    plainEditor(on)
    const ui = promptBox($)

    await ui.type('summarise ')
    await ui.paste(MEETING)
    const typed = ui.box.text

    expect(await ui.submit()).toBe(`summarise ${MEETING}`)

    ui.holds(typed)
    await ui.type('!')

    expect(ui.chips()).toEqual([CHIP])
    expect(await ui.submit()).toBe(`summarise ${MEETING}!`)

    // Sent again untouched, without one edit seen since it came back.
    ui.holds(typed)

    expect(await ui.submit()).toBe(`summarise ${MEETING}`)
    expect(await rowOf($, started, `summarise ${MEETING}`, 100)).toBe(`summarise ${VERIFIED}`)
    expect(started.forbidden).toEqual([])
  })

  test('another prompt entered meanwhile leaves the draft’s chips as they are', async ($, on) => {
    const entered = entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(MEETING)
    await $.prompt.submit({ text: 'from a link in the transcript', wait: false, origin: { kind: 'composer' } })
    await $.prompt.submit({ text: `task done: ${CHIP}`, wait: false, origin: { kind: 'task-notification' } })

    expect(entered).toEqual(['from a link in the transcript', `task done: ${CHIP}`])
    expect(await ui.submit()).toBe(MEETING)
  })

  test('the row draws the verified chip whether it is handed the reference or the text as typed', async ($, on) => {
    const started = scene(on, { resolve: () => answer({ records: [meetingRecord()] }) })
    plainEditor(on)
    const ui = promptBox($)

    await ui.type('about ')
    await ui.paste(MEETING)
    const typed = ui.box.text

    expect(await rowOf($, started, await ui.submit(), 100)).toBe(`about ${VERIFIED}`)
    expect(await rowOf($, started, typed, 100)).toBe(`about ${VERIFIED}`)
  })

  test('a row that was never typed at this prompt box is drawn as it is', async ($, on) => {
    const started = scene(on, { resolve: () => answer({ records: [meetingRecord()] }) })
    plainEditor(on)
    const ui = promptBox($)

    expect(await rowOf($, started, `about ${CHIP}`, 100)).toBe(`about ${CHIP}`)

    await ui.paste(MEETING)
    const row = await $.ui.mount({ ...userMessage(`about ${CHIP}`, false, 'bridge'), surface: 'terminal' })
    await started.clock.advance(100)

    expect(await row.find({ text: `engine: about ${CHIP}` })).toBeDefined()
    expect(started.calls).toEqual([])
  })
})

describe('editing a chip', () => {
  test('a key typed inside it leaves plain text, and the other chip is untouched', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(`${MEETING} ${NOTE}`)
    await ui.moveTo(4)
    await ui.type('x')

    expect(ui.box.text).toBe(`‹◉ Pxasted label› ${NOTE_CHIP}`)
    expect(ui.chips()).toEqual([NOTE_CHIP])
    expect(await ui.submit()).toBe(`‹◉ Pxasted label› ${NOTE}`)
  })

  test('put right again it is the chip again, painted as one', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(MEETING)
    await ui.moveTo(5)
    await ui.type('x')

    expect(ui.chips()).toEqual([])

    await ui.backspace()

    expect(ui.chips()).toEqual([CHIP])
    expect(await ui.submit()).toBe(MEETING)
  })

  test('moving the cursor through it changes nothing', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(MEETING)
    await ui.moveTo(5)
    await ui.moveTo(0)

    expect(ui.painted()).toEqual([{ text: CHIP, ...FILL }])
    expect(await ui.submit()).toBe(MEETING)
  })

  test('Backspace right after it takes the whole chip out', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.type('see ')
    await ui.paste(`${MEETING}${NOTE}`)
    await ui.moveTo(4 + CHIP.length)
    const shown = await ui.backspace()

    expect(shown).toEqual({ text: `see ${NOTE_CHIP}`, cursor: 4, decorations: [{ start: 4, end: 19, ...FILL }] })
    expect(await ui.submit()).toBe(`see ${NOTE}`)
  })

  test('Delete right before it takes the whole chip out', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.type('see ')
    await ui.paste(`${MEETING} ${NOTE}`)
    await ui.moveTo(4)
    const shown = await ui.edit(4, 5, '', 'delete')

    expect(shown).toEqual({ text: `see  ${NOTE_CHIP}`, cursor: 4, decorations: [{ start: 5, end: 20, ...FILL }] })
    expect(await ui.submit()).toBe(`see  ${NOTE}`)
  })

  test('deleting part of it any other way leaves the rest as plain text', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(MEETING)
    await ui.edit(CHIP.length - 6, CHIP.length - 1, '')

    expect([ui.box.text, ui.chips()]).toEqual(['‹◉ Pasted ›', []])
    expect(await ui.submit()).toBe('‹◉ Pasted ›')
  })

  test('a title with characters outside the basic plane keeps the cursor and the paint on the chip', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)
    const rocket = token('project', 'Launch 🚀 plan', idOf(7))

    await ui.type('go ')
    await ui.paste(rocket)
    await ui.type(' now')

    expect(ui.box.text).toBe('go ‹▤ Launch 🚀 plan› now')
    expect(ui.chips()).toEqual(['‹▤ Launch 🚀 plan›'])
    expect(await ui.submit()).toBe(`go ${rocket} now`)
  })
})

describe('clearing the box and bringing it back', () => {
  test('a cleared draft sends nothing of the references it held', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(`${MEETING} ${NOTE}`)
    await ui.edit(0, ui.box.text.length, '')
    await ui.type('never mind')

    expect(await ui.submit()).toBe('never mind')
  })

  test('a draft cut and put back whole has its chips again', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(`about ${MEETING} and ${NOTE}`)
    const whole = ui.box.text
    await ui.edit(0, whole.length, '')

    expect(ui.painted()).toEqual([])

    await ui.paste(whole)

    expect(ui.chips()).toEqual([CHIP, NOTE_CHIP])
    expect(await ui.submit()).toBe(`about ${MEETING} and ${NOTE}`)
  })

  test('a box that changed without an edit being seen keeps the chips still whole in it', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(`${MEETING} then ${NOTE}`)
    ui.holds(`first ${CHIP} then later ${NOTE_CHIP}`)
    await ui.type('!')

    expect(ui.chips()).toEqual([CHIP, NOTE_CHIP])
    expect(await ui.submit()).toBe(`first ${MEETING} then later ${NOTE}!`)
  })

  test('where the prompt as entered differs from the box, its chips go back and the text written out is left alone', async ($, on) => {
    const entered = entering(on)
    plainEditor(on)
    const ui = promptBox($)
    const notes = 'notes say ◉ Pasted label slipped, ✎ Launch planning, ‹◉ Pasted labels›'

    await ui.paste(`[Pasted text #1] ${MEETING} [Pasted text #2] ${NOTE}`)
    const typed = ui.box.text.replace('[Pasted text #1]', notes).replace('[Pasted text #2]', 'line one\nline two')

    await $.prompt.submit({ text: typed, wait: false, origin: { kind: 'composer' } })

    expect(entered).toEqual([`${notes} ${MEETING} line one\nline two ${NOTE}`])
  })

  test('any number of glyphs in front of a chip leaves it the chip it is', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(`${'□ item ◆ '.repeat(600)}see `)
    await ui.paste(MEETING)

    expect(ui.chips()).toEqual([CHIP])
    expect(await ui.submit()).toBe(`${'□ item ◆ '.repeat(600)}see ${MEETING}`)
  })
})

describe('more references than a prompt box should hold', () => {
  const notes = (count: number, from = 0) => Array.from({ length: count }, (_, n) => token('note', `Note ${from + n}`, idOf(from + n)))

  test('one paste makes fifty chips; the rest stay as written, painted, and all are sent as pasted', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)
    const pasted = notes(60)

    await ui.paste(pasted.join(' '))

    expect(ui.chips().length).toBe(50)
    expect(ui.box.text.endsWith(pasted.slice(50).join(' '))).toBe(true)
    expect(ui.painted().filter(run => run.bold === true && run.backgroundColor === undefined).length).toBe(10)
    expect(await ui.submit()).toBe(pasted.join(' '))
  })

  test('four hundred references made to read the same cost a handful of chips, never a search each', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)
    const same = Array.from({ length: 400 }, (_, n) => token('meeting', 'T', `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`))

    await ui.paste(same.join(' '))

    expect(ui.chips()).toEqual(['‹◉ T›', '‹◉ T · 00000000›', '‹◉ T · 00000000 · 2›', '‹◉ T · 00000000 · 3›', '‹◉ T · 00000000 · 4›'])
    expect(ui.box.text.endsWith(same.slice(5).join(' '))).toBe(true)
    expect(await ui.submit()).toBe(same.join(' '))
  })

  test('a draft already holding every text a reference could take leaves that reference as written', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)
    const taken = '‹◉ T› ‹◉ T · 00000000› ‹◉ T · 00000000 · 2› ‹◉ T · 00000000 · 3› ‹◉ T · 00000000 · 4› '
    const one = token('meeting', 'T', idOf(1))

    await ui.paste(taken.repeat(20))
    await ui.paste(one)

    expect(ui.chips()).toEqual([])
    expect(await ui.submit()).toBe(taken.repeat(20) + one)
  })

  test('a draft too long to work through on every key is painted, not changed', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste('x'.repeat(100_001))
    await ui.paste(MEETING)

    expect(ui.box.text.endsWith(MEETING)).toBe(true)
    expect(ui.painted().map(run => run.text)).toEqual(['{{fylgja:', 'meeting Pasted label', `|${MEETING_ID}}}`])
  })

  test('a chip still in the box is never forgotten to make room for later ones', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(`${MEETING} `)

    for (let round = 0; round < 11; round += 1) {
      const before = ui.box.text.length

      await ui.paste(notes(50, round * 50).join(' '))
      await ui.edit(before, ui.box.text.length, '')
    }

    expect(ui.chips()).toEqual([CHIP])
    expect(await ui.submit()).toBe(`${MEETING} `)

    // The ones seen longest ago did go: their text is text again.
    ui.holds('‹✎ Note 0› and ‹✎ Note 549›')

    expect(await ui.submit()).toBe(`‹✎ Note 0› and ${token('note', 'Note 549', idOf(549))}`)
  })

  test('a box full of chips takes no more, and loses none', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)
    const pasted = notes(510)

    for (let round = 0; round < 11; round += 1) {
      await ui.paste(`${pasted.slice(round * 50, round * 50 + 50).join(' ')} `)
    }

    expect(ui.chips().length).toBe(500)
    expect(await ui.submit()).toBe(`${pasted.slice(0, 500).join(' ')} ${pasted.slice(500).join(' ')} `)
  })
})

describe('a pasted title that is not what it seems', () => {
  const sent = async ($: Engine, on: On, pasted: string): Promise<{ box: string; chips: string[]; entered: string }> => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(pasted)

    return { box: ui.box.text, chips: ui.chips(), entered: await ui.submit() }
  }

  test('brackets, look-alike dots, quotes and glyphs are drawn as plain marks', async ($, on) => {
    const hostile = token('meeting', '◉ ［Budget］ · ✓ ‧ "final" ▤', MEETING_ID)

    expect(await sent($, on, hostile)).toEqual({ box: "‹◉ (Budget) - - 'final'›", chips: ["‹◉ (Budget) - - 'final'›"], entered: hostile })
  })

  test('it cannot be made to read as a title Fylgja confirmed', async ($, on) => {
    const hostile = token('meeting', '["Engineering Retrospective" · 2026-09-30]', MEETING_ID)
    const shown = await sent($, on, hostile)

    expect(shown.box).toBe("‹◉ ('Engineering Retrospective' - 2026-09-30)›")
    expect(/["[\]·]/.test(shown.box)).toBe(false)
    expect(shown.entered).toBe(hostile)
  })

  test('characters nobody sees are left out of the chip and kept in what Claude gets', async ($, on) => {
    const hostile = token('meeting', `Bud${UNSEEN}get\u0007review`, MEETING_ID)

    expect(await sent($, on, hostile)).toEqual({ box: '‹◉ Budget review›', chips: ['‹◉ Budget review›'], entered: hostile })
  })

  test('a reference wrapped around another stays as written, now and through later edits', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)
    const nested = `{{fylgja:meeting ${NOTE}|${MEETING_ID}}}`

    await ui.paste(nested)
    await ui.type(' ok')

    expect([ui.box.text, ui.chips()]).toEqual([`${nested} ok`, []])
    expect(await ui.submit()).toBe(`${nested} ok`)
  })

  test('the marks a chip begins and ends with are taken out of a title', async ($, on) => {
    const hostile = token('meeting', 'Bud›get ‹◉ x› ‹', MEETING_ID)

    expect(await sent($, on, hostile)).toEqual({ box: '‹◉ Budget x›', chips: ['‹◉ Budget x›'], entered: hostile })
  })

  test('a reference whose title spells a chip already shown is read whole, both times it is pasted', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)
    const posing = token('note', CHIP, NOTE_ID)

    await ui.paste(`${MEETING} ${posing} `)
    await ui.paste(posing)

    expect(ui.chips()).toEqual([CHIP, '‹✎ Pasted label›', '‹✎ Pasted label›'])
    expect(await ui.submit()).toBe(`${MEETING} ${posing} ${posing}`)
  })

  test('a title that is nothing once cleaned shows the kind and id', async ($, on) => {
    const empty = token('meeting', UNSEEN, MEETING_ID)

    expect((await sent($, on, empty)).box).toBe('‹◉ meeting · 45ada8aa›')
  })
})

describe('sending a prompt', () => {
  test('when putting the references back fails, the prompt goes on as it was entered and nothing is forgotten', async ($, on) => {
    plainEditor(on)
    const received: unknown[] = []

    on('prompt.submit', ($, e) => {
      received.push(e.text)

      return { text: 'entered' }
    })
    const ui = promptBox($)

    await ui.type('see ')
    await ui.paste(MEETING)

    // Not a text at all: reading it fails, the one way a test can make the plugin's own work fail.
    const unreadable = { length: 3 } as unknown as string
    const result = await $.prompt.submit({ text: unreadable, wait: false, origin: { kind: 'composer' } })

    expect(result.text).toBe('entered')
    expect(received).toEqual([{ length: 3 }])

    await ui.submit()

    expect(received[1]).toBe(`see ${MEETING}`)
  })

  test('context attached by others rides along untouched, and nothing is added', async ($, on) => {
    plainEditor(on)
    on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
    const ui = promptBox($)

    await ui.paste(MEETING)

    expect(
      await $.prompt.submit({ text: ui.box.text, wait: false, origin: { kind: 'composer' }, context: ['from elsewhere'] }),
    ).toEqual({ text: MEETING, context: ['from elsewhere'] })
  })
})

describe('a box that does not use the answer', () => {
  test('once, loses nothing: the chip already standing stays, and the swap is made again', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    await ui.paste(`${MEETING} `)
    await ui.paste(NOTE)

    // The answer came too late: the box kept the reference as pasted.
    ui.holds(`${CHIP} ${NOTE}`)
    await ui.type('!')

    expect(ui.box.text).toBe(`${CHIP} ${NOTE_CHIP}!`)
    expect(ui.chips()).toEqual([CHIP, NOTE_CHIP])
    expect(await ui.submit()).toBe(`${MEETING} ${NOTE}!`)
  })

  test('three times running gets references painted part by part, left as written, until the next prompt', async ($, on) => {
    const entered = entering(on)
    plainEditor(on)
    const ui = promptBox($)
    let raw = `see ${MEETING}`

    await ui.paste(raw)

    for (const key of ['a', 'b']) {
      expect(ui.chips(), key).toEqual([CHIP])

      ui.holds(raw)
      await ui.type(key)
      raw += key
    }

    ui.holds(raw)
    await ui.type(' ')

    const bar = 4 + MEETING.indexOf('|')

    expect(ui.box).toEqual({
      text: `${raw} `,
      cursor: raw.length + 1,
      decorations: [
        { start: 4, end: 4 + '{{fylgja:'.length, dimColor: true },
        { start: 4 + '{{fylgja:'.length, end: bar, bold: true },
        { start: bar, end: 4 + MEETING.length, dimColor: true },
      ],
    })

    await ui.paste(NOTE)

    expect(ui.box.text).toBe(`${raw} ${NOTE}`)
    expect(await ui.submit()).toBe(`${raw} ${NOTE}`)
    expect(entered).toEqual([`${raw} ${NOTE}`])

    ui.holds('')
    await ui.paste(NOTE)

    expect(ui.box.text).toBe(NOTE_CHIP)
  })

  test('a swap that was taken wipes the slate: two unused answers on either side of it change nothing', async ($, on) => {
    entering(on)
    plainEditor(on)
    const ui = promptBox($)

    for (let round = 0; round < 4; round += 1) {
      await ui.paste(`${MEETING} `)
      ui.holds(`${ui.box.text.slice(0, -CHIP.length - 1)}${MEETING} `)
      await ui.type('a')
      ui.holds(`${ui.box.text.slice(0, -CHIP.length - 2)}${MEETING} a`)
      await ui.type('b')
      await ui.type('c')
    }

    expect(ui.chips().length).toBe(4)
  })

  test('a draft without references gets no paint', async ($, on) => {
    plainEditor(on)
    const ui = promptBox($)

    expect(await ui.paste('plain text {{fylgja:meeting|nope}}')).toEqual({ text: 'plain text {{fylgja:meeting|nope}}', cursor: 34 })
  })
})
