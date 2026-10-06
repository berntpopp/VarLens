---
id: "UI-02"
number: 8
title: "Workspace/database switch state leak in kept-alive views and singleton carrier cache"
priority: "P1 - Critical"
tags: ["ui-ux", "data-integrity", "privacy", "renderer", "bug"]
affected_files:
  - "src/renderer/src/composables/useAppState.ts"
  - "src/renderer/src/composables/useCarriers.ts"
created: "2026-10-06"
reviewed_by: "Claude Code CLI (Claude Opus 5.5)"
---

# [UI-02] Workspace/database switch state leak in kept-alive views and singleton carrier cache

| Attribute | Value |
|---|---|
| **Priority** | **P1 - Critical** |
| **Tags** | `ui-ux` `data-integrity` `privacy` `renderer` `bug` |
| **Affected Files** | `src/renderer/src/composables/useAppState.ts`, `src/renderer/src/composables/useCarriers.ts` |
| **Audited Snippet** | `resetForDatabaseSwitch() does not increment dataGeneration, so kept-alive CohortView and CaseView do...` |

---

## Technical Context & Audited Impact
Cross-contamination of patient data between different workspace files.

---

## Claude Opus 5.5 Architectural Review & Issue Specification

# UI-02 review: database switch leaves stale views and carrier data

## 1. Technical assessment

**Valid on `main` (HEAD `8a662b89`).** I checked both claims against the code:

- **Views don't reload.** On `main`, `resetForDatabaseSwitch()` (`useAppState.ts:196`) clears the presets, the case context, the active tab and the panel. It never calls `incrementDataGeneration()`. `CohortView.vue:156` and `CaseView.vue:267` only refresh in `onActivated` when `dataGeneration` has changed. `App.vue:54` keeps them alive (`<keep-alive :max="2">`), so after a switch both views come back with rows from the previous database.
- **Carrier cache leaks.** `useCarriers.ts:36` holds `carrierMap` at module level, keyed by `variant_key` (chr-pos-ref-alt). `reset()` and `clearCache()` exist, but nothing calls them on a database switch. The only other caller is `CohortDataTable.vue:608`. A locus that exists in both databases hits the cache in `loadCarriers` (line 115). The user then sees **case names and genotypes from database A** listed as carriers in database B. In a clinical tool this is attribution of findings to the wrong patient.

**Root cause.** "Reset on workspace switch" isn't owned in one place. Each singleton or cached store has to be remembered by hand inside `resetForDatabaseSwitch`, and there is no shared mechanism that cached stores subscribe to.

**Edge cases the original finding missed:**
1. **In-flight race (still open, even with the fix below).** `loadCarriers` writes to the map after its `await` (line 123) with no epoch or generation check. A `cohort:getCarriers` call started before the switch can finish afterwards and put DB-A carriers back into the cleared map.
2. **Two resets per switch.** `useShellLifecycle.ts:43` (a watch on `currentDatabasePath`) and `handleDatabaseSwitched` both call `resetForDatabaseSwitch()`, so `dataGeneration` goes up twice. That's harmless but noisy.
3. **Same path reopened.** If the same file is reopened (e.g. after a re-key or restore), the path watch doesn't fire, so only `handleDatabaseSwitched` covers it.
4. **Other module-level caches.** `useCaseMetadata` (and through it comments and metrics), `useTags` and `useAnnotations` each have their own `clearCache()`. Only metadata is cleared on switch (`clearMetadataCache`). Tags and annotations need the same audit.

**Current state:** the uncommitted changes on `feat/variant-simulator` already fix both reported defects. `resetForDatabaseSwitch` now calls `useCarriers().reset()` and `incrementDataGeneration()`, and the `useAppState.test.ts` diff asserts both. The in-flight race (1) is not fixed. This fix is unrelated to the simulator, so under the AGENTS.md branch rules it belongs on its own branch and PR. I only read the code; I ran no tests.

## 2. Severity and priority

**P1 (Critical).** It silently shows another workspace's patient identifiers and genotypes in the carrier list, which can mislead clinical interpretation. It's not P0 because it needs a mid-session workspace switch, a locus shared by both databases and an expanded cohort row, and no data is written or corrupted on disk. With the race, it becomes non-deterministic.

## 3. Labels

`bug` · `data-integrity` · `privacy` · `ui-ux` · `architecture` · `parity` (cohort cache vs case view)

## 4. Issue specification

**Title:** `fix(renderer): workspace switch leaks cohort carriers and stale kept-alive views across databases`

**Description and reproduction**
1. Open workspace A, go to Cohort, and expand variant `chrX-pos-ref-alt` so its carriers load (e.g. case `A-01`).
2. Switch to workspace B, which has a variant at the same locus (carrier `B-07`).
3. Go to Cohort. The table still shows A's rows, because `dataGeneration` didn't change and `onActivated` skips the refresh.
4. Refresh and expand the same locus. The carriers shown are `A-01`, served from the singleton `carrierMap`.
5. Race variant: expand a row and switch workspaces before `getCarriers` finishes. The A result lands in the cache after the reset.

**Expected behavior**
- After any workspace switch, every kept-alive view reloads from the new database the next time it is activated.
- No renderer cache returns data from the previous database, including responses that were already in flight when the switch happened.

**Proposed fix / architecture decision**
1. **Immediate fix (already in the working tree):** in `resetForDatabaseSwitch()`, call `useCarriers().reset()` and `incrementDataGeneration()`. Move this to a dedicated `fix/` branch along with the `useAppState.test.ts` changes.
2. **Close the race:** add a module-level `epoch` counter to `useCarriers`. `reset()` increments it, `loadCarriers` captures it before the `await`, and the result is discarded if it changed in the meantime. Add a test with a deferred promise that resolves after `reset()`.
3. **Structural fix:** add a single workspace-scope invalidation hook, e.g. `onWorkspaceSwitch(cb)` in `src/renderer/src/composables/workspaceScope.ts`. Every module-level cache (carriers, presets, metadata, comments, metrics, tags, annotations, column meta) registers its own reset there, so `resetForDatabaseSwitch` doesn't have to list them. Include a test that fails if a module-level `Map`/`ref` cache is exported without registering.
4. Remove the duplicate reset: make the `currentDatabasePath` watch the only trigger, or have `handleDatabaseSwitched` stop calling the reset itself.
5. **Verification:** `make typecheck`, then `make rebuild-node && make test`. Add an E2E test that switches between two fixture databases sharing a locus and asserts the carrier names after the switch.
