# VarLens Performance & Maintainability Audit — Implementation Design

Date: 2026-04-01
Status: Approved
Approach: Sequential depth-first (Phase 1 → 2 → 3), single branch

## Context

This spec covers implementation of all 12 findings from the [performance audit](./../performance-audit-2026-04-01.md). Work is structured in 3 phases ordered by ROI. All phases land on a single branch. Each finding includes the proposed structural scope — some are localized fixes, others involve moderate refactoring approved on a case-by-case basis.

Target scale: 10k+ variants per case, 100+ cases in cohorts.

Metrics are informational only — no benchmark tooling is included in this spec.

## Phase 1: Highest ROI Fixes

### 1.1 Cohort skipCount Wiring (Finding #3)

**Problem:** `CohortTable.vue`'s `fetchPage` callback ignores the `skipCount` argument from `useOffsetPagination`, so every page/sort change pays full `COUNT(*)` cost.

**Change:** Forward `skipCount` into `CohortQueryParams` as `_count_needed: !skipCount`.

**Files:**
- `src/renderer/src/components/CohortTable.vue` (~line 230): accept `skipCount` parameter in `fetchPage`, add `_count_needed: !skipCount` to `params`

**Scope:** ~3 lines changed. No structural change. Backend already supports `_count_needed !== false` in `cohort.ts:238`.

### 1.2 Import Batch Finalization (Finding #4)

**Problem:** `ColumnarStrategy` and `ObjectStrategy` call `insertVariantsBatch()` as their flush function, which wraps each batch in `beginBulkInsert()`/`finishBulkInsert()`. This rebuilds FTS, restores triggers, and runs `ANALYZE` every 5k rows instead of once per file.

**Change:** Adopt the same pattern VCF import already uses:
1. Strategy calls `beginBulkInsert()` once before streaming starts
2. `BatchAccumulator`'s flush uses `insertBatch()` (insert-only, no finalization)
3. Strategy calls `finishBulkInsert()` once after the pipeline completes

**Failure/cancellation contract:** The `beginBulkInsert()` → pipeline → `finishBulkInsert()` sequence MUST use `try/finally` semantics. `finishBulkInsert()` runs in the `finally` block regardless of whether the pipeline throws or is cancelled. This ensures FTS triggers are restored and `ANALYZE` runs even on partial imports. On partial import (pipeline error or cancellation after some batches inserted):
- `finishBulkInsert()` still runs — FTS is rebuilt for whatever rows were inserted, triggers are restored
- The case's `variant_count` reflects the actual number of rows inserted (not the expected total)
- The import result is reported as `failed` with the inserted count and error message, so the user can decide whether to keep or delete the partial case

**Files:**
- `src/main/import/strategies/ColumnarStrategy.ts`: wrap pipeline in try/finally with begin/finish bulk insert, pass `insertBatch` as flush function
- `src/main/import/strategies/ObjectStrategy.ts`: same pattern
- `src/main/import/transforms/BatchAccumulator.ts`: flush function signature may need adjustment if it currently assumes `insertVariantsBatch`

**Scope:** 3 files. `VariantRepository` API unchanged — `beginBulkInsert()`, `insertBatch()`, `finishBulkInsert()` already exist.

### 1.3 Keep-Alive Activation Gating (Finding #2)

**Problem:** `useCohortData.ts` registers a live summary listener that continues firing when the cohort route is cached but not visible (via `<keep-alive>`). Hidden views burn IPC and DB work.

**Change:** Two surfaces need gating:
1. **Summary listener** (in `useCohortData.ts` ~line 124): the `onSummaryRebuilt` listener fires regardless of route visibility. Gate registration behind `onActivated`/`onDeactivated` — unregister on deactivation, re-register on activation.
2. **Page fetching** (driven from `CohortTable.vue` ~line 229 via `useOffsetPagination`): pagination's `fetchPage` callback can fire if reactive dependencies update while the route is cached. Guard the fetch callback with an `isActive` ref that `onDeactivated` sets to false, causing fetches to short-circuit.

On activation: re-register summary listener, check staleness, and reload the current page if data may have changed while deactivated.

**Files:**
- `src/renderer/src/composables/useCohortData.ts`: gate summary listener registration
- `src/renderer/src/components/CohortTable.vue`: gate fetchPage callback with activation state, wire `onActivated`/`onDeactivated`

**Scope:** 2 files. Moderate change to composable and component lifecycle management.

### 1.4 VariantTable Precomputed Row State (Finding #1)

**Problem:** `VariantTable.vue` calls `getLinkForColumn()`, `resolveLink()`, `isStarred()`, `getAcmgClassification()`, `getPerCaseComment()`, `getGlobalComment()` per cell in template slots on every render. With many columns and rows, this creates significant per-frame work.

**Change:** Create a `useVariantRowViewModel` composable that precomputes a `Map<string, RowViewModel>` from the current page's variants + annotation cache + link configuration. Template slots read from this map by variant key.

**RowViewModel shape:**
```typescript
interface RowViewModel {
  links: Record<string, string | null>  // column key → resolved URL
  isStarred: boolean
  isGlobalStarred: boolean
  acmgClassification: string | null
  globalAcmgClassification: string | null
  hasComment: boolean
  hasGlobalComment: boolean
}
```

**Files:**
- New: `src/renderer/src/components/variant-table/useVariantRowViewModel.ts`
- Modified: `src/renderer/src/components/VariantTable.vue` — slots read from view model map instead of calling functions

**Scope:** 1 new composable, 1 modified component. Existing annotation composable and link store are read-only — no API change.

---

## Phase 2: Throughput & Stability

### 2.1 Streaming Imports in Worker (Finding #5)

**Problem:** `import-worker.ts` materializes entire files into arrays via `preParseFile()` before inserting. The "pre-parse next file while inserting current" pattern can hold two full files in memory simultaneously.

**Change:**
- For JSON formats: stream through the mapper pipeline inside the worker, inserting in bounded batches directly (batch size configurable, default 5000)
- For VCF: same approach — read lines, accumulate batch, insert, repeat
- Remove `preParseFile()` and `preParseVcfFile()` functions
- Process files sequentially with bounded memory proportional to batch size, not file size

**Files:**
- `src/main/workers/import-worker.ts`: rewrite insertion loop (~lines 90-200), remove/replace `preParseFile()`/`preParseVcfFile()` (~lines 570-680)

**Scope:** Significant rewrite of worker internals. Worker's external message API (messages to/from main thread) stays the same. Strategy classes (`ColumnarStrategy`, `ObjectStrategy`, `VcfStrategy`) are not changed — they handle the direct-import path; the worker handles the batch-import path independently.

**Note:** This is the largest single change in the spec. The worker is 818 lines; the affected sections are ~200 lines of insertion logic and ~110 lines of pre-parse functions.

### 2.2 Streaming Export (Finding #6)

**Problem:** `export-worker.ts` loads all rows with `.all()`, copies into `rows[]`, then passes `[headers, ...rows]` to `aoa_to_sheet()`. Memory spikes on large exports. No cancellation support.

**Change:**
- Use `.iterate()` (better-sqlite3 row iterator) to stream rows
- Add CSV export path: write rows directly to a write stream with no in-memory accumulation
- Keep XLSX for smaller exports via the existing `aoa_to_sheet` path (iterated, not `.all()`)

**Format selection contract:** The user chooses the format via the save dialog file extension (`.xlsx` or `.csv`). The renderer infers format from the chosen path and passes `format: 'xlsx' | 'csv'` in the export worker message. No automatic switching — the user decides. The save dialog defaults to `.xlsx` but offers `.csv` as a second filter option.

**Cancellation contract:** The current approach (main thread terminates the worker) is retained. The worker is short-lived and single-purpose; cooperative cancellation adds complexity without meaningful benefit since the worker holds no shared state that needs graceful cleanup. The main thread can call `worker.terminate()` and report cancellation to the user.

**Files:**
- `src/main/workers/export-worker.ts`: rewrite to use `.iterate()` for both formats; CSV path writes to a stream, XLSX path accumulates in memory (acceptable since user explicitly chose XLSX)
- `src/shared/types/export-worker.ts`: add `format: 'xlsx' | 'csv'` to start message type
- Export IPC handler / renderer: pass format derived from file extension
- Save dialog: add `.csv` as a second file filter option

**Scope:** Moderate — the worker is small (140 lines) and self-contained. Save dialog change is minimal.

### 2.3 Panel Interval Computation Off Main Thread (Finding #9)

**Problem:** `computePanelIntervals()` runs on the Electron main thread before dispatching queries to the DB pool. Panel-heavy filters can stall the UI thread.

**Change:**
- Move interval computation into the worker/pool task
- IPC handlers pass raw `active_panel_ids` + `panel_padding_bp` to the pool task
- Worker resolves intervals as part of the query workload
- Move `panelIntervalCache` to worker side

**Files:**
- `src/main/ipc/handlers/panelIntervalHelper.ts`: make callable from worker context
- `src/main/ipc/handlers/variants.ts`: stop pre-computing intervals, pass raw params to pool
- `src/main/ipc/handlers/cohort.ts`: same
- `src/main/database/DbPool.ts` or worker task handlers: import and call `computePanelIntervals`
- DB pool task type definitions (e.g., `shared/types/` or pool task union): extend task params to include `active_panel_ids` and `panel_padding_bp` so the worker can resolve intervals itself
- Worker dispatch logic: accept panel params and call `computePanelIntervals` before building the SQL query

**Prerequisite check:** Verify that the gene reference DB (`geneReferenceLoader.ts`) is accessible from the worker thread. If it opens a separate SQLite connection, it should work. If it relies on main-thread state, the loader needs to be initialized in the worker.

**Scope:** Moderate structural change across 5-6 files. No API change to IPC consumers (renderer still sends `active_panel_ids`).

---

## Phase 3: Structural Maintainability

### 3.1 Consolidate Filter/Query State (Finding #11)

**Problem:** Overlapping filter state and request-shaping logic across `useFilterState.ts` (case view) and `useFilters.ts` (cohort view), plus inline filter building in `CohortTable.vue` and `useCohortData.ts`.

**Change (approved scope):**
- Extract shared filter primitives into a thin shared layer limited to: generic state reset, active-filter derivation (count and list), and common numeric/preset logic (gnomAD AF, CADD, cohort frequency thresholds)
- `useFilterState.ts` and `useFilters.ts` remain as thin adapters for case vs cohort views
- Shared layer handles state management; adapters handle IPC serialization differences

**What stays in the adapters (not shared):** Tags, gene autocomplete, export, annotation scope, `searchQuery` vs `searchTerm` semantics, and view-specific filter shapes. These diverge materially between case and cohort views and should not be forced into a common interface.

**What this does NOT do:** Does not unify case and cohort into one filter system. They have legitimately different IPC parameter shapes.

**Files:**
- New: `src/renderer/src/composables/useFilterCore.ts` (shared primitives)
- Modified: `src/renderer/src/composables/useFilterState.ts` — delegates to shared layer
- Modified: `src/renderer/src/composables/useFilters.ts` — delegates to shared layer

**Scope:** Moderate refactoring. All existing consumers continue to work through their current composable APIs.

### 3.2 Split Query Builders (Finding #12)

**Problem:** Variant and cohort repositories use broad query construction serving count, page, and export needs together.

**Change (approved scope):**
- Split into dedicated query paths: `buildPageQuery()`, `buildCountQuery()`, `buildExportQuery()`
- Count queries: `SELECT COUNT(*)` only, no ORDER BY or column projection
- Page queries: ORDER BY + LIMIT/OFFSET, no aggregation
- Export queries: full column set, no LIMIT
- Run `EXPLAIN QUERY PLAN` on top 5 interactive queries after changes

**What this does NOT do:** No schema changes, no new indexes, no denormalization.

**Files:**
- `src/main/database/VariantRepository.ts`: split query construction
- `src/main/database/cohort.ts`: split query construction

**Scope:** Moderate refactoring within existing repository classes. Query output shapes unchanged.

### 3.3 Lazy-Load Non-Critical Dialogs (Audit Roadmap)

**Problem:** Dialogs and panels that rarely render are eagerly imported.

**Change:** Convert infrequently-shown components to `defineAsyncComponent()` with dynamic imports.

**Candidates:**
- Import progress dialog
- Settings/preferences panels
- Annotation dialogs (ACMG evidence, comment editor)
- Any other component in `App.vue` that is conditionally rendered

**Files:** `App.vue` and view-level files — convert static imports to `defineAsyncComponent()`.

**Scope:** Small, low-risk. No API changes.

### 3.4 Case-Switch Extra Query (Finding #7)

**Problem:** `useVariantData.ts` fires a separate `variants.query(... limit 1 ...)` to get the unfiltered count on case change, adding latency before the table can settle.

**Change:** Add an explicit `include_unfiltered_count: boolean` flag to the variant query request. When true, the backend runs a second `SELECT COUNT(*)` without filter conditions and returns `unfiltered_count` alongside `total_count` in the response. The frontend sets this flag on the first page load after a case change, and omits it on subsequent page/sort/filter requests.

This avoids the backend needing to infer "case changed" from a stateless call — the flag is deterministic.

**Files:**
- Variant query params type (`shared/types/`): add optional `include_unfiltered_count?: boolean`
- Backend variant query handler/repository: when flag is set, run unfiltered count query and include in response
- Variant query response type: add optional `unfiltered_count?: number`
- `src/renderer/src/components/variant-table/useVariantData.ts`: set flag on first load after case change, read `unfiltered_count` from response, remove separate query

**Scope:** Small, 3-4 files.

### 3.5 Annotation Stale-Request Guard (Finding #8)

**Problem:** `loadAnnotationsBatch()` filters out in-flight keys but doesn't invalidate results from a previous page during rapid paging.

**Change:** Add a generation counter to `useAnnotations.ts`. Increment on page change. Discard batch results if the generation has advanced since the request was made.

**Files:**
- `src/renderer/src/composables/useAnnotations.ts`: add `requestGeneration`, check on response

**Scope:** Small, 1 file.

### 3.6 Cohort Response Serialization (Finding #10)

**Problem:** Cohort IPC handler (`cohort.ts:83`) remaps every row into a new plain object for serialization, even though better-sqlite3 returns plain objects by default.

**Change:** Verify that returned objects are IPC-safe. If so, remove the per-row remap. If edge cases exist (BigInt columns), handle via SQL column aliases or a single post-query pass in the service.

**Files:**
- `src/main/ipc/handlers/cohort.ts`: remove or simplify the `result.data.map(...)` block

**Scope:** Small, 1 file. Verify before removing.

---

## Implementation Order

All on a single branch, sequential:

1. **Phase 1.1** — Cohort skipCount wiring (smallest, validates the pattern)
2. **Phase 1.2** — Import batch finalization
3. **Phase 1.3** — Keep-alive activation gating
4. **Phase 1.4** — VariantTable precomputed row state
5. **Phase 2.1** — Streaming imports in worker
6. **Phase 2.2** — Streaming export
7. **Phase 2.3** — Panel intervals off main thread
8. **Phase 3.1** — Consolidate filter/query state
9. **Phase 3.2** — Split query builders
10. **Phase 3.3** — Lazy-load dialogs
11. **Phase 3.4** — Case-switch extra query
12. **Phase 3.5** — Annotation stale-request guard
13. **Phase 3.6** — Cohort response serialization

## Testing Strategy

- Existing test suite must pass after each finding's implementation
- Import throughput: manually test with large files (10k+ variants) before and after Phase 1.2 and 2.1
- Cohort paging: manually verify no extra count queries fire on page/sort changes after Phase 1.1
- Keep-alive: verify via Vue DevTools that deactivated route stops IPC traffic after Phase 1.3
- Export: test CSV path with 10k+ rows after Phase 2.2

## Risks

- **Phase 2.1 (streaming imports):** Largest change. Worker internals rewrite. Mitigated by keeping the external message API stable and testing with all 3 import formats (JSON, columnar, VCF).
- **Phase 2.3 (panel intervals off main thread):** Depends on gene reference DB being accessible from workers. If it requires main-thread state, may need a worker-init step.
- **Phase 3.1 (filter consolidation):** Risk of subtle behavioral differences between case/cohort filters. Mitigated by keeping adapters and only extracting clearly shared logic.
