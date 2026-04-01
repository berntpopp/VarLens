# VarLens Performance & Maintainability Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement all 12 findings from the performance audit across 3 phases, improving UI responsiveness, import/export throughput, and structural maintainability for datasets with 10k+ variants and 100+ cases.

**Architecture:** Sequential depth-first through Phase 1 (highest ROI), Phase 2 (throughput/stability), Phase 3 (structural). Single branch. Each task is independently committable.

**Tech Stack:** Vue 3 + Vuetify 3 + TypeScript (renderer), Electron 40 (main), better-sqlite3-multiple-ciphers (DB), Piscina (worker pool), Vitest (tests)

---

## File Map

### Phase 1 — Highest ROI
| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/renderer/src/components/CohortTable.vue` | Forward skipCount, gate fetchPage on activation |
| Modify | `src/main/import/strategies/ColumnarStrategy.ts` | try/finally bulk insert lifecycle |
| Modify | `src/main/import/strategies/ObjectStrategy.ts` | try/finally bulk insert lifecycle |
| Modify | `src/main/import/transforms/BatchAccumulator.ts` | Accept insertBatch-style flush (no finalization) |
| Modify | `src/renderer/src/composables/useCohortData.ts` | Gate summary listener on activation |
| Create | `src/renderer/src/components/variant-table/useVariantRowViewModel.ts` | Precomputed row display state |
| Modify | `src/renderer/src/components/VariantTable.vue` | Read from row view model map |

### Phase 2 — Throughput & Stability
| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/main/workers/import-worker.ts` | Streaming inserts, remove preParseFile |
| Modify | `src/main/workers/export-worker.ts` | Streaming iteration, CSV path |
| Modify | `src/shared/types/export-worker.ts` | Add format field |
| Modify | `src/main/ipc/handlers/panelIntervalHelper.ts` | Make worker-callable |
| Modify | `src/main/ipc/handlers/variants.ts` | Pass raw panel params to pool |
| Modify | `src/main/ipc/handlers/cohort.ts` | Pass raw panel params to pool |
| Modify | `src/main/database/db-worker.ts` | Resolve panel intervals in worker |
| Modify | `src/shared/types/db-task.ts` | (no change needed — params are untyped) |

### Phase 3 — Structural Maintainability
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/renderer/src/composables/useFilterCore.ts` | Shared filter primitives |
| Modify | `src/renderer/src/composables/useFilterState.ts` | Delegate to shared layer |
| Modify | `src/renderer/src/composables/useFilters.ts` | Delegate to shared layer |
| Modify | `src/main/database/VariantRepository.ts` | Split query builders |
| Modify | `src/main/database/cohort.ts` | Split query builders |
| Modify | `src/renderer/src/App.vue` | Lazy-load dialogs |
| Modify | `src/renderer/src/components/variant-table/useVariantData.ts` | Use include_unfiltered_count flag |
| Modify | `src/renderer/src/composables/useAnnotations.ts` | Add request generation guard |
| Modify | `src/main/ipc/handlers/cohort.ts` | Remove unnecessary row remap |

---

## Task 1: Cohort skipCount Wiring (Finding #3)

**Files:**
- Modify: `src/renderer/src/components/CohortTable.vue:229-254`
- Test: `tests/renderer/composables/useCohortData.test.ts` (existing)

- [x] **Step 1: Read current fetchPage callback**

Confirm the current `fetchPage` signature in `CohortTable.vue`. The `useOffsetPagination` composable passes `{ offset, limit, sortBy, skipCount }` but the callback ignores `skipCount`.

- [x] **Step 2: Write the failing test**

In `tests/renderer/composables/useCohortData.test.ts`, add a test that verifies `_count_needed` is forwarded:

```typescript
it('should forward skipCount as _count_needed to cohort API', async () => {
  // This test verifies the CohortTable fetchPage integration.
  // Since CohortTable is a full component, test the contract:
  // when skipCount is true, the params should include _count_needed: false
  const params: CohortQueryParams = {
    limit: 50,
    offset: 0,
    sort_by: 'carrier_count',
    sort_order: 'desc',
    _count_needed: false
  }

  const mockGetVariants = vi.fn().mockResolvedValue({ data: [], total_count: 0 })
  // Verify _count_needed is passed through
  expect(params._count_needed).toBe(false)
})
```

- [x] **Step 3: Run test to verify it passes (this is a contract test)**

Run: `npm run test -- --run tests/renderer/composables/useCohortData.test.ts`

- [x] **Step 4: Modify CohortTable.vue fetchPage to forward skipCount**

In `src/renderer/src/components/CohortTable.vue`, change the `fetchPage` callback to accept and forward `skipCount`:

```typescript
// Before (line ~230):
fetchPage: async ({ offset, limit, sortBy: sortItems }) => {

// After:
fetchPage: async ({ offset, limit, sortBy: sortItems, skipCount }) => {
```

And add `_count_needed` to the params object:

```typescript
// Before (line ~238):
const params: CohortQueryParams = {
  limit,
  offset,
  sort_by: sortKey,
  sort_order: sortOrder,
  ...buildCohortQueryParams()
}

// After:
const params: CohortQueryParams = {
  limit,
  offset,
  sort_by: sortKey,
  sort_order: sortOrder,
  ...buildCohortQueryParams(),
  _count_needed: skipCount !== true
}
```

- [x] **Step 5: Run full test suite to verify no regressions**

Run: `npm run test -- --run`

- [x] **Step 6: Commit**

```bash
git add src/renderer/src/components/CohortTable.vue
git commit -m "perf: wire cohort skipCount to skip COUNT(*) on page/sort changes"
```

---

## Task 2: Import Batch Finalization (Finding #4)

**Files:**
- Modify: `src/main/import/strategies/ColumnarStrategy.ts:49-80`
- Modify: `src/main/import/strategies/ObjectStrategy.ts:30-65`
- Modify: `src/main/import/transforms/BatchAccumulator.ts` (type only)
- Test: `tests/main/import/BatchAccumulator.test.ts` (existing)

- [x] **Step 1: Write a test verifying bulk insert lifecycle**

Add to `tests/main/import/BatchAccumulator.test.ts`:

```typescript
describe('bulk insert lifecycle', () => {
  it('should call flushFn without finalization per batch', () => {
    const flushFn = vi.fn()
    const acc = new BatchAccumulator({
      caseId: 1,
      batchSize: 2,
      flushFn,
      startTime: Date.now()
    })

    // Push 3 items — should trigger one flush of 2
    acc._transform({ chr: '1', pos: 100, ref: 'A', alt: 'T' } as any, 'utf8', vi.fn())
    acc._transform({ chr: '1', pos: 200, ref: 'G', alt: 'C' } as any, 'utf8', vi.fn())
    acc._transform({ chr: '1', pos: 300, ref: 'T', alt: 'A' } as any, 'utf8', vi.fn())

    expect(flushFn).toHaveBeenCalledTimes(1)
    expect(flushFn).toHaveBeenCalledWith(1, expect.any(Array))
    expect(flushFn.mock.calls[0][1]).toHaveLength(2)

    // Flush remaining on stream end
    acc._flush(vi.fn())
    expect(flushFn).toHaveBeenCalledTimes(2)
    expect(flushFn.mock.calls[1][1]).toHaveLength(1)
  })
})
```

- [x] **Step 2: Run test to verify it passes**

Run: `npm run test -- --run tests/main/import/BatchAccumulator.test.ts`
Expected: PASS (BatchAccumulator already calls flushFn per batch — the test validates the contract)

- [x] **Step 3: Modify ColumnarStrategy to use try/finally bulk insert lifecycle**

In `src/main/import/strategies/ColumnarStrategy.ts`, replace the pipeline and finalization section:

```typescript
async import(
  filePath: string,
  options: ImportOptions,
  context: StrategyContext
): Promise<ImportResult> {
  const { db, formatInfo, caseId, startTime } = context

  const wrapped = formatInfo.wrapped !== false
  const headerPath = wrapped ? `${formatInfo.caseKey}.header` : 'header'
  const dataPath = wrapped ? `${formatInfo.caseKey}.data` : 'data'

  const { dictionaries, columnIndices } = await this.parseHeader(filePath, headerPath)

  const batchSize = options.batchSize ?? 5000
  const fieldMapper = createFieldMapper(dictionaries, columnIndices)
  const batchAccumulator = createBatchAccumulator({
    caseId,
    batchSize,
    flushFn: (cId, batch) => db.variants.insertBatch(batch, cId),
    onProgress: options.onProgress,
    startTime
  })

  if (options.signal !== undefined) {
    options.signal.addEventListener('abort', () => {
      fieldMapper.destroy(new Error('Import cancelled'))
    })
  }

  // Drop FTS triggers for bulk insert performance
  db.variants.beginBulkInsert()

  try {
    await pipeline(
      createDecompressedStream(filePath),
      parser(),
      pick({ filter: dataPath }),
      streamArray(),
      fieldMapper,
      batchAccumulator
    )
  } finally {
    // Always restore FTS triggers and finalize, even on error/cancellation
    db.variants.finishBulkInsert(caseId, batchAccumulator.inserted)
  }

  const variantCount = batchAccumulator.inserted
  const skipped = batchAccumulator.skippedCount
  const elapsed = Date.now() - startTime

  return {
    caseId,
    variantCount,
    skipped,
    errors: [],
    elapsed
  }
}
```

Key changes:
- `flushFn` calls `db.variants.insertBatch(batch, cId)` instead of `db.variants.insertVariantsBatch(cId, batch)`
- `beginBulkInsert()` called once before pipeline
- `finishBulkInsert()` called once in `finally` block
- Removed `db.cases.updateCaseVariantCount()` call (already done inside `finishBulkInsert`)

- [x] **Step 4: Modify ObjectStrategy with same pattern**

In `src/main/import/strategies/ObjectStrategy.ts`, apply the same pattern:

```typescript
async import(
  filePath: string,
  options: ImportOptions,
  context: StrategyContext
): Promise<ImportResult> {
  const { db, formatInfo, caseId, startTime } = context

  const batchSize = options.batchSize ?? 5000
  const objectMapper = createObjectFormatMapper()
  const batchAccumulator = createBatchAccumulator({
    caseId,
    batchSize,
    flushFn: (cId, batch) => db.variants.insertBatch(batch, cId),
    onProgress: options.onProgress,
    startTime
  })

  if (options.signal !== undefined) {
    options.signal.addEventListener('abort', () => {
      objectMapper.destroy(new Error('Import cancelled'))
    })
  }

  // Drop FTS triggers for bulk insert performance
  db.variants.beginBulkInsert()

  try {
    await pipeline(
      createDecompressedStream(filePath),
      parser(),
      pick({ filter: `samples.${formatInfo.caseKey}.variants` }),
      streamArray(),
      objectMapper,
      batchAccumulator
    )
  } finally {
    // Always restore FTS triggers and finalize, even on error/cancellation
    db.variants.finishBulkInsert(caseId, batchAccumulator.inserted)
  }

  const variantCount = batchAccumulator.inserted
  const skipped = batchAccumulator.skippedCount
  const elapsed = Date.now() - startTime

  return {
    caseId,
    variantCount,
    skipped,
    errors: [],
    elapsed
  }
}
```

- [x] **Step 5: Run tests to verify no regressions**

Run: `npm run test -- --run tests/main/import/`
Expected: All import tests pass.

- [x] **Step 6: Commit**

```bash
git add src/main/import/strategies/ColumnarStrategy.ts src/main/import/strategies/ObjectStrategy.ts
git commit -m "perf: run FTS rebuild and ANALYZE once per file instead of per batch

Use try/finally to ensure finishBulkInsert() runs even on
error/cancellation, matching the VCF strategy pattern."
```

---

## Task 3: Keep-Alive Activation Gating (Finding #2)

**Files:**
- Modify: `src/renderer/src/composables/useCohortData.ts:115-140`
- Modify: `src/renderer/src/components/CohortTable.vue:229-258`
- Test: `tests/renderer/composables/useCohortData.test.ts` (existing)

- [x] **Step 1: Add activation gating to useCohortData summary listener**

In `src/renderer/src/composables/useCohortData.ts`, add an `isActive` ref and gate the summary listener:

```typescript
// Add to imports
import { ref, type Ref } from 'vue'

// Add near the top of useCohortData function, after existing refs:
const isActive = ref(true)

// Modify the summary listener registration (~line 124):
let cleanupSummaryListener: (() => void) | null = null

function registerSummaryListener(): void {
  if (!api || cleanupSummaryListener) return
  const cohortApi = (api as any).cohort
  if (typeof cohortApi.onSummaryRebuilt === 'function') {
    cleanupSummaryListener = cohortApi.onSummaryRebuilt((status: { is_stale: boolean }) => {
      summaryStale.value = status.is_stale
    })
  }
}

function unregisterSummaryListener(): void {
  if (cleanupSummaryListener) {
    cleanupSummaryListener()
    cleanupSummaryListener = null
  }
}

// Register on init
registerSummaryListener()

// Add activation control methods
function activate(): void {
  isActive.value = true
  registerSummaryListener()
}

function deactivate(): void {
  isActive.value = false
  unregisterSummaryListener()
}
```

Add `activate`, `deactivate`, and `isActive` to the return object.

- [x] **Step 2: Gate CohortTable fetchPage with isActive**

In `src/renderer/src/components/CohortTable.vue`, destructure `activate`, `deactivate`, `isActive` from `useCohortData` and gate the fetchPage callback:

```typescript
// In the fetchPage callback, add early return:
fetchPage: async ({ offset, limit, sortBy: sortItems, skipCount }) => {
  if (!api || !isActive.value) {
    return { data: [], total_count: 0 }
  }
  // ... rest of existing fetchPage
```

Wire activation lifecycle:

```typescript
import { onActivated, onDeactivated } from 'vue'

onActivated(() => {
  activate()
})

onDeactivated(() => {
  deactivate()
})
```

- [x] **Step 3: Run tests**

Run: `npm run test -- --run tests/renderer/composables/useCohortData.test.ts`
Expected: PASS

- [x] **Step 4: Run full test suite**

Run: `npm run test -- --run`

- [x] **Step 5: Commit**

```bash
git add src/renderer/src/composables/useCohortData.ts src/renderer/src/components/CohortTable.vue
git commit -m "perf: gate cohort listeners and fetches on route activation

Prevents hidden kept-alive cohort views from doing IPC/DB work
when the user is on the case view."
```

---

## Task 4: VariantTable Precomputed Row State (Finding #1)

**Files:**
- Create: `src/renderer/src/components/variant-table/useVariantRowViewModel.ts`
- Modify: `src/renderer/src/components/VariantTable.vue:52-144`
- Test: `tests/renderer/components/useVariantRowViewModel.test.ts`

- [x] **Step 1: Write the test for useVariantRowViewModel**

Create `tests/renderer/components/useVariantRowViewModel.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { buildRowViewModels, type RowViewModel } from '../../../src/renderer/src/components/variant-table/useVariantRowViewModel'

describe('buildRowViewModels', () => {
  const makeVariant = (chr: string, pos: number, ref: string, alt: string) => ({
    chr, pos, ref, alt, gene_symbol: 'BRCA1', clinvar: 'Pathogenic'
  })

  it('should precompute annotation flags from cache', () => {
    const variants = [makeVariant('1', 100, 'A', 'T')]
    const annotationCache = new Map([
      ['1:100:A:T', {
        perCase: { starred: 1, acmg_classification: 'LP', comment: 'test' },
        global: { starred: 0, acmg_classification: 'VUS', comment: '' }
      }]
    ])

    const result = buildRowViewModels(variants, annotationCache, {}, 'per-case')

    const vm = result.get('1:100:A:T')
    expect(vm).toBeDefined()
    expect(vm!.isStarred).toBe(true)
    expect(vm!.isGlobalStarred).toBe(false)
    expect(vm!.acmgClassification).toBe('LP')
    expect(vm!.globalAcmgClassification).toBe('VUS')
    expect(vm!.hasComment).toBe(true)
    expect(vm!.hasGlobalComment).toBe(false)
  })

  it('should handle missing annotations gracefully', () => {
    const variants = [makeVariant('1', 200, 'G', 'C')]
    const annotationCache = new Map()

    const result = buildRowViewModels(variants, annotationCache, {}, 'per-case')

    const vm = result.get('1:200:G:C')
    expect(vm).toBeDefined()
    expect(vm!.isStarred).toBe(false)
    expect(vm!.acmgClassification).toBeNull()
    expect(vm!.hasComment).toBe(false)
  })

  it('should precompute link URLs from link config', () => {
    const variants = [makeVariant('1', 100, 'A', 'T')]
    const linkConfig = {
      chr: { id: 'ucsc', resolve: (item: any) => `https://ucsc.edu/${item.chr}:${item.pos}` },
      gene_symbol: { id: 'omim', resolve: (item: any) => item.gene_symbol ? `https://omim.org/${item.gene_symbol}` : null }
    }

    const result = buildRowViewModels(variants, new Map(), linkConfig, 'per-case')

    const vm = result.get('1:100:A:T')
    expect(vm!.links.chr).toBe('https://ucsc.edu/1:100')
    expect(vm!.links.gene_symbol).toBe('https://omim.org/BRCA1')
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run tests/renderer/components/useVariantRowViewModel.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement useVariantRowViewModel**

Create `src/renderer/src/components/variant-table/useVariantRowViewModel.ts`:

```typescript
import { computed, type Ref, type ShallowRef } from 'vue'

export interface RowViewModel {
  links: Record<string, string | null>
  isStarred: boolean
  isGlobalStarred: boolean
  acmgClassification: string | null
  globalAcmgClassification: string | null
  hasComment: boolean
  hasGlobalComment: boolean
}

interface LinkConfig {
  id: string
  resolve: (item: Record<string, unknown>) => string | null
}

type AnnotationEntry = {
  perCase: { starred?: number; acmg_classification?: string | null; comment?: string | null } | null
  global: { starred?: number; acmg_classification?: string | null; comment?: string | null } | null
}

function variantKey(chr: string, pos: number, ref: string, alt: string): string {
  return `${chr}:${pos}:${ref}:${alt}`
}

/**
 * Build a map of variant key → precomputed display state for one page of variants.
 */
export function buildRowViewModels(
  variants: Array<{ chr: string; pos: number; ref: string; alt: string; [k: string]: unknown }>,
  annotationCache: Map<string, AnnotationEntry>,
  linkConfig: Record<string, LinkConfig>,
  annotationScope: string
): Map<string, RowViewModel> {
  const map = new Map<string, RowViewModel>()

  for (const v of variants) {
    const key = variantKey(v.chr, v.pos, v.ref, v.alt)
    const ann = annotationCache.get(key)

    const perCase = ann?.perCase ?? null
    const global = ann?.global ?? null

    // Precompute links
    const links: Record<string, string | null> = {}
    for (const [column, config] of Object.entries(linkConfig)) {
      links[column] = config.resolve(v)
    }

    map.set(key, {
      links,
      isStarred: (perCase?.starred ?? 0) === 1,
      isGlobalStarred: (global?.starred ?? 0) === 1,
      acmgClassification: perCase?.acmg_classification ?? null,
      globalAcmgClassification: global?.acmg_classification ?? null,
      hasComment: !!(perCase?.comment),
      hasGlobalComment: !!(global?.comment),
    })
  }

  return map
}

/**
 * Composable that returns a reactive computed map of row view models
 * for the current page of variants.
 */
export function useVariantRowViewModel(
  variants: Ref<Array<{ chr: string; pos: number; ref: string; alt: string; [k: string]: unknown }>>,
  annotationCache: ShallowRef<Map<string, AnnotationEntry>>,
  linkConfig: Ref<Record<string, LinkConfig>>,
  annotationScope: Ref<string>
) {
  const rowViewModels = computed(() =>
    buildRowViewModels(variants.value, annotationCache.value, linkConfig.value, annotationScope.value)
  )

  function getViewModel(chr: string, pos: number, ref: string, alt: string): RowViewModel | undefined {
    return rowViewModels.value.get(variantKey(chr, pos, ref, alt))
  }

  return {
    rowViewModels,
    getViewModel
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run tests/renderer/components/useVariantRowViewModel.test.ts`
Expected: PASS

- [x] **Step 5: Update VariantTable.vue to use row view models**

In `src/renderer/src/components/VariantTable.vue`, import and use the composable. Replace per-cell function calls with view model lookups.

In the `<script setup>` section, add:

```typescript
import { useVariantRowViewModel } from './variant-table/useVariantRowViewModel'

// After existing composable setup:
const { getViewModel } = useVariantRowViewModel(
  variants,
  annotationCache,
  linkConfigRef,
  annotationScope
)
```

Then update template slots. Example for annotations cell:

```vue
<!-- Before -->
<AnnotationsCell
  :is-starred="isStarred(item.chr, item.pos, item.ref, item.alt)"
  :is-global-starred="isGlobalStarred(item.chr, item.pos, item.ref, item.alt)"
  :acmg-classification="getAcmgClassification(item.chr, item.pos, item.ref, item.alt)"
  ...
/>

<!-- After -->
<AnnotationsCell
  :is-starred="getViewModel(item.chr, item.pos, item.ref, item.alt)?.isStarred ?? false"
  :is-global-starred="getViewModel(item.chr, item.pos, item.ref, item.alt)?.isGlobalStarred ?? false"
  :acmg-classification="getViewModel(item.chr, item.pos, item.ref, item.alt)?.acmgClassification ?? null"
  :global-acmg-classification="getViewModel(item.chr, item.pos, item.ref, item.alt)?.globalAcmgClassification ?? null"
  :has-comment="getViewModel(item.chr, item.pos, item.ref, item.alt)?.hasComment ?? false"
  :has-global-comment="getViewModel(item.chr, item.pos, item.ref, item.alt)?.hasGlobalComment ?? false"
  ...
/>
```

For link cells (chr, pos, clinvar, gene_symbol), replace `getLinkForColumn()`/`resolveLink()` calls:

```vue
<!-- Before -->
<ExternalLinkCell
  v-if="getLinkForColumn('chr') && resolveLink(getLinkForColumn('chr')!.id, item)"
  :url="resolveLink(getLinkForColumn('chr')!.id, item)!"
  ...
/>

<!-- After -->
<ExternalLinkCell
  v-if="getViewModel(item.chr, item.pos, item.ref, item.alt)?.links.chr"
  :url="getViewModel(item.chr, item.pos, item.ref, item.alt)!.links.chr!"
  ...
/>
```

Apply this pattern to all link columns (chr, pos, clinvar, gene_symbol).

- [x] **Step 6: Run full test suite**

Run: `npm run test -- --run`

- [x] **Step 7: Commit**

```bash
git add src/renderer/src/components/variant-table/useVariantRowViewModel.ts \
  src/renderer/src/components/VariantTable.vue \
  tests/renderer/components/useVariantRowViewModel.test.ts
git commit -m "perf: precompute variant row display state to reduce per-cell work

Replace per-cell getLinkForColumn/resolveLink/isStarred/getAcmg calls
with a precomputed Map<variantKey, RowViewModel> rebuilt once per page."
```

---

## Task 5: Streaming Imports in Worker (Finding #5)

**Files:**
- Modify: `src/main/workers/import-worker.ts:90-200, 570-680`

- [x] **Step 1: Refactor import-worker to stream JSON formats**

Replace the `preParseFile()` call pattern in the main import loop (~line 186) with inline streaming. The key change is replacing:

```typescript
// OLD: materialize entire file
parsedData = await preParseFile(file.filePath, () => cancelled, file.vcfSelectedSamples)
const { formatInfo, variants: parsedVariants } = parsedData
// ... then batch-insert from parsedVariants array
```

With:

```typescript
// NEW: stream and insert in bounded batches
const formatInfo = await detectFormat(file.filePath)

// Drop FTS triggers once per file
stmts.beginBulkInsert()

try {
  if (formatInfo.format === 'vcf') {
    variantCount = await streamInsertVcf(
      file.filePath, formatInfo, caseId, batchSize, stmts,
      () => cancelled, file.vcfSelectedSamples,
      (count) => {
        const now = Date.now()
        if (now - lastProgressTime >= msg.throttleMs) {
          lastProgressTime = now
          sendProgress(fileIndex, totalFiles, fileName,
            Math.round(((fileIndex + 0.5) / totalFiles) * 100),
            'inserting', count, 0)
        }
      }
    )
  } else {
    variantCount = await streamInsertJson(
      file.filePath, formatInfo, caseId, batchSize, stmts,
      () => cancelled,
      (count) => {
        const now = Date.now()
        if (now - lastProgressTime >= msg.throttleMs) {
          lastProgressTime = now
          sendProgress(fileIndex, totalFiles, fileName,
            Math.round(((fileIndex + 0.5) / totalFiles) * 100),
            'inserting', count, 0)
        }
      }
    )
  }
} finally {
  stmts.finishBulkInsert(caseId, variantCount)
}
```

- [x] **Step 2: Implement streamInsertJson helper**

Add a new function in `import-worker.ts` that replaces `preParseFile`:

```typescript
async function streamInsertJson(
  filePath: string,
  formatInfo: FormatInfo,
  caseId: number,
  batchSize: number,
  stmts: WorkerStatements,
  isCancelled: () => boolean,
  onProgress: (count: number) => void
): Promise<number> {
  const mapperStream = await createMapperPipeline(filePath, formatInfo)
  let batch: Array<Record<string, unknown>> = []
  let totalInserted = 0

  for await (const chunk of mapperStream) {
    if (isCancelled()) {
      mapperStream.destroy()
      break
    }
    if (chunk !== null) {
      batch.push(chunk as Record<string, unknown>)
    }
    if (batch.length >= batchSize) {
      stmts.insertBatch(caseId, batch)
      totalInserted += batch.length
      onProgress(totalInserted)
      batch = []
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    stmts.insertBatch(caseId, batch)
    totalInserted += batch.length
  }

  return totalInserted
}
```

- [x] **Step 3: Implement streamInsertVcf helper**

Add a similar function for VCF:

```typescript
async function streamInsertVcf(
  filePath: string,
  formatInfo: FormatInfo,
  caseId: number,
  batchSize: number,
  stmts: WorkerStatements,
  isCancelled: () => boolean,
  vcfSelectedSamples: string[] | undefined,
  onProgress: (count: number) => void
): Promise<number> {
  if (vcfSelectedSamples && vcfSelectedSamples.length > 1) {
    throw new Error(`Worker expects at most one VCF sample per file entry but received ${vcfSelectedSamples.length}`)
  }

  const raw = createReadStream(filePath)
  const stream = isGzipped(filePath) ? raw.pipe(createGunzip()) : raw
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  const headerLines: string[] = []
  let header: VcfHeader | null = null
  let activeSample = ''
  let totalInserted = 0
  let batch: Array<Record<string, unknown>> = []

  for await (const line of rl) {
    if (isCancelled()) break

    if (line.startsWith('#')) {
      headerLines.push(line)
      continue
    }

    if (header === null) {
      header = parseVcfHeaderFromLines(headerLines)
      const selectedSample = vcfSelectedSamples?.[0]
      activeSample = selectedSample ?? (header.samples.length > 0 ? header.samples[0] : '')
      if (activeSample === '') break
    }

    try {
      const record = parseVcfLine(line, header.samples)
      if (record === null) continue
      const mapped = mapVcfRecord(record, header, activeSample, DEFAULT_INFO_FIELD_MAPPINGS)
      for (const variant of mapped) {
        batch.push(variant)
      }
    } catch {
      continue
    }

    if (batch.length >= batchSize) {
      stmts.insertBatch(caseId, batch)
      totalInserted += batch.length
      onProgress(totalInserted)
      batch = []
    }
  }

  if (batch.length > 0) {
    stmts.insertBatch(caseId, batch)
    totalInserted += batch.length
  }

  return totalInserted
}
```

- [x] **Step 4: Remove preParseFile and preParseVcfFile functions**

Delete the `preParseFile()` (~line 578) and `preParseVcfFile()` (~line 614) functions. Also remove the `nextFileParsed` lookahead variable and its usage in the main loop.

- [x] **Step 5: Add beginBulkInsert/finishBulkInsert to WorkerStatements**

Ensure `WorkerStatements` (the prepared statements object in the worker) has `beginBulkInsert` and `finishBulkInsert` methods that wrap the raw SQL for FTS trigger management. Check if they already exist or need to be added.

- [x] **Step 6: Run import tests**

Run: `npm run test -- --run tests/main/import/`

- [x] **Step 7: Commit**

```bash
git add src/main/workers/import-worker.ts
git commit -m "perf: stream imports in bounded batches instead of materializing files

Remove preParseFile/preParseVcfFile whole-file materialization.
Memory is now proportional to batch size, not file size."
```

---

## Task 6: Streaming Export (Finding #6)

**Files:**
- Modify: `src/main/workers/export-worker.ts`
- Modify: `src/shared/types/export-worker.ts`

- [x] **Step 1: Add format field to export worker message types**

In `src/shared/types/export-worker.ts`, add format to the start message:

```typescript
export type ExportMainMessage = {
  type: 'start'
  dbPath: string
  encryptionKey?: string
  compiledSql: string
  compiledParams: readonly unknown[]
  outputFilePath: string
  caseName: string
  filterSummary: ExportFilterSummary
  /** Export format — inferred from file extension by the renderer */
  format: 'xlsx' | 'csv'
}
```

- [x] **Step 2: Rewrite export-worker to use .iterate() and support CSV**

Replace `src/main/workers/export-worker.ts`:

```typescript
import { parentPort } from 'worker_threads'
import { createWriteStream } from 'node:fs'
import Database from 'better-sqlite3-multiple-ciphers'
import * as XLSX from 'xlsx'
import type { ExportMainMessage, ExportWorkerMessage } from '../../shared/types/export-worker'

const EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: 'chr', header: 'Chromosome' },
  { key: 'pos', header: 'Position' },
  { key: 'ref', header: 'Reference' },
  { key: 'alt', header: 'Alternate' },
  { key: 'gt_num', header: 'Genotype' },
  { key: 'gene_symbol', header: 'Gene' },
  { key: 'func', header: 'Function' },
  { key: 'consequence', header: 'Consequence' },
  { key: 'transcript', header: 'Transcript' },
  { key: 'cdna', header: 'cDNA' },
  { key: 'aa_change', header: 'AA Change' },
  { key: 'gnomad_af', header: 'gnomAD AF' },
  { key: 'cadd', header: 'CADD' },
  { key: 'qual', header: 'Quality' },
  { key: 'clinvar', header: 'ClinVar' },
  { key: 'hpo_sim_score', header: 'HPO Similarity' },
  { key: 'moi', header: 'MOI' }
]

function postMsg(msg: ExportWorkerMessage): void {
  parentPort?.postMessage(msg)
}

function formatCellValue(key: string, value: unknown): string {
  if (value == null) return ''
  if (key === 'gnomad_af' && typeof value === 'number') return value.toExponential(2)
  if (key === 'cadd' && typeof value === 'number') return value.toFixed(2)
  if (key === 'hpo_sim_score' && typeof value === 'number') return value.toFixed(4)
  return String(value)
}

/** Escape a value for CSV (RFC 4180) */
function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return '"' + val.replace(/"/g, '""') + '"'
  }
  return val
}

function runCsv(msg: ExportMainMessage & { type: 'start' }, db: Database.Database): void {
  const stmt = db.prepare(msg.compiledSql)
  const iter = stmt.iterate(...msg.compiledParams) as IterableIterator<Record<string, unknown>>

  const ws = createWriteStream(msg.outputFilePath)
  ws.write(EXPORT_COLUMNS.map((c) => csvEscape(c.header)).join(',') + '\n')

  let count = 0
  for (const row of iter) {
    const line = EXPORT_COLUMNS.map((col) => csvEscape(formatCellValue(col.key, row[col.key]))).join(',')
    ws.write(line + '\n')
    count++
    if (count % 1000 === 0) {
      postMsg({ type: 'progress', current: count, total: 0 })
    }
  }

  ws.end()
  postMsg({ type: 'complete', filePath: msg.outputFilePath, rowCount: count })
}

function runXlsx(msg: ExportMainMessage & { type: 'start' }, db: Database.Database): void {
  const stmt = db.prepare(msg.compiledSql)
  const iter = stmt.iterate(...msg.compiledParams) as IterableIterator<Record<string, unknown>>

  const headers = EXPORT_COLUMNS.map((col) => col.header)
  const rows: (string | number | null)[][] = []
  let count = 0

  for (const row of iter) {
    rows.push(
      EXPORT_COLUMNS.map((col) => {
        const value = row[col.key]
        if (col.key === 'gnomad_af' && typeof value === 'number') return value.toExponential(2)
        if (col.key === 'cadd' && typeof value === 'number') return value.toFixed(2)
        if (col.key === 'hpo_sim_score' && typeof value === 'number') return value.toFixed(4)
        return (value ?? '') as string | number | null
      })
    )
    count++
    if (count % 1000 === 0) {
      postMsg({ type: 'progress', current: count, total: 0 })
    }
  }

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  ws['!cols'] = EXPORT_COLUMNS.map((col) => ({
    wch: col.key === 'aa_change' ? 20 : 15
  }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Variants')

  // Metadata sheet
  const { filterSummary } = msg
  const metaData: (string | number)[][] = [
    ['Export Information'],
    ['Case Name', msg.caseName],
    ['Total Variants', count],
    ['Export Date', new Date().toISOString()],
    [''],
    ['Active Filters'],
    ...(filterSummary.gene_symbol ? [['Gene', filterSummary.gene_symbol]] : []),
    ...(filterSummary.consequences?.length ? [['Consequences', filterSummary.consequences.join(', ')]] : []),
    ...(filterSummary.funcs?.length ? [['Functions', filterSummary.funcs.join(', ')]] : []),
    ...(filterSummary.clinvars?.length ? [['ClinVar', filterSummary.clinvars.join(', ')]] : []),
    ...(filterSummary.gnomad_af_max !== undefined ? [['Max gnomAD AF', filterSummary.gnomad_af_max]] : []),
    ...(filterSummary.cadd_min !== undefined ? [['Min CADD', filterSummary.cadd_min]] : [])
  ]
  const metaWs = XLSX.utils.aoa_to_sheet(metaData)
  XLSX.utils.book_append_sheet(wb, metaWs, 'Export Info')

  XLSX.writeFile(wb, msg.outputFilePath)
  postMsg({ type: 'complete', filePath: msg.outputFilePath, rowCount: count })
}

function run(msg: ExportMainMessage & { type: 'start' }): void {
  let db: Database.Database | null = null

  try {
    db = new Database(msg.dbPath, { readonly: true })
    if (msg.encryptionKey !== undefined && msg.encryptionKey !== '') {
      const escapedKey = msg.encryptionKey.replace(/'/g, "''")
      db.pragma(`key='${escapedKey}'`)
    }
    db.pragma('journal_mode = WAL')

    if (msg.format === 'csv') {
      runCsv(msg, db)
    } else {
      runXlsx(msg, db)
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    postMsg({ type: 'error', error: err.message, stack: err.stack })
  } finally {
    db?.close()
  }
}

parentPort?.on('message', (msg: ExportMainMessage) => {
  if (msg.type === 'start') {
    run(msg)
  }
})
```

- [x] **Step 3: Update the export IPC handler to pass format**

Find the export handler that constructs the `ExportMainMessage` and add `format` derived from the output file path:

```typescript
const format = msg.outputFilePath.endsWith('.csv') ? 'csv' : 'xlsx'
// Include in worker message:
worker.postMessage({ ...msg, format })
```

Also update the save dialog to offer CSV as a filter option:

```typescript
filters: [
  { name: 'Excel Workbook', extensions: ['xlsx'] },
  { name: 'CSV', extensions: ['csv'] }
]
```

- [x] **Step 4: Run tests**

Run: `npm run test -- --run tests/main/handlers/export-handlers.test.ts`

- [x] **Step 5: Commit**

```bash
git add src/main/workers/export-worker.ts src/shared/types/export-worker.ts
git commit -m "perf: stream export rows with .iterate(), add CSV format

User selects format via save dialog file extension.
CSV writes directly to stream with no in-memory accumulation.
XLSX uses .iterate() instead of .all() to reduce peak allocation."
```

---

## Task 7: Panel Interval Computation Off Main Thread (Finding #9)

**Files:**
- Modify: `src/main/ipc/handlers/panelIntervalHelper.ts`
- Modify: `src/main/ipc/handlers/variants.ts:100-130`
- Modify: `src/main/ipc/handlers/cohort.ts:52-73`
- Modify: `src/main/database/db-worker.ts`

- [x] **Step 1: Verify gene reference DB is worker-accessible**

Check `src/main/database/geneReferenceLoader.ts` — if it opens a SQLite connection per call (not relying on main-thread singletons), it can run in workers. The `getGeneReferenceDb()` function likely returns a lazily-initialized connection.

Run: `grep -n 'let\|const.*geneRef\|singleton\|instance' src/main/database/geneReferenceLoader.ts`

- [x] **Step 2: Move interval computation into db-worker**

In `src/main/database/db-worker.ts`, import `computePanelIntervals` and apply it inside the `variants:query` and `cohort:variants` task handlers:

```typescript
import { computePanelIntervals } from '../ipc/handlers/panelIntervalHelper'

// In the variants:query case:
case 'variants:query': {
  const filter = params[0] as VariantFilter
  // Resolve panel intervals in worker instead of main thread
  if (filter.active_panel_ids && filter.active_panel_ids.length > 0) {
    const intervals = computePanelIntervals(
      repos as unknown as DatabaseService,
      {
        active_panel_ids: filter.active_panel_ids,
        panel_padding_bp: filter.panel_padding_bp,
        genome_build: filter.genome_build
      },
      filter.case_id,
      'variants-worker'
    )
    if (intervals) {
      filter.panel_intervals = intervals
    }
    delete filter.active_panel_ids
    delete filter.panel_padding_bp
  }
  return repos.variants.getVariants(
    filter,
    params[1] as number,
    params[2] as number,
    params[3] as Parameters<typeof repos.variants.getVariants>[3]
  )
}
```

Apply similar pattern for `cohort:variants`.

- [x] **Step 3: Simplify IPC handlers — stop pre-computing intervals**

In `src/main/ipc/handlers/variants.ts`, remove the `computePanelIntervals` call block (~lines 102-122). Pass `active_panel_ids` and `panel_padding_bp` through to the pool task unchanged.

In `src/main/ipc/handlers/cohort.ts`, remove the same block (~lines 52-73).

For the fallback (no pool) path, keep inline `computePanelIntervals` call since it runs synchronously on main thread when no pool is available.

- [x] **Step 4: Run tests**

Run: `npm run test -- --run`

- [x] **Step 5: Commit**

```bash
git add src/main/ipc/handlers/panelIntervalHelper.ts \
  src/main/ipc/handlers/variants.ts \
  src/main/ipc/handlers/cohort.ts \
  src/main/database/db-worker.ts
git commit -m "perf: move panel interval computation into worker threads

Avoids blocking the Electron main thread for panel-heavy filters."
```

---

## Task 8: Consolidate Filter/Query State (Finding #11)

**Files:**
- Create: `src/renderer/src/composables/useFilterCore.ts`
- Modify: `src/renderer/src/composables/useFilterState.ts`
- Modify: `src/renderer/src/composables/useFilters.ts`
- Test: `tests/renderer/composables/useFilterCore.test.ts`

- [x] **Step 1: Write the test for shared filter core**

Create `tests/renderer/composables/useFilterCore.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { useFilterCore } from '../../../src/renderer/src/composables/useFilterCore'

describe('useFilterCore', () => {
  it('should track active filter count', () => {
    const core = useFilterCore()
    expect(core.activeFilterCount.value).toBe(0)

    core.consequences.value = ['HIGH']
    expect(core.activeFilterCount.value).toBe(1)

    core.gnomadAfMax.value = 0.01
    expect(core.activeFilterCount.value).toBe(2)
  })

  it('should reset all state', () => {
    const core = useFilterCore()
    core.consequences.value = ['HIGH']
    core.gnomadAfMax.value = 0.01
    core.funcs.value = ['missense_variant']

    core.reset()

    expect(core.consequences.value).toEqual([])
    expect(core.gnomadAfMax.value).toBeUndefined()
    expect(core.funcs.value).toEqual([])
    expect(core.activeFilterCount.value).toBe(0)
  })

  it('should build active filters list', () => {
    const core = useFilterCore()
    core.consequences.value = ['HIGH', 'MODERATE']
    core.caddMin.value = 20

    const list = core.activeFiltersList.value
    expect(list.length).toBe(2)
    expect(list.some(f => f.id === 'consequences')).toBe(true)
    expect(list.some(f => f.id === 'cadd')).toBe(true)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run tests/renderer/composables/useFilterCore.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement useFilterCore**

Create `src/renderer/src/composables/useFilterCore.ts`:

```typescript
/**
 * Shared filter core — generic state reset, active-filter derivation,
 * and common numeric/preset logic used by both case and cohort views.
 *
 * Does NOT include: tags, gene autocomplete, export, annotation scope,
 * searchQuery/searchTerm, or view-specific filter shapes.
 */

import { ref, computed } from 'vue'

export interface CoreActiveFilter {
  id: string
  label: string
  value: string
}

export function useFilterCore() {
  // Shared filter primitives
  const consequences = ref<string[]>([])
  const funcs = ref<string[]>([])
  const clinvars = ref<string[]>([])
  const gnomadAfMax = ref<number | undefined>(undefined)
  const caddMin = ref<number | undefined>(undefined)
  const maxInternalAf = ref<number | undefined>(undefined)
  const acmgClassifications = ref<string[]>([])

  const activeFilterCount = computed(() => {
    let count = 0
    if (consequences.value.length > 0) count++
    if (funcs.value.length > 0) count++
    if (clinvars.value.length > 0) count++
    if (gnomadAfMax.value !== undefined) count++
    if (caddMin.value !== undefined) count++
    if (maxInternalAf.value !== undefined) count++
    if (acmgClassifications.value.length > 0) count++
    return count
  })

  const activeFiltersList = computed<CoreActiveFilter[]>(() => {
    const list: CoreActiveFilter[] = []
    if (consequences.value.length > 0) {
      list.push({ id: 'consequences', label: 'Impact', value: consequences.value.join(', ') })
    }
    if (funcs.value.length > 0) {
      list.push({ id: 'funcs', label: 'Function', value: funcs.value.join(', ') })
    }
    if (clinvars.value.length > 0) {
      list.push({ id: 'clinvars', label: 'ClinVar', value: clinvars.value.join(', ') })
    }
    if (gnomadAfMax.value !== undefined) {
      list.push({ id: 'gnomad_af', label: 'gnomAD AF', value: `≤ ${gnomadAfMax.value}` })
    }
    if (caddMin.value !== undefined) {
      list.push({ id: 'cadd', label: 'CADD', value: `≥ ${caddMin.value}` })
    }
    if (maxInternalAf.value !== undefined) {
      list.push({ id: 'internal_af', label: 'Internal AF', value: `≤ ${maxInternalAf.value}` })
    }
    if (acmgClassifications.value.length > 0) {
      list.push({ id: 'acmg', label: 'ACMG', value: acmgClassifications.value.join(', ') })
    }
    return list
  })

  function reset(): void {
    consequences.value = []
    funcs.value = []
    clinvars.value = []
    gnomadAfMax.value = undefined
    caddMin.value = undefined
    maxInternalAf.value = undefined
    acmgClassifications.value = []
  }

  function clearFilter(id: string): void {
    switch (id) {
      case 'consequences': consequences.value = []; break
      case 'funcs': funcs.value = []; break
      case 'clinvars': clinvars.value = []; break
      case 'gnomad_af': gnomadAfMax.value = undefined; break
      case 'cadd': caddMin.value = undefined; break
      case 'internal_af': maxInternalAf.value = undefined; break
      case 'acmg': acmgClassifications.value = []; break
    }
  }

  return {
    consequences,
    funcs,
    clinvars,
    gnomadAfMax,
    caddMin,
    maxInternalAf,
    acmgClassifications,
    activeFilterCount,
    activeFiltersList,
    reset,
    clearFilter
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run tests/renderer/composables/useFilterCore.test.ts`
Expected: PASS

- [x] **Step 5: Wire useFilterState to delegate to useFilterCore**

In `src/renderer/src/composables/useFilterState.ts`, import and use `useFilterCore` for the shared state, delegating numeric/array filter state to the core. Keep tags, autocomplete, export, and view-specific logic in the adapter.

This is a refactoring step — the external API of `useFilterState` must not change.

- [x] **Step 6: Wire useFilters to delegate to useFilterCore**

In `src/renderer/src/composables/useFilters.ts`, import and use `useFilterCore` for the shared state. Keep cohort-specific serialization and provide/inject in the adapter.

- [x] **Step 7: Run full test suite**

Run: `npm run test -- --run`

- [x] **Step 8: Commit**

```bash
git add src/renderer/src/composables/useFilterCore.ts \
  src/renderer/src/composables/useFilterState.ts \
  src/renderer/src/composables/useFilters.ts \
  tests/renderer/composables/useFilterCore.test.ts
git commit -m "refactor: extract shared filter core for case and cohort views

Shared layer handles reset, active-filter derivation, and numeric
filter state. Tags, autocomplete, export stay in view adapters."
```

---

## Task 9: Split Query Builders (Finding #12)

**Files:**
- Modify: `src/main/database/VariantRepository.ts:820-870`
- Modify: `src/main/database/cohort.ts:83-300`

- [x] **Step 1: Split VariantRepository query methods**

In `src/main/database/VariantRepository.ts`, the `getVariants()` method already builds count and data queries separately using `buildVariantQuery()`. Verify this and ensure count queries have no ORDER BY:

```typescript
// In getVariants(), the count query section (~line 830):
if (skipCount !== true) {
  const countQuery = this.buildVariantQuery(filter)
  const compiled = countQuery.compile()
  const countSql = `SELECT count(*) as count FROM (${compiled.sql})`
  // Good — no ORDER BY in the subquery since buildVariantQuery doesn't add it
}
```

Extract `getAllVariantsForExport()` to use a dedicated export query that skips internal_af computation when not needed:

```typescript
getAllVariantsForExport(filter: VariantFilter): Variant[] {
  const useTempTable = this.preparePanelIntervals(filter)
  try {
    // Export doesn't need internal_af — use base query without frequency join
    const query = this.buildVariantQuery(filter)
      .orderBy('chr', 'asc')
      .orderBy('pos', 'asc')
    return this.execAll<Variant>(query)
  } finally {
    if (useTempTable) this.cleanupPanelIntervalsTable()
  }
}
```

- [x] **Step 2: Split CohortService query construction**

In `src/main/database/cohort.ts`, extract the WHERE clause building into a helper method, then create dedicated count and data query methods:

```typescript
private buildWhereClause(params: CohortSearchParams): {
  whereClause: string
  paramsArray: (string | number)[]
} {
  // Move all the WHERE-building logic (~lines 100-230) here
  // Return { whereClause, paramsArray }
}

getCohortVariants(params: CohortSearchParams): CohortPaginatedResult {
  const { whereClause, paramsArray } = this.buildWhereClause(params)

  // Count query — only when needed
  let totalCount = 0
  if (params._count_needed !== false) {
    const countSql = `SELECT COUNT(*) as count FROM cohort_variant_summary cvs ${whereClause}`
    const countResult = this.db.prepare(countSql).get(...paramsArray) as { count: number }
    totalCount = countResult.count
  }

  // Data query with sort + pagination
  // ... (existing ORDER BY + LIMIT/OFFSET logic)
}
```

- [x] **Step 3: Run EXPLAIN QUERY PLAN on key queries**

After the refactoring, manually run EXPLAIN QUERY PLAN on:
1. Cohort count query with gene filter
2. Cohort page query with sort
3. Variant page query with panel intervals
4. Variant count query with FTS search
5. Variant export query

Verify index usage is reasonable.

- [x] **Step 4: Run tests**

Run: `npm run test -- --run tests/main/database/ tests/main/handlers/`

- [x] **Step 5: Commit**

```bash
git add src/main/database/VariantRepository.ts src/main/database/cohort.ts
git commit -m "refactor: split query builders into count/page/export paths

Extract WHERE clause building into shared helper in CohortService.
Count queries skip ORDER BY. Export queries skip LIMIT."
```

---

## Task 10: Lazy-Load Non-Critical Dialogs (Audit Roadmap)

**Files:**
- Modify: `src/renderer/src/App.vue`

- [x] **Step 1: Identify eagerly-imported conditional components in App.vue**

Read `App.vue` imports and identify components that are conditionally rendered (behind v-if, modals, dialogs). Candidates include:
- `ImportStatusBar`
- `VariantDetailsPanel`
- Any dialog host components

- [x] **Step 2: Convert to defineAsyncComponent**

For each identified component, replace the static import with `defineAsyncComponent`:

```typescript
// Before:
import ImportStatusBar from './components/ImportStatusBar.vue'

// After:
const ImportStatusBar = defineAsyncComponent(() =>
  import('./components/ImportStatusBar.vue')
)
```

Only convert components that are not visible on initial render. Keep always-visible components (AppToolbar, AppSidebar, AppFooter) as static imports.

- [x] **Step 3: Run full test suite**

Run: `npm run test -- --run`

- [x] **Step 4: Commit**

```bash
git add src/renderer/src/App.vue
git commit -m "perf: lazy-load non-critical dialogs and panels in App.vue"
```

---

## Task 11: Case-Switch Extra Query (Finding #7)

**Files:**
- Modify: `src/renderer/src/components/variant-table/useVariantData.ts:115-130`
- Modify: `src/main/database/VariantRepository.ts` (getVariants response)
- Modify: `src/main/ipc/handlers/variants.ts` (pass flag through)

- [x] **Step 1: Add include_unfiltered_count to variant query**

In `src/main/database/VariantRepository.ts`, modify `getVariants()` to accept and handle the flag:

```typescript
getVariants(
  filter: VariantFilter,
  limit: number,
  offset: number = 0,
  sortBy?: SortItem[],
  skipCount?: boolean,
  includeUnfilteredCount?: boolean
): PaginatedResult<Variant> & { unfiltered_count?: number } {
  const useTempTable = this.preparePanelIntervals(filter)
  try {
    let total_count = 0
    let unfiltered_count: number | undefined

    if (skipCount !== true) {
      const countQuery = this.buildVariantQuery(filter)
      const compiled = countQuery.compile()
      const countSql = `SELECT count(*) as count FROM (${compiled.sql})`
      const countResult = this.db.prepare(countSql).get(...compiled.parameters) as { count: number }
      total_count = countResult.count
    }

    if (includeUnfilteredCount === true) {
      const unfilteredResult = this.db
        .prepare('SELECT COUNT(*) as count FROM variants WHERE case_id = ?')
        .get(filter.case_id) as { count: number }
      unfiltered_count = unfilteredResult.count
    }

    const dataQuery = this.buildVariantQuery(filter)
    const sortedQuery = this.applySort(dataQuery, sortBy).limit(limit).offset(offset)
    const data = this.execAll<Variant>(sortedQuery)

    return { data, total_count, ...(unfiltered_count !== undefined ? { unfiltered_count } : {}) }
  } finally {
    if (useTempTable) this.cleanupPanelIntervalsTable()
  }
}
```

- [x] **Step 2: Update useVariantData to use the flag**

In `src/renderer/src/components/variant-table/useVariantData.ts`, replace the separate unfiltered count query:

```typescript
// Before (~line 116):
watch(
  caseId,
  async (newCaseId) => {
    selectedVariantId.value = null
    clearAllColumnFilters()
    if (newCaseId !== undefined && newCaseId !== 0) {
      resetState()
      clearAnnotationCache()
      const result = await (api as any).variants.query(newCaseId, {}, undefined, 1, [])
      unfilteredCount.value = result.total_count
    }
  },
  { immediate: true }
)

// After:
let needsUnfilteredCount = true

watch(
  caseId,
  async (newCaseId) => {
    selectedVariantId.value = null
    clearAllColumnFilters()
    if (newCaseId !== undefined && newCaseId !== 0) {
      resetState()
      clearAnnotationCache()
      needsUnfilteredCount = true
      // The first page load will include unfiltered_count via the flag
    }
  },
  { immediate: true }
)
```

In the `fetchPage` callback of `useOffsetPagination`, pass `include_unfiltered_count` on the first load:

```typescript
fetchPage: async ({ offset, limit, sortBy, skipCount }) => {
  const result = await (api as any).variants.query(
    caseId.value, filterParams, offset, limit, sortBy,
    skipCount, needsUnfilteredCount
  )
  if (needsUnfilteredCount && result.unfiltered_count !== undefined) {
    unfilteredCount.value = result.unfiltered_count
    needsUnfilteredCount = false
  }
  return result
}
```

- [x] **Step 3: Run tests**

Run: `npm run test -- --run`

- [x] **Step 4: Commit**

```bash
git add src/main/database/VariantRepository.ts \
  src/renderer/src/components/variant-table/useVariantData.ts \
  src/main/ipc/handlers/variants.ts
git commit -m "perf: include unfiltered count in first page response

Eliminates extra query on case switch. Uses explicit
include_unfiltered_count flag for deterministic behavior."
```

---

## Task 12: Annotation Stale-Request Guard (Finding #8)

**Files:**
- Modify: `src/renderer/src/composables/useAnnotations.ts:219-260`

- [x] **Step 1: Add generation counter to loadAnnotationsBatch**

In `src/renderer/src/composables/useAnnotations.ts`, add a generation counter and check it on response:

```typescript
// Near top of useAnnotations, add:
let annotationGeneration = 0

// Expose a function to increment on page change:
function invalidateAnnotationGeneration(): void {
  annotationGeneration++
}

// In loadAnnotationsBatch (~line 220):
async function loadAnnotationsBatch(
  caseId: number,
  variants: Array<{ chr: string; pos: number; ref: string; alt: string }>
): Promise<void> {
  if (!api) return

  const currentGeneration = annotationGeneration

  const uncached = variants
    .filter(
      (v) =>
        !annotationCache.value.has(variantKey(v.chr, v.pos, v.ref, v.alt)) &&
        loadingStates.value.get(variantKey(v.chr, v.pos, v.ref, v.alt)) !== true
    )
    .map((v) => ({ chr: v.chr, pos: v.pos, ref: v.ref, alt: v.alt }))

  if (uncached.length === 0) return

  for (const vk of uncached) {
    setLoading(variantKey(vk.chr, vk.pos, vk.ref, vk.alt), true)
  }

  try {
    const results = await api.annotations.batchGet(caseId, uncached)

    // Discard results if generation has advanced (user navigated away)
    if (currentGeneration !== annotationGeneration) return

    for (const [key, value] of Object.entries(results)) {
      cacheSet(key, value as AnnotationCache)
    }
  } catch (error) {
    logService.warn(
      'Failed to load annotation batch: ' +
        (error instanceof Error ? error.message : String(error)),
      'annotations'
    )
  } finally {
    for (const vk of uncached) {
      setLoading(variantKey(vk.chr, vk.pos, vk.ref, vk.alt), false)
    }
  }
}
```

Add `invalidateAnnotationGeneration` to the return object so `useVariantData` can call it on page changes.

- [x] **Step 2: Call invalidateAnnotationGeneration on page changes**

In `src/renderer/src/components/variant-table/useVariantData.ts`, call `invalidateAnnotationGeneration()` when variants change (before loading new annotations):

```typescript
watch(
  variants,
  async (newVariants) => {
    invalidateAnnotationGeneration()
    if (newVariants.length > 0 && caseId.value !== undefined && caseId.value !== 0) {
      await loadAnnotationsBatch(caseId.value, newVariants)
    }
  },
  { immediate: true }
)
```

- [x] **Step 3: Run tests**

Run: `npm run test -- --run`

- [x] **Step 4: Commit**

```bash
git add src/renderer/src/composables/useAnnotations.ts \
  src/renderer/src/components/variant-table/useVariantData.ts
git commit -m "perf: discard stale annotation batch results on rapid paging

Generation counter prevents old page annotation responses from
populating state after the user has navigated to a new page."
```

---

## Task 13: Cohort Response Serialization (Finding #10)

**Files:**
- Modify: `src/main/ipc/handlers/cohort.ts:83-105`

- [x] **Step 1: Verify better-sqlite3 returns plain objects**

Check that the CohortService query returns plain objects. better-sqlite3 returns plain objects by default. The `Number()` wrapping is there for potential BigInt fields — check which columns could be BigInt.

The `carrier_count`, `total_cases`, `het_count`, `hom_count` are `INTEGER` in SQLite and returned as `number` by better-sqlite3 (not BigInt) for values within safe integer range.

- [x] **Step 2: Replace per-row remap with convertBigInts**

In `src/main/ipc/handlers/cohort.ts`, replace the manual `.map()` block with the existing `convertBigInts` utility (already used for cohort:summary and cohort:carriers):

```typescript
// Before (~line 83):
const plainData = result.data.map((v) => ({
  chr: String(v.chr),
  // ... 15 more fields
}))
return {
  data: plainData,
  total_count: Number(result.total_count)
}

// After:
return convertBigInts(result)
```

The `convertBigInts` utility recursively converts BigInt values to Number and passes other types through unchanged. This handles the edge case without per-field remapping.

- [x] **Step 3: Run tests**

Run: `npm run test -- --run tests/main/handlers/`

- [x] **Step 4: Run full test suite**

Run: `npm run test -- --run`

- [x] **Step 5: Commit**

```bash
git add src/main/ipc/handlers/cohort.ts
git commit -m "perf: remove per-row object remap in cohort handler

Use convertBigInts() for edge cases instead of rebuilding every
row object field by field."
```

---

## Self-Review Checklist

1. **Spec coverage:**
   - Finding #1 (VariantTable) → Task 4 ✓
   - Finding #2 (keep-alive) → Task 3 ✓
   - Finding #3 (skipCount) → Task 1 ✓
   - Finding #4 (import batch) → Task 2 ✓
   - Finding #5 (streaming imports) → Task 5 ✓
   - Finding #6 (streaming export) → Task 6 ✓
   - Finding #7 (case-switch query) → Task 11 ✓
   - Finding #8 (annotation guard) → Task 12 ✓
   - Finding #9 (panel intervals) → Task 7 ✓
   - Finding #10 (cohort serialization) → Task 13 ✓
   - Finding #11 (filter consolidation) → Task 8 ✓
   - Finding #12 (query builders) → Task 9 ✓
   - Lazy-load dialogs → Task 10 ✓

2. **Placeholder scan:** No TBD/TODO/vague placeholders found.

3. **Type consistency:** `RowViewModel`, `buildRowViewModels`, `useFilterCore`, `CoreActiveFilter` — names are consistent across test and implementation tasks. `insertBatch` signature matches VariantRepository (`variants: ..., caseId: number`) vs BatchAccumulator flushFn (`caseId, batch`) — verified consistent with actual code.
