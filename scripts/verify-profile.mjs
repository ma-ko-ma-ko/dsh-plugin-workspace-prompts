/**
 * End-to-end verification against a real DSH profile.
 *
 * This works with the real application boot path rather than a test double:
 * it boots `$DSH_HOME/profiles/<profile>` through `runProfile`, resolves the
 * plugin from a profile row by bare package name, and then drives the live
 * context the way the harness does.
 *
 * It is not part of `npm test` because it needs a full harness runtime and a
 * profile that mounts the plugin. To run it:
 *
 *   1. In `$DSH_HOME/profiles/e2e/cordis.patch.yml`:
 *
 *        - insert:
 *            - id: system-prompt
 *              name: '@deepseek-ai/dsh-system-prompt'
 *            - id: tools
 *              name: '@deepseek-ai/dsh-tools'
 *            - id: workspace-prompts
 *              name: dsh-plugin-workspace-prompts
 *              config:
 *                file: ./workspace-prompts.json
 *                prompts:
 *                  '*': Deployment-wide default from configuration.
 *
 *   2. Run with the harness runtime on the module path:
 *
 *        DSH_HOME=... WSP_WORKSPACE=... WSP_PROFILE=e2e node scripts/verify-profile.mjs
 *
 * Exits non-zero when any check fails.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const home = process.env.DSH_HOME
const workspace = process.env.WSP_WORKSPACE
const profile = process.env.WSP_PROFILE ?? 'e2e'
if (!home) throw new Error('DSH_HOME must be set to the harness home that owns the profile')
if (!workspace) throw new Error('WSP_WORKSPACE must be set to an existing directory the plugin may write a prompt for')

const { runProfile } = await import('@deepseek-ai/dsh/profile-boot')
const { loadLayeredEnv } = await import('@deepseek-ai/dsh-app-boot')

const { ctx, shutdown } = await runProfile({
  environment: loadLayeredEnv('dsh'),
  profile,
  patchFiles: [],
  args: [],
})

const results = []
const check = (label, actual, expected) => {
  const ok = actual === expected
  results.push({ label, ok })
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        actual:   ${JSON.stringify(actual)}\n        expected: ${JSON.stringify(expected)}`),
  )
}

/** Read the section text the model would receive for one session directory. */
const sectionFor = async (cwd) => {
  const assembled = await ctx.systemPrompt.assemble({ agent: { session: { header: { cwd } } } })
  return assembled.sections.find((item) => item.name === 'workspace:default-prompt')?.text ?? ''
}

/** Call a registered tool exactly as the runtime would. */
const callTool = (name, args, cwd) => {
  const definition = ctx.tools.get(name)
  if (!definition) throw new Error(`tool ${name} is not registered`)
  return definition.execute(args, { agent: { session: { header: { cwd } } } })
}

console.log('rows in the live tree:')
for (const entry of ctx.loader.entries?.() ?? []) {
  console.log(`  - ${entry.options?.id ?? '(no id)'} <- ${entry.options?.name ?? ''}`)
}
console.log()

check('the plugin row mounted', (ctx.loader.entries?.() ?? []).some((e) => e.options?.id === 'workspace-prompts'), true)
check(
  'all four tools registered',
  ['workspace_prompt_list', 'workspace_prompt_get', 'workspace_prompt_set', 'workspace_prompt_remove'].every(
    (name) => ctx.tools.get(name) !== undefined,
  ),
  true,
)

const globalText = '# Workspace instructions (every workspace)\n\nDeployment-wide default from configuration.'
check('the configured global default reaches the model', await sectionFor(workspace), globalText)

const written = await callTool('workspace_prompt_set', { directory: workspace, prompt: 'Use the project lint config.', description: 'e2e' }, workspace)
console.log('\nworkspace_prompt_set ->', JSON.stringify(written), '\n')

check(
  'the newly written entry wins for its directory and below',
  await sectionFor(join(workspace, 'nested', 'deep')),
  `# Workspace instructions for \`${written.workspace}\` and its subdirectories\n\nUse the project lint config.`,
)

check(
  'workspace_prompt_get returns the stored text',
  (await callTool('workspace_prompt_get', { directory: workspace }, workspace)).prompt,
  'Use the project lint config.',
)

const listed = await callTool('workspace_prompt_list', {}, join(workspace, 'nested'))
check('the listing shows the stored and configured entries', listed.entries.length, 2)
check('the listing marks the active entry', listed.entries.find((e) => e.active)?.workspace, written.workspace)
check('the listing marks the stored entry editable', listed.entries.find((e) => e.source === 'file')?.removable, true)
check('the listing marks the configured entry read-only', listed.entries.find((e) => e.source === 'config')?.removable, false)

const document = JSON.parse(await readFile(join(home, 'profiles', profile, 'workspace-prompts.json'), 'utf8'))
check('the prompt was persisted beside the profile', document.prompts[written.workspace].prompt, 'Use the project lint config.')
check('the configured global default stays out of the file', document.prompts['*'], undefined)

const removed = await callTool('workspace_prompt_remove', { directory: workspace }, workspace)
check('workspace_prompt_remove reports the deletion', removed.removed, true)
check('the removal does not claim configuration supplied the key', removed.configured, false)
check('removing falls back to the global default', await sectionFor(workspace), globalText)

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)

await shutdown?.shutdown?.(0)
process.exit(failed.length === 0 ? 0 : 1)
