import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { formatCacheLocation } from '../../scripts/format.mjs'

const fixtures: string[] = []
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'varlens-format-cache-'))
  fixtures.push(dir)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ prettier: { semi: false } }))
  writeFileSync(join(dir, 'package-lock.json'), '{"lockfileVersion":3}')
  return dir
}
afterEach(() => fixtures.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

describe('format cache invalidation', () => {
  it('survives dependency reinstall but invalidates when config or plugin lock changes', () => {
    const dir = fixture()
    const first = formatCacheLocation(dir)
    mkdirSync(join(dir, 'node_modules'))
    rmSync(join(dir, 'node_modules'), { recursive: true })
    expect(formatCacheLocation(dir)).toBe(first)
    writeFileSync(join(dir, 'package-lock.json'), '{"lockfileVersion":3,"plugin":"new"}')
    const changedLock = formatCacheLocation(dir)
    expect(changedLock).not.toBe(first)
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ prettier: { semi: true } }))
    expect(formatCacheLocation(dir)).not.toBe(changedLock)
    expect(first).toContain(join('.cache', 'prettier'))
  })

  it('does not reuse a successful check after the formatting policy changes', () => {
    const dir = fixture()
    writeFileSync(join(dir, 'sample.js'), 'const value = 1\n')
    const run = (): ReturnType<typeof spawnSync> =>
      spawnSync(process.execPath, [resolve('scripts/format.mjs'), '--check', 'sample.js'], {
        cwd: dir,
        encoding: 'utf8'
      })
    expect(run().status).toBe(0)
    expect(run().status).toBe(0)
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ prettier: { semi: true } }))
    expect(run().status).toBe(1)
    expect(readFileSync(join(dir, 'sample.js'), 'utf8')).toBe('const value = 1\n')
  })
})
