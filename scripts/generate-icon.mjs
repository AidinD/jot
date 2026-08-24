import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import {
  renderPng,
  renderIco,
  coverage,
  diagonalRamp,
  distArc,
  distPolyline,
  SMALL_BELOW
} from 'keel/icon'

/*
 * Jot's app icon.
 *
 * The mark is the one in the header (`src/renderer/src/main/JotMark.tsx`): a
 * circle interrupted at the top right, and a tick whose long arm leaves through
 * the gap. The geometry below is that component's, scaled off its 100-unit
 * viewBox, so the mark beside the wordmark and the mark in the taskbar are the
 * same drawing. Change one, change the other.
 *
 * The PNG writer, the ICO writer and the distance-field helpers now live in
 * `keel/icon`, shared with the rest of the suite. This file is only Jot's
 * geometry and its colour. It used to carry its own copy of all of that, which
 * is how four apps ended up with four copies of the same 120 lines.
 *
 * Two drawings, per the family rule: the full mark at 32px and up, and below
 * that a heavier ring with a wider bite and a shorter tick, because at 16px the
 * true weight thins under a pixel and the counter inside the ring closes up.
 *
 * Run with `node scripts/generate-icon.mjs`. The output is committed, because
 * packaging must not depend on having run a script first.
 */

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'resources')
mkdirSync(outDir, { recursive: true })

/** Coral: Jot's slot on the family's warm spectrum. JotMark's gradient stops. */
const coral = diagonalRamp([255, 154, 60], [255, 107, 107])

/*
 * Both drawings as fractions of the canvas, matching JotMark's 100-unit viewBox.
 *
 * FULL is that component's geometry: r=30 at (50,52), stroke 9, and the
 * 294-degree sweep its "154 34" dash describes over a 188-unit circumference.
 *
 * SMALL is the same mark redrawn to survive: a heavier ring, a wider bite, and a
 * slightly larger radius so the counter inside the ring stays open. Without it,
 * 16px is an orange blob with a notch - which is what shipped when there was
 * only one drawing.
 *
 * ## Both were scaled up on 2026-08-24
 *
 * The ring's ink covered 69% of the box, against 83% for Nib's mark and 83% for
 * Tend's, so Jot looked like the small one whenever the suite's headers were seen
 * side by side. FULL is scaled by 1.203 about its own centre and SMALL by 1.078,
 * both bringing the ink to 83%; the drawings are otherwise untouched, and
 * JotMark.tsx carries the same factor so the header and the taskbar agree.
 */
const FULL = {
  centreY: 0.52,
  radius: 0.361,
  weight: 0.108,
  sweep: 294,
  tick: [
    [0.3075, 0.544],
    [0.4519, 0.6884],
    [0.8368, 0.1832]
  ]
}

const SMALL = {
  centreY: 0.5,
  radius: 0.35,
  weight: 0.129,
  sweep: 250,
  tick: [
    [0.2843, 0.5216],
    [0.4246, 0.6671],
    [0.8235, 0.1982]
  ]
}

/** A ring with a bite out of its top right, and a tick leaving through the bite. */
function shadeMark(x, y, size) {
  const mark = size < SMALL_BELOW ? SMALL : FULL

  const distance = Math.min(
    distArc(x, y, size * 0.5, size * mark.centreY, size * mark.radius, 0, mark.sweep),
    distPolyline(
      x,
      y,
      mark.tick.map(([tx, ty]) => [size * tx, size * ty])
    )
  )

  const alpha = coverage(distance, (size * mark.weight) / 2)
  if (alpha === 0) {
    return [0, 0, 0, 0]
  }
  const [red, green, blue] = coral(x, y, size)
  return [red, green, blue, Math.round(255 * alpha)]
}

// The PNG electron-builder falls back to (and what non-Windows targets use).
writeFileSync(join(outDir, 'icon.png'), renderPng(512, shadeMark))

// What ships on Windows: every size drawn rather than resampled, including the
// 20 and 24 the taskbar asks for at 125% and 150% display scaling.
writeFileSync(join(outDir, 'icon.ico'), renderIco(shadeMark))

console.log('Wrote resources/icon.png and resources/icon.ico')
