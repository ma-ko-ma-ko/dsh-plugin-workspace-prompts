import assert from 'node:assert/strict'
import test from 'node:test'
import { applyBudget, describeScope, renderSection, resolvePrompt } from '../lib/resolve.js'

test('resolvePrompt prefers an entry for the exact directory', () => {
  const configured = {}
  const stored = { '/work/api': { prompt: 'api rules' }, '/work': { prompt: 'work rules' } }
  const resolved = resolvePrompt({ configured, stored }, '/work/api')
  assert.equal(resolved.prompt, 'api rules')
  assert.equal(resolved.matchedBy, 'self')
  assert.equal(resolved.source, 'file')
})

test('resolvePrompt falls back to the nearest ancestor', () => {
  const resolved = resolvePrompt({ configured: {}, stored: { '/work': { prompt: 'work rules' } } }, '/work/api/v2')
  assert.equal(resolved.prompt, 'work rules')
  assert.equal(resolved.matchedBy, 'ancestor')
  assert.equal(resolved.key, '/work')
})

test('resolvePrompt falls back to the global default last', () => {
  const resolved = resolvePrompt({ configured: {}, stored: { '*': { prompt: 'everywhere' } } }, '/anywhere')
  assert.equal(resolved.matchedBy, 'global')
  assert.equal(resolved.key, '*')
})

test('resolvePrompt returns undefined when nothing applies', () => {
  assert.equal(resolvePrompt({ configured: {}, stored: {} }, '/somewhere'), undefined)
  assert.equal(resolvePrompt({ configured: {}, stored: { '/work': { prompt: '   ' } } }, '/work'), undefined)
})

test('configured defaults outrank stored entries', () => {
  const resolved = resolvePrompt(
    { configured: { '/work': { prompt: 'from config' } }, stored: { '/work': { prompt: 'from file' } } },
    '/work',
  )
  assert.equal(resolved.prompt, 'from config')
  assert.equal(resolved.source, 'config')
})

test('a configured global default fills in when the file has nothing', () => {
  const resolved = resolvePrompt({ configured: { '*': { prompt: 'config global' } }, stored: {} }, '/elsewhere')
  assert.equal(resolved.prompt, 'config global')
  assert.equal(resolved.source, 'config')
})

test('a stored specific entry outranks a configured global default', () => {
  const resolved = resolvePrompt(
    { configured: { '*': { prompt: 'config global' } }, stored: { '/work': { prompt: 'file specific' } } },
    '/work',
  )
  assert.equal(resolved.prompt, 'file specific')
  assert.equal(resolved.source, 'file')
})

test('Windows spellings of the same directory resolve to one entry', () => {
  const stored = { 'c:/work/repo': { prompt: 'windows rules' } }
  assert.equal(resolvePrompt({ configured: {}, stored }, 'C:\\Work\\Repo\\src').prompt, 'windows rules')
})

test('describeScope names the workspace and its subdirectories', () => {
  const options = { headerTitle: 'Workspace instructions', display: (key) => key }
  const own = { key: '/work/api', matchedBy: 'self', prompt: 'x' }
  const ancestor = { key: '/work', matchedBy: 'ancestor', prompt: 'x' }
  const global = { key: '*', matchedBy: 'global', prompt: 'x' }

  assert.equal(describeScope(own, options), '# Workspace instructions for `/work/api`')
  assert.equal(describeScope(ancestor, options), '# Workspace instructions for `/work` and its subdirectories')
  assert.equal(describeScope(global, options), '# Workspace instructions (every workspace)')
})

test('renderSection prefixes a header unless it is disabled', () => {
  const resolved = { key: '/work', matchedBy: 'self', prompt: '  Use tabs.  ' }
  const options = { headerTitle: 'Workspace instructions', display: (key) => key }

  assert.equal(
    renderSection(resolved, { ...options, includeHeader: true }),
    '# Workspace instructions for `/work`\n\nUse tabs.',
  )
  assert.equal(renderSection(resolved, { ...options, includeHeader: false }), 'Use tabs.')
})

test('applyBudget passes text that fits unchanged', () => {
  assert.deepEqual(applyBudget('hello', 100), { prompt: 'hello', truncated: false })
})

test('applyBudget truncates on a byte boundary without a broken glyph', () => {
  const prompt = '你'.repeat(4) // 3 bytes each in UTF-8
  const result = applyBudget(prompt, 7)
  assert.equal(result.truncated, true)
  assert.equal(Buffer.byteLength(result.prompt, 'utf8') <= 7, true)
  assert.equal(result.prompt.includes('\uFFFD'), false)
  assert.equal(result.prompt, '你你')
})

test('applyBudget with a zero budget yields nothing', () => {
  assert.deepEqual(applyBudget('hello', 0), { prompt: '', truncated: true })
  assert.deepEqual(applyBudget('', 0), { prompt: '', truncated: false })
})
