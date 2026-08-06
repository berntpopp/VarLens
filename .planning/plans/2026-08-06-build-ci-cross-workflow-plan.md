# Build/CI Cross-Workflow Rebuild Elimination — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop packaging the same commit four times per release, and reduce the build warning
inventory to zero-unexplained.

**Architecture:** `build.yml`'s `package` job already produces shipping-quality installers and throws
them away. It starts uploading them; `release.yml` stops rebuilding and promotes those artifacts
instead, applying only the Windows signing that genuinely cannot happen anywhere else. Separately,
the repo-local ABI-keyed native cache (`.cache/native`) becomes a GitHub Actions cache restored
*before* `npm ci`, so `postinstall` restores a binary instead of compiling one. All promotion
verification lives in tested Node scripts rather than inline YAML.

**Tech Stack:** GitHub Actions, `actions/cache@v6.1.0`, `actions/upload-artifact@v7.0.1`,
`actions/download-artifact@v8.0.1`, Node 24.15.0 ESM scripts, Vitest.

**Spec:** `.planning/specs/2026-08-05-build-ci-performance.md` §Phase 8, §Phase 9.
**Baseline:** `.planning/artifacts/perf/build/ci-cross-workflow-baseline.md`.

## Global Constraints

- Node `>=24.15.0 <25`, npm `>=11.11.0 <12` (`package.json` `engines`). Match `.nvmrc` (24.15.0).
- **GitHub Actions must be pinned to full commit SHAs**, with the human-readable tag preserved as a
  same-line comment: `uses: owner/repo@<full-sha> # owner/repo@vX.Y.Z`. Reuse the SHAs already
  present in the repo rather than looking up new ones.
- **No `console.*` in application code.** `scripts/**` is not application code and already uses
  `process.stdout.write` / `process.stderr.write` — follow that, not `console.log`.
- **Keep source files under 600 lines**; prefer 150-400.
- **Never lower a coverage, lint, or typecheck threshold.** Add tests or fix the code.
- **Do not re-enable ESLint `--concurrency=auto`**, un-serialize `typecheck`, add `$(MAKE) -jN`, or
  change `vitest` `pool: 'forks'`. `tests/scripts/build-pipeline-guardrails.test.ts` enforces all
  four and will fail you.
- **Do not convert either of the two vite dynamic imports to static imports** (`definitions.ts`,
  `import-logic.ts`). `tests/main/database/database-startup.test.ts` fails if you do.
- **Never run `npm audit fix --force`** — it breaks `pdbe-molstar`.
- Never commit to `main`. Branch, PR, green CI.
- Conventional Commits: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `style`, `chore`, `ci`.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/release/verify-promoted-artifacts.mjs` | **Create.** Validate a downloaded artifact set against expected sha, version, checksums and filenames. Pure function + thin CLI. |
| `scripts/release/verify-latest-yml.mjs` | **Create.** Re-read a `latest*.yml`, recompute sha512 + size for every referenced file, fail on mismatch. |
| `scripts/release/artifact-manifest.mjs` | **Create.** Single source of truth for the expected per-platform asset name list. Consumed by both scripts above and by the guardrail test. |
| `tests/scripts/verify-promoted-artifacts.test.ts` | **Create.** Behaviour tests for the verifier. |
| `tests/scripts/verify-latest-yml.test.ts` | **Create.** Behaviour tests for the yml assertion. |
| `tests/scripts/build-pipeline-guardrails.test.ts` | **Modify.** Add workflow-YAML invariants (currently asserts nothing about workflows). |
| `.github/workflows/build.yml` | **Modify.** `workflow_dispatch`; `.cache/native` cache; explicit platform flag; provenance + checksums + installer upload. |
| `.github/workflows/release.yml` | **Modify.** Tag-ref assertions; `build_run_id` output; `promote-unix` + `sign-windows` replacing three build jobs. |
| `.github/workflows/web-ci.yml`, `publish-web.yml`, `docs.yml` | **Modify.** `.cache/native` cache + per-job ABI assertion. |
| `electron.vite.config.ts`, `vite.web-renderer.config.ts` | **Modify.** Delete the dead `zod` manualChunks entry. |
| `eslint.config.js` → `eslint.config.mjs` | **Rename.** Plus its three functional references in `build.yml`. |
| `.planning/docs/ACCEPTED-WARNINGS.md` | **Create.** The written ledger. |

---

# PART 1 — Phase 8 (branch `perf/ci-cross-workflow-dedupe`, one PR)

## Task 1: Lock the new workflow invariants as failing guardrail assertions

`tests/scripts/build-pipeline-guardrails.test.ts` currently asserts things about `package.json`,
`rebuild-native.mjs` and the `Makefile`, but **nothing about workflow YAML**. Everything Phase 8
changes is workflow YAML, so without this task the whole phase ships untested. Write the assertions
first; they must fail before any YAML changes.

**Files:**
- Modify: `tests/scripts/build-pipeline-guardrails.test.ts`

**Interfaces:**
- Produces: nothing consumed by later tasks. This is the regression net all later tasks land against.

- [ ] **Step 1: Read the existing file to match its style**

Run: `cat tests/scripts/build-pipeline-guardrails.test.ts`

Note how it reads files (repo-root-relative `readFileSync`) and how `describe`/`it` are nested.
Follow that exactly — do not introduce a new helper style.

- [ ] **Step 2: Add the failing workflow assertions**

Append a new `describe` block. Read each workflow once at module scope alongside the existing reads.

```ts
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows')
const readWorkflow = (name: string): string =>
  readFileSync(join(WORKFLOW_DIR, name), 'utf8')

describe('cross-workflow rebuild elimination (spec Phase 8)', () => {
  it('never caches the bare .cache root, which would collide with tsbuildinfo', () => {
    for (const name of ['build.yml', 'web-ci.yml', 'publish-web.yml', 'docs.yml']) {
      const yaml = readWorkflow(name)
      expect(yaml, `${name} must not cache the bare .cache root`).not.toMatch(
        /^\s*path:\s*\.cache\s*$/m
      )
    }
  })

  it('keys the native cache on os, arch, electron version and lockfile, with no restore-keys', () => {
    const yaml = readWorkflow('build.yml')
    const keys = [...yaml.matchAll(/key:\s*(native-[^\n]*)/g)].map((m) => m[1])
    expect(keys.length, 'build.yml must declare at least one native cache key').toBeGreaterThan(0)
    for (const key of keys) {
      expect(key).toContain('runner.os')
      expect(key).toContain('runner.arch')
      expect(key).toContain('electron-ver.outputs.ver')
      expect(key).toContain("hashFiles('package-lock.json')")
    }
    // A partial match would leave a wrong-ABI .node on disk. No fallback, ever.
    const nativeBlocks = yaml.split('key: native-').slice(1)
    for (const block of nativeBlocks) {
      const untilNextStep = block.split(/\n\s*-\s/)[0]
      expect(untilNextStep, 'native cache must not declare restore-keys').not.toContain(
        'restore-keys'
      )
    }
  })

  it('release.yml no longer builds or packages the app', () => {
    const yaml = readWorkflow('release.yml')
    expect(yaml, 'release.yml must promote build.yml artifacts, not rebuild').not.toContain(
      'electron-builder'
    )
    expect(yaml).not.toContain('electron-vite build')
  })

  it('release.yml grants actions:read so it can read another run’s artifacts', () => {
    expect(readWorkflow('release.yml')).toContain('actions: read')
  })

  it('build.yml can be re-run against a ref, so expired artifacts are recoverable', () => {
    // `gh run rerun` is only permitted for 30 days; artifacts are retained for 90.
    expect(readWorkflow('build.yml')).toContain('workflow_dispatch:')
  })

  it('installer uploads fail loudly rather than producing an empty artifact', () => {
    const yaml = readWorkflow('build.yml')
    expect(yaml).toContain('installers-')
    const uploadBlock = yaml.slice(yaml.indexOf('installers-'))
    expect(uploadBlock).toContain('if-no-files-found: error')
  })
})
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npx vitest run tests/scripts/build-pipeline-guardrails.test.ts`
Expected: FAIL. The `release.yml no longer builds`, `actions: read`, `workflow_dispatch` and
`installers-` assertions must all fail — nothing implements them yet. The `.cache` and `restore-keys`
assertions may pass vacuously; that is correct, they are guarding against a future mistake.

- [ ] **Step 4: Commit the failing net**

```bash
git add tests/scripts/build-pipeline-guardrails.test.ts
git commit -m "test(ci): lock the Phase 8 workflow invariants before changing any YAML"
```

---

## Task 2: The expected-artifact manifest

One source of truth for what a release must contain, consumed by both verifier scripts. Derived from
the published `v0.70.4` asset list and `package.json`'s `build` targets.

**Files:**
- Create: `scripts/release/artifact-manifest.mjs`

**Interfaces:**
- Produces: `expectedArtifacts(platform: 'linux'|'mac'|'win', version: string): string[]`
  and `PLATFORMS: readonly ['linux','mac','win']`. Task 3 and Task 5 both consume these exact names.

- [ ] **Step 1: Write the module**

```js
// Single source of truth for the asset set a release must contain.
// Derived from package.json's build.{linux,mac,win}.target + artifactName
// templates, and cross-checked against the published v0.70.4 release.
export const PLATFORMS = Object.freeze(['linux', 'mac', 'win'])

const PRODUCT = 'Varlens'

// package.json build.mac pins arch to arm64 for both dmg and zip.
const MAC_ARCH = 'arm64'

export function expectedArtifacts(platform, version) {
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`unknown platform "${platform}" (expected one of ${PLATFORMS.join(', ')})`)
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('version must be a non-empty string')
  }
  switch (platform) {
    case 'linux':
      return [`${PRODUCT}-${version}.AppImage`, `${PRODUCT}-${version}.deb`, 'latest-linux.yml']
    case 'mac':
      return [
        `${PRODUCT}-${version}-${MAC_ARCH}.dmg`,
        `${PRODUCT}-${version}-${MAC_ARCH}.zip`,
        'latest-mac.yml'
      ]
    case 'win':
      // win.artifactName is "${productName}-Setup-${version}.${ext}", which the
      // zip target also picks up; only `portable` overrides it.
      return [
        `${PRODUCT}-Setup-${version}.exe`,
        `${PRODUCT}-Portable-${version}.exe`,
        `${PRODUCT}-Setup-${version}.zip`,
        'latest.yml'
      ]
  }
}
```

- [ ] **Step 2: Verify it reproduces the real v0.70.4 asset set**

Run:
```bash
node -e "
import('./scripts/release/artifact-manifest.mjs').then(m => {
  const all = m.PLATFORMS.flatMap(p => m.expectedArtifacts(p, '0.70.4')).sort()
  process.stdout.write(all.join('\n') + '\n')
})"
gh release view v0.70.4 --json assets --jq '.assets[].name' | sort
```
Expected: the two lists are identical (10 names each).

- [ ] **Step 3: Commit**

```bash
git add scripts/release/artifact-manifest.mjs
git commit -m "feat(release): add the expected-artifact manifest"
```

---

## Task 3: `verify-promoted-artifacts.mjs` — TDD

The highest-risk logic in Phase 8. It must not live as inline YAML shell.

**Files:**
- Create: `scripts/release/verify-promoted-artifacts.mjs`
- Test: `tests/scripts/verify-promoted-artifacts.test.ts`

**Interfaces:**
- Consumes: `expectedArtifacts`, `PLATFORMS` from Task 2.
- Produces: `verifyPromotedArtifacts({ dir, platform, version, sha }): { ok: true } | never`
  — throws `Error` with a specific message on any failure. The CLI wrapper maps a throw to exit 1.

- [ ] **Step 1: Write the failing tests**

```ts
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { verifyPromotedArtifacts } from '../../scripts/release/verify-promoted-artifacts.mjs'

const VERSION = '9.9.9'
const SHA = 'a'.repeat(40)

let dir: string

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex')

/** Write a complete, valid linux artifact set. Tests then corrupt one thing at a time. */
function writeValidSet(): void {
  const files = [`Varlens-${VERSION}.AppImage`, `Varlens-${VERSION}.deb`, 'latest-linux.yml']
  const sums: string[] = []
  for (const name of files) {
    const body = Buffer.from(`payload-${name}`)
    writeFileSync(join(dir, name), body)
    sums.push(`${sha256(body)}  ${name}`)
  }
  writeFileSync(join(dir, 'SHA256SUMS'), sums.join('\n') + '\n')
  writeFileSync(
    join(dir, 'provenance.json'),
    JSON.stringify({ sha: SHA, version: VERSION, os: 'ubuntu-latest', platform: 'linux' })
  )
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'varlens-promote-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('verifyPromotedArtifacts', () => {
  it('accepts a complete, self-consistent artifact set', () => {
    writeValidSet()
    expect(verifyPromotedArtifacts({ dir, platform: 'linux', version: VERSION, sha: SHA })).toEqual({
      ok: true
    })
  })

  it('rejects a set whose provenance names a different commit', () => {
    writeValidSet()
    writeFileSync(
      join(dir, 'provenance.json'),
      JSON.stringify({ sha: 'b'.repeat(40), version: VERSION })
    )
    expect(() =>
      verifyPromotedArtifacts({ dir, platform: 'linux', version: VERSION, sha: SHA })
    ).toThrow(/provenance sha/i)
  })

  it('rejects a set whose provenance names a different version', () => {
    writeValidSet()
    writeFileSync(join(dir, 'provenance.json'), JSON.stringify({ sha: SHA, version: '0.0.1' }))
    expect(() =>
      verifyPromotedArtifacts({ dir, platform: 'linux', version: VERSION, sha: SHA })
    ).toThrow(/provenance version/i)
  })

  it('rejects a tampered payload whose checksum no longer matches', () => {
    writeValidSet()
    writeFileSync(join(dir, `Varlens-${VERSION}.deb`), Buffer.from('tampered'))
    expect(() =>
      verifyPromotedArtifacts({ dir, platform: 'linux', version: VERSION, sha: SHA })
    ).toThrow(/checksum mismatch/i)
  })

  it('rejects a set missing a required asset', () => {
    writeValidSet()
    rmSync(join(dir, 'latest-linux.yml'))
    expect(() =>
      verifyPromotedArtifacts({ dir, platform: 'linux', version: VERSION, sha: SHA })
    ).toThrow(/missing expected artifact.*latest-linux\.yml/i)
  })

  it('rejects an entirely empty directory rather than passing vacuously', () => {
    mkdirSync(join(dir, 'empty'), { recursive: true })
    expect(() =>
      verifyPromotedArtifacts({ dir: join(dir, 'empty'), platform: 'linux', version: VERSION, sha: SHA })
    ).toThrow(/provenance\.json/i)
  })

  it('rejects a SHA256SUMS that omits a file present on disk', () => {
    writeValidSet()
    writeFileSync(join(dir, 'SHA256SUMS'), `${sha256(Buffer.from('x'))}  nope.bin\n`)
    expect(() =>
      verifyPromotedArtifacts({ dir, platform: 'linux', version: VERSION, sha: SHA })
    ).toThrow(/not listed in SHA256SUMS|checksum mismatch|missing/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/scripts/verify-promoted-artifacts.test.ts`
Expected: FAIL — cannot resolve `verify-promoted-artifacts.mjs`.

- [ ] **Step 3: Implement**

```js
// Verifies one platform's promoted artifact set before it is published.
// Every check here is the difference between shipping the right installer
// and shipping a plausible-looking wrong one.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { expectedArtifacts } from './artifact-manifest.mjs'

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function parseChecksums(text) {
  const map = new Map()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    // `sha256sum` format: "<hex>  <name>" (two spaces), tolerate one.
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(trimmed)
    if (!match) throw new Error(`malformed SHA256SUMS line: ${trimmed}`)
    map.set(match[2], match[1].toLowerCase())
  }
  return map
}

export function verifyPromotedArtifacts({ dir, platform, version, sha }) {
  const provenancePath = join(dir, 'provenance.json')
  if (!existsSync(provenancePath)) {
    throw new Error(`missing provenance.json in ${dir} — the artifact set is not promotable`)
  }
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'))

  if (provenance.sha !== sha) {
    throw new Error(
      `provenance sha mismatch: artifact was built from ${provenance.sha}, releasing ${sha}`
    )
  }
  if (provenance.version !== version) {
    throw new Error(
      `provenance version mismatch: artifact declares ${provenance.version}, releasing ${version}`
    )
  }

  const sumsPath = join(dir, 'SHA256SUMS')
  if (!existsSync(sumsPath)) throw new Error(`missing SHA256SUMS in ${dir}`)
  const sums = parseChecksums(readFileSync(sumsPath, 'utf8'))

  for (const name of expectedArtifacts(platform, version)) {
    const path = join(dir, name)
    if (!existsSync(path)) throw new Error(`missing expected artifact: ${name}`)
    const recorded = sums.get(name)
    if (!recorded) throw new Error(`${name} is present but not listed in SHA256SUMS`)
    const actual = sha256File(path)
    if (actual !== recorded) {
      throw new Error(`checksum mismatch for ${name}: expected ${recorded}, got ${actual}`)
    }
  }

  return { ok: true }
}

// CLI: node verify-promoted-artifacts.mjs <dir> <platform> <version> <sha>
// Compare resolved paths rather than matching basenames — a basename check
// would also fire when this module is imported by a same-named test file.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [dir, platform, version, sha] = process.argv.slice(2)
  try {
    verifyPromotedArtifacts({ dir, platform, version, sha })
    process.stdout.write(`promoted artifacts verified: ${platform} ${version} @ ${sha}\n`)
  } catch (error) {
    process.stderr.write(`::error::${error.message}\n`)
    process.exit(1)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/scripts/verify-promoted-artifacts.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/release/verify-promoted-artifacts.mjs tests/scripts/verify-promoted-artifacts.test.ts
git commit -m "feat(release): verify promoted artifacts before publishing"
```

---

## Task 4: `verify-latest-yml.mjs` — TDD

Closes spec 8.5. The existing regeneration step rewrites hashes with four PowerShell `-replace`
calls and verifies nothing; a filename that stops matching silently ships auto-update metadata
describing the *unsigned* binaries.

**Files:**
- Create: `scripts/release/verify-latest-yml.mjs`
- Test: `tests/scripts/verify-latest-yml.test.ts`

**Interfaces:**
- Produces: `verifyLatestYml({ ymlPath, dir }): { ok: true, checked: string[] } | never`.

- [ ] **Step 1: Write the failing tests**

`latest.yml` is electron-builder's update metadata. Its shape, from the real `v0.70.4` asset:
a top-level `version`, a `files:` array of `{ url, sha512, size }`, and top-level `path` / `sha512`
mirroring the primary file. sha512 values are **base64**, not hex.

```ts
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { verifyLatestYml } from '../../scripts/release/verify-latest-yml.mjs'

let dir: string
const sha512b64 = (buf: Buffer): string => createHash('sha512').update(buf).digest('base64')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'varlens-latestyml-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeSet(bodyText: string, ymlSha: string, ymlSize: number): string {
  const body = Buffer.from(bodyText)
  writeFileSync(join(dir, 'Varlens-Setup-9.9.9.exe'), body)
  const yml = [
    'version: 9.9.9',
    'files:',
    '  - url: Varlens-Setup-9.9.9.exe',
    `    sha512: ${ymlSha}`,
    `    size: ${ymlSize}`,
    'path: Varlens-Setup-9.9.9.exe',
    `sha512: ${ymlSha}`,
    'releaseDate: 2026-08-06T00:00:00.000Z'
  ].join('\n')
  const ymlPath = join(dir, 'latest.yml')
  writeFileSync(ymlPath, yml)
  return ymlPath
}

describe('verifyLatestYml', () => {
  it('accepts metadata whose hash and size match the file on disk', () => {
    const body = Buffer.from('signed-installer-bytes')
    const ymlPath = writeSet('signed-installer-bytes', sha512b64(body), body.length)
    expect(verifyLatestYml({ ymlPath, dir })).toEqual({
      ok: true,
      checked: ['Varlens-Setup-9.9.9.exe']
    })
  })

  it('rejects metadata describing the pre-signing bytes — the regex-no-op failure', () => {
    const stale = Buffer.from('UNSIGNED-installer-bytes')
    const signed = Buffer.from('signed-installer-bytes')
    // yml still carries the unsigned hash; disk carries the signed file.
    const ymlPath = writeSet('signed-installer-bytes', sha512b64(stale), signed.length)
    expect(() => verifyLatestYml({ ymlPath, dir })).toThrow(/sha512 mismatch/i)
  })

  it('rejects a stale size even when the hash was updated', () => {
    const body = Buffer.from('signed-installer-bytes')
    const ymlPath = writeSet('signed-installer-bytes', sha512b64(body), body.length + 4096)
    expect(() => verifyLatestYml({ ymlPath, dir })).toThrow(/size mismatch/i)
  })

  it('rejects metadata referencing a file that is not there', () => {
    const body = Buffer.from('x')
    const ymlPath = writeSet('x', sha512b64(body), body.length)
    rmSync(join(dir, 'Varlens-Setup-9.9.9.exe'))
    expect(() => verifyLatestYml({ ymlPath, dir })).toThrow(/not found/i)
  })

  it('refuses to pass when the files array is empty, rather than vacuously succeeding', () => {
    const ymlPath = join(dir, 'latest.yml')
    writeFileSync(ymlPath, 'version: 9.9.9\nfiles:\n')
    expect(() => verifyLatestYml({ ymlPath, dir })).toThrow(/no files/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/scripts/verify-latest-yml.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Parse with a narrow line reader rather than adding a YAML dependency — the file shape is fixed and
electron-builder-generated, and adding a parser dependency for this is not worth the surface.

```js
// Asserts that a latest*.yml actually describes the files sitting next to it.
// The signing step rewrites sha512/size with regexes that silently no-op when a
// filename stops matching; without this check that ships auto-update metadata
// for the unsigned binaries and breaks updates for every user.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

function sha512Base64(path) {
  return createHash('sha512').update(readFileSync(path)).digest('base64')
}

// Reads the `files:` array entries. electron-builder emits a fixed two-space
// indented list of `- url:` / `sha512:` / `size:` triples.
export function parseFileEntries(yml) {
  const entries = []
  let current = null
  for (const raw of yml.split('\n')) {
    const urlMatch = /^\s*-\s*url:\s*(.+?)\s*$/.exec(raw)
    if (urlMatch) {
      if (current) entries.push(current)
      current = { url: urlMatch[1], sha512: null, size: null }
      continue
    }
    if (!current) continue
    const shaMatch = /^\s+sha512:\s*(.+?)\s*$/.exec(raw)
    if (shaMatch) {
      current.sha512 = shaMatch[1]
      continue
    }
    const sizeMatch = /^\s+size:\s*(\d+)\s*$/.exec(raw)
    if (sizeMatch) {
      current.size = Number.parseInt(sizeMatch[1], 10)
      continue
    }
    // A non-indented key ends the files array.
    if (/^\S/.test(raw)) {
      entries.push(current)
      current = null
    }
  }
  if (current) entries.push(current)
  return entries
}

export function verifyLatestYml({ ymlPath, dir }) {
  const yml = readFileSync(ymlPath, 'utf8')
  const entries = parseFileEntries(yml)
  if (entries.length === 0) {
    throw new Error(`${ymlPath} lists no files — refusing to treat that as verified`)
  }

  const checked = []
  for (const entry of entries) {
    const path = join(dir, entry.url)
    if (!existsSync(path)) {
      throw new Error(`${entry.url} is referenced by ${ymlPath} but not found in ${dir}`)
    }
    const actualSize = statSync(path).size
    if (entry.size !== actualSize) {
      throw new Error(`size mismatch for ${entry.url}: yml says ${entry.size}, file is ${actualSize}`)
    }
    const actualSha = sha512Base64(path)
    if (entry.sha512 !== actualSha) {
      throw new Error(
        `sha512 mismatch for ${entry.url} — the metadata does not describe the file on disk`
      )
    }
    checked.push(entry.url)
  }
  return { ok: true, checked }
}

// CLI: node verify-latest-yml.mjs <ymlPath> <dir>
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [ymlPath, dir] = process.argv.slice(2)
  try {
    const { checked } = verifyLatestYml({ ymlPath, dir })
    process.stdout.write(`latest.yml verified against ${checked.length} file(s)\n`)
  } catch (error) {
    process.stderr.write(`::error::${error.message}\n`)
    process.exit(1)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/scripts/verify-latest-yml.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/release/verify-latest-yml.mjs tests/scripts/verify-latest-yml.test.ts
git commit -m "feat(release): assert latest.yml describes the files it ships with"
```

---

## Task 5: `build.yml` — native cache, dispatch trigger, installer upload

**Files:**
- Modify: `.github/workflows/build.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: artifacts named `installers-ubuntu-latest`, `installers-windows-latest`,
  `installers-macos-latest`, each containing that platform's assets plus `provenance.json` and
  `SHA256SUMS`. Task 6 downloads exactly these names.

- [ ] **Step 1: Add the `workflow_dispatch` trigger**

In the `on:` block (currently `push` to `main` + `pull_request`), add:

```yaml
  workflow_dispatch:
```

This is the 30-90 day artifact-recovery path (`gh run rerun` only works for 30 days).

- [ ] **Step 2: Force `code=true` for dispatch runs**

`dorny/paths-filter` has no base ref on `workflow_dispatch` and cannot compute a diff. In the
`changes` job, make the outputs account for it:

```yaml
    outputs:
      code: ${{ github.event_name == 'workflow_dispatch' && 'true' || steps.filter.outputs.code }}
      web: ${{ github.event_name == 'workflow_dispatch' && 'true' || steps.filter.outputs.web }}
```

and guard the filter step itself so it does not run on dispatch:

```yaml
      - uses: dorny/paths-filter@7b450fff21473bca461d4b92ce414b9d0420d706 # dorny/paths-filter@v4.0.2
        id: filter
        if: github.event_name != 'workflow_dispatch'
```

- [ ] **Step 3: Add the `.cache/native` restore to the `checks` job**

The `checks` job has **no** native cache today. Insert *before* `- name: Install dependencies`, and
move the existing `Extract Electron version` step up so the key can reference it:

```yaml
      - name: Extract Electron version
        id: electron-ver
        shell: bash
        run: echo "ver=$(node -p "require('./package.json').devDependencies.electron")" >> "$GITHUB_OUTPUT"

      # Restore the repo-owned ABI-keyed native cache BEFORE npm ci, so
      # postinstall restores a binary instead of compiling one. `.cache/native`
      # is a sibling of node_modules and survives `npm ci`.
      # Path is `.cache/native`, never bare `.cache` — `.cache/tsbuildinfo` is a
      # sibling with a different key. No restore-keys: a partial match is
      # rejected by manifestIsFresh() anyway, and the absence documents intent.
      - name: Restore native ABI cache
        uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # actions/cache@v6.1.0
        with:
          path: .cache/native
          key: native-${{ runner.os }}-${{ runner.arch }}-${{ steps.electron-ver.outputs.ver }}-${{ hashFiles('package-lock.json') }}

      - name: Install dependencies
        run: npm ci

      - name: Rebuild native modules for Node.js
        run: npm run rebuild:node

      # checks runs Vitest under Node, so assert the NODE ABI, not electron.
      - name: Assert native ABI
        run: node scripts/native/assert-native-abi.mjs node
```

- [ ] **Step 4: Replace the `package` job's cache block**

Delete the `Cache native module for Electron ABI` step (which caches
`node_modules/better-sqlite3-multiple-ciphers/build/Release` *after* `npm ci`) and the
`if: steps.native-cache.outputs.cache-hit != 'true'` guard on the rebuild. Replace with the same
pre-install pattern, asserting `electron`:

```yaml
      - name: Extract Electron version
        id: electron-ver
        shell: bash
        run: echo "ver=$(node -p "require('./package.json').devDependencies.electron")" >> "$GITHUB_OUTPUT"

      - name: Restore native ABI cache
        uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # actions/cache@v6.1.0
        with:
          path: .cache/native
          key: native-${{ runner.os }}-${{ runner.arch }}-${{ steps.electron-ver.outputs.ver }}-${{ hashFiles('package-lock.json') }}

      - name: Install dependencies
        run: npm ci

      - name: Rebuild native modules for Electron
        run: npm run rebuild:electron

      - name: Assert native ABI
        run: node scripts/native/assert-native-abi.mjs electron
```

`rebuild:electron` is now unconditional because it is a cache-restore no-op when warm — that is the
point of the change, and it means a cold cache still self-heals.

- [ ] **Step 5: Make the packaging platform explicit**

Replace `run: npx electron-builder --publish never` with a matrix-driven flag so the promoted set is
defined by configuration rather than inferred from the runner. Add to the matrix entries:

```yaml
      matrix:
        include:
          - os: ubuntu-latest
            platform: linux
          - os: windows-latest
            platform: win
          - os: macos-latest
            platform: mac
```

and the step:

```yaml
      - name: Package Electron app
        run: npx electron-builder --${{ matrix.platform }} --publish never
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: false
```

- [ ] **Step 6: Emit provenance and checksums, then upload**

After the packaged-smoke steps. `shell: bash` everywhere so Windows uses Git Bash and one script
covers all three runners.

```yaml
`-printf` is GNU-only, so it is avoided below — macOS runners ship BSD `find`. `sha256sum` is
likewise absent on macOS; use `shasum -a 256`, which exists on all three runners (Git Bash provides
it on Windows).

```yaml
      - name: Write provenance and checksums
        if: github.event_name != 'pull_request'
        shell: bash
        working-directory: release
        env:
          PLATFORM: ${{ matrix.platform }}
        run: |
          set -euo pipefail
          export VERSION="$(node -p "require('../package.json').version")"
          export TREE_SHA="$(git -C .. rev-parse 'HEAD^{tree}')"
          node -e "
            const fs = require('fs')
            fs.writeFileSync('provenance.json', JSON.stringify({
              sha: process.env.GITHUB_SHA,
              tree: process.env.TREE_SHA,
              run_id: process.env.GITHUB_RUN_ID,
              run_attempt: process.env.GITHUB_RUN_ATTEMPT,
              version: process.env.VERSION,
              os: process.env.RUNNER_OS,
              arch: process.env.RUNNER_ARCH,
              platform: process.env.PLATFORM
            }, null, 2) + '\n')
          "
          # Checksum every publishable asset, in the plain `<hex>  <name>` form
          # verify-promoted-artifacts.mjs parses. Deliberately excludes
          # provenance.json and SHA256SUMS itself. Portable across GNU/BSD find.
          : > SHA256SUMS
          for f in *.AppImage *.deb *.dmg *.exe *.zip latest*.yml; do
            [ -e "$f" ] || continue
            shasum -a 256 "$f" >> SHA256SUMS
          done
          # An empty SHA256SUMS means the packaging step produced nothing.
          [ -s SHA256SUMS ] || { echo "::error::no publishable assets found in release/"; exit 1; }
          cat SHA256SUMS
```

Then the upload:

```yaml
      - name: Upload installers
        if: github.event_name != 'pull_request'
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # actions/upload-artifact@v7.0.1
        with:
          name: installers-${{ matrix.os }}
          # Installers are already compressed; level 6 burns CPU for nothing.
          compression-level: 0
          if-no-files-found: error
          retention-days: 90
          path: |
            release/*.AppImage
            release/*.deb
            release/*.dmg
            release/*.exe
            release/*.zip
            release/latest*.yml
            release/provenance.json
            release/SHA256SUMS
```

- [ ] **Step 7: Verify the workflow parses and the guardrails pass**

Run:
```bash
node -e "require('js-yaml')" 2>/dev/null && echo "js-yaml available" || echo "no js-yaml — use actionlint or gh"
npx vitest run tests/scripts/build-pipeline-guardrails.test.ts
```
Expected: the `workflow_dispatch`, `installers-`, `.cache` and `restore-keys` assertions PASS. The
`release.yml` assertions still FAIL — Task 6 implements those.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci(build): cache the native ABI before npm ci and upload installers on push"
```

---

## Task 6: `release.yml` — promote instead of rebuild

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `installers-<os>` artifacts from Task 5; `verifyPromotedArtifacts` CLI from Task 3;
  `verifyLatestYml` CLI from Task 4.
- Produces: `release-linux` / `release-macos` / `release-windows` artifacts — **the same names
  `publish-release` already downloads**, so that job needs no change at all.

- [ ] **Step 1: Assert the tag ref still points at the commit being released**

In `create-release`, immediately after `Extract version from tag`. Closes the force-moved-tag hole
(pre-existing, but this is the moment to close it). The checkout already uses `fetch-depth: 0`.

```yaml
      - name: Assert tag ref resolves to the commit being released
        run: |
          set -euo pipefail
          TAG_COMMIT=$(git rev-parse "refs/tags/${GITHUB_REF_NAME}^{commit}")
          if [ "$TAG_COMMIT" != "$GITHUB_SHA" ]; then
            echo "::error::Tag ${GITHUB_REF_NAME} now resolves to $TAG_COMMIT but this run is for $GITHUB_SHA."
            echo "::error::The tag was moved after this workflow started. Refusing to publish a mismatched release."
            exit 1
          fi
          echo "Tag ${GITHUB_REF_NAME} resolves to $GITHUB_SHA"
```

- [ ] **Step 2: Capture and export `build_run_id` from the existing gate**

Modify the `Verify Build workflow passed on tagged SHA` step. Add `id: build-gate`, widen the event
filter to `push` **or** `workflow_dispatch` (the recovery path from Task 5 produces the latter), and
assert `headSha` rather than trusting `--commit`:

```yaml
      - name: Verify Build workflow passed on tagged SHA
        id: build-gate
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          SHA="${GITHUB_SHA}"
          MAX_ATTEMPTS=20
          DELAY=30
          for i in $(seq 1 $MAX_ATTEMPTS); do
            # `--commit` with a SHORT sha silently returns []; GITHUB_SHA is always full.
            # Accept push and workflow_dispatch; exclude pull_request, whose head_sha
            # is the PR HEAD and whose runs never upload installers.
            RUN=$(gh run list --workflow="Build" --commit="$SHA" --limit 20 \
              --json conclusion,databaseId,headSha,event \
              --jq "[.[] | select(.headSha == \"$SHA\") | select(.event == \"push\" or .event == \"workflow_dispatch\")] | .[0] // empty")
            STATUS=$(echo "$RUN" | jq -r '.conclusion // "pending"')
            if [ "$STATUS" = "success" ]; then
              RUN_ID=$(echo "$RUN" | jq -r '.databaseId')
              echo "build_run_id=$RUN_ID" >> "$GITHUB_OUTPUT"
              echo "Build passed on $SHA in run $RUN_ID — promoting its artifacts"
              exit 0
            elif [ "$STATUS" = "failure" ] || [ "$STATUS" = "cancelled" ]; then
              echo "::error::Build did not succeed on $SHA (got: $STATUS). Refusing to release."
              exit 1
            fi
            echo "Build status: $STATUS (attempt $i/$MAX_ATTEMPTS, waiting ${DELAY}s...)"
            sleep $DELAY
          done
          echo "::error::Build did not complete within $((MAX_ATTEMPTS * DELAY))s on $SHA"
          exit 1
```

Add to the job's `outputs:` block:

```yaml
      build_run_id: ${{ steps.build-gate.outputs.build_run_id }}
```

- [ ] **Step 3: Replace `release-linux` and `release-macos` with one `promote-unix` job**

Delete both jobs entirely. Add:

```yaml
  promote-unix:
    name: Promote Linux + macOS installers
    needs: [create-release, secrets-scan]
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read          # required to read another workflow run's artifacts
    steps:
      - name: Checkout code
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # actions/checkout@v7.0.1

      - name: Setup Node.js
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # actions/setup-node@v7.0.0
        with:
          node-version-file: '.nvmrc'

      - name: Download Linux installers from the verified Build run
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # actions/download-artifact@v8.0.1
        with:
          name: installers-ubuntu-latest
          path: promoted/linux
          run-id: ${{ needs.create-release.outputs.build_run_id }}
          github-token: ${{ secrets.GITHUB_TOKEN }}

      - name: Download macOS installers from the verified Build run
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # actions/download-artifact@v8.0.1
        with:
          name: installers-macos-latest
          path: promoted/mac
          run-id: ${{ needs.create-release.outputs.build_run_id }}
          github-token: ${{ secrets.GITHUB_TOKEN }}

      - name: Verify promoted artifacts
        run: |
          set -euo pipefail
          V="${{ needs.create-release.outputs.version }}"
          node scripts/release/verify-promoted-artifacts.mjs promoted/linux linux "$V" "$GITHUB_SHA"
          node scripts/release/verify-promoted-artifacts.mjs promoted/mac   mac   "$V" "$GITHUB_SHA"

      - name: Verify auto-update metadata
        run: |
          set -euo pipefail
          node scripts/release/verify-latest-yml.mjs promoted/linux/latest-linux.yml promoted/linux
          node scripts/release/verify-latest-yml.mjs promoted/mac/latest-mac.yml     promoted/mac

      - name: Upload artifacts
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # actions/upload-artifact@v7.0.1
        with:
          name: release-linux
          compression-level: 0
          if-no-files-found: error
          path: |
            promoted/linux/*.AppImage
            promoted/linux/*.deb
            promoted/linux/latest-linux.yml

      - name: Upload macOS artifacts
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # actions/upload-artifact@v7.0.1
        with:
          name: release-macos
          compression-level: 0
          if-no-files-found: error
          path: |
            promoted/mac/*.dmg
            promoted/mac/*.zip
            promoted/mac/latest-mac.yml
```

**Do not** upload `provenance.json` or `SHA256SUMS` — `publish-release` uses `merge-multiple: true`
and `gh release upload artifacts/*`, so anything uploaded here becomes a published release asset.

- [ ] **Step 4: Turn `release-windows` into `sign-windows`**

Keep every existing signing step **byte-for-byte**: `Log signing quota usage`, `Setup Java for
CodeSignTool`, `Download and configure CodeSignTool`, `Sign Windows installer with CodeSignTool`,
`Regenerate latest.yml with signed artifact hashes`. Replace only the preamble (checkout / node /
`npm ci` / native cache / build) with download + verify, and keep the `environment: release`
declaration so the signing secrets remain available. Rename the job key to `sign-windows` and add
`actions: read`.

The working directory changes from `release/` to `promoted/win/`, so update the paths inside the
signing steps:
- `$filePath = Join-Path $workspace "release" $fileName` → `Join-Path $workspace "promoted/win" $fileName`
- `Get-Content release/latest.yml` → `Get-Content promoted/win/latest.yml`
- `Get-ChildItem release/*.exe` → `Get-ChildItem promoted/win/*.exe`
- `Set-Content release/latest.yml` → `Set-Content promoted/win/latest.yml`
- the `Test-Path (Join-Path "release" $_)` quota probe → `Join-Path "promoted/win" $_`

Verify **after** regeneration, so the assertion covers the signed bytes:

```yaml
      - name: Verify promoted artifacts
        shell: bash
        run: |
          set -euo pipefail
          node scripts/release/verify-promoted-artifacts.mjs promoted/win win \
            "${{ needs.create-release.outputs.version }}" "$GITHUB_SHA"

      # ... existing signing + latest.yml regeneration steps ...

      # Runs unconditionally: latest.yml must describe the shipped bytes whether
      # or not signing ran. This is the check the -replace regexes never had.
      - name: Verify auto-update metadata matches the shipped binaries
        shell: bash
        run: node scripts/release/verify-latest-yml.mjs promoted/win/latest.yml promoted/win
```

Note the ordering: `verify-promoted-artifacts` runs *before* signing (checksums describe the
unsigned build.yml output), `verify-latest-yml` runs *after* (metadata must match the final bytes).

Update the upload step's paths to `promoted/win/*` and keep the artifact name `release-windows`.

- [ ] **Step 5: Update `publish-release`'s `needs` and re-assert the tag**

```yaml
  publish-release:
    name: Publish Release
    needs: [create-release, promote-unix, sign-windows]
```

Add a checkout (it currently has none) plus a final tag assertion immediately before the draft is
flipped — the last correctable moment:

```yaml
      - name: Checkout code
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # actions/checkout@v7.0.1
        with:
          fetch-depth: 0

      - name: Re-assert tag ref before publishing
        run: |
          set -euo pipefail
          git fetch --tags --force
          TAG_COMMIT=$(git rev-parse "refs/tags/${GITHUB_REF_NAME}^{commit}")
          if [ "$TAG_COMMIT" != "$GITHUB_SHA" ]; then
            echo "::error::Tag ${GITHUB_REF_NAME} moved to $TAG_COMMIT during the release; assets are from $GITHUB_SHA."
            exit 1
          fi
```

Place the checkout **first** in the job, before `Download all artifacts`, and confirm the download
path (`artifacts/`) does not collide with the checkout.

- [ ] **Step 6: Run the guardrails**

Run: `npx vitest run tests/scripts/build-pipeline-guardrails.test.ts`
Expected: PASS, all assertions including `release.yml no longer builds` and `actions: read`.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): promote build.yml installers instead of rebuilding the tagged commit"
```

---

## Task 7: Native cache for the remaining workflows

**Files:**
- Modify: `.github/workflows/web-ci.yml`, `.github/workflows/publish-web.yml`,
  `.github/workflows/docs.yml`

- [ ] **Step 1: Apply the pre-`npm ci` cache to the three remaining sites**

Same block as Task 5 Step 3. Assertion targets, per the spec's per-job table:
- `web-ci.yml:66` → assert `node`
- `publish-web.yml:84` → assert `node`
- `docs.yml:42` (the leg that runs `npm run rebuild:electron`) → assert `electron`
- `build.yml`'s `web-ci` job (`:329`) → assert `node`

- [ ] **Step 2: Leave `docs.yml`'s deploy leg alone**

`docs.yml:87` uses `npm ci --ignore-scripts`. It gets **no cache and no assertion** — with scripts
skipped, neither the dependency's `install` nor the root `postinstall` places a binary, so an
assertion there would fail a correct job. Add a comment saying so, so the next person does not
"fix" the inconsistency.

- [ ] **Step 3: Verify and commit**

Run: `npx vitest run tests/scripts/build-pipeline-guardrails.test.ts`
Expected: PASS.

```bash
git add .github/workflows/web-ci.yml .github/workflows/publish-web.yml .github/workflows/docs.yml
git commit -m "ci: restore the native ABI cache before npm ci in the remaining workflows"
```

---

## Task 8: electron-builder toolset cache, archive tier only

**Files:**
- Modify: `.github/workflows/build.yml` (the `package` job)

- [ ] **Step 1: Add the cache with a post-restore `.state` purge**

The extracted-directory tier validates file *count*, not content (`cacheState.js:112-131`), so a
corrupt restore would be served silently. Deleting the `${extractDir}.state` sidecars
(`cacheState.js:24` — they are **sibling files**, not inside the directory) forces re-extraction
through the sha256-checked archive path.

```yaml
      - name: Restore electron-builder toolset cache
        uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # actions/cache@v6.1.0
        with:
          path: ${{ runner.os == 'Windows' && 'C:\Users\runneradmin\AppData\Local\electron-builder\Cache' || (runner.os == 'macOS' && '~/Library/Caches/electron-builder' || '~/.cache/electron-builder') }}
          key: ebtools-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('package-lock.json') }}
          restore-keys: |
            ebtools-${{ runner.os }}-${{ runner.arch }}-

      # electron-builder's extracted-directory cache tier checks file COUNT, not
      # content (cacheState.js:112-131), so a partial restore would be served
      # silently. Dropping the `<dir>.state` sidecars forces re-extraction back
      # through the sha256-verified archive path. Cheap; the download is what we
      # are actually caching.
      - name: Drop electron-builder extraction state so archives are re-verified
        shell: bash
        run: |
          set -euo pipefail
          case "$RUNNER_OS" in
            Windows) DIR="$LOCALAPPDATA/electron-builder/Cache" ;;
            macOS)   DIR="$HOME/Library/Caches/electron-builder" ;;
            *)       DIR="$HOME/.cache/electron-builder" ;;
          esac
          [ -d "$DIR" ] || { echo "no electron-builder cache to clean"; exit 0; }
          find "$DIR" -name '*.state' -type f -delete
          find "$DIR" -name '*.lock' -type f -delete
          echo "cleared extraction state under $DIR"
```

Note `restore-keys` **is** appropriate here, unlike the native cache: these are content-addressed
tool archives re-verified by sha256 on use, so a partial match is safe and useful.

- [ ] **Step 2: Measure it rather than assuming**

The ~82 s figure for `nsis-resources` is quoted, not measured. Add `DEBUG: electron-builder` to the
`Package Electron app` step's `env:` for one run, capture the per-download timings from the Windows
job log, then remove the debug flag. Record the real number in the spec's §6 table.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci(build): cache electron-builder's hash-verified toolset archives"
```

---

## Task 9: Dry-run the promotion path before trusting it

The promotion path cannot be validated by a PR run, because the installer upload is gated on
`github.event_name != 'pull_request'`. The `workflow_dispatch` trigger added in Task 5 is the
mechanism — one trigger serving both recovery and rehearsal.

- [ ] **Step 1: Push the branch and dispatch a build against it**

```bash
git push -u origin perf/ci-cross-workflow-dedupe
gh workflow run build.yml --ref perf/ci-cross-workflow-dedupe
gh run list --workflow=build.yml --limit 3
```

- [ ] **Step 2: Confirm the artifacts exist and are well-formed**

```bash
RUN_ID=$(gh run list --workflow=build.yml --branch=perf/ci-cross-workflow-dedupe \
  --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID"
gh api "repos/berntpopp/varlens/actions/runs/$RUN_ID/artifacts" \
  --jq '.artifacts[] | "\(.name)\t\(.size_in_bytes)"'
```
Expected: three `installers-*` artifacts, each non-trivial in size.

- [ ] **Step 3: Run the verifier against a real downloaded set**

```bash
gh run download "$RUN_ID" -n installers-ubuntu-latest -D /tmp/promote-check
node scripts/release/verify-promoted-artifacts.mjs /tmp/promote-check linux \
  "$(node -p "require('./package.json').version")" \
  "$(git rev-parse HEAD)"
node scripts/release/verify-latest-yml.mjs /tmp/promote-check/latest-linux.yml /tmp/promote-check
```
Expected: both print their success line and exit 0. **If either fails, stop and fix before the PR** —
this is the rehearsal that stands in for an actual release.

- [ ] **Step 4: Record the measured CI deltas**

```bash
gh api "repos/berntpopp/varlens/actions/runs/$RUN_ID/jobs" \
  --jq '.jobs[] | "\(.name)\t\((((.completed_at|fromdateiso8601) - (.started_at|fromdateiso8601))))s"'
```
Append the real numbers to `.planning/artifacts/perf/build/ci-cross-workflow-baseline.md` under a
new "After" section. Report every target that was missed, with its actual number.

---

# PART 2 — Phase 9 (branch `chore/build-warning-ledger`, separate PR)

Branch from `main`, not from Part 1 — these changes are independent and should be reviewable alone.

## Task 10: Delete the dead `zod` manualChunks

**Files:**
- Modify: `electron.vite.config.ts:56-59`, `vite.web-renderer.config.ts:83-86`

- [ ] **Step 1: Confirm the warning exists before touching anything**

Run: `npm run build 2>&1 | grep -n "empty chunk"`
Expected: `Generated an empty chunk: "zod".`

- [ ] **Step 2: Delete the `zod` entry in both files, keeping `vuetify`**

```ts
          manualChunks: {
            vuetify: ['vuetify']
          }
```

- [ ] **Step 3: Confirm the warning is gone and nothing else changed**

Run: `npm run build 2>&1 | grep -c "empty chunk" || echo "0 empty chunks"`
Expected: `0 empty chunks`. Also confirm a `vuetify-*.js` chunk is still emitted.

- [ ] **Step 4: Commit**

```bash
git add electron.vite.config.ts vite.web-renderer.config.ts
git commit -m "perf(build): drop the dead zod manualChunks group"
```

## Task 11: Rename `eslint.config.js` → `eslint.config.mjs`

**Files:**
- Rename: `eslint.config.js` → `eslint.config.mjs`
- Modify: `.github/workflows/build.yml:56`, `:148`, `:150`; `.prettierignore:1`

- [ ] **Step 1: Confirm the warning fires**

Run: `npm run lint:check 2>&1 | head -5`
Expected: a `MODULE_TYPELESS_PACKAGE_JSON` warning naming `eslint.config.js`.

- [ ] **Step 2: Rename with git so history follows**

```bash
git mv eslint.config.js eslint.config.mjs
```

**Do not** add `"type": "module"` to `package.json`. Node suggests it; this is a mixed CJS/ESM
Electron app and it would change module resolution for every untyped `.js` in the repo.

- [ ] **Step 3: Update the three functional references**

`build.yml:56` — the paths-filter entry: `- 'eslint.config.mjs'`
`build.yml:148` and `:150` — both `hashFiles(...)` calls. A file that does not exist contributes
nothing to `hashFiles` **without failing**, so a missed rename here silently weakens the cache key
rather than erroring. Change both to `hashFiles('package-lock.json', 'eslint.config.mjs', '.prettierignore')`.

Also fix the stale comment at `.prettierignore:1`.

- [ ] **Step 4: Confirm ESLint still resolves the config**

Run:
```bash
rm -f .eslintcache
npm run lint:check 2>&1 | head -5
```
Expected: no `MODULE_TYPELESS_PACKAGE_JSON` warning, and lint completes. If ESLint reports "could
not find config", the rename broke resolution — ESLint 10.8.0 lists `eslint.config.mjs` at
`eslint/lib/config/config-loader.js:45`, so investigate rather than reverting blindly.

- [ ] **Step 5: Commit**

```bash
git add -A eslint.config.mjs .github/workflows/build.yml .prettierignore
git commit -m "chore(lint): rename eslint config to .mjs to stop the reparse warning"
```

## Task 12: Resolve the `h264-mp4-encoder` question

Not a warning to accept until it is understood. Three builtins (`path`, `fs`, `crypto`) are being
externalized into the renderer bundle, which turns them into runtime no-ops.

- [ ] **Step 1: Find what pulls it in**

```bash
grep -rn "h264-mp4-encoder" src/ package.json
npm ls h264-mp4-encoder --all 2>/dev/null | head -20
```

- [ ] **Step 2: Determine whether the import is reachable at runtime**

Establish whether the importing module is statically imported from the renderer entry, lazily
imported behind a user action, or dead. Read the importing file and trace to `src/renderer/src/main.ts`.

- [ ] **Step 3: Rule, and record the ruling**

- If **reachable**: this is a latent renderer defect, not a warning. Do not fix it in this PR —
  open an issue with the trace, and record it in the ledger as a known defect with the issue link.
- If **unreachable**: record it in the ledger as accepted, with the evidence that made it safe.

Either way the outcome is written down, not silently dropped.

## Task 13: Write the accepted-warnings ledger

**Files:**
- Create: `.planning/docs/ACCEPTED-WARNINGS.md`

- [ ] **Step 1: Write the ledger**

One row per warning: what it is, where it surfaces, why it is accepted, and what would change the
ruling. Cover all four groups:

1. 2× vite "dynamically imported but also statically imported" — reason already in `AGENTS.md`;
   link rather than restate. Include that `tests/main/database/database-startup.test.ts` fails if
   the `definitions.ts` import is made static.
2. 5× `npm audit` low (elliptic via `pdbe-molstar`) — out of scope; **never**
   `npm audit fix --force`.
3. 2× Rollup `#__PURE__` from `@vueuse/core` (`dist/index.js` 3362:0, 5780:22) — upstream
   annotation placement; nothing in this repo to change.
4. 5× npm deprecations — the full table from spec Phase 9 item 3, including *why* an `overrides`
   entry is unsafe for four of them and impossible for `lodash.isequal` (already latest).

Add the operational note: `MODULE_TYPELESS_PACKAGE_JSON` and the npm deprecations do **not** appear
in `npm run build`; a warning inventory must run `npm run build`, `npm run lint:check` and
`npm install`.

- [ ] **Step 2: Commit**

```bash
git add .planning/docs/ACCEPTED-WARNINGS.md
git commit -m "docs(planning): record the accepted-warnings ledger"
```

---

## Final verification (both parts)

- [ ] `make ci` — expected green, ~28 s warm.
- [ ] `make ci-full` — expected green. Run **once**, at the end; it is several minutes.
- [ ] `make perf-build LABEL=post-phase8 ONLY=lint,build` then
      `make perf-build-compare BEFORE=<existing-baseline-label> AFTER=post-phase8` — **only Part 2**
      changes local stage timings (the eslint rename touches `lint`, the zod deletion touches
      `build`). Part 1 is CI-only and is measured from the Actions API, per the spec's §6 note.
- [ ] Codex adversarial review of the finished branch (`gpt-5.6-terra`, high reasoning effort)
      before opening either PR.
- [ ] Report every missed target with its actual number. Do not round in our favour.
