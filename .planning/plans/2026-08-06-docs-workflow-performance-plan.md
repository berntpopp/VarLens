# docs.yml Workflow Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut `.github/workflows/docs.yml` wall-clock cost by skipping runs that cannot change the published site, and reducing the cost of runs that must regenerate.

**Architecture:** Two levers plus one correctness fix, on one workflow. A workflow-level `paths` filter removes runs entirely (64/200 pushes). Targeted removals cut the cost of the 136/200 runs that must regenerate. A screenshot manifest fails the run when a test silently skips writing its PNG — a live bug today, where a stale five-month-old image is published and CI stays green. The content-keyed cache from revision 2 of the spec was **cut** after adversarial review: worth 2.2 percentage points, carrying the entire staleness surface.

**Tech Stack:** GitHub Actions, Node 24.15.0 (ESM `.mjs`), Vitest, Playwright `_electron`, VitePress.

**Spec:** `.planning/specs/2026-08-06-docs-workflow-performance.md`

## Global Constraints

- **The version rendered in screenshots must always be the current version from config.** Nothing about the version may be hardcoded, stubbed, or frozen. `package.json` is therefore hashed **in full**, version included.
- Never commit to `main`. All work on branch `perf/docs-workflow-screenshot-cache`; every branch is destined for a PR.
- GitHub Actions must be pinned to full commit SHAs with a trailing `# owner/repo@vX.Y.Z` comment on the same line.
- No `console.*` in application code. These scripts are CI tooling, not application code, and `console.log` is their output channel — that is the documented exception pattern already used by `scripts/native/*.mjs`.
- Do not lower any coverage / lint / typecheck threshold.
- Do not re-enable ESLint `--concurrency=auto`, un-serialize typecheck, add `$(MAKE) -jN`, or change vitest `pool:'forks'`. `tests/scripts/build-pipeline-guardrails.test.ts` guards all four.
- Do not add a native-ABI cache or `assert-native-abi.mjs` to `docs.yml`'s `deploy` job — it runs `npm ci --ignore-scripts`, so no binary exists to assert against.
- Do not raise `actions/deploy-pages`' `timeout` input.
- Do not restore `cancel-in-progress: false` on the `pages` concurrency group, and do not revert `node-version-file: '.nvmrc'`.
- Source files stay under 600 lines; prefer 150–400.
- No performance claim may be reported without before/after step timings from a real CI run.

## File Structure

| File | Responsibility |
| --- | --- |
| `tests/e2e/screenshots.e2e.ts` | **Modify.** Adds the expected-screenshot manifest, records each write, and fails the run if any is missing. Also removes 5 redundant sleeps. |
| `.github/workflows/docs.yml` | **Modify.** Adds the `paths` filter, `timeout-minutes`, and the Phase-2 removals. |
| `.planning/specs/2026-08-06-docs-workflow-performance.md` | **Modify** at the end — replace projections with measured results. |

---

### Task 1: Screenshot manifest validation

Fixes a live bug: `test('02 - import menu')` wraps its `saveScreenshot` in
`if ((await plusBtn.count()) > 0)` (`tests/e2e/screenshots.e2e.ts:306`). If that selector stops
matching, the test passes without writing `import-menu.png`, and `Upload screenshots` publishes the
stale committed copy — currently a March 2026 image whose footer reads `v0.30.0`. CI stays green.

**Files:**
- Modify: `tests/e2e/screenshots.e2e.ts`

**Interfaces:**
- Produces: `EXPECTED_SCREENSHOTS: readonly string[]` (23 names) and a module-level
  `capturedScreenshots: Set<string>`, both internal to the spec file.

- [ ] **Step 1: Add the manifest and the recording set**

Immediately after the `VIEWPORT` constant (`tests/e2e/screenshots.e2e.ts:18`), add:

```ts
/**
 * Every screenshot this suite is responsible for producing, in execution order.
 *
 * Test 02 writes its PNG inside a conditional (`:306`); if its selector ever
 * stops matching, the test passes without writing the file and the stale
 * committed copy gets published instead. The final test in this file asserts
 * this manifest against what was actually written, so that failure is loud.
 */
const EXPECTED_SCREENSHOTS = [
  'empty-state',
  'import-menu',
  'case-list',
  'variant-table',
  'app-layout',
  'status-bar',
  'filters-active',
  'column-filters',
  'variant-details',
  'case-metadata',
  'acmg-classification',
  'comment-dialog',
  'annotations',
  'cohort-view',
  'filter-toolbar',
  'filter-preset-bar',
  'filter-drawer-sections',
  'filter-preset-save',
  'filter-preset-manage',
  'filter-dsl-autocomplete',
  'filter-column-numeric',
  'filter-column-categorical',
  'filter-empty-state'
] as const

const capturedScreenshots = new Set<string>()
```

- [ ] **Step 2: Record writes in the shared helper**

Replace the body of `saveScreenshot` (`tests/e2e/screenshots.e2e.ts:37-40`) with:

```ts
/** Save a screenshot to the docs screenshot directory */
async function saveScreenshot(page: Page, name: string): Promise<void> {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`)
  await page.screenshot({ path: filePath, type: 'png' })
  capturedScreenshots.add(name)
}

/** Save a cropped screenshot, recording it the same way as a full-viewport one. */
async function saveClippedScreenshot(
  page: Page,
  name: string,
  clip: { x: number; y: number; width: number; height: number }
): Promise<void> {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`)
  await page.screenshot({ path: filePath, type: 'png', clip })
  capturedScreenshots.add(name)
}
```

- [ ] **Step 3: Route the two clipped screenshots through the new helper**

There are exactly two direct `window.screenshot({ ... clip ... })` calls that bypass the helper.
Replace each with a `saveClippedScreenshot` call so it is recorded.

At `tests/e2e/screenshots.e2e.ts:812-822`, replace:

```ts
      const filePath = path.join(SCREENSHOT_DIR, 'status-bar.png')
      await window.screenshot({
        path: filePath,
        type: 'png',
        clip: {
          x: footerRect.x,
          y: footerRect.y,
          width: footerRect.width,
          height: footerRect.height
        }
      })
```

with:

```ts
      await saveClippedScreenshot(window, 'status-bar', {
        x: footerRect.x,
        y: footerRect.y,
        width: footerRect.width,
        height: footerRect.height
      })
```

At `tests/e2e/screenshots.e2e.ts:1562-1572`, replace:

```ts
      const filePath = path.join(SCREENSHOT_DIR, 'filter-preset-bar.png')
      await window.screenshot({
        path: filePath,
        type: 'png',
        clip: {
          x: toolbarRect.x,
          y: toolbarRect.y,
          width: toolbarRect.width,
          height: toolbarRect.height
        }
      })
```

with:

```ts
      await saveClippedScreenshot(window, 'filter-preset-bar', {
        x: toolbarRect.x,
        y: toolbarRect.y,
        width: toolbarRect.width,
        height: toolbarRect.height
      })
```

- [ ] **Step 4: Add the final assertion test**

At the very end of the `test.describe` block — after `test('21 - filter empty state', ...)` and
before the closing `})` of the describe — add:

```ts
  // Runs last. Playwright executes tests in declaration order, and this file is
  // a single serial chain, so by this point every producing test has run.
  test('22 - every documented screenshot was captured', async () => {
    const missing = EXPECTED_SCREENSHOTS.filter((name) => !capturedScreenshots.has(name))
    expect(
      missing,
      `These screenshots were never written this run, so the stale committed copies ` +
        `would have been published: ${missing.join(', ')}`
    ).toEqual([])

    for (const name of EXPECTED_SCREENSHOTS) {
      const filePath = path.join(SCREENSHOT_DIR, `${name}.png`)
      expect(fs.existsSync(filePath), `${name}.png missing from disk`).toBe(true)
      expect(fs.statSync(filePath).size, `${name}.png is empty`).toBeGreaterThan(0)
    }
  })
```

- [ ] **Step 5: Prove the guard actually fires**

Temporarily break test 02's selector so its conditional cannot match:

```bash
sed -i "s/const plusBtn = window.locator('.v-toolbar .v-btn:has(.v-icon)').first()/const plusBtn = window.locator('.varlens-no-such-selector').first()/" tests/e2e/screenshots.e2e.ts
make rebuild && make build
xvfb-run --auto-servernum npx playwright test tests/e2e/screenshots.e2e.ts 2>&1 | tail -20
```

Expected: test 22 FAILS naming `import-menu`. Without this change the suite would have passed.

Then revert the break:
```bash
git checkout -- tests/e2e/screenshots.e2e.ts   # only if no other edits are uncommitted
```
If other edits are uncommitted, revert the selector by hand instead.

- [ ] **Step 6: Run the suite clean**

Run: `xvfb-run --auto-servernum npx playwright test tests/e2e/screenshots.e2e.ts`
Expected: 24 passed (23 producers + the new assertion).

- [ ] **Step 7: Verify lint, format, typecheck**

Run: `make lint-check && make format-check && make typecheck`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add tests/e2e/screenshots.e2e.ts
git commit -m "fix(test): fail the run when a documented screenshot was not regenerated

test 02 writes import-menu.png inside a conditional; if its selector stops
matching, the test passes without writing the file and CI publishes the
stale committed copy -- currently a March 2026 image showing v0.30.0.
Adds an explicit manifest of the 23 screenshots and asserts it."
```

---

### Task 2: `paths` filter and `timeout-minutes` on docs.yml

**Files:**
- Modify: `.github/workflows/docs.yml:3-6` (the `on:` block), and both `jobs:` entries.

**Interfaces:**
- Consumes: nothing.
- Produces: a workflow that does not run on pushes that cannot change the published site.

- [ ] **Step 1: Add the paths filter**

Replace `.github/workflows/docs.yml:3-6`:

```yaml
on:
  push:
    branches: [main]
    # The union of every input that can reach the published bytes: `docs/**`
    # (the only tree VitePress reads -- docs/.vitepress/config.mts and
    # docs/.vitepress/theme/** import nothing outside docs/) plus every input
    # to the screenshot pipeline, which is declared authoritatively in
    # the screenshot pipeline. scripts/native/** is included because it decides
    # which native binary the built app loads; a broken rebuild changes what the
    # app renders, or whether it starts at all.
    #
    # Deliberately a workflow-level filter, unlike build.yml:22-27 which uses a
    # job-level dorny/paths-filter. That comment's hazard -- workflow-level
    # `paths-ignore` leaving required status checks permanently pending -- does
    # not apply here: docs.yml has no `pull_request` trigger and is not a
    # required check. A workflow-level filter costs 0 s on a skip where a
    # job-level filter still spins up a runner. `workflow_dispatch` below is the
    # escape hatch if this filter ever wrongly skips a needed run.
    paths:
      - 'docs/**'
      - 'src/**'
      - 'tests/e2e/screenshots.e2e.ts'
      - 'tests/e2e/test-data/demo-case.json'
      - 'playwright.config.ts'
      - 'electron.vite.config.ts'
      - 'tsconfig*.json'
      - 'package.json'
      - 'package-lock.json'
      - '.nvmrc'
      - 'scripts/native/**'
      - '.github/workflows/docs.yml'
  workflow_dispatch:
```

- [ ] **Step 2: Add `timeout-minutes` to both jobs**

In `.github/workflows/docs.yml`, add to the `build-screenshots` job, immediately after `runs-on: ubuntu-latest`:

```yaml
    # Baseline is 237 s. 20 minutes is ~5x headroom -- enough for a cold native
    # cache (which adds a ~35 s compile) plus a slow runner, without letting a
    # hung Electron launch burn a full 6-hour default timeout.
    timeout-minutes: 20
```

And to the `deploy` job, immediately after `runs-on: ubuntu-latest`:

```yaml
    # Baseline is 39 s, but actions/deploy-pages waits on the Pages API with its
    # own 1200000 ms budget. 25 minutes sits just above that so the action's own
    # timeout reports the real error rather than being masked by a job kill.
    timeout-minutes: 25
```

- [ ] **Step 3: Verify the workflow still parses and guardrails still pass**

Run:
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/docs.yml')); print('yaml ok')"
npx vitest run tests/scripts/build-pipeline-guardrails.test.ts
```
Expected: `yaml ok`, and the guardrail suite passes. The new `screenshots-` key does not exist yet; this step proves the `paths`/`timeout-minutes` edits alone break nothing.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/docs.yml
git commit -m "perf(ci): skip docs.yml on pushes that cannot change the site

Measured over 200 first-parent pushes to main: 64 changed nothing the
published site depends on, yet each cost a full 276 s rebuild and
redeploy. Also adds timeout-minutes to both jobs (spec item 4.5)."
```

---

### Task 3: Delete the redundant sleeps

**Files:**
- Modify: `tests/e2e/screenshots.e2e.ts` at lines 360, 380, 1017, 1931, 1935.

**Interfaces:** none.

- [ ] **Step 1: Remove the five redundant waits**

Delete exactly these five statements. Each is immediately adjacent to a real Playwright wait that already guarantees the same condition — verify the cited neighbour is present before deleting each one.

| Line | Statement to delete | Neighbour that already guarantees it |
| --- | --- | --- |
| 360 | `await window.waitForTimeout(1500)` | `await caseItem.waitFor({ timeout: 15000 })` at 363–364 |
| 380 | `await window.waitForTimeout(500)` | `await expect(rows.first()).toBeVisible({ timeout: 15000 })` at 379 |
| 1017 | `await window.waitForTimeout(2000)` | `await firstBodyRow.waitFor({ state: 'visible', timeout: 15000 })` at 1020–1021 |
| 1931 | `await window.waitForTimeout(500)` | `await searchInput.first().click()` at 1930 (auto-waits) |
| 1935 | `await window.waitForTimeout(300)` | `await searchInput.first().fill('')` at 1934 (auto-waits) |

Delete from the highest line number downward so earlier deletions do not shift later line numbers.

- [ ] **Step 2: Verify the arithmetic**

Run:
```bash
grep -o "waitForTimeout([0-9_]*)" tests/e2e/screenshots.e2e.ts \
  | sed 's/[^0-9_]//g' | tr -d '_' \
  | awk '{s+=$1; n++} END {print "calls:", n, "total ms:", s}'
```
Expected: `calls: 90 total ms: 60800` (down from 95 / 65600).

- [ ] **Step 3: Verify lint, format and typecheck**

Run: `make lint-check && make format-check && make typecheck`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/screenshots.e2e.ts
git commit -m "perf(test): drop 4.8 s of redundant sleeps from the screenshot suite

Each removed waitForTimeout sat immediately beside a real Playwright wait
that already guaranteed the same condition. The 33 'replaceable' sleeps
are deliberately left alone: the suite is one unbroken causal chain and
rewriting them risks flake in the only pipeline that publishes the docs."
```

---

### Task 4: Determine experimentally whether the Playwright browser install is needed

**Files:**
- Modify: `.github/workflows/docs.yml` — the `Resolve Playwright version`, `Restore Playwright browsers` and `Install Playwright` steps.

**This task is an experiment. Its outcome is not predetermined. Do not claim a saving unless step 3 produces a green run.**

**Interfaces:** none.

- [ ] **Step 1: Record the hypothesis**

`screenshots.e2e.ts:203` launches via `_electron.launch({ args: ['./out/main/index.js'] })`, which drives the Electron binary from `node_modules` — it never opens a Playwright-downloaded browser. If true, `Install Playwright` (29 s) and `Restore Playwright browsers` (8 s) are both removable. The risk is that `--with-deps` also installs shared libraries (`libnss3`, `libatk`, `libgbm`, …) that Electron needs under `xvfb-run`.

- [ ] **Step 2: Remove all three steps**

Delete the `Resolve Playwright version`, `Restore Playwright browsers`, and `Install Playwright` steps from `build-screenshots`, along with the block comment above `Resolve Playwright version` that explains the browser cache.

- [ ] **Step 3: Run the experiment in CI**

```bash
git add .github/workflows/docs.yml
git commit -m "experiment(ci): drop Playwright browser install from docs.yml"
git push -u origin perf/docs-workflow-screenshot-cache
gh workflow run docs.yml --ref perf/docs-workflow-screenshot-cache
```

Wait for completion, then read the result:
```bash
RUN=$(gh run list --workflow=docs.yml --branch perf/docs-workflow-screenshot-cache \
        --limit 1 --json databaseId --jq '.[0].databaseId')
gh run view "$RUN" --log-failed | head -50
gh api "repos/berntpopp/varlens/actions/runs/$RUN/jobs" --jq '.jobs[] |
  "== \(.name) [\(.conclusion)]", (.steps[] |
  "   \((((.completed_at|fromdateiso8601)-(.started_at|fromdateiso8601))))s\t\(.name)")'
```

- [ ] **Step 4: Branch on the outcome**

**If `Generate screenshots` succeeded:** keep the removal. Record the measured saving.

**If Electron failed to launch** (look for `error while loading shared libraries` or
`Electron app closed before the first window became available`): restore only the system
dependencies without downloading browsers. Replace the three deleted steps with:

```yaml
      # Electron needs Playwright's system libraries (libnss3, libatk, libgbm, ...)
      # to start under xvfb, but it does NOT need Playwright's browser downloads --
      # screenshots.e2e.ts drives the app's own Electron binary via _electron.launch,
      # never a Playwright browser. `install-deps` installs the former without the
      # latter. Measured: see .planning/artifacts/perf/build/.
      - name: Install Playwright system dependencies
        run: npx playwright install-deps
```

Re-run step 3 and confirm green before proceeding.

- [ ] **Step 5: Commit the outcome**

```bash
git add .github/workflows/docs.yml
git commit -m "perf(ci): stop downloading Playwright browsers in docs.yml

The screenshot suite drives Electron directly via _electron.launch and
never opens a Playwright browser. Measured saving recorded in the PR."
```

---

### Task 5: Gate the apt install on a cold native cache

**Files:**
- Modify: `.github/workflows/docs.yml` — move and re-gate `Install system dependencies`.

**Interfaces:**
- Consumes: `steps.native-cache.outputs.cache-hit`, which requires adding `id: native-cache` to the existing `Restore native ABI cache` step.

- [ ] **Step 1: Give the native cache step an id**

On the `Restore native ABI cache` step, add `id: native-cache` immediately below its `name:`.

- [ ] **Step 2: Move and re-gate the apt step**

Cut the `Install system dependencies` step and re-insert it **after** `Restore native ABI cache` and **before** `Install dependencies`, with a compound condition:

```yaml
      # libsqlite3-dev and build-essential exist only to compile
      # better-sqlite3-multiple-ciphers. The ABI-keyed native cache restores a
      # prebuilt binary, so on a hit nothing compiles and these packages are
      # 9 s of dead weight. On a cold cache the compile is real and they are
      # load-bearing -- hence the condition rather than deletion.
      - name: Install system dependencies
        if: steps.native-cache.outputs.cache-hit != 'true'
        run: |
          sudo apt-get update
          sudo apt-get install -y libsqlite3-dev build-essential
```

- [ ] **Step 3: Verify the ordering is correct**

Run:
```bash
python3 - <<'PY'
import yaml
steps = yaml.safe_load(open('.github/workflows/docs.yml'))['jobs']['build-screenshots']['steps']
names = [s['name'] for s in steps]
assert names.index('Restore native ABI cache') < names.index('Install system dependencies'), \
    'apt must come AFTER the native cache restore so it can read cache-hit'
assert names.index('Install system dependencies') < names.index('Install dependencies'), \
    'apt must come BEFORE npm ci, whose postinstall may compile'
print('ordering ok')
PY
```
Expected: `ordering ok`.

- [ ] **Step 4: Verify with a COLD native cache in CI**

This is the honest test — a warm-cache run proves nothing here.

```bash
gh cache list --key native-Linux-X64 --json id --jq '.[].id' \
  | xargs -r -I{} gh api -X DELETE "repos/berntpopp/varlens/actions/caches/{}"
gh workflow run docs.yml --ref perf/docs-workflow-screenshot-cache
```
Expected: the apt step runs, the native module compiles, `Generate screenshots` succeeds.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/docs.yml
git commit -m "perf(ci): run apt install only when the native cache misses

libsqlite3-dev and build-essential exist to compile the native SQLite
module; the ABI-keyed cache means that rarely happens. Verified against a
deliberately cold native cache."
```

---

### Task 6: Measure, and replace every projection with a measured number

**Files:**
- Create: `.planning/artifacts/perf/build/docs-yml-before-after.md`
- Modify: `.planning/specs/2026-08-06-docs-workflow-performance.md` — the "Expected result" section.

**Interfaces:** none.

- [ ] **Step 1: Produce a cold-native-cache run**

This is the honest worst case, and the one that proves Tasks 4 and 5 did not break the compile path.

```bash
gh cache list --key native-Linux-X64 --json id --jq '.[].id' \
  | xargs -r -I{} gh api -X DELETE "repos/berntpopp/varlens/actions/caches/{}"
gh workflow run docs.yml --ref perf/docs-workflow-screenshot-cache
```
Record the run id as `COLD_RUN`.

- [ ] **Step 2: Produce a warm-native-cache run**

```bash
gh workflow run docs.yml --ref perf/docs-workflow-screenshot-cache
```
Record the run id as `WARM_RUN`. This is the run comparable to the 276 s baseline, which was also
measured warm.

- [ ] **Step 3: Pull step timings for both runs**

```bash
for RUN in "$COLD_RUN" "$WARM_RUN"; do
  echo "=== run $RUN ==="
  gh api "repos/berntpopp/varlens/actions/runs/$RUN/jobs" --jq '.jobs[] |
    "== \(.name) [\(.conclusion)] total=\((.completed_at|fromdateiso8601)-(.started_at|fromdateiso8601))s",
    (.steps[] | "   \((((.completed_at|fromdateiso8601)-(.started_at|fromdateiso8601))))s\t\(.name)")'
done
```

- [ ] **Step 4: Verify the screenshots are correct, not merely produced**

```bash
gh run download "$WARM_RUN" --name screenshots --dir /tmp/shots-verify
ls -la /tmp/shots-verify/*.png | wc -l
```
Expected: 23 PNGs. Open `/tmp/shots-verify/app-layout.png` and confirm the footer reads the
**current** version from `package.json` — not `v0.30.0`, and not a stubbed value. Confirm no
screenshot is blank or truncated.

- [ ] **Step 5: Write the artifact and correct the spec**

Create `.planning/artifacts/perf/build/docs-yml-before-after.md` containing: the 276 s baseline table
from the spec, both measured runs' per-step timings, and a delta column classifying each step
`improved` / `unchanged` / `removed`.

Then edit the spec's "Expected result" section: state which of the four projected outcome rows
actually occurred, and replace the projected miss cost with the measured one. Delete the sentence
beginning "Every figure above is a projection". **If a projection was missed, write the measured
number and say so explicitly — do not round in our favour.**

- [ ] **Step 6: Commit**

```bash
git add .planning/artifacts/perf/build/docs-yml-before-after.md \
        .planning/specs/2026-08-06-docs-workflow-performance.md
git commit -m "docs(planning): record measured docs.yml before/after timings"
```

---

### Task 7: Full gate and PR

- [ ] **Step 1: Run the full local gate**

Run: `make ci-full`
Expected: green. If it fails, fix the cause — do not weaken the gate.

- [ ] **Step 2: Confirm a green end-to-end docs.yml run including the Pages deploy**

```bash
gh run list --workflow=docs.yml --branch perf/docs-workflow-screenshot-cache --limit 3
```
Expected: the most recent run succeeded in **both** jobs, including `Deploy to GitHub Pages`.

If the Pages deploy fails: **retry once before investigating.** Per issue #366 a transient GitHub-side fault stalled six consecutive deploys for ~2.5 h and cleared on its own. Never use `gh run rerun --failed` on this workflow — it re-executes `upload-pages-artifact`, leaving two artifacts named `github-pages`, and `deploy-pages` then hard-errors. Always re-trigger fresh with `gh workflow run docs.yml --ref <ref>`.

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "perf(ci): make docs.yml skip, cache, and cost less" --body "$(cat <<'EOF'
Implements `.planning/specs/2026-08-06-docs-workflow-performance.md`.

## What

- Workflow-level `paths` filter — 64 of the last 200 pushes to `main` changed nothing the published site depends on, yet each cost a full 276 s rebuild and redeploy.
- Screenshot manifest validation — fixes a live bug where a silently-skipped test republishes a stale PNG and CI stays green.
- Miss-path reductions: Playwright browser install, apt gating, and 4.8 s of redundant sleeps.
- `timeout-minutes` on both jobs.

## Measured

See `.planning/artifacts/perf/build/docs-yml-before-after.md` for per-step before/after timings from real CI runs.

## Correctness

A skipped run publishes nothing, so the `paths` filter has no staleness surface. The filter set is the union of every input VitePress reads (`docs/**` only — `docs/.vitepress/config.mts` and `theme/**` import nothing outside `docs/`) and every input to the screenshot pipeline. `workflow_dispatch` is the escape hatch.

An earlier revision of this work added a content-keyed screenshot cache. It was **cut** after adversarial review (codex `gpt-5.6-terra`, xhigh): measured over 200 pushes it hits 7 times, worth ~2.2 percentage points, while carrying the entire staleness surface of the design. The review found two CRITICAL holes in it. Full record in the spec's "Adversarial review record" section. It is deferred, correctly sequenced behind the manifest validation this PR adds.

## Overlap with tracked work

Touches two items of `.planning/specs/2026-08-05-build-ci-performance.md`: item 4.5 (`timeout-minutes`, applied to `docs.yml`'s two jobs only) and item 4.10 (Playwright browser caching, which this PR *removes* from `docs.yml` because the suite drives Electron directly via `_electron.launch` and never opens a Playwright browser).

## Known gaps

Screenshots are not a deterministic function of the source: `case-metadata.png` renders the import date, `status-bar.png` renders live network status, and the suite uses no isolated `userData` dir. Documented in the spec. This is a precondition that must be addressed before the deferred cache is reconsidered.
EOF
)"
```

---

## Self-Review

**Spec coverage.** Phase 1 → Task 2. Phase 2a → Task 4. Phase 2b → Task 5. Phase 2c → Task 3. Phase 2d → Task 1. Phase 3 is deferred and deliberately has no task. Phase 4 (`timeout-minutes`) → Task 2. Verification plan → Tasks 6 and 7. The spec's "out of scope" items (33 replaceable sleeps, deploy job, repo-wide timeouts) have deliberately no task.

**Placeholders.** None. Task 5 is an experiment with two fully-written branches rather than a "figure it out" step. Task 7 requires measured numbers to replace projections and forbids reporting the projection if it was missed.

**Type consistency.** `EXPECTED_SCREENSHOTS`, `capturedScreenshots`, `saveScreenshot` and `saveClippedScreenshot` are used with identical names and shapes across Task 1's steps. `steps.native-cache.outputs.cache-hit` is the only step output referenced; Task 5 step 1 explicitly adds the `native-cache` id that its condition depends on, before step 2 uses it.
