/**
 * Durable storage for per-workspace prompt entries.
 *
 * Entries live in one JSON document so an operator can read and hand-edit the
 * whole set. Writes are serialized through a promise chain and committed by
 * atomic replace, so a crash mid-write leaves either the previous document or
 * the new one — never a truncated file.
 *
 * @module dsh-plugin-workspace-prompts/store
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { GLOBAL_KEY, normalizePath } from './paths.js'

/** Current on-disk document version. */
export const STORE_VERSION = 1

/**
 * The persisted document.
 * @typedef {object} StoreDocument
 * @property {number} version - the {@link STORE_VERSION} this file was written with.
 * @property {Record<string, PromptEntry>} prompts - entries keyed by path (or `'*'`).
 */

/**
 * One stored prompt.
 * @typedef {object} PromptEntry
 * @property {string} prompt - the instruction text injected into the system prompt.
 * @property {string} [description] - a short human label for listings.
 * @property {string} [updatedAt] - an ISO timestamp for the last write.
 */

/** Create an empty document. @returns {StoreDocument} a fresh document. */
export function emptyDocument() {
  return { version: STORE_VERSION, prompts: {} }
}

/**
 * Read a stored document, tolerating absence and damage.
 *
 * A missing file is an empty store. A malformed document throws, because
 * silently discarding an operator's prompt text is worse than refusing to
 * start; the error names the file so it can be repaired.
 *
 * @param {string} file - absolute path of the store document.
 * @returns {Promise<StoreDocument>} the parsed document.
 */
export async function readDocument(file) {
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return emptyDocument()
    throw new Error(`workspace-prompts: cannot read ${file}: ${message(error)}`)
  }

  if (raw.trim().length === 0) return emptyDocument()

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`workspace-prompts: ${file} is not valid JSON (${message(error)}); repair or delete it`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`workspace-prompts: ${file} must contain a JSON object`)
  }

  const prompts = parsed.prompts
  if (prompts !== undefined && (typeof prompts !== 'object' || prompts === null || Array.isArray(prompts))) {
    throw new Error(`workspace-prompts: ${file} field "prompts" must be an object`)
  }

  const document = emptyDocument()
  for (const [key, value] of Object.entries(prompts ?? {})) {
    const entry = coerceEntry(key, value, file)
    document.prompts[key === GLOBAL_KEY ? GLOBAL_KEY : normalizePath(key)] = entry
  }
  return document
}

/**
 * Validate one stored entry.
 * @param {string} key - the entry's key, for diagnostics.
 * @param {unknown} value - the raw entry.
 * @param {string} file - the store path, for diagnostics.
 * @returns {PromptEntry} the entry.
 */
function coerceEntry(key, value, file) {
  if (typeof value === 'string') return { prompt: value }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`workspace-prompts: ${file} entry ${JSON.stringify(key)} must be a string or an object`)
  }
  if (typeof value.prompt !== 'string') {
    throw new Error(`workspace-prompts: ${file} entry ${JSON.stringify(key)} needs a string "prompt"`)
  }
  /** @type {PromptEntry} */
  const entry = { prompt: value.prompt }
  if (typeof value.description === 'string') entry.description = value.description
  if (typeof value.updatedAt === 'string') entry.updatedAt = value.updatedAt
  return entry
}

/**
 * Serialized, atomic access to one store document.
 *
 * A synchronous {@link PromptStore.snapshot} exists because prompt assembly is
 * synchronous: the section text function cannot await a read. The snapshot is
 * refreshed by the initial load and by every committed mutation, which is
 * exactly the set of moments the document can change from inside this process.
 */
export class PromptStore {
  /** @type {string} */
  #file

  /** @type {StoreDocument} */
  #document = emptyDocument()

  /** @type {boolean} */
  #loaded = false

  /** @type {Promise<unknown>} */
  #chain = Promise.resolve()

  /** @type {Promise<StoreDocument>|undefined} */
  #loading

  /**
   * @param {string} file - absolute path of the store document.
   */
  constructor(file) {
    this.#file = file
  }

  /** @returns {string} the store document path. */
  get file() {
    return this.#file
  }

  /**
   * The most recently read document, for synchronous consumers.
   *
   * Prompt assembly is synchronous, so a section text function cannot await a
   * read. Until {@link PromptStore.load} settles the snapshot is empty, which
   * renders no workspace section rather than failing the whole prompt.
   * @returns {Record<string, PromptEntry>} the current entries.
   */
  snapshot() {
    return this.#document.prompts
  }

  /** @returns {boolean} whether the document has been read at least once. */
  get loaded() {
    return this.#loaded
  }

  /**
   * Load the document if it has not been loaded yet.
   * @returns {Promise<StoreDocument>} the current document.
   */
  load() {
    if (this.#loaded) return Promise.resolve(this.#document)
    this.#loading ??= readDocument(this.#file).then((document) => {
      this.#document = document
      this.#loaded = true
      return document
    })
    return this.#loading
  }

  /**
   * Read a snapshot of every entry.
   * @returns {Promise<Record<string, PromptEntry>>} a defensive copy.
   */
  async entries() {
    const document = await this.load()
    return structuredClone(document.prompts)
  }

  /**
   * Create or replace one entry.
   * @param {string} key - an absolute directory path, or `'*'` for the global default.
   * @param {PromptEntry} entry - the entry to store.
   * @returns {Promise<PromptEntry>} the stored entry.
   */
  set(key, entry) {
    const normalized = key === GLOBAL_KEY ? GLOBAL_KEY : normalizePath(key)
    return this.#mutate((document) => {
      /** @type {PromptEntry} */
      const stored = { ...entry, updatedAt: new Date().toISOString() }
      document.prompts[normalized] = stored
      return stored
    })
  }

  /**
   * Delete one entry.
   * @param {string} key - an absolute directory path, or `'*'`.
   * @returns {Promise<boolean>} whether an entry was removed.
   */
  delete(key) {
    const normalized = key === GLOBAL_KEY ? GLOBAL_KEY : normalizePath(key)
    return this.#mutate((document) => {
      if (!Object.hasOwn(document.prompts, normalized)) return false
      delete document.prompts[normalized]
      return true
    })
  }

  /**
   * Run one mutation against the freshly re-read document, then commit it.
   * Re-reading keeps a hand-edit made while the harness runs from being
   * overwritten by a stale in-memory copy.
   * @template T
   * @param {(document: StoreDocument) => T} mutate - the mutation.
   * @returns {Promise<T>} the mutation's result.
   */
  #mutate(mutate) {
    const run = this.#chain.then(async () => {
      const document = await readDocument(this.#file)
      const result = mutate(document)
      await this.#write(document)
      this.#document = document
      this.#loaded = true
      return result
    })
    // Keep the chain alive after a rejection so one failed write does not
    // poison every later mutation, while the caller still sees its own error.
    this.#chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /**
   * Commit a document to disk.
   * @param {StoreDocument} document - the document to write.
   * @returns {Promise<void>} resolves once the replacement is in place.
   */
  async #write(document) {
    const payload = `${JSON.stringify(document, null, 2)}\n`
    await mkdir(dirname(this.#file), { recursive: true })
    const temporary = `${this.#file}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporary, payload, 'utf8')
    try {
      await rename(temporary, this.#file)
    } catch (error) {
      // Windows can refuse a rename onto a file another handle has open.
      // Removing the destination and writing through keeps the new content
      // visible; the temporary file is cleaned up on both paths.
      if (error && (error.code === 'EPERM' || error.code === 'EEXIST' || error.code === 'EACCES')) {
        await rm(temporary, { force: true })
        await writeFile(this.#file, payload, 'utf8')
        return
      }
      throw error
    }
  }
}

/**
 * Extract a message from an unknown thrown value.
 * @param {unknown} error - the thrown value.
 * @returns {string} a printable message.
 */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
