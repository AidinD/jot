// mutateBoard under real competing processes.
//
// WHY THIS EXISTS. `mutateBoard` is one of three writers in the suite that guard a
// whole-file write with keel/storage's pre-rename hook, and it was the only one
// with no concurrency test at all - so a change to that shared hook could alter
// its behaviour with nothing anywhere noticing. That is not hypothetical: on
// 2026-09-03 the shared writer stopped spinning four attempts on a refused guard
// (correct - it was re-checking a stale expectation), and this loop turned out to
// have been leaning on that spinning as a crude delay between its own attempts. An
// independent review measured it refusing 3-11% of writes with six competing
// processes, and every existing test stayed green because none of them ran two
// writers at once.
//
// The contract asserted here is the one that matters for a shared document:
//
//   EVERY WRITE EITHER LANDS OR IS REFUSED. Never silently lost.
//
// WHAT THE REFUSAL-RATE ASSERTION IS AND IS NOT. It is a coarse guard: it would
// catch a writer that began refusing a large share of writes. It does NOT
// discriminate the specific regression above - re-measured on this machine at 8
// processes x 40 writes, three attempts with no backoff and eight with a jittered
// backoff both came out at 0-0.3%, inside the noise, because a later fix (writing
// the temp file INSIDE the write lock rather than before it) serialises writers and
// cut the collision rate for every caller. So do not read a green run here as
// evidence that the backoff is doing something; read it as evidence that nothing is
// losing writes. The lost / phantom / warning assertions are the load-bearing ones.
//
// Runs against a scratch directory, never the real board.
//
// Run:  node scripts/test-mcp-concurrent-writes.mjs
//       JOT_CONC_WORKERS=6 JOT_CONC_ITERATIONS=40 node scripts/test-mcp-concurrent-writes.mjs
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = fileURLToPath(import.meta.url)
const BOARD_MODULE = new URL('../src/mcp/board.js', import.meta.url).href

// Contended by default: loss needs two writers inside the same few microseconds, so
// a small sample's silence means nothing. Aggregated over rounds for the same reason.
const WORKERS = Number(process.env.JOT_CONC_WORKERS || 6)
const ITERATIONS = Number(process.env.JOT_CONC_ITERATIONS || 25)
const ROUNDS = Number(process.env.JOT_CONC_ROUNDS || 2)

const CATEGORY = 'cat-conc'

// ---------------------------------------------------------------------------
// Worker mode: move this worker's own cards to `review`, one mutateBoard call
// each, and report what the board said about every one.
// ---------------------------------------------------------------------------
if (process.env.JOT_CONC_WORKER) {
  const id = process.env.JOT_CONC_WORKER
  const board = process.env.JOT_CONC_BOARD
  const { mutateBoard } = await import(BOARD_MODULE)

  const accepted = []
  const refused = []
  let mutations = 0
  for (let i = 0; i < ITERATIONS; i += 1) {
    const cardId = `${id}-${i}`
    const result = mutateBoard(board, (b) => {
      mutations += 1
      const todo = b.container.todos.find((t) => t.id === cardId)
      if (!todo) {
        return { error: `card ${cardId} missing` }
      }
      todo.status = 'review'
      return { ok: true }
    })
    if (result && result.error) {
      refused.push({ cardId, error: result.error })
    } else {
      accepted.push(cardId)
    }
  }
  process.stdout.write(JSON.stringify({ id, accepted, refused, mutations }))
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Parent mode.
// ---------------------------------------------------------------------------
let exitCode = 0
const assert = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} - ${msg}`)
  if (!cond) {
    exitCode = 1
  }
}

function seedBoard(dir) {
  const board = path.join(dir, 'todos.json')
  const todos = []
  for (let worker = 0; worker < WORKERS; worker += 1) {
    for (let i = 0; i < ITERATIONS; i += 1) {
      todos.push({
        id: `w${worker}-${i}`,
        text: `card ${worker}/${i}`,
        status: 'open',
        description: '',
        images: [],
        categoryId: CATEGORY,
        tags: [],
        priority: 0,
        deadline: null,
        parentId: null,
        createdAt: Date.now(),
        completedAt: null
      })
    }
  }
  // Two-space JSON, no BOM, no trailing newline - the app's own shape.
  fs.writeFileSync(board, JSON.stringify({ categories: [{ id: CATEGORY, name: 'Concurrency' }], tags: [], todos }, null, 2), 'utf8')
  return board
}

function runRound(board) {
  return Promise.all(
    Array.from({ length: WORKERS }, (_, worker) => {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [HERE], {
          env: { ...process.env, JOT_CONC_WORKER: `w${worker}`, JOT_CONC_BOARD: board, JOT_CONC_ITERATIONS: String(ITERATIONS) },
          stdio: ['ignore', 'pipe', 'pipe']
        })
        let out = ''
        let err = ''
        child.stdout.on('data', (chunk) => {
          out += chunk
        })
        child.stderr.on('data', (chunk) => {
          err += chunk
        })
        child.on('error', reject)
        child.on('exit', (status) => {
          if (status !== 0 || !out) {
            reject(new Error(`worker w${worker} exited ${status}: ${err || 'no output'}`))
            return
          }
          // A worker's warning is a finding, not noise: keel/storage writes to
          // stderr exactly when it had to fall back to a weaker guarantee, and a
          // worker running with no write lock at all would otherwise be invisible
          // in a green run.
          resolve({ ...JSON.parse(out), stderr: err.trim() })
        })
      })
    })
  )
}

const perRound = WORKERS * ITERATIONS
const all = { accepted: [], refused: [], mutations: 0, lost: [], phantom: [], warnings: [] }

for (let round = 0; round < ROUNDS; round += 1) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jot-mcp-concurrent-'))
  const board = seedBoard(dir)

  const results = await runRound(board)

  const accepted = results.flatMap((r) => r.accepted)
  const refused = results.flatMap((r) => r.refused)
  const after = JSON.parse(fs.readFileSync(board, 'utf8'))
  const inReview = new Set(after.todos.filter((t) => t.status === 'review').map((t) => t.id))

  all.accepted.push(...accepted)
  all.refused.push(...refused)
  all.mutations += results.reduce((sum, r) => sum + r.mutations, 0)
  all.lost.push(...accepted.filter((id) => !inReview.has(id)))
  all.phantom.push(...refused.filter(({ cardId }) => inReview.has(cardId)))
  all.warnings.push(...results.filter((r) => r.stderr).map((r) => `${r.id}: ${r.stderr.split('\n')[0]}`))

  assert(after.todos.length === perRound, `round ${round + 1}: the board still holds all ${perRound} cards (has ${after.todos.length})`)
  const temps = fs.readdirSync(dir).filter((f) => f.includes('.tmp'))
  assert(temps.length === 0, `round ${round + 1}: no orphaned temp files (found ${temps.length})`)

  fs.rmSync(dir, { recursive: true, force: true })
}

const total = perRound * ROUNDS

// THE assertion: an accepted write that is not on the board is one something
// renamed over, which is the silent loss the guard and the lock exist to prevent.
assert(
  all.lost.length === 0,
  `no accepted write was silently lost (${all.accepted.length} accepted, ${all.lost.length} lost${all.lost.length ? `: ${all.lost.slice(0, 5).join(', ')}` : ''})`
)

// And its converse: a refusal has to mean nothing was written, or a caller cannot
// safely re-run its mutation.
assert(all.phantom.length === 0, `no refused write landed anyway (${all.refused.length} refused, ${all.phantom.length} phantom)`)

assert(all.warnings.length === 0, `no worker fell back to a weaker guarantee (${all.warnings.length}${all.warnings.length ? `: ${all.warnings[0]}` : ''})`)

// The retry must actually be re-reading and re-applying, or this file is not
// testing the thing it was written for.
const reapplied = all.mutations - total
assert(reapplied > 0, `collisions were re-read and re-applied (${reapplied} extra mutations over ${total} writes)`)

// THE RATE THAT REGRESSED. A refusal is safe but useless: it hands the caller back
// a collision that a re-read would have absorbed. Measured at 3-11% with three
// attempts and no backoff; with a jittered backoff it should sit near zero.
const refusedPct = ((all.refused.length / total) * 100).toFixed(1)
console.log(`INFO - ${ROUNDS} rounds x ${WORKERS} workers x ${ITERATIONS} writes: ${all.accepted.length} accepted, ${all.refused.length} refused (${refusedPct}%), ${reapplied} collisions re-applied`)
for (const { cardId, error } of all.refused.slice(0, 3)) {
  console.log(`INFO - refusal sample ${cardId}: ${error}`)
}
assert(all.refused.length / total < 0.02, `under 2% of writes were refused (${refusedPct}%)`)

console.log(
  exitCode === 0
    ? '\nVERIFY OK: competing processes either land their write or are refused, and a collision is re-read rather than handed back.'
    : '\nVERIFY FAILED'
)
process.exit(exitCode)
