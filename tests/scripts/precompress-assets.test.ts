import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'

import { precompressDirectory } from '../../scripts/web/precompress-assets.mjs'

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
})
