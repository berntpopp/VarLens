# Build/CI Performance — Phase 1 Implementation Plan (PRs 1–2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a committed build-performance measurement harness, then stop the native module recompiling on every install, dev-server start and CI job — the single change worth 63.6% of local `make ci-full`.

**Architecture:** A repo-owned, ABI-keyed binary cache under `.cache/native/<platform>-<arch>-<abi>/`, holding the compiled `.node` plus a manifest that fingerprints the artifact (ABI, module version, lockfile hash, sha256). `@electron/rebuild`'s `-f` flag is removed — it is what defeats the tool's own skip logic — and replaced by a fail-loud ABI assertion, which is strictly safer than forcing a recompile. The unavoidable first compile is parallelised via `--jobs`.

**Tech Stack:** Node 24.15.0 ESM scripts (`node:fs`, `node:crypto`, `node:child_process`), `node-abi` (already present transitively), Vitest 4 (`main` project), GNU `/usr/bin/time -v`, Make.

**Spec:** `.planning/specs/2026-08-05-build-ci-performance.md` (§5 Phase 1, §6 Verification, §7 PRs 1–2)

## Global Constraints

- Node must be **24.15.0** (`.nvmrc`); npm **>=11.11.0 <12**. Do not change either.
- **No `console.log`/`error`/`warn` in application code** (`AGENTS.md`). Standalone `scripts/**` files are outside the app and may write to stdout — this plan's scripts are CLI tools, not app code.
- **Never lower a coverage, lint or typecheck threshold** to make a suite pass.
- Plans, specs and artifacts go in `.planning/` — never `docs/`.
- Conventional Commits: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `ci`.
- **Never commit to `main`.** Work on a branch; every branch is destined for a PR.
- Keep source files **under 600 lines**; prefer 150–400.
- Native module is **`better-sqlite3-multiple-ciphers`**. Electron **43.3.0** → ABI **148**. Node 24.15.0 → ABI **137**.
- **Upstream publishes no Electron ABI 148 prebuild** for module v12.11.1 (verified: published ABIs are 121–146). Do not "fix" this by bumping the module; v12.11.1 is the latest stable.
- Do **not** re-enable ESLint `--concurrency=auto`, `run-p` typecheck, or `$(MAKE) -jN`. Measured: `auto` is slower (22.9 s vs 21.3 s) and uses 34.6 GB vs 3.4 GB.
- Do **not** change `vitest.config.ts`'s `pool: 'forks'` or `isolate`. `threads` fails outright (vitest#8968).

---

## File Structure

**PR 1 — measurement harness**

| File | Responsibility |
|---|---|
| `scripts/perf/measure-build.mjs` (create) | Stage registry + one timed run → baseline JSON. Nothing else. |
| `scripts/perf/compare-build.mjs` (create) | Read two baseline JSONs → markdown delta report. Pure formatting; no timing. |
| `tests/scripts/build-perf-harness.test.ts` (create) | Locks the stage registry and the comparison maths. |
| `.planning/artifacts/perf/build/.gitkeep` (create) | Artifact dir, mirroring `phase1/` and `wgs-import/`. |
| `.gitignore` (modify, ~line 59) | Re-include `build/.gitkeep` inside the ignored perf dir. |
| `Makefile` (modify, Testing section) | `perf-build`, `perf-build-compare` targets. |

**PR 2 — native ABI cache**

| File | Responsibility |
|---|---|
| `scripts/native/native-abi.mjs` (create) | Pure helpers: target→ABI, cache paths, manifest build/read/freshness, sha256. No process spawning. |
| `scripts/native/rebuild-native.mjs` (create) | Orchestration only: restore-or-compile-then-store. |
| `scripts/native/assert-native-abi.mjs` (create) | Fail-loud verification. Exit 0/1 only. |
| `tests/scripts/native-abi.test.ts` (create) | Unit tests for the pure helpers. |
| `tests/scripts/build-pipeline-guardrails.test.ts` (create) | Regression guards that run in the **default** `make ci`. |
| `package.json` (modify, lines 27–29) | Route `postinstall`/`rebuild:*` through the script; drop `-f`. |
| `Makefile` (modify, lines 63–67) | Unchanged targets, updated help text. |

Split rationale: `native-abi.mjs` is pure and therefore unit-testable without compiling anything; the two CLI entry points stay thin. `.cache/` is already gitignored (`.gitignore:12`), so `.cache/native/` needs no new rule.

**Guardrail placement — read before Task 8.** The existing June 2026 clamps live in `tests/web-gate/web-ci-target.test.ts`, which belongs to the **`web-gate` vitest project**. That project is deliberately excluded from `npm run test` (`package.json:35` runs only `--project main --project renderer`), so **those assertions do not run in `make ci`** — only under `VARLENS_WEB=1` or `make web-gate-static`. New build-pipeline guardrails therefore go in `tests/scripts/`, which `vitest.config.ts:102-107` includes in the `main` project.

---

## Task 1: Artifact directory and stage registry contract

**Files:**
- Create: `.planning/artifacts/perf/build/.gitkeep`
- Modify: `.gitignore` (perf block, after line 61)
- Create: `tests/scripts/build-perf-harness.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `STAGES` — an array of `{ id: string, cmd: string, before?: () => void }`, exported from `scripts/perf/measure-build.mjs`. Task 2 implements it; Task 3 does not use it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/scripts/build-perf-harness.test.ts
import { describe, expect, test } from 'vitest'

import { STAGES } from '../../scripts/perf/measure-build.mjs'

describe('build perf stage registry', () => {
  test('every stage has a unique id and a command', () => {
    expect(STAGES.length).toBeGreaterThan(0)
    const ids = STAGES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const stage of STAGES) {
      expect(stage.id).toMatch(/^[a-z0-9-]+$/)
      expect(typeof stage.cmd).toBe('string')
      expect(stage.cmd.length).toBeGreaterThan(0)
    }
  })

  test('covers the stages the spec sets targets for', () => {
    const ids = STAGES.map((s) => s.id)
    expect(ids).toContain('rebuild-electron-cold')
    expect(ids).toContain('rebuild-electron-warm')
    expect(ids).toContain('rebuild-node')
    expect(ids).toContain('build')
    expect(ids).toContain('test')
    expect(ids).toContain('typecheck')
    expect(ids).toContain('lint-cold')
    expect(ids).toContain('lint-warm')
    expect(ids).toContain('format-cold')
    expect(ids).toContain('format-warm')
  })

  test('leaves the tree on the Node ABI so `make test` still works afterwards', () => {
    expect(STAGES.at(-1)?.id).toBe('rebuild-node')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project main tests/scripts/build-perf-harness.test.ts`
Expected: FAIL — `Cannot find module '../../scripts/perf/measure-build.mjs'`

- [ ] **Step 3: Create the artifact directory**

```bash
mkdir -p .planning/artifacts/perf/build
touch .planning/artifacts/perf/build/.gitkeep
```

- [ ] **Step 4: Add the gitignore exception**

Insert directly after the `wgs-import/.gitkeep` line in the perf block (`.gitignore:61`):

```gitignore
!.planning/artifacts/perf/build/
.planning/artifacts/perf/build/*
!.planning/artifacts/perf/build/.gitkeep
```

- [ ] **Step 5: Verify git honours the exception**

Run: `git check-ignore -v .planning/artifacts/perf/build/.gitkeep; echo "exit=$?"`
Expected: `exit=1` (not ignored). If exit=0, the rule ordering is wrong — the `!` re-include must come after `.planning/artifacts/perf/*`.

- [ ] **Step 6: Commit**

```bash
git add .gitignore .planning/artifacts/perf/build/.gitkeep tests/scripts/build-perf-harness.test.ts
git commit -m "test(perf): add build perf artifact dir and stage registry contract"
```

---

## Task 2: The measurement script

**Files:**
- Create: `scripts/perf/measure-build.mjs`
- Test: `tests/scripts/build-perf-harness.test.ts` (from Task 1)

**Interfaces:**
- Consumes: `STAGES` contract from Task 1.
- Produces: `STAGES`, and a baseline JSON at `.planning/artifacts/perf/build/<label>.json` shaped
  `{ label, gitSha, nodeVersion, electronVersion, createdAt, stages: [{ id, wallSeconds, peakRssMb, exitCode }] }`.
  Task 3 reads exactly this shape.

- [ ] **Step 1: Write the implementation**

```js
#!/usr/bin/env node
// Times each build-pipeline stage once and writes a baseline artifact.
// Usage: node scripts/perf/measure-build.mjs <label> [--only id,id]
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

export const REPO_ROOT = resolve(import.meta.dirname, '..', '..')
export const OUT_DIR = join(REPO_ROOT, '.planning', 'artifacts', 'perf', 'build')

const rm = (...parts) => rmSync(join(REPO_ROOT, ...parts), { force: true, recursive: true })

// Order matters: `rebuild-electron-*` leave the tree on the Electron ABI, so
// `rebuild-node` must come last or `make test` fails afterwards with an ABI error.
export const STAGES = [
  { id: 'lint-cold', cmd: 'npm run lint:check', before: () => rm('.eslintcache') },
  { id: 'lint-warm', cmd: 'npm run lint:check' },
  { id: 'format-cold', cmd: 'npm run format:check', before: () => rm('node_modules', '.cache', 'prettier') },
  { id: 'format-warm', cmd: 'npm run format:check' },
  { id: 'typecheck', cmd: 'npm run typecheck' },
  { id: 'test', cmd: 'npm run test' },
  { id: 'build', cmd: 'npm run build' },
  { id: 'rebuild-electron-cold', cmd: 'npm run rebuild:electron', before: () => rm('.cache', 'native') },
  { id: 'rebuild-electron-warm', cmd: 'npm run rebuild:electron' },
  { id: 'rebuild-node', cmd: 'npm run rebuild:node' }
]

const round2 = (n) => Math.round(n * 100) / 100

function capture(cmd, timeFile) {
  // GNU time gives peak RSS, which the spec requires because the June 2026
  // incident was a memory failure, not a slowness failure.
  if (existsSync('/usr/bin/time')) {
    const r = spawnSync('/usr/bin/time', ['-v', '-o', timeFile, 'sh', '-c', cmd], {
      cwd: REPO_ROOT,
      stdio: 'inherit'
    })
    let peakRssMb = null
    if (existsSync(timeFile)) {
      const kb = Number((readFileSync(timeFile, 'utf8').match(/Maximum resident set size \(kbytes\): (\d+)/) || [])[1])
      if (Number.isFinite(kb)) peakRssMb = round2(kb / 1024)
      rmSync(timeFile, { force: true })
    }
    return { status: r.status, peakRssMb }
  }
  const r = spawnSync('sh', ['-c', cmd], { cwd: REPO_ROOT, stdio: 'inherit' })
  return { status: r.status, peakRssMb: null }
}

export function measureStage(stage) {
  stage.before?.()
  const started = process.hrtime.bigint()
  const { status, peakRssMb } = capture(stage.cmd, join(OUT_DIR, `.time-${stage.id}`))
  const wallSeconds = round2(Number(process.hrtime.bigint() - started) / 1e9)
  return { id: stage.id, wallSeconds, peakRssMb, exitCode: status ?? 1 }
}

function gitSha() {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : 'unknown'
}

function electronVersion() {
  try {
    return JSON.parse(
      readFileSync(join(REPO_ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')
    ).version
  } catch {
    return null
  }
}

function main() {
  const label = process.argv[2]
  if (!label || label.startsWith('--')) {
    process.stdout.write('usage: measure-build.mjs <label> [--only id,id]\n')
    process.exit(2)
  }
  const onlyArg = process.argv.indexOf('--only')
  const only = onlyArg === -1 ? null : new Set(process.argv[onlyArg + 1].split(','))
  const selected = only ? STAGES.filter((s) => only.has(s.id)) : STAGES

  mkdirSync(OUT_DIR, { recursive: true })
  const stages = []
  for (const stage of selected) {
    process.stdout.write(`\n=== ${stage.id} ===\n`)
    const result = measureStage(stage)
    process.stdout.write(`${stage.id}: ${result.wallSeconds}s peakRss=${result.peakRssMb ?? 'n/a'}MB exit=${result.exitCode}\n`)
    stages.push(result)
  }

  const outFile = join(OUT_DIR, `${label}.json`)
  writeFileSync(
    outFile,
    `${JSON.stringify(
      {
        label,
        gitSha: gitSha(),
        nodeVersion: process.version,
        electronVersion: electronVersion(),
        createdAt: new Date().toISOString(),
        stages
      },
      null,
      2
    )}\n`
  )
  process.stdout.write(`\nwrote ${outFile}\n`)

  const failed = stages.filter((s) => s.exitCode !== 0)
  if (failed.length > 0) {
    process.stdout.write(`FAILED stages: ${failed.map((s) => s.id).join(', ')}\n`)
    process.exit(1)
  }
}

if (process.argv[1] === import.meta.filename) main()
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run --project main tests/scripts/build-perf-harness.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 3: Smoke the script on the two cheapest stages only**

Run: `node scripts/perf/measure-build.mjs smoke --only lint-warm,rebuild-node`
Expected: two `=== <id> ===` blocks, then `wrote …/smoke.json`. Exit 0.

- [ ] **Step 4: Verify the artifact shape**

Run: `node -e "const b=require('./.planning/artifacts/perf/build/smoke.json'); console.log(b.label, b.gitSha, b.stages.map(s=>s.id).join(','), b.stages.every(s=>typeof s.wallSeconds==='number'))"`
Expected: `smoke <sha> lint-warm,rebuild-node true`

- [ ] **Step 5: Delete the smoke artifact and commit**

```bash
rm .planning/artifacts/perf/build/smoke.json
git add scripts/perf/measure-build.mjs
git commit -m "perf(ci): add build pipeline measurement harness"
```

---

## Task 3: The comparison script

**Files:**
- Create: `scripts/perf/compare-build.mjs`
- Modify: `tests/scripts/build-perf-harness.test.ts`

**Interfaces:**
- Consumes: the baseline JSON shape from Task 2.
- Produces: `compareBaselines(before, after)` → `{ rows: [{ id, beforeSeconds, afterSeconds, deltaSeconds, deltaPercent, classification }], totalBefore, totalAfter }` where `classification` is `'improved' | 'regressed' | 'unchanged' | 'missing'`. `formatReport(comparison, meta)` → markdown string.

- [ ] **Step 1: Write the failing test (append to the existing file)**

```ts
import { compareBaselines, formatReport } from '../../scripts/perf/compare-build.mjs'

describe('build perf comparison', () => {
  const before = {
    label: 'before',
    stages: [
      { id: 'rebuild-electron-warm', wallSeconds: 33.57, peakRssMb: 600, exitCode: 0 },
      { id: 'build', wallSeconds: 11.2, peakRssMb: 2067, exitCode: 0 },
      { id: 'gone', wallSeconds: 1, peakRssMb: null, exitCode: 0 }
    ]
  }
  const after = {
    label: 'after',
    stages: [
      { id: 'rebuild-electron-warm', wallSeconds: 1.4, peakRssMb: 170, exitCode: 0 },
      { id: 'build', wallSeconds: 11.2, peakRssMb: 2067, exitCode: 0 }
    ]
  }

  test('classifies each stage and totals both runs', () => {
    const c = compareBaselines(before, after)
    const byId = Object.fromEntries(c.rows.map((r) => [r.id, r]))

    expect(byId['rebuild-electron-warm'].classification).toBe('improved')
    expect(byId['rebuild-electron-warm'].deltaSeconds).toBe(-32.17)
    expect(byId['rebuild-electron-warm'].deltaPercent).toBe(-95.83)
    expect(byId['build'].classification).toBe('unchanged')
    expect(byId['gone'].classification).toBe('missing')

    expect(c.totalBefore).toBe(45.77)
    expect(c.totalAfter).toBe(12.6)
  })

  test('flags a regression', () => {
    const worse = { label: 'after', stages: [{ id: 'build', wallSeconds: 20, peakRssMb: 1, exitCode: 0 }] }
    const row = compareBaselines(before, worse).rows.find((r) => r.id === 'build')
    expect(row.classification).toBe('regressed')
  })

  test('renders a markdown table naming both labels', () => {
    const md = formatReport(compareBaselines(before, after), { before: 'before', after: 'after' })
    expect(md).toContain('| Stage |')
    expect(md).toContain('rebuild-electron-warm')
    expect(md).toContain('before')
    expect(md).toContain('after')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project main tests/scripts/build-perf-harness.test.ts`
Expected: FAIL — `Cannot find module '../../scripts/perf/compare-build.mjs'`

- [ ] **Step 3: Write the implementation**

```js
#!/usr/bin/env node
// Compares two build-perf baselines and writes a markdown delta report.
// Usage: node scripts/perf/compare-build.mjs <before-label> <after-label>
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..')
const OUT_DIR = join(REPO_ROOT, '.planning', 'artifacts', 'perf', 'build')

const round2 = (n) => Math.round(n * 100) / 100
const sum = (stages) => round2(stages.reduce((acc, s) => acc + s.wallSeconds, 0))

// A stage must move more than this to count as a real change; below it, run
// to run jitter dominates. 0.5 s is ~1.5% of the slowest stage in the baseline.
export const NOISE_FLOOR_SECONDS = 0.5

export function compareBaselines(before, after) {
  const afterById = new Map(after.stages.map((s) => [s.id, s]))
  const rows = before.stages.map((b) => {
    const a = afterById.get(b.id)
    if (!a) {
      return {
        id: b.id,
        beforeSeconds: b.wallSeconds,
        afterSeconds: null,
        deltaSeconds: null,
        deltaPercent: null,
        classification: 'missing'
      }
    }
    const deltaSeconds = round2(a.wallSeconds - b.wallSeconds)
    const deltaPercent = b.wallSeconds === 0 ? null : round2((deltaSeconds / b.wallSeconds) * 100)
    let classification = 'unchanged'
    if (Math.abs(deltaSeconds) > NOISE_FLOOR_SECONDS) {
      classification = deltaSeconds < 0 ? 'improved' : 'regressed'
    }
    return {
      id: b.id,
      beforeSeconds: b.wallSeconds,
      afterSeconds: a.wallSeconds,
      deltaSeconds,
      deltaPercent,
      classification,
      beforePeakRssMb: b.peakRssMb,
      afterPeakRssMb: a.peakRssMb
    }
  })

  // Stages present only in `after` are new coverage, not a delta.
  for (const a of after.stages) {
    if (!before.stages.some((b) => b.id === a.id)) {
      rows.push({
        id: a.id,
        beforeSeconds: null,
        afterSeconds: a.wallSeconds,
        deltaSeconds: null,
        deltaPercent: null,
        classification: 'new',
        beforePeakRssMb: null,
        afterPeakRssMb: a.peakRssMb
      })
    }
  }

  return { rows, totalBefore: sum(before.stages), totalAfter: sum(after.stages) }
}

const cell = (v, suffix = '') => (v === null || v === undefined ? '—' : `${v}${suffix}`)

export function formatReport(comparison, meta) {
  const lines = [
    `# Build performance: ${meta.before} → ${meta.after}`,
    '',
    `Total measured wall clock: **${comparison.totalBefore}s → ${comparison.totalAfter}s** ` +
      `(${round2(comparison.totalAfter - comparison.totalBefore)}s)`,
    '',
    '| Stage | Before (s) | After (s) | Δ (s) | Δ (%) | Peak RSS before → after (MB) | Verdict |',
    '|---|---:|---:|---:|---:|---:|---|'
  ]
  for (const r of comparison.rows) {
    lines.push(
      `| \`${r.id}\` | ${cell(r.beforeSeconds)} | ${cell(r.afterSeconds)} | ${cell(r.deltaSeconds)} | ` +
        `${cell(r.deltaPercent, '%')} | ${cell(r.beforePeakRssMb)} → ${cell(r.afterPeakRssMb)} | ${r.classification} |`
    )
  }
  const regressions = comparison.rows.filter((r) => r.classification === 'regressed')
  lines.push(
    '',
    regressions.length === 0
      ? 'No stage regressed beyond the noise floor.'
      : `**Regressions:** ${regressions.map((r) => r.id).join(', ')}`
  )
  return `${lines.join('\n')}\n`
}

function main() {
  const [beforeLabel, afterLabel] = process.argv.slice(2)
  if (!beforeLabel || !afterLabel) {
    process.stdout.write('usage: compare-build.mjs <before-label> <after-label>\n')
    process.exit(2)
  }
  const read = (label) => JSON.parse(readFileSync(join(OUT_DIR, `${label}.json`), 'utf8'))
  const comparison = compareBaselines(read(beforeLabel), read(afterLabel))
  const md = formatReport(comparison, { before: beforeLabel, after: afterLabel })
  const outFile = join(OUT_DIR, `compare-${beforeLabel}-to-${afterLabel}.md`)
  writeFileSync(outFile, md)
  process.stdout.write(`${md}\nwrote ${outFile}\n`)
}

if (process.argv[1] === import.meta.filename) main()
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project main tests/scripts/build-perf-harness.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/perf/compare-build.mjs tests/scripts/build-perf-harness.test.ts
git commit -m "perf(ci): add build perf baseline comparison"
```

---

## Task 4: Make targets and the committed baseline

**Files:**
- Modify: `Makefile` (Testing section, after `test-coverage` at line ~186)
- Create: `.planning/artifacts/perf/build/baseline-pre-phase1.md`

**Interfaces:**
- Consumes: both scripts from Tasks 2–3.
- Produces: `make perf-build LABEL=<x>` and `make perf-build-compare BEFORE=<a> AFTER=<b>`.

- [ ] **Step 1: Add the Make targets**

```makefile
perf-build: ## Measure build pipeline stage timings (LABEL=name, optional ONLY=id,id)
	node scripts/perf/measure-build.mjs $(or $(LABEL),local) $(if $(ONLY),--only $(ONLY),)

perf-build-compare: ## Compare two build perf baselines (BEFORE=a AFTER=b)
	@if [ -z "$(BEFORE)" ] || [ -z "$(AFTER)" ]; then \
		echo "usage: make perf-build-compare BEFORE=<label> AFTER=<label>"; exit 2; fi
	node scripts/perf/compare-build.mjs $(BEFORE) $(AFTER)
```

- [ ] **Step 2: Register both targets in `.PHONY`**

Append `perf-build perf-build-compare` to the `.PHONY` list on `Makefile:1`.

- [ ] **Step 3: Verify the targets resolve and appear in help**

Run: `make help | grep perf-build`
Expected: both targets listed with their `##` descriptions.

- [ ] **Step 4: Record the real pre-change baseline**

Run: `systemd-run --user --scope -p MemoryMax=16G -- make perf-build LABEL=pre-phase1`
Expected: all 10 stages exit 0; writes `pre-phase1.json`. Takes roughly 2–3 minutes.

If `systemd-run` is unavailable, run `make perf-build LABEL=pre-phase1` directly and note it in the summary.

- [ ] **Step 5: Sanity-check the baseline against the spec's measured numbers**

Run: `node -e "const b=require('./.planning/artifacts/perf/build/pre-phase1.json'); for (const s of b.stages) console.log(s.id.padEnd(24), s.wallSeconds+'s', (s.peakRssMb??'n/a')+'MB')"`

Expected, within run-to-run jitter (spec §2.1):

| Stage | Expect ≈ |
|---|---|
| `rebuild-electron-cold` / `-warm` | 33–43 s each |
| `build` | 11 s |
| `test` | 19 s |
| `typecheck` | 5–10 s |
| `lint-cold` / `lint-warm` | 21 s / 0.6 s |
| `format-cold` / `format-warm` | 7.6 s / 0.8 s |
| `rebuild-node` | 0.5 s |

**If `rebuild-electron-warm` is not ~33 s, stop and investigate** — the premise of PR 2 is that it recompiles every time. Do not proceed on a baseline that contradicts the spec.

- [ ] **Step 6: Write a short summary artifact and commit**

Create `.planning/artifacts/perf/build/baseline-pre-phase1.md` containing the table printed in Step 5, the `gitSha`, and the host's core count and RAM. Then, because the perf block ignores `build/*` except `.gitkeep`, force-add just the summary:

```bash
git add Makefile
git add -f .planning/artifacts/perf/build/baseline-pre-phase1.md
git commit -m "perf(ci): add perf-build make targets and record pre-phase1 baseline"
```

Note: the raw `pre-phase1.json` stays gitignored on purpose (matching `phase1/`/`wgs-import/` practice); only the human-readable summary is committed.

**PR 1 ends here.** Open it with the baseline table in the description.

---

## Task 5: ABI helper module

**Files:**
- Create: `scripts/native/native-abi.mjs`
- Create: `tests/scripts/native-abi.test.ts`

**Interfaces:**
- Consumes: `node-abi` (present transitively; import as `import { getAbi } from 'node-abi'`).
- Produces: `MODULE_NAME`, `MODULE_BINARY`, `electronVersion()`, `abiFor(target)`, `cacheDir(target)`, `cachedBinary(target)`, `cachedManifest(target)`, `sha256(file)`, `moduleVersion()`, `lockfileHash()`, `buildManifest(target)`, `readManifest(target)`, `manifestIsFresh(target, manifest)`, `store(target)`, `restore(target)`. `target` is `'node' | 'electron'`. Tasks 6–7 consume these exact names.

- [ ] **Step 1: Write the failing test**

```ts
// tests/scripts/native-abi.test.ts
import { readFileSync } from 'fs'
import { resolve } from 'path'

import { getAbi } from 'node-abi'
import { describe, expect, test } from 'vitest'

import {
  MODULE_NAME,
  abiFor,
  cacheDir,
  electronVersion,
  manifestIsFresh,
  moduleVersion
} from '../../scripts/native/native-abi.mjs'

const ROOT = resolve(__dirname, '..', '..')

describe('native ABI helpers', () => {
  test('targets the encrypted sqlite module', () => {
    expect(MODULE_NAME).toBe('better-sqlite3-multiple-ciphers')
  })

  test('node target ABI is this runtime ABI', () => {
    expect(abiFor('node')).toBe(process.versions.modules)
  })

  test('electron target ABI is derived from the installed electron, not hardcoded', () => {
    const installed = electronVersion()
    const pinned = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).devDependencies
      .electron
    expect(pinned).toContain(installed.split('.')[0])
    expect(abiFor('electron')).toBe(String(getAbi(installed, 'electron')))
  })

  test('node and electron ABIs differ, which is why two binaries are needed', () => {
    expect(abiFor('electron')).not.toBe(abiFor('node'))
  })

  test('rejects an unknown target rather than guessing', () => {
    expect(() => abiFor('deno')).toThrow(/unknown target/i)
  })

  test('cache dir is keyed by platform, arch and ABI', () => {
    const dir = cacheDir('electron')
    expect(dir).toContain(`${process.platform}-${process.arch}-${abiFor('electron')}`)
    expect(dir).toContain('.cache')
  })

  test('a manifest is stale when anything identifying the artifact differs', () => {
    const fresh = {
      abi: abiFor('electron'),
      platform: process.platform,
      arch: process.arch,
      moduleVersion: moduleVersion(),
      lockfileHash: 'deadbeef'
    }
    expect(manifestIsFresh('electron', null)).toBe(false)
    expect(manifestIsFresh('electron', { ...fresh, lockfileHash: 'deadbeef' })).toBe(false)
    expect(manifestIsFresh('electron', { ...fresh, abi: '1' })).toBe(false)
    expect(manifestIsFresh('electron', { ...fresh, moduleVersion: '0.0.0' })).toBe(false)
  })
})
```

Note on the last test: every case asserts `false`, including the `deadbeef` one, because a wrong lockfile hash is exactly what must invalidate the cache. Task 7's integration check proves the positive case end to end.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project main tests/scripts/native-abi.test.ts`
Expected: FAIL — `Cannot find module '../../scripts/native/native-abi.mjs'`

- [ ] **Step 3: Write the implementation**

```js
// Pure helpers for the ABI-keyed native binary cache.
//
// Why this exists: better-sqlite3-multiple-ciphers publishes no prebuild for
// Electron 43's ABI 148 (published range is 121-146), so the Electron binary
// must be compiled from source — 33.6 s. `@electron/rebuild -f` recompiled it
// on every install, dev start and CI job because `-f` defeats the tool's own
// skip logic. We cache the compiled artifact ourselves, keyed by ABI, and
// verify it rather than forcing a rebuild.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

import { getAbi } from 'node-abi'

export const MODULE_NAME = 'better-sqlite3-multiple-ciphers'
export const REPO_ROOT = resolve(import.meta.dirname, '..', '..')

export const MODULE_BINARY = join(
  REPO_ROOT,
  'node_modules',
  MODULE_NAME,
  'build',
  'Release',
  'better_sqlite3.node'
)

const readJson = (...parts) => JSON.parse(readFileSync(join(REPO_ROOT, ...parts), 'utf8'))

export function electronVersion() {
  return readJson('node_modules', 'electron', 'package.json').version
}

export function moduleVersion() {
  return readJson('node_modules', MODULE_NAME, 'package.json').version
}

export function abiFor(target) {
  if (target === 'node') return process.versions.modules
  if (target === 'electron') return String(getAbi(electronVersion(), 'electron'))
  throw new Error(`unknown target: ${target} (expected 'node' or 'electron')`)
}

export function cacheDir(target) {
  return join(REPO_ROOT, '.cache', 'native', `${process.platform}-${process.arch}-${abiFor(target)}`)
}

export const cachedBinary = (target) => join(cacheDir(target), 'better_sqlite3.node')
export const cachedManifest = (target) => join(cacheDir(target), 'manifest.json')

export function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

export function lockfileHash() {
  return sha256(join(REPO_ROOT, 'package-lock.json'))
}

export function buildManifest(target) {
  return {
    target,
    abi: abiFor(target),
    platform: process.platform,
    arch: process.arch,
    electronVersion: target === 'electron' ? electronVersion() : null,
    moduleName: MODULE_NAME,
    moduleVersion: moduleVersion(),
    lockfileHash: lockfileHash(),
    sha256: sha256(MODULE_BINARY)
  }
}

export function readManifest(target) {
  const file = cachedManifest(target)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function manifestIsFresh(target, manifest) {
  if (!manifest) return false
  return (
    manifest.abi === abiFor(target) &&
    manifest.platform === process.platform &&
    manifest.arch === process.arch &&
    manifest.moduleVersion === moduleVersion() &&
    manifest.lockfileHash === lockfileHash()
  )
}

export function store(target) {
  mkdirSync(cacheDir(target), { recursive: true })
  const manifest = buildManifest(target)
  copyFileSync(MODULE_BINARY, cachedBinary(target))
  writeFileSync(cachedManifest(target), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

export function restore(target) {
  const manifest = readManifest(target)
  if (!manifestIsFresh(target, manifest)) return false
  if (!existsSync(cachedBinary(target))) return false
  if (sha256(cachedBinary(target)) !== manifest.sha256) return false
  mkdirSync(dirname(MODULE_BINARY), { recursive: true })
  copyFileSync(cachedBinary(target), MODULE_BINARY)
  return true
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project main tests/scripts/native-abi.test.ts`
Expected: PASS — 7 tests. `abiFor('electron')` should be `'148'`.

- [ ] **Step 5: Commit**

```bash
git add scripts/native/native-abi.mjs tests/scripts/native-abi.test.ts
git commit -m "feat(native): add ABI-keyed native binary cache helpers"
```

---

## Task 6: Fail-loud ABI assertion

**Files:**
- Create: `scripts/native/assert-native-abi.mjs`

**Interfaces:**
- Consumes: `MODULE_BINARY`, `abiFor`, `readManifest`, `manifestIsFresh`, `sha256` from Task 5.
- Produces: a CLI exiting `0` on match, `1` on mismatch, `2` on bad usage. Task 7 calls it; spec Phase 2 wires it into CI.

This is the safety mechanism that makes removing `-f` legitimate. `-f` prevented wrong-ABI binaries by always recompiling; this detects them instead, which is cheaper and louder.

- [ ] **Step 1: Write the implementation**

```js
#!/usr/bin/env node
// Asserts the installed native binary is the artifact built for <target>.
// Replaces `@electron/rebuild -f` as the wrong-ABI safeguard.
// Usage: node scripts/native/assert-native-abi.mjs <node|electron>
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import process from 'node:process'

import { MODULE_BINARY, abiFor, manifestIsFresh, readManifest, sha256 } from './native-abi.mjs'

const target = process.argv[2]

if (target !== 'node' && target !== 'electron') {
  process.stderr.write('usage: assert-native-abi.mjs <node|electron>\n')
  process.exit(2)
}

const fail = (message) => {
  process.stderr.write(`assert-native-abi: FAIL (${target}): ${message}\n`)
  process.exit(1)
}

if (!existsSync(MODULE_BINARY)) fail(`${MODULE_BINARY} does not exist`)

const manifest = readManifest(target)
if (!manifestIsFresh(target, manifest)) {
  fail(
    `no fresh cache manifest for ABI ${abiFor(target)}. ` +
      `Run \`npm run rebuild:${target === 'node' ? 'node' : 'electron'}\` first.`
  )
}

if (sha256(MODULE_BINARY) !== manifest.sha256) {
  fail(
    `installed binary does not match the ${target} artifact (ABI ${manifest.abi}). ` +
      'The tree is on the wrong ABI — this would fail at runtime with NODE_MODULE_VERSION.'
  )
}

// For the node target we can go further and prove it actually loads here.
// (An electron-ABI binary cannot be loaded by this process, by definition.)
if (target === 'node') {
  try {
    createRequire(import.meta.url)(MODULE_BINARY)
  } catch (error) {
    fail(`binary matched the manifest but failed to load: ${error.message}`)
  }
}

process.stdout.write(`assert-native-abi: OK ${target} ABI ${manifest.abi}\n`)
```

- [ ] **Step 2: Verify usage errors exit 2**

Run: `node scripts/native/assert-native-abi.mjs; echo "exit=$?"`
Expected: usage message, `exit=2`.

- [ ] **Step 3: Verify it fails loudly with no cache present**

Run: `rm -rf .cache/native && node scripts/native/assert-native-abi.mjs node; echo "exit=$?"`
Expected: `assert-native-abi: FAIL (node): no fresh cache manifest…`, `exit=1`.

This confirms the assertion is not vacuous — it must fail before Task 7 makes it pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/native/assert-native-abi.mjs
git commit -m "feat(native): assert installed binary matches the target ABI"
```

---

## Task 7: Cache-aware rebuild, with `-f` removed

**Files:**
- Create: `scripts/native/rebuild-native.mjs`
- Modify: `package.json` lines 27–29 (`postinstall`, `rebuild:electron`, `rebuild:node`)

**Interfaces:**
- Consumes: `restore`, `store`, `MODULE_NAME` from Task 5; the assertion CLI from Task 6.
- Produces: `node scripts/native/rebuild-native.mjs <node|electron>`; the three npm scripts now delegate to it.

- [ ] **Step 1: Write the implementation**

```js
#!/usr/bin/env node
// Restores the target-ABI binary from .cache/native, or compiles once and caches it.
// Usage: node scripts/native/rebuild-native.mjs <node|electron>
//
// Deliberately does NOT pass `-f` to @electron/rebuild. `-f` disables both the
// "already built" skip (rebuild.js:131) and the module-state cache
// (rebuild.js:56-59, which warns "force take precedence and the cache will not
// be used"). Correctness comes from assert-native-abi.mjs instead.
import { spawnSync } from 'node:child_process'
import { availableParallelism } from 'node:os'
import process from 'node:process'

import { MODULE_NAME, abiFor, restore, store } from './native-abi.mjs'

const target = process.argv[2]
if (target !== 'node' && target !== 'electron') {
  process.stderr.write('usage: rebuild-native.mjs <node|electron>\n')
  process.exit(2)
}

if (restore(target)) {
  process.stdout.write(`native: restored ${target} ABI ${abiFor(target)} from .cache/native\n`)
  process.exit(0)
}

// node-gyp compiles single-threaded by default; the measured Electron rebuild
// ran at 98% CPU on a 32-core host. Cap the fan-out so this stays bounded —
// the June 2026 incident was caused by unbounded parallelism.
const jobs = process.env.VARLENS_NATIVE_JOBS || String(Math.min(8, availableParallelism()))

const command =
  target === 'electron'
    ? ['npx', ['@electron/rebuild', '-w', MODULE_NAME, '--jobs', jobs]]
    : ['npm', ['rebuild', MODULE_NAME]]

process.stdout.write(
  `native: compiling ${target} ABI ${abiFor(target)} (jobs=${jobs}) — no cache entry\n`
)

const result = spawnSync(command[0], command[1], {
  stdio: 'inherit',
  shell: process.platform === 'win32'
})
if (result.status !== 0) process.exit(result.status ?? 1)

const manifest = store(target)
process.stdout.write(`native: cached ${target} ABI ${manifest.abi} (sha ${manifest.sha256.slice(0, 12)})\n`)
```

- [ ] **Step 2: Rewire the npm scripts**

Replace `package.json` lines 27–29 with:

```json
    "postinstall": "node scripts/native/rebuild-native.mjs electron",
    "rebuild:electron": "node scripts/native/rebuild-native.mjs electron",
    "rebuild:node": "node scripts/native/rebuild-native.mjs node",
```

The `-f` flag is gone from both call sites. Do not add it back.

- [ ] **Step 3: Cold run — verify it compiles and caches**

Run: `rm -rf .cache/native && time npm run rebuild:electron`
Expected: `native: compiling electron ABI 148 (jobs=8) — no cache entry`, then `native: cached electron ABI 148 (sha …)`. **Should be faster than the 33.6 s baseline** because `--jobs` now parallelises the compile.

- [ ] **Step 4: Warm run — verify it restores instead of compiling**

Run: `time npm run rebuild:electron`
Expected: `native: restored electron ABI 148 from .cache/native`, **under 2 seconds**. This is the core deliverable.

- [ ] **Step 5: Verify the assertion now passes for electron**

Run: `node scripts/native/assert-native-abi.mjs electron; echo "exit=$?"`
Expected: `assert-native-abi: OK electron ABI 148`, `exit=0`.

- [ ] **Step 6: Verify the ABI round-trip both ways**

```bash
npm run rebuild:node
node scripts/native/assert-native-abi.mjs node        # expect OK node ABI 137, exit 0
node scripts/native/assert-native-abi.mjs electron    # expect FAIL, exit 1
npm run rebuild:electron
node scripts/native/assert-native-abi.mjs electron    # expect OK, exit 0
npm run rebuild:node                                  # leave tree on Node ABI for tests
```

Expected: each assertion agrees with the last rebuild. **The electron assertion must FAIL while the tree is on the Node ABI** — if it passes, the sha256 comparison is not discriminating and the safeguard is broken. Stop and fix before continuing.

- [ ] **Step 7: Confirm the test suite still runs on the Node ABI**

Run: `npm run test`
Expected: 409 passed | 4 skipped (413 files), 4526 passed | 91 skipped. No `NODE_MODULE_VERSION` errors.

- [ ] **Step 8: Commit**

```bash
git add scripts/native/rebuild-native.mjs package.json
git commit -m "perf(native): cache the compiled binary per ABI instead of forcing a rebuild"
```

---

## Task 8: Guardrails that run in the default gate

**Files:**
- Create: `tests/scripts/build-pipeline-guardrails.test.ts`

**Interfaces:**
- Consumes: `package.json` scripts as rewired in Task 7.
- Produces: assertions in the `main` vitest project, so they run under plain `make ci`.

Placed in `tests/scripts/` rather than `tests/web-gate/` because the web-gate project is excluded from `npm run test` (`package.json:35`) — assertions there do not gate `make ci`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/scripts/build-pipeline-guardrails.test.ts
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
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run --project main tests/scripts/build-pipeline-guardrails.test.ts`
Expected: PASS. (These assert Task 7's completed state, so they pass immediately — that is correct for a regression guard.)

- [ ] **Step 3: Prove the guard actually bites**

Temporarily reinsert `-f`:

```bash
node -e "const f='package.json';const p=require('./'+f);p.scripts['rebuild:electron']='npx @electron/rebuild -f -w better-sqlite3-multiple-ciphers';require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')"
npx vitest run --project main tests/scripts/build-pipeline-guardrails.test.ts
```

Expected: **FAIL** on both the `-f` and the routing assertions. Then restore:

```bash
git checkout package.json
npx vitest run --project main tests/scripts/build-pipeline-guardrails.test.ts   # PASS again
```

A guard that cannot fail is not a guard. Do not skip this step.

- [ ] **Step 4: Commit**

```bash
git add tests/scripts/build-pipeline-guardrails.test.ts
git commit -m "test(ci): guard native rebuild cacheability in the default gate"
```

---

## Task 9: Measure the result and verify the spec's targets

**Files:**
- Create: `.planning/artifacts/perf/build/compare-pre-phase1-to-post-phase1.md` (generated)
- Modify: `AGENTS.md` (Critical Gotcha section, ~line 60)

**Interfaces:**
- Consumes: the harness from PR 1 and everything from Tasks 5–8.
- Produces: the committed before/after evidence PR 2 needs.

- [ ] **Step 1: Record the post-change baseline**

Run: `systemd-run --user --scope -p MemoryMax=16G -- make perf-build LABEL=post-phase1`
Expected: all 10 stages exit 0.

- [ ] **Step 2: Generate the comparison**

Run: `make perf-build-compare BEFORE=pre-phase1 AFTER=post-phase1`
Expected: a markdown table; `rebuild-electron-warm` classified `improved`.

- [ ] **Step 3: Check the comparison against the spec's targets**

From spec §6:

| Metric | Baseline | Target | Pass? |
|---|---:|---:|---|
| `rebuild-electron-warm` | 33.6 s | **≤ 2 s** | must pass |
| `rebuild-electron-cold` | 33.6 s | ≤ 20 s (via `--jobs`) | must pass |
| `make ci` stages (lint/format/typecheck/test) | see §2.1 | no regression | must pass |
| ESLint peak RSS | 3.4 GB | no regression | must pass |

If `rebuild-electron-cold` did not improve, check whether `--jobs` reached node-gyp: run
`npx @electron/rebuild -w better-sqlite3-multiple-ciphers --jobs 8` directly and watch CPU%
with `top`. Report the actual number rather than silently missing the target.

- [ ] **Step 4: Run the full local gate**

Run: `systemd-run --user --scope -p MemoryMax=16G -- make ci`
Expected: lint, format, typecheck, rebuild-node, test all pass.

- [ ] **Step 5: Run the packaging gate**

Run: `systemd-run --user --scope -p MemoryMax=16G -- make ci-full`
Expected: PASSED. This exercises `postinstall` three times — the second and third **must** log `native: restored …`, not `native: compiling …`. That is the proof the fix works where it matters.

Note: `make ci-full` still runs `npm ci` 3× and builds 2×; deduplicating that is PR 4, not this PR.

- [ ] **Step 6: Update the AGENTS.md gotcha section**

The "Critical Gotcha: Native-Module Dual-Rebuild" section documents the old behaviour. Add after the canonical sequence:

```markdown
Since 2026-08, `rebuild:node` / `rebuild:electron` restore from an ABI-keyed cache at
`.cache/native/<platform>-<arch>-<abi>/` instead of recompiling. The first compile per ABI still
costs ~20-35 s; subsequent switches are a file copy. `@electron/rebuild` is deliberately **not**
passed `-f`, because `-f` disables both its skip logic and its cache. Correctness is enforced by
`node scripts/native/assert-native-abi.mjs <node|electron>`, which fails loud on a wrong-ABI binary.

Upstream publishes no prebuild for Electron 43's ABI 148 (published range 121-146), which is why
this compile exists at all. **When bumping Electron, check whether the new ABI has a published
prebuild** — Electron 42 (ABI 146) had one; 43 does not, and that bump alone moved `build.yml`
from ~10 min to 14.1 min.
```

- [ ] **Step 7: Commit and open the PR**

```bash
git add AGENTS.md
git add -f .planning/artifacts/perf/build/compare-pre-phase1-to-post-phase1.md
git commit -m "docs(agents): record the ABI-keyed native cache and the prebuild-window trap"
```

Open PR 2 with the comparison table in the description.

---

## Self-Review

**Spec coverage (§5 Phase 1 + §6 + §7 PRs 1–2):**

| Spec item | Task |
|---|---|
| Phase 1.1 remove `-f` | Task 7 Step 2; guarded Task 8 |
| Phase 1.2 ABI-keyed cache | Tasks 5, 7 |
| Phase 1.3 fail-loud ABI assertion | Task 6; round-trip proof Task 7 Step 6 |
| Phase 1.4 `--jobs` | Task 7 Step 1; verified Task 9 Step 3 |
| Phase 1 `make dev` benefit | Covered transitively — `dev: rebuild` (`Makefile:72`) calls `rebuild:electron`, now a restore. Verified by Task 7 Step 4. |
| §6 harness + artifacts dir | Tasks 1–4 |
| §6 peak RSS recorded | Task 2 `capture()` |
| §6 committed baseline | Task 4 Step 6 |
| §7 PR 1 / PR 2 split | PR 1 ends after Task 4; PR 2 is Tasks 5–9 |

**Deliberate deviation from the spec:** the spec put the guardrail test extension in PR 4. This plan puts the `-f` and routing guards in PR 2 (Task 8), because a guard belongs with the change it protects. It also creates a **new** file in `tests/scripts/` rather than extending `tests/web-gate/web-ci-target.test.ts`, having discovered that the web-gate project is excluded from `npm run test` and therefore does not gate `make ci`. The existing June clamps are re-asserted in the new file so they finally run by default; the originals stay where they are.

**Not in this plan** (later PRs, per spec §7): `npm ci --ignore-scripts` across the 6 CI sites (PR 3), local `ci-full` dedupe (PR 4), typecheck correctness incl. the `assumeChangesOnlyAffectDirectDependencies` removal and `src/web/**` coverage (PR 5), workflow hygiene (PR 6), cheap config wins (PR 7), TS 7 (PR 8), Vite 8 (PR 9).

**Placeholder scan:** no TBD/TODO; every code step has complete runnable content; every verification step states its expected output.

**Type consistency:** `target` is `'node' | 'electron'` everywhere. `abiFor` returns a **string** in both branches (`process.versions.modules` is a string; the electron branch wraps `getAbi` in `String()`), and `manifestIsFresh` compares it to `manifest.abi` — consistently string on both sides. `store()` returns the manifest, which Task 7 Step 1 reads as `manifest.abi` / `manifest.sha256`. `restore()` returns boolean. Baseline JSON keys (`label`, `gitSha`, `stages[].wallSeconds`, `stages[].peakRssMb`, `stages[].exitCode`) are written by Task 2 and read by Task 3's `compareBaselines`.

**Resolved anomaly — read before writing any ABI check.** During measurement it was reported that `rebuild:node` is a 0.5 s "no-op" and that an Electron-built binary appeared to load under Node. Both were investigated and **both are false**:

- `require('better-sqlite3-multiple-ciphers')` succeeds on a wrong-ABI tree because `lib/database.js:48` loads the addon **lazily**, inside a function: `addon = DEFAULT_ADDON || (DEFAULT_ADDON = require('bindings')('better_sqlite3.node'))`. Importing the package therefore proves nothing. Constructing a database is what surfaces the real error: `NODE_MODULE_VERSION 148` (Electron 43) against Node's 137.
- `rebuild:node` is a genuine binary swap, not a no-op. It is fast because `prebuild-install` pulls a **Node-ABI prebuild** from the local `~/.npm/_prebuilds` cache instead of compiling. Only the Electron ABI lacks a published prebuild, which is the entire asymmetry this plan exploits.

Two consequences that are load-bearing for Task 6:

1. **A liveness check must `dlopen` the `.node` file directly** — `createRequire(...)(MODULE_BINARY)`, as written — and must never use `require('better-sqlite3-multiple-ciphers')`, which is a false positive.
2. The dual-rebuild gotcha documented in `AGENTS.md` is **real**. Do not "simplify" the two-ABI handling away.

Task 7 Step 6 remains the deciding experiment for the cache itself: the electron assertion **must fail** while the tree is on the Node ABI. If it passes, the sha256 discrimination is broken and Task 7 must not be merged.
