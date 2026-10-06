/**
 * Build-time precompression for the web bundle.
 *
 * Writes `<file>.br` (brotli q11) and `<file>.gz` (gzip -9) siblings for every
 * compressible text asset in the web public dir. `@fastify/static` serves them
 * with `preCompressed: true`, so the server never spends CPU compressing the
 * same immutable chunk twice. Sourcemaps are skipped (only fetched by devtools).
 */
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { compressCached, pruneCompressionCache } from './compression-cache.mjs'

export const PRECOMPRESS_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.css',
  '.html',
  '.svg',
  '.json',
  '.webmanifest',
  '.txt',
  '.wasm'
])

export const PRECOMPRESS_MIN_BYTES = 1024

function* walkFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walkFiles(full)
    else if (entry.isFile()) yield full
  }
}

/**
 * @param {string} dir absolute path to the built public directory
 * @param {{ cacheDir?: string }} options
 * @returns {{ files: number, rawBytes: number, brotliBytes: number, gzipBytes: number, cacheHits: number }}
 */
export function precompressDirectory(dir, { cacheDir = resolve('.cache/precompress') } = {}) {
  const summary = { files: 0, rawBytes: 0, brotliBytes: 0, gzipBytes: 0, cacheHits: 0 }
  for (const file of walkFiles(dir)) {
    if (!PRECOMPRESS_EXTENSIONS.has(extname(file))) continue
    if (statSync(file).size < PRECOMPRESS_MIN_BYTES) {
      rmSync(`${file}.br`, { force: true })
      rmSync(`${file}.gz`, { force: true })
      continue
    }
    const raw = readFileSync(file)
    const { br, gz, cacheHit } = compressCached(raw, cacheDir)
    if (cacheHit) summary.cacheHits += 1
    // Only keep a variant that actually saves bytes.
    if (br.length < raw.length) writeFileSync(`${file}.br`, br)
    else rmSync(`${file}.br`, { force: true })
    if (gz.length < raw.length) writeFileSync(`${file}.gz`, gz)
    else rmSync(`${file}.gz`, { force: true })
    summary.files += 1
    summary.rawBytes += raw.length
    summary.brotliBytes += Math.min(br.length, raw.length)
    summary.gzipBytes += Math.min(gz.length, raw.length)
  }
  pruneCompressionCache(cacheDir)
  return summary
}
