import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { Config, DEFAULT_FILE_NAME, DEFAULT_ORDER, configuredEntries, resolveHome, resolveStoreFile } from '../lib/config.js'

/** A file URL for a directory, spelled the way a Cordis ctx.baseUrl is. */
const baseUrlFor = (directory) => `${pathToFileURL(directory).href}/`

test('the default order sits after the persona and before first-party guidance', () => {
  assert.equal(DEFAULT_ORDER, 500)
})

test('resolveHome follows the harness precedence', () => {
  assert.equal(resolveHome(undefined, { DSH_HOME: 'D:\\homes\\dsh' }), resolve('D:\\homes\\dsh'))
  assert.equal(resolveHome('E:\\explicit', { DSH_HOME: 'D:\\homes\\dsh' }), resolve('E:\\explicit'))
  assert.equal(resolveHome(undefined, {}), join(homedir(), '.dsh'))
  assert.equal(resolveHome(undefined, { DSH_HOME: '   ' }), join(homedir(), '.dsh'))
})

test('resolveStoreFile defaults into the harness home', () => {
  const file = resolveStoreFile({}, { env: { DSH_HOME: 'D:\\homes\\dsh' } })
  assert.equal(file, join(resolve('D:\\homes\\dsh'), DEFAULT_FILE_NAME))
})

test('an absolute configured file is used as written', () => {
  const file = resolveStoreFile({ file: 'D:\\data\\p.json' }, { env: { DSH_HOME: 'D:\\homes\\dsh' } })
  assert.equal(file, resolve('D:\\data\\p.json'))
})

test('a relative configured file resolves against the profile directory', () => {
  const file = resolveStoreFile(
    { file: './workspace-prompts.json' },
    { baseUrl: baseUrlFor('F:\\profiles\\desktop'), env: { DSH_HOME: 'D:\\homes\\dsh' } },
  )
  assert.equal(file, resolve('F:\\profiles\\desktop', 'workspace-prompts.json'))
})

test('a relative configured file falls back to the harness home without a profile base', () => {
  const file = resolveStoreFile({ file: 'prompts/mine.json' }, { env: { DSH_HOME: 'D:\\homes\\dsh' } })
  assert.equal(file, join(resolve('D:\\homes\\dsh'), 'prompts', 'mine.json'))
})

test('a non-file base URL is not treated as a directory', () => {
  const file = resolveStoreFile({ file: 'prompts/mine.json' }, { baseUrl: 'https://example.com/x', env: { DSH_HOME: 'D:\\homes\\dsh' } })
  assert.equal(file, join(resolve('D:\\homes\\dsh'), 'prompts', 'mine.json'))
})

test('a tilde in a configured file expands to the user home', () => {
  const file = resolveStoreFile({ file: '~/prompts.json' }, { env: { DSH_HOME: 'D:\\homes\\dsh' } })
  assert.equal(file, join(homedir(), 'prompts.json'))
})

test('a configured dshHome steers the default file', () => {
  const file = resolveStoreFile({ dshHome: 'E:\\elsewhere' }, { env: { DSH_HOME: 'D:\\homes\\dsh' } })
  assert.equal(file, join(resolve('E:\\elsewhere'), DEFAULT_FILE_NAME))
})

test('configuredEntries normalizes keys and accepts shorthand strings', () => {
  const entries = configuredEntries({
    'F:\\Projects\\Api\\': 'api rules',
    '*': { prompt: 'everywhere', description: 'global' },
  })
  assert.deepEqual(Object.keys(entries).sort(), ['*', 'f:/projects/api'])
  assert.deepEqual(entries['f:/projects/api'], { prompt: 'api rules' })
  assert.deepEqual(entries['*'], { prompt: 'everywhere', description: 'global' })
})

test('configuredEntries drops keys that normalize to nothing', () => {
  assert.deepEqual(configuredEntries({ '  ': 'ignored' }), {})
  assert.deepEqual(configuredEntries(undefined), {})
})

test('the schema parses an empty config into defaults', () => {
  const config = new Config({})
  assert.equal(config.enabled, true)
  assert.equal(config.includeWorkspaceHeader, true)
  assert.equal(config.order, DEFAULT_ORDER)
  assert.equal(config.registerTools, true)
  assert.equal(config.maxPromptBytes, 32768)
  assert.equal(config.sectionTitle, 'Workspace instructions')
})

test('the schema accepts configured defaults and overrides', () => {
  const config = new Config({
    order: 10,
    sectionTitle: 'Project conventions',
    includeWorkspaceHeader: false,
    registerTools: false,
    maxPromptBytes: 1024,
    prompts: { '/work': 'rules', '*': { prompt: 'always', description: 'base' } },
  })
  assert.equal(config.order, 10)
  assert.equal(config.sectionTitle, 'Project conventions')
  assert.equal(config.includeWorkspaceHeader, false)
  assert.equal(config.registerTools, false)
  assert.equal(config.maxPromptBytes, 1024)
  assert.equal(config.prompts['/work'], 'rules')
})
