import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { STATE, WORTH } from '../hooks/scribe/loop'
import { answer, idOf } from './fixtures'
import { claude, dev, edit, NOTHING, stage, stepping } from './scribe-fixtures'
import type { Asked, Stage, StageOptions } from './scribe-fixtures'

/** What the developer typed beside the screenshot. Invented, as every name here is. */
export const PASTED = 'the export on the invoice list does nothing, see the screenshot [Image #1]'

/** What the fork reads in the screenshot. */
export const OBSERVED = 'A colleague reports that pressing Export on the invoice list does nothing.'
export const EXPECTED = 'When a user presses Export on the invoice list, a CSV file of the listed invoices is downloaded.'
export const QUOTE = 'Export macht gar nichts, sollte eine CSV liefern'

/** The product file the fix lands in, and a test beside it. */
export const FIXED = 'src/invoices/export.ts'
export const FIXED_TEST = 'src/invoices/export.test.ts'

/** The id Fylgja gives the reading. */
export const READING_ID = idOf(700)

/** The fork's answer when it read the screenshot, changed by `more`. */
export function readingReply(more: Record<string, unknown> = {}): string {
  return JSON.stringify({
    echo: 'the export on the invoice list does nothing, see the screenshot',
    images_seen: 1,
    image_visible: true,
    shows: 'coworker_chat',
    legibility: 'clear',
    reporter_role: 'colleague',
    quote: QUOTE,
    observed: OBSERVED,
    expected: EXPECTED,
    expected_basis: 'in_image',
    ...more,
  })
}

/** What one fork answers: a reply's text with what it read from the cache, a reason it has none, or a wait for the test to end. */
export type ForkReply = { text: string; cacheRead?: number; input?: number } | { reason: 'aborted' | 'nothing-to-fork' | 'api-error' } | { deny: string }
export type ForkAnswer = ForkReply | Promise<ForkReply>

export type SkuldOptions = StageOptions & {
  /** What each fork answers, by its number from 1; the reading of the screenshot by default. */
  forks?: (n: number) => ForkAnswer
  /** Scribe's judgement whether the images are worth reading; yes by default. */
  isWorth?: boolean
  /** What the proposal of a sentence at the fix's turn answers, by its number from 1 (undefined: no answer at all); none by default. */
  statement?: string | ((n: number) => string | undefined)
  /** What every other call of Scribe's model answers. */
  wake?: (asked: Asked) => string
}

export type Skuld = Stage & {
  /** Every fork made, as its one message. */
  forks: string[]
  /** Every judgement asked, and every sentence proposed. */
  gates: Asked[]
  statements: Asked[]
  /** What Scribe's model was asked otherwise. */
  wakes: Asked[]
}

const ZERO = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/** A session for the image reader: the fork, Scribe's judgement and Fylgja's tools all answered by the test. */
export function skuld(on: On, options: SkuldOptions = {}): Skuld {
  const forks: string[] = []
  const gates: Asked[] = []
  const statements: Asked[] = []
  const wakes: Asked[] = []
  let kept = 0

  on('model.fork', async ($, e) => {
    forks.push(e.prompt)

    const one = await (options.forks?.(forks.length) ?? { text: readingReply(), cacheRead: 9000, input: 100 })

    // The engine would not make the call at all.
    if ('deny' in one) {
      return { deny: one.deny }
    }

    if ('reason' in one) {
      return { value: (one.reason === 'nothing-to-fork' ? { isAnswered: false, reason: one.reason } : one.reason === 'api-error' ? { isAnswered: false, reason: one.reason, status: 529, error: 'overloaded', usage: ZERO } : { isAnswered: false, reason: one.reason, usage: ZERO }) as never }
    }

    return {
      value: {
        isAnswered: true,
        text: one.text,
        usage: { input_tokens: one.input ?? 100, output_tokens: 80, cache_read_input_tokens: one.cacheRead ?? 9000, cache_creation_input_tokens: 0 },
      } as never,
    }
  })

  const set = stage(on, {
    ...options,
    tools: {
      save_image_reading: () => answer({ id: READING_ID, outcome: 'saved' }),
      // A keep the server made says so.
      remember: args => {
        kept += 1

        return answer({ atom_id: idOf(800 + kept), outcome: 'created', ...(args.report_id === undefined ? {} : { kept: true }) })
      },
      ...options.tools,
    },
    replies: [
      asked => {
        if (asked.system.startsWith(WORTH.slice(0, 40))) {
          gates.push(asked)

          return options.isWorth === false ? '{"read":false}' : '{"read":true}'
        }

        if (asked.system.startsWith(STATE.slice(0, 40))) {
          statements.push(asked)

          return typeof options.statement === 'function' ? options.statement(statements.length) : (options.statement ?? '{"none":true}')
        }

        wakes.push(asked)

        return options.wake?.(asked) ?? NOTHING
      },
    ],
  })

  return Object.assign(set, { forks, gates, statements, wakes })
}

/** An image attachment, as Claude Code hands it over with a prompt. */
const IMAGE = { type: 'image', mediaType: 'image/png', id: 'img-1' } as const

/** The developer sends a prompt with `images` images from the prompt box. */
export async function paste($: Engine, text = PASTED, images = 1): Promise<void> {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' }, attachments: Array.from({ length: images }, () => IMAGE) } as never)
}

/** One step of the main conversation's turn `turnId`, asking for `uses`; its answer is `answer`. */
export async function stepIn($: Engine, on: On, set: Stage, turnId: string, index: number, uses: readonly { name: string; input: unknown }[] = []): Promise<void> {
  stepping(on, () => uses)

  const stream = $.turn.step({ turnId, index, model: 'claude-opus', messageCount: 3 })

  for await (const chunk of stream) {
    void chunk
  }

  await stream.result
  await set.clock.settle()
}

/** The main conversation's turn `turnId` ends with `answer`; its rows join the conversation. */
export async function endTurn($: Engine, set: Stage, turnId: string, answerText = 'Done.', rows: Parameters<typeof dev>[0][] = []): Promise<void> {
  set.rows.push(...rows.map(text => dev(text)))
  await $.turn.complete({ answer: answerText, durationMs: 1, isAborted: false, turnId, reason: 'answer' })
  await set.clock.settle()
}

/** The edit of a file of the repository, as a step asks for it. */
export const edits = (path: string): { name: string; input: unknown } => {
  const one = edit(path)

  return { name: one.tool, input: one.input }
}

/**
 * The usual image turn: the screenshot is pasted, the first step comes back,
 * the fix is made at the second step (the image is read at its boundary),
 * and the turn ends with Claude's answer.
 */
export async function reported($: Engine, on: On, set: Stage, turnId = 'turn-img', fix: readonly string[] = [FIXED], answerText = 'Fixed: the export downloads the CSV again.'): Promise<void> {
  await paste($)
  await set.clock.settle()
  await stepIn($, on, set, turnId, 0)
  await stepIn($, on, set, turnId, 1, fix.map(edits))
  set.rows.push(dev(PASTED), claude(answerText, ...fix.map(path => edit(path))))
  await $.turn.complete({ answer: answerText, durationMs: 1, isAborted: false, turnId, reason: 'answer' })
  await set.clock.settle()
}
