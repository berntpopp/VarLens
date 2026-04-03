# VarLens Type Safety, Filter Decomposition & Coverage — Design Spec

**Date:** 2026-04-01 (revised after review feedback)
**Branch:** `refactor/type-safety-coverage` (off `main` after v0.51.0)
**Based on:** [UPDATED-CODE-REVIEW-2026-04-01.md](../code-review/UPDATED-CODE-REVIEW-2026-04-01.md)
**Goal:** Raise Architecture from 6.5 to 8.0+, Coverage/CI from 5.5 to 8.0+, and Code Quality from 7.0 to 8.2+ by eliminating type boundary violations, centralizing preload access, decomposing the largest remaining composable, and making coverage enforcement honest and operational.

---

## Scope

One PR with 4 logical phases:

1. **Type boundary cleanup** — centralize all preload access behind `useApiService()`, define real shared DTOs, redirect all renderer→main imports, add ESLint guards
2. **useFilterState full decomposition** — extract 4 focused composables, reduce facade to ~150 lines
3. **Tests for everything touched** — new composable tests, preload contract tests, coverage improvement
4. **Coverage infrastructure** — per-directory thresholds calibrated from post-test actuals, CI enforcement, PR comments, release parity

No user-visible behavior changes. The `UseFilterStateReturn` public API is unchanged.

### Key design decisions (from review feedback)

- **Shared layer holds only domain/IPC DTOs.** Vue-specific composable return types (`UseFilterStateReturn`, `UseFilterStateOptions`, `ExportResult`) stay renderer-local. Only `FilterState`, `ActiveFilter`, and `buildFilterFromState()` move to shared (they are pure domain types with no Vue deps).
- **Real DTOs in shared, not re-exports from main.** Types like `Tag`, `Variant`, `Case` are defined as standalone interfaces in `src/shared/types/`, not re-exported from `src/main/database/types`. Main adapts to shared, not the other way around.
- **Goal is "centralize preload access" not just "remove casts."** All `window.api` access — both `(api as any)` casts AND direct `window.api.` calls — must go through `useApiService()`. This covers 16 cast sites + 14 direct `window.api` usage sites across 15 files.
- **Null guards preserved, not replaced with `!`.** Each call site is reviewed individually. If an existing null guard exists (`if (!api) return`), use `api.method()` after the guard. If no guard exists, add one. No non-null assertions.
- **Tests before thresholds.** Phase 3 writes all new tests. Phase 4 calibrates coverage thresholds from the post-test measured actuals, then wires CI. No churn from premature thresholds.

---

## Phase 1: Type Boundary Cleanup

### 1.1 Add Missing WindowAPI Type

**ShellAPI** — add `showItemInFolder` (exists in preload, missing from type):

```typescript
export interface ShellAPI {
  openExternal: (url: string) => Promise<void>
  showItemInFolder: (filePath: string) => Promise<void>
}
```

`RegionFilesAPI` is already present in WindowAPI (verified in current tree).

**Files:** `src/shared/types/api.ts`

### 1.2 Define Real Shared DTOs

Instead of re-exporting from `src/main/database/types`, define canonical DTO interfaces in `src/shared/types/`:

**`src/shared/types/database-entities.ts`** (new file):
```typescript
/** Canonical DTOs for database entities used across process boundaries. */

export interface Tag {
  id: number
  name: string
  color: string | null
}

export interface VariantAnnotation {
  global_comment: string | null
  is_starred: boolean
}

export interface CaseVariantAnnotation {
  comment: string | null
  acmg_classification: string | null
  acmg_evidence: string | null
}

export interface AuditLogEntry {
  id: number
  action: AuditActionType
  timestamp: number
  details: string | null
}

export type AuditActionType = 'import' | 'delete' | 'export' | 'update' | 'create'
```

`Variant` and `Case` are already defined in `src/shared/types/api.ts` (as part of the IPC contract). Renderer files importing them from `main/database/types` will be redirected to the shared path.

**`src/shared/types/vcf.ts`** (new file):
```typescript
/** VCF preview result DTO for renderer consumption. */
export interface VcfPreviewResult {
  samples: string[]
  variantCount: number
  headerLines: string[]
  firstVariants: Array<Record<string, string>>
}
```

**Main-side adaptation:** `src/main/database/types.ts` imports from shared and extends/re-exports as needed for internal use. The dependency direction is: **shared defines → main implements/extends → renderer consumes shared**.

### 1.3 Centralize All Preload Access Behind useApiService()

Two categories of violations to fix:

**Category A: `(api as any)` / `(window as any)` casts (16 occurrences, 9 files)**

| File | Casts | Fix |
|------|-------|-----|
| `useCohortData.ts` | 4 | Use `useApiService()`, add null guards where missing |
| `CohortTable.vue` | 3 | Use `useApiService()`, types now complete |
| `CohortFilterBar.vue` | 2 | Use `useApiService()` |
| `RegionFileImportDialog.vue` | 2 | Use `useApiService()` |
| `FilterToolbar.vue` | 1 | Use `useApiService()`, `showItemInFolder` now typed |
| `GeneBurdenTable.vue` | 1 | Use `useApiService()` |
| `useVariantData.ts` | 1 | Use `useApiService()` |
| `useFilterExport.ts` | 1 | Use `useApiService()` |
| `useCarriers.ts` | 1 | Use `useApiService()` |

**Category B: Direct `window.api.` calls bypassing useApiService() (14 occurrences, 6 files)**

| File | Calls | Fix |
|------|-------|-----|
| `databaseStore.ts` | 7 | Inject `useApiService()` or accept api as parameter |
| `DatabasePicker.vue` | 3 | Use `useApiService()` |
| `LogService.ts` | 1 | Special case: bootstrap — document as approved exception |
| `externalLinksStore.ts` | 1 | Use `useApiService()` |
| `useAnalysisGroups.ts` | 1 | Use `useApiService()` |
| `filterSerialization.ts` | 1 | Use `useApiService()` |

For each site: review the null guard context. If there's an existing `if (!api) return` or `typeof window.api === 'undefined'` check, replace with `useApiService()` + null guard. If no guard exists, add one. **No non-null assertions.**

`LogService.ts` is a special case — it bootstraps before Vue is available. Document as an approved exception with an `// eslint-disable-next-line` and comment explaining why.

### 1.4 Redirect Renderer→Main Type Imports

Update ~22 renderer files to import from `src/shared/types/` instead of `src/main/`:

**Already re-exported (just update import paths):**
- `AcmgClassification` → `src/shared/config/domain.config.ts`
- `VepTranscriptConsequence`, `VepColocatedVariant` → `src/shared/types/api-enrichment.ts`

**New shared DTOs (from 1.2):**
- `Tag`, `VariantAnnotation`, `CaseVariantAnnotation`, `AuditLogEntry`, `AuditActionType` → `src/shared/types/database-entities.ts`
- `VcfPreviewResult` → `src/shared/types/vcf.ts`
- `Variant`, `Case` → `src/shared/types/api.ts` (already there)

### 1.5 Consolidate filter-types.ts (domain types only)

**Move to `src/shared/types/filters.ts`** (domain types — no Vue deps):
- `FilterState` interface
- `ActiveFilter` interface
- `buildFilterFromState()` function

**Keep in `src/renderer/src/composables/filter-types.ts`** (Vue-specific):
- `UseFilterStateOptions` interface (references `Ref`, callbacks)
- `UseFilterStateReturn` interface (references `Ref`, `ComputedRef`)
- `ExportResult` interface

Update importers accordingly. `filter-types.ts` becomes a smaller file that imports `FilterState` and `ActiveFilter` from shared and adds the Vue-specific wrapper types.

### 1.6 ESLint Restrictions

Add two rules to ESLint config:

**Ban renderer→main imports:**
```javascript
{
  files: ['src/renderer/**'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['**/main/**'],
        message: 'Renderer must not import from main process. Use src/shared/ re-exports.'
      }]
    }]
  }
}
```

**Ban raw `window.api` access (enforce useApiService):**
```javascript
{
  files: ['src/renderer/**'],
  excludedFiles: ['src/renderer/src/composables/useApiService.ts', 'src/renderer/src/services/LogService.ts'],
  rules: {
    'no-restricted-syntax': ['error', {
      selector: "MemberExpression[object.property.name='api'][object.object.name='window']",
      message: 'Use useApiService() for API access. Direct window.api usage is not allowed.'
    }]
  }
}
```

Uses AST-level `no-restricted-syntax` to target `window.api` specifically without blocking other `window.*` usage (e.g., `window.addEventListener`, `requestIdleCallback`).

---

## Phase 2: useFilterState Full Decomposition

### Current State

`src/renderer/src/composables/useFilterState.ts` — 707 lines. Already delegates to:
- `useFilterCore()` — consequences, funcs, clinvars, numeric thresholds, ACMG
- `useFilterPresets()` — impact/AF/CADD preset management
- `useFilterExport()` — Excel export

### New Composables

**`src/renderer/src/composables/useGeneAutocomplete.ts`** (~50 lines)
- Constructor: `(api: WindowAPI | undefined, caseIdRef: Ref<number> | ComputedRef<number>)`
- Owns: `geneSymbolSuggestions: Ref<string[]>`, `loadingSuggestions: Ref<boolean>`
- Methods: `searchGeneSymbols(query: string)`, `handleGeneClear()`
- Null-guarded: `if (!api) return` before API call

**`src/renderer/src/composables/useFilterOptionsCache.ts`** (~80 lines)
- Constructor: `(api: WindowAPI | undefined)`
- Owns: `filterOptions: Ref<FilterOptions>`, internal `LruMap<number, FilterOptions>(20)`
- Methods: `loadFilterOptions(caseId)`, `loadFilterOptionsAndTags(caseId, loadTags: () => Promise<void>)`, `invalidateFilterOptionsCache()`
- Encapsulates LRU cache hit/miss, parallel loading of options + tags

**`src/renderer/src/composables/useFilterLifecycle.ts`** (~60 lines)
- Constructor: `(caseIdRef, deps: { core, resetPresets, onFiltersUpdate, onResetSort, onCaseSwitch, loadFilterOptions, emitFilters, syncCoreToFilters })`
- Owns: the `watch(caseIdRef, ...)` watcher
- Methods: `resetForCaseSwitch()`, `setInitialSearch(search: string)`
- Calls deps on case switch: `core.reset()` → `syncCoreToFilters()` → field resets → `onCaseSwitch()` → `onFiltersUpdate({})` → `loadFilterOptions(newCaseId)`

**`src/renderer/src/composables/useFilterComputed.ts`** (~180 lines)
- Constructor: `(filters: Ref<FilterState>, selectedImpactPresets: Ref<string[]>, core: ReturnType<typeof useFilterCore>)`
- Owns: `hasActiveFilters`, `activeFilterCount`, `activeFiltersList` computeds
- Methods: `isFilterGroupActive(group)`, `clearFilter(filter: ActiveFilter)`, `removeTagFilter(tagId)`, `clearAllFilters(onResetSort)`
- Pure derivation — no side effects, no API calls

### Resulting Facade

`useFilterState.ts` reduced to ~150 lines:
1. Creates all sub-composables
2. Owns: `filters` ref, `exporting` ref, `syncCoreToFilters()`, `emitFilters()`, debounce wiring
3. Wires `filterEmitKey` computed watcher → `debouncedEmit()`
4. Returns `UseFilterStateReturn` (unchanged public API)

### Constraint

The `UseFilterStateReturn` interface is unchanged. Consumers (`FilterToolbar.vue`, `CohortFilterBar.vue`, etc.) see no difference. This is a pure internal refactor.

---

## Phase 3: Tests

Write all tests before calibrating coverage thresholds.

### New Test Files

| File | Tests | What it validates |
|------|-------|-------------------|
| `tests/renderer/composables/useGeneAutocomplete.test.ts` | ~6 | Search, clear, short query guard, API error, API unavailable |
| `tests/renderer/composables/useFilterOptionsCache.test.ts` | ~8 | LRU hit/miss, invalidation, parallel load, case switch, API unavailable |
| `tests/renderer/composables/useFilterLifecycle.test.ts` | ~6 | Case switch reset, initial search, watcher fires, deps called |
| `tests/renderer/composables/useFilterComputed.test.ts` | ~10 | Active filter count, group detection, clear, remove tag, clear all |
| `tests/renderer/composables/useFilterState-integration.test.ts` | ~4 | Facade wires correctly, return shape has all expected keys |
| `tests/shared/types/preload-contract.test.ts` | ~3 | Runtime manifest test (see below) |

### Preload Contract Test

TypeScript interfaces are erased at runtime, so this is a **runtime manifest test**, not a type-level assertion. It works by:

1. Importing the actual preload `api` object (or a mock that mirrors its structure)
2. Comparing its keys against an explicit expected-keys manifest
3. Failing if preload exposes methods not in the manifest (drift detection)

```typescript
// tests/shared/types/preload-contract.test.ts
import { describe, it, expect } from 'vitest'

// Expected top-level keys on window.api, maintained manually
const EXPECTED_API_KEYS = [
  'cases', 'variants', 'import', 'system', 'export', 'shell',
  'database', 'batchImport', 'cohort', 'annotations', 'vep',
  'hpo', 'myvariant', 'spliceai', 'caseMetadata', 'caseComments',
  'caseMetrics', 'transcripts', 'tags', 'logs', 'audit',
  'geneLists', 'regionFiles', 'updater', 'auth', 'analysisGroups',
  'protein', 'gnomad', 'presets', 'panels', 'geneRef'
].sort()

describe('preload contract', () => {
  it('preload exposes exactly the expected top-level API keys', async () => {
    // Import the preload module to get the actual exposed object shape
    // (This requires the preload to be importable in test context)
    // Alternative: parse preload/index.ts source and extract keys
    const preloadSource = await import('fs').then(fs =>
      fs.readFileSync('src/preload/index.ts', 'utf-8')
    )
    // Extract keys from contextBridge.exposeInMainWorld('api', { ... })
    const keyMatches = preloadSource.match(/(\w+):\s*\{/g)
    // ... (implementation details in plan)
  })
})
```

The exact implementation approach (AST parsing vs regex vs import) will be determined in the implementation plan.

### Existing Test Updates

- Any test importing from `main/database/types` gets redirected to `shared/types/database-entities`
- `useFilterState.test.ts` — import path updates for moved types
- Mock files may need DTO import updates

---

## Phase 4: Coverage Infrastructure

Calibrate thresholds from post-test measured actuals, then wire CI.

### 4.1 Measure and Set Per-Directory Thresholds

After all Phase 3 tests pass:
1. Run `npm run test:coverage`
2. Record actual per-directory coverage numbers
3. Set each threshold ~2% below actual (floor, not ceiling)
4. Replace the flat 70% global threshold in `vitest.config.ts`

```typescript
// vitest.config.ts — thresholds set from actual measurements
coverage: {
  provider: 'v8',
  include: ['src/**/*.{ts,vue}'],
  exclude: [
    'src/**/*.d.ts',
    'src/main/index.ts',
    'src/preload/index.ts',
    'src/renderer/src/main.ts',
    'src/renderer/src/plugins/**'
  ],
  thresholds: {
    autoUpdate: true,  // Ratchet thresholds upward automatically when coverage improves
    // Global floor (from measured actuals, ~2% below)
    lines: 0,       // placeholder — set from measurement
    functions: 0,    // placeholder — set from measurement
    branches: 0,     // placeholder — set from measurement
    statements: 0,   // placeholder — set from measurement
    // Per-glob (from measured actuals, ~2% below)
    // Vitest uses glob patterns, not directory paths
    'src/shared/**.ts': { statements: 0, branches: 0, functions: 0, lines: 0 },
    'src/main/database/**.ts': { statements: 0, branches: 0, functions: 0, lines: 0 },
    'src/main/import/**.ts': { statements: 0, branches: 0, functions: 0, lines: 0 },
    'src/main/workers/**.ts': { statements: 0, branches: 0, functions: 0, lines: 0 },
    'src/main/ipc/**.ts': { statements: 0, branches: 0, functions: 0, lines: 0 },
  },
  reporter: ['text', 'json-summary', 'html'],
  reportsDirectory: 'coverage'
}
```

All `0` placeholders are replaced with measured values during implementation. The `autoUpdate: true` flag means Vitest rewrites thresholds in the config file whenever coverage improves, creating a one-way ratchet that prevents regression without manual updates.

**Important Vitest coverage notes** (from docs):
- Glob-specific thresholds do NOT inherit from global — they must be fully specified
- Global thresholds count ALL files including glob-matched ones
- `autoUpdate` rewrites the config file itself, so the ratcheted values are committed to git

### 4.2 CI Build Workflow

In `.github/workflows/build.yml`:
- Change test step from `npm run test` to `npm run test:coverage` on the ubuntu runner
- Upload `coverage/coverage-summary.json` as artifact
- Add `davelosert/vitest-coverage-report-action@v2` step for PR coverage comments (ubuntu only)

### 4.3 Release Workflow Parity

In `.github/workflows/release.yml`:
- Add `npm run lint:check` step before build
- Add `npm run typecheck` step before build
- Ensures tagged release builds are never weaker than PR builds

### 4.4 Coverage Report in .gitignore

Add `coverage/` to `.gitignore` if not already present.

---

## Phase Ordering

```
Phase 1 (type cleanup — sequential within, many shared files):
  1.1 Add missing ShellAPI.showItemInFolder
  1.2 Define real shared DTOs
  1.3 Centralize preload access (casts + direct window.api)
  1.4 Redirect renderer→main type imports
  1.5 Consolidate filter-types.ts (domain types to shared)
  1.6 Add ESLint restrictions

Phase 2 (decomposition — after 1.5):
  Extract useGeneAutocomplete
  Extract useFilterOptionsCache
  Extract useFilterLifecycle
  Extract useFilterComputed
  Rewrite useFilterState facade

Phase 3 (tests — after phases 1 and 2):
  New composable tests (6 files)
  Preload contract test
  Import path updates in existing tests

Phase 4 (coverage — after phase 3):
  4.1 Measure actuals, set per-directory thresholds
  4.2 Wire CI build workflow
  4.3 Wire release workflow parity
  4.4 gitignore coverage/
```

---

## Scope Boundaries

- No new features
- No UI/UX changes
- No changes to Electron main window creation or app lifecycle
- No new runtime dependencies
- `UseFilterStateReturn` public API unchanged — consumers see no difference
- Vue-specific types stay renderer-local; only domain DTOs go to shared
- Shared layer never re-exports from main; it defines canonical types
- Coverage thresholds are floors calibrated from actuals — they pass today and ratchet upward
- `LogService.ts` is an approved exception for direct `window.api` access (bootstrap context)
