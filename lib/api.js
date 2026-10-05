/**
 * The shared entry surface.
 *
 * Both model-facing tools and the settings page read and write the same store,
 * so the rules that decide what a valid entry looks like and how the two
 * sources (configuration and the store file) are presented live here, in one
 * place, rather than being restated per caller.
 *
 * @module dsh-plugin-workspace-prompts/api
 */

import { GLOBAL_KEY, normalizePath } from './paths.js'
import { resolvePrompt } from './resolve.js'

/** Maximum accepted length of one prompt, in bytes, for the HTTP surface. */
export const MAX_API_PROMPT_BYTES = 262144

/**
 * Validate a prompt string coming from outside the plugin.
 *
 * @param {unknown} value - the candidate prompt.
 * @param {number} maxBytes - the configured per-prompt budget.
 * @returns {{ok: true, prompt: string} | {ok: false, error: string}} the verdict.
 */
export function validatePrompt(value, maxBytes) {
  if (typeof value !== 'string') return { ok: false, error: 'prompt must be a string' }
  if (value.trim().length === 0) return { ok: false, error: 'prompt must not be empty or whitespace-only' }
  const bytes = Buffer.byteLength(value, 'utf8')
  if (bytes > maxBytes) return { ok: false, error: `prompt is ${bytes} bytes, which exceeds the limit of ${maxBytes}` }
  return { ok: true, prompt: value }
}

/**
 * Normalize a caller-supplied directory key.
 *
 * `'*'` is the reserved global default; every other value is normalized the
 * same way the store normalizes its keys, so a save from the settings page and
 * a save from a tool always address the same entry.
 *
 * @param {unknown} value - the candidate key.
 * @returns {{ok: true, key: string} | {ok: false, error: string}} the verdict.
 */
export function validateKey(value) {
  if (typeof value !== 'string') return { ok: false, error: 'directory must be a string' }
  const trimmed = value.trim()
  if (trimmed.length === 0) return { ok: false, error: 'directory must not be empty' }
  if (trimmed === GLOBAL_KEY) return { ok: true, key: GLOBAL_KEY }
  const normalized = normalizePath(trimmed)
  if (normalized.length === 0) return { ok: false, error: 'directory must not be empty' }
  return { ok: true, key: normalized }
}

/**
 * Build the complete view the settings page renders.
 *
 * Every configured entry is listed with its provenance, the one governing a
 * chosen directory is marked, and the effective prompt text is resolved so the
 * page can show inheritance (a directory with no entry of its own still shows
 * the ancestor or global prompt that applies to it).
 *
 * @param {object} input - the view inputs.
 * @param {Record<string, {prompt: string, description?: string}>} input.stored - store-file entries.
 * @param {Record<string, {prompt: string, description?: string}>} input.configured - config-supplied entries.
 * @param {string} [input.directory] - the directory to resolve as "current".
 * @param {string} [input.storeFile] - the store document path, for display.
 * @param {string} [input.defaultDirectory] - the directory an omitted key resolves to.
 * @returns {object} the view.
 */
export function buildView({ stored, configured, directory, storeFile, defaultDirectory }) {
  const entries = [
    ...Object.entries(stored).map(([key, entry]) => ({ key, entry, source: 'file' })),
    ...Object.entries(configured).map(([key, entry]) => ({ key, entry, source: 'config' })),
  ]
    .map(({ key, entry, source }) => ({
      directory: key,
      scope: key === GLOBAL_KEY ? 'global' : 'directory',
      source,
      editable: source === 'file',
      description: entry.description ?? null,
      characters: entry.prompt.length,
      bytes: Buffer.byteLength(entry.prompt, 'utf8'),
    }))
    .sort((a, b) => (a.directory < b.directory ? -1 : a.directory > b.directory ? 1 : 0))

  const resolved =
    typeof directory === 'string' && directory.length > 0
      ? resolvePrompt({ configured, stored }, directory)
      : undefined

  return {
    entries,
    ...(storeFile === undefined ? {} : { storeFile }),
    ...(typeof defaultDirectory === 'string' && defaultDirectory.length > 0
      ? { defaultDirectory: normalizePath(defaultDirectory) }
      : {}),
    ...(resolved === undefined
      ? {}
      : {
          active: {
            directory: normalizePath(directory),
            key: resolved.key,
            matchedBy: resolved.matchedBy,
            source: resolved.source,
            prompt: resolved.prompt,
          },
        }),
  }
}
