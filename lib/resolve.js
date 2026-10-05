/**
 * Workspace resolution: turn a session's working directory into the entry that
 * governs it, and render that entry as prompt text.
 *
 * @module dsh-plugin-workspace-prompts/resolve
 */

import { GLOBAL_KEY, matchEntry, mergeEntries, normalizePath } from './paths.js'

/**
 * Where a resolved prompt came from.
 * @typedef {object} ResolvedPrompt
 * @property {string} key - the matching store key (a normalized path, or `'*'`).
 * @property {string} directory - the session directory the key matched.
 * @property {'self'|'ancestor'|'global'} matchedBy - how the key was chosen.
 * @property {'config'|'file'} source - which entry map supplied it.
 * @property {string} prompt - the instruction text to inject.
 * @property {string} [description] - the entry's human label, when it has one.
 */

/**
 * Resolve the prompt that applies to one working directory.
 *
 * Specificity decides first: the directory itself, then its nearest
 * configured ancestor, then the global default. Config-supplied entries only
 * break a tie, so a deployment's `config.prompts` wins when it names the same
 * directory as the store file, and cannot be shadowed by a stale file.
 *
 * @param {object} sources - the two entry maps.
 * @param {Record<string, {prompt: string, description?: string}>} [sources.configured] - config-supplied entries.
 * @param {Record<string, {prompt: string, description?: string}>} [sources.stored] - file-supplied entries.
 * @param {string} directory - the session working directory.
 * @returns {ResolvedPrompt|undefined} the governing prompt, or undefined when none applies.
 */
export function resolvePrompt(sources, directory) {
  const configured = sources.configured ?? {}
  const stored = sources.stored ?? {}
  const key = normalizePath(directory)

  // Merge lowest precedence first so a configured entry replaces a stored one
  // at the same key, while the walk still decides between different keys.
  const merged = mergeEntries(stored, configured)
  const match = matchEntry(merged, key)
  if (match === undefined) return undefined

  const entry = match.value
  const prompt = typeof entry === 'string' ? entry : entry?.prompt
  if (typeof prompt !== 'string' || prompt.trim().length === 0) return undefined

  const fromConfig = Object.hasOwn(configured, match.key)
  return {
    key: match.key,
    directory: key,
    matchedBy: match.matchedBy,
    source: fromConfig ? 'config' : 'file',
    prompt,
    ...(typeof entry === 'object' && entry !== null && typeof entry.description === 'string'
      ? { description: entry.description }
      : {}),
  }
}

/**
 * Describe where a resolved prompt applies, in the wording the model sees.
 * @param {ResolvedPrompt} resolved - the resolved prompt.
 * @param {{headerTitle: string, display: (key: string) => string}} options - rendering options.
 * @returns {string} the header line.
 */
export function describeScope(resolved, options) {
  if (resolved.key === GLOBAL_KEY) return `# ${options.headerTitle} (every workspace)`
  const scope = resolved.matchedBy === 'ancestor' ? ' and its subdirectories' : ''
  return `# ${options.headerTitle} for \`${options.display(resolved.key)}\`${scope}`
}

/**
 * Render the text contributed to the system prompt.
 *
 * The text is contributed with interpolation disabled, so a prompt containing
 * `{{...}}` prose is delivered literally instead of being read as a prompt
 * variable reference.
 *
 * @param {ResolvedPrompt} resolved - the resolved prompt.
 * @param {{includeHeader: boolean, headerTitle: string, display: (key: string) => string}} options - rendering options.
 * @returns {string} the section text.
 */
export function renderSection(resolved, options) {
  const body = resolved.prompt.trim()
  if (!options.includeHeader) return body
  return `${describeScope(resolved, options)}\n\n${body}`
}

/**
 * Trim a prompt to the configured byte budget.
 * @param {string} prompt - the configured prompt.
 * @param {number} maxBytes - the byte budget.
 * @returns {{prompt: string, truncated: boolean}} the accepted text.
 */
export function applyBudget(prompt, maxBytes) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return { prompt: '', truncated: prompt.length > 0 }
  if (Buffer.byteLength(prompt, 'utf8') <= maxBytes) return { prompt, truncated: false }
  const cut = Buffer.from(prompt, 'utf8').subarray(0, maxBytes).toString('utf8')
  // A multi-byte character split by the cut decodes to U+FFFD; drop that one
  // replacement character rather than shipping a broken glyph.
  return { prompt: cut.endsWith('\uFFFD') ? cut.slice(0, -1) : cut, truncated: true }
}
