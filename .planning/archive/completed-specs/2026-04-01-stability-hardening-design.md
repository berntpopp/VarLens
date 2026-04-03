# VarLens Stability Hardening - Design Spec

**Date:** 2026-04-01 (revised after code review feedback)
**Based on:** [UNIFIED-CODE-REVIEW-2026-04-01.md](../code-review/UNIFIED-CODE-REVIEW-2026-04-01.md), [REFACTOR-ACTION-PLAN.md](../code-review/REFACTOR-ACTION-PLAN.md)
**Approach:** Three focused PRs, dependency-wave parallelization within each, atomic commits per task

---

## Goal

Fix all correctness bugs, security gaps, type safety erosion, and architectural debt identified by the cross-AI code review. Deliver as **three separate PRs** ordered by risk, each independently shippable.

## PR Strategy

The original single-PR approach mixed correctness fixes with large architectural refactors. Splitting into three PRs reduces blast radius and allows shipping critical fixes faster.

| PR | Scope | Branch | Tasks | Risk |
|----|-------|--------|-------|------|
| **PR 1** | Correctness & Security | `fix/correctness-security` | 1.1-1.6 | Low (targeted bug fixes) |
| **PR 2** | Coverage & Type Safety | `refactor/coverage-type-safety` | 2.0-2.6, 3.1-3.4 | Medium (test infra + type changes) |
| **PR 3** | Architecture & Performance | `refactor/architecture-perf` | 4.1-4.7, 3.5 | Higher (structural changes) |

Each PR:
- Gets its own feature branch off `main`
- Has one atomic commit per task
- Must pass `npm run lint && npm run typecheck && npm run test` before merge
- Merges to `main` before the next PR branches

---

## PR 1: Correctness & Security

### 1.1 Fix Genotype Dosage Derivation

**Bug:** `AssociationDataBuilder.ts:59` uses `CAST(COALESCE(gt_num, '0') AS INTEGER)`. VCF import stores GT strings like `0/1`, `1/1`. SQLite integer cast truncates `0/1` to `0`, breaking burden/contingency analysis.

**Fix:**
- Create `src/shared/sql/genotype-dosage.ts` with canonical `GT_DOSAGE_SQL` CASE expression
- Create `src/shared/utils/genotype.ts` with `gtToDosage()` TS utility encoding identical mapping
- Update `AssociationDataBuilder.ts` to use `GT_DOSAGE_SQL`
- Add cross-check test verifying TS utility matches SQL CASE for all standard GT values

**New files:** `src/shared/sql/genotype-dosage.ts`, `src/shared/utils/genotype.ts`
**Modified:** `src/main/database/AssociationDataBuilder.ts`
**Tests:** `tests/shared/sql/genotype-dosage.test.ts`, `tests/shared/utils/genotype.test.ts`

### 1.2 Canonicalize ACMG Classification Labels

**Bug:** IPC schema accepts `Likely Pathogenic` (title case) but cohort summary SQL compares `Likely pathogenic` (sentence case). Stored values mismatch summary queries.

**Blast radius audit** (13 files, 50+ occurrences -- audit and replace ALL ACMG wire-value literals across shared/main/renderer):

| File | Current Format | Lines |
|------|---------------|-------|
| `src/shared/types/ipc-schemas.ts` | Title case (`Likely Pathogenic`, `VUS`, `Likely Benign`) | 384 |
| `src/shared/sql/cohort-summary-rebuild.ts` | Sentence case (`Likely pathogenic`) | 63-84 |
| `src/main/database/types.ts` | Title case | 210-212 |
| `src/main/database/cohort.ts` | Title case | 419-425 |
| `src/main/database/migrations.ts` | Sentence case (in SQL triggers) | 715-1033 |
| `src/renderer/src/composables/useAnnotations.ts` | Title case | 783-806 |
| `src/renderer/src/utils/filters/constants.ts` | Title case | 13-27 |
| `src/renderer/src/utils/acmg/acmg-calculator.ts` | Title case | 123-138 |
| `src/renderer/src/config/filterGroups.ts` | Mixed (underscore values + title case labels) | 164-237 |
| `src/renderer/src/components/database-overview/OverviewStatsGrid.vue` | `VUS` in template | 85 |
| `src/renderer/src/components/protein/ProteinStructure3DPanel.vue` | `VUS` in legend | 32 |
| `src/renderer/src/components/protein/LollipopLegend.vue` | `VUS` in label map | 289 |
| `src/renderer/src/components/protein/GeneStructurePanel.vue` | `VUS` in label map | 214 |

**Fix:**
1. Define canonical labels + colors + abbreviations in `src/shared/config/domain.config.ts` following ClinVar standard (sentence case: `Likely pathogenic`, `Uncertain significance`, `Likely benign`)
2. Create `src/shared/utils/acmg.ts` with `normalizeAcmgClassification()` mapping all known variants to canonical forms
3. Add database migration to normalize stored rows + replace AFTER triggers with canonical labels + recompute `acmg_best`
4. Update all 13 files above to import from the shared canonical constant -- no hardcoded ACMG string literals anywhere
5. For display-only contexts (`VUS` as UI label, not wire value): keep `VUS` as the display abbreviation but derive it from the canonical `Uncertain significance` via the shared abbreviation map

**New files:** `src/shared/utils/acmg.ts`
**Modified:** All 13 files listed above
**Tests:** `tests/shared/utils/acmg.test.ts`, migration test, round-trip test (calculator -> normalize -> store -> query -> display)

### 1.3 Fix Cohort Boolean Search Parser

**Bug:** `cohort.ts:321-341` `buildBooleanSearchCondition()` appends `AND NOT` for every NOT token. `A OR NOT B` produces invalid SQL.

**Fix:**
- Create shared tokenizer + AST builder in `src/shared/utils/boolean-search.ts` with correct precedence (NOT > AND > OR), parenthesis support, and validation
- Create `src/main/database/search/cohort-search-emitter.ts` (LIKE-based SQL)
- Create `src/main/database/search/fts5-search-emitter.ts` (FTS5 MATCH)
- Replace `buildBooleanSearchCondition()` in `cohort.ts` with shared parser + cohort emitter
- Refactor `VariantRepository.ts` search to use shared parser + FTS5 emitter (preserve ranking)

**New files:** `src/shared/utils/boolean-search.ts`, `src/main/database/search/cohort-search-emitter.ts`, `src/main/database/search/fts5-search-emitter.ts`
**Modified:** `src/main/database/cohort.ts`, `src/main/database/VariantRepository.ts`
**Tests:** Parser AST tests, cohort emitter tests, FTS5 emitter tests, integration tests

### 1.4 Fix `setWindowOpenHandler` URL Validation

**Bug:** `src/main/index.ts:76-79` passes `details.url` directly to `shell.openExternal()` with no protocol/domain check.

**Fix:**
- Move `ALLOWED_DOMAINS` to `src/shared/config/allowed-domains.ts` (neutral config, no IPC dependency)
- Create `src/main/utils/url-validation.ts` with `isUrlSafeForExternal()`, `isDomainAllowed()`, `setUserDomains()`, and `isValidHostname()`
- Update `index.ts` setWindowOpenHandler to use `isUrlSafeForExternal()`
- Update `shell.ts` to import from shared utility instead of local definitions

**New files:** `src/shared/config/allowed-domains.ts`, `src/main/utils/url-validation.ts`
**Modified:** `src/main/index.ts`, `src/main/ipc/handlers/shell.ts`
**Tests:** `tests/main/utils/url-validation.test.ts`

### 1.5 Scope Annotation Cache by Case/Database

**Bug:** `useAnnotations.ts` cache key is `chr:pos:ref:alt` without case/database scope. Same variant in different cases shows wrong star/comment/ACMG state.

**Fix:**
- Create `makeCacheKey(dbPath, caseId, variantKey)` returning `${dbPath}::${caseId}::${variantKey}`
- Scope `loadingStates` Map with same composite key
- Clear both caches on database switch (watch `dbStore.currentPath`)
- Clear on case switch
- Fix batch-result caching to re-key with composite scope, with async race guard

**Modified:** `src/renderer/src/composables/useAnnotations.ts`
**Tests:** Same variant different annotations in two cases, DB switch clears stale cache, fast case switch discards stale batch

### 1.6 Remaining Security Fixes

Three targeted fixes:

1. **`auth:listUsers` admin check:** Add `currentUser.role === 'admin'` gate in `src/main/ipc/handlers/auth.ts`
2. **`createFirstUser` transaction:** Wrap 3 INSERTs in `db.transaction()` in `src/main/services/auth/AuthService.ts`
3. **Targeted dependency remediation:** Update only `@xmldom/xmldom` (high-severity XML injection) and `elliptic` (via `pdbe-molstar` transitive). Pin exact versions. Manually review `package-lock.json` diff to ensure no unrelated dependency churn. Do NOT run blanket `npm audit fix`.

**Modified:** `src/main/ipc/handlers/auth.ts`, `src/main/services/auth/AuthService.ts`, `package.json`, `package-lock.json`
**Tests:** Auth handler test for unauthorized listUsers, transaction rollback test

### PR 1 Parallelism

All 6 tasks are independent and can execute in parallel. After all complete, run regression tests as a verification step:
- GT dosage with real VCF strings (`0/1` -> 1, `1/1` -> 2, `./.` -> null)
- ACMG normalization round-trip
- Boolean search `A OR NOT B` produces valid SQL
- Annotation cache isolation across cases
- `auth:listUsers` unauthorized rejection

---

## PR 2: Coverage & Type Safety

PR 2 branches from `main` after PR 1 merges.

### 2.0 Stabilize Coverage Pipeline

**Problem:** Two reviewers reported `ENOENT` in `coverage/.tmp/` when running coverage in isolated workspaces. The spec previously jumped to thresholds without ensuring coverage generation is stable.

**Fix:**
- Reproduce the `ENOENT` issue: run `npm run test:coverage` in a clean checkout
- If it reproduces: investigate v8 coverage provider temp directory handling, likely a race condition with parallel test files writing to the same `.tmp/` dir. Fix by configuring coverage temp directory or serializing coverage collection.
- If it doesn't reproduce locally: add a CI-specific verification step that runs `npm run test:coverage` and asserts the coverage JSON output exists
- Verify `npm run test:coverage` exits 0 consistently before any threshold changes

**Modified:** `vitest.config.ts` (if temp dir fix needed), possibly `package.json` scripts

### 2.1 Set Realistic Coverage Thresholds

**Depends on:** 2.0 (pipeline must be stable first)

**Fix:**
- Run `npm run test:coverage` and record actual per-directory coverage
- Replace global 70% threshold with per-directory thresholds based on actuals:
  - Well-covered areas: hold at current levels
  - Low-coverage areas: set floor at current levels
- Enable `autoUpdate` ratcheting to prevent regression

**Modified:** `vitest.config.ts`

### 2.2 Wire Coverage Into CI

**Depends on:** 2.0, 2.1 (thresholds must be realistic and pipeline stable)

**Fix:**
- Change `npm run test` to `npm run test:coverage` in `.github/workflows/build.yml` (at minimum ubuntu runner)
- Add `json-summary` to coverage reporters
- Add `davelosert/vitest-coverage-report-action@v2` for PR coverage comments
- Add lint + typecheck to release workflow for parity with build workflow

**Modified:** `.github/workflows/build.yml`, `.github/workflows/release.yml`, `vitest.config.ts`

### 2.3 Convert IPC Handler Tests

**Fix:**
- Adopt `auth-handlers.test.ts` pattern (mock `ipcMain.handle`, register handlers with DI, invoke through registered handler)
- Priority order: variants (265 lines), database (348), cases (247), cohort (338), annotations (434), import (162)

**New files:** 6 new/rewritten test files in `tests/main/handlers/`

### 2.4 Extract Worker Business Logic

**Fix:**
- Extract pure logic from each worker into importable modules:
  - `import-worker.ts` -> `import-logic.ts` (parsing + batch insert)
  - `delete-worker` -> `delete-logic.ts`
  - `export-worker` -> `export-logic.ts`
- Worker entry files become thin messaging shells
- Test logic modules with in-memory SQLite

**New files:** `src/main/workers/import-logic.ts`, `delete-logic.ts`, `export-logic.ts`
**Modified:** `src/main/workers/import-worker.ts`, `delete-worker.ts`, `export-worker.ts`
**Tests:** Logic module tests with in-memory DB

### 2.5 Extract `safeEmit` to Shared Utility

**Problem:** Identical `safeEmit` function copied in 4 IPC handler files.

**Fix:**
- Create `src/main/ipc/utils/safeEmit.ts`
- Replace copies in `cases.ts`, `cohort.ts`, `import.ts`, `batch-import.ts`

**New files:** `src/main/ipc/utils/safeEmit.ts`
**Modified:** `src/main/ipc/handlers/cases.ts`, `cohort.ts`, `import.ts`, `batch-import.ts`

### 2.6 Re-Export Shared Types (Remove Renderer -> Main Imports)

**Problem:** 20+ renderer files import types directly from `src/main/`.

**Fix:**
- Identify all cross-boundary type imports (AcmgClassification, VepTranscriptConsequence, VcfPreviewResult, Tag, GeneList, etc.)
- Re-export through appropriate `src/shared/types/` modules
- Update all renderer imports to use `src/shared/types/`

**Modified:** `src/shared/types/` modules, ~20 renderer files

### 2.7 Fix WindowAPI `as any` Casts

**Depends on:** 2.6 (shared types must be re-exported first)

**Fix:**
- **Bucket A (zero risk):** Remove casts where methods already exist in WindowAPI (~15 instances in `useCohortData.ts` and similar)
- **Bucket B:** Add missing methods to WindowAPI sub-interfaces (`runAssociation`, `cancelAssociation`, `onAssociationProgress`, `geneBurden`, `listCohorts`), then remove casts
- Audit: diff `src/preload/index.ts` against `src/shared/types/api.ts`

**Modified:** `src/shared/types/api.ts`, ~19 renderer files

### 2.8 Consolidate FilterState Types

**Fix:**
- Define one canonical type in `src/shared/types/filters.ts` with `FilterStateBase`, `CaseFilterState`, `CohortFilterState`
- Preserve existing wire semantics (`annotationScope: 'case' | 'all'`)
- Delete `src/renderer/src/composables/filter-types.ts`
- Update `useFilters.ts` to import from shared
- Resolve existing TODO at `filters.ts:14`

**Modified:** `src/shared/types/filters.ts`, `src/renderer/src/composables/useFilters.ts`
**Deleted:** `src/renderer/src/composables/filter-types.ts`

### PR 2 Parallelism

```
Wave A (independent):
  2.0 (coverage stability)
  2.3 (IPC handler tests)
  2.4 (worker logic extraction)
  2.5 (safeEmit)
  2.6 (shared type re-exports)
  2.8 (FilterState consolidation)

Wave B (after Wave A):
  2.1 <- 2.0
  2.7 <- 2.6

Wave C (after Wave B):
  2.2 <- 2.0, 2.1
```

---

## PR 3: Architecture & Performance

PR 3 branches from `main` after PR 2 merges.

### 3.1 Refactor GeneBurdenView.vue

**Depends on:** 2.7 from PR 2 (WindowAPI must have association methods typed)

**Fix:**
- Create `src/renderer/src/composables/useAssociation.ts` encapsulating association API calls
- Rewrite `GeneBurdenView.vue` to use `useApiService()` + `useAssociation()`
- Remove all `(window as any).api` calls and `eslint-disable` comments

**New files:** `src/renderer/src/composables/useAssociation.ts`
**Modified:** `src/renderer/src/components/association/GeneBurdenView.vue`

### 3.2 Audit Empty `catch {}` Blocks -- Workers & Main Process

**Scope:** Workers (15 catches in `import-worker.ts`) + main process files only. Renderer catches deferred to 3.3.

**Fix:** Categorize each catch:
- Worker threads (no mainLogger): `console.warn('context: ' + error)`
- Main process: `mainLogger.warn(msg, 'source')`
- Genuine best-effort (cleanup on exit): add comment explaining intentional silence

**Modified:** `src/main/workers/import-worker.ts`, other worker files, main process files with empty catches

### 3.3 Audit Empty `catch {}` Blocks -- Renderer

**Scope:** Renderer components and composables only (~90 catches).

**Fix:** Categorize each catch:
- Renderer components: `logService.warn()` or show snackbar where user-visible
- Genuine best-effort: add comment

**Modified:** ~50 renderer files

### 3.4 Decompose useFilterState (701 lines)

**Depends on:** 2.8 from PR 2 (FilterState types consolidated)

**Fix:** Split into focused composables using facade pattern:
- `useFilterState.ts` -> thin facade (~80 lines)
- `useFilterCriteria.ts` -> filter field state + defaults + clearing
- `useFilterPresets.ts` -> preset save/load/sync/divergence
- `useFilterGene.ts` -> gene symbol autocomplete
- `useFilterOptions.ts` -> filter option loading + LRU cache (using local `LruMap` utility)
- `useFilterLifecycle.ts` -> case-switch reset, initial search setup

Replace `JSON.stringify` deep watchers with granular getter-array watchers.

### 3.5 Create Local `LruMap<K,V>` Utility

**Decision:** Use a local utility, not the `lru-cache` npm package. The existing inline patterns are simple (Map insertion order + size check). Adding a runtime dependency for this is not justified in a hardening pass.

**Fix:**
- Create `src/shared/utils/lru-map.ts` extracting the existing Map-based pattern into a typed class
- Replace inline LRU patterns in `useAnnotations`, `useFilterState`, `useCaseMetadata`

**New files:** `src/shared/utils/lru-map.ts`
**Modified:** 3+ composable files
**Tests:** `tests/shared/utils/lru-map.test.ts`

### 3.6 Make Router Single Source of Truth

**Fix:**
- Make URL the authoritative state for active tab, selected case, selected variant
- Use route guards for side effects instead of watchers
- Remove navigation-related refs from `useAppState`

**Modified:** `src/renderer/src/router/`, `useAppState`, `App.vue`

### 3.7 Decompose VariantRepository.ts (1094 lines)

**Fix:** Split into focused modules:
- `VariantRepository.ts` -> query + CRUD (~400 lines)
- `VariantFilterBuilder.ts` -> filter WHERE clause construction
- `VariantSearchService.ts` -> FTS5 search + boolean parsing
- `VariantFrequencyService.ts` -> internal_af computation
- `VariantFilterOptionsService.ts` -> filter option retrieval

### 3.8 Split import-worker.ts

**Depends on:** 2.4 from PR 2 (logic extraction)

**Fix:** Ensure extracted modules from 2.4 are well-named and the worker entry file is a clean messaging shell.

### 3.9 Streaming VCF Insert

**Depends on:** 3.8 (split worker)

**Fix:** Implement async generator pattern for constant-memory VCF import:
```typescript
async function* parseVcfStream(filePath, header): AsyncGenerator<ParsedVariant[]> {
  // Yield batches of BATCH_INSERT_SIZE variants
}
for await (const batch of parseVcfStream(filePath, header)) {
  insertBatch(db, batch)
  reportProgress(inserted += batch.length)
}
```

### PR 3 Parallelism

```
Wave A (independent):
  3.1 (GeneBurdenView)
  3.2 (empty catches -- workers/main)
  3.3 (empty catches -- renderer)
  3.5 (LruMap utility)
  3.6 (router)
  3.7 (decompose VariantRepository)

Wave B (after Wave A):
  3.4 <- 3.5 (LruMap)
  3.8 (split import-worker -- depends on PR 2's 2.4)

Wave C (after Wave B):
  3.9 <- 3.8
```

---

## Cross-PR Dependency Graph

```
PR 1 (Correctness & Security):
  1.1, 1.2, 1.3, 1.4, 1.5, 1.6 -- all parallel
  + verification regression tests after all complete

PR 2 (Coverage & Type Safety) -- after PR 1 merges:
  Wave A: 2.0, 2.3, 2.4, 2.5, 2.6, 2.8 -- all parallel
  Wave B: 2.1 <- 2.0; 2.7 <- 2.6
  Wave C: 2.2 <- 2.0, 2.1

PR 3 (Architecture & Perf) -- after PR 2 merges:
  Wave A: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7 -- all parallel
  Wave B: 3.4 <- 3.5; 3.8 <- PR2:2.4
  Wave C: 3.9 <- 3.8
```

## Scope Boundaries

- No new features
- No UI/UX changes (GeneBurdenView refactor is internal only)
- ACMG migration is additive (normalizes existing data + replaces triggers) -- no schema shape changes, but increments the migration version counter
- No changes to build/packaging config (only CI workflow files)
- No changes to Electron main window creation or app lifecycle
- No new runtime dependencies (LRU is local utility)
- Dependency updates are targeted (explicit packages only, manual lockfile review)

## Verification

Per-PR verification before merge:
1. `npm run lint` passes
2. `npm run typecheck` passes
3. `npm run test` passes (PR 1), `npm run test:coverage` passes (PR 2+)
4. All commits are atomic and individually revertable

Post-PR 2 verification:
5. Coverage numbers higher than pre-hardening baseline
6. Coverage thresholds enforced in CI
