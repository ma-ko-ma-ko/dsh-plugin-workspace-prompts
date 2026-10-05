/**
 * Load the client half in a shimmed browser environment and drive its component
 * factory.
 *
 * This catches the failure modes a bundle can have before it ever reaches the
 * browser: a typo in the registration call, a `require` the module system cannot
 * answer, or a component that throws while rendering. React is stubbed with a
 * minimal hooks implementation, so the render itself is not a UI test.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/** The client bundle source, read once. */
const CLIENT_SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'client.js'), 'utf8')

/** A minimal React stand-in: enough for createElement and the hooks used. */
function makeReactStub() {
  const states = []
  let cursor = 0
  let effectQueue = []
  return {
    createElement(type, props, ...children) {
      return { type, props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children } }
    },
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      const set = (next) => {
        states[index] = typeof next === 'function' ? next(states[index]) : next
      }
      return [states[index], set]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = { current: initial }
      return states[index]
    },
    useCallback(fn) {
      cursor++
      return fn
    },
    useEffect(fn) {
      cursor++
      effectQueue.push(fn)
    },
    useId() {
      cursor++
      return `id-${cursor}`
    },
    Fragment: 'Fragment',
    /** React exposes Component; the bundle extends it for its error boundary. */
    Component: class Component {
      constructor(props) {
        this.props = props
      }
    },
    /** Reset hook state between renders. */
    __reset() {
      cursor = 0
      effectQueue = []
    },
    __effects() {
      return effectQueue
    },
  }
}

/**
 * Load the client bundle with a shimmed window and module table.
 * @param {object} [overrides] - extra or replacement module entries.
 * @returns {{registration: object, exports: object, react: object}} the loaded bundle.
 */
function loadClientBundle(overrides = {}) {
  const react = makeReactStub()
  const registered = []
  const slotsStub = {
    register: (options, component) => {
      registered.push({ options, component })
      return () => {}
    },
    resolveSlotLabel: (label) => (typeof label === 'function' ? label() : label),
  }
  const modules = {
    react,
    'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: 'Fragment' },
    '@deepseek-ai/dsh-client-ui-slots': slotsStub,
    ...overrides,
  }

  let registration
  const win = { __ModuleLoader__: { load: (value) => { registration = value } } }
  const doc = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: () => {} },
  }

  new Function('window', 'document', CLIENT_SOURCE)(win, doc)
  assert.ok(registration, 'the bundle must register itself with the module loader')

  const exports = registration.factory((spec) => {
    if (!(spec in modules)) throw new Error(`unexpected require("${spec}")`)
    return modules[spec]
  })
  return { registration, exports, react, registered, slotsStub, modules }
}

test('the client bundle registers itself under the plugin id', () => {
  const { registration } = loadClientBundle()
  assert.equal(registration.id, 'dsh-plugin-workspace-prompts')
  assert.equal(typeof registration.factory, 'function')
})

test('the client half exports apply and inject, and requires only known modules', () => {
  const { exports } = loadClientBundle()
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(exports.inject, ['slots', 'locale'])
})

test('apply registers one settings section through the slots service', () => {
  const { exports, registered } = loadClientBundle()
  const effects = []
  const localeNamespaces = []
  const ctx = {
    effect: (fn) => {
      effects.push(fn())
    },
    locale: {
      register: (ns) => {
        localeNamespaces.push(ns)
      },
      bind: () => (key) => key,
    },
    slots: {
      inject: (key, callback) => {
        assert.equal(key, 'settings.section')
        callback()
      },
      register: (options, component) => {
        registered.push({ options, component })
        return () => {}
      },
      resolveSlotLabel: (label) => (typeof label === 'function' ? label() : label),
    },
  }
  exports.apply(ctx)

  assert.deepEqual(localeNamespaces, ['workspacePrompts'])
  assert.equal(registered.length, 1)
  assert.equal(registered[0].options.name, 'settings.section')
  assert.equal(registered[0].options.id, 'workspace-prompts')
  // The registered component is the error boundary, which renders the body.
  assert.equal(typeof registered[0].component, 'function')
  assert.equal(registered[0].component.name, 'WorkspacePromptsBoundary')
  assert.equal(registered[0].options.locale, 'workspacePrompts', 'the renderer only injects `t` when a locale namespace is declared')
})

test('the boundary exposes the error-boundary contract', () => {
  const { exports } = loadClientBundle()
  const { WorkspacePromptsBoundary } = exports
  assert.equal(typeof WorkspacePromptsBoundary.getDerivedStateFromError, 'function')
  assert.equal(typeof WorkspacePromptsBoundary.prototype.componentDidCatch, 'function')
  assert.equal(typeof WorkspacePromptsBoundary.prototype.render, 'function')
})

test('the boundary falls back to a notice that names the failure', () => {
  const { exports, react } = loadClientBundle()
  const { WorkspacePromptsBoundary } = exports
  const state = WorkspacePromptsBoundary.getDerivedStateFromError(new Error('boom'))
  assert.equal(state.failure.message, 'boom')

  react.__reset()
  const instance = Object.create(WorkspacePromptsBoundary.prototype)
  instance.props = { t: (key) => key }
  instance.state = state
  const tree = instance.render()
  assert.equal(tree.props.className, 'wsp-root')
  const text = JSON.stringify(tree)
  assert.match(text, /boom/)
  assert.match(text, /crashed/)
})

test('the boundary renders the section when nothing failed', () => {
  const { exports, react } = loadClientBundle()
  const { WorkspacePromptsBoundary } = exports
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ entries: [] }) })
  react.__reset()
  const instance = Object.create(WorkspacePromptsBoundary.prototype)
  instance.props = { t: (key) => key }
  instance.state = { failure: null }
  const element = instance.render()
  // It delegates to the section component rather than rendering inline.
  assert.equal(element.type.name, 'WorkspacePromptsSection')
})

test('the section component renders without throwing', () => {
  const { exports, react } = loadClientBundle()
  const { WorkspacePromptsSection } = exports
  const t = (key) => key
  react.__reset()
  const tree = WorkspacePromptsSection({ t })
  assert.ok(tree, 'the component must return an element')
  assert.equal(tree.props.className, 'wsp-root')
})

test('the section component reaches the host route on mount', () => {
  const { exports, react } = loadClientBundle()
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init?.method })
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ entries: [], active: undefined, storeFile: '/tmp/prompts.json' }),
    }
  }
  react.__reset()
  const tree = exports.WorkspacePromptsSection({ t: (key) => key })
  for (const effect of react.__effects()) effect()
  // The mount effect loads asynchronously; let it settle.
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(calls.length >= 1, true, 'mount must read the view')
      assert.equal(calls[0].method, 'GET')
      assert.match(calls[0].url, /^\/api\/workspace-prompts/)
      resolve()
    }, 10)
  })
})
