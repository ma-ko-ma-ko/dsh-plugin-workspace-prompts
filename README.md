# dsh-plugin-workspace-prompts

Per-workspace default system prompts for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Every workspace directory can carry its own standing instructions. Whenever a session runs inside that directory — or anywhere below it — the plugin injects those instructions into the system prompt automatically. Nothing is injected for a directory that has no prompt, so the feature costs nothing until you use it.

```text
F:\projects\api        → "Always regenerate the OpenAPI types after changing a route."
F:\projects\web        → "Use the design tokens in src/theme; never hard-code colours."
F:\scratch             → (no entry, no injection)
```

A prompt registered for `F:\projects\api` also covers `F:\projects\api\src\v2`; the most specific match wins, and `*` is the default for every workspace.

## Install

The plugin is a normal DSH profile plugin. From your harness home:

```bash
dsh plugin --profile <your-profile> add /path/to/dsh-plugin-workspace-prompts
```

Or from a Git checkout, which is what `pnpm` understands natively:

```bash
dsh plugin --profile <your-profile> add github:<you>/dsh-plugin-workspace-prompts
```

Then mount the row in the profile's own patch layer, `$DSH_HOME/profiles/<your-profile>/cordis.patch.yml`.

A patch entry targets an existing row by `id`, so a *new* plugin is added through an `insert` list:

```yaml
- insert:
    - id: workspace-prompts
      name: dsh-plugin-workspace-prompts
```

The profile reloads on a patch change when `dsh-hmr` is active; otherwise restart the app. Verify the row is live with `dsh --profile <your-profile> --dump-config`, which prints the composed tree.

The browser half is discovered from this package's own `dsh.client` declaration and `exports["./client"]`, so no second profile row is needed for it. It is assembled at startup, which means **one app restart is required after installing or updating the plugin**. Editing the store file, using the tools, or saving from the page never needs a restart.

## Configure

Every field is optional — the bare row above is a complete configuration.

```yaml
- insert:
    - id: workspace-prompts
      name: dsh-plugin-workspace-prompts
      config:
        file: ./workspace-prompts.json
        includeWorkspaceHeader: true
        sectionTitle: Workspace instructions
        order: 500
        registerTools: true
        maxPromptBytes: 32768
        prompts:
          '*': Standing instructions that apply to every workspace.
          'F:\projects\api': Instructions injected for sessions under that directory.
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Mount the prompt section, the tools, and the settings page. |
| `file` | `$DSH_HOME/workspace-prompts.json` | The store document. A relative path is anchored to the profile directory when the host supplies one, and to `$DSH_HOME` otherwise; `~` expands to your home. Use an absolute path when the location matters. |
| `dshHome` | `$DSH_HOME`, then `~/.dsh` | Harness-home override used to resolve the default `file`. |
| `prompts` | — | Deployment-supplied defaults, keyed by directory path or `*`. Takes precedence over the store file for the same key. |
| `includeWorkspaceHeader` | `true` | Prefix the injected text with a line naming the workspace it came from. |
| `sectionTitle` | `'Workspace instructions'` | Heading used by that line. |
| `order` | `500` | Where the section sorts. The harness identity is `-1000` and the deployment persona prefix is `0`; `500` puts workspace rules after both and before the harness's own reusable instructions. |
| `registerTools` | `true` | Register the `workspace_prompt_*` tools. Turn off for a locked-down deployment that manages prompts by hand. |
| `registerHttp` | `true` | Register the settings page's JSON route when the profile composes the host web server. |
| `maxPromptBytes` | `32768` | Reject a prompt larger than this, in bytes, so one workspace cannot flood the prompt. |

### The store file

Prompts written through the tools land in one document you can read and hand-edit:

```json
{
  "version": 1,
  "prompts": {
    "f:/projects/api": {
      "prompt": "Always regenerate the OpenAPI types after changing a route.",
      "description": "api repo",
      "updatedAt": "2026-10-05T07:00:54.748Z"
    },
    "*": { "prompt": "Prefer the repo's own scripts over ad-hoc commands." }
  }
}
```

Keys are normalized: separators collapse to `/`, trailing separators drop, `.` and `..` fold, and Windows paths compare case-insensitively. A bare string is also accepted as shorthand for `{ "prompt": "..." }`.

A malformed document is reported at startup and then ignored rather than failing every turn — repair or delete the file and restart. An edit made while the harness is running is picked up by the next write instead of being overwritten.

## Settings page

The plugin ships a browser half, so prompts can be managed from the GUI instead of from configuration files. Open **Settings → Workspace prompts**:

- the left column lists every entry, marking the one that governs the current workspace and naming its source (`stored here` vs `from configuration`);
- the right column shows the prompt that currently applies — including one inherited from an ancestor directory — and edits the selected entry;
- **Add a default for every workspace** creates the `*` entry, **Add a prompt for this workspace** starts a new directory entry;
- entries declared in configuration are shown read-only, because they belong to the profile, not to the store.

The page talks to one JSON route on the host web server, `GET`/`PUT`/`DELETE /api/workspace-prompts`. That route exists only when the profile composes `@deepseek-ai/dsh-host-webserver` (the Web GUI does; a headless profile does not, and the plugin then has no HTTP face). Requests are refused unless they are loopback-local and same-origin, and the route can be turned off entirely with `registerHttp: false`.

Nothing in the page is required: the tools and the store file remain the whole feature, and the page is only another way to reach the same data.

## Tools

When `registerTools` is on, the model can maintain prompts on your behalf.

| Tool | What it does |
|---|---|
| `workspace_prompt_set` | Create or replace the prompt for a directory. Omit `directory` for the session's own workspace; pass `*` for every workspace. |
| `workspace_prompt_get` | Show the prompt governing a directory, reporting an inherited ancestor when the directory has none of its own. |
| `workspace_prompt_list` | List every entry — stored and configuration-declared — and mark the one that currently applies to this session. |
| `workspace_prompt_remove` | Delete one stored entry. A prompt declared in configuration is reported rather than deleted. |

Asking the model "always answer in Chinese in this project" and letting it call `workspace_prompt_set` is the intended flow.

## How it works

The plugin registers one contribution on `ctx.systemPrompt` and evaluates its text once per assembly, reading `agent.session.header.cwd`. That is why a changed working directory — or a `workspace_prompt_set` call — takes effect on the very next model step rather than only in a new session.

The section is contributed with `interpolate: false`, so `{{...}}` in your prose is delivered literally instead of being read as a prompt-variable reference. A prompt containing braces cannot break assembly.

If several entries could apply, resolution is specificity-first: the directory itself, then its nearest configured ancestor, then `*`. A `config.prompts` entry only breaks a tie, so a deployment's declared default wins for the exact directory it names while a store-file entry for a more specific directory still applies.

The plugin declares `inject: ['systemPrompt', 'tools']`, so a profile that omits either service leaves the row unloaded rather than failing at boot.

## Compatibility

Built and verified against DSH `0.2.0-rc.2` / `@deepseek-ai/cordis` `4.0.4`, Node 20+.

The package is ESM JavaScript with JSDoc types and ships no build step, so it can be installed straight from a Git checkout.

## Development

```bash
npm install     # or pnpm install
npm test
```

The suite has three layers:

- **Unit tests** (`paths`, `store`, `config`, `resolve`) cover path normalization, entry precedence, durable storage, and budget handling. They run anywhere.
- **Integration tests** (`test/integration.test.js`) boot the real Cordis runtime with the real system-prompt and tool registries and assert what the model would actually receive. They skip themselves when the `@deepseek-ai/*` packages cannot be resolved, so a bare clone still passes.
- **Profile verification** (`scripts/verify-profile.mjs`) boots a real DSH profile through the real loader, mounts the plugin as an ordinary profile row by bare package name, and drives every tool against the live context. It needs a full harness runtime and a profile that mounts the plugin; the file header documents the exact setup.

```bash
DSH_HOME=/path/to/home WSP_WORKSPACE=/path/to/workspace node scripts/verify-profile.mjs
```

The plugin has been verified through all three layers on Windows against DSH `0.2.0-rc.2`.

## License

MIT
