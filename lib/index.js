/**
 * Per-workspace default system prompts for DeepSeek Harness.
 *
 * The plugin contributes one system-prompt section whose text is resolved per
 * assembly from the session's working directory: a prompt registered for that
 * directory, for any ancestor of it, or for `'*'` applies automatically to
 * every session running inside it. Prompts live in a hand-editable JSON
 * document under the harness home, and can also be declared in configuration.
 *
 * @module dsh-plugin-workspace-prompts
 */

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Config, configuredEntries, resolveStoreFile } from './config.js'
import { ROUTE_PATH, createRouteHandler } from './http.js'
import { applyBudget, renderSection, resolvePrompt } from './resolve.js'
import { PromptStore } from './store.js'
import { registerTools } from './tools.js'

/** Stable plugin name used by loader diagnostics. */
export const name = 'workspace-prompts'

/**
 * Services this plugin needs. Declaring them keeps the row unloaded until both
 * are present, instead of throwing when a profile omits the prompt registry.
 *
 * `webServer` is deliberately not listed: the settings route is optional, and a
 * headless profile composes no HTTP server at all.
 */
export const inject = ['systemPrompt', 'tools']

export { Config }

/** Prompt section name contributed by this plugin. */
export const SECTION_NAME = 'workspace:default-prompt'

/** Default cap on one workspace prompt, in bytes. */
export const DEFAULT_MAX_PROMPT_BYTES = 32768

/**
 * Apply the plugin.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {object} config - parsed configuration (see {@link Config}).
 */
export function apply(ctx, config) {
  if (config.enabled === false) return

  // A relative `file` is anchored to the profile directory, which is the entry
  // base URL Cordis gives the plugin.
  const file = resolveStoreFile(config, { baseUrl: ctx.baseUrl })
  const store = new PromptStore(file)
  const configured = configuredEntries(config.prompts)
  const includeHeader = config.includeWorkspaceHeader !== false
  const headerTitle = config.sectionTitle ?? 'Workspace instructions'
  const maxPromptBytes = () => config.maxPromptBytes ?? DEFAULT_MAX_PROMPT_BYTES

  // The text is a function so it is evaluated once per assembly. That is what
  // makes a changed working directory — or a `workspace_prompt_set` call —
  // visible on the very next model step rather than only on a new session.
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: config.order ?? 500,
    // Operator-supplied prose is delivered verbatim: `{{...}}` in a prompt is
    // documentation, not a prompt-variable reference, and an unresolvable
    // reference would otherwise fail the whole assembly.
    interpolate: false,
    text: (context) => {
      const directory = context?.agent?.session?.header?.cwd
      if (typeof directory !== 'string' || directory.length === 0) return ''

      const resolved = resolvePrompt({ configured, stored: store.snapshot() }, directory)
      if (resolved === undefined) return ''

      const budgeted = applyBudget(resolved.prompt, maxPromptBytes())
      if (budgeted.prompt.trim().length === 0) return ''

      const rendered = renderSection(
        { ...resolved, prompt: budgeted.prompt },
        { includeHeader, headerTitle, display: (key) => key },
      )
      return budgeted.truncated
        ? `${rendered}\n\n[Workspace prompt truncated to the configured maxPromptBytes budget.]`
        : rendered
    },
  })

  // Read the document at mount so a malformed file is reported once, at
  // startup, where an operator can act on it — instead of failing every turn.
  // Until this settles the snapshot is empty, so assembly simply contributes
  // no workspace section.
  ctx.effect(() => {
    let cancelled = false
    const load = async () => {
      try {
        await mkdir(dirname(file), { recursive: true })
        await store.load()
      } catch (error) {
        if (!cancelled) ctx.logger?.warn?.(`workspace-prompts: ${message(error)}`)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, 'workspace-prompts:load')

  if (config.registerTools !== false) {
    registerTools(ctx, { store, configured: () => configured, maxPromptBytes })
  }

  // The settings page reads and writes the same store over one JSON route. The
  // HTTP face exists only when the profile composes the host web server, so it
  // is awaited through `ctx.inject` rather than read once at apply time: the
  // server may mount after this row, and a missed lookup would silently leave
  // the page without a backend.
  if (config.registerHttp !== false) {
    ctx.inject(['webServer'], (webCtx) => {
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: 'exact',
            path: ROUTE_PATH,
            handler: createRouteHandler({
              store,
              configured: () => configured,
              maxPromptBytes,
              storeFile: file,
              defaultDirectory: () => profileWorkspace(ctx),
              warn: (message) => ctx.logger?.warn?.(message),
            }),
          }),
        'workspace-prompts: settings route',
      )
    })
  }

  const count = Object.keys(configured).length
  ctx.logger?.debug?.(
    `workspace-prompts: store ${file}${count === 0 ? '' : ` with ${count} configured default${count === 1 ? '' : 's'}`}`,
  )
}

/**
 * The profile's own working directory, used when the settings page saves without
 * naming one.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @returns {string|undefined} the absolute directory, when the host reports one.
 */
function profileWorkspace(ctx) {
  const cwd = ctx.get('profileContext')?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

/**
 * Extract a message from an unknown thrown value.
 * @param {unknown} error - the thrown value.
 * @returns {string} a printable message.
 */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
