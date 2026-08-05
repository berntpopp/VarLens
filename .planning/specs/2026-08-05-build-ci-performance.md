# Build & CI Performance

**Date:** 2026-08-05
**Status:** Draft — awaiting review
**Scope:** Build/CI pipeline wall clock, local and GitHub Actions. One correctness defect found en route.

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

| PR | Contents | Gate |
|---|---|---|
| 1 | Verification harness only (`scripts/perf/compare-build.mjs`, `.planning/artifacts/perf/build/`) + committed baseline | `make ci` |
| 2 | Phase 1 (native ABI cache, drop `-f`, ABI assertion, `--jobs`) | `make ci-full` |
| 3 | Phase 2 (`--ignore-scripts` + cache ordering across 6 sites) + Phase 4.11 composite action | `make ci-full` + a real CI run |
| 4 | Phase 3 (local `ci-full` dedupe) + Phase 4.12 guardrail test extension | `make ci-full` |
| 5 | Phase 4.1–4.4 (typecheck correctness: unsound flag, `src/web/**`, dead references, program narrowing) | `make ci` |
| 6 | Phase 4.5–4.10 (workflow hygiene: timeouts, `.nvmrc`, de-dupe web gate, caches) | CI run |
| 7 | Phase 5 (cheap config wins) | `make ci-full` |
| 8 | Phase 6 (TypeScript 7 / TNB) — **blocked on PR 5** | `make ci-full` |
| 9 | Phase 7 (Vite 8 + electron-vite 6) — **blocked on PR 7** | `make ci-full` |

PR 1 must land first. Without a committed baseline, no later PR can substantiate its claim, and this
spec's entire argument rests on measurement rather than intuition.

Ordering constraints that are not negotiable:
- Phase 1's ABI assertion **precedes** Phase 2, which makes the cache load-bearing.
- Phase 4.1 (drop the unsound flag) **precedes** Phase 6 (TS 7). They must not ship together.
- Phase 5.5 (delete dead `manualChunks`) **precedes** Phase 7 (which removes that API).

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

---

## 9. Provenance

Measured on 2026-08-05 by four parallel investigation agents; raw reports in the session scratchpad
(`timing-report.md`, `ci-forensics.md`, `config-anatomy.md`, `best-practices-research.md`,
`orchestration-redundancy.md`, `ci-native-cache-defect.md`).

CI figures are medians over the 5 most recent successful `build.yml` runs on `main`, split by
Electron era. Source-level claims about `@electron/rebuild` were read from the installed
`node_modules/@electron/rebuild/lib/rebuild.js` at v4.2.0.
