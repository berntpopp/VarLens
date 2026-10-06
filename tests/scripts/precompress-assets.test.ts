import { afterEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'

import { precompressDirectory } from '../../scripts/web/precompress-assets.mjs'
import { compressCached, pruneCompressionCache } from '../../scripts/web/compression-cache.mjs'

describe('precompressDirectory', () => {
  let dir = ''

  afterEach(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  it('writes .br and .gz siblings for large text assets only', () => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-precompress-'))
    mkdirSync(join(dir, 'assets'))
    const js = 'console.info("varlens");\n'.repeat(400)
    writeFileSync(join(dir, 'assets', 'main-abc.js'), js)
    writeFileSync(join(dir, 'assets', 'main-abc.js.map'), js)
    writeFileSync(join(dir, 'assets', 'tiny.css'), 'a{color:red}')
    writeFileSync(join(dir, 'icon.png'), Buffer.alloc(4096, 7))

    const summary = precompressDirectory(dir)

    expect(summary.files).toBe(1)
    expect(
      brotliDecompressSync(readFileSync(join(dir, 'assets', 'main-abc.js.br'))).toString()
    ).toBe(js)
    expect(gunzipSync(readFileSync(join(dir, 'assets', 'main-abc.js.gz'))).toString()).toBe(js)
    expect(existsSync(join(dir, 'assets', 'main-abc.js.map.br'))).toBe(false)
    expect(existsSync(join(dir, 'assets', 'tiny.css.br'))).toBe(false)
    expect(existsSync(join(dir, 'icon.png.br'))).toBe(false)
  })

  it('reuses identical compression and rejects corrupt cached payloads', () => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-precompress-'))
    const output = join(dir, 'public')
    const cacheDir = join(dir, 'cache')
    mkdirSync(output)
    const source = 'export const value = "cached";\n'.repeat(400)
    const file = join(output, 'app.js')
    writeFileSync(file, source)
    const cold = precompressDirectory(output, { cacheDir })
    const original = readFileSync(`${file}.br`)
    expect(cold.cacheHits).toBe(0)
    rmSync(`${file}.br`)
    expect(precompressDirectory(output, { cacheDir }).cacheHits).toBe(1)
    expect(readFileSync(`${file}.br`)).toEqual(original)

    for (const cached of readdirSync(cacheDir)) writeFileSync(join(cacheDir, cached), 'corrupt')
    expect(precompressDirectory(output, { cacheDir }).cacheHits).toBe(0)
    expect(brotliDecompressSync(readFileSync(`${file}.br`)).toString()).toBe(source)
  })

  it('invalidates changed content and removes stale siblings for newly small assets', () => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-precompress-'))
    const output = join(dir, 'public')
    const cacheDir = join(dir, 'cache')
    mkdirSync(output)
    const file = join(output, 'app.js')
    writeFileSync(file, 'const value = 1;\n'.repeat(400))
    precompressDirectory(output, { cacheDir })
    const changed = 'const value = 2;\n'.repeat(400)
    writeFileSync(file, changed)
    expect(precompressDirectory(output, { cacheDir }).cacheHits).toBe(0)
    expect(gunzipSync(readFileSync(`${file}.gz`)).toString()).toBe(changed)
    writeFileSync(file, 'small')
    precompressDirectory(output, { cacheDir })
    expect(existsSync(`${file}.br`)).toBe(false)
    expect(existsSync(`${file}.gz`)).toBe(false)
  })

  it('rejects changed compressor identities and correctly checks hashed but incorrect content', () => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-precompress-'))
    const raw = Buffer.from('asset text;'.repeat(1000))
    const first = compressCached(raw, dir)
    const path = join(dir, readdirSync(dir)[0])
    const entry = JSON.parse(readFileSync(path, 'utf8'))
    writeFileSync(path, JSON.stringify({ ...entry, identity: 'obsolete compressor' }))
    expect(compressCached(raw, dir).cacheHit).toBe(false)
    const wrong = compressCached(Buffer.from('different asset;'.repeat(1000)), dir)
    writeFileSync(
      path,
      JSON.stringify({
        ...entry,
        br: wrong.br.toString('base64'),
        brHash: createHash('sha256').update(wrong.br).digest('hex')
      })
    )
    const repaired = compressCached(raw, dir)
    expect(repaired.cacheHit).toBe(false)
    expect(repaired.br).toEqual(first.br)
    expect(readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  it('bounds cache entries and tolerates an unavailable cache', () => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-precompress-'))
    for (const value of ['one', 'two', 'three'])
      compressCached(Buffer.from(value.repeat(1000)), dir)
    writeFileSync(join(dir, 'unrelated'), 'keep')
    pruneCompressionCache(dir, { maxEntries: 1 })
    expect(readdirSync(dir).filter((name) => name.endsWith('.json'))).toHaveLength(1)
    pruneCompressionCache(dir, { maxBytes: 0 })
    expect(readdirSync(dir)).toEqual(['unrelated'])
    const raw = Buffer.from('uncached'.repeat(1000))
    expect(gunzipSync(compressCached(raw, join(dir, 'unrelated')).gz)).toEqual(raw)
  })

  it('removes stale compression when changed content is incompressible', () => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-precompress-'))
    const output = join(dir, 'public')
    mkdirSync(output)
    const file = join(output, 'app.js')
    writeFileSync(file, 'compressible'.repeat(1000))
    precompressDirectory(output, { cacheDir: join(dir, 'cache') })
    writeFileSync(file, randomBytes(4096))
    precompressDirectory(output, { cacheDir: join(dir, 'cache') })
    expect(existsSync(`${file}.br`)).toBe(false)
    expect(existsSync(`${file}.gz`)).toBe(false)
  })
})
