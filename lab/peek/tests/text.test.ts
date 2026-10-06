import { describe, expect, test } from 'claude-code/testing'

import { answerOf, unfenced } from '../hooks/payload'
import { markdownSafe, paragraphs } from '../hooks/plain'
import { citationsIn, linkOf, referenceOf, refOfArgument, refOfLink } from '../hooks/refs'
import { tokensIn } from '../hooks/token'
import { fenced, idOf, linkTo, MEETING_ID, NOTE_ID, token, UNSEEN } from './fixtures'

describe('what names a record', () => {
  test('a link names one only when it goes exactly to a record on Fylgja’s host', () => {
    expect(refOfLink(linkTo('person', MEETING_ID.toUpperCase()))).toEqual({
      kind: 'person',
      id: MEETING_ID,
      href: linkTo('person', MEETING_ID.toUpperCase()),
    })

    for (const href of [
      `${linkTo('meeting', MEETING_ID)}/extra`,
      `${linkTo('meeting', MEETING_ID)}?x=1`,
      linkTo('topic', MEETING_ID),
      linkTo('meeting', '1234'),
      `http://fylgja.lknblab.dev/open/meeting/${MEETING_ID}`,
      `https://fylgja.lknblab.dev.evil.example/open/meeting/${MEETING_ID}`,
      `fylgja://open/meeting/${MEETING_ID}`,
    ]) {
      expect(refOfLink(href), href).toBeUndefined()
    }
  })

  test('a reply’s citations are its links to records, each record once, in the order written', () => {
    const text = `[b](${linkTo('note', NOTE_ID)}) [a](${linkTo('meeting', MEETING_ID)}) [b again](${linkTo('note', NOTE_ID)}) ![img](${linkTo('note', idOf(1))})`

    expect(citationsIn(text).map(citation => [citation.kind, citation.id])).toEqual([
      ['note', NOTE_ID],
      ['meeting', MEETING_ID],
    ])
  })

  test('a text made of brackets is searched without delay', () => {
    const text = `${'['.repeat(30_000)}${'[x'.repeat(20_000)}[the retro](${linkTo('meeting', MEETING_ID)})`
    const before = performance.now()

    expect(citationsIn(text).length).toBe(1)
    expect(performance.now() - before < 1000).toBe(true)
  })

  test('/peek takes a reference, a link or an id, and nothing with anything around it', () => {
    expect(refOfArgument(token('project', 'Platform', NOTE_ID))).toEqual({ id: NOTE_ID, kind: 'project' })
    expect(refOfArgument(NOTE_ID)).toEqual({ id: NOTE_ID, kind: undefined })
    expect(refOfArgument(`see ${token('project', 'Platform', NOTE_ID)}`)).toBeUndefined()
    expect(refOfArgument(`${NOTE_ID} ${MEETING_ID}`)).toBeUndefined()
    expect(refOfArgument('x'.repeat(5000))).toBeUndefined()
  })
})

describe('the reference Copy reference writes', () => {
  test('is the one the Fylgja app copies, and reads back as exactly one reference to the same record', () => {
    const written = referenceOf('meeting', 'Pricing sync', MEETING_ID.toUpperCase())

    expect(written).toBe(`{{fylgja:meeting Pricing sync|${MEETING_ID}}}`)
    expect(tokensIn(written ?? '').map(found => [found.kind, found.id])).toEqual([['meeting', MEETING_ID]])
  })

  test('survives any title: bars, braces, a fake reference, invisible text, nothing at all', () => {
    const titles = [`a|b`, `}} {{fylgja:note x|${NOTE_ID}}}`, `｜full-width bar`, UNSEEN, '', `line\nbreak`, 'x'.repeat(500)]

    for (const title of titles) {
      const written = referenceOf('note', title, NOTE_ID) ?? ''
      const found = tokensIn(written)

      expect(found.length, title).toBe(1)
      expect([found[0]?.start, found[0]?.end, found[0]?.id], title).toEqual([0, written.length, NOTE_ID])
    }
  })

  test('is the record’s link for a kind a reference cannot name, and nothing for an id that is none', () => {
    expect(referenceOf('person', 'Ada', MEETING_ID)).toBe(linkTo('person', MEETING_ID))
    expect(referenceOf('decision', 'Freeze', MEETING_ID)).toBeUndefined()
    expect(referenceOf('meeting', 'x', 'not-an-id')).toBeUndefined()
    expect(linkOf('meeting', '../../etc')).toBeUndefined()
  })
})

describe('a tool’s answer', () => {
  test('is read from the structured result, from JSON text, or as a record’s text', () => {
    expect(answerOf({ content: [], isError: false, structuredContent: { kind: 'meeting' } })).toEqual({ is: 'json', json: { kind: 'meeting' } })
    expect(answerOf({ content: [{ type: 'text', text: '{"kind":"note"}' }], isError: false })).toEqual({ is: 'json', json: { kind: 'note' } })
    expect(answerOf({ content: [{ type: 'text', text: '# Title' }], isError: false })).toEqual({ is: 'text', text: '# Title' })
    // A tool that returns text may have it wrapped as the structured result.
    expect(answerOf({ content: [], isError: false, structuredContent: { result: '# Title' } })).toEqual({ is: 'text', text: '# Title' })
    expect(answerOf({ content: [{ type: 'text', text: '{broken' }], isError: false })).toEqual({ is: 'text', text: '{broken' })
  })

  test('is a refusal when the tool says so, and unreadable when it is nothing a tool answers', () => {
    expect(answerOf({ content: [{ type: 'text', text: 'record not found' }], isError: true })).toEqual({ is: 'refused', isNotFound: true })
    expect(answerOf({ content: [{ type: 'text', text: 'slow down' }], isError: true })).toEqual({ is: 'refused', isNotFound: false })

    for (const result of [undefined, null, 'text', 7, [], { content: 'x' }, { content: [{ type: 'image' }] }]) {
      expect(answerOf(result)).toEqual({ is: 'unreadable' })
    }
  })

  test('a record’s text comes out of its fence with what the fence said, and without the note that it was cut', () => {
    expect(unfenced(fenced('# Title\nbody\n[truncated: 512 more chars — ask for a section]', 'shared with your team'))).toEqual({
      body: '# Title\nbody',
      scope: 'shared with your team',
      isCut: true,
    })
    expect(unfenced('# No fence')).toEqual({ body: '# No fence', scope: undefined, isCut: false })
  })
})

describe('a record’s text made safe to draw', () => {
  const keepFylgja = (target: string) => refOfLink(target)?.href

  test('keeps its markdown and its lines, and loses what no person sees', () => {
    expect(markdownSafe(`## Head\r\n\r\n- one${UNSEEN}\n- **two**\u0007\n\tindented`, 1000, keepFylgja)).toBe('## Head\n\n- one\n- **two** \n\tindented')
  })

  test('is cut where it gets too long, and says so', () => {
    const text = markdownSafe('word '.repeat(100), 50, keepFylgja)

    expect(text.startsWith('word word')).toBe(true)
    expect(text.endsWith('_Cut here: the record is longer than this pane shows._')).toBe(true)
    expect(text.length < 120).toBe(true)
  })

  test('prose for a plain text keeps its paragraphs and nothing else', () => {
    expect(paragraphs(`First  line.\n\n\n\nSecond${UNSEEN} line.\t \n third`, 1000)).toBe('First line.\n\nSecond line.\nthird')
    expect(paragraphs('x'.repeat(50), 10)).toBe(`${'x'.repeat(10)}…`)
  })
})
