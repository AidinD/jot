// The right-click menu on a card: what it copies, and where it lands.
//
// Both are pure functions in renderer TypeScript, so this test transforms the
// real file with esbuild rather than restating the rules - a copy of the logic
// here could pass forever while the app did something else.
//
// What is actually at risk:
//   1. The reference is an ADDRESS. If the format drifts, every reference
//      already pasted into a conversation stops matching the ones being written
//      now, and nothing announces it.
//   2. The clamp has two bounds pulling opposite ways. A menu taller than the
//      space under the pointer must come UP; a menu taller than the whole
//      window must still start at the margin and not at a negative coordinate,
//      which is the case that puts the "Copy reference" row off-screen.
//
// Run: node scripts/test-card-reference.mjs
import { transformSync } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'src/renderer/src/shared/reference.ts'), 'utf8')
const js = transformSync(source, { loader: 'ts', format: 'esm' }).code
const { todoReference, clampToViewport } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
)

let fails = 0
const ok = (condition, message) => {
  console.log(`${condition ? 'OK  ' : 'FAIL'} - ${message}`)
  if (!condition) {
    fails++
  }
}

// --- what gets copied -----------------------------------------------------
const id = '7e2c1f80-2f3b-4a51-9a1f-2b3c4d5e6f70'
ok(
  todoReference(id, 'Ship the release') === `jot:${id} "Ship the release"`,
  'the reference is the todo\'s own uuid, with its text quoted beside it'
)
ok(
  todoReference(id, '  Ship the release  ') === `jot:${id} "Ship the release"`,
  'surrounding whitespace does not travel into the quotes'
)
ok(
  todoReference(id, '   ') === `jot:${id} "Untitled"`,
  'a card with no text still copies a usable address'
)
ok(
  todoReference(id, 'Fix "quoted" text').startsWith(`jot:${id} `),
  'a quote inside the text does not disturb the id in front of it'
)

// --- where the menu lands -------------------------------------------------
const viewport = { width: 1200, height: 800 }
const size = { width: 240, height: 60 }

const roomy = clampToViewport({ left: 300, top: 200 }, size, viewport)
ok(roomy.left === 300 && roomy.top === 200, 'with room to spare it opens exactly at the pointer')

const rightEdge = clampToViewport({ left: 1190, top: 200 }, size, viewport)
ok(rightEdge.left === 1200 - 240 - 6, 'against the right edge it is pulled back inside')

const bottomEdge = clampToViewport({ left: 300, top: 795 }, size, viewport)
ok(bottomEdge.top === 800 - 60 - 6, 'against the bottom edge it comes up instead of hanging off')

// The one that would actually bite: clamping must not overshoot into negative
// coordinates when the menu does not fit at all - the copy row is at the TOP of
// the menu, so a negative top is the row you cannot click.
const tiny = clampToViewport({ left: 10, top: 10 }, { width: 400, height: 900 }, { width: 320, height: 500 })
ok(tiny.left === 6 && tiny.top === 6, 'a menu larger than the window still starts at the margin, not off it')

console.log(fails === 0 ? '\nAll good.' : `\n${fails} failed.`)
process.exit(fails === 0 ? 0 : 1)
