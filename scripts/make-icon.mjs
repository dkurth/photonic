// Draws the app icon (build/icon.png, 1024×1024) as 32×32 pixel art, scaled up 32×.
// Pure Node: a tiny PNG encoder, no image libraries. Run: node scripts/make-icon.mjs
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const GRID = 32
const SCALE = 32
const C = {
  ink: [17, 17, 17, 255],
  accent: [255, 209, 102, 255], // Arcade yellow
  like: [239, 71, 111, 255], // Arcade pink
  sky: [17, 138, 178, 255], // Arcade blue
  hill: [6, 214, 160, 255], // Arcade green
  peak: [7, 59, 76, 255], // Arcade deep teal
  snow: [244, 241, 234, 255],
  paper: [244, 241, 234, 255]
}

const px = Array.from({ length: GRID }, () => Array(GRID).fill(null))
const rect = (x0, y0, x1, y1, c) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px[y][x] = c
}
/** Rounded tile: corners cut by one cell. */
const tile = (x0, y0, x1, y1, fill, border) => {
  rect(x0 + 1, y0, x1 - 1, y1, border)
  rect(x0, y0 + 1, x1, y1 - 1, border)
  rect(x0 + 1, y0 + 1, x1 - 1, y1 - 1, fill)
}

// Hard drop shadow, then the yellow tile (Gumroad-style raised button).
tile(4, 4, 29, 29, C.ink, C.ink)
tile(2, 2, 27, 27, C.accent, C.ink)

// The "photo": a framed landscape.
rect(6, 6, 23, 22, C.ink)
rect(7, 7, 22, 21, C.sky)
// Pink pixel heart as the sun.
const heart = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...']
heart.forEach((row, y) => [...row].forEach((ch, x) => ch === 'X' && (px[8 + y][14 + x] = C.like)))
// Mountains.
for (let i = 0; i <= 6; i++) rect(7 + i, 21 - i, 19 - i, 21 - i, C.peak) // big peak, apex at (13,15)
rect(12, 15, 14, 15, C.snow)
rect(13, 14, 13, 14, C.snow)
for (let i = 0; i <= 4; i++) rect(16 + i, 21 - i, 22, 21 - i, C.hill) // smaller hill on the right

// Two little "buttons" under the photo: Meh (blue) and Like (pink), each with an ink shadow.
rect(8, 24, 13, 25, C.ink)
rect(7, 23, 12, 24, C.sky)
rect(17, 24, 22, 25, C.ink)
rect(16, 23, 21, 24, C.like)

// --- encode PNG ---
const W = GRID * SCALE
const raw = Buffer.alloc((W * 4 + 1) * W)
for (let y = 0; y < W; y++) {
  raw[y * (W * 4 + 1)] = 0 // filter: none
  for (let x = 0; x < W; x++) {
    const c = px[Math.floor(y / SCALE)][Math.floor(x / SCALE)] ?? [0, 0, 0, 0]
    raw.set(c, y * (W * 4 + 1) + 1 + x * 4)
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(W, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])
writeFileSync(new URL('../build/icon.png', import.meta.url), png)
console.log(`build/icon.png written (${W}×${W}, ${png.length} bytes)`)
