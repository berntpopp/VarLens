# PR 3: Architecture & Performance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce architectural debt by decomposing oversized modules, replacing `(window as any).api` casts with typed composables, adding missing WindowAPI types, replacing inline LRU patterns with a shared utility, and logging empty catch blocks — all without changing user-visible behavior.

**Architecture:** 7 tasks across 2 execution waves. Wave A tasks are fully independent. Wave B depends on Wave A completions (Task 4 depends on Task 3's LruMap). Branch `refactor/architecture-perf` off `main`. One atomic commit per task. Single PR.

**Tech Stack:** Vue 3 + Vuetify 3 + TypeScript (renderer), Electron 40 (main), better-sqlite3-multiple-ciphers (DB), Vitest (tests)

**Spec:** [.planning/specs/2026-04-01-stability-hardening-design.md](../specs/2026-04-01-stability-hardening-design.md)

**Scope notes:**
- Design spec tasks 3.8 (split import-worker) and 3.9 (streaming VCF) were completed during PR #134 — `import-pipeline.ts` already uses `streamInsertVcf` and `streamInsertJson`. These tasks are omitted from this plan.
- Task 3.6 (router as single source of truth) is deferred — the app uses `createMemoryHistory()` (Electron has no URL bar), so URL-based state offers minimal benefit. Would require significant refactor of `useAppState` for no user-visible improvement.

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/shared/utils/lru-map.ts` | Generic `LruMap<K,V>` class using Map insertion order |
| `tests/shared/utils/lru-map.test.ts` | LruMap unit tests |
| `src/renderer/src/composables/useAssociation.ts` | Typed wrapper for association API calls |
| `tests/renderer/composables/useAssociation.test.ts` | useAssociation unit tests |
| `src/main/database/VariantFilterBuilder.ts` | Filter WHERE clause construction extracted from VariantRepository |
| `src/main/database/VariantSearchService.ts` | FTS5 search + boolean parsing extracted from VariantRepository |
| `src/main/database/VariantFrequencyService.ts` | Frequency CRUD extracted from VariantRepository |
| `tests/main/database/variant-filter-builder.test.ts` | VariantFilterBuilder tests |
| `tests/main/database/variant-search-service.test.ts` | VariantSearchService tests |

### Modified Files
| File | What Changes |
|------|-------------|
| `src/shared/types/api.ts` | Add `geneSymbols` to `VariantsAPI`, add association methods to `CohortAPI` |
| `src/renderer/src/components/association/GeneBurdenView.vue` | Replace `(window as any).api` with `useApiService()` + `useAssociation()` |
| `src/renderer/src/composables/useAnnotations.ts` | Replace inline LRU with `LruMap` |
| `src/renderer/src/composables/useCaseMetadata.ts` | Replace inline LRU with `LruMap` |
| `src/renderer/src/composables/useFilterState.ts` | Replace inline LRU with `LruMap`, remove `(api as any)` casts |
| `src/main/database/VariantRepository.ts` | Delegate to extracted modules |
| `src/main/workers/import-worker.ts` | Add `console.warn` to empty catch blocks |
| `src/main/workers/worker-db.ts` | Add `console.warn` to empty catch blocks |
| `src/main/workers/import-pipeline.ts` | Add `console.warn` to empty catch blocks |
| ~25 main process files | Add `mainLogger.warn` to empty catch blocks |
| ~25 renderer files | Add `logService.warn` to empty catch blocks |

---

## Parallelism

```
Wave A (independent):
  Task 1: Add missing WindowAPI types + GeneBurdenView refactor (3.1)
  Task 2: Audit empty catches — workers/main (3.2)
  Task 3: LruMap utility (3.5)
  Task 5: Decompose VariantRepository (3.7)
  Task 6: Audit empty catches — renderer (3.3)

Wave B (after Wave A):
  Task 4: Replace inline LRU patterns + decompose useFilterState (3.4) ← Task 3
  Task 7: Remove remaining (api as any) casts in useFilterState ← Task 1
```

---

## Task 1: Add Missing WindowAPI Types + GeneBurdenView Refactor (Findings 3.1)

**Files:**
- Modify: `src/shared/types/api.ts:167-177` (VariantsAPI), `src/shared/types/api.ts:326-337` (CohortAPI)
- Create: `src/renderer/src/composables/useAssociation.ts`
- Create: `tests/renderer/composables/useAssociation.test.ts`
- Modify: `src/renderer/src/components/association/GeneBurdenView.vue`

- [ ] **Step 1: Add `geneSymbols` to VariantsAPI interface**

In `src/shared/types/api.ts`, add the missing method to `VariantsAPI` (after line 176):

```typescript
export interface VariantsAPI {
  query: (
    caseId: number,
    filters: Omit<VariantFilter, 'case_id'>,
    offset?: number,
    limit?: number,
    sortBy?: SortItem[]
  ) => Promise<PaginatedResult<Variant>>
  getFilterOptions: (caseId: number) => Promise<FilterOptions>
  search: (caseId: number, query: string, limit?: number) => Promise<Variant[]>
  geneSymbols: (caseId: number, query: string, limit?: number) => Promise<string[]>
}
```

- [ ] **Step 2: Add association methods to CohortAPI interface**

In `src/shared/types/api.ts`, add after the existing `onSummaryRebuilt` method in `CohortAPI`:

```typescript
export interface CohortAPI {
  getVariants: (
    params: CohortSearchParams
  ) => Promise<{ data: CohortVariant[]; total_count: number }>
  getSummary: () => Promise<CohortSummary>
  getCarriers: (chr: string, pos: number, ref: string, alt: string) => Promise<CohortCarrier[]>
  getGeneBurden: () => Promise<GeneBurden[]>
  getColumnMeta: () => Promise<ColumnFilterMeta[]>
  getSummaryStatus: () => Promise<{ is_stale: boolean; last_rebuilt_at: number }>
  rebuildSummary: () => Promise<void>
  onSummaryRebuilt: (callback: (status: { is_stale: boolean }) => void) => () => void
  runAssociation: (config: unknown) => Promise<unknown>
  cancelAssociation: () => Promise<void>
  onAssociationProgress: (
    callback: (progress: { completed: number; total: number }) => void
  ) => () => void
}
```

- [ ] **Step 3: Run typecheck to confirm no new errors**

Run: `npx vue-tsc --noEmit 2>&1 | tail -20`
Expected: No new errors. Existing `(window as any)` casts should be unaffected.

- [ ] **Step 4: Write failing test for useAssociation**

Create `tests/renderer/composables/useAssociation.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock useApiService before import
const mockApi = {
  cohort: {
    runAssociation: vi.fn(),
    cancelAssociation: vi.fn(),
    onAssociationProgress: vi.fn()
  },
  cases: {
    list: vi.fn()
  },
  caseMetadata: {
    listCohorts: vi.fn(),
    getFullMetadata: vi.fn()
  }
}

vi.mock('../../../src/renderer/src/composables/useApiService', () => ({
  useApiService: () => ({ api: mockApi, isAvailable: { value: true } })
}))

import { useAssociation } from '../../../src/renderer/src/composables/useAssociation'

describe('useAssociation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runAssociation calls api.cohort.runAssociation with config', async () => {
    mockApi.cohort.runAssociation.mockResolvedValue({ results: [], warnings: [] })
    const { runAssociation } = useAssociation()
    const config = { caseIds: [1, 2], test: 'fisher' }
    const result = await runAssociation(config)
    expect(mockApi.cohort.runAssociation).toHaveBeenCalledWith(config)
    expect(result).toEqual({ results: [], warnings: [] })
  })

  it('cancelAssociation calls api.cohort.cancelAssociation', () => {
    const { cancelAssociation } = useAssociation()
    cancelAssociation()
    expect(mockApi.cohort.cancelAssociation).toHaveBeenCalled()
  })

  it('onAssociationProgress registers callback and returns cleanup', () => {
    const cleanup = vi.fn()
    mockApi.cohort.onAssociationProgress.mockReturnValue(cleanup)
    const { onAssociationProgress } = useAssociation()
    const callback = vi.fn()
    const result = onAssociationProgress(callback)
    expect(mockApi.cohort.onAssociationProgress).toHaveBeenCalledWith(callback)
    expect(result).toBe(cleanup)
  })

  it('loadCasesWithMetadata returns case info with cohort IDs', async () => {
    mockApi.cases.list.mockResolvedValue([
      { id: 1, name: 'Case1' },
      { id: 2, name: 'Case2' }
    ])
    mockApi.caseMetadata.listCohorts.mockResolvedValue([{ id: 10, name: 'Cohort1' }])
    mockApi.caseMetadata.getFullMetadata
      .mockResolvedValueOnce({
        metadata: { affected_status: 'affected', sex: 'male' },
        cohorts: [{ id: 10, name: 'Cohort1' }]
      })
      .mockResolvedValueOnce({
        metadata: { affected_status: 'unaffected', sex: 'female' },
        cohorts: []
      })

    const { loadCasesWithMetadata } = useAssociation()
    const { cases, cohortGroups } = await loadCasesWithMetadata()

    expect(cases).toHaveLength(2)
    expect(cases[0].status).toBe('affected')
    expect(cases[0].cohortIds).toEqual([10])
    expect(cases[1].cohortIds).toEqual([])
    expect(cohortGroups).toEqual([{ id: 10, name: 'Cohort1' }])
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm run test -- --run tests/renderer/composables/useAssociation.test.ts`
Expected: FAIL — module not found

- [ ] **Step 6: Implement useAssociation**

Create `src/renderer/src/composables/useAssociation.ts`:

```typescript
/**
 * Composable for gene burden / association analysis API calls.
 *
 * Wraps cohort.runAssociation, cancelAssociation, onAssociationProgress
 * and the case-loading logic needed by GeneBurdenView.
 */
import { useApiService } from './useApiService'
import { logService } from '../services/LogService'

interface CaseInfo {
  id: number
  name: string
  status: string | null
  sex: string | null
  cohortIds: number[]
}

interface CohortGroup {
  id: number
  name: string
}

export function useAssociation() {
  const { api } = useApiService()

  async function runAssociation(config: unknown): Promise<unknown> {
    if (!api) throw new Error('API not available')
    return api.cohort.runAssociation(config)
  }

  function cancelAssociation(): void {
    if (!api) return
    api.cohort.cancelAssociation()
  }

  function onAssociationProgress(
    callback: (progress: { completed: number; total: number }) => void
  ): () => void {
    if (!api) return () => {}
    return api.cohort.onAssociationProgress(callback)
  }

  async function loadCasesWithMetadata(): Promise<{
    cases: CaseInfo[]
    cohortGroups: CohortGroup[]
  }> {
    if (!api) return { cases: [], cohortGroups: [] }

    const [caseList, cohorts] = await Promise.all([
      api.cases.list(),
      api.caseMetadata.listCohorts()
    ])

    const cases = await Promise.all(
      caseList.map(async (c: { id: number; name: string }) => {
        try {
          const fullMeta = await api.caseMetadata.getFullMetadata(c.id)
          return {
            id: c.id,
            name: c.name,
            status: fullMeta?.metadata?.affected_status ?? null,
            sex: fullMeta?.metadata?.sex ?? null,
            cohortIds: fullMeta?.cohorts?.map((co: CohortGroup) => co.id) ?? []
          }
        } catch {
          logService.warn(`Failed to load metadata for case ${c.id}`, 'association')
          return { id: c.id, name: c.name, status: null, sex: null, cohortIds: [] }
        }
      })
    )

    return { cases, cohortGroups: cohorts }
  }

  return {
    runAssociation,
    cancelAssociation,
    onAssociationProgress,
    loadCasesWithMetadata
  }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test -- --run tests/renderer/composables/useAssociation.test.ts`
Expected: PASS

- [ ] **Step 8: Rewrite GeneBurdenView.vue to use useAssociation**

Replace the `<script setup>` section of `src/renderer/src/components/association/GeneBurdenView.vue`. The template stays unchanged. Replace the entire script block (lines 63–236):

```typescript
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import AssociationConfigPanel from './AssociationConfigPanel.vue'
import AssociationResults from './AssociationResults.vue'
import { useAssociation } from '../../composables/useAssociation'

interface CaseInfo {
  id: number
  name: string
  status: string | null
  sex: string | null
  cohortIds: number[]
}

interface CohortGroup {
  id: number
  name: string
}

type AssociationResultsData = {
  results: Array<{ q_value: number | null; [key: string]: unknown }>
  warnings: string[]
}

const { runAssociation: apiRunAssociation, cancelAssociation: apiCancel, onAssociationProgress, loadCasesWithMetadata } = useAssociation()

const cases = ref<CaseInfo[]>([])
const cohortGroups = ref<CohortGroup[]>([])
const results = ref<AssociationResultsData | null>(null)
const isRunning = ref(false)
const error = ref<string | null>(null)
const showWarnings = ref(false)
const activeTab = ref('table')
const progressCompleted = ref(0)
const progressTotal = ref(0)

const progressPercent = computed(() =>
  progressTotal.value > 0 ? (progressCompleted.value / progressTotal.value) * 100 : 0
)

const significantCount = computed(
  () => results.value?.results.filter((r) => r.q_value !== null && r.q_value < 0.05).length ?? 0
)

let cleanupProgress: (() => void) | null = null

async function loadCases(): Promise<void> {
  try {
    const loaded = await loadCasesWithMetadata()
    cases.value = loaded.cases
    cohortGroups.value = loaded.cohortGroups
  } catch (err) {
    error.value = `Failed to load cases: ${err instanceof Error ? err.message : String(err)}`
  }
}

async function runAnalysis(config: unknown): Promise<void> {
  error.value = null
  results.value = null
  isRunning.value = true
  progressCompleted.value = 0
  progressTotal.value = 0

  cleanupProgress = onAssociationProgress((progress: { completed: number; total: number }) => {
    progressCompleted.value = progress.completed
    progressTotal.value = progress.total
  })

  try {
    const result = await apiRunAssociation(config)
    if (result !== null && typeof result === 'object' && 'error' in result) {
      throw new Error(String((result as { error: unknown }).error))
    }
    results.value = result as AssociationResultsData
  } catch (err) {
    error.value = `Analysis failed: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    isRunning.value = false
    if (cleanupProgress) {
      cleanupProgress()
      cleanupProgress = null
    }
  }
}

function cancelAnalysis(): void {
  apiCancel()
}

onMounted(loadCases)

onBeforeUnmount(() => {
  if (cleanupProgress) {
    cleanupProgress()
    cleanupProgress = null
  }
})

const refresh = async (): Promise<void> => {
  await loadCases()
}

defineExpose({ refresh })
</script>
```

- [ ] **Step 9: Run typecheck**

Run: `npx vue-tsc --noEmit 2>&1 | tail -20`
Expected: PASS — no `(window as any)` references remain in GeneBurdenView.vue

- [ ] **Step 10: Run full test suite**

Run: `npm run test -- --run`
Expected: All tests pass

- [ ] **Step 11: Commit**

```bash
git add src/shared/types/api.ts src/renderer/src/composables/useAssociation.ts \
  tests/renderer/composables/useAssociation.test.ts \
  src/renderer/src/components/association/GeneBurdenView.vue
git commit -m "refactor: add missing WindowAPI types and replace (window as any) in GeneBurdenView"
```

---

## Task 2: Audit Empty Catch Blocks — Workers & Main Process (Finding 3.2)

**Files:**
- Modify: `src/main/workers/import-worker.ts` (~6 catches)
- Modify: `src/main/workers/worker-db.ts` (~5 catches)
- Modify: `src/main/workers/import-pipeline.ts` (~1 catch)
- Modify: `src/main/workers/delete-worker.ts` (~3 catches)
- Modify: `src/main/workers/rebuild-summary-worker.ts` (~3 catches)
- Modify: `src/main/workers/db-worker.ts` (~2 catches)
- Modify: ~22 main process files with empty catches

Workers cannot use `mainLogger` (no Electron IPC in worker threads). Use `console.warn` in workers. Use `mainLogger.warn` in main process files.

- [ ] **Step 1: Add logging to worker empty catch blocks**

For each worker file, replace empty catches with descriptive `console.warn` messages. The pattern for genuine best-effort catches (cleanup on exit) is to add a comment explaining why silence is intentional, plus a `console.warn` at debug level.

In `src/main/workers/import-worker.ts`, replace each empty catch:

Line 48:
```typescript
// Before:
catch {
  /* table may not exist yet */
}

// After:
catch (e) {
  console.warn('[import-worker] MARK_STALE_SQL skipped (table may not exist yet):', e)
}
```

Line 188:
```typescript
// Before:
catch { // best effort }

// After:
catch (e) {
  console.warn('[import-worker] best-effort progress report failed:', e)
}
```

Lines 269, 274, 281, 286 (cleanup block catches):
```typescript
// Before:
catch { // best effort — ... }

// After:
catch (e) {
  console.warn('[import-worker] best-effort cleanup failed:', e)
}
```

Apply similar patterns to `worker-db.ts` (5 catches), `import-pipeline.ts` (1 catch), `delete-worker.ts` (3 catches), `rebuild-summary-worker.ts` (3 catches), `db-worker.ts` (2 catches).

- [ ] **Step 2: Add logging to main process empty catch blocks**

For each main process file with empty catches, add `mainLogger.warn(msg, 'source')`. Files to audit:

- `src/main/database/schema.ts` (2 catches)
- `src/main/database/CohortSummaryService.ts` (4 catches)
- `src/main/database/DatabaseService.ts` (4 catches)
- `src/main/database/GeneReferenceDb.ts` (2 catches)
- `src/main/database/cohort.ts` (1 catch)
- `src/main/database/VariantRepository.ts` (1 catch)
- `src/main/services/api/SpliceAIApiClient.ts` (2 catches)
- `src/main/services/api/VepApiClient.ts` (1 catch)
- `src/main/services/api/HpoApiClient.ts` (1 catch)
- `src/main/services/api/MyVariantApiClient.ts` (2 catches)
- `src/main/services/MainLogger.ts` (1 catch)
- `src/main/services/DatabaseManager.ts` (1 catch)
- `src/main/services/RecentDatabasesService.ts` (2 catches)
- `src/main/import/ZipExtractor.ts` (2 catches)
- `src/main/index.ts` (1 catch)
- `src/main/ipc/dbPoolManager.ts` (1 catch)
- `src/main/ipc/utils/settings-io.ts` (1 catch)
- `src/main/ipc/handlers/system.ts` (1 catch)
- `src/main/ipc/handlers/cohort.ts` (1 catch)
- `src/main/ipc/handlers/database.ts` (3 catches)
- `src/main/ipc/handlers/cases.ts` (1 catch)
- `src/main/utils/url-validation.ts` (1 catch)

For each catch, read the surrounding code to determine the context and add an appropriate message:

```typescript
// Main process pattern:
catch (e) {
  mainLogger.warn('Context description: ' + (e instanceof Error ? e.message : String(e)), 'source-module')
}
```

For catches that are genuinely intentional silence (e.g., checking if a table exists), add a comment and a debug-level log:

```typescript
catch (e) {
  // Intentional: table may not exist in older schema versions
  mainLogger.warn('Optional table check failed (expected during migration): ' + (e instanceof Error ? e.message : String(e)), 'schema')
}
```

- [ ] **Step 3: Run lint to verify no issues**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 4: Run full test suite**

Run: `npm run test -- --run`
Expected: All tests pass (catch blocks don't change behavior)

- [ ] **Step 5: Commit**

```bash
git add src/main/
git commit -m "fix: add logging to empty catch blocks in workers and main process"
```

---

## Task 3: Create LruMap Utility (Finding 3.5)

**Files:**
- Create: `src/shared/utils/lru-map.ts`
- Create: `tests/shared/utils/lru-map.test.ts`

- [ ] **Step 1: Write failing tests for LruMap**

Create `tests/shared/utils/lru-map.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { LruMap } from '../../../src/shared/utils/lru-map'

describe('LruMap', () => {
  it('stores and retrieves values', () => {
    const cache = new LruMap<string, number>(3)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1)
    expect(cache.get('b')).toBe(2)
  })

  it('returns undefined for missing keys', () => {
    const cache = new LruMap<string, number>(3)
    expect(cache.get('missing')).toBeUndefined()
  })

  it('evicts oldest entry when exceeding max size', () => {
    const cache = new LruMap<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3) // should evict 'a'
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
    expect(cache.size).toBe(2)
  })

  it('get() promotes entry to most-recently-used', () => {
    const cache = new LruMap<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.get('a') // promote 'a'
    cache.set('c', 3) // should evict 'b' (oldest), not 'a'
    expect(cache.get('a')).toBe(1)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe(3)
  })

  it('set() on existing key updates value and promotes', () => {
    const cache = new LruMap<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('a', 10) // update + promote
    cache.set('c', 3) // should evict 'b'
    expect(cache.get('a')).toBe(10)
    expect(cache.get('b')).toBeUndefined()
  })

  it('has() returns correct boolean', () => {
    const cache = new LruMap<string, number>(2)
    cache.set('a', 1)
    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
  })

  it('delete() removes entry', () => {
    const cache = new LruMap<string, number>(3)
    cache.set('a', 1)
    cache.delete('a')
    expect(cache.get('a')).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('clear() removes all entries', () => {
    const cache = new LruMap<string, number>(3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeUndefined()
  })

  it('handles numeric keys', () => {
    const cache = new LruMap<number, string>(2)
    cache.set(1, 'one')
    cache.set(2, 'two')
    cache.set(3, 'three') // evicts 1
    expect(cache.get(1)).toBeUndefined()
    expect(cache.get(2)).toBe('two')
  })

  it('values() returns all values', () => {
    const cache = new LruMap<string, number>(5)
    cache.set('a', 1)
    cache.set('b', 2)
    expect([...cache.values()]).toEqual([1, 2])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run tests/shared/utils/lru-map.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement LruMap**

Create `src/shared/utils/lru-map.ts`:

```typescript
/**
 * Simple LRU cache backed by a JavaScript Map.
 *
 * Map preserves insertion order, so the first key is always the oldest.
 * On `get()`, the accessed entry is moved to the end (most-recently-used).
 * On `set()`, entries beyond `maxSize` are evicted from the front (oldest).
 */
export class LruMap<K, V> {
  private readonly map = new Map<K, V>()
  readonly maxSize: number

  constructor(maxSize: number) {
    if (maxSize < 1) throw new RangeError('maxSize must be >= 1')
    this.maxSize = maxSize
  }

  get size(): number {
    return this.map.size
  }

  get(key: K): V | undefined {
    const value = this.map.get(key)
    if (value !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key)
      this.map.set(key, value)
    }
    return value
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key)
    }
    this.map.set(key, value)
    while (this.map.size > this.maxSize) {
      const oldestKey = this.map.keys().next().value
      if (oldestKey === undefined) break
      this.map.delete(oldestKey)
    }
  }

  has(key: K): boolean {
    return this.map.has(key)
  }

  delete(key: K): boolean {
    return this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }

  values(): IterableIterator<V> {
    return this.map.values()
  }

  keys(): IterableIterator<K> {
    return this.map.keys()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run tests/shared/utils/lru-map.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/utils/lru-map.ts tests/shared/utils/lru-map.test.ts
git commit -m "feat: add shared LruMap utility for cache eviction"
```

---

## Task 4: Replace Inline LRU Patterns + Decompose useFilterState (Findings 3.4 + 3.5)

**Depends on:** Task 3 (LruMap)

**Files:**
- Modify: `src/renderer/src/composables/useAnnotations.ts:22-60`
- Modify: `src/renderer/src/composables/useCaseMetadata.ts:31-66`
- Modify: `src/renderer/src/composables/useFilterState.ts:540-555`

- [ ] **Step 1: Replace LRU in useAnnotations.ts**

In `src/renderer/src/composables/useAnnotations.ts`:

Add import at top (after existing imports):
```typescript
import { LruMap } from '../../../shared/utils/lru-map'
```

Replace the annotation cache declaration and cacheSet function (lines 22-60):

```typescript
// Maximum number of annotation cache entries before LRU eviction
export const MAX_CACHE_SIZE = 5000

// Cache annotations by variant key (chr:pos:ref:alt)
// shallowRef avoids deep reactive proxies on 5000+ Map entries
// Exported so useVariantRowViewModel can read it for precomputed row state
const lruCache = new LruMap<string, AnnotationCache>(MAX_CACHE_SIZE)
export const annotationCache = shallowRef<LruMap<string, AnnotationCache>>(lruCache)

// Loading states per variant key
const loadingStates = shallowRef<Map<string, boolean>>(new Map())

/**
 * LRU-aware cache setter. Delegates eviction to LruMap.
 *
 * Uses microtask batching: multiple cacheSet calls in the same tick produce
 * only one triggerRef flush, reducing reactivity churn during batch loads.
 */
let pendingCacheTrigger = false
function cacheSet(key: string, value: AnnotationCache): void {
  annotationCache.value.set(key, value)
  if (!pendingCacheTrigger) {
    pendingCacheTrigger = true
    Promise.resolve().then(() => {
      triggerRef(annotationCache)
      pendingCacheTrigger = false
    })
  }
}
```

Also update any `cache.has(key)` / `cache.get(key)` / `cache.delete(key)` calls to use the LruMap API (which has the same interface as Map for these methods).

- [ ] **Step 2: Replace LRU in useCaseMetadata.ts**

In `src/renderer/src/composables/useCaseMetadata.ts`:

Add import:
```typescript
import { LruMap } from '../../../shared/utils/lru-map'
```

Replace the cache declaration and eviction function (lines 31-66):

```typescript
/** Maximum cached case metadata entries — evicts oldest on overflow */
const MAX_METADATA_CACHE_SIZE = 200

// Cache full metadata by caseId — shallowRef avoids deep reactivity overhead
const metadataCache = shallowRef<LruMap<number, FullCaseMetadata>>(
  new LruMap(MAX_METADATA_CACHE_SIZE)
)

// Loading states per case — shallowRef since we trigger manually
const loadingStates = shallowRef<Map<number, boolean>>(new Map())

/**
 * Notify Vue that metadataCache changed (batched via microtask).
 */
let _pendingTrigger = false
function triggerCacheUpdate(): void {
  if (!_pendingTrigger) {
    _pendingTrigger = true
    Promise.resolve().then(() => {
      triggerRef(metadataCache)
      _pendingTrigger = false
    })
  }
}
```

Remove the `evictIfNeeded()` function entirely — `LruMap.set()` handles eviction.

In `loadMetadata()` (line 86), replace:
```typescript
// Before:
metadataCache.value.set(caseId, result)
evictIfNeeded()

// After:
metadataCache.value.set(caseId, result)
```

In `getMetadata()` (lines 115-124), simplify — `LruMap.get()` already promotes on access:
```typescript
function getMetadata(caseId: number): FullCaseMetadata | undefined {
  return metadataCache.value.get(caseId)
}
```

- [ ] **Step 3: Replace LRU in useFilterState.ts**

In `src/renderer/src/composables/useFilterState.ts`:

Add import:
```typescript
import { LruMap } from '../../../shared/utils/lru-map'
```

Replace the filter options cache (lines 540-555):

```typescript
// LRU cache for filter options per case
const FILTER_OPTIONS_CACHE_MAX = 20
const filterOptionsCache = new LruMap<number, FilterOptions>(FILTER_OPTIONS_CACHE_MAX)

/**
 * Store options in the LRU cache (LruMap handles eviction automatically)
 */
const cacheFilterOptions = (caseId: number, options: FilterOptions): void => {
  filterOptionsCache.set(caseId, options)
}
```

- [ ] **Step 4: Run full test suite**

Run: `npm run test -- --run`
Expected: All tests pass — LruMap has the same Map-compatible API

- [ ] **Step 5: Run typecheck**

Run: `npx vue-tsc --noEmit 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/composables/useAnnotations.ts \
  src/renderer/src/composables/useCaseMetadata.ts \
  src/renderer/src/composables/useFilterState.ts
git commit -m "refactor: replace inline LRU patterns with shared LruMap utility"
```

---

## Task 5: Decompose VariantRepository.ts (Finding 3.7)

**Files:**
- Create: `src/main/database/VariantFilterBuilder.ts`
- Create: `src/main/database/VariantSearchService.ts`
- Create: `src/main/database/VariantFrequencyService.ts`
- Create: `tests/main/database/variant-filter-builder.test.ts`
- Create: `tests/main/database/variant-search-service.test.ts`
- Modify: `src/main/database/VariantRepository.ts`

- [ ] **Step 1: Write failing test for VariantFilterBuilder**

Create `tests/main/database/variant-filter-builder.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { Kysely, SqliteDialect } from 'kysely'
import type { VarlensDatabase } from '../../../src/shared/types/database-schema'
import { VariantFilterBuilder } from '../../../src/main/database/VariantFilterBuilder'

describe('VariantFilterBuilder', () => {
  let db: InstanceType<typeof Database>
  let kysely: Kysely<VarlensDatabase>
  let builder: VariantFilterBuilder

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE cases (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE variants (
        id INTEGER PRIMARY KEY, case_id INTEGER, chr TEXT, pos INTEGER,
        ref TEXT, alt TEXT, gene_symbol TEXT, omim_mim_number TEXT,
        consequence TEXT, gnomad_af REAL, cadd REAL, clinvar TEXT,
        gt_num TEXT, func TEXT, qual REAL, hpo_sim_score REAL,
        transcript TEXT, cdna TEXT, aa_change TEXT, moi TEXT,
        gq REAL, dp INTEGER, ad_ref INTEGER, ad_alt INTEGER, ab REAL,
        filter TEXT, info_json TEXT, source_format TEXT
      );
      CREATE TABLE variant_frequency (chr TEXT, pos INTEGER, ref TEXT, alt TEXT, case_count INTEGER,
        UNIQUE(chr, pos, ref, alt));
      INSERT INTO cases (id, name) VALUES (1, 'test');
      INSERT INTO variants (id, case_id, chr, pos, ref, alt, gene_symbol, consequence, func, gnomad_af, cadd)
        VALUES (1, 1, 'chr1', 100, 'A', 'T', 'BRCA1', 'HIGH', 'missense_variant', 0.01, 25.0);
      INSERT INTO variants (id, case_id, chr, pos, ref, alt, gene_symbol, consequence, func, gnomad_af, cadd)
        VALUES (2, 1, 'chr1', 200, 'G', 'C', 'TP53', 'LOW', 'synonymous_variant', 0.5, 5.0);
      INSERT INTO variant_frequency VALUES ('chr1', 100, 'A', 'T', 1);
      INSERT INTO variant_frequency VALUES ('chr1', 200, 'G', 'C', 2);
    `)
    kysely = new Kysely<VarlensDatabase>({
      dialect: new SqliteDialect({ database: db })
    })
    builder = new VariantFilterBuilder(db, kysely)
  })

  afterEach(() => {
    kysely.destroy()
    db.close()
  })

  it('builds query filtering by case_id', () => {
    const compiled = builder.build({ case_id: 1 }).compile()
    expect(compiled.sql).toContain('case_id')
  })

  it('applies gene_symbol filter', () => {
    const compiled = builder.build({ case_id: 1, gene_symbol: 'BRCA1' }).compile()
    expect(compiled.sql).toContain('gene_symbol')
  })

  it('applies consequences array filter', () => {
    const compiled = builder.build({ case_id: 1, consequences: ['HIGH'] }).compile()
    expect(compiled.sql).toContain('consequence')
  })

  it('applies gnomad_af threshold filter', () => {
    const compiled = builder.build({ case_id: 1, max_gnomad_af: 0.05 }).compile()
    expect(compiled.sql).toContain('gnomad_af')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run tests/main/database/variant-filter-builder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Extract VariantFilterBuilder**

Create `src/main/database/VariantFilterBuilder.ts`. Extract `buildVariantQuery()` (lines 229-660), the `VariantQueryBuilder` type, `SORTABLE_COLUMNS`, `NUMERIC_COLUMNS`, and `applySort()` from `VariantRepository.ts`:

```typescript
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { sql, type Kysely, type SelectQueryBuilder } from 'kysely'
import type { VarlensDatabase } from '../../shared/types/database-schema'
import type { VariantFilter, SortItem } from './types'
import { mainLogger } from '../services/MainLogger'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VariantQueryBuilder = SelectQueryBuilder<VarlensDatabase, any, Record<string, unknown>>

export const SORTABLE_COLUMNS: Record<string, string> = {
  chr: 'chr',
  pos: 'pos',
  gene_symbol: 'gene_symbol',
  omim_mim_number: 'omim_mim_number',
  func: 'func',
  consequence: 'consequence',
  transcript: 'transcript',
  cdna: 'cdna',
  aa_change: 'aa_change',
  gt_num: 'gt_num',
  gnomad_af: 'gnomad_af',
  cadd: 'cadd',
  qual: 'qual',
  hpo_sim_score: 'hpo_sim_score',
  clinvar: 'clinvar',
  moi: 'moi'
}

export class VariantFilterBuilder {
  constructor(
    private readonly db: DatabaseType,
    private readonly kysely: Kysely<VarlensDatabase>
  ) {}

  /**
   * Build a Kysely SELECT query from a VariantFilter.
   * The full implementation is moved here from VariantRepository.buildVariantQuery().
   */
  build(filter: VariantFilter, options?: { forceOrChain?: boolean }): VariantQueryBuilder {
    // Move the entire body of buildVariantQuery() here unchanged
    // (lines 233-660 of VariantRepository.ts)
    let query: VariantQueryBuilder = this.kysely
      .selectFrom('variants')
      .selectAll('variants')
      .leftJoin('variant_frequency as vf', (join) =>
        join
          .onRef('vf.chr', '=', 'variants.chr')
          .onRef('vf.pos', '=', 'variants.pos')
          .onRef('vf.ref', '=', 'variants.ref')
          .onRef('vf.alt', '=', 'variants.alt')
      )
      .select(
        sql<
          number | null
        >`CAST(vf.case_count AS REAL) / NULLIF((SELECT COUNT(*) FROM cases), 0)`.as('internal_af')
      )
      .where('variants.case_id', '=', filter.case_id)

    // ... rest of buildVariantQuery body moved verbatim ...
    // (This is a mechanical extraction — no logic changes)

    return query
  }

  /**
   * Apply ORDER BY to a Kysely query.
   * Moved from VariantRepository.applySort().
   */
  applySort(query: VariantQueryBuilder, sortBy?: SortItem[]): VariantQueryBuilder {
    // Move the entire body of applySort() here unchanged
    // (lines 722-747 of VariantRepository.ts)
    if (!sortBy || sortBy.length === 0) {
      return query.orderBy(sql`pos ASC NULLS LAST`).orderBy(sql`id ASC`)
    }

    let sorted = query
    let hasIdSort = false

    for (const sort of sortBy) {
      const sqlColumn = SORTABLE_COLUMNS[sort.key]
      if (sqlColumn === undefined) {
        mainLogger.warn(`Invalid sort column rejected: ${sort.key}`, 'VariantFilterBuilder')
        continue
      }
      const dir = sort.order === 'desc' ? 'DESC' : 'ASC'
      const nulls = 'NULLS LAST'
      sorted = sorted.orderBy(sql`${sql.ref(sqlColumn)} ${sql.raw(dir)} ${sql.raw(nulls)}`)
      if (sort.key === 'id') hasIdSort = true
    }

    if (!hasIdSort) {
      sorted = sorted.orderBy(sql`id ASC`)
    }

    return sorted
  }
}
```

**Important:** The actual implementation must copy the full `buildVariantQuery()` body verbatim — all filter branches (consequences, funcs, clinvars, gnomad_af, cadd, internal_af, ACMG, panels, inheritance, search, etc.). The snippet above shows the structure; the full body is lines 233-660 of the current `VariantRepository.ts`.

- [ ] **Step 4: Extract VariantSearchService**

Create `src/main/database/VariantSearchService.ts`. Extract `applySearchFilter()`, `applySingleSearchToken()`, `searchVariants()`, and `getGeneSymbols()`:

```typescript
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { sql, type Kysely } from 'kysely'
import type { VarlensDatabase } from '../../shared/types/database-schema'
import type { Variant } from './types'
import type { VariantQueryBuilder } from './VariantFilterBuilder'
import { tokenize, parse } from '../../shared/utils/boolean-search'
import { emitFts5Search } from './search/fts5-search-emitter'

export class VariantSearchService {
  constructor(
    private readonly db: DatabaseType,
    private readonly kysely: Kysely<VarlensDatabase>
  ) {}

  /**
   * Apply FTS5 search filter to a Kysely query.
   * Moved from VariantRepository.applySearchFilter().
   */
  applySearchFilter(query: VariantQueryBuilder, searchQuery: string): VariantQueryBuilder {
    // Move body of applySearchFilter() verbatim (lines 669-700)
    const term = searchQuery.trim()
    const hasBooleanOps = /\b(AND|OR|NOT)\b/.test(term)

    if (!hasBooleanOps) {
      return this.applySingleSearchToken(query, term)
    }

    const tokens = tokenize(term)
    if (tokens.length === 0) return query
    let ast
    try {
      ast = parse(tokens)
    } catch {
      return this.applySingleSearchToken(query, term)
    }
    const { sql: boolExpr, params } = emitFts5Search(ast)

    const fullExpr = `(${boolExpr})`
    const segments = fullExpr.split('?')
    let paramIdx = 0

    let rawExpr = sql<boolean>`${sql.raw(segments[0])}`
    for (let i = 1; i < segments.length; i++) {
      rawExpr = sql<boolean>`${rawExpr}${params[paramIdx++]}${sql.raw(segments[i])}`
    }
    return query.where(rawExpr)
  }

  private applySingleSearchToken(query: VariantQueryBuilder, token: string): VariantQueryBuilder {
    // Move body verbatim (lines 705-716)
    const hgvsPattern = /^[cp]\./
    if (hgvsPattern.test(token)) {
      return query.where(({ or, eb }) =>
        or([eb('cdna', 'like', `%${token}%`), eb('aa_change', 'like', `%${token}%`)])
      )
    }
    const ftsQuery = `"${token.replace(/"/g, '""')}"*`
    return query.where(
      sql<boolean>`id IN (SELECT rowid FROM variants_fts WHERE variants_fts MATCH ${ftsQuery})`
    )
  }

  searchVariants(caseId: number, query: string, limit: number = 50): Variant[] {
    // Move body verbatim (lines 843-857)
    const ftsQuery = `"${query.replace(/"/g, '""')}"*`
    return this.db
      .prepare(
        `SELECT v.* FROM variants v
         JOIN variants_fts fts ON v.id = fts.rowid
         WHERE v.case_id = ? AND variants_fts MATCH ?
         ORDER BY bm25(variants_fts) LIMIT ?`
      )
      .all(caseId, ftsQuery, limit) as Variant[]
  }

  getGeneSymbols(caseId: number, query: string, limit: number = 50): string[] {
    // Move body verbatim (lines 859-872)
    const results = this.kysely
      .selectFrom('variants')
      .select('gene_symbol')
      .distinct()
      .where('case_id', '=', caseId)
      .where('gene_symbol', 'like', `%${query}%`)
      .where('gene_symbol', 'is not', null)
      .orderBy('gene_symbol')
      .limit(limit)
      .compile()

    return (
      this.db.prepare(results.sql).all(...results.parameters) as { gene_symbol: string }[]
    ).map((r) => r.gene_symbol)
  }
}
```

- [ ] **Step 5: Extract VariantFrequencyService**

Create `src/main/database/VariantFrequencyService.ts`. Extract `updateFrequencies()`, `decrementFrequencies()`, `recomputeAllFrequencies()`:

```typescript
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'

export class VariantFrequencyService {
  constructor(private readonly db: DatabaseType) {}

  /**
   * Update variant_frequency counts for all variants in a case.
   * Called after import to increment shared variant counts.
   */
  updateFrequencies(caseId: number): void {
    this.db
      .prepare(
        `INSERT INTO variant_frequency (chr, pos, ref, alt, case_count)
         SELECT DISTINCT chr, pos, ref, alt, 1
         FROM variants WHERE case_id = ?
         ON CONFLICT(chr, pos, ref, alt)
         DO UPDATE SET case_count = case_count + 1`
      )
      .run(caseId)
  }

  /**
   * Decrement variant_frequency counts for all variants in a case.
   * Called before case deletion. Removes rows where count reaches 0.
   */
  decrementFrequencies(caseId: number): void {
    this.db
      .prepare(
        `UPDATE variant_frequency
         SET case_count = case_count - 1
         WHERE (chr, pos, ref, alt) IN (
           SELECT DISTINCT chr, pos, ref, alt FROM variants WHERE case_id = ?
         )`
      )
      .run(caseId)
    this.db.exec('DELETE FROM variant_frequency WHERE case_count <= 0')
  }

  /**
   * Recompute all variant_frequency counts from scratch.
   * Used after bulk deletion operations where incremental updates aren't possible.
   */
  recomputeAllFrequencies(): void {
    this.db.exec('DELETE FROM variant_frequency')
    this.db.exec(`
      INSERT INTO variant_frequency (chr, pos, ref, alt, case_count)
      SELECT chr, pos, ref, alt, COUNT(DISTINCT case_id)
      FROM variants GROUP BY chr, pos, ref, alt
    `)
  }
}
```

- [ ] **Step 6: Update VariantRepository to delegate to extracted modules**

In `src/main/database/VariantRepository.ts`:

1. Remove the extracted code (private methods `buildVariantQuery`, `applySearchFilter`, `applySingleSearchToken`, `applySort`, and public methods `searchVariants`, `getGeneSymbols`, `updateFrequencies`, `decrementFrequencies`, `recomputeAllFrequencies`)
2. Remove the `SORTABLE_COLUMNS`, `NUMERIC_COLUMNS` constants (moved to VariantFilterBuilder)
3. Remove the `VariantQueryBuilder` type alias (moved to VariantFilterBuilder)
4. Add imports and delegate:

```typescript
import { VariantFilterBuilder, type VariantQueryBuilder } from './VariantFilterBuilder'
import { VariantSearchService } from './VariantSearchService'
import { VariantFrequencyService } from './VariantFrequencyService'

export class VariantRepository extends BaseRepository {
  private cases: CaseRepository
  private filterBuilder: VariantFilterBuilder
  private searchService: VariantSearchService
  private frequencyService: VariantFrequencyService

  constructor(db: DatabaseType, kysely: Kysely<VarlensDatabase>, cases: CaseRepository) {
    super(db, kysely)
    this.cases = cases
    this.filterBuilder = new VariantFilterBuilder(db, kysely)
    this.searchService = new VariantSearchService(db, kysely)
    this.frequencyService = new VariantFrequencyService(db)
  }

  // In getVariants(), replace:
  //   const countQuery = this.buildVariantQuery(filter)
  // with:
  //   const countQuery = this.filterBuilder.build(filter)
  //
  //   const sortedQuery = this.applySort(dataQuery, sortBy)
  // with:
  //   const sortedQuery = this.filterBuilder.applySort(dataQuery, sortBy)
  //
  // Delegate search:
  searchVariants(caseId: number, query: string, limit: number = 50): Variant[] {
    return this.searchService.searchVariants(caseId, query, limit)
  }

  getGeneSymbols(caseId: number, query: string, limit: number = 50): string[] {
    return this.searchService.getGeneSymbols(caseId, query, limit)
  }

  // Delegate frequency:
  updateFrequencies(caseId: number): void {
    this.frequencyService.updateFrequencies(caseId)
  }

  decrementFrequencies(caseId: number): void {
    this.frequencyService.decrementFrequencies(caseId)
  }

  recomputeAllFrequencies(): void {
    this.frequencyService.recomputeAllFrequencies()
  }
}
```

The `buildVariantQuery` call in `getAllVariantsForExport`, `getVariants`, `getFilteredCount`, and `compileExportQuery` all change from `this.buildVariantQuery(filter)` to `this.filterBuilder.build(filter)`.

The `applySort` call changes from `this.applySort(...)` to `this.filterBuilder.applySort(...)`.

The search filter calls inside `buildVariantQuery` (now in `VariantFilterBuilder.build()`) should use `this.searchService.applySearchFilter()` — pass the search service to the filter builder constructor:

```typescript
export class VariantFilterBuilder {
  constructor(
    private readonly db: DatabaseType,
    private readonly kysely: Kysely<VarlensDatabase>,
    private readonly searchService?: VariantSearchService
  ) {}

  // Inside build(), where search is applied:
  if (filter.search_query) {
    if (this.searchService) {
      query = this.searchService.applySearchFilter(query, filter.search_query)
    }
  }
}
```

Update the VariantRepository constructor to pass the search service:

```typescript
this.searchService = new VariantSearchService(db, kysely)
this.filterBuilder = new VariantFilterBuilder(db, kysely, this.searchService)
```

- [ ] **Step 7: Run test for VariantFilterBuilder**

Run: `npm run test -- --run tests/main/database/variant-filter-builder.test.ts`
Expected: PASS

- [ ] **Step 8: Write test for VariantSearchService**

Create `tests/main/database/variant-search-service.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { Kysely, SqliteDialect } from 'kysely'
import type { VarlensDatabase } from '../../../src/shared/types/database-schema'
import { VariantSearchService } from '../../../src/main/database/VariantSearchService'

describe('VariantSearchService', () => {
  let db: InstanceType<typeof Database>
  let kysely: Kysely<VarlensDatabase>
  let service: VariantSearchService

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE cases (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE variants (
        id INTEGER PRIMARY KEY, case_id INTEGER, chr TEXT, pos INTEGER,
        ref TEXT, alt TEXT, gene_symbol TEXT, omim_mim_number TEXT,
        consequence TEXT, gnomad_af REAL, cadd REAL, clinvar TEXT,
        gt_num TEXT, func TEXT, qual REAL, hpo_sim_score REAL,
        transcript TEXT, cdna TEXT, aa_change TEXT, moi TEXT,
        gq REAL, dp INTEGER, ad_ref INTEGER, ad_alt INTEGER, ab REAL,
        filter TEXT, info_json TEXT, source_format TEXT
      );
      CREATE VIRTUAL TABLE variants_fts USING fts5(
        gene_symbol, transcript, func, consequence, cdna, aa_change, clinvar,
        content=variants, content_rowid=id
      );
      INSERT INTO cases (id, name) VALUES (1, 'test');
      INSERT INTO variants (id, case_id, chr, pos, ref, alt, gene_symbol, func)
        VALUES (1, 1, 'chr1', 100, 'A', 'T', 'BRCA1', 'missense_variant');
      INSERT INTO variants (id, case_id, chr, pos, ref, alt, gene_symbol, func)
        VALUES (2, 1, 'chr1', 200, 'G', 'C', 'TP53', 'synonymous_variant');
      INSERT INTO variants_fts (rowid, gene_symbol, func) VALUES (1, 'BRCA1', 'missense_variant');
      INSERT INTO variants_fts (rowid, gene_symbol, func) VALUES (2, 'TP53', 'synonymous_variant');
    `)
    kysely = new Kysely<VarlensDatabase>({
      dialect: new SqliteDialect({ database: db })
    })
    service = new VariantSearchService(db, kysely)
  })

  afterEach(() => {
    kysely.destroy()
    db.close()
  })

  it('getGeneSymbols returns matching gene symbols', () => {
    const results = service.getGeneSymbols(1, 'BRC')
    expect(results).toEqual(['BRCA1'])
  })

  it('getGeneSymbols returns empty array for no matches', () => {
    const results = service.getGeneSymbols(1, 'NONEXISTENT')
    expect(results).toEqual([])
  })

  it('searchVariants returns FTS5 matches', () => {
    const results = service.searchVariants(1, 'BRCA1')
    expect(results).toHaveLength(1)
    expect(results[0].gene_symbol).toBe('BRCA1')
  })
})
```

- [ ] **Step 9: Run all new tests**

Run: `npm run test -- --run tests/main/database/variant-filter-builder.test.ts tests/main/database/variant-search-service.test.ts`
Expected: PASS

- [ ] **Step 10: Run full test suite**

Run: `npm run test -- --run`
Expected: All tests pass

- [ ] **Step 11: Run typecheck**

Run: `npx vue-tsc --noEmit 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add src/main/database/VariantFilterBuilder.ts \
  src/main/database/VariantSearchService.ts \
  src/main/database/VariantFrequencyService.ts \
  src/main/database/VariantRepository.ts \
  tests/main/database/variant-filter-builder.test.ts \
  tests/main/database/variant-search-service.test.ts
git commit -m "refactor: decompose VariantRepository into focused modules"
```

---

## Task 6: Audit Empty Catch Blocks — Renderer (Finding 3.3)

**Files:**
- Modify: ~25 renderer files (36 total catches across 25 files)

- [ ] **Step 1: Add logging to renderer empty catch blocks**

For each renderer file with empty catches, add `logService.warn()` or `logService.error()` as appropriate. Files to audit:

- `src/renderer/src/stores/authStore.ts` (1 catch)
- `src/renderer/src/stores/externalLinksStore.ts` (1 catch)
- `src/renderer/src/stores/settingsStore.ts` (1 catch)
- `src/renderer/src/composables/useCohortData.ts` (1 catch)
- `src/renderer/src/composables/useOffsetPagination.ts` (1 catch)
- `src/renderer/src/composables/useAnnotations.ts` (2 catches)
- `src/renderer/src/composables/useMolstarViewer.ts` (2 catches)
- `src/renderer/src/composables/useFilterState.ts` (1 catch)
- `src/renderer/src/utils/acmg/acmg-serialization.ts` (1 catch)
- `src/renderer/src/components/UserManagement.vue` (1 catch)
- `src/renderer/src/components/ActivityLogPanel.vue` (1 catch)
- `src/renderer/src/components/case-data-info/RegionFileImportDialog.vue` (2 catches)
- `src/renderer/src/components/ExternalLinksSection.vue` (1 catch)
- `src/renderer/src/components/case-data-info/GeneListEditorDialog.vue` (2 catches)
- `src/renderer/src/components/TagManagementDialog.vue` (1 catch)
- `src/renderer/src/components/FilterToolbar.vue` (1 catch)
- `src/renderer/src/components/CaseList.vue` (2 catches)
- `src/renderer/src/components/association/GeneBurdenView.vue` (1 catch)
- `src/renderer/src/components/CaseDataInfoTab.vue` (4 catches)
- `src/renderer/src/components/cohort/CohortFilterBar.vue` (2 catches)
- `src/renderer/src/components/panels/PanelManagerDialog.vue` (2 catches)
- `src/renderer/src/components/LoginView.vue` (2 catches)
- `src/renderer/src/components/cohort/CohortDataTable.vue` (1 catch)
- `src/renderer/src/components/ApplicationPreferences.vue` (1 catch)

Skip `src/renderer/public/pdbe-molstar-component.js` — third-party vendored file.

For each catch, read surrounding context and add:

```typescript
// For composables/stores:
catch (e) {
  logService.warn('Context description: ' + (e instanceof Error ? e.message : String(e)), 'source')
}

// For components where user should see feedback (form submissions, API calls):
catch (e) {
  logService.error('Context description: ' + (e instanceof Error ? e.message : String(e)), 'source')
}
```

Files that already import `logService` can use it directly. Files that don't will need:
```typescript
import { logService } from '../../services/LogService'
// or for deeper nesting:
import { logService } from '../../../services/LogService'
```

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `npm run test -- --run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/renderer/
git commit -m "fix: add logging to empty catch blocks in renderer"
```

---

## Task 7: Remove Remaining `(api as any)` Casts in useFilterState (Finding 3.1 continuation)

**Depends on:** Task 1 (VariantsAPI now has `geneSymbols`)

**Files:**
- Modify: `src/renderer/src/composables/useFilterState.ts:493-494, 574-575, 651-652`

- [ ] **Step 1: Remove (api as any) casts**

In `src/renderer/src/composables/useFilterState.ts`, there are 3 occurrences of `(api as any)`:

Line 494 (`searchGeneSymbols`):
```typescript
// Before:
const results: string[] = await (api as any).variants.geneSymbols(caseIdRef.value, query, 50)

// After:
const results: string[] = await api!.variants.geneSymbols(caseIdRef.value, query, 50)
```

Line 575 (`loadFilterOptions`):
```typescript
// Before:
const options = await (api as any).variants.getFilterOptions(caseId)

// After:
const options = await api!.variants.getFilterOptions(caseId)
```

Line 652 (`loadFilterOptionsAndTags`):
```typescript
// Before:
(api as any).variants.getFilterOptions(caseId),

// After:
api!.variants.getFilterOptions(caseId),
```

Also remove the `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comments above each of these lines.

- [ ] **Step 2: Run typecheck**

Run: `npx vue-tsc --noEmit 2>&1 | tail -20`
Expected: PASS — `geneSymbols` and `getFilterOptions` are now in the `VariantsAPI` type

- [ ] **Step 3: Run full test suite**

Run: `npm run test -- --run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/composables/useFilterState.ts
git commit -m "refactor: remove (api as any) casts in useFilterState"
```

---

## Verification

After all tasks complete:

1. `npm run lint` — PASS
2. `npx vue-tsc --noEmit` — PASS
3. `npm run test -- --run` — all tests PASS
4. `grep -r '(window as any)' src/renderer/ --include='*.vue' --include='*.ts'` — only in files not touched by this PR (if any remain, they are separate scope)
5. `wc -l src/main/database/VariantRepository.ts` — should be ~500-600 lines (down from 1102)
6. `grep -r 'catch {' src/main/ src/renderer/ --include='*.ts' --include='*.vue' | grep -v node_modules | grep -v '.planning'` — no silent catches remain (except intentional ones with comments)
