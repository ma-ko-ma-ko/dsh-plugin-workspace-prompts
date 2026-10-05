/**
 * The settings page's HTTP surface.
 *
 * The browser half needs to read and write the same store the model tools use,
 * and the harness's typed Remote RPC requires a TypeScript decorator plus a
 * code-generation toolchain. This package ships plain ESM with no build step,
 * so the page talks to one small JSON route over the host web server instead.
 *
 * Scope and safety: the route is registered only when the profile composes
 * `@deepseek-ai/dsh-host-webserver` (the web GUI does; a headless profile does
 * not, and then the plugin simply has no HTTP face). Every request is refused
 * unless it is loopback-local and same-origin, so a page from another site
 * cannot reach the route through a browser.
 *
 * @module dsh-plugin-workspace-prompts/http
 */

import { MAX_API_PROMPT_BYTES, buildView, validateKey, validatePrompt } from './api.js'
import { GLOBAL_KEY } from './paths.js'

/** The exact path this plugin claims. */
export const ROUTE_PATH = '/api/workspace-prompts'

/** Request bodies are small; anything larger is refused unread. */
const MAX_BODY_BYTES = MAX_API_PROMPT_BYTES + 65536

/**
 * Decide whether a request may reach the route.
 *
 * The guard is deliberately narrow: the server binds loopback in the shipped
 * posture, and this additionally refuses non-loopback peers, cross-origin
 * `Origin` headers, and non-loopback `Host` headers. That closes the
 * browser-based cross-site path (a page cannot set `Origin`, and a
 * DNS-rebinding name fails the `Host` check) without pretending to be an
 * authentication layer.
 *
 * @param {import('node:http').IncomingMessage} request - the request.
 * @returns {{ok: true} | {ok: false, status: number, error: string}} the verdict.
 */
export function authorize(request) {
  const peer = request.socket?.remoteAddress ?? ''
  if (!isLoopback(peer)) return { ok: false, status: 403, error: 'the workspace-prompts endpoint accepts loopback requests only' }

  const origin = request.headers.origin
  if (typeof origin === 'string' && origin.length > 0 && !isLoopbackOrigin(origin)) {
    return { ok: false, status: 403, error: 'cross-origin requests are refused' }
  }

  const host = request.headers.host
  if (typeof host === 'string' && host.length > 0 && !isLoopbackHost(host)) {
    return { ok: false, status: 403, error: 'the Host header must name a loopback address' }
  }
  return { ok: true }
}

/**
 * Report whether an address is loopback.
 * @param {string} address - a socket address.
 * @returns {boolean} true for `127.0.0.0/8`, `::1`, or an IPv4-mapped loopback.
 */
function isLoopback(address) {
  if (address === '::1' || address === '::ffff:127.0.0.1') return true
  return address.startsWith('127.')
}

/**
 * Report whether an `Origin` header names a loopback page.
 * @param {string} origin - the header value.
 * @returns {boolean} true when the origin names a loopback host.
 */
function isLoopbackOrigin(origin) {
  // A sandboxed or opaque origin serializes as the literal `null`; it carries
  // no host to check, so it is refused rather than assumed local.
  if (origin === 'null') return false
  try {
    return isLoopbackHost(new URL(origin).host)
  } catch {
    return false
  }
}

/**
 * Report whether a `Host` header names a loopback address.
 * @param {string} host - the header value, possibly with a port.
 * @returns {boolean} true when the host part is loopback.
 */
function isLoopbackHost(host) {
  const withoutPort = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  const bare = withoutPort.replace(/^\[|\]$/g, '')
  if (bare === 'localhost' || bare === '::1') return true
  return isLoopback(bare)
}

/**
 * Read and parse a JSON request body with a size and time bound.
 *
 * @param {import('node:http').IncomingMessage} request - the request.
 * @returns {Promise<{ok: true, value: unknown} | {ok: false, status: number, error: string}>} the parsed body.
 */
async function readJson(request) {
  const chunks = []
  let total = 0
  try {
    for await (const chunk of request) {
      total += chunk.length
      if (total > MAX_BODY_BYTES) return { ok: false, status: 413, error: 'request body is too large' }
      chunks.push(chunk)
    }
  } catch {
    return { ok: false, status: 400, error: 'could not read the request body' }
  }
  if (total === 0) return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } catch {
    return { ok: false, status: 400, error: 'request body must be JSON' }
  }
}

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} response - the response.
 * @param {number} status - the status code.
 * @param {unknown} payload - the JSON body.
 */
function sendJson(response, status, payload) {
  const body = `${JSON.stringify(payload)}\n`
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    // Nothing here is cacheable, and the page must never act on a stale copy.
    'cache-control': 'no-store',
  })
  response.end(body)
}

/**
 * Build the route handler.
 *
 * @param {object} deps - the live plugin state.
 * @param {import('./store.js').PromptStore} deps.store - the prompt store.
 * @param {() => Record<string, {prompt: string, description?: string}>} deps.configured - config-supplied entries.
 * @param {() => number} deps.maxPromptBytes - the per-prompt byte budget.
 * @param {string} deps.storeFile - the store document path, reported to the page.
 * @param {() => (string|undefined)} [deps.defaultDirectory] - the directory an omitted key falls back to.
 * @param {(message: string) => void} [deps.warn] - failure sink for logged errors.
 * @returns {(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => Promise<void>} the handler.
 */
export function createRouteHandler({ store, configured, maxPromptBytes, storeFile, defaultDirectory, warn }) {
  return async function handle(request, response) {
    try {
      const verdict = authorize(request)
      if (!verdict.ok) return sendJson(response, verdict.status, { error: verdict.error })

      const method = request.method ?? 'GET'
      if (method === 'GET') return await handleGet(request, response, { store, configured, storeFile, defaultDirectory })
      if (method === 'PUT') return await handlePut(request, response, { store, configured, maxPromptBytes, defaultDirectory })
      if (method === 'DELETE') return await handleDelete(request, response, { store, configured, defaultDirectory })
      return sendJson(response, 405, { error: `method ${method} is not supported` })
    } catch (error) {
      warn?.(`workspace-prompts: ${error instanceof Error ? error.message : String(error)}`)
      if (!response.headersSent) sendJson(response, 500, { error: 'the workspace-prompts endpoint failed' })
      else response.end()
    }
  }
}

/**
 * Resolve the key a request addresses, falling back to the profile's workspace.
 * @param {unknown} requested - the caller's directory, if any.
 * @param {() => (string|undefined)} [defaultDirectory] - the fallback source.
 * @returns {{ok: true, key: string} | {ok: false, error: string}} the verdict.
 */
function resolveKey(requested, defaultDirectory) {
  if (requested === undefined || requested === null || requested === '') {
    const fallback = defaultDirectory?.()
    if (typeof fallback !== 'string' || fallback.length === 0) {
      return { ok: false, error: 'directory is required (this deployment reports no default workspace)' }
    }
    return validateKey(fallback)
  }
  return validateKey(requested)
}

/**
 * Serve the current view.
 * @param {import('node:http').IncomingMessage} request - the request.
 * @param {import('node:http').ServerResponse} response - the response.
 * @param {object} deps - read dependencies.
 * @returns {Promise<void>} resolves after the response.
 */
async function handleGet(request, response, deps) {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const directory = url.searchParams.get('directory') ?? undefined
  sendJson(
    response,
    200,
    buildView({
      stored: await deps.store.entries(),
      configured: deps.configured(),
      directory,
      storeFile: deps.storeFile,
      defaultDirectory: deps.defaultDirectory?.(),
    }),
  )
}

/**
 * Create or replace one entry.
 * @param {import('node:http').IncomingMessage} request - the request.
 * @param {import('node:http').ServerResponse} response - the response.
 * @param {object} deps - write dependencies.
 * @returns {Promise<void>} resolves after the response.
 */
async function handlePut(request, response, deps) {
  const body = await readJson(request)
  if (!body.ok) return sendJson(response, body.status, { error: body.error })
  const payload = body.value
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return sendJson(response, 400, { error: 'request body must be a JSON object' })
  }

  const key = resolveKey(payload.directory, deps.defaultDirectory)
  if (!key.ok) return sendJson(response, 400, { error: key.error })
  const prompt = validatePrompt(payload.prompt, deps.maxPromptBytes())
  if (!prompt.ok) return sendJson(response, 400, { error: prompt.error })
  if (payload.description !== undefined && payload.description !== null && typeof payload.description !== 'string') {
    return sendJson(response, 400, { error: 'description must be a string when present' })
  }

  const description = typeof payload.description === 'string' && payload.description.length > 0 ? payload.description : undefined
  const existing = await deps.store.entries()
  await deps.store.set(key.key, { prompt: prompt.prompt, ...(description === undefined ? {} : { description }) })

  const stored = await deps.store.entries()
  sendJson(response, 200, {
    saved: { directory: key.key, replaced: Object.hasOwn(existing, key.key) },
    view: buildView({ stored, configured: deps.configured(), directory: key.key === GLOBAL_KEY ? undefined : key.key }),
  })
}

/**
 * Delete one stored entry.
 * @param {import('node:http').IncomingMessage} request - the request.
 * @param {import('node:http').ServerResponse} response - the response.
 * @param {object} deps - write dependencies.
 * @returns {Promise<void>} resolves after the response.
 */
async function handleDelete(request, response, deps) {
  let directory
  const url = new URL(request.url ?? '/', 'http://localhost')
  const fromQuery = url.searchParams.get('directory')
  if (fromQuery !== null) {
    directory = fromQuery
  } else {
    const body = await readJson(request)
    if (!body.ok) return sendJson(response, body.status, { error: body.error })
    if (body.value === undefined) return sendJson(response, 400, { error: 'directory is required' })
    if (typeof body.value !== 'object' || body.value === null || Array.isArray(body.value)) {
      return sendJson(response, 400, { error: 'request body must be a JSON object' })
    }
    directory = body.value.directory
  }

  const key = resolveKey(directory, deps.defaultDirectory)
  if (!key.ok) return sendJson(response, 400, { error: key.error })

  const removed = await deps.store.delete(key.key)
  const existsInConfiguration = Object.hasOwn(deps.configured(), key.key)
  const stored = await deps.store.entries()
  sendJson(response, 200, {
    removed,
    ...(existsInConfiguration
      ? { note: 'an entry declared in configuration still applies to this directory' }
      : {}),
    view: buildView({
      stored,
      configured: deps.configured(),
      directory: key.key === GLOBAL_KEY ? undefined : key.key,
    }),
  })
}
