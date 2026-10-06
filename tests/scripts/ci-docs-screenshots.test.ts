import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  screenshotFingerprint,
  verifyScreenshots,
  recordScreenshots,
  prepareDocs
} from '../../scripts/ci/docs-screenshots.mjs'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'varlens-docs-policy-'))
  roots.push(root)
  for (const directory of ['src', 'tests/e2e', 'docs/public/screenshots', 'capture'])
    mkdirSync(join(root, directory), { recursive: true })
  writeFileSync(join(root, 'src/app.ts'), 'app')
  writeFileSync(join(root, 'package-lock.json'), '{}')
  writeFileSync(
    join(root, 'tests/e2e/screenshots.e2e.ts'),
    "const EXPECTED_SCREENSHOTS = ['app'] as const"
  )
  writeFileSync(join(root, 'docs/index.md'), '# Docs')
  writeFileSync(join(root, 'docs/public/screenshots/app.png'), 'old tracked pixels')
  writeFileSync(join(root, 'capture/app.png'), Buffer.from('89504e470d0a1a0a00000000', 'hex'))
  return {
    root,
    directory: join(root, 'capture'),
    fingerprint: screenshotFingerprint({ root, identity: 'test' })
  }
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('capture artifacts are bound to their actual inputs', () => {
  test('prose preserves fingerprint, source/tool inputs invalidate it', () => {
    const input = fixture()
    writeFileSync(join(input.root, 'docs/index.md'), '# New prose')
    expect(screenshotFingerprint({ root: input.root, identity: 'test' })).toBe(input.fingerprint)
    expect(screenshotFingerprint({ root: input.root, identity: 'other-host' })).not.toBe(
      input.fingerprint
    )
    writeFileSync(join(input.root, 'src/app.ts'), 'changed')
    expect(screenshotFingerprint({ root: input.root, identity: 'test' })).not.toBe(
      input.fingerprint
    )
  })

  test('missing, stale or corrupt artifacts require recapture', () => {
    const input = fixture()
    expect(verifyScreenshots(input)).toBe(false)
    recordScreenshots(input)
    expect(verifyScreenshots(input)).toBe(true)
    expect(verifyScreenshots({ ...input, fingerprint: 'other' })).toBe(false)
    writeFileSync(join(input.directory, 'app.png'), 'corrupt')
    expect(verifyScreenshots(input)).toBe(false)
    expect(() => prepareDocs(input)).toThrow(/verified screenshot/)
  })

  test('missing capture never falls back to tracked PNGs', () => {
    const input = fixture()
    rmSync(join(input.directory, 'app.png'))
    expect(() => recordScreenshots(input)).toThrow(/app.png/)
  })

  test('docs preparation cannot replace the source tree or its cache root', () => {
    const input = fixture()
    recordScreenshots(input)
    for (const destination of ['docs', '.cache', '.cache/../../elsewhere']) {
      expect(() => prepareDocs({ ...input, destination })).toThrow(/destination/)
    }
  })

  test('docs preparation leaves tracked screenshots untouched', () => {
    const input = fixture()
    recordScreenshots(input)
    const destination = prepareDocs(input)
    expect(readFileSync(join(destination, 'public/screenshots/app.png'))).toEqual(
      readFileSync(join(input.directory, 'app.png'))
    )
    expect(readFileSync(join(input.root, 'docs/public/screenshots/app.png'), 'utf8')).toBe(
      'old tracked pixels'
    )
  })
})
