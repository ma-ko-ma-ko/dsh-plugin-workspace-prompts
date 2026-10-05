/**
 * Workspace prompts settings page (browser half).
 *
 * This bundle is loaded by the harness client module system from
 * `exports["./client"]`, so it must be plain JavaScript: it talks to React
 * through `createElement` rather than JSX, which is what lets the package ship
 * with no build step. Shared modules (`react`,
 * `@deepseek-ai/dsh-client-ui-slots`) are declared in `dsh.client.external` and
 * resolved by the module system.
 *
 * @module dsh-plugin-workspace-prompts/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-workspace-prompts',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const react = require('react')
    const slots = require('@deepseek-ai/dsh-client-ui-slots')

    const h = react.createElement

    /** The host route this page reads and writes. */
    const ENDPOINT = '/api/workspace-prompts'

    /** Reserved key for the prompt that applies to every workspace. */
    const GLOBAL_KEY = '*'

    /** Section id, which is also the Settings navigation id. */
    const SECTION_ID = 'workspace-prompts'

    /** Dictionary namespace owned by this page. */
    const NS = 'workspacePrompts'

    /** English copy. */
    const en = {
      nav: 'Workspace prompts',
      title: 'Workspace prompts',
      intro:
        'A default prompt is injected into the system prompt of every session that works in its directory or below it. Configured entries come from the profile and cannot be edited here.',
      loading: 'Loading…',
      failed: 'Could not reach the workspace-prompts service.',
      retry: 'Retry',
      empty: 'No prompts yet. Add one on the right.',
      noDefault: 'No prompt applies here.',
      global: 'Every workspace',
      directory: 'Directory',
      fromConfig: 'from configuration',
      storedLocally: 'stored here',
      active: 'active here',
      activeInherited: 'Inherited from',
      editorTitleNew: 'Add a prompt',
      editorTitleEdit: 'Edit prompt',
      directoryLabel: 'Workspace directory',
      directoryHint: 'Leave empty to use this profile\'s own workspace. Use * for every workspace.',
      descriptionLabel: 'Label (optional)',
      descriptionPlaceholder: 'Shown in this list only',
      promptLabel: 'Prompt',
      promptPlaceholder: 'For example: answer in Chinese; read a file before changing it.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved.',
      remove: 'Delete',
      cancel: 'Cancel',
      addGlobal: 'Add a default for every workspace',
      addCurrent: 'Add a prompt for this profile\'s workspace',
      characters: 'characters',
      storeFile: 'Stored in',
      profileWorkspace: 'This profile\'s workspace is',
      readOnlyNote: 'This entry is declared in the profile configuration and cannot be deleted here.',
      crashed: 'The workspace-prompts page failed to render.',
    }

    /** Simplified Chinese copy. */
    const zh = {
      nav: '工作区提示词',
      title: '工作区提示词',
      intro:
        '默认提示词会自动注入到在该目录及其子目录中工作的每个会话。来自配置文件条目的提示词不能在这里编辑。',
      loading: '加载中…',
      failed: '无法连接工作区提示词服务。',
      retry: '重试',
      empty: '还没有提示词，在右侧添加。',
      noDefault: '此处没有生效的提示词。',
      global: '所有工作区',
      directory: '目录',
      fromConfig: '来自配置',
      storedLocally: '本地保存',
      active: '此处生效',
      activeInherited: '继承自',
      editorTitleNew: '添加提示词',
      editorTitleEdit: '编辑提示词',
      directoryLabel: '工作区目录',
      directoryHint: '留空表示使用本 profile 自己的工作区；填 * 表示所有工作区。',
      descriptionLabel: '标签（可选）',
      descriptionPlaceholder: '只在这个列表里显示',
      promptLabel: '提示词',
      promptPlaceholder: '例如：所有回答用中文；改代码前先读文件。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存。',
      remove: '删除',
      cancel: '取消',
      addGlobal: '添加所有工作区的默认提示词',
      addCurrent: '为本 profile 的工作区添加提示词',
      characters: '字符',
      storeFile: '保存位置',
      profileWorkspace: '本 profile 的工作区是',
      crashed: '工作区提示词页面渲染失败。',
      readOnlyNote: '该条目来自 profile 配置，不能在这里删除。',
    }

    /** Inject one stylesheet once per page. */
    function installStyles() {
      const tagId = `${SECTION_ID}/settings.css`
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-plugin-workspace-prompts'
      tag.dataset.pluginCss = tagId
      tag.textContent = `
.wsp-root{display:flex;flex-direction:column;gap:14px;max-width:980px;color:var(--dsw-alias-label-primary)}
.wsp-head{display:flex;flex-direction:column;gap:6px}
.wsp-title{margin:0;font-size:18px;font-weight:600}
.wsp-intro{margin:0;font-size:13px;color:var(--dsw-alias-label-tertiary)}
.wsp-body{display:flex;gap:18px;align-items:flex-start}
.wsp-list{flex:0 0 320px;min-width:0;display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.wsp-row{display:flex;flex-direction:column;gap:3px;text-align:left;font:inherit;cursor:pointer;padding:8px 10px;border-radius:6px;border:1px solid transparent;background:var(--dsw-alias-bg-l2,transparent);color:inherit;width:100%}
.wsp-row:hover{background:var(--dsw-alias-bg-l3,var(--dsw-alias-bg-l2))}
.wsp-row[data-selected=true]{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-l3,var(--dsw-alias-bg-l2))}
.wsp-row[data-active=true]{border-left:3px solid var(--dsw-alias-state-business-primary)}
.wsp-rowPath{font-size:13px;word-break:break-all}
.wsp-rowMeta{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.wsp-editor{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:10px}
.wsp-field{display:flex;flex-direction:column;gap:4px}
.wsp-label{font-size:12px;font-weight:600}
.wsp-hint{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.wsp-input,.wsp-textarea{font:inherit;font-size:13px;color:inherit;background:var(--dsw-alias-bg-l1,transparent);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:7px 9px;width:100%;box-sizing:border-box}
.wsp-textarea{min-height:190px;resize:vertical;font-family:inherit;line-height:1.5}
.wsp-input:focus-visible,.wsp-textarea:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.wsp-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.wsp-action{font:inherit;font-size:13px;cursor:pointer;border-radius:6px;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-l2,transparent);color:inherit}
.wsp-action:hover:not(:disabled){background:var(--dsw-alias-bg-l3,var(--dsw-alias-bg-l2))}
.wsp-action:disabled{opacity:.5;cursor:default}
.wsp-action[data-primary=true]{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:var(--dsw-alias-label-inverse,#fff)}
.wsp-action[data-danger=true]{color:var(--dsw-alias-state-error-primary,inherit)}
.wsp-note{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.wsp-error{font-size:12px;color:var(--dsw-alias-state-error-primary,inherit)}
.wsp-preview{font-size:12px;white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-l2,transparent);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:8px 10px;max-height:150px;overflow:auto;margin:0}
.wsp-quick{display:flex;gap:8px;flex-wrap:wrap}
`
      document.head.appendChild(tag)
    }

    /**
     * Call the host route.
     * @param {string} method - the HTTP method.
     * @param {object} [body] - the JSON body, when the method takes one.
     * @param {string} [query] - an optional query string.
     * @returns {Promise<object>} the parsed response.
     */
    async function call(method, body, query) {
      const url = query === undefined ? ENDPOINT : `${ENDPOINT}?${query}`
      const init = { method, headers: { accept: 'application/json' } }
      if (body !== undefined) {
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      const response = await fetch(url, init)
      const text = await response.text()
      let payload
      try {
        payload = text.length === 0 ? {} : JSON.parse(text)
      } catch {
        throw new Error(`the reply was not JSON (status ${response.status})`)
      }
      if (!response.ok) throw new Error(payload.error ?? `request failed with status ${response.status}`)
      return payload
    }

    /** Render one entry's directory for display. */
    function displayDirectory(key, t) {
      return key === GLOBAL_KEY ? t('global') : key
    }

    /**
     * Error boundary around the section body.
     *
     * React only recognizes `getDerivedStateFromError` on a class, and the
     * slots system has no boundary of its own, so a render that throws would
     * otherwise take the whole settings surface down. This keeps a fault in
     * this one page from becoming a fault in the panel.
     *
     * The base class falls back to a bare class when the module table's React
     * face exposes no `Component`: a plain class still carries the boundary
     * methods, so the page degrades to the fallback path instead of failing to
     * load at all.
     */
    const ComponentBase = typeof react.Component === 'function' ? react.Component : class {}

    class WorkspacePromptsBoundary extends ComponentBase {
      /**
       * @param {object} props - slot props, forwarded to the body.
       */
      constructor(props) {
        super(props)
        this.state = { failure: null }
      }

      /**
       * Enter the fallback state for a render error.
       * @param {unknown} failure - the thrown value.
       * @returns {object} the next state.
       */
      static getDerivedStateFromError(failure) {
        return { failure }
      }

      /**
       * Report the error once React has committed the fallback.
       * @param {unknown} failure - the thrown value.
       */
      componentDidCatch(failure) {
        if (typeof console !== 'undefined' && typeof console.error === 'function') {
          console.error('workspace-prompts: settings section failed to render', failure)
        }
      }

      /** @returns {object} either the section or its failure notice. */
      render() {
        if (this.state.failure !== null && this.state.failure !== undefined) {
          const t = typeof this.props.t === 'function' ? this.props.t : (key) => key
          const failure = this.state.failure
          const message = failure instanceof Error ? failure.message : String(failure)
          return h(
            'div',
            { className: 'wsp-root' },
            h('h2', { className: 'wsp-title' }, t('title')),
            h('p', { className: 'wsp-error' }, `${t('crashed')} ${message}`),
            h('pre', { className: 'wsp-preview' }, failure instanceof Error ? String(failure.stack ?? message) : message),
          )
        }
        return h(WorkspacePromptsSection, this.props)
      }
    }

    /**
     * The Workspace prompts settings section.
     * @param {object} props - slot props supplied by the settings host.
     * @returns {object} the rendered element tree.
     */
    function WorkspacePromptsSection(props) {
      const t = props.t
      const [view, setView] = react.useState(null)
      const [error, setError] = react.useState(null)
      const [busy, setBusy] = react.useState(false)
      const [notice, setNotice] = react.useState(null)
      const [directory, setDirectory] = react.useState('')
      const [prompt, setPrompt] = react.useState('')
      const [description, setDescription] = react.useState('')
      const [editing, setEditing] = react.useState(null)

      const load = react.useCallback(
        async (target) => {
          setError(null)
          try {
            const query = target === undefined || target === '' ? undefined : `directory=${encodeURIComponent(target)}`
            setView(await call('GET', undefined, query))
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure))
          }
        },
        [],
      )

      react.useEffect(() => {
        installStyles()
        load()
      }, [load])

      const startNew = (initialDirectory) => {
        setEditing(null)
        setDirectory(initialDirectory)
        setDescription('')
        setPrompt('')
        setNotice(null)
      }

      const startEdit = (entry) => {
        setEditing(entry.directory)
        setDirectory(entry.directory)
        setDescription(entry.description ?? '')
        setPrompt('')
        setNotice(null)
        setError(null)
        if (!entry.editable) return
        if (entry.directory === GLOBAL_KEY) {
          // `directory=*` is deliberately not a valid lookup query (it would
          // resolve as a path), so the global text comes from the active view
          // when the global entry is the one governing the current workspace.
          if (view !== null && view.active !== undefined && view.active.key === GLOBAL_KEY) setPrompt(view.active.prompt)
          return
        }
        // The listing carries no prompt text, so read this one entry by asking
        // for the directory it governs.
        call('GET', undefined, `directory=${encodeURIComponent(entry.directory)}`)
          .then((single) => {
            if (single.active !== undefined && single.active.key === entry.directory) setPrompt(single.active.prompt)
          })
          .catch((failure) => setError(failure instanceof Error ? failure.message : String(failure)))
      }

      const save = async () => {
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
          const result = await call('PUT', {
            directory: directory.trim() === '' ? undefined : directory.trim(),
            prompt,
            ...(description.trim() === '' ? {} : { description: description.trim() }),
          })
          setView(result.view)
          setEditing(result.saved.directory)
          setNotice(t('saved'))
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy(false)
        }
      }

      const remove = async () => {
        if (editing === null) return
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
          const result = await call('DELETE', undefined, `directory=${encodeURIComponent(editing)}`)
          setView(result.view)
          startNew('')
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy(false)
        }
      }

      if (view === null && error === null) {
        return h('div', { className: 'wsp-root' }, h('p', { className: 'wsp-note' }, t('loading')))
      }

      const activeKey = view !== null && view.active !== undefined ? view.active.key : null
      const editingRow = view !== null && editing !== null ? view.entries.find((row) => row.directory === editing) : undefined
      const editable = editingRow === undefined || editingRow.editable

      return h(
        'div',
        { className: 'wsp-root' },
        h(
          'div',
          { className: 'wsp-head' },
          h('h2', { className: 'wsp-title' }, t('title')),
          h('p', { className: 'wsp-intro' }, t('intro')),
        ),
        error !== null
          ? h(
              'div',
              { className: 'wsp-actions' },
              h('span', { className: 'wsp-error' }, `${t('failed')} ${error}`),
              h('button', { type: 'button', className: 'wsp-action', onClick: () => load(directory) }, t('retry')),
            )
          : null,
        h(
          'div',
          { className: 'wsp-body' },
          h(
            'div',
            null,
            view !== null && view.entries.length === 0
              ? h('p', { className: 'wsp-note' }, t('empty'))
              : h(
                  'ul',
                  { className: 'wsp-list' },
                  (view === null ? [] : view.entries).map((entry) =>
                    h(
                      'li',
                      { key: `${entry.source}:${entry.directory}` },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'wsp-row',
                          'data-selected': editing === entry.directory,
                          'data-active': activeKey === entry.directory,
                          onClick: () => startEdit(entry),
                        },
                        h('span', { className: 'wsp-rowPath' }, displayDirectory(entry.directory, t)),
                        h(
                          'span',
                          { className: 'wsp-rowMeta' },
                          [
                            entry.scope === 'global' ? t('global') : t('directory'),
                            entry.editable ? t('storedLocally') : t('fromConfig'),
                            `${entry.characters} ${t('characters')}`,
                            activeKey === entry.directory ? t('active') : null,
                          ]
                            .filter((part) => part !== null)
                            .join(' · '),
                        ),
                      ),
                    ),
                  ),
                ),
            h(
              'div',
              { className: 'wsp-quick', style: { marginTop: '10px' } },
              h('button', { type: 'button', className: 'wsp-action', onClick: () => startNew(GLOBAL_KEY) }, t('addGlobal')),
              // An empty directory is what the host resolves to this profile's
              // own workspace, so the button fills in nothing rather than
              // guessing a path this page cannot know.
              h('button', { type: 'button', className: 'wsp-action', onClick: () => startNew('') }, t('addCurrent')),
            ),
          ),
          h(
            'div',
            { className: 'wsp-editor' },
            view !== null && view.active !== undefined
              ? h(
                  'div',
                  { className: 'wsp-field' },
                  h(
                    'span',
                    { className: 'wsp-label' },
                    `${t('activeInherited')} ${displayDirectory(view.active.key, t)} (${view.active.matchedBy})`,
                  ),
                  h('pre', { className: 'wsp-preview' }, view.active.prompt),
                )
              : h('p', { className: 'wsp-note' }, view !== null && view.active === undefined ? t('noDefault') : ''),
            h('h3', { className: 'wsp-title', style: { fontSize: '15px' } }, editing === null ? t('editorTitleNew') : t('editorTitleEdit')),
            h(
              'div',
              { className: 'wsp-field' },
              h('label', { className: 'wsp-label', htmlFor: 'wsp-directory' }, t('directoryLabel')),
              h('input', {
                id: 'wsp-directory',
                className: 'wsp-input',
                value: directory,
                placeholder: GLOBAL_KEY,
                disabled: !editable,
                onChange: (event) => setDirectory(event.target.value),
              }),
              h(
                'span',
                { className: 'wsp-hint' },
                `${t('directoryHint')}${
                  view !== null && view.defaultDirectory !== undefined ? ` ${t('profileWorkspace')} ${view.defaultDirectory}` : ''
                }`,
              ),
            ),
            h(
              'div',
              { className: 'wsp-field' },
              h('label', { className: 'wsp-label', htmlFor: 'wsp-description' }, t('descriptionLabel')),
              h('input', {
                id: 'wsp-description',
                className: 'wsp-input',
                value: description,
                placeholder: t('descriptionPlaceholder'),
                disabled: !editable,
                onChange: (event) => setDescription(event.target.value),
              }),
            ),
            h(
              'div',
              { className: 'wsp-field' },
              h('label', { className: 'wsp-label', htmlFor: 'wsp-prompt' }, t('promptLabel')),
              h('textarea', {
                id: 'wsp-prompt',
                className: 'wsp-textarea',
                value: prompt,
                placeholder: t('promptPlaceholder'),
                disabled: !editable,
                onChange: (event) => setPrompt(event.target.value),
              }),
            ),
            h(
              'div',
              { className: 'wsp-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'wsp-action',
                  'data-primary': 'true',
                  disabled: busy || !editable || prompt.trim() === '',
                  onClick: save,
                },
                busy ? t('saving') : t('save'),
              ),
              editing !== null && editable
                ? h('button', { type: 'button', className: 'wsp-action', 'data-danger': 'true', disabled: busy, onClick: remove }, t('remove'))
                : null,
              editing !== null ? h('button', { type: 'button', className: 'wsp-action', disabled: busy, onClick: () => startNew('') }, t('cancel')) : null,
              notice !== null ? h('span', { className: 'wsp-note' }, notice) : null,
            ),
            !editable ? h('p', { className: 'wsp-note' }, t('readOnlyNote')) : null,
            view !== null && view.storeFile !== undefined
              ? h('p', { className: 'wsp-note' }, `${t('storeFile')} ${view.storeFile}`)
              : null,
          ),
        ),
      )
    }

    /** Required browser services. */
    const inject = ['slots', 'locale']

    /**
     * Mount the settings page.
     * @param {object} ctx - the browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'workspace-prompts: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: SECTION_ID,
            order: 25,
            label: () => t('nav'),
            locale: NS,
          },
          WorkspacePromptsBoundary,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.WorkspacePromptsSection = WorkspacePromptsSection
    exports.WorkspacePromptsBoundary = WorkspacePromptsBoundary
    return module.exports
  },
})

//# sourceMappingURL=client.js.map
