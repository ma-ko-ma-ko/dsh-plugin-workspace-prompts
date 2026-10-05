/**
 * Plugin configuration schema.
 *
 * @module dsh-plugin-workspace-prompts/config
 */

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { normalizePath } from './paths.js'

/** Default file name inside the harness home. */
export const DEFAULT_FILE_NAME = 'workspace-prompts.json'

/**
 * Where the prompt section sits relative to the first-party prompt blocks.
 *
 * The harness allocates the harness identity at `-1000` and the deployment
 * persona prefix at `0`; first-party guidance follows. The default places
 * workspace instructions after the identity and persona, and before the
 * harness's own reusable instructions, so a project's standing rules read as
 * deployment policy rather than as an afterthought.
 */
export const DEFAULT_ORDER = 500

/** The accepted configuration. */
export const Config = z.object({
  enabled: z.boolean().default(true).description('Mount the prompt section and tools.'),
  file: z
    .string()
    .description('Store document; a relative path resolves against the profile directory.'),
  dshHome: z.string().description('Harness home override; defaults to $DSH_HOME, then ~/.dsh.'),
  prompts: z
    .dict(z.union([z.string(), z.object({ prompt: z.string().required(), description: z.string() })]))
    .description('Deployment-supplied defaults, keyed by directory path or "*" for every workspace.'),
  includeWorkspaceHeader: z
    .boolean()
    .default(true)
    .description('Prefix the injected text with a line naming the workspace it came from.'),
  sectionTitle: z
    .string()
    .default('Workspace instructions')
    .description('Heading used by the injected workspace header.'),
  order: z.number().default(DEFAULT_ORDER).description('Sort position of the contributed prompt section.'),
  registerTools: z.boolean().default(true).description('Register the workspace_prompt_* tools.'),
  registerHttp: z
    .boolean()
    .default(true)
    .description('Register the settings page\'s JSON route when the profile composes the host web server.'),
  maxPromptBytes: z
    .number()
    .default(32768)
    .description('Reject a prompt larger than this many bytes, so one workspace cannot flood the prompt.'),
})

/**
 * Expand a configured path, which may start with `~`, into an absolute path.
 * @param {string} value - the configured path.
 * @returns {string} the expanded path.
 */
function expandTilde(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

/**
 * Resolve the harness home the way `@deepseek-ai/dsh-home-paths` does, so this
 * plugin needs no peer dependency on it.
 * @param {string|undefined} configured - the configured override.
 * @param {Record<string, string|undefined>} env - the environment to read.
 * @returns {string} the absolute harness home.
 */
export function resolveHome(configured, env = process.env) {
  const fromEnvironment = env.DSH_HOME
  const chosen =
    configured ?? (fromEnvironment !== undefined && fromEnvironment.trim().length > 0 ? fromEnvironment : join(homedir(), '.dsh'))
  return resolve(expandTilde(chosen))
}

/**
 * Resolve the store document path.
 *
 * An absolute or `~`-prefixed value is used as written. A relative value is
 * anchored to `baseUrl` when the host supplies one — the profile's directory
 * under a normal profile boot — and to the harness home otherwise, so
 * `./workspace-prompts.json` means "beside this profile's patch file" in a
 * profile-backed deployment and `$DSH_HOME/workspace-prompts.json` in a host
 * that anchors entries elsewhere. An absolute path is the unambiguous choice
 * when the location matters.
 *
 * @param {object} config - the parsed plugin configuration.
 * @param {object} [options] - resolution context.
 * @param {string} [options.baseUrl] - the owning entry's base URL, usually `ctx.baseUrl`.
 * @param {Record<string, string|undefined>} [options.env] - the environment to read.
 * @returns {string} the absolute store path.
 */
export function resolveStoreFile(config, options = {}) {
  const { baseUrl, env = process.env } = options
  if (typeof config.file === 'string' && config.file.trim().length > 0) {
    const expanded = expandTilde(config.file.trim())
    if (isAbsolute(expanded)) return resolve(expanded)
    const anchor = directoryFromBaseUrl(baseUrl) ?? resolveHome(config.dshHome, env)
    return resolve(anchor, expanded)
  }
  return join(resolveHome(config.dshHome, env), DEFAULT_FILE_NAME)
}

/**
 * Convert an entry base URL into a directory path.
 * @param {string|undefined} baseUrl - a `file:` URL, with or without a trailing slash.
 * @returns {string|undefined} the directory, or undefined when it is not a usable file URL.
 */
function directoryFromBaseUrl(baseUrl) {
  if (typeof baseUrl !== 'string' || !baseUrl.startsWith('file:')) return undefined
  try {
    return fileURLToPath(baseUrl)
  } catch {
    return undefined
  }
}

/**
 * Convert configured defaults into stored entries keyed by normalized path.
 * @param {Record<string, string|{prompt: string, description?: string}>|undefined} prompts - configured defaults.
 * @returns {Record<string, {prompt: string, description?: string}>} normalized entries.
 */
export function configuredEntries(prompts) {
  /** @type {Record<string, {prompt: string, description?: string}>} */
  const entries = {}
  for (const [key, value] of Object.entries(prompts ?? {})) {
    const normalized = key === '*' ? '*' : normalizePath(key)
    if (normalized.length === 0) continue
    entries[normalized] = typeof value === 'string' ? { prompt: value } : { ...value }
  }
  return entries
}
