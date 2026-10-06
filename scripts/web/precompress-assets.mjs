/**
 * Build-time precompression for the web bundle.
 *
 * Writes `<file>.br` (brotli q11) and `<file>.gz` (gzip -9) siblings for every
 * compressible text asset in the web public dir. `@fastify/static` serves them
 * with `preCompressed: true`, so the server never spends CPU compressing the
 * same immutable chunk twice. Sourcemaps are skipped (only fetched by devtools).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib'

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
 * @returns {{ files: number, rawBytes: number, brotliBytes: number, gzipBytes: number }}
 */
export function precompressDirectory(dir) {
  const summary = { files: 0, rawBytes: 0, brotliBytes: 0, gzipBytes: 0 }
  for (const file of walkFiles(dir)) {
    if (!PRECOMPRESS_EXTENSIONS.has(extname(file))) continue
    if (statSync(file).size < PRECOMPRESS_MIN_BYTES) continue
    const raw = readFileSync(file)
    const br = brotliCompressSync(raw, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length
      }
    })
    const gz = gzipSync(raw, { level: 9 })
    // Only keep a variant that actually saves bytes.
    if (br.length < raw.length) writeFileSync(`${file}.br`, br)
    if (gz.length < raw.length) writeFileSync(`${file}.gz`, gz)
    summary.files += 1
    summary.rawBytes += raw.length
    summary.brotliBytes += Math.min(br.length, raw.length)
    summary.gzipBytes += Math.min(gz.length, raw.length)
  }
  return summary
}
