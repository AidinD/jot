#!/usr/bin/env node
/**
 * Refuse to commit a new source file whose name, or whose exported symbols, use
 * a generic word that says nothing: Manager, Handler, Utils, data, process.
 *
 * Names are how a reader without an IDE finds things - an agent with no
 * go-to-definition, a person grepping a repository they have not opened before.
 * `SessionManager` and `utils.mjs` answer none of the questions a search is
 * asking; they are where unrelated code goes to hide. The rule lived in a
 * document, and a rule that depends on remembering is a reminder.
 *
 * Two kinds of match, deliberately different:
 *  - Manager, Handler and Utils are refused as a WORD inside a name
 *    (`SessionManager`, `click-handler.mjs`, `stringUtils`), because a suffix
 *    is exactly how they get used.
 *  - data and process are refused only as the WHOLE name (`export const data`,
 *    `process.mjs`). As a word they are ordinary English - `metadata`,
 *    `processQueue`, `userData` - and refusing those would make the hook noise.
 *
 * It checks names, never whether a replacement is good. Added files only, the
 * same surface as the header check beside it: a name already in the repository
 * was chosen before the rule, and demanding a rename on every edit is how a hook
 * gets disabled. Re-exports (`export { x } from`) are skipped - the name belongs
 * to the file that defines it.
 *
 * If the hook itself breaks, it says so on stderr and lets the commit through.
 *
 * Canonical copy lives in keel/hooks. If you change it, copy it to the siblings -
 * a git hook cannot be loaded out of node_modules, because it has to work in a
 * clone where nothing is installed yet. Node builtins only, for the same reason.
 *
 * Override for a genuine exception:  git commit --no-verify
 */

import { execFileSync } from 'node:child_process'

/** Refused wherever they appear as a word in a name. */
const FORBIDDEN_WORD = new Set(['manager', 'handler', 'utils'])

/** Refused only when they are the entire name. */
const FORBIDDEN_WHOLE = new Set(['data', 'process'])

/** Source files, whose names and exports this hook can read. */
const SOURCE = /\.(m|c)?(j|t)sx?$/i

/** Generated, vendored and fixture paths name things for reasons outside this repo. */
const EXEMPT_PATH = [
  /\.d\.(m|c)?ts$/i,
  /(^|\/)(node_modules|vendor|vendored|third[-_]party|dist|out|generated|__generated__)\//i,
  /\.(generated|gen|min)\.[^/]+$/i,
  /(^|\/)(fixtures?|__fixtures__)\//i,
  /\.fixtures?\.[^/]+$/i
]

/** Declarations that introduce an exported name. */
const EXPORT_DECLARATION =
  /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\s*\*?|class|const|let|var|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/gm

/** `export { a, b as c }` with no `from` - local names, exported under the alias. */
const EXPORT_LIST = /^\s*export\s+(?:type\s+)?\{([^}]*)\}(?!\s*from)/gm

/** CommonJS: `exports.x =` and `module.exports.x =`. */
const COMMONJS_EXPORT = /^\s*(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/gm

/**
 * The lowercase words in an identifier or filename, camelCase split apart.
 *
 * @param {string} name
 * @returns {string[]}
 */
function words(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)
}

/**
 * The generic word a name is built on, or null.
 *
 * @param {string} name
 * @returns {string | null}
 */
function genericWord(name) {
  const parts = words(name)
  const whole = parts.join('')
  if (FORBIDDEN_WHOLE.has(whole)) {
    return whole
  }
  return parts.find((part) => FORBIDDEN_WORD.has(part)) ?? null
}

/**
 * The names a new file exports, in the order they appear.
 *
 * @param {string} text
 * @returns {string[]}
 */
function exportedNames(text) {
  const names = []
  for (const match of text.matchAll(EXPORT_DECLARATION)) {
    names.push(match[1])
  }
  for (const match of text.matchAll(EXPORT_LIST)) {
    for (const entry of match[1].split(',')) {
      const exported = entry.trim().split(/\s+as\s+/).pop()?.replace(/^type\s+/, '').trim()
      if (exported !== undefined && exported !== '' && exported !== 'default') {
        names.push(exported)
      }
    }
  }
  for (const match of text.matchAll(COMMONJS_EXPORT)) {
    names.push(match[1])
  }
  return names
}

/**
 * Every generic name in one new file: its own filename first, then its exports.
 *
 * @param {string} path  repository-relative, forward slashes
 * @param {string} text  the staged content
 * @returns {Array<[string, string]>} [what was named, the generic word]
 */
function genericNames(path, text) {
  if (!SOURCE.test(path) || EXEMPT_PATH.some((exempt) => exempt.test(path))) {
    return []
  }
  const hits = []
  const base = (path.split('/').pop() ?? path).replace(/(\.[^.]+)+$/, '')
  const fromFile = genericWord(base)
  if (fromFile !== null) {
    hits.push([`file name "${base}"`, fromFile])
  }
  for (const name of new Set(exportedNames(text))) {
    const found = genericWord(name)
    if (found !== null) {
      hits.push([`export "${name}"`, found])
    }
  }
  return hits
}

function stagedAdditions() {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=A'], {
    encoding: 'utf-8'
  })
  return out.split('\n').filter((line) => line.length > 0)
}

function stagedText(path) {
  return execFileSync('git', ['show', `:${path}`], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
}

let offenders
try {
  offenders = []
  for (const path of stagedAdditions()) {
    if (!SOURCE.test(path)) {
      continue
    }
    for (const [what, word] of genericNames(path, stagedText(path))) {
      offenders.push([path, what, word])
    }
  }
} catch (error) {
  console.error(
    `[generic-names] the check could not run: ${error instanceof Error ? error.message : error}`
  )
  console.error('[generic-names] committing anyway - but new names are not being checked right now.')
  process.exit(0)
}

if (offenders.length > 0) {
  const width = Math.max(...offenders.map(([path]) => path.length))
  console.error('\nRefusing to commit - these new names say nothing a search can find:\n')
  for (const [path, what, word] of offenders) {
    console.error(`  ${path.padEnd(width)}   ${what} uses "${word}"`)
  }
  console.error(
    [
      '',
      'Manager, Handler, Utils, data and process name a bucket, not a thing. Name',
      'what it actually holds or does - SessionStore, onSaveClick, formatDuration,',
      'pendingInvoices, rebuildIndex - so a grep for the concept lands on it.',
      '',
      'Only new files are checked, and only the names - not whether the new one is good.',
      'If you are certain:  git commit --no-verify',
      ''
    ].join('\n')
  )
  process.exit(1)
}
