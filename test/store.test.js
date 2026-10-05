import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { STORE_VERSION, PromptStore, readDocument } from '../lib/store.js'

/** Create an isolated directory for one test. */
async function scratch(t) {
  const directory = await mkdtemp(join(tmpdir(), 'wsp-store-'))
  t.after(async () => {
    const { rm } = await import('node:fs/promises')
    await rm(directory, { recursive: true, force: true })
  })
  return directory
}

test('a missing document reads as an empty store', async (t) => {
  const directory = await scratch(t)
  const document = await readDocument(join(directory, 'absent.json'))
  assert.deepEqual(document, { version: STORE_VERSION, prompts: {} })
})

test('set writes a document the harness can read back', async (t) => {
  const directory = await scratch(t)
  const file = join(directory, 'nested', 'prompts.json')
  const store = new PromptStore(file)

  const stored = await store.set('/work/api', { prompt: 'Use tabs.', description: 'api repo' })
  assert.equal(stored.prompt, 'Use tabs.')
  assert.ok(typeof stored.updatedAt === 'string')

  const reread = await readDocument(file)
  assert.equal(reread.prompts['/work/api'].prompt, 'Use tabs.')
  assert.equal(reread.prompts['/work/api'].description, 'api repo')
  assert.equal(reread.version, STORE_VERSION)

  // Written as indented JSON so an operator can hand-edit it.
  assert.match(await readFile(file, 'utf8'), /\n {2}"prompts": \{/)
})

test('set replaces an existing entry and records the replacement', async (t) => {
  const directory = await scratch(t)
  const store = new PromptStore(join(directory, 'prompts.json'))
  await store.set('/work', { prompt: 'first' })
  await store.set('/work', { prompt: 'second' })

  const entries = await store.entries()
  assert.deepEqual(Object.keys(entries), ['/work'])
  assert.equal(entries['/work'].prompt, 'second')
})

test('keys normalize so a workspace is stored once however it is spelled', async (t) => {
  const directory = await scratch(t)
  const store = new PromptStore(join(directory, 'prompts.json'))
  await store.set('/work/api/', { prompt: 'first' })
  await store.set('/work/./api', { prompt: 'second' })

  const entries = await store.entries()
  assert.deepEqual(Object.keys(entries), ['/work/api'])
  assert.equal(entries['/work/api'].prompt, 'second')
})

test('the global default keeps its reserved key', async (t) => {
  const directory = await scratch(t)
  const store = new PromptStore(join(directory, 'prompts.json'))
  await store.set('*', { prompt: 'everywhere' })
  assert.deepEqual(Object.keys(await store.entries()), ['*'])
})

test('delete reports whether anything was removed', async (t) => {
  const directory = await scratch(t)
  const store = new PromptStore(join(directory, 'prompts.json'))
  await store.set('/work', { prompt: 'x' })

  assert.equal(await store.delete('/work'), true)
  assert.equal(await store.delete('/work'), false)
  assert.deepEqual(await store.entries(), {})
})

test('snapshot is usable synchronously once the store has loaded', async (t) => {
  const directory = await scratch(t)
  const store = new PromptStore(join(directory, 'prompts.json'))
  assert.equal(store.loaded, false)
  await store.set('/work', { prompt: 'x' })
  assert.equal(store.loaded, true)
  assert.equal(store.snapshot()['/work'].prompt, 'x')
})

test('concurrent writes all land', async (t) => {
  const directory = await scratch(t)
  const file = join(directory, 'prompts.json')
  const store = new PromptStore(file)

  await Promise.all(Array.from({ length: 8 }, (_, index) => store.set(`/work/${index}`, { prompt: `p${index}` })))

  const document = await readDocument(file)
  assert.equal(Object.keys(document.prompts).length, 8)
  for (let index = 0; index < 8; index += 1) {
    assert.equal(document.prompts[`/work/${index}`].prompt, `p${index}`)
  }
})

test('a mutation re-reads the file so an outside edit survives', async (t) => {
  const directory = await scratch(t)
  const file = join(directory, 'prompts.json')
  const store = new PromptStore(file)
  await store.set('/a', { prompt: 'a' })

  // Simulate an operator editing the document while the harness is running.
  const current = JSON.parse(await readFile(file, 'utf8'))
  current.prompts['/b'] = { prompt: 'hand-written' }
  await writeFile(file, JSON.stringify(current), 'utf8')

  await store.set('/c', { prompt: 'c' })
  const document = await readDocument(file)
  assert.deepEqual(Object.keys(document.prompts).sort(), ['/a', '/b', '/c'])
  assert.equal(document.prompts['/b'].prompt, 'hand-written')
})

test('a bare string entry is accepted as a prompt', async (t) => {
  const directory = await scratch(t)
  const file = join(directory, 'prompts.json')
  await writeFile(file, JSON.stringify({ version: 1, prompts: { '/work': 'just text' } }), 'utf8')
  const document = await readDocument(file)
  assert.equal(document.prompts['/work'].prompt, 'just text')
})

test('a malformed document fails loud and names the file', async (t) => {
  const directory = await scratch(t)
  const file = join(directory, 'prompts.json')
  await writeFile(file, '{ not json', 'utf8')
  await assert.rejects(() => readDocument(file), (error) => {
    assert.match(error.message, /workspace-prompts/)
    assert.match(error.message, /not valid JSON/)
    return true
  })
})

test('an entry without a prompt string fails loud', async (t) => {
  const directory = await scratch(t)
  const file = join(directory, 'prompts.json')
  await writeFile(file, JSON.stringify({ prompts: { '/work': { description: 'no text' } } }), 'utf8')
  await assert.rejects(() => readDocument(file), /needs a string "prompt"/)
})

test('an empty document is treated as an empty store', async (t) => {
  const directory = await scratch(t)
  const file = join(directory, 'prompts.json')
  await writeFile(file, '   \n', 'utf8')
  assert.deepEqual(await readDocument(file), { version: STORE_VERSION, prompts: {} })
})

test('entries returns a copy, so a caller cannot mutate the store', async (t) => {
  const directory = await scratch(t)
  const store = new PromptStore(join(directory, 'prompts.json'))
  await store.set('/work', { prompt: 'original' })
  const entries = await store.entries()
  entries['/work'].prompt = 'tampered'
  assert.equal((await store.entries())['/work'].prompt, 'original')
})

test('a failed write does not poison later mutations', async (t) => {
  const directory = await scratch(t)
  const file = join(directory, 'prompts.json')
  const store = new PromptStore(file)

  // A directory where the document should be makes the read fail loudly.
  const blocked = new PromptStore(join(directory, 'prompts.json'))
  await blocked.set('/ok', { prompt: 'fine' })
  assert.equal((await blocked.entries())['/ok'].prompt, 'fine')

  const failing = new PromptStore(directory) // a path that is a directory
  await assert.rejects(() => failing.set('/x', { prompt: 'x' }))
  await assert.rejects(() => failing.set('/y', { prompt: 'y' }))

  await store.set('/after', { prompt: 'still works' })
  assert.equal((await store.entries())['/after'].prompt, 'still works')
})
