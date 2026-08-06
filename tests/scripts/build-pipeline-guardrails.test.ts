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
  //
  // 2026-08 fix round 1: a bare `-f` token match missed bundled short-flag
  // clusters. @electron/rebuild's CLI parses args with Node's
  // `util.parseArgs`, which folds `-f -w <module>` into the equivalent
  // `-fw <module>` — same force-rebuild behavior, invisible to a
  // whitespace-anchored `-f` token match. Match any single-dash short-flag
  // cluster containing the letter `f` instead. `--force-abi` also gets an
  // explicit ban: it overrides the ABI @electron/rebuild targets, which is
  // a different flag from `--force` but the same "bypass the cache-aware
  // wrapper" hazard (it is already caught as a substring of `--force`, but
  // named here so a reader doesn't mistake it for an oversight).
  test.each(['postinstall', 'rebuild:electron', 'rebuild:node'])(
    '`%s` does not force a native rebuild',
    (name) => {
      expect(scripts[name]).not.toMatch(/(^|\s)-[a-z]*f[a-z]*(\s|$)/i)
      expect(scripts[name]).not.toContain('--force')
      expect(scripts[name]).not.toContain('--force-abi')
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

  // The package.json scripts above can never contain `-f` themselves — they
  // only invoke this file, which is where the actual `@electron/rebuild`
  // call (and thus the actual hazard) lives. Guarding only the npm scripts
  // watches a place `-f` structurally cannot return to; this guards the
  // place it can.
  //
  // The flag cluster is passed as a JS array element (e.g. `'-f'` or `'-fw'`),
  // not a whitespace-separated shell token, so the boundary class from the
  // npm-script check above must also treat a quote, comma, or paren as a
  // valid flag boundary — otherwise `'-f', '-w'` would slip past a
  // whitespace-only boundary undetected.
  test('the live @electron/rebuild invocation in rebuild-native.mjs never forces a rebuild', () => {
    const source = readFileSync(resolve(ROOT, 'scripts', 'native', 'rebuild-native.mjs'), 'utf8')
    expect(source).not.toMatch(/(^|[\s"'(,])-[a-z]*f[a-z]*([\s"'),]|$)/i)
    expect(source).not.toContain('--force')
    expect(source).not.toContain('--force-abi')
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
    // 2026-08 fix round 1: banning only `run-p` was insufficient.
    // `npm-run-all2` is already a devDependency and ships `npm-run-all
    // --parallel ...` as an equivalent alias with no new dependency
    // required; `concurrently` reproduces the identical fan-out. Any of
    // these recreates the June 2026 blowup (each worker builds its own TS
    // program: 34.6GB vs 3.4GB serialized) while still containing `&&`
    // somewhere in the script.
    expect(scripts.typecheck).not.toContain('run-p')
    expect(scripts.typecheck).not.toContain('npm-run-all')
    expect(scripts.typecheck).not.toContain('--parallel')
    expect(scripts.typecheck).not.toContain('concurrently')
    // `&&` alone is a weak positive signal — it doesn't prove the whole
    // script is serial, only that sequential chaining syntax is present
    // somewhere. Kept alongside the bans above, which do the actual
    // regression-catching, as evidence the chained style hasn't been
    // swapped for a runner wholesale.
    expect(scripts.typecheck).toContain('&&')
  })

  test('the Makefile does not fan out with -j', () => {
    // 2026-08 fix round 1: `-j\d+` only caught the digit-glued spelling.
    // `$(MAKE) -j 4` (space-separated, valid GNU Make) and a bare
    // `$(MAKE) -j` (unbounded parallelism — the actual worst case behind
    // the June 2026 incident) both slipped through. Ban `-j` outright,
    // regardless of what follows it.
    const makefile = readFileSync(resolve(ROOT, 'Makefile'), 'utf8')
    expect(makefile).not.toMatch(/\$\(MAKE\)\s+-j/)
  })
})
