import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { join } from 'node:path'
import { assertInside, desktopRoot } from './shared.mjs'

const libDir = assertInside(desktopRoot, join(desktopRoot, 'lib'), 'desktop library directory')
rmSync(libDir, { recursive: true, force: true })
mkdirSync(libDir, { recursive: true })
copyFileSync(join(desktopRoot, 'src', 'main.mjs'), join(libDir, 'main.mjs'))
copyFileSync(join(desktopRoot, 'src', 'preload.mjs'), join(libDir, 'preload.mjs'))

function crc32(data) {
  let crc = 0xffffffff
  for (const value of data) {
    crc ^= value
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, checksum])
}

function createIcon(size = 512) {
  const stride = size * 4 + 1
  const pixels = Buffer.alloc(stride * size)
  const nodes = [[0.32, 0.34], [0.68, 0.34], [0.5, 0.66]]
  for (let y = 0; y < size; y += 1) {
    pixels[y * stride] = 0
    for (let x = 0; x < size; x += 1) {
      const at = y * stride + 1 + x * 4
      const nx = x / size
      const ny = y / size
      const dx = nx - 0.5
      const dy = ny - 0.5
      const rounded = Math.max(Math.abs(dx), Math.abs(dy)) < 0.43 || dx * dx + dy * dy < 0.34
      let r = rounded ? Math.round(16 + 17 * ny) : 0
      let g = rounded ? Math.round(70 + 54 * (1 - ny)) : 0
      let b = rounded ? Math.round(146 + 74 * (1 - nx)) : 0
      let alpha = rounded ? 255 : 0
      const lineDistance = Math.abs((ny - 0.34) - 0.88 * Math.abs(nx - 0.5))
      if (rounded && lineDistance < 0.018 && ny < 0.68) r = g = b = 222
      for (const [cx, cy] of nodes) {
        const distance = Math.hypot(nx - cx, ny - cy)
        if (distance < 0.075) r = g = b = 255
        if (distance < 0.075) alpha = 255
      }
      pixels[at] = r
      pixels[at + 1] = g
      pixels[at + 2] = b
      pixels[at + 3] = alpha
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(join(desktopRoot, 'build'), { recursive: true })
writeFileSync(join(desktopRoot, 'build', 'app-icon.png'), createIcon())
console.log(`Built Electron entry files and application icon in ${desktopRoot}`)
