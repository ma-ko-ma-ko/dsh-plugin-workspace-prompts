import assert from 'node:assert/strict'
import test from 'node:test'
import { GLOBAL_KEY, ancestorKeys, matchEntry, normalizePath, parentKey } from '../lib/paths.js'

test('normalizePath collapses separators and folds dot segments', () => {
  assert.equal(normalizePath('/home/me/project'), '/home/me/project')
  assert.equal(normalizePath('/home/me/project/'), '/home/me/project')
  assert.equal(normalizePath('/home//me///project'), '/home/me/project')
  assert.equal(normalizePath('/home/./me/project'), '/home/me/project')
  assert.equal(normalizePath('/home/me/other/../project'), '/home/me/project')
  assert.equal(normalizePath('/'), '/')
})

test('normalizePath keeps a drive root separable from a drive-relative path', () => {
  assert.equal(normalizePath('C:\\'), 'c:/')
  assert.equal(normalizePath('C:\\work'), 'c:/work')
  assert.equal(normalizePath('C:/work/'), 'c:/work')
  assert.equal(normalizePath('D:\\a\\b'), 'd:/a/b')
})

test('normalizePath compares Windows paths case-insensitively', () => {
  assert.equal(normalizePath('C:\\Users\\Me\\Repo'), normalizePath('c:/users/me/repo'))
  // POSIX is case-sensitive, so the two directories stay distinct.
  assert.notEqual(normalizePath('/home/Me/Repo'), normalizePath('/home/me/repo'))
})

test('normalizePath accepts either separator on either platform', () => {
  assert.equal(normalizePath('C:\\Users\\Me'), normalizePath('C:/Users/Me'))
})

test('normalizePath preserves UNC share paths', () => {
  assert.equal(normalizePath('\\\\server\\share\\dir'), '//server/share/dir')
})

test('normalizePath tolerates unusable input', () => {
  assert.equal(normalizePath(''), '')
  assert.equal(normalizePath('   '), '')
  assert.equal(normalizePath(undefined), '')
})

test('ancestorKeys walks from the path up to the root', () => {
  assert.deepEqual(ancestorKeys('/a/b/c'), ['/a/b/c', '/a/b', '/a', '/'])
  assert.deepEqual(ancestorKeys('c:/work/repo'), ['c:/work/repo', 'c:/work', 'c:/'])
  assert.deepEqual(ancestorKeys('/'), ['/'])
})

test('ancestorKeys on a relative path contributes only itself', () => {
  assert.deepEqual(ancestorKeys('src/lib'), ['src/lib'])
})

test('parentKey stops at filesystem roots', () => {
  assert.equal(parentKey('/a/b'), '/a')
  assert.equal(parentKey('/a'), '/')
  assert.equal(parentKey('/'), undefined)
  assert.equal(parentKey('c:/'), undefined)
  assert.equal(parentKey('//'), undefined)
})

test('matchEntry prefers the directory, then its nearest ancestor, then the global default', () => {
  const entries = { '/a': 'ancestor-a', '/a/b/c': 'self-c', '*': 'global' }
  assert.deepEqual(matchEntry(entries, '/a/b/c'), { key: '/a/b/c', value: 'self-c', matchedBy: 'self' })
  assert.deepEqual(matchEntry(entries, '/a/b/d'), { key: '/a', value: 'ancestor-a', matchedBy: 'ancestor' })
  assert.deepEqual(matchEntry(entries, '/other'), { key: GLOBAL_KEY, value: 'global', matchedBy: 'global' })
  assert.deepEqual(matchEntry(entries, '/other/deep/path'), { key: GLOBAL_KEY, value: 'global', matchedBy: 'global' })
})

test('matchEntry returns undefined when nothing applies', () => {
  assert.equal(matchEntry({ '/a': 'x' }, '/b'), undefined)
  assert.equal(matchEntry({}, '/b'), undefined)
})

test('matchEntry accepts a Map as well as a plain object', () => {
  const entries = new Map([['/a/b', 'hit']])
  assert.deepEqual(matchEntry(entries, '/a/b/deep'), { key: '/a/b', value: 'hit', matchedBy: 'ancestor' })
})

test('matchEntry ignores a prototype key rather than treating it as configured', () => {
  assert.equal(matchEntry({}, '/constructor'), undefined)
  assert.equal(matchEntry({}, '/toString'), undefined)
})
