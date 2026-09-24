// สร้างไอคอน PNG ของ PWA จากรูปทรงเดียวกับ public/icon.svg โดยไม่ต้องพึ่ง library ภาพ
// รัน: npm run icons
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const BG = [0x40, 0x52, 0xd6]
const FG = [0xff, 0xff, 0xff]
const R = 8.4 // รัศมีวง ในหน่วย viewBox 32
const STROKE = 2.8
const DOT = 2.3
const GAP_FROM = (-50 * Math.PI) / 180 // ช่องว่างของวงอยู่ระหว่าง -50° ถึง 0°
const capA = [16 + R * Math.cos(GAP_FROM), 16 + R * Math.sin(GAP_FROM)]
const dot = [16 + R, 16]

function inRoundRect(x, y, radius) {
  const cx = Math.min(Math.max(x, radius), 32 - radius)
  const cy = Math.min(Math.max(y, radius), 32 - radius)
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

function inGlyph(x, y) {
  const dx = x - 16
  const dy = y - 16
  const angle = Math.atan2(dy, dx)
  const onRing = Math.abs(Math.hypot(dx, dy) - R) <= STROKE / 2 && !(angle > GAP_FROM && angle < 0)
  const onCap = Math.hypot(x - capA[0], y - capA[1]) <= STROKE / 2
  const onDot = Math.hypot(x - dot[0], y - dot[1]) <= DOT
  return onRing || onCap || onDot
}

function render(size, { maskable }) {
  const ss = 4
  const px = Buffer.alloc(size * size * 4)
  // maskable ต้องเต็มกรอบ และย่อรูปให้อยู่ใน safe zone 80%
  const glyphScale = maskable ? 0.72 : 1
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let bg = 0
      let fg = 0
      for (let sj = 0; sj < ss; sj++) {
        for (let si = 0; si < ss; si++) {
          const x = ((i + (si + 0.5) / ss) / size) * 32
          const y = ((j + (sj + 0.5) / ss) / size) * 32
          if (!(maskable || inRoundRect(x, y, 8))) continue
          bg++
          const gx = 16 + (x - 16) / glyphScale
          const gy = 16 + (y - 16) / glyphScale
          if (inGlyph(gx, gy)) fg++
        }
      }
      const n = ss * ss
      const o = (j * size + i) * 4
      const f = bg ? fg / bg : 0
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(BG[c] * (1 - f) + FG[c] * f)
      px[o + 3] = Math.round((bg / n) * 255)
    }
  }
  return encodePng(size, size, px)
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const out = new URL('../public/', import.meta.url)
writeFileSync(new URL('pwa-192.png', out), render(192, { maskable: false }))
writeFileSync(new URL('pwa-512.png', out), render(512, { maskable: false }))
writeFileSync(new URL('pwa-maskable-512.png', out), render(512, { maskable: true }))
console.log('icons written to public/')
