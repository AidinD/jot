import { deflateSync } from 'zlib'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

/*
 * Jot's app icon, drawn without dependencies.
 *
 * The mark is the one in the header (`src/renderer/src/main/JotMark.tsx`): a
 * circle interrupted at the top right, and a tick whose long arm leaves through
 * the gap. The geometry below is that component's, scaled off its 100-unit
 * viewBox, so the mark beside the wordmark and the mark in the taskbar are the
 * same drawing. Change one, change the other.
 *
 * Two drawings, not one - the family rule Nib's generator sets out:
 *
 *  - The full mark at 32px and up, with the ring at its true weight.
 *  - A heavier ring, a wider gap and a shorter tick below 32, where the true
 *    weight thins to a smudge and the tick's tip to a stray pixel.
 *
 * Both go into a multi-size icon.ico, so Windows picks the drawing meant for the
 * size it is asking for instead of downscaling the detailed one. That is the fix
 * for the soft tray mark: it was never the drawing, it was shipping a single
 * 256px PNG and letting Windows shrink it.
 *
 * The PNG and ICO writers are Nib's (`nib/scripts/generate-icon.mjs`), kept
 * byte-compatible on purpose - two apps, one icon pipeline.
 *
 * Run with `node scripts/generate-icon.mjs`. The output is committed, because
 * packaging must not depend on having run a script first.
 */

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'resources')
mkdirSync(outDir, { recursive: true })

// ---------- PNG ----------

function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i]
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

function renderPng(size, shade) {
  const rows = []
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4)
    for (let x = 0; x < size; x += 1) {
      row.set(shade(x + 0.5, y + 0.5, size), 1 + x * 4)
    }
    rows.push(row)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---------- ICO ----------

/**
 * A Vista-era .ico: a directory of entries, each holding a whole PNG.
 *
 * Written by hand so the small sizes can be a different drawing. Handing
 * electron-builder a single large PNG would have it downscale that one drawing
 * to 16px, which is exactly what the second drawing exists to avoid.
 */
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)

  const directory = []
  let offset = 6 + images.length * 16
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size // 0 means 256
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0 // palette
    entry[3] = 0 // reserved
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    directory.push(entry)
    offset += png.length
  }

  return Buffer.concat([header, ...directory, ...images.map((image) => image.png)])
}

// ---------- distance fields ----------

const mix = (a, b, t) => a + (b - a) * t
const rad = (deg) => (deg * Math.PI) / 180

function distSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax
  const aby = by - ay
  const lengthSquared = abx * abx + aby * aby
  if (lengthSquared === 0) {
    return Math.hypot(px - ax, py - ay)
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSquared))
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t))
}

/** Distance to an open polyline - the tick is two segments meeting at the elbow. */
function distPolyline(px, py, points) {
  let best = Infinity
  for (let i = 0; i < points.length - 1; i += 1) {
    best = Math.min(best, distSegment(px, py, ...points[i], ...points[i + 1]))
  }
  return best
}

/**
 * Distance to an arc running clockwise from `fromDeg` to `toDeg`, measured the
 * way SVG measures it: 0 degrees at three o'clock, increasing clockwise because
 * y points down.
 *
 * Outside the sweep the distance is taken to the nearer endpoint rather than to
 * the circle, which is what gives the arc its round caps for free - the same
 * caps the header SVG gets from stroke-linecap.
 */
function distArc(px, py, cx, cy, r, fromDeg, toDeg) {
  const dx = px - cx
  const dy = py - cy
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI
  if (angle < 0) {
    angle += 360
  }
  const withinSweep =
    fromDeg <= toDeg ? angle >= fromDeg && angle <= toDeg : angle >= fromDeg || angle <= toDeg
  if (withinSweep) {
    return Math.abs(Math.hypot(dx, dy) - r)
  }
  return Math.min(
    Math.hypot(px - (cx + r * Math.cos(rad(fromDeg))), py - (cy + r * Math.sin(rad(fromDeg)))),
    Math.hypot(px - (cx + r * Math.cos(rad(toDeg))), py - (cy + r * Math.sin(rad(toDeg))))
  )
}

/** Anti-aliasing: coverage falls off across about a pixel of distance. */
function coverage(distance, halfWeight, feather = 1.1) {
  return Math.max(0, Math.min(1, (halfWeight - distance) / feather + 0.5))
}

/** The coral ramp from JotMark's gradient, run across the diagonal. */
function coral(x, y, size) {
  const t = Math.max(0, Math.min(1, (x / size) * 0.5 + (y / size) * 0.5))
  return [255, Math.round(mix(154, 107, t)), Math.round(mix(60, 107, t))]
}

// ---------- the two drawings ----------

/*
 * The two drawings, as fractions of the canvas.
 *
 * FULL is JotMark's geometry over its 100-unit viewBox: r=30 at (50,52),
 * stroke 9, and the 294-degree sweep its "154 34" dash describes over a
 * 188-unit circumference.
 *
 * SMALL is the same mark redrawn to survive: a heavier ring, a wider bite, and
 * a slightly larger radius so the counter inside the ring stays open. Without
 * it, 16px is an orange blob with a notch - which is what ships today, because
 * today there is only one drawing.
 *
 * The changeover is at 32. Below it the full weight thins under a pixel; at 32
 * and up the full drawing is the better of the two, so the small twin never
 * gets used where it would look heavy.
 */
const FULL = {
  centreY: 0.52,
  radius: 0.3,
  weight: 0.09,
  sweep: 294,
  tick: [
    [0.34, 0.54],
    [0.46, 0.66],
    [0.78, 0.24]
  ]
}

const SMALL = {
  centreY: 0.5,
  radius: 0.325,
  weight: 0.12,
  sweep: 250,
  tick: [
    [0.3, 0.52],
    [0.43, 0.655],
    [0.8, 0.22]
  ]
}

/** A ring with a bite out of its top right, and a tick leaving through the bite. */
function shadeMark(x, y, size) {
  const mark = size < 32 ? SMALL : FULL

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

// ---------- output ----------

// The PNG electron-builder falls back to (and what non-Windows targets use).
writeFileSync(join(outDir, 'icon.png'), renderPng(512, shadeMark))

/*
 * The one .ico, used for both the packaged app and the tray.
 *
 * It carries 20 and 24 as well as the usual ladder, because the tray asks for
 * those at 125% and 150% display scaling - the two scales where a missing frame
 * means Windows resamples a neighbour and the mark goes soft again.
 *
 * Deliberately one file rather than a small tray-only .ico: on Windows
 * `nativeImage.createFromPath` reports a 256px bitmap for any .ico, so a file
 * whose largest frame is 32 gets upscaled to 256 before anything else happens.
 * Shipping every size means whichever path Windows takes, it finds a real
 * drawing rather than a resample.
 */
writeFileSync(
  join(outDir, 'icon.ico'),
  buildIco(
    [256, 128, 64, 48, 32, 24, 20, 16].map((size) => ({ size, png: renderPng(size, shadeMark) }))
  )
)

console.log('Wrote resources/icon.png and resources/icon.ico')
