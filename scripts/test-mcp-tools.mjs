// The MCP surface over todos.json: every read, every write, and every refusal.
//
// The refusals are the reason this file is long. The server exists because an
// assistant seat can only write the board through MCP, and the argument for that
// (helm/DECISIONS.md, "An assistant seat is not a first mate with a different
// manual") rests entirely on the claim that an MCP surface REFUSES an invalid
// write where a path-based guard would wave it through. So each refusal is checked
// twice: the caller is told what was wrong, AND the file on disk is byte-identical
// afterwards. A refusal that still wrote something would be the worst of both.
//
// Runs against a scratch directory, never the real board.
//
// Run:  node scripts/test-mcp-tools.mjs
import { createHash } from 'crypto'
import { promises as fsp, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import os from 'os'

import { mutateBoard, readBoard, resolveJotDataDir, resolveTodosPath } from '../src/mcp/board.js'
import { callTool, toolManifest } from '../src/mcp/tools.js'
import { STATUSES } from '../src/mcp/validate.js'

let exitCode = 0
function assert(cond, msg) {
  console.log(`${cond ? 'OK  ' : 'FAIL'} - ${msg}`)
  if (!cond) {
    exitCode = 1
  }
}

const NOW = 1788000000000
const WORK = 'cat-work'
const PRIVATE = 'cat-private'

function makeTodo(id, text, extra = {}) {
  return {
    id,
    text,
    status: 'open',
    description: '',
    images: [],
    categoryId: WORK,
    tags: [],
    priority: 0,
    deadline: null,
    pinned: false,
    parentId: null,
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
    completedAt: null,
    ...extra
  }
}

function fixture() {
  return {
    todos: [
      makeTodo('t-plain', 'Write the release notes'),
      makeTodo('t-urgent', 'Ship the installer', { priority: 1 }),
      makeTodo('t-above', 'Answer the blocking question', { priority: -1 }),
      makeTodo('t-desc', 'Parked task', {
        description: 'Left because the API is not ready.',
        status: 'review',
        tags: ['tag-blocked', 'tag-ghost']
      }),
      makeTodo('t-done', 'Finished thing', {
        status: 'done',
        pinned: true,
        completedAt: NOW - 500
      }),
      makeTodo('t-sub', 'A subtask', { parentId: 't-plain' }),
      makeTodo('t-loose', 'On no list', { categoryId: null }),
      makeTodo('t-private', 'Personal errand', { categoryId: PRIVATE })
    ],
    categories: [
      { id: WORK, name: 'Work', color: '#4fc3d9', createdAt: 1, domain: 'work' },
      { id: PRIVATE, name: 'Privat', color: '#ff7a90', createdAt: 2, domain: 'private' }
    ],
    tags: [{ id: 'tag-blocked', name: 'Blocked', color: '#f00', description: '', emphasis: null }]
  }
}

const dir = await fsp.mkdtemp(join(os.tmpdir(), 'jot-mcp-'))
const todosPath = join(dir, 'todos.json')

/** Reset the board to the fixture, exactly as Jot's own writer would serialise it. */
function reset() {
  writeFileSync(todosPath, JSON.stringify(fixture(), null, 2), 'utf8')
}
function hash() {
  return createHash('sha256').update(readFileSync(todosPath)).digest('hex')
}
function onDisk() {
  return JSON.parse(readFileSync(todosPath, 'utf8'))
}
function call(name, args) {
  return callTool(todosPath, name, args, NOW)
}

/**
 * A write that must be refused: the caller is told why, and the file is untouched.
 * The second half is the part that cannot be skipped - "returned an error" and
 * "changed nothing" are different facts, and only the pair is worth anything.
 */
function refuses(label, name, args, fragment) {
  reset()
  const before = hash()
  const result = call(name, args)
  const said = typeof result?.error === 'string' ? result.error : ''
  assert(said.length > 0, `${label}: refused rather than written`)
  assert(
    said.toLowerCase().includes(fragment.toLowerCase()),
    `${label}: the message says what was wrong (looking for "${fragment}" in: ${said.slice(0, 160)})`
  )
  assert(hash() === before, `${label}: the file on disk is unchanged`)
}

try {
  // --- the surface itself -----------------------------------------------------
  const manifest = toolManifest()
  assert(manifest.length === 8, `the manifest offers 8 tools (found ${manifest.length})`)
  assert(
    manifest.every((tool) => tool.inputSchema.additionalProperties === false),
    'every tool refuses arguments nobody validates (additionalProperties: false)'
  )
  assert(
    manifest.every((tool) => tool.name.startsWith('jot_') && tool.description.length > 40),
    'every tool is namespaced and carries a real description'
  )
  // Deleting is not on this surface, deliberately: removing a list also deletes
  // every task on it and nothing in the file survives it.
  assert(
    !manifest.some((tool) => /remove|delete|clear|archive/i.test(tool.name)),
    'nothing on this surface deletes'
  )
  assert(
    typeof call('jot_not_a_tool', {}).error === 'string',
    'an unknown tool name is reported, not thrown'
  )

  // The statuses this server validates against are Jot's own, read out of the
  // TypeScript source. A fifth status added to the app and not here would make
  // every attempt to use it look like a caller error.
  const typesSource = readFileSync(new URL('../src/core/types.ts', import.meta.url), 'utf8')
  const union = typesSource.match(/export type TodoStatus\s*=\s*([^\n]+)/)
  const declared = (union?.[1] ?? '').match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) ?? []
  assert(
    declared.length > 0 && declared.join(',') === STATUSES.join(','),
    `the status list matches src/core/types.ts (app: ${declared.join('|')}, here: ${STATUSES.join('|')})`
  )

  // --- data directory ---------------------------------------------------------
  const overridden = resolveJotDataDir({ JOT_DATA_DIR: ' D:/somewhere/jot ' })
  assert(overridden.dir === 'D:/somewhere/jot', 'JOT_DATA_DIR wins, trimmed')
  assert(overridden.source === 'JOT_DATA_DIR', 'and the server can say where that came from')
  const fallback = resolveJotDataDir({ APPDATA: 'C:/Users/x/AppData/Roaming' })
  assert(
    resolveTodosPath(fallback.dir).replace(/\\/g, '/') ===
      'C:/Users/x/AppData/Roaming/jot/todos.json',
    'without it, the same per-user folder Electron would give the app'
  )

  // --- reads ------------------------------------------------------------------
  reset()

  const cats = call('jot_categories', {})
  assert(cats.lists.length === 2, 'jot_categories lists every list')
  const work = cats.lists.find((list) => list.id === WORK)
  assert(work.name === 'Work' && work.domain === 'work', 'with its name and work/private domain')
  assert(
    work.tasks.open === 3 && work.tasks.review === 1 && work.tasks.done === 1,
    `counted by status, root tasks only (got ${JSON.stringify(work.tasks)})`
  )
  assert(work.subtasks === 1, 'subtasks counted separately, so nothing is double-counted')
  assert(cats.withoutCategory.total === 1, 'tasks on no list are reported rather than hidden')

  const all = call('jot_todos', {})
  assert(all.count === 7, `jot_todos returns root tasks only (got ${all.count})`)
  assert(
    all.todos.map((todo) => todo.priority).join(',') === '-1,0,0,0,0,0,1',
    `sorted the way the app sorts: priority ascending, 0 between -1 and 1 (got ${all.todos
      .map((todo) => todo.priority)
      .join(',')})`
  )
  assert(all.todos[0].id === 't-above', 'so -1 is on top, above the unprioritised pile')
  assert(all.todos[all.todos.length - 1].id === 't-urgent', 'and priority 1 sits below it')
  assert(
    all.todos.every((todo) => todo.description === undefined),
    'a listing carries no descriptions - they hold whole plans'
  )
  assert(
    all.todos.find((todo) => todo.id === 't-desc').descriptionChars === 34,
    'but says there is one, and how long it is'
  )
  assert(
    all.todos.find((todo) => todo.id === 't-plain').category === 'Work',
    'each task carries its list NAME, not just the id'
  )
  assert(
    all.todos.find((todo) => todo.id === 't-plain').subtasks === 1,
    'and how many subtasks hang under it'
  )
  const ghostTags = all.todos.find((todo) => todo.id === 't-desc').tags
  assert(
    ghostTags[0] === 'Blocked' && ghostTags[1] === 'unknown:tag-ghost',
    'tag ids resolve to names, and an id left behind by a deleted tag is shown as such'
  )

  assert(call('jot_todos', { categoryId: WORK }).count === 5, 'filter by category id')
  assert(call('jot_todos', { categoryId: 'privat' }).count === 1, 'or by a list name, exact but case-insensitive')
  assert(call('jot_todos', { status: 'review' }).count === 1, 'filter by status')
  const subs = call('jot_todos', { parentId: 't-plain' })
  assert(subs.count === 1 && subs.todos[0].id === 't-sub', 'filter to one task\'s subtasks')
  assert(call('jot_todos', { includeSubtasks: true }).count === 8, 'or ask for subtasks alongside roots')

  const one = call('jot_todo', { id: 't-desc' })
  assert(
    one.todo.description === 'Left because the API is not ready.',
    'jot_todo gives the description in full - the parked-reason field'
  )
  const parent = call('jot_todo', { id: 't-plain' })
  assert(
    parent.todo.subtaskList.length === 1 && parent.todo.subtaskList[0].id === 't-sub',
    'and the subtasks themselves'
  )
  assert(call('jot_todo', { id: 't-done' }).todo.completedDate.startsWith('2026-'),
    'timestamps come with a readable date, so nobody does epoch arithmetic')

  // --- writes -----------------------------------------------------------------
  reset()
  const added = call('jot_add_todo', {
    text: '  Draft the migration plan  ',
    categoryId: 'Work',
    description: 'Because the old one assumed a single writer.',
    priority: -2,
    deadline: 1790000000000
  })
  assert(added.added.text === 'Draft the migration plan', 'jot_add_todo trims the text')
  assert(added.added.categoryId === WORK, 'and resolves a list name to its id')
  const createdOnDisk = onDisk().todos[0]
  assert(createdOnDisk.id === added.added.id, 'the new task lands on TOP, as quick capture does')
  assert(
    Object.keys(createdOnDisk).join(',') ===
      'id,text,status,description,images,categoryId,tags,priority,deadline,pinned,parentId,createdAt,updatedAt,completedAt',
    'with all fifteen fields the app writes, in the same order'
  )
  assert(
    createdOnDisk.status === 'open' && createdOnDisk.pinned === false,
    'open, and not pinned onto his desktop panel'
  )
  assert(createdOnDisk.createdAt === NOW && createdOnDisk.updatedAt === NOW, 'stamped now')
  assert(onDisk().todos.length === 9, 'and nothing else was disturbed')
  const serialised = readFileSync(todosPath, 'utf8')
  assert(
    serialised.startsWith('{\n  "todos"') &&
      serialised.endsWith('}') &&
      !serialised.endsWith('}\n'),
    'serialised byte-for-byte like the app: 2-space JSON, no BOM, no trailing newline'
  )

  reset()
  const loose = call('jot_add_todo', { text: 'No list on purpose' })
  assert(loose.added.categoryId === null, 'a task with no list is allowed - it is a real state')

  reset()
  const sub = call('jot_add_subtask', { parentId: 't-private', text: 'Book the slot' })
  assert(sub.added.parentId === 't-private', 'jot_add_subtask hangs it under the parent')
  assert(sub.added.categoryId === PRIVATE, "and inherits the parent's list, as the app does")
  assert(sub.added.priority === 0, 'with no priority of its own')

  reset()
  const moved = call('jot_set_status', { id: 't-plain', status: 'in-progress' })
  assert(moved.changed.from === 'open' && moved.changed.to === 'in-progress', 'jot_set_status reports the move')
  assert(onDisk().todos.find((t) => t.id === 't-plain').updatedAt === NOW, 'and stamps updatedAt')
  const finished = call('jot_set_status', { id: 't-plain', status: 'done' })
  assert(finished.todo.status === 'done', 'done sticks')
  const doneRow = onDisk().todos.find((t) => t.id === 't-plain')
  assert(doneRow.completedAt === NOW, 'and stamps completedAt, like the app')
  reset()
  call('jot_set_status', { id: 't-done', status: 'open' })
  const reopened = onDisk().todos.find((t) => t.id === 't-done')
  assert(
    reopened.completedAt === null && reopened.pinned === true,
    'coming back out of done clears completedAt again'
  )
  reset()
  call('jot_set_status', { id: 't-done', status: 'done' })
  assert(
    onDisk().todos.find((t) => t.id === 't-done').pinned === false,
    'and finishing a task takes it off the desktop panel, exactly as the app does'
  )

  reset()
  const described = call('jot_set_description', { id: 't-plain', description: 'Blocked on the API.' })
  assert(described.changed.toChars === 19, 'jot_set_description reports the new length')
  assert(
    onDisk().todos.find((t) => t.id === 't-plain').description === 'Blocked on the API.',
    'and writes it'
  )
  call('jot_set_description', { id: 't-desc', description: '' })
  assert(
    onDisk().todos.find((t) => t.id === 't-desc').description === '',
    'an empty string clears one'
  )

  reset()
  const prioritised = call('jot_set_priority', { id: 't-plain', priority: -3 })
  assert(prioritised.changed.from === 0 && prioritised.changed.to === -3, 'jot_set_priority reports the change')
  assert(onDisk().todos.find((t) => t.id === 't-plain').priority === -3, 'and writes it')

  // --- the refusals -----------------------------------------------------------
  refuses('unknown category on create', 'jot_add_todo', { text: 'x', categoryId: 'cat-nope' }, 'Unknown category')
  const namedLists = String(call('jot_add_todo', { text: 'x', categoryId: 'cat-nope' }).error ?? '')
  assert(
    namedLists.includes('Work') && namedLists.includes(WORK),
    'and names the lists that DO exist, with their ids, so the caller can correct itself'
  )
  refuses('unknown status', 'jot_set_status', { id: 't-plain', status: 'blocked' }, 'Unknown status')
  assert(
    String(call('jot_set_status', { id: 't-plain', status: 'blocked' }).error ?? '').includes(
      'in-progress'
    ),
    'and lists the four statuses Jot actually has'
  )
  refuses('empty text on create', 'jot_add_todo', { text: '   ' }, 'needs text')
  refuses('missing text on create', 'jot_add_todo', {}, 'needs text')
  refuses('empty text on a subtask', 'jot_add_subtask', { parentId: 't-plain', text: '' }, 'needs text')
  refuses('parent that does not exist', 'jot_add_subtask', { parentId: 't-ghost', text: 'x' }, 'No task on the board')
  refuses('a subtask as a parent', 'jot_add_subtask', { parentId: 't-sub', text: 'x' }, 'one level only')
  refuses('non-numeric priority', 'jot_set_priority', { id: 't-plain', priority: 'high' }, 'must be a number')
  refuses('fractional priority', 'jot_set_priority', { id: 't-plain', priority: 2.5 }, 'whole number')
  refuses('priority that is not finite', 'jot_set_priority', { id: 't-plain', priority: Number.NaN }, 'must be a number')
  refuses('status write to an id that does not exist', 'jot_set_status', { id: 't-ghost', status: 'done' }, 'No task on the board')
  refuses('description write to an id that does not exist', 'jot_set_description', { id: 't-ghost', description: 'x' }, 'No task on the board')
  refuses('priority write to an id that does not exist', 'jot_set_priority', { id: 't-ghost', priority: 1 }, 'No task on the board')
  refuses('a deadline in seconds', 'jot_add_todo', { text: 'x', deadline: 1790000000 }, 'multiply it by 1000')
  refuses('a description that is not text', 'jot_set_description', { id: 't-plain', description: 42 }, 'must be a string')

  // An ambiguous list name is refused rather than guessed: filing work on the
  // wrong list is worse than an error, because nobody goes looking for it there.
  reset()
  const twins = fixture()
  twins.categories.push({ id: 'cat-twin', name: 'Work', color: '#fff', createdAt: 3 })
  writeFileSync(todosPath, JSON.stringify(twins, null, 2), 'utf8')
  const ambiguous = call('jot_add_todo', { text: 'x', categoryId: 'Work' })
  assert(
    typeof ambiguous.error === 'string' && ambiguous.error.includes('does not say which one'),
    'two lists with one name is refused, not guessed'
  )

  // An unreadable board is never written over. keel's readJsonFile would hand back
  // an empty board here, which for a WRITER means replacing a recoverable file
  // (a half-synced write, a conflict copy) with nothing.
  writeFileSync(todosPath, '{ "todos": [ {', 'utf8')
  const brokenBefore = hash()
  const broken = call('jot_add_todo', { text: 'x' })
  assert(
    typeof broken.error === 'string' && broken.error.includes('not valid JSON'),
    'an unparseable board is reported'
  )
  assert(hash() === brokenBefore, 'and left exactly as it was, not replaced with an empty one')
  assert(typeof call('jot_todos', {}).error === 'string', 'reads refuse it too')

  await fsp.rm(todosPath)
  const missing = call('jot_todos', {})
  assert(
    missing.error.includes('JOT_DATA_DIR'),
    'a board that is not there points at the likeliest cause, the data directory'
  )

  // --- losing a race with the app --------------------------------------------
  // Both the app and this process rewrite the whole file. Without the
  // compare-before-swap guard, whichever renames last silently reverts the other,
  // and a lost write is worse than a refused one - nobody knows to redo it.
  reset()
  let attempts = 0
  const raced = mutateBoard(todosPath, (board) => {
    attempts += 1
    if (attempts === 1) {
      // The app writes while this mutation is being decided.
      const theirs = onDisk()
      theirs.todos.push(makeTodo('t-app', 'typed into the app'))
      writeFileSync(todosPath, JSON.stringify(theirs, null, 2), 'utf8')
    }
    board.todos.unshift(makeTodo('t-mcp', 'written by the server'))
    return { added: 't-mcp' }
  })
  assert(raced.added === 't-mcp', 'a write that loses the race still lands')
  assert(attempts === 2, 'because it was re-read and re-applied rather than forced through')
  const bothPresent = onDisk().todos
  assert(
    bothPresent.some((t) => t.id === 't-mcp') && bothPresent.some((t) => t.id === 't-app'),
    "and the app's edit survived - neither write clobbered the other"
  )

  // A board that keeps moving is refused rather than forced. Slow on purpose: the
  // atomic write backs off between attempts because the data folder is normally
  // synced, and a lock that clears in 200ms is the common case.
  reset()
  let forever = 0
  const gaveUp = mutateBoard(todosPath, (board) => {
    forever += 1
    const theirs = onDisk()
    theirs.todos.push(makeTodo(`t-app-${forever}`, 'still typing'))
    writeFileSync(todosPath, JSON.stringify(theirs, null, 2), 'utf8')
    board.todos.unshift(makeTodo('t-never', 'never lands'))
    return { added: 't-never' }
  })
  assert(
    typeof gaveUp.error === 'string' && gaveUp.error.includes('changed underneath'),
    'a board that never settles is refused'
  )
  assert(
    !onDisk().todos.some((t) => t.id === 't-never'),
    'and nothing of that write reached the file'
  )
  assert(readBoard(todosPath).board.todos.length > 8, "while the other writer's edits are all still there")

  console.log(
    exitCode === 0
      ? 'VERIFY OK: every read, every write, and every refusal - each refusal leaving the file untouched.'
      : 'VERIFY FAILED.'
  )
} finally {
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
}
process.exit(exitCode)
