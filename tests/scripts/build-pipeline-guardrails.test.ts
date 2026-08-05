import { readFileSync } from 'fs'
import { resolve } from 'path'

import { describe, expect, test } from 'vitest'

const ROOT = resolve(__dirname, '..', '..')
const scripts = (
  JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
).scripts

describe('native rebuild stays cacheable', () => {
  // `-f` disables @electron/rebuild's own skip logic AND its module-state
  // cache, which is what made the binary recompile on every install, every
  // `make dev`, and 8 times per build.yml run. Correctness is enforced by
  // scripts/native/assert-native-abi.mjs instead.
  test.each(['postinstall', 'rebuild:electron', 'rebuild:node'])(
    '`%s` does not force a native rebuild',
    (name) => {
      expect(scripts[name]).not.toMatch(/(^|\s)-f(\s|$)/)
      expect(scripts[name]).not.toContain('--force')
    }
  )

  test.each(['postinstall', 'rebuild:electron', 'rebuild:node'])(
    '`%s` routes through the cache-aware rebuild script',
    (name) => {
      expect(scripts[name]).toContain('scripts/native/rebuild-native.mjs')
    }
  )

  test('postinstall targets the electron ABI, rebuild:node targets node', () => {
    expect(scripts.postinstall).toMatch(/rebuild-native\.mjs electron$/)
    expect(scripts['rebuild:electron']).toMatch(/rebuild-native\.mjs electron$/)
    expect(scripts['rebuild:node']).toMatch(/rebuild-native\.mjs node$/)
  })
})

describe('memory clamps from the June 2026 incident stay in place', () => {
  // Measured: --concurrency=auto was SLOWER (22.9s vs 21.3s) and used
  // 34.6GB vs 3.4GB, because each worker builds its own TS program.
  test('eslint concurrency stays off', () => {
    expect(scripts.lint).toContain('--concurrency=off')
    expect(scripts['lint:check']).toContain('--concurrency=off')
    expect(scripts['lint:check']).not.toContain('--concurrency=auto')
  })

  test('typecheck stays serialized', () => {
    expect(scripts.typecheck).not.toContain('run-p')
    expect(scripts.typecheck).toContain('&&')
  })

  test('the Makefile does not fan out with -jN', () => {
    const makefile = readFileSync(resolve(ROOT, 'Makefile'), 'utf8')
    expect(makefile).not.toMatch(/\$\(MAKE\)\s+-j\d+/)
  })
})
