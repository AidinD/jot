/**
 * Prove the archive is a two-way door: archive one card, find it again, bring
 * it back with its subtasks intact.
 *
 * This exists because archive.json was write-only for its whole life. The store
 * had archiveCompleted and nothing that could read the file back, so archiving
 * was indistinguishable from deleting and the board grew instead. The round-trip
 * is the only property worth asserting here - a one-way archive passes every
 * test you can write about writing, and is still useless.
 *
 * Runs against the built core in dist-core/ (npm run build:core first) with a
 * throwaway data dir, never the real board. Rejected: driving this through the
 * Electron shell, which would test IPC wiring rather than the rule, and could
 * not be run without a display.
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const { LocalJsonStorage, TodoStore } = await import('../dist-core/index.mjs')

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures += 1
  }
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `\n        väntade ${JSON.stringify(expected)}, fick ${JSON.stringify(actual)}`}`)
}

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jot-archive-'))
const todosPath = path.join(dataDir, 'todos.json')
const archivePath = path.join(dataDir, 'archive.json')

async function freshStore() {
  const store = new TodoStore(new LocalJsonStorage(todosPath), dataDir)
  await store.init()
  return store
}

// addTodo resolves to void while addSubtask resolves to the new id, so the only
// way to learn a new todo's id is to read it back. Newest lands on top, per the
// quick-capture flow in addTodo.
async function addAndGetId(store, text, categoryId) {
  await store.addTodo(text, categoryId)
  return store.getState().todos[0].id
}

const store = await freshStore()
const categoryId = await store.addCategory('Jobbsökning')

const rejectedId = await addAndGetId(store, 'Avanza - Customer Scalability', categoryId)
const subtaskId = await store.addSubtask(rejectedId, 'Fråga Linn om återkoppling')
const liveId = await addAndGetId(store, 'Svea Bank - Team Manager', categoryId)

// --- archive one card, not a sweep -----------------------------------------
check('archiveTodo tar kortet och dess subtask', await store.archiveTodo(rejectedId), 2)
check(
  'bara det levande kortet är kvar på brädet',
  store.getState().todos.map((t) => t.id),
  [liveId]
)

const archived = await store.readArchive()
check('readArchive hittar båda', archived.map((t) => t.id).sort(), [rejectedId, subtaskId].sort())
check(
  'archivedAt är satt',
  archived.every((t) => typeof t.archivedAt === 'number' && t.archivedAt > 0),
  true
)

// --- the round trip ---------------------------------------------------------
check('restoreFromArchive tar tillbaka båda', await store.restoreFromArchive(rejectedId), 2)
check(
  'kortet och subtasken är tillbaka på brädet',
  store
    .getState()
    .todos.map((t) => t.id)
    .sort(),
  [liveId, rejectedId, subtaskId].sort()
)
check(
  'subtasken hänger kvar under sin förälder',
  store.getState().todos.find((t) => t.id === subtaskId).parentId,
  rejectedId
)
check('arkivet är tomt igen', (await store.readArchive()).length, 0)

// --- survives a restart (the point of a file, not a cache) ------------------
await store.archiveTodo(rejectedId)
const reopened = await freshStore()
check(
  'arkivet överlever en omstart',
  (await reopened.readArchive()).map((t) => t.id).sort(),
  [rejectedId, subtaskId].sort()
)

// --- a child whose parent is gone must not restore into nothing -------------
const orphanArchive = [
  {
    ...(await reopened.readArchive()).find((t) => t.id === subtaskId),
    parentId: randomUUID()
  }
]
await fs.writeFile(archivePath, JSON.stringify({ todos: orphanArchive }, null, 2), 'utf-8')
const afterOrphan = await freshStore()
check('en föräldralös subtask kan återställas', await afterOrphan.restoreFromArchive(subtaskId), 1)
check(
  'den landar på toppnivå i stället för att försvinna',
  afterOrphan.getState().todos.find((t) => t.id === subtaskId).parentId,
  null
)

// --- a duplicated id must not restore twice --------------------------------
const dupeSource = (await afterOrphan.readArchive()).length
await afterOrphan.archiveTodo(subtaskId)
const onceArchived = await afterOrphan.readArchive()
await fs.writeFile(
  archivePath,
  JSON.stringify({ todos: [...onceArchived, ...onceArchived] }, null, 2),
  'utf-8'
)
const afterDupe = await freshStore()
check('en dubblett listas en gång', (await afterDupe.readArchive()).length, onceArchived.length)
check('en dubblett återställs en gång', await afterDupe.restoreFromArchive(subtaskId), 1)
check(
  'bara ett kort landar på brädet',
  afterDupe.getState().todos.filter((t) => t.id === subtaskId).length,
  1
)
void dupeSource

// --- a missing id is not an error, it is a miss -----------------------------
check('okänt id ger 0', await afterOrphan.restoreFromArchive(randomUUID()), 0)

// --- the reason archive.json held 123 duplicates ---------------------------
// Two clicks while the first write is still in flight. Before serialisation both
// calls computed the same card from unchanged state and wrote it twice.
const raceStore = await freshStore()
const racedId = await addAndGetId(raceStore, 'Dubbelklickad roll', categoryId)
const counts = await Promise.all([raceStore.archiveTodo(racedId), raceStore.archiveTodo(racedId)])
check('bara ett av två samtidiga anrop arkiverar', counts.sort(), [0, 1])
check(
  'kortet ligger en gång i arkivet',
  (await raceStore.readArchive()).filter((todo) => todo.id === racedId).length,
  1
)
const racedArchiveRaw = JSON.parse(await fs.readFile(archivePath, 'utf-8'))
check(
  'och en gång i filen, inte bara efter dedupliceringen',
  racedArchiveRaw.todos.filter((todo) => todo.id === racedId).length,
  1
)

// --- the sweep still works --------------------------------------------------
const sweepStore = await freshStore()
const doneId = await addAndGetId(sweepStore, 'Nordnet - avslag', categoryId)
await sweepStore.setStatus(doneId, 'done')
check('archiveCompleted sveper fortfarande', await sweepStore.archiveCompleted(), 1)

await fs.rm(dataDir, { recursive: true, force: true })
console.log(failures === 0 ? '\nalla kontroller gröna' : `\n${failures} kontroller föll`)
process.exit(failures === 0 ? 0 : 1)
