/**
 * Path resolution for per-workspace prompt lookups.
 *
 * This module is deliberately free of Node-specific APIs so the resolution
 * rules can be unit-tested and reasoned about on any platform. Callers that
 * have filesystem access resolve symlinks first ({@link realDirectory}) and
 * pass the result in.
 *
 * @module dsh-plugin-workspace-prompts/paths
 */

/** The reserved key whose prompt applies to every workspace. */
export const GLOBAL_KEY = '*'

/**
 * Normalize one absolute path for comparison.
 *
 * Comparison is lexical rather than filesystem-backed: separators collapse to
 * `/`, trailing separators are dropped, `.` segments are removed, `..`
 * segments are folded when they can be, and a trailing `/` is kept for a
 * filesystem root so `C:/` never becomes the relative-looking `C:`.
 *
 * Windows paths compare case-insensitively because the platform does; POSIX
 * paths keep their case. Both the `/` and `\` separators are accepted on every
 * platform, so a stored Windows path still matches when it is handed to a
 * POSIX build of the harness and vice versa.
 *
 * @param {string} value - any path, ideally absolute.
 * @returns {string} the comparison key.
 */
export function normalizePath(value) {
  if (typeof value !== 'string') return ''
  let path = value.trim()
  if (path.length === 0) return ''

  const windows = isWindowsPath(path)
  path = path.replaceAll('\\', '/')

  // Keep a UNC prefix (`//server/share`) intact while collapsing the rest.
  const unc = path.startsWith('//')
  const body = unc ? path.slice(2) : path

  const segments = []
  for (const segment of body.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..' && segments.length > 0 && segments.at(-1) !== '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }

  let joined = segments.join('/')
  const root = unc ? '//' : path.startsWith('/') ? '/' : ''
  if (root === '/' && joined.length > 0) joined = `/${joined}`
  else if (root === '//') joined = `//${joined}`
  else if (root === '/' && joined.length === 0) joined = '/'

  // A drive-qualified path keeps its separator (`C:/work`, never `C:work`),
  // because the latter is drive-relative and names a different location.
  if (windows && /^[a-z]:$/i.test(joined)) joined = `${joined}/`

  return windows ? joined.toLowerCase() : joined
}

/**
 * Report whether a path is Windows-shaped rather than POSIX-shaped.
 * @param {string} path - the raw path.
 * @returns {boolean} true for `C:\...`, `C:/...`, `C:...`, or a UNC path.
 */
function isWindowsPath(path) {
  if (path.startsWith('\\\\') || path.startsWith('//')) return true
  return /^[a-z]:([\\/]|$)/i.test(path)
}

/**
 * Split a normalized path into itself followed by every ancestor directory,
 * most specific first. Filesystem roots terminate the walk, and a relative
 * path contributes only itself.
 * @param {string} path - a normalized comparison key.
 * @returns {string[]} the lookup candidates, starting with `path` itself.
 */
export function ancestorKeys(path) {
  if (path.length === 0) return []
  const keys = [path]
  let current = path
  for (;;) {
    const next = parentKey(current)
    if (next === undefined) return keys
    keys.push(next)
    current = next
  }
}

/**
 * The parent comparison key of a normalized path.
 * @param {string} path - a normalized comparison key.
 * @returns {string|undefined} the parent key, or undefined at a root or for a
 * relative path (which has no reliable parent without a base directory).
 */
export function parentKey(path) {
  if (path === '/' || path === '//') return undefined
  const drive = /^[a-z]:(\/|$)/.test(path)
  if (/^[a-z]:\/?$/.test(path)) return undefined
  // A relative path has no reliable parent without a base directory; an
  // absolute one is either root-anchored or drive-qualified.
  if (!drive && !path.startsWith('/') && !path.startsWith('//')) return undefined

  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path
  const cut = trimmed.lastIndexOf('/')
  if (cut < 0) return drive ? `${trimmed}/` : undefined
  const parent = trimmed.slice(0, cut)
  if (parent.length === 0) return '/'
  // `c:/work` has the drive root as its parent, spelled to match
  // {@link normalizePath} output (`c:/`, never the drive-relative `c:`).
  if (/^[a-z]:$/.test(parent)) return `${parent}/`
  // `//server` collapses to the UNC root `//`.
  if (parent === '/') return path.startsWith('//') ? '//' : '/'
  return parent
}

/**
 * Choose the most specific entry that covers a directory.
 *
 * The caller supplies entries already keyed by {@link normalizePath} output.
 * The directory itself wins, then its nearest ancestor, then the reserved
 * {@link GLOBAL_KEY} entry. A directory nested inside a configured workspace
 * therefore inherits that workspace's prompt.
 *
 * Specificity is decided per key: when two sources both define the same key,
 * the one merged later replaces the earlier value while that key keeps its
 * place in the walk. That lets a caller express "the closer match wins, and
 * the higher-precedence source wins ties" in one merge.
 *
 * @param {Map<string, unknown> | Record<string, unknown>} entries - keyed entries.
 * @param {string} directory - the normalized directory to match.
 * @returns {{key: string, value: unknown, matchedBy: 'self'|'ancestor'|'global'}|undefined}
 *   the winning entry, or undefined when nothing applies.
 */
export function matchEntry(entries, directory) {
  const lookup = (key) =>
    entries instanceof Map ? entries.get(key) : Object.hasOwn(entries, key) ? entries[key] : undefined

  for (const key of ancestorKeys(directory)) {
    const value = lookup(key)
    if (value !== undefined && value !== null) {
      return { key, value, matchedBy: key === directory ? 'self' : 'ancestor' }
    }
  }

  const fallback = lookup(GLOBAL_KEY)
  if (fallback !== undefined && fallback !== null) {
    return { key: GLOBAL_KEY, value: fallback, matchedBy: 'global' }
  }
  return undefined
}

/**
 * Merge entry maps so the closest match wins across sources.
 *
 * Entries are merged key by key, later sources overriding earlier ones at the
 * same key. The returned map still resolves by specificity, so an entry for a
 * specific directory beats a global default declared by a higher-precedence
 * source, while that source still wins when both name the same directory.
 *
 * @param {...(Record<string, unknown>|undefined)} sources - entry maps, lowest precedence first.
 * @returns {Record<string, unknown>} the merged entries.
 */
export function mergeEntries(...sources) {
  /** @type {Record<string, unknown>} */
  const merged = {}
  for (const source of sources) {
    if (source === undefined) continue
    for (const [key, value] of Object.entries(source)) merged[key] = value
  }
  return merged
}
