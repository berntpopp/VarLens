# Build & CI Performance

**Date:** 2026-08-05 · Phases 8-9 added 2026-08-06
**Status:** In progress — PRs 1-2 merged; PRs 3-5 (Phase 8, Phase 9) in flight
**Scope:** Build/CI pipeline wall clock, local and GitHub Actions. Phases 1-7 address redundancy
*within* a single `build.yml` run; Phase 8 addresses redundancy *across* workflows, where one
release packages the same code four times. One correctness defect found en route, plus three more
found while designing Phase 8 (8.4's unhashed cache tier, 8.5's unverified `latest.yml` rewrite, and
two build warnings that were never inventoried).

---

## 1. Problem

`make ci-full` and GitHub Actions both take far longer than the work they perform justifies. This
had never been investigated: every performance document in `.planning/` concerns *runtime*
(import speed, cohort queries, WGS query budgets). Build time was an untracked concern.

Measurement shows the slowness is **a regression with a specific cause**, not chronic drift.

### 1.1 Root cause

`better-sqlite3-multiple-ciphers` declares `install: "prebuild-install || node-gyp rebuild --release"`.
On Electron 40 a published prebuilt binary existed for that ABI, so `rebuild:electron` resolved in
**0.7 s**. Electron 43.3.0 uses ABI 148, for which no prebuild is published, so the command falls
through to a **from-source compile: 33.6 s locally, ~98 s on CI runners**.

`package.json:27` then multiplies that cost by every install:

```json
"postinstall": "npx @electron/rebuild -f -w better-sqlite3-multiple-ciphers"
```

`build.yml` median duration moved from **9.4–10.2 min (Electron 40) to 14.1 min (Electron 43)**.

### 1.2 Why the compile is never cached

Verified by reading `node_modules/@electron/rebuild/lib/rebuild.js`:

| Line | Behaviour |
|---|---|
| `:131` | `if (!this.force && (await moduleRebuilder.alreadyBuiltByRebuild()))` — skip is **defeated by `-f`** |
| `:46` | `this.useCache = options.useCache \|\| false` — content-addressed cache is **off by default** |
| `:56-59` | `if (this.useCache && this.force)` → warns *"force take precedence and the cache will not be used"* and sets `useCache = false` |
| CLI | `npx @electron/rebuild --help` exposes **no `--use-cache` flag** — the cache is unreachable from the CLI |

Confirmed: `~/.electron-rebuild-cache` does not exist on this machine. The cache has never been
populated. Additionally the compile runs at **98–99% CPU — single-threaded** — while `-j/--jobs`
(passed through to `node-gyp --jobs`) is available and unused.

---

## 2. Measured baseline

Environment: 32 cores / 59 GB, Node 24.15.0 (matches `.nvmrc`), each step under
`systemd-run --user --scope -p MemoryMax=16G`, timed with `/usr/bin/time -v`.

### 2.1 Per-step

| Step | Cold | Warm | Peak RSS | CPU% |
|---|---:|---:|---:|---:|
| `lint:check` | 20.75 s | **0.62 s** | 3348 / 322 MB | 181 / 166 |
| `format:check` | 7.57 s | **0.84 s** | 796 / 200 MB | 174 / 134 |
| `typecheck:renderer` (vue-tsc) | 6.92 s | 3.30 s | 1593 / 1260 MB | 178 / 186 |
| `typecheck:node` (tsc) | 3.22 s | 1.87 s | 1088 / 849 MB | 196 / 187 |
| `typecheck:contracts` | — | 0.69 s | 317 MB | 187 |
| `rebuild:node` | — | **0.48 s** (no-op) | 168 MB | 123 |
| `test` (413 files / 4617 tests) | — | 18.65 s | 760 MB | **833** |
| `build` (electron-vite) | 11.20 s | 11.70 s | 2067 MB | 150 |
| **`rebuild:electron`** | **42.32 s** | **33.57 s** (always) | 600 MB | **98 (1 core)** |
| `npm ci --ignore-scripts` (install only) | 3.32 s | — | 1222 MB | 179 |
| `npm ci` (with postinstall) | 45.50 s | — | 1232 MB | — |
| `electron-builder --publish never` | 23.70 s | — | 1511 MB | 786 |
| playwright startup-smoke (xvfb) | 2.24 s | — | 255 MB | 83 |
| playwright packaged-smoke (xvfb) | 1.19 s | — | 225 MB | 126 |

Source size: 1,411 files / 249,640 lines (`src` 815/127,280; `tests` 596/122,360).

### 2.2 Local `make ci-full` = 264 s warm

| Rank | Item | Cost | Share |
|---|---|---:|---:|
| 1 | `rebuild:electron` × 5 | **167.9 s** | **63.6%** |
| 2 | `electron-builder` | 23.7 s | 9.0% |
| 3 | `electron-vite build` × 2 | 22.9 s | 8.7% |
| 4 | `vitest run` | 18.7 s | 7.1% |
| 5 | `npm ci` tree reconciliation × 3 | 10.5 s | 4.0% |

`make ci` alone projects to **28.4 s warm / 48.5 s cold** — it is not a problem and needs no change.

### 2.3 Redundancy ledger, local `make ci-full`

| Work item | Runs | Needed | Waste |
|---|---:|---:|---:|
| `npm ci` | 3 | 1 | 2 |
| Electron-ABI native compile | 5 | 1 | **4 (134 s)** |
| `electron-vite build` | 2 | 1 | 1 (11 s) |
| `startup-smoke.e2e.ts` | 2 | 1 | 1 (2 s) |

The three job targets deliberately mirror three separate GitHub Actions jobs
(`AGENTS.md`: "GitHub Actions workflows mirror it target-for-target"). In CI each job gets a fresh
runner so per-job `npm ci` is unavoidable; locally all three run in one tree, making it pure waste.
**The fix must be composition, not deletion — each job target must remain independently runnable.**

### 2.4 GitHub Actions `build.yml` = 14.1 min

Critical path: `changes (7 s) → checks (315 s) → package/windows (482 s) → ci (3 s)` = **807 s**.
`package` has `needs: [changes, checks]`, so the two heavy phases are strictly serial —
**797 of 849 s**. macOS finishes 270 s early and idles; web-ci finishes ~5 min early.

Slowest steps (median): `electron-builder` windows 250 s · `electron-builder` ubuntu 153 s ·
`test:coverage` 137 s · `npm ci` checks 116 s · `npm ci` windows 111 s · `npm ci` ubuntu 109 s.
**Aggregated, `npm ci` is the largest single line item at 477 s across 5 invocations.**

Per `build.yml` run: **8 Electron-ABI compiles totalling 610 s, producing at most 3 distinct
artifacts (242 s needed) → 368 s (6.1 min) of runner time produces nothing that is ever loaded.**

Log-verified detail:
- Each `package` leg compiles the same binary **twice back to back** (ubuntu 98.4 s then 93.4 s;
  windows 101.1 s then 38.9 s; macos 42.4 s then 32.9 s) — 165 s wasted.
- `checks` and `web-ci` each compile an Electron-ABI binary they **never load** (98.4 + 104.6 s).
  `checks` immediately re-targets the Node ABI via `rebuild:node` (1 s).
- **The `actions/cache` native block can only ever suppress the second compile, never the first**,
  because `npm ci`'s `postinstall` always compiles before the cache is consulted.
- No build artifact is passed between jobs; every `upload-artifact` is report-only and there is no
  `download-artifact` anywhere in `build.yml`.

Per push to `main` across all workflows: **6× `npm ci`, 10 Electron-ABI compiles, 4× `electron-vite build`.**

`gh api .../actions/runs/<id>/timing` returns `duration_ms: 0` for every job — **public repo, zero
billable minutes.** Runner-minutes are free; wall clock is the only currency. This inverts the usual
trade-off and is load-bearing for decision D3 below.

---

## 3. Correctness defects found during measurement

These were not the object of the investigation. They surfaced while measuring, and two of them are
more important than any wall-clock number in this document.

### 3.1 The type gate is unsound when its cache is warm

`tsconfig.node.json:38` and `tsconfig.renderer.json:12` both set:

```json
"assumeChangesOnlyAffectDirectDependencies": true
```

This tells TypeScript to recheck only *direct* importers of a changed file, not the transitive
closure. TypeScript sanctions the flag only when full project errors are deferred to CI.

But `build.yml:156-163` caches `.cache/tsbuildinfo` **with a `restore-keys` fallback**, so CI
normally starts **warm**. CI is therefore both the deferral target and running the unsound fast
path: **a type error in a transitively-dependent file can be silently skipped by the gate.**

The cache buys ~5 s (typecheck 10.1 s cold → 5.2 s warm). That is a bad trade against soundness.

**Decision:** drop `assumeChangesOnlyAffectDirectDependencies`, keep `incremental` + the cache.
This flag must never ship together with a warm cached `.tsbuildinfo` in CI.

### 3.2 `src/web/**` is type-checked by nothing

`tsconfig.node.json:40-45` covers `main` / `preload` / `shared`; `tsconfig.renderer.json:14` covers
the renderer. **The 71 files under `src/web/**` (the Fastify web layer) are checked by no config**, so
`npm run typecheck` never touches them. `make typecheck` passing says nothing about that layer.

This is a coverage hole, not a speed problem, and fixing it will *increase* typecheck time. It is in
scope because it would be irresponsible to optimise a gate while leaving a known blind spot in it.

### 3.3 Project references are dead

`tsconfig.json:17-21` declares `references: [tsconfig.node.json]`, but that config never sets
`composite: true`, so the reference does nothing. Verified: `tsc -p tsconfig.json` emits
`TS6305: Output file '…/argon2-provider.d.ts' has not been built from source file`. `src/main`,
`preload` and `shared` are redirected to declaration outputs that never exist — there is no `tsc -b`
and no shared incremental graph.

Consequence for planning: **"add project references" is not an optimisation here, it is a repair.**
Either make them real (`composite: true` + `tsc -b`) or delete the dead `references` block. Do not
cite the existing block as evidence that references are already in use.

### 3.4 The typecheck programs overlap heavily

`tsconfig.json` sets neither `include` nor `files`, so it defaults to `**/*`: a **3300-file program**
(2484 `node_modules` `.d.ts` + 601 test files + 206 src). This is precisely the program
typescript-eslint's `projectService: true` constructs when linting `src/renderer/**` and `src/web/**`
— so **every ESLint run parses all 601 test files plus `tests/web-smoke/*.cy.ts`.** That is the bulk
of the measured 17.2 s type-aware `src` pass.

Program slots across the three checking configs total **3693 for ~940 distinct files**;
`tsconfig.typecheck-tests.json:29` alone re-includes all 111 `src/shared` files that
`tsconfig.node.json` already checks in full. `tsconfig.typecheck-tests.json` is also the only
checking config with neither `incremental` nor `tsBuildInfoFile`.

---

### 3.5 npm 12 will silently produce no native binary

**This is the highest-severity item in this document, and it is latent rather than current.**

npm 12 defaults `allowScripts` **off**, and its changelog explicitly covers native node-gyp builds.
Under npm 12, `npm ci` would run no `postinstall`, produce **no native binary at all**, and — per the
changelog — "skip silently with a warning; the install still succeeds". A green install followed by a
runtime `NODE_MODULE_VERSION`/missing-binding failure is the worst possible failure shape.

`package.json:11` currently pins `"npm": ">=11.11.0 <12"`, so this is not live today. It becomes live
the moment that ceiling is raised — plausibly via a routine Dependabot or toolchain bump.

**Mitigation:** adopt `npm approve-scripts` with `strict-allow-scripts=true` before any npm 12 move,
and assert the ceiling in the guardrail test so raising it forces a deliberate decision. Note this
interacts directly with Phase 2: once CI installs use `--ignore-scripts`, the native binary comes from
the cache plus an explicit rebuild step, which makes the pipeline *more* robust to this change, not
less — but only if the ABI assertion (Phase 1.3) is in place to catch a missing binary loudly.

### 3.6 The prebuild gap is a fork lag, and may close on its own

`better-sqlite3-multiple-ciphers` publishes Electron prebuilds only up to **ABI 146**, while
**upstream `better-sqlite3` v12.12.0 already ships `electron-v148`**. The gap is the fork trailing
upstream, not an upstream limitation.

Two consequences: file an issue with the fork asking for ABI 148 prebuilds, and treat the Phase 1
cache as the durable fix regardless — a future fork release publishing 148 would make the first
compile disappear too, but the cache is what makes the repeat cost zero either way.

## 4. Non-goals / things deliberately left alone

Measurement showed these are **already correct**. Changing them would be a regression.

- **ESLint `--concurrency=off` stays.** Measured: `off` = 21.3 s wall / 3.4 GB peak;
  `auto` = **22.9 s wall / 34.6 GB peak** — slower *and* 10× the memory, because each of 32 workers
  instantiates its own TypeScript program for the type-aware `src/**` config. The June 2026 revert
  (`8eda4a27 fix(ci): bound local quality gate resource use`) was correct.
- **`typecheck` stays serialized** (`npm run typecheck:renderer && npm run typecheck:node`), and the
  Makefile keeps no `$(MAKE) -jN`. Same memory reasoning; `make ci` is 28 s warm, so there is nothing
  to win.
- **`eslint.config.js:37-42` type-aware scoping to `src/**` only** is the single most important
  ESLint decision and is already right (measured: `src` type-aware 17.2 s vs tests+scripts 4.3 s).
- **`node_modules/.vite` must not be cached in CI.** Vite docs: dependency pre-bundling "only applies
  in development mode". Vite has no persistent production build cache (vitejs/vite#15092).
- **Vuetify Sass is *not* the problem.** The repo does not set `vuetify({ styles: { configFile } })`,
  so it is on the precompiled-CSS fast path. Do not migrate to `sass-embedded` `modern-compiler` —
  there is no Sass compile to speed up. (A *separate*, real Vuetify CSS defect exists — see Phase 5.4.)
- **`vitest.config.ts:50` `pool: 'forks'` with `isolate: true` stays.** Measured: `--pool=threads` on
  the 32 main-project files took **30.34 s and then failed** with
  `Timeout terminating threads worker … ImportService.test.ts` (reproducing vitest#8968, which the
  config's own comment cites) versus **1.39 s** on forks. `--no-isolate` makes renderer tests fail.
  Isolation is load-bearing, even though `import` accounts for 49.45 s of the suite's 74.80 s
  cumulative worker time. **Do not touch the vitest pool.**
- **`make ci`'s structure needs no change.** 28.4 s warm / 48.5 s cold — it stays five serial
  sub-makes. (Individual stages inside it do get faster via the Prettier cache fix and the ESLint
  program narrowing; what stays fixed is the serialization and the absence of `-jN`.)
- The two `vite` "dynamically imported but also statically imported" warnings stay (see `AGENTS.md`).

One correction to the record: ESLint 10's own default for `--concurrency` is already `off`
(`eslint/lib/options.js:410`), so the explicit flag in `package.json:30-31` is redundant rather than
load-bearing. Keep it anyway — it documents the intent and the guardrail test asserts it.

---

## 5. Design

Seven phases, ordered by measured value with ascending risk. Each is independently revertable and
each must land with a before/after measurement.

### Phase 1 — Stop recompiling the native module

The single highest-value change: 63.6% of local `ci-full`, 610 s per CI run — **and every `make dev`
start.** `Makefile:72` makes `dev` depend on `rebuild`, so launching the dev server recompiles the
native module from source every single time (33.6 s before the app even starts). Fixing this is the
largest day-to-day developer-experience win in the whole spec, and it is invisible in CI metrics.

1. **Remove `-f`** from `postinstall` and `rebuild:electron`. `-f` is what defeats
   `alreadyBuiltByRebuild()`. It was presumably added to avoid the wrong-ABI hazard documented in
   `AGENTS.md`; that hazard is addressed by (3) instead, which is strictly safer than forcing.
2. **Repo-owned ABI-keyed cache** at `.cache/native/<platform>-<arch>-<abi>/`, mirroring the layout
   `@electron/rebuild`'s pre-gyp copy already uses (`bin/linux-x64-148/` is present on disk). Make
   `make rebuild` / `make rebuild-node` cache-aware: compile once per ABI, then **copy** on
   subsequent switches. Turns a 33.6 s ABI switch into a file copy.
3. **Fail-loud ABI assertion.** A script that loads the module and asserts the binary's ABI matches
   the expected target, run after any cache restore or copy. This replaces `-f` as the correctness
   mechanism and is what makes removing `-f` safe.
4. **Pass `--jobs`** to bound the compile explicitly (it currently runs single-threaded at 98% CPU on
   32 cores).

   **Correction, measured 2026-08-05 during implementation: `--jobs` does not speed this up, and the
   "cold compile ≤ 20 s" target is withdrawn.** The build emits only **3 object files**, one of them
   from a **368,327-line `sqlite3.c` amalgamation**, so wall time is floored by the longest single
   translation unit and no amount of job parallelism helps. Measured with `--jobs 8`: 34.7 s versus a
   33.6 s baseline — i.e. unchanged. Keep the flag anyway: node-gyp otherwise defaults to serial
   `make`, so passing an explicit bounded value documents the intent and guarantees the June 2026
   unbounded-parallelism problem cannot recur here. Do not go looking for a cold-compile win via
   parallelism; the win is the cache, which makes the compile happen **once per ABI** instead of
   every time.

Open question for implementation: the timing agent observed that the Electron-built binary also
loaded successfully under Node 24 (sqlcipher test 18/18 pass) and that `rebuild:node` is a 0.5 s
no-op. That contradicts the dual-rebuild gotcha documented in `AGENTS.md` and **must be verified
independently before any behaviour is built on it.** Phase 1 does not depend on it being true.

### Phase 2 — CI installs stop compiling

Apply `npm ci --ignore-scripts` at every install site that precedes a native cache restore, then
restore, then rebuild only on cache miss:

```yaml
- run: npm ci --ignore-scripts
- id: native-cache
  uses: actions/cache@<sha>            # unchanged exact key, still no restore-keys
- if: steps.native-cache.outputs.cache-hit != 'true'
  run: npm run rebuild:electron
- run: node scripts/assert-native-abi.mjs electron   # Phase 1 item 3
```

Sites: `build.yml` `checks` + `package` (×3 OS), `release.yml` (×3 OS), `web-ci.yml`,
`publish-web.yml`, `docs.yml:42`. **`docs.yml:87` already does this** — the pattern is established
in-repo, this generalises it.

`checks` and `web-ci` must never build for the Electron ABI at all: install with `--ignore-scripts`
and run only `rebuild:node`.

**Phase 2 also closes a known residual from Phase 1 — do not drop this.** Phase 1 left one path that
exits 0 with a bad binary on disk: if `MODULE_BINARY` becomes *unverifiable* (the realistic trigger is
a `restore()` copy interrupted mid-write) **and** a valid `.forge-meta` is present, `@electron/rebuild`
silently no-ops the self-healing recompile, and the run lands in the deliberately sanctioned
"could not verify, continuing" branch. That branch exists on purpose — it stops a Windows `dlopen`
quirk from breaking `npm ci` — so the fix is not to remove it.

Wiring `node scripts/native/assert-native-abi.mjs <node|electron>` into CI as a required step closes
it outright, because that script fails loud (exit 1) on *undetermined* by design, where
`rebuild-native.mjs` deliberately does not. **The assertion step in the YAML above is therefore not
optional polish — it is the closure for this residual.** Note the hazard is narrow: `restore()`'s
sha256 check already rejects a cache entry whose binary and manifest disagree, and no natural
interruption produces a self-consistent corrupt pair.

While in these files, correct two stale comments left over from Phase 1 that still describe
`assert-native-abi.mjs` as the *enforcing* safeguard rather than an on-demand check:
`tests/scripts/build-pipeline-guardrails.test.ts:16-17` and `scripts/native/assert-native-abi.mjs:3`.
`AGENTS.md` was already corrected.

The existing cache key deliberately has **no `restore-keys` fallback** ("a partial match would leave
a wrong-ABI `.node` on disk and silently corrupt the build"). That reasoning is correct and must
survive. Making the cache load-bearing raises the stakes on the key, which is exactly why the
Phase 1 ABI assertion is a prerequisite.

### Phase 3 — Local `ci-full` dedupe

Introduce a shared prepare step so `ci-actions` performs one install, one Electron-ABI rebuild, one
`electron-vite build` and one startup smoke, while `ci-checks` / `ci-startup-smoke` /
`ci-package-linux` each remain runnable standalone (stamp-file or variable guard, not deletion).
Preserves the target-for-target mirror property that `AGENTS.md` requires.

### Phase 4 — Correctness and guardrails

1. Drop `assumeChangesOnlyAffectDirectDependencies` (§3.1).
2. **Bring `src/web/**` under a typecheck config** (§3.2). This makes `typecheck` slower and is
   correct anyway. Report the new baseline rather than treating the increase as a regression.
3. **Delete the dead `references` block** at `tsconfig.json:17-21` (§3.3). Chosen over making it real
   (`composite: true` + `tsc -b`): typecheck is 5.2 s warm, so a composite-project migration cannot
   pay for its risk here. Deleting removes a misleading signal that references are in use. Revisit
   only if typecheck time becomes material.
4. **Add `include` to `tsconfig.json`** (§3.4) so the default `**/*` program stops pulling 601 test
   files into every type-aware ESLint run, and de-duplicate the `src/shared` overlap in
   `tsconfig.typecheck-tests.json:29`. Give that config an `incremental` + `tsBuildInfoFile` like the
   other two. Measure the ESLint `src` pass before/after — this is the plausible lever on that 17.2 s.
5. **`timeout-minutes` on every job in all 5 workflows** — currently absent everywhere. One uncached
   `playwright install --with-deps` in `docs.yml` ran **40.8 min** (2446 s vs 40–65 s normal),
   bounded only by GitHub's 360-min default.
6. **`docs.yml`: replace hardcoded `node-version: '20'` with `node-version-file: '.nvmrc'`** (24.15.0).
   It currently builds and screenshots the app under a different Node major than the CI gating it,
   and `engines` declares `>=24.15.0`. This is a correctness item that happens to also save time.
7. **Remove the duplicate web gate.** `build.yml`'s `web-ci` job (316 s) and the standalone
   `web-ci.yml` workflow (306 s) run identical steps against identical `postgres:16` services —
   4–6.5 min duplicated per web-touching PR, including a second `npm ci` and a second uncached
   `docker build`.
8. **Fix `Makefile:232`** — `web-ci: … web-gate-static web-gate-postgres` runs the 16
   `tests/web-gate/integration` files **twice**, because the `web-gate` project's include globs
   (`vitest.config.ts:131`) already cover integration and `web-gate-postgres` re-selects the same
   directory.
9. **Cache `~/.cache/electron-builder`** — re-downloads `nsis-resources-3.4.1.7z` (~82 s, inside the
   critical-path Windows step), plus `nsis`, `appimage`, `fpm`, `dmgbuild` bundles.
   **Do not use `ELECTRON_CACHE`** — it is *not* honoured by Electron 43; the variable that works is
   `electron_config_cache`. Use `DEBUG=electron-builder` to get real per-step timers before and after,
   since electron-builder's docs state no magnitude for any option.
   Two packaging corrections worth recording: `compression: 'store'` will **not** help NSIS unless
   paired with `nsis.differentialPackage: false`, which disables auto-update — so don't. And if a
   target must be dropped on PR builds, **dropping `zip` beats dropping `portable`**, because
   `portable` reuses the NSIS payload archive and is nearly free once NSIS has run.
   For runner-cost reasoning: Windows is billed **1.67×**, not 2×.
10. **Cache Playwright browsers**, and add `cache-from`/`cache-to: type=gha` to the web-gate
    `docker build` (which `publish-web.yml` already does).
11. **Factor the repeated workflow preamble into a composite action.** 9+ jobs inline the same
    checkout / setup-node / apt-get / npm-ci sequence; a composite action makes the
    `--ignore-scripts` + cache-restore + ABI-assert ordering from Phase 2 impossible to get wrong in
    one place and forget in another.
12. **Extend `tests/web-gate/web-ci-target.test.ts`** — keep every existing clamp, add assertions:
   `postinstall` carries no bare `-f`; every CI `npm ci` preceding a native cache restore uses
   `--ignore-scripts`; every workflow job declares `timeout-minutes`; the native cache key includes
   ABI + Electron version and has no `restore-keys`. The guardrail becomes this spec's regression test.

### Phase 5 — Cheap config wins

1. `build.reportCompressedSize: false` — the only Vite build option with an explicit
   "may increase build performance" statement in the docs. Cost: loses the gzip column.
2. `build.target: 'esnext'` **for the Electron renderer only** — Electron 43 ships one known
   Chromium, so downlevelling to `baseline-widely-available` is wasted. **Must not** be applied to
   the web build, which targets real browsers.
3. Rename `eslint.config.js` → `eslint.config.mjs` to eliminate the
   `MODULE_TYPELESS_PACKAGE_JSON` reparse warning ESLint emits on every run
   ("Reparsing as ES module … This incurs a performance overhead").
4. **Fix the Prettier cache**, which currently does nothing in CI. `package.json:33-34` passes
   `--cache` with no `--cache-location`, so it writes to `node_modules/.cache/prettier/` — deleted by
   every `npm ci`. `build.yml:142-151` caches `.prettiercache`, **which is never created**
   (and is already listed in `.gitignore:11`). Add `--cache-location .prettiercache` so the path CI
   caches is the path Prettier writes. Turns a 7.57 s cold check into ~0.84 s on every CI run.
5. **Delete the dead `manualChunks: { zod: [...] }`** in `electron.vite.config.ts:59` and
   `vite.web-renderer.config.ts:85`. There are zero `zod` imports in `src/renderer`, so it emits a
   **1-byte chunk**. This is pure cleanup *and* it shrinks Phase 7's blast radius, because
   `manualChunks` object form is exactly what Vite 8 removes.
6. **Stop shipping dev-only `mockApi` (59,968 B) in the production renderer bundle**
   (`src/renderer/src/main.ts:13`).
7. **Fix the Vuetify double-CSS defect.** `src/renderer/src/plugins/vuetify.ts:2` does
   `import 'vuetify/styles'`, pulling the full 301,200 B precompiled sheet *in addition to* the
   per-component CSS that `autoImport` generates. `vite-plugin-vuetify`'s style-rewriting plugin is
   never registered because `styles` is left at its default `true`
   (`node_modules/vite-plugin-vuetify/dist/index.mjs:136`). Entry CSS is **502,188 B**. This is a
   bundle-size and load-time defect, not a build-time one — include it because it is cheap and
   adjacent, and verify against `.planning/docs/UI-PATTERNS.md` before changing theme-affecting CSS.
8. **Narrow `coverage.include`** (`vitest.config.ts:206`): `['src/**/*.{ts,vue}']` makes v8 transform
   **815 files including untested ones** on the push-to-main job, where `test:coverage` is the
   3rd-slowest CI step at 137 s. Do **not** lower any coverage threshold to achieve this
   (`AGENTS.md`); narrow what is instrumented, not what is required.
9. **`playwright.config.ts:8`**: `trace: 'retain-on-failure'` records traces for all 64 e2e specs and
   discards them on pass, while `retries: 0` (L11) means `'on-first-retry'` could never fire. Pick one
   coherent setting.
10. **`.npmrc`: measure before adopting.** An `.npmrc` is absent today, and `npm ci` is the largest
    single CI line item (477 s/run) — but `npm ci --prefer-offline --no-audit` is **not** an
    npm-recommended CI incantation despite its ubiquity in blog posts, and no official source states
    a magnitude. Treat this as a hypothesis to measure with the Phase-1 harness, not a known win.
    Most of that 477 s is the `postinstall` compile, which Phase 2 removes anyway.
11. **Repair `vitest.config.ts`.** Three separate problems in one file:
    - `minWorkers: 1` **was removed in Vitest 4** and is dead config against the installed 4.1.10.
    - The docblock at L7-36 has file counts ~3× low (says 121+11 and 61; actual 315 and 98), and the
      `maxWorkers` tuning at L56-67 was calibrated against those wrong numbers — re-derive it.
    - **`vitest.config.ts` is in no tsconfig**, which is why the dead option was invisible. Bringing
      it under a checking config (alongside §3.2's `src/web/**` gap) is what prevents a recurrence.
    **Never shard coverage** if sharding is ever considered: vitest#8616 causes under-reporting, which
    against this repo's hard thresholds would either fail spuriously or, worse, pass while
    under-measuring. Sharding plain `vitest run` is fine; coverage is not.
    Also note `tests/setup.ts` runs ~193× and is inherited by four node-only projects — a cheap place
    to look before adding anything to it.
12. **Run `checks` and `package` in parallel** — drop `package`'s `needs: checks`. Justified because
    the repo is public and billable minutes are zero (§2.4), so the only thing the gate saves is
    free runner time while costing ~5 min of wall clock on every run.

### Phase 6 — TypeScript 7 (higher risk)

TypeScript 7 (Go-native) went GA 2026-07-08. Two independent routes, and the **dual-install route is
the one to take**:

1. **`typecheck:node` on tsgo via a dual install** (Microsoft's own documented alias pattern).
   Measured on this repo: **3.21 s → 0.44 s (7.3×) with 384 MB *less* peak RSS, identical
   diagnostics.** This is the highest-confidence item in Phase 6 because it was measured here, not
   quoted from a blog.
2. **`typecheck:renderer` stays on TS 6 / vue-tsc.** TS 7 ships **no programmatic API**, so vue-tsc,
   typescript-eslint and ts-morph all still require TS 6. A future `typescript-native-bridge` (TNB,
   shipped in vue-language-tools v3.3.9) measured vue-tsc 12.8 s → 4.7 s (~2.7×) upstream, but the
   maintainer's stated ceiling is "~2-3× is about the limit" — SFC parsing, virtual code and source
   maps stay in JS. Treat TNB as a later, separate evaluation.

The dual install means TS 6 and TS 7 coexist: tsgo checks the node project, everything else keeps the
TS 6 programmatic API it depends on. That contains the blast radius to one npm script.

Hard constraint: **must not ship together with `assumeChangesOnlyAffectDirectDependencies`.**
Phase 4 item 1 is a prerequisite — an unsound incremental check would invalidate any comparison of
diagnostics between the two compilers.

Related, already correct: `skipLibCheck: true` is set in all checking configs and measured
**2.7× wall / 1.8× memory** here (9.08 s → 3.41 s). Do not remove it.

### Phase 7 — Vite 8 + electron-vite 6 (highest risk)

`electron-vite@5` peer-caps Vite at `^7`; Vite 8 support requires `electron-vite@6.0.0-beta.1` (beta).
Required rewrites, all documented in the Vite 8 migration guide:

- `build.rollupOptions.output.manualChunks` **object form is removed** → `advancedChunks.groups`.
  Used today in `electron.vite.config.ts` and `vite.web-renderer.config.ts`. **Will break** — though
  Phase 5.5 already deletes the dead `zod` group, so the surviving surface is smaller.
- `build.minify` default becomes `'oxc'`; `'esbuild'` needs esbuild as an explicit devDependency.
- `build.cssMinify` default becomes Lightning CSS.
- Default browser targets rise (chrome107→111, safari16.0→16.4).

Expected saving is small (build is 11.2 s). Included at explicit user request.

### Phase 8 — Cross-workflow rebuild elimination

Phases 1-7 address redundancy **within** one `build.yml` run. They do not touch the fact that one
release of VarLens packages the same code **four times across two workflows**.

Baseline artifact: `.planning/artifacts/perf/build/ci-cross-workflow-baseline.md` (measured from the
Actions API for `v0.70.4`; the local `measure-build.mjs` harness cannot instrument Actions topology).

| Run | ubuntu | windows | macos | subtotal |
|---|---:|---:|---:|---:|
| PR head `build.yml` (31075896010, tree `2ba72e24`) | 316 | 423 | 202 | 941 s |
| merge commit `build.yml` (31076728072, tree `2ba72e24`) | 307 | 418 | 219 | 944 s |
| release commit `build.yml` (31076764351, tree `9818f592`) | 350 | 450 | 234 | 1034 s |
| `release.yml` (31078255517, tree `9818f592`) | 344 | 528 | 193 | 1065 s |
| | | | | **3984 s = 66.4 min** |

Exactly **one** of these four produces artifacts that ship: the release commit's `build.yml` run.

Two corrections to assumptions held at the outset, both verified:

- **Tree-hash keying cannot dedupe the release-commit build.** The PR head and merge commit do share
  tree `2ba72e24`, but the release commit is `9818f592` — the three-line version bump changes
  `package.json` and therefore the tree.
- **`ELECTRON_CACHE` is read nowhere** in the installed dependency tree. It is not "not honoured by
  Electron 43"; it does not exist as an input. Two distinct caches are routinely conflated — see 8.4.

#### 8.1 Build once, promote

`build.yml`'s `package` job already produces working installers on all three OS and **discards
them** — it uploads only smoke reports, and `build.yml` contains no `download-artifact` anywhere.
`release.yml` then rebuilds the identical commit, whose `build.yml` success it explicitly polls for
before starting. Per-step evidence from `Release (Windows)` (528 s): `npm ci` 217 s + build/package
224 s = **494 s of rebuild**, against **34 s of signing** that genuinely cannot happen anywhere else.

**`build.yml` changes.** On `push` events only (not PRs — PR validation does not need the bytes, and
uploading 1.29 GB per PR is pure cost), the `package` job emits and uploads its installers:

- `provenance.json` — `{ sha, tree, run_id, run_attempt, version, os, arch }`.
- `SHA256SUMS` over every uploaded installer.
- `upload-artifact` as `installers-${{ matrix.os }}`, with `compression-level: 0` (installers are
  already compressed; the default level 6 burns CPU on both ends for nothing),
  `if-no-files-found: error`, `retention-days: 90`.
- Path globs mirror what `release.yml` uploads today so the published asset set is unchanged. The
  authoritative set, read from the published `v0.70.4` release, is 10 assets:
  `Varlens-<v>.AppImage`, `Varlens-<v>.deb`, `latest-linux.yml`, `Varlens-<v>-arm64.dmg`,
  `Varlens-<v>-arm64.zip`, `latest-mac.yml`, `Varlens-Setup-<v>.exe`, `Varlens-Portable-<v>.exe`,
  `Varlens-Setup-<v>.zip`, `latest.yml`.
- Replace the bare `npx electron-builder --publish never` with an explicit `--linux` / `--mac` /
  `--win`, so the promoted set is defined by configuration rather than inferred from the runner.

**`release.yml` changes.**

- `create-release`'s existing "Verify Build workflow passed on tagged SHA" step gains a
  `build_run_id` output. **The run we verified green is by construction the run we promote from** —
  one lookup, one identity, with no second search that could disagree with the gate.
  Harden that lookup while there: add `--event push` (a `pull_request` run reports the PR HEAD as
  `head_sha`, so tagging a commit still open in a PR could otherwise select a run that never
  uploaded installers), and assert the returned run's `headSha == $GITHUB_SHA` rather than trusting
  the `--commit` filter. Verified quirk: `gh run list --commit=<short-sha>` returns empty while
  `--commit=<full-sha>` works. The gate passes `$GITHUB_SHA`, always full, so this is latent rather
  than live — the assertion makes it non-latent.
- `release-linux` + `release-macos` collapse into one `promote-unix` job on an ubuntu runner.
- `release-windows` becomes `sign-windows`: download, verify, then the **existing, unchanged**
  Java / CodeSignTool / regenerate steps.
- Both re-upload under the existing `release-linux` / `release-macos` / `release-windows` artifact
  names, so `publish-release` needs no change at all.
- Both need `permissions: actions: read` for the cross-run download.

**Verification gate — five checks before any promoted artifact is trusted:**

1. `actions/download-artifact@v8.0.1` verifies the recorded upload digest and fails on mismatch
   (`digest-mismatch` defaults to `error`). Do not weaken it.
2. `provenance.sha == github.sha`.
3. `provenance.version == ${GITHUB_REF_NAME#v}` — belt-and-braces against the existing
   "Assert tag matches package.json version" gate, but checked against the *artifact* rather than
   the checkout.
4. `sha256sum -c SHA256SUMS`.
5. Expected-filename assertion for this version. A silently empty or partial artifact must fail
   here, not at `gh release upload`.

**Missing or expired artifacts: hard fail, no fallback build path.** Chosen deliberately over
auto-fallback: a fallback that never executes rots, and its rotting stays invisible until the day it
is needed.

The recovery path needs `build.yml` to gain a **`workflow_dispatch` trigger**. `gh run rerun` is
only permitted for **30 days** after the initial run, while artifacts are retained for 90 — so for a
run aged 30-90 days there would otherwise be no supported way to regenerate artifacts for that exact
SHA, since `build.yml` triggers only on `push` and `pull_request` today (`build.yml:3-7`). With
`workflow_dispatch`, `gh workflow run build.yml --ref <tag>` checks out the tag's commit and
regenerates. Consequences:

- The promotion lookup must accept `push` **or** `workflow_dispatch`, not `--event push` alone. The
  `headSha == $GITHUB_SHA` assertion remains the real guard; the event filter exists only to exclude
  `pull_request` runs, whose `head_sha` is the PR HEAD.
- `changes`'s `dorny/paths-filter` has no base ref on a `workflow_dispatch` event. Force
  `code=true` for that event rather than relying on filter behaviour.
- Recovery instruction in the failure message: `gh run rerun <build_run_id>` if under 30 days,
  otherwise `gh workflow run build.yml --ref <tag>`.

**Assert the tag ref still resolves to the commit being promoted.** `create-release` binds its gate
to `$GITHUB_SHA` (`release.yml:65`) but creates the release by **mutable `tag_name`**
(`release.yml:106`). If the tag is force-moved between the event and publication, the release
resolves to the new commit while the assets came from the old one. **This hazard exists today** —
the current `release.yml` builds from `$GITHUB_SHA` too — so promotion does not introduce it, but it
is the right moment to close it. Add a `git rev-parse refs/tags/<tag>^{commit} == $GITHUB_SHA`
assertion in `create-release`, and repeat it in `publish-release` immediately before flipping
`draft: false`, which is the last moment the mismatch is still correctable.

#### 8.2 Merge-commit dedupe — deferred, recorded, not dropped

The merge-commit rebuild (944 s) is genuinely redundant — identical tree to the PR-head run that
just passed. Eliminating it needs a tree-keyed stamp **plus artifact copy-forward**, because a
skipped `package` job uploads nothing, which would break 8.1's invariant if that commit were ever
tagged.

Deferred until 8.3 is measured, for two reasons stated plainly: runner time is **not billed** on
this public repo (§2.4: `duration_ms: 0`), and this is a push nobody waits on — so the 944 s is real
waste that costs neither money nor wall clock. And 8.3 removes ~100 s from each of these jobs
anyway. Decide with the post-8.3 number, not this one.

#### 8.3 Cache `.cache/native`, restored *before* `npm ci`

The `actions/cache` block added for the native binary caches
`node_modules/better-sqlite3-multiple-ciphers/build/Release` **after** `npm ci`, so it can never
suppress the compile `postinstall` already ran. §2.4 predicted this; the fresh runs confirm it.
Every packaging job reports `Cache native module: 1-5 s` then `Rebuild native modules: 0 s` — the
cache **hits** — while `npm ci` still costs 112-217 s.

`Checks (Ubuntu)` is the sharpest case: it has **no native cache block at all**
(`build.yml:134-138`), so it compiles a full Electron-ABI binary in `postinstall` that it never
loads, then re-targets the Node ABI in 2 s — directly on the critical path, since `package` has
`needs: checks`.

`.cache/native` (the ABI-keyed cache from PR #361) is local-only and cached by nothing. It is a
sibling of `node_modules`, so `npm ci` does not remove it, and `postinstall` consults it **before**
compiling (`rebuild-native.mjs:71` `if (restore(target))` → `:75 return 0`, never reaching
`compile()` at `:105`).

```yaml
- uses: actions/cache@<sha>
  with:
    path: .cache/native          # NOT bare `.cache` — `.cache/tsbuildinfo` is a sibling
    key: native-${{ runner.os }}-${{ runner.arch }}-${{ steps.electron-ver.outputs.ver }}-${{ hashFiles('package-lock.json') }}
- run: npm ci                    # postinstall becomes a file copy
- run: node scripts/native/assert-native-abi.mjs <target>
```

**The assertion target is per-job, not uniformly `electron`.** Asserting the wrong ABI would fail a
correct job. Each site asserts the ABI it actually loads:

| Site | Loads | Assert |
|---|---|---|
| `build.yml` `checks` | Node (runs Vitest after `rebuild:node`) | `node`, **after** `rebuild:node` |
| `build.yml` `package` ×3 | Electron (packages the app) | `electron` |
| `build.yml` `web-ci`, `web-ci.yml`, `publish-web.yml` | Node | `node` |
| `docs.yml:42` leg | Electron (runs `rebuild:electron`, then `electron-vite build`) | `electron` |
| `docs.yml:87` deploy leg | nothing — `npm ci --ignore-scripts`, no native module | **no cache, no assert** |

That last row is load-bearing: adding the restore-and-assert pattern there would fail, because
`--ignore-scripts` skips both the dependency's own `install` and the root `postinstall`, so no
binary is ever placed for the assertion to check.

This **replaces** the `build/Release` cache block rather than adding to it: one cache step instead
of two, covering both ABIs in one entry and covering `checks`, which has none today.

Safe to make load-bearing because the cache self-verifies three independent ways:
`manifestIsFresh()` (`native-abi.mjs:136-154`) requires target, abi, platform, arch, **moduleVersion**
and **lockfileHash** to match; `restore()` (`:164-172`) recomputes sha256 over the cached binary and
compares it to the manifest; `restoreDecision()` (`:196-199`) re-derives the ABI from the binary
actually on disk, and resolves anything other than an exact match — *including "could not
determine"* — to `purge-and-compile`. A stale or corrupt entry therefore degrades to a recompile,
never to a wrong binary.

Keep **no `restore-keys`**, matching the existing precedent. They would add nothing here (a
lockfile-mismatched entry is rejected by `manifestIsFresh` regardless) and their absence documents
the intent.

Wiring `assert-native-abi.mjs` in as a required step also **closes the residual Phase 2 was carrying**
— it fails loud (exit 1) on *undetermined*, where `rebuild-native.mjs` deliberately does not.

Install sites in scope (9 `npm ci` invocations across 5 workflows): `build.yml:135` (checks),
`:224` (package ×3 OS), `:329` (web-ci); `web-ci.yml:66`; `publish-web.yml:84`; `docs.yml:42`.
`docs.yml:87` already uses `--ignore-scripts`. **`release.yml`'s three sites need no cache — 8.1
deletes them.**

**Effect on Phase 2 — stated precisely, because a looser wording contradicts it.**

8.3 does **not** deliver Phase 2's rule that "`checks` and `web-ci` must never build for the Electron
ABI at all" (§Phase 2). On a **cold** cache — first run after any lockfile change, once per OS —
`checks` still runs an ordinary `npm ci` whose `postinstall` compiles a full Electron-ABI binary it
never loads, then re-targets Node. 8.3 removes that cost on the **warm** path only, which is the
common case but not the invariant Phase 2 asserts.

So: Phase 2 is **not superseded, and its rule still stands unmet until it ships.** What changes is
the size of its remaining prize, which must be re-derived against post-PR-3 numbers rather than the
pre-8.3 ones. Note also its repo-specific trap: `--ignore-scripts` skips `electron`'s own
`install.js`, which downloads the Electron binary.

The two phases compose rather than conflict; the end-state ordering once both have shipped is:

```yaml
- uses: actions/cache@<sha>        # restore .cache/native            (8.3)
- run: npm ci --ignore-scripts     # no compile at all                (Phase 2)
- run: npm run rebuild:<target>    # cache-restore, or compile if cold (8.3 + Phase 2)
- run: node scripts/native/assert-native-abi.mjs <target>
```

Phase 2's originally specified `--ignore-scripts → restore → conditional rebuild → assert` ordering
is preserved; 8.3 only moves the cache restore earlier, which is a no-op for Phase 2's semantics and
is what lets the interim state (before Phase 2 lands) benefit at all.

#### 8.4 electron-builder toolset cache — archive tier only

Corrects Phase 4.9. Verified from installed source (`electron-builder@26.15.3` /
`app-builder-lib@26.15.3`, `@electron/get@5.0.0`, `electron@43.3.0`):

- **`ELECTRON_CACHE` is read nowhere** in the tree.
- `electron_config_cache` (lower-case, `electron/install.js:46`) controls the **Electron binary
  download** cache → `~/.cache/electron` · `%LOCALAPPDATA%\electron\Cache` · `~/Library/Caches/electron`.
- The nsis / nsis-resources / winCodeSign / fpm / appimage / dmgbuild bundles are a **different
  cache** under `ELECTRON_BUILDER_CACHE` (`app-builder-lib/out/util/electronGet.js:34-57`) →
  `~/.cache/electron-builder` · `%LOCALAPPDATA%\electron-builder\Cache` ·
  `~/Library/Caches/electron-builder`. An override is honoured only if **absolute** (`:38`).

**Correctness hazard, and it changes the design.** electron-builder's *extracted-directory* tier
short-circuits on a `.state` sidecar plus a file-count check with **no content hashing**
(`electronGet.js:336-341` → `cacheState.js:112-131`, which verifies only that the directory is
non-empty and the file count is `>=` expected). A corrupted or partial `actions/cache` restore of an
already-`complete` extracted tool directory would be **silently served** — the archive-tier sha256
check (`electronGet.js:292-316`) and `@electron/get`'s `sumchecker` pass both sit inside a branch
the fast path never enters.

**Therefore cache the hash-verified tiers only.** After restore, delete the `.state` sidecars —
verified to be **sibling files**, `${extractDir}.state` (`cacheState.js:24`), not files inside the
directory — so `readCacheStateFile` returns null and extraction is forced back through the
sha256-checked archive path. Costs seconds of re-extraction; buys the download.

Magnitude is **unverified**: the ~82 s figure for `nsis-resources` is quoted, not measured here.
Measure with `DEBUG=electron-builder` before and after; electron-builder's docs state no magnitude
for any option.

#### 8.5 `latest.yml` integrity assertion

`release.yml`'s "Regenerate latest.yml with signed artifact hashes" step rewrites sha512 and size
through four PowerShell `-replace` regexes, and **nothing verifies the result**. If a filename ever
stops matching, the regexes silently no-op and the release ships a `latest.yml` whose hashes
describe the *unsigned* binaries — auto-update then fails at checksum verification for every user.

The risk exists today; 8.1 makes it load-bearing. Add a step after regeneration that re-reads
`latest.yml`, recomputes sha512 and size for every referenced file, and fails on any mismatch.

### Phase 9 — Warning ledger

Goal: every warning is either fixed or written down as accepted with a reason. No unexplained
warnings. Phases 5.3 and 5.5 **move here** rather than being duplicated — see §7.

1. **Delete the dead `zod` `manualChunks`** (was 5.5). `electron.vite.config.ts:56-59` and
   `vite.web-renderer.config.ts:83-86`. Proven dead: zero zod imports under `src/renderer`; the sole
   grep hit is the substring "benzodiazepine" in `hpo-terms.json`; every renderer→shared edge
   reaching a zod-importing module is `import type`. The build emits
   `Generated an empty chunk: "zod"` and a 0.00 kB asset. Keep the `vuetify` entry.
2. **Rename `eslint.config.js` → `eslint.config.mjs`** (was 5.3). Do **not** add `"type": "module"`
   to `package.json` — Node suggests it, but this is a mixed CJS/ESM Electron app. ESLint 10.8.0
   lists `eslint.config.mjs` as a candidate (`eslint/lib/config/config-loader.js:45`). Three
   functional references move in the same commit: `build.yml:56` (paths-filter), `build.yml:148` and
   `:150` (`hashFiles` cache-key inputs — a missing file silently drops from the key rather than
   failing the run). Plus a stale comment at `.prettierignore:1`. Confirm ESLint still resolves the
   config after the rename.
3. **npm deprecation triage — outcome: all five accepted, none actionable.**

   | Package | Path | Ruling |
   |---|---|---|
   | `rimraf@2.6.3` | electron-builder → app-builder-lib → electron-builder-squirrel-windows → electron-winstaller → temp → rimraf | accepted |
   | `glob@7.2.3` | electron-builder → app-builder-lib → @electron/asar → glob | accepted |
   | `inflight@1.0.6` | … → @electron/asar → glob@7 → inflight | accepted |
   | `boolean@3.2.0` | electron-builder → app-builder-lib → @electron/get@3 → global-agent → boolean | accepted |
   | `lodash.isequal@4.5.0` | electron-updater → lodash.isequal | accepted |

   Four of five sit inside `app-builder-lib`; overriding them would force majors electron-builder was
   never tested against, breaking `.asar` packaging or Squirrel generation only at `npm run dist`
   time, invisible to unit tests. `glob` additionally has two unrelated consumers at different majors
   (`@fastify/static` → glob@13, `@vue/test-utils` → glob@10), so a top-level override would collide.
   `lodash.isequal@4.5.0` is **already the latest published version** — the deprecation is permanent
   ("use `node:util.isDeepStrictEqual`"), so no override exists that could silence it; it needs an
   upstream change in `electron-updater`. **No `overrides` entries are added.**
4. **Write the accepted-warnings ledger.** One place, each entry with its reason:
   - 2× vite "dynamically imported but also statically imported" (`definitions.ts`,
     `import-logic.ts`) — already reasoned in `AGENTS.md`; both defer *module evaluation*, not
     chunking, and `tests/main/database/database-startup.test.ts` fails if the first is made static.
   - 5× `npm audit` low (elliptic, via `pdbe-molstar`) — out of scope; never `npm audit fix --force`.
   - 2× Rollup `/* #__PURE__ */` annotation from `@vueuse/core` (`dist/index.js` 3362:0, 5780:22) —
     **not previously inventoried**; upstream annotation placement, nothing here to change.
   - the 5 npm deprecations above.
5. **Investigate — `h264-mp4-encoder` externalises `path`, `fs` and `crypto` for the browser** (3
   warnings). **Also not previously inventoried, and not assumed benign.** A node-only module is
   reachable from the renderer graph and those builtins become runtime no-ops. Determine whether that
   import path can execute at runtime. If it can, this is a latent renderer defect, not a warning. If
   it cannot, accept and record. Ruling deferred to the investigation, not pre-decided.

Recorded for whoever next audits warnings: `MODULE_TYPELESS_PACKAGE_JSON` and the npm deprecations
do **not** appear in `npm run build` — they surface via `eslint` and `npm install` respectively. A
warning inventory must run all three commands.

### Phase 8 design review — independent adversarial pass

Reviewed 2026-08-06 by Codex CLI (`gpt-5.6-terra`, `model_reasoning_effort = high`), prompted to
**refute** rather than assess. Four findings, all accepted; no finding was parked.

| # | Finding | Ruling |
|---|---|---|
| 1 | A force-moved tag publishes commit A's binaries under a tag that now resolves to commit B. `create-release` gates on `$GITHUB_SHA` (`release.yml:65`) but creates by mutable `tag_name` (`release.yml:106`). | **Accepted, with a correction to its framing.** Real, and now closed by the tag-ref assertion in 8.1. But it is **pre-existing** — today's `release.yml` also builds from `$GITHUB_SHA` while publishing to a mutable tag name — so promotion does not introduce it. Codex rated it Critical on the assumption it was new. |
| 2 | "Hard fail, `gh run rerun`" has no viable recovery for a run aged 30-90 days: reruns are permitted for 30 days, artifacts retained for 90, and `build.yml` has no `workflow_dispatch`. | **Accepted in full.** The recovery instruction was simply wrong. Fixed by adding `workflow_dispatch` to `build.yml`, widening the promotion lookup to `push` or `workflow_dispatch`, and forcing `code=true` for that event in `changes`. |
| 3 | Applying 8.3's restore-and-assert to `docs.yml`'s deploy job would fail: it runs `npm ci --ignore-scripts`, so no binary exists for the assertion. | **Accepted in substance, though the literal case was already excluded** — the site list explicitly exempts `docs.yml:87`. It exposed a real error underneath: the assertion target was specified uniformly as `electron` when `checks` and `web-ci` load the **node** ABI. Fixed with the per-job target table in 8.3. |
| 4 | 8.3 contradicts Phase 2's rule that "`checks` and `web-ci` must never build for the Electron ABI", because a cold cache still compiles one in `postinstall`. Calling Phase 2 "not superseded" does not reconcile it. | **Accepted.** The wording was glib. 8.3 fixes the warm path only; Phase 2's invariant stands unmet until Phase 2 ships. 8.3 now states this explicitly and gives the composed end-state ordering. |

Attacks Codex ran and **could not** break — recorded because a failed refutation is evidence:

- **The native-cache correctness chain.** No wrong-ABI path was found under the proposed required
  assertion: `manifestIsFresh()` covers target/ABI/platform/arch/moduleVersion/lockfileHash,
  `restore()` checks sha256, restored binaries are independently ABI-probed, and the compile-path
  "undetermined" success branch (`rebuild-native.mjs:135`) is caught by the post-`npm ci` assertion.
  Also confirmed: the dependency's own `install` script result is overwritten by the root
  `postinstall`, so it does not leave the final Electron binary behind.
- **The tree-hash claim.** Confirmed against real git data, and sharpened: because installer names
  embed `${version}` (`package.json:149`, `:158`), reusing PR-head or merge-commit artifacts for the
  release commit would produce wrongly-named files even if the trees had matched. Deferring 8.2 is
  justified on that narrower ground too.
- **Artifact-set equivalence.** The proposed globs match today's Linux/macOS/Windows upload globs
  exactly, and explicit `--linux`/`--mac`/`--win` matches the current per-platform invocations.
- **`ESIGNER_ENABLED != 'true'`.** Windows binaries remain unsigned exactly as today — signing and
  `latest.yml` regeneration are both skipped while upload stays unconditional (`release.yml:303`,
  `:357`, `:430`). Promotion does not change this behaviour.

---

## 6. Verification

Mirror the repo's existing perf idiom rather than inventing one: `scripts/perf/compare-*.mjs` writing
baseline + comparison artifacts under `.planning/artifacts/perf/<topic>/`, gitignored with a
`.gitkeep`.

- Add `scripts/perf/compare-build.mjs` and `.planning/artifacts/perf/build/`.
- It must time, per phase: each `make ci` stage, `rebuild:electron` cold and warm,
  `electron-vite build`, `electron-builder`, and total `make ci-full`; and record peak RSS.
- **Every phase reports before/after from this harness.** No phase may claim an improvement without it.
- Record peak RSS explicitly — the June 2026 incident was a memory failure, and any change near the
  quality gates must show peak RSS did not regress.

### Targets

| Metric | Baseline | Target |
|---|---:|---:|
| Local `make ci-full` (warm) | 264 s | **≤ 115 s** |
| **`make dev` startup overhead** | **33.6 s** | **≤ 2 s** |
| `rebuild:electron`, second invocation same ABI | 33.6 s | **≤ 2 s** |
| `rebuild:electron`, cold compile | 33.6 s | **~34 s — target withdrawn, see below** |
| Electron-ABI compiles per `build.yml` run | 8 | **≤ 3** |
| Electron-ABI compiles per push to `main` (all workflows) | 10 | **≤ 4** |
| `build.yml` critical path | 807 s | **≤ 330 s** (Phases 1–5) |
| `format:check` in CI | 7.6 s (always cold) | ≤ 1 s (Phase 5.4) |
| ESLint type-aware `src` pass | 17.2 s | improved (Phase 4.4); report actual |
| `make ci` (warm) | 28.4 s | no regression |
| ESLint peak RSS | 3.4 GB | no regression |
| `typecheck` | 5.2 s warm | **expected to INCREASE** — Phase 4.2 adds `src/web/**` (71 files) and Phase 4.1 drops an unsound flag. Both are correctness wins; do not treat the increase as a regression. |

Phase 8 targets. **These are measured from the GitHub Actions API, not from `compare-build.mjs`** —
the local harness times local `make ci`-class stages and cannot instrument Actions topology.
Baseline: `.planning/artifacts/perf/build/ci-cross-workflow-baseline.md`.

| Metric | Baseline | Target |
|---|---:|---:|
| `release.yml` Windows job | 528 s | **≤ 120 s** (signing chain alone measures 34 s) |
| `release.yml` runner total | 1065 s | **≤ 250 s** |
| Packaging runs per release | 12 | **9** (12 → 6 was only reachable with 8.2, which is deferred) |
| `npm ci` on jobs with a warm native cache | 112–217 s | report actual |
| `build.yml` critical path | 774 s | report actual |
| Packaging runner time per release | 3984 s | report actual |

Two honesty constraints on Phase 8 claims. The compile's share of each `npm ci` above is **inferred**
from §2.1, not isolated in CI — and the macOS figure (47 s total, against a ~42 s expected compile)
does not reconcile cleanly. Isolate it before any claim rests on the split. And the ~82 s attributed
to the `nsis-resources` download in 8.4 is **quoted, not measured**; get a real number from
`DEBUG=electron-builder` before and after.

Renderer bundle context for Phase 5/7 claims: `out/` is 23 MB, renderer 21 MB, of which the Mol*
chunk is **9,140,442 B** and `plotly-basic` 1,692,371 B. Both are correctly code-split for runtime,
but rollup + esbuild reprocess all 9 MB on every build — and today that build happens twice in
`ci-full`, a third time in `docs.yml`, and three more times in `release.yml`.

Also worth cleaning up while in the area (not a build-time item): `release/` has grown to **3.2 GB**
holding 7 historical version pairs of `.deb`/`.AppImage` plus a 618 MB `linux-unpacked`.

---

## 7. PR sequencing

This spec is deliberately larger than one PR. `AGENTS.md` requires splitting work that spans multiple
boundaries, and these phases touch native tooling, workflows, tsconfigs, Vite configs and the
Makefile. Ship as follows, each independently revertable, each with a before/after from §6:

| PR | Contents | Gate | Status |
|---|---|---|---|
| 1 | Verification harness only (`scripts/perf/compare-build.mjs`, `.planning/artifacts/perf/build/`) + committed baseline | `make ci` | **merged** |
| 2 | Phase 1 (native ABI cache, drop `-f`, ABI assertion, `--jobs`) | `make ci-full` | **merged** |
| 3 | Phase 8.3 + 8.4 (`.cache/native` CI cache restored pre-`npm ci`, `assert-native-abi` as a required step, electron-builder archive-tier cache) | real CI run | |
| 4 | Phase 8.1 + 8.5 (build once, promote; `latest.yml` integrity assertion) | real CI run + a dry-run promote before it is trusted | |
| 5 | Phase 9 (warning ledger) — absorbs former Phase 5.3 and 5.5 | `make ci` | |
| 6 | Phase 2 (`--ignore-scripts` + cache ordering) + Phase 4.11 composite action — **scope re-derived against post-PR-3 numbers** | `make ci-full` + a real CI run | |
| 7 | Phase 3 (local `ci-full` dedupe) + Phase 4.12 guardrail test extension | `make ci-full` | |
| 8 | Phase 4.1–4.4 (typecheck correctness: unsound flag, `src/web/**`, dead references, program narrowing) | `make ci` | |
| 9 | Phase 4.5–4.10 (workflow hygiene: timeouts, `.nvmrc`, de-dupe web gate, caches) | CI run | |
| 10 | Phase 5 (cheap config wins) — **minus 5.3 and 5.5, which moved to PR 5** | `make ci-full` | |
| 11 | Phase 6 (TypeScript 7 / TNB) — **blocked on PR 8** | `make ci-full` | |
| 12 | Phase 7 (Vite 8 + electron-vite 6) — **blocked on PR 10** | `make ci-full` | |

PR 1 must land first. Without a committed baseline, no later PR can substantiate its claim, and this
spec's entire argument rests on measurement rather than intuition.

Phase 8 was inserted at PRs 3-4 rather than appended, because it is the largest measured item in the
document (3984 s per release) and because PR 3's native cache captures most of what Phase 2 was
going to win — so Phase 2 should be re-justified against the post-PR-3 numbers rather than shipped
on its original rationale. The former PRs 3-9 shift to 6-12 accordingly.

Ordering constraints that are not negotiable:
- Phase 1's ABI assertion **precedes** Phase 2, which makes the cache load-bearing.
- Phase 4.1 (drop the unsound flag) **precedes** Phase 6 (TS 7). They must not ship together.
- Phase 9 item 1 (delete dead `manualChunks`) **precedes** Phase 7 (which removes that API). This
  constraint used to name Phase 5.5; the item moved, the constraint did not.
- **Phase 8.3 precedes Phase 8.1.** Not a correctness constraint — 8.1's measurements are simply
  cleaner once the native-cache noise is out of the `package` jobs.
- **Phase 8.2 must not ship before 8.1.** A tree-stamp skip that suppresses artifact upload would
  break the invariant that every main-push SHA has promotable installers.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Removing `-f` leaves a wrong-ABI binary and silently corrupts a build | Phase 1 fail-loud ABI assertion, run after every restore/copy; it is a prerequisite for Phase 2, not a follow-up |
| Making the native cache load-bearing amplifies a bad cache key | Keep the exact key with no `restore-keys`; assert ABI after restore; lock both in the guardrail test |
| Parallelising `checks`/`package` wastes runner time on failures | Zero billable minutes (public repo); revisit only if the repo goes private |
| `electron-vite@6` is beta | Phase 7 is last and independently revertable; do not begin until Phases 1–5 are measured and merged |
| Dedupe breaks the "mirror target-for-target" property | Job targets stay independently runnable; guarded composition, not deletion |
| Re-introducing parallelism near the quality gates re-triggers the June OOM | Explicitly out of scope (§4); guardrail clamps kept and extended |
| **npm 12 silently ships an app with no native binary** (§3.5) | Keep the `<12` ceiling; adopt `npm approve-scripts` + `strict-allow-scripts=true` before raising it; assert the ceiling in the guardrail test; rely on the Phase 1.3 ABI assertion to fail loud rather than at runtime |
| A fork release adding ABI 148 makes part of this work look redundant (§3.6) | It does not — the cache is what makes the *repeat* cost zero. A prebuild would only remove the first compile. |
| **Promotion ships installers built from the wrong commit** (8.1) | `build_run_id` comes from the same gate that verified CI green, so there is one identity, not two. Plus `--event push`, an explicit `headSha == $GITHUB_SHA` assertion, and a `provenance.sha` check on the artifact itself. |
| **Promotion ships a partial or corrupt artifact set** (8.1) | `download-artifact`'s `digest-mismatch: error` default, `sha256sum -c SHA256SUMS`, and an expected-filename assertion against the 10-asset set. `if-no-files-found: error` on the upload side so an empty artifact fails at creation. |
| **A signed release ships a `latest.yml` describing the unsigned binaries** (8.5) | Exists today and is unverified. The new post-regeneration assertion recomputes sha512 + size for every referenced file and fails on mismatch. This is the failure mode promotion makes load-bearing, so it is a prerequisite, not a follow-up. |
| **A tag whose `build.yml` run has expired or skipped `package` cannot be released** (8.1) | Accepted, deliberately. Hard fail chosen over an auto-fallback build path that would rot unexercised and fail exactly when needed. Recovery is `gh run rerun <id>` under 30 days, or `gh workflow run build.yml --ref <tag>` beyond it — which is why 8.1 adds `workflow_dispatch` to `build.yml`. |
| **A force-moved tag publishes the previous commit's binaries** (8.1) | **Pre-existing, not introduced by promotion** — today's `release.yml` builds from `$GITHUB_SHA` while publishing to a mutable `tag_name`. Closed by asserting `refs/tags/<tag>^{commit} == $GITHUB_SHA` in `create-release` and again in `publish-release` immediately before flipping `draft: false`. |
| **A cold native cache still compiles an Electron-ABI binary in `checks`** (8.3) | Accepted and stated rather than glossed: 8.3 fixes the warm path only. Phase 2's "never build for the Electron ABI" invariant remains unmet until Phase 2 ships. Cost is bounded to once per lockfile change per OS. |
| **A corrupted electron-builder tool cache is served silently** (8.4) | Real: the extracted-directory tier validates file *count*, not content (`cacheState.js:112-131`). Mitigated by caching only hash-verified tiers and deleting `${extractDir}.state` sidecars after restore, forcing re-extraction through the sha256-checked archive path. |
| A stale `.cache/native` GitHub cache entry installs a wrong-ABI binary (8.3) | Cannot: `manifestIsFresh` checks moduleVersion + lockfileHash + ABI + platform + arch, `restore()` sha256-checks against the manifest, and `restoreDecision()` re-derives the ABI from the binary on disk — resolving *undetermined* to `purge-and-compile`. Degrades to a recompile, never a wrong binary. Keep no `restore-keys`. |

---

## 9. Provenance

Measured on 2026-08-05 by four parallel investigation agents; raw reports in the session scratchpad
(`timing-report.md`, `ci-forensics.md`, `config-anatomy.md`, `best-practices-research.md`,
`orchestration-redundancy.md`, `ci-native-cache-defect.md`).

CI figures are medians over the 5 most recent successful `build.yml` runs on `main`, split by
Electron era. Source-level claims about `@electron/rebuild` were read from the installed
`node_modules/@electron/rebuild/lib/rebuild.js` at v4.2.0.
