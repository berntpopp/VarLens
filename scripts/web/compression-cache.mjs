import { createHash, randomUUID } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import {
  brotliCompressSync,
  brotliDecompressSync,
  constants,
  gunzipSync,
  gzipSync
} from 'node:zlib'

const IDENTITY = JSON.stringify({
  schema: 1,
  node: process.versions.node,
  zlib: process.versions.zlib,
  brotli: process.versions.brotli,
  brotliQuality: 11,
  gzipLevel: 9
})
const CACHE_FILE = /^[a-f0-9]{64}\.json$/
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

function restore(path, raw, rawHash) {
  try {
    // Bound input and decompression before inspecting an untrusted cache entry.
    if (statSync(path).size > raw.length * 4 + 4096) return null
    const entry = JSON.parse(readFileSync(path, 'utf8'))
    if (entry.identity !== IDENTITY || entry.rawHash !== rawHash) return null
    const br = Buffer.from(entry.br, 'base64')
    const gz = Buffer.from(entry.gz, 'base64')
    if (sha256(br) !== entry.brHash || sha256(gz) !== entry.gzHash) return null
    const bounds = { maxOutputLength: raw.length }
    if (!brotliDecompressSync(br, bounds).equals(raw) || !gunzipSync(gz, bounds).equals(raw)) {
      return null
    }
    return { br, gz, cacheHit: true }
  } catch {
    return null
  }
}

export function compressCached(raw, cacheDir) {
  const rawHash = sha256(raw)
  const key = sha256(`${IDENTITY}\0${rawHash}`)
  const path = join(cacheDir, `${key}.json`)
  const restored = restore(path, raw, rawHash)
  if (restored) return restored

  const br = brotliCompressSync(raw, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: raw.length
    }
  })
  const gz = gzipSync(raw, { level: 9 })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(
      temporary,
      JSON.stringify({
        identity: IDENTITY,
        rawHash,
        brHash: sha256(br),
        gzHash: sha256(gz),
        br: br.toString('base64'),
        gz: gz.toString('base64')
      }),
      { flag: 'wx' }
    )
    renameSync(temporary, path)
  } catch {
    // Cache availability must not change the resulting production assets.
  } finally {
    try {
      rmSync(temporary, { force: true })
    } catch {
      // A read-only cache can still serve valid entries.
    }
  }
  return { br, gz, cacheHit: false }
}

export function pruneCompressionCache(
  cacheDir,
  { maxBytes = 256 * 1024 * 1024, maxEntries = 512 } = {}
) {
  try {
    const entries = readdirSync(cacheDir)
      .filter((name) => CACHE_FILE.test(name))
      .map((name) => {
        const path = join(cacheDir, name)
        const info = statSync(path)
        return { path, size: info.size, modified: info.mtimeMs }
      })
      .sort((a, b) => b.modified - a.modified)
    let bytes = 0
    for (const [index, entry] of entries.entries()) {
      bytes += entry.size
      if (index >= maxEntries || bytes > maxBytes) rmSync(entry.path, { force: true })
    }
  } catch {
    // Concurrent pruning or unavailable caches only affect future hit rates.
  }
}
