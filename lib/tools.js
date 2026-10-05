/**
 * The `workspace_prompt_*` tools.
 *
 * These give the model a way to read and maintain per-workspace default
 * prompts on the user's behalf. Every write goes through the same store the
 * prompt section reads, so a change takes effect on the next assembled prompt.
 *
 * Output schemas are written in the harness author DSL: an object declares
 * `properties` and an explicit `additionalProperties`, and marks a mandatory
 * property with `required: true` on the property itself (there is no
 * `required` array, and only top-level parameter properties may be required).
 *
 * @module dsh-plugin-workspace-prompts/tools
 */

import { realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { GLOBAL_KEY, normalizePath } from './paths.js'
import { resolvePrompt } from './resolve.js'

/** Every tool name this family registers. */
export const TOOL_NAMES = Object.freeze([
  'workspace_prompt_list',
  'workspace_prompt_get',
  'workspace_prompt_set',
  'workspace_prompt_remove',
])

/** Shared description of the `directory` parameter. */
const DIRECTORY_DESCRIPTION =
  'Absolute workspace directory. Omit it for this session\'s own workspace, or pass "*" for the default that applies to every workspace.'

/**
 * Resolve a caller-supplied workspace path to the key the store uses.
 *
 * An omitted directory means "the session's own workspace", which is the common
 * case: the rule is usually written while working inside the project it governs.
 * The result is returned in store-key form (symlinks resolved when the directory
 * exists, separators and case normalized) so tool results and listings name the
 * same key the document holds.
 *
 * @param {string|undefined} requested - the caller's path, if any.
 * @param {string} sessionCwd - the owning session's working directory.
 * @returns {Promise<string>} the normalized workspace key, or `'*'`.
 */
async function resolveWorkspace(requested, sessionCwd) {
  const raw = requested === undefined || requested.trim().length === 0 ? sessionCwd : requested.trim()
  if (raw === GLOBAL_KEY) return GLOBAL_KEY
  const absolute = isAbsolute(raw) ? resolve(raw) : resolve(sessionCwd, raw)
  try {
    return normalizePath(await realpath(absolute))
  } catch {
    // The directory may not exist yet; the lexical path is still a usable key.
    return normalizePath(absolute)
  }
}

/**
 * Read the owning session's working directory.
 * @param {object|undefined} agent - the executing agent, when there is one.
 * @returns {string} the absolute directory, or `''` when unknown.
 */
function sessionDirectory(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' ? cwd : ''
}

/**
 * Build the model-facing entry rows.
 *
 * Configured defaults are listed alongside stored ones so the model can see
 * every rule that could apply, and every row names its `source`, because only
 * file-backed rows can be edited by these tools.
 *
 * @param {Record<string, {prompt: string, description?: string}>} stored - file entries.
 * @param {Record<string, {prompt: string, description?: string}>} configured - config entries.
 * @returns {object[]} one row per entry, ordered by key.
 */
function listingRows(stored, configured) {
  const row = (key, entry, source) => ({
    workspace: key,
    scope: key === GLOBAL_KEY ? 'global' : 'directory',
    source,
    ...(entry.description === undefined ? {} : { description: entry.description }),
    characters: entry.prompt.length,
    removable: source === 'file',
  })
  return [
    ...Object.entries(stored).map(([key, entry]) => row(key, entry, 'file')),
    ...Object.entries(configured).map(([key, entry]) => row(key, entry, 'config')),
  ].sort((a, b) => (a.workspace < b.workspace ? -1 : a.workspace > b.workspace ? 1 : 0))
}

/**
 * Register the tool family on the calling context.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {object} options - the live plugin state.
 * @param {import('./store.js').PromptStore} options.store - the prompt store.
 * @param {() => Record<string, {prompt: string, description?: string}>} options.configured - config-supplied entries.
 * @param {() => number} options.maxPromptBytes - the per-prompt byte budget.
 */
export function registerTools(ctx, options) {
  const { store, configured, maxPromptBytes } = options

  ctx.tools.register(
    defineTool({
      name: 'workspace_prompt_list',
      description:
        'List every configured per-workspace default prompt, including deployment defaults declared in configuration, and mark ' +
        'the one that currently applies to this session. These prompts are injected into the system prompt automatically for ' +
        'sessions working in that directory or below it.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            entries: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  workspace: { type: 'string', description: 'The workspace directory, or "*" for the global default.' },
                  scope: { type: 'string', description: 'Either "directory" or "global".' },
                  source: {
                    type: 'string',
                    description: 'Either "file" (editable through these tools) or "config" (declared in configuration).',
                  },
                  description: { type: 'string', description: 'The entry\'s optional label.' },
                  characters: { type: 'integer', description: 'Length of the configured prompt.' },
                  removable: { type: 'boolean', description: 'Whether these tools can delete the entry.' },
                  active: { type: 'boolean', description: 'Whether this entry governs the calling session.' },
                },
              },
            },
            active: { type: 'string', description: 'The key governing the calling session, when there is one.' },
            activeSource: { type: 'string', description: 'Whether the active prompt came from "config" or "file".' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              value.entries.length === 0
                ? 'No workspace prompts are configured.'
                : [
                    ...value.entries.map(
                      (entry) =>
                        `- ${entry.workspace} [${entry.scope}, ${entry.source}] (${entry.characters} chars)` +
                        `${entry.description === undefined ? '' : ` — ${entry.description}`}` +
                        `${entry.active === true ? ' <- active' : ''}`,
                    ),
                    '',
                    `Active: ${value.active ?? 'none'}${value.activeSource === undefined ? '' : ` (from ${value.activeSource})`}`,
                  ].join('\n'),
          },
        ],
      },
      async execute(_args, exec) {
        const sessionCwd = sessionDirectory(exec.agent)
        const stored = await store.entries()
        const declared = configured()
        const active = resolvePrompt({ configured: declared, stored }, sessionCwd)
        return {
          entries: listingRows(stored, declared).map((row) => ({
            ...row,
            active: active?.key === row.workspace && active.source === row.source,
          })),
          ...(active === undefined ? {} : { active: active.key }),
          ...(active === undefined ? {} : { activeSource: active.source }),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'workspace_prompt_get',
      description:
        'Show the default prompt that governs one workspace directory. Reports an inherited ancestor prompt when the exact ' +
        'directory has none of its own.',
      parameters: { directory: { type: 'string', description: DIRECTORY_DESCRIPTION } },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            workspace: { type: 'string', required: true, description: 'The directory that was looked up.' },
            prompt: { type: 'string', description: 'The governing prompt, absent when none applies.' },
            description: { type: 'string', description: 'The entry\'s optional label.' },
            source: { type: 'string', description: 'Whether the prompt came from "config" or "file".' },
            matchedBy: { type: 'string', description: '"self", "ancestor", or "global".' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              value.prompt === undefined
                ? `No default prompt is configured for ${value.workspace}.`
                : `${value.workspace} (from ${value.source}, matched by ${value.matchedBy}):\n\n${value.prompt}`,
          },
        ],
      },
      async execute(args, exec) {
        const key = await resolveWorkspace(args.directory, sessionDirectory(exec.agent))
        const resolved = resolvePrompt({ configured: configured(), stored: await store.entries() }, key)
        return {
          workspace: key,
          ...(resolved === undefined ? {} : { prompt: resolved.prompt }),
          ...(resolved?.description === undefined ? {} : { description: resolved.description }),
          ...(resolved === undefined ? {} : { source: resolved.source, matchedBy: resolved.matchedBy }),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'workspace_prompt_set',
      description:
        'Create or replace the default prompt for a workspace directory. The text is injected into the system prompt of every ' +
        'session working in that directory or below it. Pass "*" as the directory to set the default for every workspace.',
      parameters: {
        prompt: { type: 'string', required: true, description: 'The instruction text to inject, verbatim.' },
        directory: { type: 'string', description: DIRECTORY_DESCRIPTION },
        description: { type: 'string', description: 'Optional short label shown in listings.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            workspace: { type: 'string', required: true, description: 'The key that was written.' },
            characters: { type: 'integer', required: true, description: 'Length of the stored prompt.' },
            replaced: { type: 'boolean', required: true, description: 'Whether an existing entry was overwritten.' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: `${value.replaced ? 'Replaced' : 'Created'} the default prompt for ${value.workspace} (${value.characters} chars). It applies from the next prompt assembly.`,
          },
        ],
      },
      async execute(args, exec) {
        const text = args.prompt
        if (text.trim().length === 0) throw new Error('prompt must not be empty or whitespace-only')
        const limit = maxPromptBytes()
        const bytes = Buffer.byteLength(text, 'utf8')
        if (bytes > limit) {
          throw new Error(`prompt is ${bytes} bytes, which exceeds the configured maxPromptBytes limit of ${limit}`)
        }

        const key = await resolveWorkspace(args.directory, sessionDirectory(exec.agent))
        const existing = await store.entries()
        await store.set(key, {
          prompt: text,
          ...(args.description === undefined ? {} : { description: args.description }),
        })
        return {
          workspace: key,
          characters: text.length,
          replaced: Object.hasOwn(existing, normalizePath(key)),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'workspace_prompt_remove',
      description:
        'Delete the stored default prompt for one workspace directory, or the global default. An entry declared in configuration ' +
        'cannot be deleted this way; the result reports whether one still applies.',
      parameters: { directory: { type: 'string', description: DIRECTORY_DESCRIPTION } },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            workspace: { type: 'string', required: true, description: 'The key that was targeted.' },
            removed: { type: 'boolean', required: true, description: 'Whether a stored entry was deleted.' },
            configured: {
              type: 'boolean',
              description: 'Whether configuration still supplies a prompt for this key after the removal.',
            },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: value.removed
              ? `Removed the stored default prompt for ${value.workspace}.${value.configured === true ? ' A prompt declared in configuration still applies.' : ''}`
              : value.configured === true
                ? `No stored prompt was set for ${value.workspace}; the prompt declared in configuration still applies.`
                : `No default prompt was configured for ${value.workspace}.`,
          },
        ],
      },
      async execute(args, exec) {
        const key = await resolveWorkspace(args.directory, sessionDirectory(exec.agent))
        const removed = await store.delete(key)
        return { workspace: key, removed, configured: Object.hasOwn(configured(), normalizePath(key)) }
      },
    }),
  )
}
