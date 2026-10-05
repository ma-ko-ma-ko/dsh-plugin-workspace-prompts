/**
 * Plugin configuration.
 *
 * The schema is hand-rolled rather than declared with `@deepseek-ai/schemastery`
 * on purpose: this package is installed from a Git checkout by hosts that
 * already own the harness runtime, and `@deepseek-ai/*` packages are not on the
 * public npm registry. Depending on one would make `npm install` fail — or leave
 * the module missing — for anyone who clones the repository, so the plugin has
 * no runtime dependencies at all.
 *
 * Applied values follow the same rule the harness schemas use: an explicit
 * `null` or `undefined` takes the default, while `false` and `0` are kept.
 *
 * @module dsh-plugin-workspace-prompts/config
 */

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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

/** Accepted default for `maxPromptBytes`. */
export const DEFAULT_MAX_PROMPT_BYTES = 32768

/** Accepted default for `sectionTitle`. */
export const DEFAULT_SECTION_TITLE = 'Workspace instructions'

/** The accepted configuration, as data the validator reads. */
export const CONFIG_FIELDS = Object.freeze({
  enabled: { kind: 'boolean', default: true, description: 'Mount the prompt section, the tools, and the settings page.' },
  file: { kind: 'string', description: 'Store document; a relative path resolves against the profile directory.' },
  dshHome: { kind: 'string', description: 'Harness home override; defaults to $DSH_HOME, then ~/.dsh.' },
  prompts: { kind: 'prompts', description: 'Deployment-supplied defaults, keyed by directory path or "*".' },
  includeWorkspaceHeader: {
    kind: 'boolean',
    default: true,
    description: 'Prefix the injected text with a line naming the workspace it came from.',
  },
  sectionTitle: {
    kind: 'string',
    default: DEFAULT_SECTION_TITLE,
    description: 'Heading used by the injected workspace header.',
  },
  order: { kind: 'number', default: DEFAULT_ORDER, description: 'Sort position of the contributed prompt section.' },
  registerTools: { kind: 'boolean', default: true, description: 'Register the workspace_prompt_* tools.' },
  registerHttp: {
    kind: 'boolean',
    default: true,
    description: "Register the settings page's JSON route when the profile composes the host web server.",
  },
  maxPromptBytes: {
    kind: 'number',
    default: DEFAULT_MAX_PROMPT_BYTES,
    description: 'Reject a prompt larger than this many bytes, so one workspace cannot flood the prompt.',
  },
})

/** Keys the harness itself may add to an entry; they are not ours to validate. */
const HARNESS_KEYS = new Set(['id', 'name', 'disabled', 'inject', 'group', 'isolate', 'intercept'])

/**
 * Throw a configuration error naming the offending field.
 * @param {string} field - the field name.
 * @param {string} detail - what is wrong with it.
 */
function reject(field, detail) {
  throw new TypeError(`workspace-prompts: config.${field} ${detail}`)
}

/**
 * Validate the `prompts` map.
 * @param {unknown} raw - the configured value.
 * @returns {Record<string, string|{prompt: string, description?: string}>} the accepted map.
 */
function validatePrompts(raw) {
  if (typeof raw !== 'object' || Array.isArray(raw)) reject('prompts', 'must be an object keyed by directory')
  /** @type {Record<string, string|{prompt: string, description?: string}>} */
  const accepted = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      accepted[key] = value
      continue
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      reject(`prompts[${JSON.stringify(key)}]`, 'must be a string or an object with a "prompt"')
    }
    if (typeof value.prompt !== 'string') reject(`prompts[${JSON.stringify(key)}]`, 'needs a string "prompt"')
    if (value.description !== undefined && value.description !== null && typeof value.description !== 'string') {
      reject(`prompts[${JSON.stringify(key)}].description`, 'must be a string when present')
    }
    accepted[key] = {
      prompt: value.prompt,
      ...(typeof value.description === 'string' ? { description: value.description } : {}),
    }
  }
  return accepted
}

/**
 * Parse and validate a configuration object.
 *
 * This is the configuration schema handed to the plugin loader: the loader
 * calls it with whatever the profile row declares. It is also the constructor
 * the tests use directly.
 *
 * @param {unknown} input - the raw configuration, as a host supplies it.
 * @returns {object} the applied configuration.
 */
export function applyConfig(input) {
  const raw = input === undefined || input === null ? {} : input
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('workspace-prompts: config must be an object')
  }

  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(CONFIG_FIELDS, key) && !HARNESS_KEYS.has(key)) {
      throw new TypeError(`workspace-prompts: unknown config field ${JSON.stringify(key)}`)
    }
  }

  /** @type {Record<string, unknown>} */
  const applied = {}
  for (const [field, spec] of Object.entries(CONFIG_FIELDS)) {
    const value = raw[field]
    if (value === undefined || value === null) {
      if ('default' in spec) applied[field] = spec.default
      continue
    }
    switch (spec.kind) {
      case 'boolean':
        if (typeof value !== 'boolean') reject(field, 'must be a boolean')
        applied[field] = value
        break
      case 'string':
        if (typeof value !== 'string') reject(field, 'must be a string')
        applied[field] = value
        break
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) reject(field, 'must be a finite number')
        applied[field] = value
        break
      case 'prompts':
        applied[field] = validatePrompts(value)
        break
      /* v8 ignore next -- CONFIG_FIELDS declares no other kind. */
      default:
        reject(field, `has an unsupported kind ${JSON.stringify(spec.kind)}`)
    }
  }
  return applied
}

/** The configuration schema bound by the plugin loader. */
export const Config = applyConfig

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
 * plugin needs no dependency on it.
 * @param {string|undefined} configured - the configured override.
 * @param {Record<string, string|undefined>} env - the environment to read.
 * @returns {string} the absolute harness home.
 */
export function resolveHome(configured, env = process.env) {
  const fromEnvironment = env.DSH_HOME
  const chosen =
    configured ??
    (fromEnvironment !== undefined && fromEnvironment.trim().length > 0 ? fromEnvironment : join(homedir(), '.dsh'))
  return resolve(expandTilde(chosen))
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
