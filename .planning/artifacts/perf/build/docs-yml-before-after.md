# `docs.yml` performance: before/after (Phases 1-4, `perf/docs-workflow-screenshot-cache`)

**Spec:** `.planning/specs/2026-08-06-docs-workflow-performance.md`
**Sample size: N=1 for the "after" run.** Every number below is a single observation, not an
average. See the Honesty caveats section before citing any figure elsewhere.

## Runs compared

| | Run ID | Ref | Commit | Cache state |
| --- | --- | --- | --- | --- |
| Baseline | `31109514729` | `main` | `1a79f98c` | warm caches (npm, native ABI, Playwright browsers) |
| After | `31120283316` | `perf/docs-workflow-screenshot-cache` | `5f0886b4` | warm native ABI cache |

The after run executed while GitHub Actions was in a `major_outage` (runner-acquisition stalls).
The `Build & Screenshots` job **completed successfully**; only the queueing/dispatch overhead
around it was affected — see caveats below for exactly what that invalidates.

## Per-step comparison — `Build & Screenshots` job

| Step | Baseline (s) | After (s) | Delta | Classification |
| --- | ---: | ---: | ---: | --- |
| Set up job | 1 | 1 | 0 | unchanged |
| Configure git line endings | 0 | 0 | 0 | unchanged |
| Checkout code | 3 | 2 | -1 | improved |
| Setup Node.js | 8 | 7 | -1 | improved |
| Allow Electron to use unprivileged user namespaces (Ubuntu 24.04) | 0 | 0 | 0 | unchanged |
| Extract Electron version | 0 | 0 | 0 | unchanged |
| Restore native ABI cache | 2 | 1 | -1 | improved |
| Install system dependencies | 9 | 0 (skipped) | -9 | removed |
| Install dependencies | 16 | 14 | -2 | improved |
| Rebuild native modules for Electron | 0 | 0 | 0 | unchanged |
| Assert native ABI | 1 | 0 | -1 | improved |
| Build Electron app | 23 | 25 | +2 | new¹ |
| Resolve Playwright version | 0 | — | -0 | removed |
| Restore Playwright browsers | 8 | — | -8 | removed |
| Install Playwright | 29 | — | -29 | removed |
| Generate screenshots | 131 | 120 | -11 | improved |
| Upload screenshots | 2 | 2 | 0 | unchanged |
| Post steps (all) | 1 | 0 | -1 | improved |
| **Step sum** | **234** | **172** | **-62** | **-26.5%** |

¹ "new" here means the step got *slower*, not that it is a newly-added step — it existed in the
baseline too. Flagged because it is the one step that regressed; folded into the step-sum total
regardless. Within run-to-run noise for a `vite build`.

`Install system dependencies` shows as `skipped` in the after run, not `0s success` — the native
ABI cache hit (Phase 2b's gating: `cache-hit != 'true'`), so the apt install for
`libsqlite3-dev`/`build-essential` never ran. This is the **warm** native-cache path only (see
caveats).

## Totals

- **Build-job step sum: 234 s → 172 s, -62 s (-26.5%).**
- Deploy job (baseline, unmodified by this change): 39 s.
- **Estimated wall clock after: 172 s (steps) + ~3 s (job overhead, matching the ~3 s gap between
  baseline's step sum and its 237 s job total) + 39 s (deploy) ≈ 214 s**, vs. 276 s baseline total
  wall clock (**-22.5%**).
- Projected over 200 pushes (64 filtered out by the Phase 1 `paths` filter at 0 s each, 136 must
  run at the ~214 s estimate): 64 × 0 + 136 × 214 = **29,104 s vs. 55,200 s baseline = 47.3%
  reduction**.

This 47.3% figure **beats** the spec's own best-case projected row ("2a fully succeeds, 2b, 2c" →
~225 s / 44.6%). See caveat 2 below — do not read this as the change outperforming the plan; read
it as one sample landing favorably on already-close projections.

## Honesty caveats — read before citing any number above

1. **N=1.** Every "after" figure is a single sample, not a distribution. In particular,
   `Generate screenshots` moved 131 s → 120 s (-11 s), but Phase 2c only deleted 4.8 s of
   deterministic `waitForTimeout` calls. **The remaining ~6.2 s is unexplained run-to-run
   variance** (runner CPU/IO noise, GC timing, etc.), not an effect of any change in this spec. Do
   not attribute the full -11 s to Phase 2c.
2. **The measured wall-clock estimate (~214 s) beat the spec's best-case projection (~225 s).**
   This is reported plainly, but the ~11 s gap is attributed to variance in the noisy small steps
   (`Setup Node.js`, `Checkout code`, `Install dependencies`, `Restore native ABI cache` each moved
   1-2 s in the improved direction) rather than to Phase 2's changes being more effective than
   designed. The projection's three named levers (2a -37 s, 2b -9 s, 2c -4.8 s = -50.8 s) landed
   close to plan (-62 s observed against non-Playwright/apt/sleep steps too); the extra headroom
   came from steps the spec never claimed credit for.
3. **The job's own `jobtotal` (418 s) for the after run is not usable and must never be quoted as
   a duration.** GitHub Actions was in a `major_outage` during this run, which caused
   runner-acquisition stalls counted inside the job total but outside any step. **Only step
   timings are comparable between the two runs.** All totals in this document are built by summing
   steps, never by reading the job-total field for the after run.
4. **Still unverified — not closed by this run:**
   - **Task 5's cold native-cache path.** `Install system dependencies` was `skipped` in this run
     because the ABI cache hit. Phase 2b's `cache-hit != 'true'` gating logic has never actually
     executed the apt-install branch on this branch. The correctness of "apt still runs, and still
     works, on a cold cache" (spec Verification plan item 3, Correctness analysis row 4) remains
     an untested code path.
   - **The Pages deploy.** The `Deploy to GitHub Pages` job for run `31120283316` is stuck in
     `waiting` because GitHub Pages was in `major_outage` at the same time. There is no green
     end-to-end run of this branch that includes a successful deploy. The 39 s deploy figure used
     in the wall-clock estimate above is carried over unmodified from the baseline run, not
     re-measured on this branch.
   - **The `paths` filter's actual skip behaviour.** No run of this workflow has been triggered by
     a push that the filter was supposed to skip — the only two runs so far were `push` (baseline,
     pre-filter) and effectively `workflow_dispatch`-equivalent on the branch, and
     `workflow_dispatch` bypasses `paths` filters entirely per GitHub's documented behaviour. The
     "64 of 200 pushes filtered out" figure comes from static git-history analysis in the spec, not
     from an observed skip.
5. **The 47.3% projection is not a measurement.** It depends on the ~214 s per-run estimate holding
   across all 136 "must run" pushes in the 200-push sample window. Some of those runs will hit a
   cold native-ABI cache (re-adding the ~9 s apt step, unverified per caveat 4 above, plus whatever
   the actual native compile costs beyond cache restore) and will be slower than this single warm
   sample. Treat 47.3% as an estimate derived from one data point, not a verified outcome.

## What Tasks 1-5 are confirmed vs. still unproven

| Task | Claim | Status after this run |
| --- | --- | --- |
| 1 (`paths` filter) | Filters out 64/200 pushes at 0 s | **Unverified in CI.** Filter is committed; no run has been triggered by a path-filtered push (see caveat 4). Static analysis only. |
| 2a (drop Playwright browser install) | -37 s, screenshots still generate without a Playwright-downloaded browser | **Confirmed on the warm path.** `Resolve/Restore/Install Playwright` steps are absent from the after run; `Generate screenshots` succeeded (120 s) using only the app's own Electron binary. |
| 2b (gate apt on cache-hit) | apt skipped on warm cache, still runs correctly on cold cache | **Warm path confirmed** (`Install system dependencies` shows `skipped`). **Cold path unverified** — never exercised on this branch (see caveat 4). |
| 2c (delete 5 redundant sleeps) | -4.8 s deterministic, zero behavioural risk | **Confirmed present in the diff and the run stayed green,** but the isolated -4.8 s contribution cannot be distinguished from run-to-run noise inside the observed -11 s on `Generate screenshots` (see caveat 1). |
| 2d (screenshot manifest validation) | Fails the run if any of the 23 expected screenshots is missing | Present in the code; the after run produced all 23 without triggering the failure path, so the happy path is confirmed but the negative-path (deliberately broken selector) test from the spec's Verification plan item 5 is a separate, still-open check. |
| 4 (`timeout-minutes`) | Adds `timeout-minutes` to both `docs.yml` jobs | Committed; not exercised (neither job in this run got close to timing out), so nothing to observe either way. |
| Pages deploy (unmodified, out of scope) | Continues to work at ~39 s | **Unverified on this branch** — stuck `waiting` due to the Pages `major_outage` (see caveat 4). |
