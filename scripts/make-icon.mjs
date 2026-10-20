/**
 * Generates assets/tunedrop.ico — the TuneDrop mark drawn from code:
 * an amber rounded square with the ink play triangle, plus a small cream
 * waveform in the corner. Hand-rolled ICO (BMP entries, 32bpp) so no image
 * tooling is needed. Sizes: 16/32/48/64/128/256.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(here, '..', 'assets', 'tunedrop.ico')

const SIZES = [16, 32, 48, 64, 128, 256]

/* palette (RGB) */
const AMBER = [0xf2, 0xa3, 0x3c]
const INK = [0x16, 0x13, 0x0f]
const CREAM = [0xed, 0xe6, 0xd8]

/* shape coverage at (x, y) in unit space, anti-aliased by 2x2 supersampling */
function roundedRectDist(x, y, cx, cy, hx, hy, r) {
  const qx = Math.abs(x - cx) - (hx - r)
  const qy = Math.abs(y - cy) - (hy - r)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r
}

function triangleSd(px, a, b, c) {
  const sd = (p, v1, v2) => {
    const e1x = v2[0] - v1[0], e1y = v2[1] - v1[1]
    const w1x = p[0] - v1[0], w1y = p[1] - v1[1]
    const t = Math.max(0, Math.min(1, (w1x * e1x + w1y * e1y) / (e1x * e1x + e1y * e1y)))
    const bx = w1x - t * e1x, by = w1y - t * e1y
    return Math.sign(e1x * by - e1y * bx) * Math.hypot(bx, by)
  }
  return Math.max(sd(px, [a[0], a[1]], [b[0], b[1]]), sd(px, [b[0], b[1]], [c[0], c[1]]), sd(px, [c[0], c[1]], [a[0], a[1]]))
}

/** coverage of a signed distance at pixel edge e: 1 inside, 0 outside, ramp over AA px */
function cov(dist, px) {
  const aa = (1.0 / px) * 1.2
  return Math.max(0, Math.min(1, (aa / 2 - dist) / aa))
}

function drawAt(size) {
  const data = Buffer.alloc(size * size * 4)

  for (let yi = 0; yi < size; yi++) {
    for (let xi = 0; xi < size; xi++) {
      let bg = 0
      let tri = 0
      let bars = 0
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const x = (xi + (sx + 0.5) / 2) / size
          const y = (yi + (sy + 0.5) / 2) / size
          const dSq = roundedRectDist(x, y, 0.5, 0.5, 0.47, 0.47, 0.20)
          bg += cov(dSq, size)
          tri += cov(-triangleSd([x, y], [0.38, 0.24], [0.38, 0.76], [0.78, 0.5]), size)
          // small cream waveform bars, lower-right corner (outside the triangle)
          bars +=
            (roundedRectDist(x, y, 0.675, 0.70, 0.022, 0.055, 0.022) < 0 ? 1 : 0) +
            (roundedRectDist(x, y, 0.735, 0.66, 0.022, 0.095, 0.022) < 0 ? 1 : 0)
        }
      }
      // normalize 4-sample coverage
      bg /= 4; tri /= 4; bars = Math.min(1, bars / 4)

      // composite: amber bg → ink triangle → cream bars on top
      let r = AMBER[0], g = AMBER[1], b = AMBER[2]
      if (bars > 0) {
        r = r + (CREAM[0] - r) * bars
        g = g + (CREAM[1] - g) * bars
        b = b + (CREAM[2] - b) * bars
      }
      if (tri > 0) {
        r = r + (INK[0] - r) * tri
        g = g + (INK[1] - g) * tri
        b = b + (INK[2] - b) * tri
      }
      const a = bg
      const off = (yi * size + xi) * 4
      data[off] = Math.round(b)
      data[off + 1] = Math.round(g)
      data[off + 2] = Math.round(r)
      data[off + 3] = Math.round(a * 255)
    }
  }
  return data
}

/** pack one BMP image entry (XOR 32bpp bottom-up + empty AND mask) */
function bmpEntry(xorData, size) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0) // biSize
  header.writeInt32LE(size, 4) // width
  header.writeInt32LE(size * 2, 8) // height: XOR + AND
  header.writeUInt16LE(1, 12) // planes
  header.writeUInt16LE(32, 14) // bpp
  header.writeUInt32LE(0, 16) // BI_RGB
  header.writeUInt32LE(size * size * 4, 20) // XOR bytes
  const maskStride = Math.ceil(size / 32) * 4 // 1bpp, 32-bit aligned
  const mask = Buffer.alloc(maskStride * size)
  return Buffer.concat([header, xorData, mask])
}

const images = SIZES.map((s) => ({ size: s, data: drawAt(s) }))

const entries = images.map(({ data, size }) => ({ size, entry: bmpEntry(data, size) }))
const count = entries.length
const dir = Buffer.alloc(6)
dir.writeUInt16LE(0, 0)
dir.writeUInt16LE(1, 2) // type: icon
dir.writeUInt16LE(count, 4)

const directorySize = 6 + count * 16
let offset = directorySize
const table = []
const blobs = []
for (const { size, entry } of entries) {
  const d = Buffer.alloc(16)
  d.writeUInt8(size === 256 ? 0 : size, 0)
  d.writeUInt8(size === 256 ? 0 : size, 1)
  d.writeUInt8(0, 2)
  d.writeUInt8(0, 3)
  d.writeUInt16LE(1, 4) // planes
  d.writeUInt16LE(32, 6) // bpp
  d.writeUInt32LE(entry.length, 8)
  d.writeUInt32LE(offset, 12)
  offset += entry.length
  table.push(d)
  blobs.push(entry)
}

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, Buffer.concat([dir, ...table, ...blobs]))
console.log(`wrote ${OUT} (${(6 + count * 16 + entries.reduce((n, e) => n + e.entry.length, 0)) / 1024} KB, ${count} sizes)`)
