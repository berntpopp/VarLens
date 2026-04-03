# PR 2: Coverage & Type Safety — Design Spec

> **Parent spec:** [stability-hardening-design.md](2026-04-01-stability-hardening-design.md)
> **Predecessor:** PR 1 (correctness & security) — merged as v0.49.0
> **Branch:** `refactor/coverage-type-safety` off `main`
> **Merge strategy:** Single PR, one atomic commit per task

## Goal

Stabilize the test coverage pipeline, enforce coverage thresholds in CI, convert IPC handler tests to the DI pattern, extract testable logic from workers, and eliminate cross-boundary type imports and `as any` casts.

## Scope

9 tasks (2.0–2.8) from the parent spec. All tasks are independently shippable within the PR. No behavioral changes to the application — this is purely test infrastructure, type safety, and code organization.

## Not in Scope

- Architectural refactors (PR 3)
- New features or UI changes
- Performance optimizations
- `useFilterState` decomposition (PR 3, depends on 2.8)

---

## Task Descriptions

### 2.0 Stabilize Coverage Pipeline

**Problem:** `ENOENT` in `coverage/.tmp/` reported when running coverage in isolated workspaces.

**Approach:**
1. Reproduce: run `npm run test:coverage` in a clean checkout
2. If reproduces: investigate v8 provider temp directory handling (likely parallel test file race condition). Fix by configuring `coverage.reportsDirectory` or temp dir in `vitest.config.ts`
3. If doesn't reproduce locally: add CI verification step asserting coverage JSON output exists
4. Verify `npm run test:coverage` exits 0 consistently (run 3x)

**Files modified:** `vitest.config.ts` (if temp dir fix needed), possibly `package.json` scripts

**Verification:** `npm run test:coverage` exits 0 three consecutive times

---

### 2.1 Set Realistic Coverage Thresholds

**Depends on:** 2.0

**Approach:**
1. Run `npm run test:coverage` and record actual per-directory coverage
2. Replace global 70% threshold with per-directory thresholds based on actuals:
   - Well-covered areas: hold at current level (or slightly above)
   - Low-coverage areas: set floor at current level (no regression)
3. Enable `autoUpdate` ratcheting so thresholds increase automatically as coverage improves

**Files modified:** `vitest.config.ts`

**Verification:** `npm run test:coverage` passes with new thresholds

---

### 2.2 Wire Coverage Into CI

**Depends on:** 2.0, 2.1

**Approach:**
1. In `.github/workflows/build.yml`: change test step to `npm run test:coverage` (at minimum ubuntu runner; optionally all platforms)
2. Add `json-summary` to coverage reporters in `vitest.config.ts`
3. Add `davelosert/vitest-coverage-report-action@v2` step for PR coverage comments
4. Add lint + typecheck steps to `.github/workflows/release.yml` for parity with build workflow

**Files modified:** `.github/workflows/build.yml`, `.github/workflows/release.yml`, `vitest.config.ts`

**Verification:** Push to a test branch, verify CI runs coverage and posts PR comment

---

### 2.3 Convert IPC Handler Tests

**Approach:**
Rewrite existing handler test files using the `auth-handlers.test.ts` DI pattern:
- Mock `ipcMain.handle` to capture handler registrations
- Create real dependencies via DI (real DB, real services)
- Invoke handlers through the captured registration
- Assert on return values and side effects

**Existing files to convert (actual filenames from repo):**
1. `tests/main/handlers/variants-handlers.test.ts` — currently minimal stubs
2. `tests/main/handlers/cases-handlers.test.ts` — currently minimal stubs
3. `tests/main/handlers/cohort-handlers.test.ts` — currently minimal stubs
4. `tests/main/handlers/annotations-handlers.test.ts` — currently minimal stubs
5. `tests/main/handlers/export-handlers.test.ts` — currently minimal stubs

**Already converted:** `tests/main/handlers/auth-handlers.test.ts` (reference pattern)

**Not in scope:** `case-metadata-handlers.test.ts`, `tags-handlers.test.ts`, `updater-handlers.test.ts`, `cohort-serialization.test.ts`, `panel-interval-offload.test.ts` (these are already adequate or orthogonal)

**Note:** There is no `database-handlers.test.ts` or `import-handlers.test.ts` in the repo. Database operations are tested through other handler files. Import handlers test coverage comes from task 2.4 (worker logic extraction).

**Verification:** All converted tests pass with real DB operations, total test count increases

---

### 2.4 Extract Worker Business Logic

**Complexity note:** The workers are tightly coupled to messaging, I/O, DB lifecycle, progress throttling, and cancellation. This is not a simple "move functions out" refactor — the extraction boundary must be chosen carefully.

**Approach:**
Extract the core data-processing logic from each worker into testable modules, while leaving worker-thread concerns (messaging, cancellation, progress reporting, DB open/close) in the worker entry files.

| Worker (lines) | Logic module | What moves out | What stays in worker |
|---|---|---|---|
| `import-worker.ts` (840) | `import-pipeline.ts` | Format detection, per-file parsing orchestration, batch insert SQL | DB open/close, FTS/index drop/restore, cancellation checks, progress postMessage, file iteration |
| `delete-worker.ts` (163) | `delete-operations.ts` | Batch deletion SQL, case-specific cleanup | DB open/close, FTS teardown/restore, summary rebuild, error recovery |
| `export-worker.ts` (225) | `export-renderer.ts` | Row formatting (CSV escaping, XLSX cell formatting), metadata sheet construction | DB open/close, file streaming with backpressure, progress postMessage |

**Design constraints:**
- Logic modules accept a DB connection (already opened) and a progress callback `(phase: string, current: number, total: number) => void`
- Logic modules do NOT import `parentPort`, `workerData`, or `worker_threads`
- Logic modules do NOT manage DB lifecycle (open/close/pragma) — that stays in the worker shell
- Cancellation remains in the worker shell (checked between logical steps, throws to abort)
- FTS/index/summary management stays in the worker shell (it's lifecycle, not logic)

**Files created:** `src/main/workers/import-pipeline.ts`, `delete-operations.ts`, `export-renderer.ts`
**Files modified:** `src/main/workers/import-worker.ts`, `delete-worker.ts`, `export-worker.ts`
**Tests:** Logic module tests with in-memory SQLite, mock progress callback

**Verification:** All existing tests pass, new logic module tests pass, workers behave identically

---

### 2.5 Extract `safeEmit` to Shared Utility

**Problem:** Identical `safeEmit` function copied in 4 IPC handler files.

**Approach:**
1. Create `src/main/ipc/utils/safeEmit.ts` with the shared implementation
2. Replace local copies in `cases.ts`, `cohort.ts`, `import.ts`, `batch-import.ts`

**Files created:** `src/main/ipc/utils/safeEmit.ts`
**Files modified:** `src/main/ipc/handlers/cases.ts`, `cohort.ts`, `import.ts`, `batch-import.ts`

**Verification:** All existing tests pass, grep confirms no remaining local `safeEmit` definitions

---

### 2.6 Move Canonical Type Ownership to Shared

**Problem:** ~8 renderer files import types directly from `src/main/database/types`. Additionally, `src/shared/types/api.ts` itself imports ~40 types from `src/main/` — so the shared layer already depends on main. Simply re-exporting through shared would not fix the layering violation; it would just add another hop.

**Approach:**
1. **Move canonical type definitions** from `src/main/database/types.ts` to `src/shared/types/database.ts` (new file). These are pure TypeScript interfaces/types with no runtime dependencies on main-process code.
2. **Update `src/main/database/types.ts`** to re-export from shared (preserving backward compatibility for main-process consumers)
3. **Update `src/shared/types/api.ts`** to import from `src/shared/types/database.ts` instead of `src/main/database/types`
4. **Update ~8 renderer files** to import from `src/shared/types/database` or `src/shared/types/api`
5. **Move import-related types** (`ProgressUpdate`, `ImportResult`, `VcfPreviewResult`) to `src/shared/types/import.ts`
6. **Move gene reference types** (`GeneValidationResult`, etc.) to `src/shared/types/gene-reference.ts`

**Boundary rule after this task:** `src/shared/` never imports from `src/main/`. `src/main/` re-exports from `src/shared/` for backward compat. `src/renderer/` imports only from `src/shared/`.

**Files created:** `src/shared/types/database.ts`, `src/shared/types/import.ts`, `src/shared/types/gene-reference.ts`
**Files modified:** `src/main/database/types.ts`, `src/shared/types/api.ts`, ~8 renderer files
**Verification:** `npm run typecheck` passes, grep confirms no `from '.*main/` imports in `src/renderer/` or `src/shared/`

---

### 2.7 Fix WindowAPI `as any` Casts

**Depends on:** 2.6

**Approach:**
1. **Bucket A (zero risk):** Remove `as any` casts where methods already exist in the WindowAPI interface (~15 instances)
2. **Bucket B:** Audit `src/preload/index.ts` against `src/shared/types/api.ts` — add missing methods to WindowAPI sub-interfaces, then remove casts
3. Target: eliminate all ~34 `as any` occurrences in renderer `.ts` and `.vue` files (excluding legitimate uses like JSON parsing or test mocks)

**Files modified:** `src/shared/types/api.ts`, ~19 renderer files

**Verification:** `npm run typecheck` passes, `as any` count in renderer reduced to near zero

---

### 2.8 Consolidate FilterState Types

**Problem:** Filter types are split across two files with different fields:
- `src/shared/types/filters.ts` — `VariantFilter` (IPC wire format, lines 32-67) — lacks `tagIds`, `annotationScope`
- `src/renderer/src/composables/filter-types.ts` — `FilterState` (renderer state, lines 7-25) — has `tagIds: number[]`, `annotationScope: 'case' | 'all'`, plus `ActiveFilter`, `UseFilterStateOptions`, `ExportResult`, `UseFilterStateReturn`

The renderer `FilterState` is the primary type used by `useFilterState.ts` (lines 27-42, 86-105). Simply deleting `filter-types.ts` would break the case-filter composable.

**Approach:**
1. **Merge fields into `src/shared/types/filters.ts`:**
   - Add `tagIds: number[]` to the shared filter type
   - Add `annotationScope: 'case' | 'all'` to the shared filter type
   - Define `FilterStateBase` with all common fields
   - Define `CaseFilterState extends FilterStateBase` — includes case-specific fields
   - Define `CohortFilterState extends FilterStateBase` — cohort-specific fields
2. **Move helper types** from `filter-types.ts` to shared:
   - `ActiveFilter` — used by filter toolbar UI
   - `UseFilterStateOptions`, `UseFilterStateReturn` — composable contract types
   - `ExportResult` — export dialog return type
3. **Move `buildFilterFromState`** helper to `src/shared/utils/filters.ts` (or keep in the composable if it has renderer dependencies)
4. **Update consumers:**
   - `src/renderer/src/composables/useFilterState.ts` — import from shared
   - `src/renderer/src/composables/useFilters.ts` — import from shared
   - Any other files importing from `filter-types.ts`
5. **Delete** `src/renderer/src/composables/filter-types.ts`
6. **Resolve TODO** at `filters.ts:14`

**Files modified:** `src/shared/types/filters.ts`, `src/renderer/src/composables/useFilterState.ts`, `src/renderer/src/composables/useFilters.ts`
**Files deleted:** `src/renderer/src/composables/filter-types.ts`

**Verification:** `npm run typecheck` passes, deleted file is gone, `useFilterState` still works with `tagIds` and `annotationScope`

---

## Execution Waves

```
Wave A (independent — can run in parallel):
  2.0  Coverage stability
  2.3  IPC handler tests (6 files)
  2.4  Worker logic extraction
  2.5  safeEmit utility
  2.6  Shared type re-exports
  2.8  FilterState consolidation

Wave B (after Wave A dependencies resolve):
  2.1  Coverage thresholds       ← depends on 2.0
  2.7  Fix as-any casts          ← depends on 2.6

Wave C (after Wave B):
  2.2  Wire coverage into CI     ← depends on 2.0, 2.1
```

## Success Criteria

1. `npm run lint` passes
2. `npm run typecheck` passes
3. `npm run test:coverage` passes with per-directory thresholds
4. CI runs coverage and posts PR coverage comment
5. Zero renderer → main imports AND zero shared → main imports (type boundary enforced)
6. `as any` count in renderer reduced to near zero
7. All IPC handlers have DI-pattern tests
8. Worker logic is testable without worker threads
9. No duplicate `safeEmit` implementations
10. FilterState types consolidated in shared module
