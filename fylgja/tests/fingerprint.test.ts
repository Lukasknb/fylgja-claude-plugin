import { describe, expect, test } from 'claude-code/testing'

import { fingerprintOf, isPrint, isSecretFile, MAX_PRINT_LINES, regionOf, schemeOf } from '../hooks/scribe/fingerprint'

const PYTHON = [
  'import redis',
  '',
  'class Lock:',
  '    def acquire(self, key):',
  '        return self.client.set(key, 1, nx=True)',
  '',
  '    def release(self, key):',
  '        self.client.delete(key)',
  '',
  'def helper():',
  '    return Lock()',
].join('\n')

const TYPESCRIPT = [
  "import { db } from './db'",
  '',
  'export async function acquire(key: string): Promise<boolean> {',
  '  if (key === "") {',
  '    return false',
  '  }',
  '  return db.lock(key)',
  '}',
  '',
  'export const release = (key: string) => db.unlock(key)',
].join('\n')

const GO = [
  'package lock',
  '',
  'func Acquire(key string) bool {',
  '\tif key == "" {',
  '\t\treturn false',
  '\t}',
  '\treturn client.SetNX(key)',
  '}',
  '',
  'func Release(key string) {}',
].join('\n')

const lines = (text: string) => text.split('\n').filter(line => line !== '')

describe('the region of a symbol', () => {
  test('in Python it is the definition and the lines indented under it', () => {
    expect(regionOf(lines(PYTHON), 'acquire')).toEqual(['    def acquire(self, key):', '        return self.client.set(key, 1, nx=True)'])
    expect(regionOf(lines(PYTHON), 'Lock')?.length, 'a class takes its methods').toBe(5)
    expect(regionOf(lines(PYTHON), 'Lock.release')).toEqual(['    def release(self, key):', '        self.client.delete(key)'])
  })

  test('in TypeScript and Go it runs to the brace that closes the one its line opens', () => {
    expect(regionOf(lines(TYPESCRIPT), 'acquire')?.at(-1)).toBe('}')
    expect(regionOf(lines(TYPESCRIPT), 'acquire')?.length).toBe(6)
    expect(regionOf(lines(TYPESCRIPT), 'release')).toEqual(['export const release = (key: string) => db.unlock(key)'])
    expect(regionOf(lines(GO), 'Acquire')?.length).toBe(6)
    expect(regionOf(lines(GO), 'Release')).toEqual(['func Release(key string) {}'])
  })

  test('the definition comes before a mere use, and a name inside a longer word is no match', () => {
    const text = ['const total = acquireAll()', 'run(acquire)', 'function acquire() {', '  return 1', '}'].join('\n')

    expect(regionOf(lines(text), 'acquire')?.[0]).toBe('function acquire() {')
    expect(regionOf(lines('only(acquire) here'), 'acquire')).toEqual(['only(acquire) here'])
    expect(regionOf(lines('acquireAll()'), 'acquire')).toBeUndefined()
  })
})

describe('the region of a symbol, past its header', () => {
  test('a Python signature over several lines runs on to the body under it', () => {
    const text = ['def acquire(', '    key,', '    ttl=30,', ') -> bool:', '    return client.set(key, 1, nx=True)', '', 'def release(key):', '    pass'].join('\n')

    expect(regionOf(lines(text), 'acquire')).toEqual(['def acquire(', '    key,', '    ttl=30,', ') -> bool:', '    return client.set(key, 1, nx=True)'])
    expect(regionOf(lines('def merge(into={}):\n    return into\nTOTAL = 1'), 'merge'), 'a brace inside its brackets opens no block').toEqual([
      'def merge(into={}):',
      '    return into',
    ])
  })

  test('a TypeScript signature over several lines, its brace on the last, runs to the brace that closes it', () => {
    const text = ['export async function acquire(', '  key: string,', '  options: { ttl: number },', '): Promise<boolean> {', '  return db.lock(key)', '}', 'export function release() {}'].join('\n')

    expect(regionOf(lines(text), 'acquire')?.at(-2)).toBe('  return db.lock(key)')
    expect(regionOf(lines(text), 'acquire')?.length).toBe(6)
  })

  test('a use of the name on a line above its definition is not the definition', () => {
    const text = ['export const handler = createApp(config)', '', 'export function createApp(config: Config) {', '  return new App(config)', '}'].join('\n')

    expect(regionOf(lines(text), 'createApp')).toEqual(['export function createApp(config: Config) {', '  return new App(config)', '}'])
  })

  test('the decorators above a Python definition are part of it', () => {
    const text = ['class Jobs:', '    @retry(times=3)', '    @staticmethod', '    def acquire(key):', '        return lock(key)', '    def release(key):', '        pass'].join('\n')

    expect(regionOf(lines(text), 'acquire')).toEqual(['    @retry(times=3)', '    @staticmethod', '    def acquire(key):', '        return lock(key)'])
  })

  test('a Go method is found by its name after its receiver', () => {
    const text = ['func (s *Store) Other() {}', 'x := s.Acquire(k)', 'func (s *Store) Acquire(key string) bool {', '\treturn s.lock(key)', '}'].join('\n')

    expect(regionOf(lines(text), 'Store.Acquire')).toEqual(['func (s *Store) Acquire(key string) bool {', '\treturn s.lock(key)', '}'])
  })
})

describe('a file that holds secrets by its name', () => {
  test('is told by its name alone, wherever it lies', () => {
    for (const path of ['.env', 'apps/api/.env.local', 'certs/server.pem', 'deploy/tls.key', 'a.p12', 'a.pfx', 'id_rsa', 'home/id_rsa.pub', 'android/app.keystore', 'credentials.json', 'credentials', 'config/secrets.yaml', 'secrets.yml', 'secrets.toml', 'secrets.ini', 'secrets.txt', 'secrets.json', 'secrets', 'infra/prod.tfvars', '.npmrc', '.pypirc', '.netrc']) {
      expect(isSecretFile(path), path).toBe(true)
    }

    for (const path of ['src/env.ts', 'src/keys.ts', 'app/secrets.py', 'src/credentials.ts', 'lib/secrets_store.go', 'docs/secret-handling.md', 'src/queue/lock.ts', 'environment.md']) {
      expect(isSecretFile(path), path).toBe(false)
    }
  })
})

describe('a fingerprint', () => {
  test('is the symbol’s region when the symbol is there, and moves only when that region does', async () => {
    const before = await fingerprintOf(PYTHON, 'acquire')
    const elsewhere = await fingerprintOf(PYTHON.replace('self.client.delete(key)', 'self.client.unlink(key)'), 'acquire')
    const changed = await fingerprintOf(PYTHON.replace('nx=True', 'nx=False'), 'acquire')

    expect(before).toMatch(/^r1:[0-9a-f]{32}$/)
    expect(elsewhere).toBe(before)
    expect(changed).not.toBe(before)
  })

  test('without line endings, trailing whitespace and blank lines counting', async () => {
    const before = await fingerprintOf(TYPESCRIPT)
    const tidied = await fingerprintOf(`${TYPESCRIPT.replace(/\n/g, '\r\n').replace(/\)$/gm, ')   ')}\n\n\n`)

    expect(before).toMatch(/^f1:[0-9a-f]{32}$/)
    expect(tidied).toBe(before)
    expect(await fingerprintOf(TYPESCRIPT.replace('db.lock', 'db.tryLock'))).not.toBe(before)
  })

  test('is the whole file when the symbol is not found, and none for a file past the length', async () => {
    const long = Array.from({ length: MAX_PRINT_LINES + 1 }, (_, at) => `line ${at}`).join('\n')

    expect(await fingerprintOf(GO, 'Missing')).toBe(await fingerprintOf(GO))
    expect(schemeOf((await fingerprintOf(GO, 'Missing')) ?? '')).toBe('f1')
    expect(await fingerprintOf(long)).toBeUndefined()
    expect(await fingerprintOf(long, 'Missing')).toBeUndefined()
    expect(schemeOf((await fingerprintOf(`${long}\nfunction Found() {\n}`, 'Found')) ?? '')).toBe('r1')
  })

  test('taken under the scheme held before: a symbol that is gone is a change of its region, not a file fingerprint', async () => {
    const before = await fingerprintOf(GO, 'Acquire', 'r1')
    const gone = await fingerprintOf(GO.replace('Acquire', 'Take'), 'Acquire', 'r1')

    expect(schemeOf(gone ?? '')).toBe('r1')
    expect(gone).not.toBe(before)
    expect(await fingerprintOf(GO, 'Acquire', 'f1'), 'the whole file asked for is the whole file').toBe(await fingerprintOf(GO))
  })

  test('has the one shape Fylgja stores', async () => {
    expect(isPrint(await fingerprintOf(GO))).toBe(true)
    expect(isPrint('f1:abc')).toBe(false)
    expect(isPrint('sha256:' + '0'.repeat(32))).toBe(false)
  })
})
