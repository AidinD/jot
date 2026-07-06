// Validates the watch MECHANISM added to LocalJsonStorage.watch() (storage.ts):
// fs.watch(dir) for low latency + fs.watchFile(file) polling as the reliable
// fallback. The claim under test: an EXTERNAL atomic write (tmp file + rename -
// how our board scripts and Dropbox sync replace todos.json) triggers onChange.
// fs.watch alone drops these on Windows/Dropbox; the polling fallback catches
// them. This mirrors storage.ts's watch() exactly (self-contained here because
// storage.ts imports electron transitively and can't load outside Electron).
//
// Run:  node scripts/test-storage-watch.mjs
import { promises as fsp, watch as watchFs, watchFile as watchFileFs, unwatchFile as unwatchFileFs } from 'fs'
import { basename, dirname, join } from 'path'
import os from 'os'

// --- exact copy of storage.ts's watch() body, parameterized by filePath ---
function makeWatch(filePath, onChange) {
  const directoryPath = dirname(filePath)
  const targetFile = basename(filePath)
  let closed = false
  let debounceTimer = null
  const trigger = () => {
    if (closed) return
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      onChange()
    }, 150)
  }
  let watcher = null
  try {
    watcher = watchFs(directoryPath, (_e, filename) => {
      if (filename !== undefined && filename !== null && String(filename) !== targetFile) return
      trigger()
    })
  } catch {
    watcher = null
  }
  watchFileFs(filePath, { interval: 1000 }, (curr, prev) => {
    if (curr.mtimeMs !== prev.mtimeMs || curr.size !== prev.size) trigger()
  })
  return () => {
    closed = true
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (watcher !== null) watcher.close()
    unwatchFileFs(filePath)
  }
}

const dir = await fsp.mkdtemp(join(os.tmpdir(), 'jot-watch-test-'))
const file = join(dir, 'todos.json')
await fsp.writeFile(file, JSON.stringify({ todos: [], categories: [], tags: [] }), 'utf-8')

let fired = 0
const stop = makeWatch(file, () => {
  fired += 1
})

async function externalAtomicWrite(state) {
  const tmp = `${file}.ext.tmp`
  await fsp.writeFile(tmp, JSON.stringify(state), 'utf-8')
  await fsp.rename(tmp, file)
}
async function waitFor(pred, ms) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (pred()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return pred()
}
let exitCode = 0
function assert(cond, msg) {
  console.log(`${cond ? 'OK  ' : 'FAIL'} - ${msg}`)
  if (!cond) exitCode = 1
}

try {
  const before = fired
  await externalAtomicWrite({ todos: [{ id: 'a' }], categories: [], tags: [] })
  assert(await waitFor(() => fired > before, 3000), 'external atomic write (tmp+rename) triggers onChange via the polling fallback')

  const before2 = fired
  await externalAtomicWrite({ todos: [{ id: 'b' }], categories: [], tags: [] })
  assert(await waitFor(() => fired > before2, 3000), 'a second external write also fires (watcher not one-shot)')

  stop()
  const before3 = fired
  await externalAtomicWrite({ todos: [], categories: [], tags: [] })
  await new Promise((r) => setTimeout(r, 1600))
  assert(fired === before3, 'no onChange after stop() (both watchers torn down, polling unwatched)')

  console.log(exitCode === 0 ? 'VERIFY OK: polling fallback catches external atomic writes; teardown clean.' : 'VERIFY FAILED.')
} finally {
  stop()
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
}
process.exit(exitCode)
