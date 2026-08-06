# CI cross-workflow baseline — 2026-08-06

Baseline for spec `2026-08-05-build-ci-performance.md` **Phase 8** (cross-workflow rebuild
elimination). Unlike the other artifacts in this directory, this one is **not** produced by
`scripts/perf/measure-build.mjs` — that harness times *local* `make ci`-class stages, and Phase 8
changes only GitHub Actions topology. The evidence here is therefore job/step timings read from
the Actions API, which is the only instrument that can measure what Phase 8 changes.

Source: `gh api repos/berntpopp/varlens/actions/runs/<id>/jobs`. All durations are
`completed_at - started_at` per job/step. Release `v0.70.4`.

## Runs measured

| Role | Workflow | Run ID | Commit | Tree |
|---|---|---|---|---|
| PR head | `build.yml` | 31075896010 | `114ab762` | `2ba72e24` |
| merge commit | `build.yml` | 31076728072 | `f0a898a5` | `2ba72e24` |
| release commit | `build.yml` | 31076764351 | `4f220d8a` | `9818f592` |
| release | `release.yml` | 31078255517 | `4f220d8a` | `9818f592` |

The PR head and the merge commit have **identical trees**. The release commit does not — the
three-line version bump changes `package.json`, so tree-hash keying can never dedupe the
release-commit build. Recorded because the opposite was assumed at the outset.

## Packaging ledger

| Run | ubuntu | windows | macos | subtotal |
|---|---:|---:|---:|---:|
| PR head | 316 | 423 | 202 | 941 s |
| merge commit | 307 | 418 | 219 | 944 s |
| release commit | 350 | 450 | 234 | 1034 s |
| `release.yml` | 344 | 528 | 193 | 1065 s |
| | | | | **3984 s = 66.4 min** |

Exactly one of these four produces artifacts that ship: the release commit's `build.yml` run.
`release.yml` re-derives byte-equivalent installers from the same SHA whose `build.yml` success it
explicitly polls for before starting.

## Where the time goes

### `release.yml` — `Release (Windows)`, 528 s total

| Step | Cost |
|---|---:|
| Install dependencies (`npm ci`) | 217 s |
| Build (`electron-vite build` + `electron-builder --win`) | 224 s |
| Setup Java for CodeSignTool | 5 s |
| Download and configure CodeSignTool | 7 s |
| Sign 2 exes with CodeSignTool | 19 s |
| Regenerate `latest.yml` | 3 s |
| Upload artifacts | 14 s |

**494 of 528 s is rebuild. 34 s is signing** — the only work in this job that `build.yml` cannot
already have done.

### `release.yml` — other legs

| Step | Linux (344 s) | macOS (193 s) |
|---|---:|---:|
| Install dependencies | 112 s | 47 s |
| Build | 186 s | 106 s |
| Upload artifacts | 13 s | 14 s |

### The native compile that no cache suppresses

Every packaging job reports `Cache native module for Electron ABI: 1-5 s` followed by
`Rebuild native modules for Electron: 0 s` — the `actions/cache` block **hits**, and the explicit
rebuild is correctly skipped. Yet `npm ci` still costs:

| Job | `npm ci` |
|---|---:|
| `build.yml` `Checks (Ubuntu)` | 121 s |
| `build.yml` `Package (ubuntu)` | 119 s |
| `build.yml` `Package (windows)` | 217 s |
| `build.yml` `Package (macos)` | 140 s |
| `release.yml` Linux | 112 s |
| `release.yml` Windows | 217 s |
| `release.yml` macOS | 47 s |

This is the defect spec §2.4 predicted, now confirmed against fresh runs: `postinstall` compiles
the Electron-ABI binary *before* the cache step can be consulted, and the cache restore then
overwrites the freshly compiled result. The cache can only ever suppress the **second** compile.

`Checks (Ubuntu)` is the sharpest case — it has **no native cache block at all** (`build.yml:134-138`
is `npm ci` then `npm run rebuild:node`), so it compiles a full Electron-ABI binary in `postinstall`
that it never loads, then re-targets the Node ABI in 2 s. That compile sits directly on the
critical path, because `package` has `needs: checks`.

**Caveat, stated rather than glossed:** the compile's exact share of each `npm ci` above is
*inferred* from spec §2.1 (`npm ci --ignore-scripts` 3.32 s vs `npm ci` 45.50 s locally), not
isolated in CI. The macOS figure (47 s total) is hard to reconcile with a ~42 s compile and may
indicate something different is happening on that runner. Isolating this is a task in the Phase 8
plan; no Phase 8 claim should rest on the inferred split until it is measured directly.

### `build.yml` critical path, release-commit run

`changes (6 s) → checks (315 s) → package/windows (450 s) → ci (3 s)` = **774 s**.
`Checks (Ubuntu)` breakdown: `npm ci` 121 s · `test:coverage` 136 s · `format:check` 17 s ·
`typecheck` 15 s · `lint` 2 s.

## Targets for Phase 8

| Metric | Baseline | Target | How it will be measured |
|---|---:|---:|---|
| `release.yml` Windows job | 528 s | ≤ 120 s | Actions API, first release after merge |
| `release.yml` runner total | 1065 s | ≤ 250 s | Actions API |
| Packaging runs per release | 12 | 9 | count of `package`/`release-*` jobs |
| `npm ci` on jobs with a warm native cache | 112-217 s | report actual | Actions API |
| `build.yml` critical path | 774 s | report actual | Actions API |
| Packaging runner time per release | 3984 s | report actual | sum of the ledger above |

Phase 8.2 (merge-commit dedupe, 944 s) is **deferred**, so the 12 → 9 figure is the honest one;
12 → 6 was only ever reachable with 8.2 included.
