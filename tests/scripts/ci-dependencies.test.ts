import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installedFingerprint } from '../../scripts/ci/dependencies.mjs'

const roots: string[] = []

function installedTree(): {
  root: string
  cache: string
  write: (path: string, text: string) => void
} {
  const root = mkdtempSync(join(tmpdir(), 'varlens-ci-deps-'))
  roots.push(root)
  const write = (path: string, text: string): void => {
    const target = join(root, 'node_modules', path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
  }
  write('left-pad/index.js', 'module.exports = 1\n')
  write('better-sqlite3-multiple-ciphers/lib/index.js', 'module.exports = {}\n')
  write('node-gyp/gyp/pylib/gyp/common.py', 'pass\n')
  return { root, cache: join(root, 'digests.json'), write }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('installed dependency fingerprint', () => {
  it('ignores what a cold native compile writes into node_modules', async () => {
    const { root, cache, write } = installedTree()
    const before = await installedFingerprint(root, cache)

    // @electron/rebuild copies the compiled addon here, keyed by platform and ABI.
    write(
      'better-sqlite3-multiple-ciphers/bin/linux-x64-148/better-sqlite3-multiple-ciphers.node',
      'x'
    )
    write('better-sqlite3-multiple-ciphers/build/Release/better_sqlite3.node', 'x')
    // node-gyp's Python leaves bytecode caches next to its sources.
    write('node-gyp/gyp/pylib/gyp/__pycache__/common.cpython-312.pyc', 'x')
    write('node-gyp/gyp/pylib/packaging/__pycache__/version.cpython-312.pyc', 'x')

    expect(await installedFingerprint(root, cache)).toBe(before)
  })

  it('still detects a changed, added or removed dependency file', async () => {
    const { root, cache, write } = installedTree()
    const before = await installedFingerprint(root, cache)

    write('left-pad/index.js', 'module.exports = 2\n')
    const changed = await installedFingerprint(root, cache)
    expect(changed).not.toBe(before)

    write('left-pad/bin/cli.js', '#!/usr/bin/env node\n')
    const added = await installedFingerprint(root, cache)
    expect(added).not.toBe(changed)

    // The addon's own JavaScript and node-gyp's Python sources stay covered.
    write('better-sqlite3-multiple-ciphers/lib/index.js', 'module.exports = { tampered: true }\n')
    const addonSource = await installedFingerprint(root, cache)
    expect(addonSource).not.toBe(added)

    write('node-gyp/gyp/pylib/gyp/common.py', 'import os\n')
    expect(await installedFingerprint(root, cache)).not.toBe(addonSource)
  })
})
