#!/usr/bin/env node
// Renders every VarLens icon (desktop, web, docs) from the vector sources in
// resources/brand/. Each pixel size uses the drawing made for it, so small
// icons stay sharp instead of being a blurred downscale of the master:
//   varlens-xs.svg  16 px grid      varlens-m.svg     48–64 px
//   varlens-s.svg   24–32 px grid   varlens-full.svg  128 px and up
// Requires rsvg-convert (librsvg). Run: npm run icons:generate
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const BRAND = join(ROOT, 'resources/brand')
const PUBLIC = join(ROOT, 'src/renderer/public')
const source = (tier) => readFileSync(join(BRAND, `varlens-${tier}.svg`), 'utf8')
const tierFor = (px) => (px <= 16 ? 'xs' : px <= 32 ? 's' : px <= 64 ? 'm' : 'full')

const tmp = mkdtempSync(join(tmpdir(), 'varlens-icons-'))
let renders = 0

function render(svg, px) {
  const input = join(tmp, `${renders}.svg`)
  const output = join(tmp, `${renders++}.png`)
  writeFileSync(input, svg)
  execFileSync('rsvg-convert', ['-w', String(px), '-h', String(px), input, '-o', output])
  return assertPng(readFileSync(output), px)
}

const tiered = (px) => render(source(tierFor(px)), px)

function assertPng(png, px) {
  const isPng = png.subarray(1, 4).toString('latin1') === 'PNG'
  if (!isPng || png.readUInt32BE(16) !== px || png.readUInt32BE(20) !== px) {
    throw new Error(`expected a ${px}x${px} PNG`)
  }
  return png
}

function replaceOnce(text, find, replacement) {
  if (!text.includes(find)) throw new Error(`brand source changed: missing ${find}`)
  return text.replace(find, replacement)
}

const innerOf = (svg) => svg.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')

// Opaque square tile for iOS / Android, which apply their own corner mask.
function fullBleed() {
  let svg = source('full')
  svg = replaceOnce(
    svg,
    '<rect width="512" height="512" rx="112" fill="url(#tile)"/>',
    '<rect width="512" height="512" fill="url(#tile)"/>'
  )
  svg = replaceOnce(
    svg,
    '<rect width="512" height="512" rx="112" fill="url(#glow)"/>',
    '<rect width="512" height="512" fill="url(#glow)"/>'
  )
  return svg.replace(/<rect x="1\.5" y="1\.5"[^>]*\/>/, '')
}

// Android adaptive icons crop to a circle: keep the art inside the 80% safe zone.
function maskable() {
  const svg = fullBleed()
  const start = svg.indexOf('<g transform="translate(256 252)')
  if (start < 0) throw new Error('brand source changed: content group not found')
  const end = svg.lastIndexOf('</svg>')
  return `${svg.slice(0, start)}<g transform="translate(256 256) scale(0.8) translate(-256 -256)">${svg.slice(start, end)}</g></svg>\n`
}

// macOS app-icon grid: 824 px body centred on a 1024 canvas, with a soft shadow.
function macos() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs><filter id="mac-shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000000" flood-opacity="0.3"/></filter></defs><g filter="url(#mac-shadow)"><g transform="translate(100 100) scale(1.609375)">${innerOf(source('full'))}</g></g></svg>\n`
}

// ICO with embedded PNGs (Windows Vista+).
function ico(sizes) {
  const images = sizes.map(tiered)
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach((png, i) => {
    const entry = 6 + 16 * i
    header.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], entry)
    header.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], entry + 1)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  const file = Buffer.concat([header, ...images])
  if (file.readUInt16LE(4) !== sizes.length) throw new Error('ICO self-check failed')
  return file
}

// ICNS with PNG payloads. Small slots use the pixel-grid drawings, the rest the macOS grid.
function icns() {
  const mac = macos()
  const slots = [
    ['icp4', 16],
    ['icp5', 32],
    ['ic11', 32],
    ['icp6', 64],
    ['ic12', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic13', 256],
    ['ic09', 512],
    ['ic14', 512],
    ['ic10', 1024]
  ]
  const chunks = slots.map(([type, px]) => {
    const png = px <= 64 ? tiered(px) : render(mac, px)
    const head = Buffer.alloc(8)
    head.write(type, 0, 'latin1')
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'latin1')
  const file = Buffer.concat([head, ...chunks])
  file.writeUInt32BE(file.length, 4)
  return file
}

try {
  execFileSync('rsvg-convert', ['--version'])
} catch {
  console.error('build-icons: rsvg-convert (librsvg) is required')
  process.exit(1)
}

try {
  const windowsIco = ico([16, 24, 32, 48, 64, 128, 256])
  const write = (path, data) => writeFileSync(join(ROOT, path), data)

  // Desktop (electron-builder + the dev-mode window icon in src/main/index.ts).
  write('build/icon.icns', icns())
  write('build/icon.ico', windowsIco)
  write('build/icon.png', tiered(1024))
  for (const px of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    write(`build/icons/${px}x${px}.png`, tiered(px))
  }
  write('resources/icon.ico', windowsIco)
  write('resources/icon.png', tiered(512))
  copyFileSync(join(BRAND, 'varlens-full.svg'), join(ROOT, 'resources/icon.svg'))

  // Web app + desktop renderer (favicons, PWA, iOS, login wall).
  copyFileSync(join(BRAND, 'varlens-s.svg'), join(PUBLIC, 'favicon.svg'))
  write('src/renderer/public/favicon.ico', ico([16, 32, 48]))
  write('src/renderer/public/apple-touch-icon.png', render(fullBleed(), 180))
  write('src/renderer/public/icon-192.png', tiered(192))
  write('src/renderer/public/icon-512.png', tiered(512))
  write('src/renderer/public/icon-maskable-512.png', render(maskable(), 512))

  // Docs site + README.
  copyFileSync(join(BRAND, 'varlens-m.svg'), join(ROOT, 'docs/public/logo.svg'))
  console.log(`build-icons: ${renders} renders from resources/brand/`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
