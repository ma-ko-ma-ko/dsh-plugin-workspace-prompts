/**
 * Route-level tests for the settings page's HTTP surface.
 *
 * These drive the handler with synthetic requests, so they cover the parts that
 * matter for a route a browser page talks to: the loopback/origin guard, method
 * handling, validation, and the round-trip through the store.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { ROUTE_PATH, authorize, createRouteHandler } from '../lib/http.js'
import { PromptStore } from '../lib/store.js'

/** A response double that records what the handler wrote. */
function makeResponse() {
  return {
    status: undefined,
    headers: undefined,
    body: '',
    headersSent: false,
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
      this.headersSent = true
    },
    end(chunk) {
      if (typeof chunk === 'string') this.body += chunk
      this.headersSent = true
    },
    json() {
      return JSON.parse(this.body)
    },
  }
}

/**
 * A request double with a JSON body.
 * @param {object} options - method, url, body, and headers.
 * @returns {object} the request.
 */
function makeRequest({ method = 'GET', url = ROUTE_PATH, body, headers = {}, peer = '127.0.0.1' } = {}) {
  const text = body === undefined ? '' : JSON.stringify(body)
  const stream = Readable.from(text.length === 0 ? [] : [Buffer.from(text, 'utf8')])
  stream.method = method
  stream.url = url
  stream.headers = { host: '127.0.0.1:19387', ...headers }
  stream.socket = { remoteAddress: peer }
  return stream
}

/** Build a handler over a scratch store. */
async function harness(t, { configured = {}, maxPromptBytes = 32768, defaultDirectory } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'wsp-http-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const storeFile = join(directory, 'prompts.json')
  const store = new PromptStore(storeFile)
  await store.load()
  const handler = createRouteHandler({
    store,
    configured: () => configured,
    maxPromptBytes: () => maxPromptBytes,
    storeFile,
    ...(defaultDirectory === undefined ? {} : { defaultDirectory }),
  })
  return { handler, store, storeFile }
}

/** Run one request through the handler. */
async function run(handler, options) {
  const response = makeResponse()
  await handler(makeRequest(options), response)
  return response
}

test('GET lists every entry and marks the governing one', async (t) => {
  const { handler } = await harness(t, { configured: { '*': { prompt: 'global from config' } } })

  await run(handler, { method: 'PUT', body: { directory: '/work/api', prompt: 'api rules', description: 'api' } })

  const listed = (await run(handler, { method: 'GET', url: `${ROUTE_PATH}?directory=${encodeURIComponent('/work/api/src')}` })).json()
  assert.equal(listed.entries.length, 2)
  const stored = listed.entries.find((entry) => entry.directory === '/work/api')
  const configuredRow = listed.entries.find((entry) => entry.directory === '*')
  assert.equal(stored.editable, true)
  assert.equal(stored.description, 'api')
  assert.equal(configuredRow.editable, false)
  assert.equal(listed.active.key, '/work/api')
  assert.equal(listed.active.matchedBy, 'ancestor')
  assert.equal(listed.active.prompt, 'api rules')
})

test('PUT creates then replaces, reporting which happened', async (t) => {
  const { handler, store } = await harness(t)

  const created = (await run(handler, { method: 'PUT', body: { directory: '/work', prompt: 'first' } })).json()
  assert.equal(created.saved.replaced, false)
  assert.equal(created.saved.directory, '/work')

  const replaced = (await run(handler, { method: 'PUT', body: { directory: '/work', prompt: 'second' } })).json()
  assert.equal(replaced.saved.replaced, true)
  assert.equal((await store.entries())['/work'].prompt, 'second')
})

test('PUT normalizes the directory key', async (t) => {
  const { handler, store } = await harness(t)
  const result = (await run(handler, { method: 'PUT', body: { directory: 'C:\\Work\\Api\\', prompt: 'x' } })).json()
  assert.equal(result.saved.directory, 'c:/work/api')
  assert.deepEqual(Object.keys(await store.entries()), ['c:/work/api'])
})

test('GET reports the directory an omitted key would resolve to', async (t) => {
  const { handler } = await harness(t, { defaultDirectory: () => 'C:\\Users\\me\\.dsh' })
  const view = (await run(handler, { method: 'GET' })).json()
  assert.equal(view.defaultDirectory, 'c:/users/me/.dsh')
})

test('GET omits the default directory when the host reports none', async (t) => {
  const { handler } = await harness(t)
  const view = (await run(handler, { method: 'GET' })).json()
  assert.equal(view.defaultDirectory, undefined)
})

test('PUT accepts the reserved global key', async (t) => {
  const { handler, store } = await harness(t)
  const result = (await run(handler, { method: 'PUT', body: { directory: '*', prompt: 'everywhere' } })).json()
  assert.equal(result.saved.directory, '*')
  assert.deepEqual(Object.keys(await store.entries()), ['*'])
})

test('PUT falls back to the profile workspace when no directory is named', async (t) => {
  const { handler, store } = await harness(t, { defaultDirectory: () => 'F:\\fallback' })
  const result = (await run(handler, { method: 'PUT', body: { prompt: 'default target' } })).json()
  assert.equal(result.saved.directory, 'f:/fallback')
  assert.equal((await store.entries())['f:/fallback'].prompt, 'default target')
})

test('PUT without a directory and without a reported workspace is refused', async (t) => {
  const { handler } = await harness(t)
  const response = await run(handler, { method: 'PUT', body: { prompt: 'x' } })
  assert.equal(response.status, 400)
  assert.match(response.json().error, /directory is required/)
})

test('PUT rejects an empty prompt and a body that is not an object', async (t) => {
  const { handler } = await harness(t)
  assert.equal((await run(handler, { method: 'PUT', body: { directory: '/w', prompt: '   ' } })).status, 400)
  assert.equal((await run(handler, { method: 'PUT', body: { directory: '/w' } })).status, 400)
  assert.equal((await run(handler, { method: 'PUT', body: 'not an object' })).status, 400)
  assert.equal((await run(handler, { method: 'PUT', body: { directory: 42, prompt: 'x' } })).status, 400)
})

test('PUT enforces the configured byte budget', async (t) => {
  const { handler } = await harness(t, { maxPromptBytes: 16 })
  const response = await run(handler, { method: 'PUT', body: { directory: '/w', prompt: 'x'.repeat(17) } })
  assert.equal(response.status, 400)
  assert.match(response.json().error, /exceeds the limit/)
})

test('DELETE removes one entry and reports configuration still covering it', async (t) => {
  const { handler } = await harness(t, { configured: { '/work': { prompt: 'from config' } } })
  await run(handler, { method: 'PUT', body: { directory: '/work', prompt: 'from store' } })

  const removed = (await run(handler, { method: 'DELETE', url: `${ROUTE_PATH}?directory=${encodeURIComponent('/work')}` })).json()
  assert.equal(removed.removed, true)
  assert.match(removed.note, /declared in configuration/)
  assert.equal(removed.view.active.source, 'config')
})

test('DELETE accepts the directory in the body', async (t) => {
  const { handler } = await harness(t)
  await run(handler, { method: 'PUT', body: { directory: '/work', prompt: 'x' } })
  const removed = (await run(handler, { method: 'DELETE', body: { directory: '/work' } })).json()
  assert.equal(removed.removed, true)
  assert.equal(removed.note, undefined)
})

test('DELETE without a target is refused', async (t) => {
  const { handler } = await harness(t)
  assert.equal((await run(handler, { method: 'DELETE' })).status, 400)
})

test('an unsupported method is refused', async (t) => {
  const { handler } = await harness(t)
  const response = await run(handler, { method: 'POST' })
  assert.equal(response.status, 405)
})

test('a body that is not JSON is reported as a bad request', async (t) => {
  const { handler } = await harness(t)
  const request = makeRequest({ method: 'PUT' })
  request.headers['content-type'] = 'application/json'
  const response = makeResponse()
  // Push invalid JSON through the body stream.
  const stream = Readable.from([Buffer.from('{ broken', 'utf8')])
  stream.method = 'PUT'
  stream.url = ROUTE_PATH
  stream.headers = request.headers
  stream.socket = { remoteAddress: '127.0.0.1' }
  await handler(stream, response)
  assert.equal(response.status, 400)
  assert.match(response.json().error, /must be JSON/)
})

test('the guard refuses a non-loopback peer', () => {
  const verdict = authorize(makeRequest({ peer: '10.0.0.7' }))
  assert.equal(verdict.ok, false)
  assert.equal(verdict.status, 403)
})

test('the guard refuses a cross-origin request', () => {
  const verdict = authorize(makeRequest({ headers: { origin: 'https://evil.example' } }))
  assert.equal(verdict.ok, false)
  assert.match(verdict.error, /cross-origin/)
})

test('the guard refuses a non-loopback Host header', () => {
  const verdict = authorize(makeRequest({ headers: { host: 'attacker.example' } }))
  assert.equal(verdict.ok, false)
  assert.match(verdict.error, /Host header/)
})

test('the guard accepts loopback peers, origins, and hosts', () => {
  assert.equal(authorize(makeRequest()).ok, true)
  assert.equal(authorize(makeRequest({ peer: '::1', headers: { host: '[::1]:19387', origin: 'http://127.0.0.1:19387' } })).ok, true)
  assert.equal(authorize(makeRequest({ headers: { host: 'localhost:19387', origin: 'http://localhost:19387' } })).ok, true)
})

test('the guard refuses an opaque origin even from loopback', () => {
  const verdict = authorize(makeRequest({ headers: { origin: 'null' } }))
  assert.equal(verdict.ok, false)
})

test('responses are not cacheable', async (t) => {
  const { handler } = await harness(t)
  const response = await run(handler, { method: 'GET' })
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.match(response.headers['content-type'], /application\/json/)
})
