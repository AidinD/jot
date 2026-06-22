import { deflateSync } from 'zlib'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

// Minimal dependency-free PNG writer. Renders the Jot app icon: a rounded
// accent square with a lighter "tick" notch. Used for the tray and app icon.

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'resources')
mkdirSync(outDir, { recursive: true })

const BG = [27, 28, 31, 255]
const ACCENT = [111, 156, 255, 255]
const MARK = [12, 19, 34, 255]

function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i]
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1)
      crc = (crc >>> 1) ^ (0xedb88320 & mask)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuffer, data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

function renderPng(size) {
  const radius = Math.round(size * 0.22)
  const pad = Math.round(size * 0.12)
  const inner = size - pad * 2

  function pixel(x, y) {
    // Outer rounded square (accent) over transparent background.
    const insideSquare =
      x >= pad && x < size - pad && y >= pad && y < size - pad
    let color = [0, 0, 0, 0]
    if (insideSquare) {
      color = ACCENT
      // Round the corners by clipping.
      const cx = Math.min(x - pad, size - pad - 1 - x)
      const cy = Math.min(y - pad, size - pad - 1 - y)
      if (cx < radius && cy < radius) {
        const dx = radius - cx
        const dy = radius - cy
        if (dx * dx + dy * dy > radius * radius) {
          color = [0, 0, 0, 0]
        }
      }
    }
    // Draw a thick checkmark in the center.
    const fx = (x - pad) / inner
    const fy = (y - pad) / inner
    if (color[3] !== 0) {
      const onUpStroke =
        fx > 0.34 && fx < 0.74 && Math.abs(fy - (1.15 - fx)) < 0.1
      const onDownStroke =
        fx > 0.2 && fx < 0.42 && Math.abs(fy - (fx + 0.32)) < 0.1
      if (onUpStroke || onDownStroke) {
        color = MARK
      }
    }
    return color
  }

  const rows = []
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4)
    row[0] = 0
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x, y)
      const offset = 1 + x * 4
      row[offset] = r
      row[offset + 1] = g
      row[offset + 2] = b
      row[offset + 3] = a
    }
    rows.push(row)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const idat = deflateSync(Buffer.concat(rows))
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

writeFileSync(join(outDir, 'icon.png'), renderPng(256))
writeFileSync(join(outDir, 'tray.png'), renderPng(32))
console.log('Wrote resources/icon.png and resources/tray.png')
