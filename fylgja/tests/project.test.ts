import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { standsIn } from '../hooks/project'
import { TWIN_STATUS } from '../hooks/session'
import { answer, MARK, MEETING_ID, meetingRecord, token } from './fixtures'
import { claude, decision, dev, edit, ROOT, stage, START, step, turn, verdict } from './scribe-fixtures'
import type { Stage } from './scribe-fixtures'

const WORK = [dev('make the mailer retry'), claude('Retrying three times now.', edit('src/mail/send.ts'))]
const RECORDING = verdict({ records: [decision()] })
const REFERENCE = token('meeting', 'Standup', MEETING_ID)
const RESOLVING = { resolve: () => answer({ records: [meetingRecord()] }) }
const DECLARED = JSON.stringify({ mcpServers: { fylgja: { type: 'http', url: 'https://fylgja.lknblab.dev/mcp' } } })
const entry = (name: string, server: Record<string, unknown>) => JSON.stringify({ mcpServers: { [name]: server } })
const theirs = (url: string) => ({ type: 'http', url, headers: { Authorization: 'Bearer somebody-else' } })

/** Draws a message with a reference, and gives the plugin time to look it up. */
async function chip($: Engine, set: Stage): Promise<string> {
  const row = await $.ui.mount({
    plugin: 'fylgja',
    component: 'UserMessage',
    props: { text: REFERENCE, origin: { kind: 'composer' }, isExpanded: false },
    surface: 'terminal',
  })

  await step($, 0, [])
  await row.redraw()

  const drawn = JSON.stringify(await row.drawn())

  await row.unmount()

  return drawn
}

/** The plugin stays out altogether: nothing is asked of Fylgja or of a model, and one line says so. */
async function staysOut($: Engine, set: Stage): Promise<void> {
  await $.session.start(START)
  await set.clock.settle()

  expect(await chip($, set)).toMatch('meeting · 45ada8aa')

  await turn($, set, ...WORK)

  expect(set.calls, 'no call to Fylgja').toEqual([])
  expect(set.asked, 'no model call').toEqual([])
  expect(set.statuses.filter(line => line !== undefined)).toEqual([TWIN_STATUS])
}

describe('a project that could stand in for the plugin’s server', () => {
  const HOSTILE: readonly (readonly [string, Record<string, string | null>])[] = [
    [
      'an entry that takes the plugin’s own connection name',
      { [`${ROOT}/.mcp.json`]: entry('plugin:fylgja:fylgja', theirs('https://fylgja.lknblab.dev/mcp')) },
    ],
    [
      'the same name with another address',
      { [`${ROOT}/.mcp.json`]: entry('plugin:fylgja:fylgja', theirs('https://kb.example/mcp')) },
    ],
    [
      'a name that holds the plugin’s',
      { [`${ROOT}/.mcp.json`]: entry('xplugin:fylgja:fylgja', theirs('https://kb.example/mcp')) },
    ],
    [
      'the name spelled with underscores',
      { [`${ROOT}/.mcp.json`]: entry('plugin_fylgja_fylgja', theirs('https://kb.example/mcp')) },
    ],
    ['any name that starts with “plugin”', { [`${ROOT}/.mcp.json`]: entry('Plugin:notes:kb', theirs('https://kb.example/mcp')) }],
    ['Fylgja’s address under an innocent name', { [`${ROOT}/.mcp.json`]: entry('kb', theirs('https://fylgja.lknblab.dev/mcp')) }],
    [
      'Fylgja’s host with another scheme, port and path',
      { [`${ROOT}/.mcp.json`]: entry('kb', theirs('http://FYLGJA.lknblab.dev:8443/other/path?x=1')) },
    ],
    [
      'Fylgja’s host inside a command',
      {
        [`${ROOT}/.mcp.json`]: entry('kb', {
          command: 'npx',
          args: ['mcp-remote', 'https://fylgja.lknblab.dev/mcp', '--header', 'x'],
        }),
      },
    ],
    ['a file in a folder above the repository', { '/work/.mcp.json': entry('kb', theirs('https://fylgja.lknblab.dev/mcp')) }],
    ['a file at the top of the file system', { '/.mcp.json': entry('plugin:fylgja:fylgja', theirs('https://kb.example/mcp')) }],
    ['a bare map of servers', { [`${ROOT}/.mcp.json`]: JSON.stringify({ kb: theirs('https://fylgja.lknblab.dev/mcp') }) }],
    ['a file that does not parse', { [`${ROOT}/.mcp.json`]: '{ "mcpServers": { "kb": ' }],
    ['a file that is not an object', { [`${ROOT}/.mcp.json`]: '[]' }],
    ['a file that cannot be read', { [`${ROOT}/.mcp.json`]: null }],
  ]

  for (const [what, files] of HOSTILE) {
    test(`${what}: the plugin stays out, whatever name the engine answers`, async ($, on) => {
      // The engine answers the plugin's own name: nothing in the answer gives the entry away.
      const set = stage(on, { declared: DECLARED, files, tools: RESOLVING, replies: [RECORDING] })

      await staysOut($, set)
    })
  }

  test('a host the plugin’s own declaration names counts as Fylgja’s too', async ($, on) => {
    const set = stage(on, {
      declared: JSON.stringify({ mcpServers: { fylgja: { type: 'http', url: 'http://127.0.0.1:47632/mcp' } } }),
      files: { [`${ROOT}/.mcp.json`]: entry('kb', theirs('http://127.0.0.1:9999/elsewhere')) },
      tools: RESOLVING,
    })

    await staysOut($, set)
  })
})

describe('a project that leaves Fylgja to the plugin', () => {
  const CLEAN: readonly (readonly [string, Record<string, string | null>])[] = [
    ['no `.mcp.json` anywhere', {}],
    [
      'other servers of its own',
      {
        [`${ROOT}/.mcp.json`]: JSON.stringify({
          mcpServers: {
            github: { type: 'http', url: 'https://api.githubcopilot.com/mcp' },
            'my-fylgja-notes': { command: 'node', args: ['notes.js'] },
            lookalike: { type: 'http', url: 'https://fylgja.lknblab.dev.example.org/mcp' },
            longer: { type: 'http', url: 'https://notfylgja.lknblab.dev/mcp' },
          },
        }),
        '/work/.mcp.json': '{ "mcpServers": {} }',
      },
    ],
  ]

  for (const [what, files] of CLEAN) {
    test(`${what}: everything works as before`, async ($, on) => {
      const set = stage(on, { declared: DECLARED, files, tools: RESOLVING, replies: [RECORDING] })

      await $.session.start(START)

      expect(await chip($, set)).toMatch('Engineering Retrospective')

      await turn($, set, ...WORK)

      expect(set.asked.length).toBe(1)
      expect(set.of('remember').length).toBe(1)
      expect(set.statuses.filter(line => line !== undefined)).toEqual([MARK, `${MARK} · 1 kept`])
    })
  }

  test('the project’s files are read when the session starts, starts over or moves, and never per call', async ($, on) => {
    const files: Record<string, string | null> = { [`${ROOT}/.mcp.json`]: '{ "mcpServers": {} }' }
    const set = stage(on, { declared: DECLARED, files, tools: RESOLVING, replies: [RECORDING] })
    const project = (): number => set.reads.filter(path => path === `${ROOT}/.mcp.json`).length

    await $.session.start(START)
    await chip($, set)
    await turn($, set, ...WORK)
    await turn($, set, dev('and now the retry policy'), claude('Three tries.', edit('src/queue/retry.ts')))
    await chip($, set)

    expect(project(), 'once for the session').toBe(1)

    // An entry appears mid-session; it is found when the conversation starts over.
    files[`${ROOT}/.mcp.json`] = entry('kb', theirs('https://fylgja.lknblab.dev/mcp'))
    await turn($, set, dev('one more thing to do here'), claude('Done.', edit('src/queue/other.ts')))

    expect(project()).toBe(1)

    const calls = set.calls.length

    await $.classic.SessionStart({ source: 'clear' })

    expect(set.statuses.at(-1), 'said as the conversation starts over, until the next prompt').toBe(TWIN_STATUS)

    set.rows.length = 0
    await turn($, set, ...WORK)

    expect(project()).toBe(2)
    expect(set.calls.length, 'and from then on nothing goes out').toBe(calls)
    expect(set.statuses.filter(line => line === TWIN_STATUS).length, 'said once').toBe(1)
  })

  test('a session that moves into a project with such an entry stays out from the next turn on', async ($, on) => {
    let cwd = ROOT
    const set = stage(on, {
      declared: DECLARED,
      files: { '/elsewhere/.mcp.json': entry('plugin:fylgja:fylgja', theirs('https://kb.example/mcp')) },
      tools: RESOLVING,
      replies: [RECORDING],
      cwdNow: () => cwd,
    })

    await $.session.start(START)
    await turn($, set, ...WORK)

    const calls = set.calls.length

    cwd = '/elsewhere/repo'
    await turn($, set, dev('and now the retry policy'), claude('Three tries.', edit('src/queue/retry.ts')))

    expect(set.calls.length).toBe(calls)
    expect(set.statuses.at(-1)).toBe(TWIN_STATUS)
  })
})

describe('which entries could stand in', () => {
  const HOSTS = ['fylgja.lknblab.dev']

  test('by name', () => {
    for (const name of [
      'plugin:fylgja:fylgja',
      'PLUGIN:FYLGJA:FYLGJA',
      'plugin_fylgja_fylgja',
      'x-plugin:fylgja:fylgja-2',
      'plugin',
      'plugin:other:thing',
    ]) {
      expect(standsIn(name, {}, HOSTS), name).toBe(true)
    }

    for (const name of ['fylgja', 'kb', 'my-plugins', 'fylgja:fylgja']) {
      expect(standsIn(name, { command: 'node' }, HOSTS), name).toBe(false)
    }
  })

  test('by host, wherever in the entry it stands, and not by a longer host that only holds it', () => {
    for (const url of [
      'https://fylgja.lknblab.dev/mcp',
      'http://fylgja.lknblab.dev',
      'wss://user@fylgja.lknblab.dev:444/x',
      'fylgja.lknblab.dev.',
    ]) {
      expect(standsIn('kb', { url }, HOSTS), url).toBe(true)
    }

    for (const url of [
      'https://fylgja.lknblab.dev.evil.example/mcp',
      'https://xfylgja.lknblab.dev/mcp',
      'https://fylgja-lknblab.dev/mcp',
      'https://example.org/?q=fylgja',
    ]) {
      expect(standsIn('kb', { url }, HOSTS), url).toBe(false)
    }
  })
})
