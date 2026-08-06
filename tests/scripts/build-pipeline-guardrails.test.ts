import { readFileSync } from 'fs'
import { resolve } from 'path'

import { describe, expect, test } from 'vitest'

const ROOT = resolve(__dirname, '..', '..')
const scripts = (
  JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
).scripts

const WORKFLOW_DIR = resolve(ROOT, '.github', 'workflows')
const readWorkflow = (name: string): string => readFileSync(resolve(WORKFLOW_DIR, name), 'utf8')

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

describe('cross-workflow rebuild elimination (spec Phase 8)', () => {
  test('never caches the bare .cache root, which would collide with tsbuildinfo', () => {
    // Catches every spelling of "cache the whole .cache root" that YAML
    // allows: unquoted, single-quoted, double-quoted, with-or-without a
    // trailing slash — and the block-scalar `path: |` form (build.yml's own
    // "Restore lint caches" step already uses that style for a multi-path
    // cache list, so it is the most realistic way a future author would
    // accidentally cache the whole root instead of a scoped subdirectory).
    const bareCacheEntry = /^[ \t]*(['"]?)\.cache\/?\1[ \t]*$/m

    for (const name of ['build.yml', 'web-ci.yml', 'publish-web.yml', 'docs.yml']) {
      const yaml = readWorkflow(name)

      // Single-line form: `path: .cache`, `path: '.cache'`, `path: ".cache"`,
      // `path: .cache/`, and quoted-with-slash variants.
      expect(yaml, `${name} must not cache the bare .cache root`).not.toMatch(
        /^[ \t]*path:[ \t]*(['"]?)\.cache\/?\1[ \t]*$/m
      )

      // Block-scalar form: `path: |` (or `>`, with optional chomping
      // indicator) followed by one or more indented entries, one per line.
      // A block entry qualifies only while it is indented deeper than the
      // `path:` key itself — that is how YAML delimits the scalar block, and
      // it is also what stops this capture at the next mapping key (e.g.
      // `key:`) which sits back at the `path:` key's own indentation.
      for (const match of yaml.matchAll(
        /^([ \t]*)path:[ \t]*[|>][+-]?[ \t]*\n((?:\1[ \t]+\S.*\n?)*)/gm
      )) {
        const block = match[2]
        expect(
          block,
          `${name} must not cache the bare .cache root in a block-scalar path list`
        ).not.toMatch(bareCacheEntry)
      }
    }
  })

  test('keys the native cache on os, arch, electron version and lockfile, with no restore-keys, across every workflow that declares one', () => {
    // Task 7 (build.yml, web-ci.yml, publish-web.yml, docs.yml) and release.yml
    // (which must have none — it promotes build.yml's artifacts, it never
    // rebuilds) are all scanned. A per-file "at least one" minimum would be
    // wrong here because release.yml legitimately has zero; the vacuous-pass
    // guard below is instead "at least one across the whole set", with
    // release.yml's zero asserted separately and explicitly further down.
    const workflowNames = ['build.yml', 'web-ci.yml', 'publish-web.yml', 'docs.yml', 'release.yml']
    let totalKeys = 0

    for (const name of workflowNames) {
      const yaml = readWorkflow(name)
      const keys = [...yaml.matchAll(/key:\s*(native-[^\n]*)/g)].map((m) => m[1])
      totalKeys += keys.length

      for (const key of keys) {
        expect(key, `${name}: native- key must pin runner.os`).toContain('runner.os')
        expect(key, `${name}: native- key must pin runner.arch`).toContain('runner.arch')
        expect(key, `${name}: native- key must pin the electron version`).toContain(
          'electron-ver.outputs.ver'
        )
        expect(key, `${name}: native- key must pin the lockfile hash`).toContain(
          "hashFiles('package-lock.json')"
        )
      }

      // A partial match would leave a wrong-ABI .node on disk. No fallback,
      // ever. Scoped to `native-` keys only — the `ebtools-` toolset cache
      // legitimately uses restore-keys, and must not trip this assertion.
      const nativeBlocks = yaml.split('key: native-').slice(1)
      for (const block of nativeBlocks) {
        const untilNextStep = block.split(/\n\s*-\s/)[0]
        expect(untilNextStep, `${name}: native cache must not declare restore-keys`).not.toContain(
          'restore-keys'
        )
      }
    }

    expect(
      totalKeys,
      'at least one scanned workflow must declare a native- cache key'
    ).toBeGreaterThan(0)

    // Explicit, not just relying on the loop above passing vacuously on zero
    // keys: proves release.yml staying rebuild-free (see the "no longer
    // builds or packages" test below) also stays cache-free, so a future
    // regression that reintroduces a native rebuild there is caught here too.
    const releaseKeys = [...readWorkflow('release.yml').matchAll(/key:\s*(native-[^\n]*)/g)]
    expect(releaseKeys.length, 'release.yml must not declare any native- cache key').toBe(0)
  })

  test('release.yml no longer builds or packages the app', () => {
    const yaml = readWorkflow('release.yml')
    expect(yaml, 'release.yml must promote build.yml artifacts, not rebuild').not.toContain(
      'electron-builder'
    )
    expect(yaml).not.toContain('electron-vite build')
  })

  test('release.yml grants actions:read so it can read another run’s artifacts', () => {
    expect(readWorkflow('release.yml')).toContain('actions: read')
  })

  test('build.yml can be re-run against a ref, so expired artifacts are recoverable', () => {
    // `gh run rerun` is only permitted for 30 days; artifacts are retained for 90.
    expect(readWorkflow('build.yml')).toContain('workflow_dispatch:')
  })

  test('installer uploads fail loudly rather than producing an empty artifact', () => {
    const yaml = readWorkflow('build.yml')
    // Bounded the same way the native-cache assertion above bounds its
    // per-key block: split on the marker, then cut each resulting chunk off
    // at the next step so an unrelated later upload-artifact step (build.yml
    // already has several, and will gain more) can't satisfy this by
    // coincidence. `.length` is asserted explicitly rather than relying on
    // a `for` loop over zero blocks to fail — an empty array would otherwise
    // pass vacuously, which is exactly the silent defeat this guards against.
    const installerUploads = yaml.split('installers-').slice(1)
    expect(
      installerUploads.length,
      'build.yml must declare at least one installers- artifact upload'
    ).toBeGreaterThan(0)
    for (const upload of installerUploads) {
      const untilNextStep = upload.split(/\n\s*-\s/)[0]
      expect(untilNextStep, 'installers- upload step must set if-no-files-found: error').toContain(
        'if-no-files-found: error'
      )
    }
  })
})
