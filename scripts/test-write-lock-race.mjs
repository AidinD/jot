// Two failure modes that both silently LOST a board write, found via Helm's
// jot-ipc-bridge test going flaky under a parallel test runner (2026-08-03):
//
//  1) storage.save() renamed the temp file over todos.json with no retry. On
//     Windows the rename fails with EPERM/EBUSY whenever another process holds
//     the target - Dropbox syncing it, an antivirus scanner, a search indexer -
//     and the whole write was thrown away.
//  2) TodoStore.reloadFromDisk() replaced in-memory state with whatever was on
//     disk, with no regard for a save still in flight. Because the file watcher
//     fires on our OWN writes too, a save slow enough to still be running (see 1)
//     meant the reload read a one-revision-old file and reverted the change the
//     user had just made.
//
// Runs against the built core (dist-core), i.e. exactly what a consumer imports.
//
// Run:  npm run build:core && node scripts/test-write-lock-race.mjs
import { promises as fsp, openSync, closeSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { LocalJsonStorage, TodoStore, writeFileAtomic } from '../dist-core/index.mjs'

let exitCode = 0
function assert(cond, msg) {
  console.log(`${cond ? 'OK  ' : 'FAIL'} - ${msg}`)
  if (!cond) exitCode = 1
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(pred, ms) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (pred()) return true
    await sleep(50)
  }
  return pred()
}

const emptyState = { todos: [], categories: [], tags: [] }
function makeTodo(id, text) {
  const now = Date.now()
  return {
    id,
    text,
    status: 'open',
    description: '',
    images: [],
    categoryId: null,
    tags: [],
    priority: 0,
    deadline: null,
    parentId: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null
  }
}

const dir = await fsp.mkdtemp(join(os.tmpdir(), 'jot-write-race-'))

try {
  // --- 1) the write survives a target held open by another handle -------------
  // An open handle on Windows makes the rename fail with EPERM (Node opens
  // without FILE_SHARE_DELETE). The handle is released mid-retry, so a write with
  // a bounded retry lands and a bare rename would have thrown.
  const lockedFile = join(dir, 'locked.json')
  await fsp.writeFile(lockedFile, JSON.stringify(emptyState), 'utf-8')
  const handle = openSync(lockedFile, 'r+')
  let released = false
  setTimeout(() => {
    closeSync(handle)
    released = true
  }, 90)
  let wroteWhileLocked = true
  try {
    await writeFileAtomic(lockedFile, JSON.stringify({ ...emptyState, todos: [makeTodo('locked-1', 'survived the lock')] }, null, 2))
  } catch (error) {
    wroteWhileLocked = false
    console.log(`      (write failed: ${error.code || error.message})`)
  }
  if (!released) {
    closeSync(handle)
  }
  assert(wroteWhileLocked, 'a write whose target is briefly held open still lands (bounded retry)')
  const lockedOnDisk = JSON.parse(await fsp.readFile(lockedFile, 'utf-8'))
  assert(lockedOnDisk.todos.some((t) => t.id === 'locked-1'), 'the retried write actually reached the file')
  // No litter: the temp files are cleaned up whether the attempt succeeded or not.
  const leftovers = (await fsp.readdir(dir)).filter((name) => name.endsWith('.tmp'))
  assert(leftovers.length === 0, `no temp files left behind (found ${leftovers.length})`)

  // --- 2) a slow save is not reverted by a reload ----------------------------
  // A storage adapter whose save() is deliberately slow, and whose watch fires
  // immediately, reproduces the clobber every time: without the guard the reload
  // reads the pre-save file and assigns it over the fresh in-memory change.
  const raceFile = join(dir, 'todos.json')
  await fsp.writeFile(raceFile, JSON.stringify(emptyState), 'utf-8')
  const inner = new LocalJsonStorage(raceFile)
  let fireWatch = () => {}
  const slowStorage = {
    load: () => inner.load(),
    save: async (state) => {
      // Fire the watcher first, exactly as a real fs event would arrive while the
      // rename is still pending.
      fireWatch()
      await sleep(250)
      await inner.save(state)
      fireWatch()
    },
    watch: (onChange) => {
      fireWatch = onChange
      return () => {
        fireWatch = () => {}
      }
    }
  }

  const store = new TodoStore(slowStorage, dir)
  await store.init()
  await store.addTodo('slow write', null, 0, null)
  const added = store.getState().todos.find((t) => t.text === 'slow write')
  // Without the guard the reload wipes the add outright, so there is no id to
  // continue with - report that and keep going rather than crashing the run.
  assert(!!added, 'the added todo survived the reload that fired during its save')
  if (added) {
    await store.setStatus(added.id, 'in-progress', false)
    // Give any deferred reload time to run and, if it were unguarded, to revert.
    await sleep(700)
    assert(
      store.getState().todos.find((t) => t.id === added.id)?.status === 'in-progress',
      'a reload firing mid-save does not revert the in-memory change'
    )
    const raceOnDisk = JSON.parse(await fsp.readFile(raceFile, 'utf-8'))
    assert(
      raceOnDisk.todos.find((t) => t.id === added.id)?.status === 'in-progress',
      'the change is also what ended up on disk'
    )
  } else {
    assert(false, 'a reload firing mid-save does not revert the in-memory change (skipped - the add was lost)')
  }

  // --- 3) genuine external changes still get picked up ----------------------
  // The guard defers reloads; it must not starve them. This is the feature Aidin
  // relies on when a script edits todos.json while Jot is open.
  const external = { todos: [makeTodo('ext-1', 'written by another process')], categories: [], tags: [] }
  await fsp.writeFile(raceFile, JSON.stringify(external, null, 2), 'utf-8')
  fireWatch()
  assert(
    await waitFor(() => store.getState().todos.some((t) => t.id === 'ext-1'), 3000),
    'an external write to todos.json still reaches the store'
  )

  store.dispose()
  console.log(exitCode === 0 ? 'VERIFY OK: locked-target writes retry and land; a mid-save reload cannot revert them; external changes still arrive.' : 'VERIFY FAILED.')
} finally {
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
}
process.exit(exitCode)
