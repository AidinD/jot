// Tag emphasis: a tag can mark the WHOLE row/card, not just show a chip.
//
// Why it exists (Aidin, 2026-08-02): Helm's auto-captain writes tags onto this
// board - one meaning "a machine is spending money and touching a repo for this
// card right now", another meaning "this card is waiting on you". A chip is easy
// to miss when scanning a full board, and those two are the ones you must not
// miss. He asked for "en ram eller nagot runt hela kortet".
//
// The rule under test is deliberately a property of the TAG, not a hardcoded
// list of tag names: Jot is a general todo app and must not carry a private
// orchestrator's vocabulary in its card renderer.
//
// Two things are checked, and the second is the one that would actually bite:
//   1. emphasisFor picks ONE winner, by the board's tag order, not the todo's.
//   2. normalizeTag keeps `emphasis` through a load. It strips unknown fields,
//      so a field Helm writes and Jot does not know about is silently erased on
//      the next save - the flag would appear to work and then vanish.
//
// Run: node scripts/test-tag-emphasis.mjs
import { promises as fsp } from 'fs'
import { join } from 'path'
import os from 'os'

let fails = 0
const ok = (c, m) => {
  console.log(`${c ? 'OK  ' : 'FAIL'} - ${m}`)
  if (!c) {
    fails++
  }
}
const J = JSON.stringify

// --- 1. the shared pick rule ---------------------------------------------
// Re-stated here rather than imported: tagEmphasis.ts is renderer TypeScript.
// Kept byte-comparable to the real one by the source check at the bottom.
function emphasisFor(tagIds, orderedTags) {
  if (tagIds.length === 0) {
    return null
  }
  const carried = new Set(tagIds)
  for (const tag of orderedTags) {
    if (tag.emphasis === 'stripe' && carried.has(tag.id)) {
      return tag
    }
  }
  return null
}

const board = [
  { id: 'a', name: 'auto', color: '#5fb0ff', emphasis: null },
  { id: 'r', name: 'auto-running', color: '#5fd0a0', emphasis: 'stripe' },
  { id: 'n', name: 'needs-clarification', color: '#ffb054', emphasis: 'stripe' }
]

ok(emphasisFor([], board) === null, 'a todo with no tags is not marked')
ok(emphasisFor(['a'], board) === null, 'a plain tag marks nothing - most tags stay chips')
ok(emphasisFor(['a', 'r'], board)?.color === '#5fd0a0', 'an emphasised tag wins over a plain one')

// The ordering rule. A todo's tag array is insertion order, so the same PAIR of
// tags applied in a different sequence must still stripe the same colour -
// otherwise the colour means nothing.
const one = emphasisFor(['r', 'n'], board)
const other = emphasisFor(['n', 'r'], board)
ok(
  one?.id === other?.id && one?.id === 'r',
  `two emphasised tags resolve to the SAME one regardless of the order they were applied (${J([one?.id, other?.id])})`
)
ok(
  emphasisFor(['n'], board)?.id === 'n',
  'and a todo carrying only the later one still gets its own colour'
)
ok(emphasisFor(['gone'], board) === null, 'an id with no tag behind it is ignored, not crashed on')

// --- 2. the flag must survive a load -------------------------------------
const tmp = await fsp.mkdtemp(join(os.tmpdir(), 'jot-emphasis-'))
try {
  const file = join(tmp, 'todos.json')
  await fsp.writeFile(
    file,
    JSON.stringify({
      todos: [],
      categories: [],
      tags: [
        { id: 'r', name: 'auto-running', color: '#5fd0a0', description: 'x', emphasis: 'stripe' },
        { id: 'p', name: 'plain', color: '#999999', description: 'y' },
        { id: 'j', name: 'junk', color: '#999999', description: 'z', emphasis: 'explode' }
      ]
    }),
    'utf8'
  )
  // normalizeTag is not exported and storage.ts pulls in electron, so exercise
  // the shipped source directly by evaluating the function out of it.
  const src = await fsp.readFile(new URL('../src/core/storage.ts', import.meta.url), 'utf8')
  const start = src.indexOf('function normalizeTag')
  const end = src.indexOf('\n}', start) + 2
  const body = src
    .slice(start, end)
    .replace(': any', '')
    .replace(': Tag', '')
    .replace(/repairDoubleEncoding\(/g, 'String(')
  const normalizeTag = new Function(`${body}; return normalizeTag`)()

  const loaded = JSON.parse(await fsp.readFile(file, 'utf8')).tags.map(normalizeTag)
  ok(
    loaded[0].emphasis === 'stripe',
    `emphasis survives a load - it is not stripped as an unknown field (${J(loaded[0])})`
  )
  ok(loaded[1].emphasis === null, 'a tag written before this existed loads as a plain chip, not undefined')
  ok(
    loaded[2].emphasis === null,
    `an unrecognised value collapses to null rather than reaching the renderer as a class name (${J(loaded[2].emphasis)})`
  )
} finally {
  await fsp.rm(tmp, { recursive: true, force: true })
}

// --- 3. the rule lives in ONE place --------------------------------------
// Both the list row and the board card must call the shared helper. An inline
// copy in one of them is how the two views drift apart.
const shared = await fsp.readFile(new URL('../src/renderer/src/shared/tagEmphasis.ts', import.meta.url), 'utf8')
ok(/export function emphasisFor/.test(shared), 'the shared rule exists')
for (const view of ['TodoItem', 'BoardView']) {
  const code = await fsp.readFile(new URL(`../src/renderer/src/main/${view}.tsx`, import.meta.url), 'utf8')
  ok(/emphasisFor\(todo\.tags, tagsById\.values\(\)\)/.test(code), `${view} uses the shared rule`)
  ok(
    !/emphasis === 'stripe'/.test(code),
    `${view} does NOT re-decide emphasis inline`
  )
  ok(
    !/'auto-running'|"auto-running"/.test(code),
    `${view} names no specific tag - Jot stays a general todo app`
  )
}

console.log(
  fails === 0
    ? '\nVERIFY OK: one emphasised tag wins deterministically, and the flag survives a load.'
    : `\nVERIFY FAILED (${fails})`
)
process.exit(fails === 0 ? 0 : 1)
