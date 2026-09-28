#!/usr/bin/env node
/**
 * Refuse to commit a new source file that opens without a header.
 *
 * The rule it enforces: every source file over roughly twenty lines opens with a
 * comment block saying what the file is for, what it exists to achieve, and what
 * was tried and rejected. The rule lived in a document, and a rule that depends on
 * remembering is a reminder - the privacy guard beside this one exists because a
 * read-and-understood rule was broken fifteen times in one evening.
 *
 * It checks EXISTENCE, never quality. Before the first statement there must be a
 * comment block of at least three non-empty lines whose words are not merely the
 * filename plus filler. Whether the header is true, whether it separates intent
 * from rationale, whether the rejected alternative is the real one - none of that
 * can be judged by a script, and a hook that tries becomes noise that people learn
 * to skip.
 *
 * Added files only, never modified ones. Demanding a retrofit on every edit of an
 * old file is how a hook gets disabled within a week. A rename is not an addition
 * either: git reports it as R, so moving a file does not ask it for a header.
 *
 * If the hook itself breaks, it says so on stderr and lets the commit through. A
 * guard that blocks commits when the guard is broken is a guard that gets deleted.
 *
 * Canonical copy lives in keel/hooks. If you change it, copy it to the siblings -
 * a git hook cannot be loaded out of node_modules, because it has to work in a
 * clone where nothing is installed yet. Node builtins only, for the same reason.
 *
 * Override for a genuine exception:  git commit --no-verify
 */

import { execFileSync } from 'node:child_process'

/** Below this many lines a file is too small to owe a header. */
const MIN_LINES = 20

/** A header shorter than this cannot answer three questions. */
const MIN_HEADER_LINES = 3

/**
 * The languages this hook can read comments in, by extension. Anything else is
 * not checked, because a hook that guesses at comment syntax refuses good files.
 */
const SYNTAX = [
  {
    extension: /\.(m|c)?(j|t)sx?$/i,
    line: ['//'],
    block: true,
    // ESM imports and re-exports, CommonJS requires, and directive prologues.
    prelude: /^(import\b|export\s+(\*|\{[^}]*\}|type\s+\{[^}]*\})\s*from\b|(const|let|var)\s+[^=]+=\s*require\(|['"]use \w+['"])/
  },
  { extension: /\.(s?css|less)$/i, line: [], block: true, prelude: /^@(import|use|forward|charset)\b/ },
  { extension: /\.(sh|bash)$/i, line: ['#'], block: false, prelude: /^(set|source|\.)\s/ }
]

/** Paths that are generated, vendored or fixtures, and so not anybody's to explain. */
const EXEMPT_PATH = [
  /\.d\.(m|c)?ts$/i,
  /(^|\/)index\.[^/]+$/i,
  /(^|\/)(node_modules|vendor|vendored|third[-_]party|dist|out|generated|__generated__)\//i,
  /\.(generated|gen|min)\.[^/]+$/i,
  /(^|\/)(fixtures?|__fixtures__)\//i,
  /\.fixtures?\.[^/]+$/i
]

/** A generator's own marker, in the first lines of what it wrote. */
const GENERATED_MARKER = /@generated|do not edit|auto-?generated/i

/** Words that carry no meaning of their own in a header. */
const STOPWORDS = new Set(
  'a an the and or of for to in on at by with from as is are be this that it its'.split(' ')
)

/**
 * The lines before the first statement, as comment text, grouped into blocks.
 *
 * @param {string[]} lines
 * @param {typeof SYNTAX[number]} syntax
 * @returns {string[][]} each block's lines with the comment markers stripped
 */
function leadingCommentBlocks(lines, syntax) {
  const blocks = []
  let current = null
  let inBlock = false
  let inImport = false

  const close = () => {
    if (current !== null) {
      blocks.push(current)
      current = null
    }
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim()

    if (inBlock) {
      const end = line.indexOf('*/')
      const body = end === -1 ? line : line.slice(0, end)
      current.push(body.replace(/^\*+/, '').trim())
      if (end !== -1) {
        inBlock = false
        if (line.slice(end + 2).trim() !== '') {
          close()
          return blocks
        }
      }
      continue
    }

    if (inImport) {
      if (/\bfrom\s*['"]/.test(line)) {
        inImport = false
      }
      continue
    }

    if (index === 0 && line.startsWith('#!')) {
      continue
    }
    if (line === '') {
      // A blank line ends a run of line comments but not a block comment.
      close()
      continue
    }

    const marker = syntax.line.find((prefix) => line.startsWith(prefix))
    if (marker !== undefined) {
      if (current === null) {
        current = []
      }
      current.push(line.slice(marker.length).replace(/^[/#!]+/, '').trim())
      continue
    }

    if (syntax.block && line.startsWith('/*')) {
      close()
      current = []
      const rest = line.slice(2)
      const end = rest.indexOf('*/')
      current.push((end === -1 ? rest : rest.slice(0, end)).replace(/^\*+/, '').trim())
      if (end === -1) {
        inBlock = true
      } else {
        close()
        if (rest.slice(end + 2).trim() !== '') {
          return blocks
        }
      }
      continue
    }

    if (syntax.prelude.test(line)) {
      close()
      // A multi-line import runs until its `from '...'` or its closing quote.
      if (/^import\b/.test(line) && !/\bfrom\s*['"]|^import\s*['"]/.test(line)) {
        inImport = true
      }
      continue
    }

    // The first real statement: whatever was above it is the header, or nothing is.
    break
  }
  close()
  return blocks
}

/**
 * The lowercase words in a piece of text or an identifier, camelCase split apart.
 *
 * @param {string} text
 * @returns {string[]}
 */
function words(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0)
}

/**
 * Whether a comment block says anything beyond the file's own name.
 *
 * `// UserService - the user service` restates the filename; that is a label,
 * not a header. Plurals are folded so `services` does not count as new content.
 *
 * @param {string[]} block
 * @param {string} path
 * @returns {boolean}
 */
function saysMoreThanItsName(block, path) {
  const base = path.split('/').pop() ?? path
  const name = new Set(words(base))
  const fold = (word) => word.replace(/s$/, '')
  const nameFolded = new Set([...name].map(fold))
  return words(block.join(' ')).some(
    (word) => !STOPWORDS.has(word) && !name.has(word) && !nameFolded.has(fold(word))
  )
}

/**
 * Why a new file fails the header check, or null when it passes or is exempt.
 *
 * @param {string} path  repository-relative, forward slashes
 * @param {string} text  the staged content
 * @returns {string | null}
 */
function headerProblem(path, text) {
  const syntax = SYNTAX.find((candidate) => candidate.extension.test(path))
  if (syntax === undefined || EXEMPT_PATH.some((exempt) => exempt.test(path))) {
    return null
  }
  const lines = text.split(/\r?\n/)
  if (lines.at(-1) === '') {
    lines.pop()
  }
  if (lines.length < MIN_LINES) {
    return null
  }
  if (GENERATED_MARKER.test(lines.slice(0, 5).join('\n'))) {
    return null
  }

  const blocks = leadingCommentBlocks(lines, syntax)
  const substantial = blocks.filter(
    (block) => block.filter((line) => line !== '').length >= MIN_HEADER_LINES
  )
  if (substantial.length === 0) {
    return blocks.length === 0
      ? 'no comment before the first statement'
      : `no comment block of ${MIN_HEADER_LINES}+ non-empty lines before the first statement`
  }
  if (!substantial.some((block) => saysMoreThanItsName(block, path))) {
    return 'the header only restates the filename'
  }
  return null
}

function stagedAdditions() {
  // A only. A file already tracked was written before the rule, and asking every
  // edit of it for a retrofit would train people to pass --no-verify by reflex.
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=A'], {
    encoding: 'utf-8'
  })
  return out.split('\n').filter((line) => line.length > 0)
}

function stagedText(path) {
  // The staged blob, not the working tree: that is what the commit will contain.
  return execFileSync('git', ['show', `:${path}`], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
}

let offenders
try {
  offenders = []
  for (const path of stagedAdditions()) {
    const problem = headerProblem(path, stagedText(path))
    if (problem !== null) {
      offenders.push([path, problem])
    }
  }
} catch (error) {
  console.error(
    `[file-header] the check could not run: ${error instanceof Error ? error.message : error}`
  )
  console.error('[file-header] committing anyway - but new files are not being checked for a header right now.')
  process.exit(0)
}

if (offenders.length > 0) {
  const width = Math.max(...offenders.map(([path]) => path.length))
  console.error('\nRefusing to commit - these new files have no header:\n')
  for (const [path, why] of offenders) {
    console.error(`  ${path.padEnd(width)}   ${why}`)
  }
  console.error(
    [
      '',
      'Open each one with a comment block, before the first statement, that answers:',
      '',
      '  1. What the file is for, and what belongs in it.',
      '  2. What it exists to achieve - "this exists so that X", as intent rather',
      '     than as a description of the current code.',
      '  3. What was tried and rejected, and the constraint that forced the present',
      '     shape. Leave this out only when nothing was actually rejected.',
      '',
      'Only new files are checked, and only that a header exists - not what it says.',
      'If you are certain:  git commit --no-verify',
      ''
    ].join('\n')
  )
  process.exit(1)
}
