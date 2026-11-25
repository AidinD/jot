// Subtask sort: the comparator is a view over the stored order, never a rewrite.
// Checks numeric-aware compare ("10." after "9."), Swedish collation (a-z, then
// å, ä, ö), oldest-first by createdAt, stability on ties, and that the input
// array is not mutated. The real renderer module is bundled with esbuild, so
// this tests the shipped code rather than a restated copy.
//
// Run: node scripts/test-subtask-sort.mjs
import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jot-sort-')), 'subtaskSort.mjs')
await build({
  entryPoints: [path.join(root, 'src/renderer/src/shared/subtaskSort.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out
})
const { sortSubtasks } = await import(pathToFileURL(out).href)

let fails = 0
const ok = (c, m) => {
  console.log(`${c ? 'OK  ' : 'FAIL'} - ${m}`)
  if (!c) {
    fails++
  }
}
const mk = (text, createdAt) => ({ id: text, text, createdAt, status: 'open' })
const texts = (l) => l.map((t) => t.text)
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const books = [
  mk('10. Nonviolent Communication', 5),
  mk('9. The Coaching Habit', 4),
  mk('3. Radical Candor', 1),
  mk('15. Psychological safety', 3),
  mk('4. Crucial Conversations', 2)
]
const before = texts(books)

ok(
  eq(texts(sortSubtasks(books, 'alpha')), [
    '3. Radical Candor',
    '4. Crucial Conversations',
    '9. The Coaching Habit',
    '10. Nonviolent Communication',
    '15. Psychological safety'
  ]),
  'alpha is numeric-aware: 9 before 10 before 15'
)
ok(
  eq(texts(sortSubtasks(books, 'created')), [
    '3. Radical Candor',
    '4. Crucial Conversations',
    '15. Psychological safety',
    '9. The Coaching Habit',
    '10. Nonviolent Communication'
  ]),
  'created sorts oldest first'
)
ok(sortSubtasks(books, 'manual') === books, 'manual returns the stored order untouched')
ok(eq(texts(books), before), 'sorting never mutates the input')

const sv = ['Ö', 'Z', 'Ä', 'A', 'Å', 'z', 'a'].map((t, i) => mk(t, i))
ok(
  eq(texts(sortSubtasks(sv, 'alpha')), ['A', 'a', 'Z', 'z', 'Å', 'Ä', 'Ö']),
  'Swedish collation: z, then å, ä, ö'
)

const ties = [mk('b', 1), mk('a', 1), mk('b', 1)].map((t, i) => ({ ...t, id: String(i) }))
ok(
  eq(sortSubtasks(ties, 'created').map((t) => t.id), ['0', '1', '2']),
  'equal createdAt keeps the manual order (stable)'
)
ok(
  eq(sortSubtasks(ties, 'alpha').map((t) => t.id), ['1', '0', '2']),
  'equal text keeps the manual order (stable)'
)

if (fails > 0) {
  console.log(`${fails} failed`)
  process.exit(1)
}
console.log('all passed')
