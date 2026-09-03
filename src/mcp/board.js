/**
 * Reading and writing `todos.json` from outside the app.
 *
 * Plain JavaScript with JSDoc rather than TypeScript, like `scripts/` and unlike
 * `src/core`: this folder is a process an MCP client STARTS, with
 * `node src/mcp/server.js` and nothing else. Anything that needed compiling first
 * would put a build step between an agent and the board, and the failure it
 * produces (a stale or missing `dist-core`) is the shape this repo keeps getting
 * bitten by - a success-looking start against old code.
 *
 * The write discipline is copied deliberately from Helm's Jot bridge
 * (`helm/src/lib/jot.js`, `mutateJotFile`), because Helm is where every one of
 * these failures was actually observed:
 *
 *  - **Whole-file writes with no lock.** Both the app and this process rewrite the
 *    entire document, so a naive rename silently REVERTS whatever the other one
 *    just did. Read, mutate, then re-check the file immediately before the rename.
 *  - **A content hash, not size+mtime.** The common shape of a real concurrent
 *    edit from the app is byte-identical in length: a drag-reorder is a pure array
 *    permutation, and "open" -> "done" is the same number of characters. Windows'
 *    ~15.6ms clock tick is coarser than the read-to-write window, so mtime often
 *    matched too.
 *  - **The rename itself needs retrying**, because the data directory is normally
 *    a synced folder and the sync client holding the file mid-rename is the normal
 *    operating condition, not an edge case. That part lives in `keel/storage`,
 *    shared with the app's own writer.
 *
 * Where this goes further than Helm's version: a detected concurrent edit re-reads
 * and re-applies the mutation instead of giving up, so a genuine collision costs a
 * retry rather than a refusal. It only refuses once the board has moved under it
 * repeatedly, which is the one case where refusing beats guessing.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// keel must stay a DEV dependency of Jot even though this runtime entry point
// imports it: electron-vite's externalizeDepsPlugin externalises `dependencies`
// only, so moving keel there would leave `keel/storage` unresolved in the packaged
// app - a failure with nothing in the log (see CLAUDE.md). Nothing is lost here,
// because this server runs from a checkout where `npm install` has run.
import { jitteredBackoffMs, resolveDataDir, sleepSync, stripBom, writeFileAtomicSync } from 'keel/storage'

/**
 * How many times a mutation is re-applied after losing a race with the app, and how
 * long those attempts may take in total.
 *
 * THREE ATTEMPTS WITH NO BACKOFF was three attempts inside the same microsecond,
 * and it was accidentally propped up by a bug elsewhere: keel's writer used to spin
 * its own four attempts on a refused guard, writing and deleting a temp file each
 * time, which acted as a crude delay between these three. When that spinning was
 * removed (correctly - it re-checked a stale expectation), an independent review
 * measured this loop refusing 3-11% of writes with six competing processes, against
 * 0% for Helm's equivalent loop, which had a jittered backoff and eight attempts.
 *
 * HONEST ABOUT THE EVIDENCE: that 3-11% is no longer reproducible. It was measured
 * against a version of keel that wrote its temp file BEFORE taking the write lock;
 * moving the temp inside the lock serialises writers for the whole write and cut
 * the collision rate for every caller. Re-measured afterwards at 8 processes x 40
 * writes, three attempts with no backoff and eight with jitter came out the same,
 * inside the noise. So this is a precaution, not a measured fix - kept because the
 * reasoning holds independently of whether today's timings expose it: two writers
 * backing off on an identical schedule stay in lockstep and keep colliding, and
 * attempts multiply, since each one can wait for the lock and retry a
 * Dropbox-locked rename. The budget bounds the whole thing in TIME, not just in
 * attempts.
 */
const MAX_MUTATE_ATTEMPTS = 8
const MUTATE_BUDGET_MS = 3000

/**
 * Where Electron would put `userData` for this app.
 *
 * The app itself asks Electron (`app.getPath('userData')`); there is no Electron
 * here, so the same location is computed the way Helm's `jotDataDir.js` does. The
 * `jot` leaf is the app `name` from package.json, which is what Electron uses.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
function osAppData(env) {
  if (env.APPDATA) {
    return env.APPDATA // Windows roaming appData
  }
  const home = os.homedir()
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support')
  }
  return env.XDG_CONFIG_HOME || path.join(home, '.config')
}

/**
 * The data directory, resolved exactly as the app resolves it: `JOT_DATA_DIR`
 * when set, else the per-user app data folder. Reported with its source so the
 * server can say on stderr which file it is actually talking to - the alternative
 * is two processes each reading a different board and both looking correct.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ dir: string, source: string }}
 */
export function resolveJotDataDir(env = process.env) {
  const { dir, overridden } = resolveDataDir({
    variable: 'JOT_DATA_DIR',
    fallback: path.join(osAppData(env), 'jot'),
    env
  })
  return { dir, source: overridden ? 'JOT_DATA_DIR' : 'default app data folder' }
}

/** @param {string} dataDir */
export function resolveTodosPath(dataDir) {
  return path.join(dataDir, 'todos.json')
}

/**
 * @typedef {{
 *   container: any,
 *   todos: any[],
 *   categories: any[],
 *   tags: any[],
 *   hash: string
 * }} Board
 */

/** Hash of the raw bytes - the only reliable "did this file change" signal. */
function hashOf(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

/** @param {string} todosPath @returns {string | null} */
function hashOfFile(todosPath) {
  try {
    return hashOf(fs.readFileSync(todosPath))
  } catch {
    // Unreadable right now counts as changed: a write that cannot verify what it
    // is about to replace is exactly the write worth abandoning.
    return null
  }
}

/**
 * Read the board.
 *
 * Deliberately NOT `keel/storage`'s `readJsonFile`, which returns a fallback for
 * an unparseable file. That is right for a reader and wrong for a writer: this
 * process would then treat a half-synced or corrupt document as an empty board
 * and write that emptiness back over it. An unreadable file is refused instead.
 *
 * `container` is the parsed document itself, kept whole. `todos`/`categories`/
 * `tags` are references into it, so a mutation applied to them lands in the
 * document that gets written. Nothing is normalised and no key is added: the file
 * may hold fields this server has never heard of (INTEGRATION.md asks external
 * writers to preserve them), and an absent `tags` key specifically means "seed the
 * defaults on next load" to the app, which writing `[]` would silently cancel
 * forever.
 *
 * @param {string} todosPath
 * @returns {{ board: Board } | { error: string }}
 */
export function readBoard(todosPath) {
  let raw
  try {
    raw = fs.readFileSync(todosPath)
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error)?.code
    if (code === 'ENOENT') {
      return {
        error:
          `There is no board at ${todosPath}. Either Jot has never run with this data ` +
          `directory, or JOT_DATA_DIR points somewhere else than the app uses.`
      }
    }
    return { error: `Could not open ${todosPath}: ${describe(error)}` }
  }

  const hash = hashOf(raw)

  let parsed
  try {
    parsed = JSON.parse(stripBom(raw.toString('utf8')))
  } catch (error) {
    return {
      error:
        `${todosPath} is not valid JSON (${describe(error)}), so nothing was read and ` +
        `nothing will be written - a write now would replace a recoverable file with ` +
        `an empty board. Check the file, or a sync conflict copy beside it.`
    }
  }

  // The legacy v0.1 format was a bare Todo[]. It stays a bare array on the way
  // back out: converting the container here would be a format migration nobody
  // asked this process for, and the app does that itself on its next load.
  const legacyArray = Array.isArray(parsed)
  if (!legacyArray && (parsed === null || typeof parsed !== 'object')) {
    return { error: `${todosPath} does not hold a Jot board (found ${typeof parsed}).` }
  }

  const todos = legacyArray ? parsed : parsed.todos
  if (!Array.isArray(todos)) {
    return { error: `${todosPath} has no todos array, so it is not a Jot board.` }
  }

  return {
    board: {
      container: parsed,
      todos,
      categories: !legacyArray && Array.isArray(parsed.categories) ? parsed.categories : [],
      tags: !legacyArray && Array.isArray(parsed.tags) ? parsed.tags : [],
      hash
    }
  }
}

/**
 * Read the board, apply `mutate` to it, and write it back atomically.
 *
 * `mutate(board)` either returns `{ error }` to refuse - which is final, since
 * re-reading cannot make an invalid write valid - or mutates the board in place
 * and returns the value to hand back to the caller.
 *
 * The mutation runs against a fresh read on every attempt, so validation is never
 * decided against a board that has since moved. That is the reason the check lives
 * inside the callback rather than around this call.
 *
 * @template T
 * @param {string} todosPath
 * @param {(board: Board) => T | { error: string }} mutate
 * @returns {T | { error: string }}
 */
export function mutateBoard(todosPath, mutate) {
  let lastWriteError = 'unknown'
  const deadline = Date.now() + MUTATE_BUDGET_MS

  for (let attempt = 0; attempt < MAX_MUTATE_ATTEMPTS; attempt += 1) {
    const read = readBoard(todosPath)
    if ('error' in read) {
      return { error: read.error }
    }
    const board = read.board

    const verdict = mutate(board)
    if (verdict !== null && typeof verdict === 'object' && 'error' in verdict) {
      return verdict
    }

    let sawConcurrentEdit = false
    // Serialised exactly as the app's own writer does it (`src/core/storage.ts`):
    // two-space JSON, no BOM, no trailing newline. Matching it byte for byte means
    // a write from here leaves no cosmetic diff for the next reader to wonder about.
    const written = writeFileAtomicSync(todosPath, JSON.stringify(board.container, null, 2), {
      app: 'Jot',
      onBeforeRename: () => {
        if (hashOfFile(todosPath) === board.hash) {
          return null
        }
        sawConcurrentEdit = true
        return 'the board changed while this write was being prepared'
      }
    })

    if (written.ok) {
      return verdict
    }
    lastWriteError = written.error
    if (!sawConcurrentEdit) {
      // A lock that never cleared, a read-only folder, a full disk. Retrying the
      // read and the mutation cannot help, and the message already says what to do.
      return { error: `Could not write to Jot's board: ${written.error}` }
    }
    if (attempt >= MAX_MUTATE_ATTEMPTS - 1) {
      break
    }
    // JITTERED - see MAX_MUTATE_ATTEMPTS. Without a wait here, all the attempts
    // land inside the window the competing writer is still working in.
    const wait = jitteredBackoffMs(attempt)
    if (Date.now() + wait > deadline) {
      break // out of time rather than out of attempts; same safe outcome
    }
    sleepSync(wait)
  }

  return {
    error:
      `Jot's board changed underneath this write ${MAX_MUTATE_ATTEMPTS} times, so nothing ` +
      `was changed (${lastWriteError}). Something else is editing it right now - try again.`
  }
}

/** @param {unknown} error */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}
