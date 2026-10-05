/**
 * Integration tests against the real Cordis runtime, the real system-prompt
 * registry and the real tool registry.
 *
 * These load the plugin exactly as a profile does, then assert what the model
 * would actually receive. They need the `@deepseek-ai/*` packages resolvable
 * from this package; when they are not (a bare clone without an install), the
 * whole file is skipped rather than failing.
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { normalizePath } from '../lib/paths.js'

let Context
let SystemPrompt
let ToolRuntime
try {
  ;({ Context } = await import('@deepseek-ai/cordis'))
  ;({ default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt'))
  ;({ default: ToolRuntime } = await import('@deepseek-ai/dsh-tools'))
} catch {
  Context = undefined
}

const skip = Context === undefined ? 'requires an installed @deepseek-ai/dsh runtime' : false

const plugin = skip ? undefined : await import('../lib/index.js')

/**
 * Boot a real context with the prompt and tool registries, then mount the plugin.
 * @param {object} options - the test's plugin configuration.
 * @param {string} options.file - the store document path.
 * @param {object} [options.config] - extra plugin configuration.
 * @returns {Promise<{ctx: object, dispose: () => Promise<void>}>} the live context.
 */
async function boot({ file, config = {} }) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(plugin, { file, ...config })
  return { ctx, dispose: () => ctx.fiber.dispose() }
}

/**
 * Assemble the prompt for a session running in one directory.
 * @param {object} ctx - the live context.
 * @param {string} cwd - the session working directory.
 * @returns {Promise<{prompt: string, sections: object[]}>} the rendered prompt.
 */
async function assembleFor(ctx, cwd) {
  const assembly = await ctx.systemPrompt.assemble({ agent: { session: { header: { cwd } } } })
  const rendered = assembly.sections
    .map((section) => (section.interpolate === false ? section.text : section.text))
    .filter((text) => text.length > 0)
    .join('\n\n')
  return { prompt: rendered, sections: assembly.sections }
}

/**
 * Invoke one registered tool the way the runtime would.
 * @param {object} ctx - the live context.
 * @param {string} name - the tool name.
 * @param {object} args - the arguments.
 * @param {string} cwd - the owning session's working directory.
 * @returns {Promise<unknown>} the tool result.
 */
async function callTool(ctx, name, args, cwd) {
  const definition = ctx.tools.get(name)
  assert.ok(definition, `tool ${name} should be registered`)
  return definition.execute(args, { agent: { session: { header: { cwd } } } })
}

/** Create an isolated scratch directory. */
async function scratch(t) {
  const directory = await mkdtemp(join(tmpdir(), 'wsp-int-'))
  t.after(async () => {
    const { rm } = await import('node:fs/promises')
    await rm(directory, { recursive: true, force: true })
  })
  return directory
}

/**
 * Wait until the plugin's mount-time document read has settled.
 *
 * Prompt assembly itself is synchronous, so a section cannot await the read;
 * the tests that mount against an existing file therefore wait the same way a
 * real session does between its first and second turn.
 * @param {object} ctx - the live context.
 * @param {string} cwd - any directory, used to drive one assembly.
 */
async function waitForLoad(ctx, cwd) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await ctx.systemPrompt.assemble({ agent: { session: { header: { cwd } } } })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const { prompt } = await assembleFor(ctx, cwd)
    if (prompt.length > 0) return
  }
}

test('the plugin mounts with the real registries', { skip }, async (t) => {
  const directory = await scratch(t)
  const { ctx, dispose } = await boot({ file: join(directory, 'prompts.json') })
  t.after(dispose)

  assert.ok(ctx.systemPrompt)
  assert.equal(typeof ctx.tools.get('workspace_prompt_set')?.execute, 'function')
})

test('a session with no configured prompt contributes no section', { skip }, async (t) => {
  const directory = await scratch(t)
  const { ctx, dispose } = await boot({ file: join(directory, 'prompts.json') })
  t.after(dispose)

  const { prompt } = await assembleFor(ctx, '/anywhere/at/all')
  assert.equal(prompt.includes('Workspace instructions'), false)
})

test('a stored prompt reaches the assembled system prompt', { skip }, async (t) => {
  const directory = await scratch(t)
  const workspace = join(directory, 'project')
  const { ctx, dispose } = await boot({ file: join(directory, 'prompts.json') })
  t.after(dispose)

  await callTool(ctx, 'workspace_prompt_set', { directory: workspace, prompt: 'Always run the linter.' }, directory)

  const { prompt, sections } = await assembleFor(ctx, join(workspace, 'src'))
  assert.match(prompt, /Always run the linter\./)
  assert.equal(sections.some((section) => section.name === plugin.SECTION_NAME), true)
})

test('the section sits between the harness identity and the rest of the prompt', { skip }, async (t) => {
  const directory = await scratch(t)
  const workspace = join(directory, 'project')
  const { ctx, dispose } = await boot({ file: join(directory, 'prompts.json') })
  t.after(dispose)

  await callTool(ctx, 'workspace_prompt_set', { directory: workspace, prompt: 'Project rule.' }, directory)
  const { sections } = await assembleFor(ctx, workspace)
  const names = sections.map((section) => section.name)

  assert.equal(names[0], 'harness:identity')
  assert.ok(names.indexOf(plugin.SECTION_NAME) > 0)
})

test('a parent workspace prompt is inherited by a nested session', { skip }, async (t) => {
  const directory = await scratch(t)
  const workspace = join(directory, 'mono')
  const { ctx, dispose } = await boot({ file: join(directory, 'prompts.json') })
  t.after(dispose)

  await callTool(ctx, 'workspace_prompt_set', { directory: workspace, prompt: 'Monorepo rules.' }, directory)
  const { prompt } = await assembleFor(ctx, join(workspace, 'packages', 'app'))
  assert.match(prompt, /Monorepo rules\./)
  assert.match(prompt, /and its subdirectories/)
})

test('setting a prompt persists it, and a fresh context picks it up', { skip }, async (t) => {
  const directory = await scratch(t)
  const file = join(directory, 'prompts.json')
  const workspace = join(directory, 'project')

  const first = await boot({ file })
  await callTool(first.ctx, 'workspace_prompt_set', { directory: workspace, prompt: 'Persisted rule.' }, directory)
  await first.dispose()

  const document = JSON.parse(await readFile(file, 'utf8'))
  const keys = Object.keys(document.prompts)
  assert.equal(keys.length, 1)
  // The key is the directory's absolute path; whether it is fully resolved
  // depends on whether the directory already existed when it was written.
  assert.equal(keys[0], normalizePath(workspace))
  assert.equal(document.prompts[keys[0]].prompt, 'Persisted rule.')

  const second = await boot({ file })
  t.after(second.dispose)
  await waitForLoad(second.ctx, workspace)
  const { prompt } = await assembleFor(second.ctx, workspace)
  assert.match(prompt, /Persisted rule\./)
})

test('a configured default applies without any store file', { skip }, async (t) => {
  const directory = await scratch(t)
  const workspace = join(directory, 'project')
  const { ctx, dispose } = await boot({
    file: join(directory, 'absent.json'),
    config: { prompts: { '*': 'Deployment-wide rule.' } },
  })
  t.after(dispose)

  const { prompt } = await assembleFor(ctx, workspace)
  assert.match(prompt, /Deployment-wide rule\./)
  assert.match(prompt, /every workspace/)
})

test('a configured entry outranks a stored entry for the same directory', { skip }, async (t) => {
  const directory = await scratch(t)
  const file = join(directory, 'prompts.json')
  const workspace = join(directory, 'project')
  await writeFile(
    file,
    JSON.stringify({ version: 1, prompts: { [workspace.replaceAll('\\', '/')]: { prompt: 'From the file.' } } }),
    'utf8',
  )

  const { ctx, dispose } = await boot({ file, config: { prompts: { [workspace]: 'From the config.' } } })
  t.after(dispose)
  await waitForLoad(ctx, workspace)

  const { prompt } = await assembleFor(ctx, workspace)
  assert.match(prompt, /From the config\./)
  assert.equal(prompt.includes('From the file.'), false)
})

test('includeWorkspaceHeader: false contributes the bare text', { skip }, async (t) => {
  const directory = await scratch(t)
  const file = join(directory, 'prompts.json')
  const workspace = join(directory, 'project')
  const { ctx, dispose } = await boot({ file, config: { includeWorkspaceHeader: false } })
  t.after(dispose)

  await callTool(ctx, 'workspace_prompt_set', { directory: workspace, prompt: 'Bare rule.' }, directory)
  const { prompt } = await assembleFor(ctx, workspace)
  assert.equal(prompt.includes('# Workspace instructions'), false)
  assert.equal(prompt.includes('Bare rule.'), true)
})

test('literal braces in a prompt do not break assembly', { skip }, async (t) => {
  const directory = await scratch(t)
  const workspace = join(directory, 'project')
  const { ctx, dispose } = await boot({ file: join(directory, 'prompts.json') })
  t.after(dispose)

  await callTool(
    ctx,
    'workspace_prompt_set',
    { directory: workspace, prompt: 'Use {{braces}} and {{nested}} literally.' },
    directory,
  )
  const { prompt } = await assembleFor(ctx, workspace)
  assert.match(prompt, /Use \{\{braces\}\} and \{\{nested\}\} literally\./)
})

test('the listing reports the active prompt for this session', { skip }, async (t) => {
  const directory = await scratch(t)
  const workspace = join(directory, 'project')
  const { ctx, dispose } = await boot({ file: join(directory, 'prompts.json') })
  t.after(dispose)

  await callTool(ctx, 'workspace_prompt_set', { directory: workspace, prompt: 'Rule.', description: 'the project' }, directory)
  const listed = await callTool(ctx, 'workspace_prompt_list', {}, join(workspace, 'src'))

  assert.equal(listed.entries.length, 1)
  assert.equal(listed.entries[0].description, 'the project')
  assert.equal(listed.entries[0].source, 'file')
  assert.equal(listed.entries[0].removable, true)
  assert.equal(listed.entries[0].active, true)
})

test('the listing includes configured entries and marks them non-removable', { skip }, async (t) => {
  const directory = await scratch(t)
  const workspace = join(directory, 'project')
  const { ctx, dispose } = await boot({
    file: join(directory, 'prompts.json'),
    config: { prompts: { '*': 'Deployment default.' } },
  })
  t.after(dispose)

  await callTool(ctx, 'workspace_prompt_set', { directory: workspace, prompt: 'Project rule.' }, workspace)
  const listed = await callTool(ctx, 'workspace_prompt_list', {}, workspace)

  assert.equal(listed.entries.length, 2)
  const fromConfig = listed.entries.find((entry) => entry.source === 'config')
  const fromFile = listed.entries.find((entry) => entry.source === 'file')
  assert.equal(fromConfig.removable, false)
  assert.equal(fromFile.removable, true)
  assert.equal(fromFile.active, true)
})

test('removing reports whether configuration still supplies the key', { skip }, async (t) => {
  const directory = await scratch(t)
  const workspace = join(directory, 'project')
  const { ctx, dispose } = await boot({ file: join(directory, 'prompts.json') })
  t.after(dispose)

  await callTool(ctx, 'workspace_prompt_set', { directory: workspace, prompt: 'Stored rule.' }, workspace)
  const removed = await callTool(ctx, 'workspace_prompt_remove', { directory: workspace }, workspace)
  assert.equal(removed.removed, true)
  assert.equal(removed.configured, false)

  const absent = await callTool(ctx, 'workspace_prompt_remove', { directory: workspace }, workspace)
  assert.equal(absent.removed, false)
})

test('remove deletes only the named entry', { skip }, async (t) => {
  const directory = await scratch(t)
  const workspace = join(directory, 'project')
  const { ctx, dispose } = await boot({ file: join(directory, 'prompts.json') })
  t.after(dispose)

  await callTool(ctx, 'workspace_prompt_set', { directory: workspace, prompt: 'Rule.' }, directory)
  await callTool(ctx, 'workspace_prompt_set', { directory: '*', prompt: 'Global rule.' }, directory)

  assert.equal((await callTool(ctx, 'workspace_prompt_list', {}, directory)).entries.length, 2)

  const removed = await callTool(ctx, 'workspace_prompt_remove', { directory: workspace }, directory)
  assert.equal(removed.removed, true)

  const remaining = await callTool(ctx, 'workspace_prompt_list', {}, directory)
  assert.equal(remaining.entries.length, 1)
  assert.equal(remaining.entries[0].workspace, '*')

  const after = await assembleFor(ctx, workspace)
  assert.match(after.prompt, /Global rule\./)
  assert.equal(after.prompt.includes('# Workspace instructions for'), false)
})

test('an omitted directory targets the calling session workspace', { skip }, async (t) => {
  const directory = await scratch(t)
  const workspace = join(directory, 'project')
  const { ctx, dispose } = await boot({ file: join(directory, 'prompts.json') })
  t.after(dispose)

  const written = await callTool(ctx, 'workspace_prompt_set', { prompt: 'Session rule.' }, workspace)
  assert.equal(written.workspace, normalizePath(workspace))

  const listed = await callTool(ctx, 'workspace_prompt_list', {}, workspace)
  assert.equal(listed.entries[0].workspace, normalizePath(workspace))
  assert.equal(listed.entries[0].active, true)
})

test('set rejects an empty prompt and an over-budget one', { skip }, async (t) => {
  const directory = await scratch(t)
  const { ctx, dispose } = await boot({ file: join(directory, 'prompts.json'), config: { maxPromptBytes: 16 } })
  t.after(dispose)

  await assert.rejects(() => callTool(ctx, 'workspace_prompt_set', { prompt: '   ' }, directory), /must not be empty/)
  await assert.rejects(
    () => callTool(ctx, 'workspace_prompt_set', { prompt: 'x'.repeat(17) }, directory),
    /exceeds the configured maxPromptBytes/,
  )
})

test('registerTools: false mounts the section without the tools', { skip }, async (t) => {
  const directory = await scratch(t)
  const workspace = join(directory, 'project')
  const { ctx, dispose } = await boot({
    file: join(directory, 'prompts.json'),
    config: { registerTools: false, prompts: { [workspace]: 'Section only.' } },
  })
  t.after(dispose)

  assert.equal(ctx.tools.get('workspace_prompt_set'), undefined)
  const { prompt } = await assembleFor(ctx, workspace)
  assert.match(prompt, /Section only\./)
})

test('enabled: false mounts nothing', { skip }, async (t) => {
  const directory = await scratch(t)
  const { ctx, dispose } = await boot({
    file: join(directory, 'prompts.json'),
    config: { enabled: false, prompts: { '*': 'Never rendered.' } },
  })
  t.after(dispose)

  assert.equal(ctx.tools.get('workspace_prompt_set'), undefined)
  assert.equal(ctx.systemPrompt.getSectionOrder(plugin.SECTION_NAME), undefined)
  const { prompt } = await assembleFor(ctx, '/anywhere')
  assert.equal(prompt.includes('Never rendered.'), false)
})

test('a malformed store file is reported without failing the turn', { skip }, async (t) => {
  const directory = await scratch(t)
  const file = join(directory, 'prompts.json')
  await writeFile(file, '{ broken', 'utf8')

  const { ctx, dispose } = await boot({ file })
  t.after(dispose)
  await new Promise((resolve) => setTimeout(resolve, 50))

  const { prompt } = await assembleFor(ctx, '/anywhere')
  assert.equal(prompt.includes('Workspace instructions'), false)
  // The mount-time read failed, but the tools still work and can repair it.
  const definition = ctx.tools.get('workspace_prompt_set')
  assert.equal(typeof definition.execute, 'function')
})
