# Filter Phase 2: Per-Column Filter Enhancement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain-text per-column filter with type-aware filters (numeric operator+value, categorical checkboxes, text auto-suggest) that auto-detect their mode from database metadata.

**Architecture:** A new `variants:columnMeta` field extends the existing `filterOptions` IPC response with per-column metadata (data type, distinct count, distinct values, min/max). The renderer uses a config + auto-detect logic to choose the right filter UI component. Column filters use a typed `ColumnFilter` structure (operator + value) instead of plain strings. The backend generates type-aware SQL (real comparison operators, IN clauses) instead of universal LIKE matching.

**Tech Stack:** Vue 3 Composition API, Vuetify 3 (v-menu, v-select, v-checkbox, v-autocomplete), TypeScript, Vitest, Zod, Kysely, SQLite

**Specs:** `.planning/specs/2026-03-15-filter-phase2-per-column-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/shared/types/column-filters.ts` | `ColumnFilter`, `ColumnFilterMeta` types shared across main/renderer |
| Create | `src/renderer/src/config/columnFilterConfig.ts` | Override config, threshold constant, auto-detect function |
| Create | `src/renderer/src/components/variant-table/NumericColumnFilter.vue` | Numeric filter popup (operator + value + range hint) |
| Create | `src/renderer/src/components/variant-table/CategoricalColumnFilter.vue` | Checkbox filter popup with search |
| Create | `src/renderer/src/components/variant-table/TextSuggestColumnFilter.vue` | Text input with autocomplete suggestions |
| Modify | `src/shared/types/api.ts:136-144` | Extend `FilterOptions` with `columnMeta` field |
| Modify | `src/shared/types/ipc-schemas.ts:112-116,181-184` | Update Zod schema for typed `column_filters` |
| Modify | `src/main/database/VariantRepository.ts:19-38,339-350,552-608` | Add `getColumnMeta()`, type-aware column filter SQL |
| Modify | `src/renderer/src/composables/useColumnFilters.ts` | Typed `ColumnFilter` state, active filter bar integration |
| Modify | `src/renderer/src/components/variant-table/VariantColumnHeader.vue` | Route to correct filter component based on metadata |
| Modify | `src/renderer/src/utils/filters/activeFilters.ts` | Include column filters in active filter chips |
| Create | `tests/renderer/config/columnFilterConfig.test.ts` | Auto-detect logic tests |
| Create | `tests/renderer/components/variant-table/NumericColumnFilter.test.ts` | Numeric filter tests |
| Create | `tests/renderer/components/variant-table/CategoricalColumnFilter.test.ts` | Categorical filter tests |
| Create | `tests/renderer/components/variant-table/TextSuggestColumnFilter.test.ts` | Text-suggest filter tests |
| Modify | `tests/renderer/utils/filters/activeFilters.test.ts` | Column filter chip tests |

---

## Chunk 1: Shared Types and Column Filter Config

### Task 1: Define shared ColumnFilter and ColumnFilterMeta types

**Files:**
- Create: `src/shared/types/column-filters.ts`

- [ ] **Step 1: Write the type definitions**

File: `src/shared/types/column-filters.ts`

```typescript
/**
 * Typed column filter structure for per-column filtering.
 * Replaces the old Record<string, string> with operator-aware filters.
 */

/** Operators for column filters */
export type ColumnFilterOperator = '=' | '!=' | '<' | '>' | '<=' | '>=' | 'like' | 'in'

/** A single typed column filter */
export interface ColumnFilter {
  operator: ColumnFilterOperator
  value: string | number | string[]
}

/** Column filters map: column key -> typed filter */
export type ColumnFiltersParam = Record<string, ColumnFilter>

/** Filter mode auto-detected or overridden from config */
export type ColumnFilterMode = 'numeric' | 'categorical' | 'text-suggest'

/** Per-column metadata returned by the backend for filter UI auto-detection */
export interface ColumnFilterMeta {
  /** Column key matching SORTABLE_COLUMNS (e.g. 'cadd') */
  key: string
  /** Inferred from SQLite type affinity */
  dataType: 'numeric' | 'text'
  /** Count of unique non-null values in the current case */
  distinctCount: number
  /** Populated only if distinctCount <= threshold */
  distinctValues?: string[]
  /** For numeric columns: minimum value in the current case */
  min?: number
  /** For numeric columns: maximum value in the current case */
  max?: number
}
```

- [ ] **Step 2: Export from shared types index**

In `src/shared/types/index.ts`, add the export (if an index file exists — otherwise skip):

```typescript
export * from './column-filters'
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/types/column-filters.ts
git commit -m "feat: add shared ColumnFilter and ColumnFilterMeta types

Typed column filter structure with operator support replaces the
old Record<string, string>. ColumnFilterMeta provides per-column
metadata for auto-detecting filter UI mode."
```

---

### Task 2: Create column filter config with auto-detect logic

**Files:**
- Create: `src/renderer/src/config/columnFilterConfig.ts`
- Create: `tests/renderer/config/columnFilterConfig.test.ts`

- [ ] **Step 1: Write the failing test**

File: `tests/renderer/config/columnFilterConfig.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import {
  detectFilterMode,
  DEFAULT_CATEGORICAL_THRESHOLD,
  COLUMN_FILTER_OVERRIDES
} from '../../../src/renderer/src/config/columnFilterConfig'
import type { ColumnFilterMeta } from '../../../src/shared/types/column-filters'

describe('columnFilterConfig', () => {
  describe('DEFAULT_CATEGORICAL_THRESHOLD', () => {
    it('is 25', () => {
      expect(DEFAULT_CATEGORICAL_THRESHOLD).toBe(25)
    })
  })

  describe('COLUMN_FILTER_OVERRIDES', () => {
    it('forces gene_symbol to text-suggest', () => {
      expect(COLUMN_FILTER_OVERRIDES.gene_symbol?.forceMode).toBe('text-suggest')
    })

    it('forces chr to categorical', () => {
      expect(COLUMN_FILTER_OVERRIDES.chr?.forceMode).toBe('categorical')
    })
  })

  describe('detectFilterMode', () => {
    it('returns forced mode from config override', () => {
      const meta: ColumnFilterMeta = {
        key: 'gene_symbol',
        dataType: 'text',
        distinctCount: 3,
        distinctValues: ['BRCA1', 'TP53', 'EGFR']
      }
      expect(detectFilterMode(meta)).toBe('text-suggest')
    })

    it('returns categorical for forced chr even with many values', () => {
      const meta: ColumnFilterMeta = {
        key: 'chr',
        dataType: 'text',
        distinctCount: 24
      }
      expect(detectFilterMode(meta)).toBe('categorical')
    })

    it('returns numeric for numeric type with many distinct values', () => {
      const meta: ColumnFilterMeta = {
        key: 'cadd',
        dataType: 'numeric',
        distinctCount: 500,
        min: 0,
        max: 42
      }
      expect(detectFilterMode(meta)).toBe('numeric')
    })

    it('returns categorical when distinct count is at threshold', () => {
      const meta: ColumnFilterMeta = {
        key: 'func',
        dataType: 'text',
        distinctCount: 25,
        distinctValues: Array.from({ length: 25 }, (_, i) => `val_${i}`)
      }
      expect(detectFilterMode(meta)).toBe('categorical')
    })

    it('returns categorical when distinct count is below threshold', () => {
      const meta: ColumnFilterMeta = {
        key: 'consequence',
        dataType: 'text',
        distinctCount: 8,
        distinctValues: ['missense', 'stop_gained', 'frameshift', 'splice', 'syn', 'utr3', 'utr5', 'intron']
      }
      expect(detectFilterMode(meta)).toBe('categorical')
    })

    it('returns text-suggest for text with many distinct values', () => {
      const meta: ColumnFilterMeta = {
        key: 'transcript',
        dataType: 'text',
        distinctCount: 200
      }
      expect(detectFilterMode(meta)).toBe('text-suggest')
    })

    it('returns categorical for numeric with few distinct values', () => {
      const meta: ColumnFilterMeta = {
        key: 'qual',
        dataType: 'numeric',
        distinctCount: 5,
        distinctValues: ['10', '20', '30', '40', '50'],
        min: 10,
        max: 50
      }
      expect(detectFilterMode(meta)).toBe('categorical')
    })

    it('respects per-column threshold override', () => {
      const meta: ColumnFilterMeta = {
        key: 'gt_num',
        dataType: 'text',
        distinctCount: 30,
        distinctValues: Array.from({ length: 30 }, (_, i) => `${i}/${i}`)
      }
      // gt_num has threshold override of 50
      expect(detectFilterMode(meta)).toBe('categorical')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/config/columnFilterConfig.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the config implementation**

File: `src/renderer/src/config/columnFilterConfig.ts`

```typescript
import type { ColumnFilterMeta, ColumnFilterMode } from '../../../shared/types/column-filters'

/**
 * Default threshold: columns with this many or fewer distinct values
 * get categorical (checkbox) filter mode.
 */
export const DEFAULT_CATEGORICAL_THRESHOLD = 25

/**
 * Per-column overrides for filter mode auto-detection.
 * forceMode: skip auto-detection and always use this mode.
 * threshold: override the categorical threshold for this column.
 */
export const COLUMN_FILTER_OVERRIDES: Record<
  string,
  { forceMode?: ColumnFilterMode; threshold?: number }
> = {
  gene_symbol: { forceMode: 'text-suggest' },
  chr: { forceMode: 'categorical' },
  gt_num: { threshold: 50 }
}

/**
 * Auto-detect the filter mode for a column based on its metadata.
 *
 * Priority:
 * 1. Config override (forceMode) — always wins
 * 2. Distinct count <= threshold — categorical
 * 3. Numeric data type — numeric
 * 4. Fallback — text-suggest
 */
export function detectFilterMode(meta: ColumnFilterMeta): ColumnFilterMode {
  const override = COLUMN_FILTER_OVERRIDES[meta.key]

  // 1. Forced mode from config
  if (override?.forceMode) {
    return override.forceMode
  }

  // 2. Few distinct values → categorical (regardless of data type)
  const threshold = override?.threshold ?? DEFAULT_CATEGORICAL_THRESHOLD
  if (meta.distinctCount <= threshold) {
    return 'categorical'
  }

  // 3. Numeric type with many values → numeric
  if (meta.dataType === 'numeric') {
    return 'numeric'
  }

  // 4. Text type with many values → text-suggest
  return 'text-suggest'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/config/columnFilterConfig.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/config/columnFilterConfig.ts tests/renderer/config/columnFilterConfig.test.ts
git commit -m "feat: add column filter config with auto-detect logic

detectFilterMode() determines filter UI based on column metadata:
forced overrides win, then few distinct values → categorical,
numeric type → numeric, else text-suggest."
```

---

### Task 3: Extend FilterOptions with columnMeta and update Zod schemas

**Files:**
- Modify: `src/shared/types/api.ts:136-144`
- Modify: `src/shared/types/ipc-schemas.ts:112-116,181-184`

- [ ] **Step 1: Extend FilterOptions type**

In `src/shared/types/api.ts`, add the import and extend the interface:

```typescript
import type { ColumnFilterMeta, ColumnFilter } from './column-filters'
```

Add to the `FilterOptions` interface:

```typescript
export interface FilterOptions {
  consequences: string[]
  funcs: string[]
  clinvars: string[]
  minCadd: number | null
  maxCadd: number | null
  minGnomadAf: number | null
  maxGnomadAf: number | null
  /** Per-column metadata for filter UI auto-detection */
  columnMeta: ColumnFilterMeta[]
}
```

- [ ] **Step 2: Update Zod schemas for typed column_filters**

In `src/shared/types/ipc-schemas.ts`, add a Zod schema for the new `ColumnFilter` type. Replace both `column_filters` entries (in `CohortSearchParamsSchema` around line 112 and `VariantFilterPartialSchema` around line 181):

Define the new schema near the top helpers:

```typescript
/** Schema for a single typed column filter */
const ColumnFilterSchema = z.object({
  operator: z.enum(['=', '!=', '<', '>', '<=', '>=', 'like', 'in']),
  value: z.union([z.string(), z.number(), z.array(z.string())])
})
```

Replace both `column_filters` entries from:
```typescript
  column_filters: z
    .record(z.string(), z.string())
    .nullish()
    .transform((val) => val ?? undefined),
```
to:
```typescript
  column_filters: z
    .record(z.string(), ColumnFilterSchema)
    .nullish()
    .transform((val) => val ?? undefined),
```

- [ ] **Step 3: Update the VariantFilter type in database types**

In `src/main/database/types.ts`, find the `VariantFilter` interface and update its `column_filters` field type. Change from:
```typescript
column_filters?: Record<string, string>
```
to:
```typescript
column_filters?: Record<string, { operator: string; value: string | number | string[] }>
```

- [ ] **Step 4: Run typecheck to verify**

Run: `make typecheck`
Expected: May show errors in VariantRepository.ts and useColumnFilters.ts — these will be fixed in subsequent tasks.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/api.ts src/shared/types/ipc-schemas.ts src/main/database/types.ts
git commit -m "feat: extend FilterOptions with columnMeta, typed column_filters schema

FilterOptions now includes columnMeta array for filter UI auto-detection.
Zod schemas validate the new ColumnFilter structure (operator + value)
instead of plain strings."
```

---

## Chunk 2: Backend — Column Metadata Query and Type-Aware SQL

### Task 4: Add getColumnMeta to VariantRepository

**Files:**
- Modify: `src/main/database/VariantRepository.ts:552-608`

- [ ] **Step 1: Add the getColumnMeta method**

In `VariantRepository.ts`, add a new method after `getFilterOptions`:

```typescript
  /**
   * Get per-column metadata for filter UI auto-detection.
   * Returns data type, distinct count, distinct values (if few), and min/max for numeric.
   */
  getColumnMeta(caseId: number): ColumnFilterMeta[] {
    const results: ColumnFilterMeta[] = []

    for (const [key, sqlCol] of Object.entries(SORTABLE_COLUMNS)) {
      const isNumeric = NUMERIC_COLUMNS.has(key)

      // Get distinct count + min/max in one query
      const stats = this.execOne<{
        distinct_count: number
        min_val: number | null
        max_val: number | null
      }>(
        this.kysely
          .selectFrom('variants')
          .select([
            sql<number>`COUNT(DISTINCT ${sql.ref(sqlCol)})`.as('distinct_count'),
            sql<number | null>`MIN(CAST(${sql.ref(sqlCol)} AS REAL))`.as('min_val'),
            sql<number | null>`MAX(CAST(${sql.ref(sqlCol)} AS REAL))`.as('max_val')
          ])
          .where('case_id', '=', caseId)
          .where(sql.ref(sqlCol), 'is not', null)
      )

      if (!stats || stats.distinct_count === 0) continue

      const meta: ColumnFilterMeta = {
        key,
        dataType: isNumeric ? 'numeric' : 'text',
        distinctCount: stats.distinct_count
      }

      if (isNumeric && stats.min_val !== null) {
        meta.min = stats.min_val
        meta.max = stats.max_val ?? stats.min_val
      }

      // Fetch distinct values if count is small enough (threshold checked on frontend)
      // Use a generous server-side limit to avoid fetching thousands of values
      if (stats.distinct_count <= 50) {
        const rows = this.execAll<{ val: string }>(
          this.kysely
            .selectFrom('variants')
            .select(sql<string>`DISTINCT ${sql.ref(sqlCol)}`.as('val'))
            .where('case_id', '=', caseId)
            .where(sql.ref(sqlCol), 'is not', null)
            .orderBy(sql.ref(sqlCol))
        )
        meta.distinctValues = rows.map((r) => String(r.val))
      }

      results.push(meta)
    }

    return results
  }
```

Add the import at the top of the file:
```typescript
import type { ColumnFilterMeta } from '../../shared/types/column-filters'
```

- [ ] **Step 2: Include columnMeta in getFilterOptions response**

In the existing `getFilterOptions` method, add at the end before the return:

```typescript
    const columnMeta = this.getColumnMeta(caseId)

    return {
      consequences: consequences.map((r) => r.consequence),
      funcs: funcs.map((r) => r.func),
      clinvars: clinvars.map((r) => r.clinvar),
      minCadd: caddRange?.min_cadd ?? null,
      maxCadd: caddRange?.max_cadd ?? null,
      minGnomadAf: afRange?.min_af ?? null,
      maxGnomadAf: afRange?.max_af ?? null,
      columnMeta
    }
```

- [ ] **Step 3: Run typecheck**

Run: `make typecheck`
Expected: Should pass for backend changes. Frontend may still have errors (fixed in Task 6).

- [ ] **Step 4: Commit**

```bash
git add src/main/database/VariantRepository.ts
git commit -m "feat: add getColumnMeta for per-column filter metadata

Queries distinct counts, min/max ranges, and distinct values per
filterable column. Returned as part of filterOptions response."
```

---

### Task 5: Type-aware column filter SQL generation

**Files:**
- Modify: `src/main/database/VariantRepository.ts:339-350`

- [ ] **Step 1: Replace the column filter WHERE clause**

In `VariantRepository.ts`, replace the column_filters block (around lines 339-350):

From:
```typescript
    // Column filters (dynamic)
    if (filter.column_filters !== undefined) {
      for (const [column, value] of Object.entries(filter.column_filters)) {
        if (value === '' || SORTABLE_COLUMNS[column] === undefined) continue
        const sqlColumn = SORTABLE_COLUMNS[column]
        if (NUMERIC_COLUMNS.has(column)) {
          query = query.where(sql`CAST(${sql.ref(sqlColumn)} AS TEXT)`, 'like', `%${value}%`)
        } else {
          query = query.where(sql`${sql.ref(sqlColumn)} COLLATE NOCASE`, 'like', `%${value}%`)
        }
      }
    }
```

To:
```typescript
    // Column filters (typed: operator + value)
    if (filter.column_filters !== undefined) {
      for (const [column, colFilter] of Object.entries(filter.column_filters)) {
        if (SORTABLE_COLUMNS[column] === undefined) continue
        const sqlColumn = SORTABLE_COLUMNS[column]
        const { operator, value } = colFilter

        if (operator === 'in' && Array.isArray(value)) {
          // Categorical: IN clause
          if (value.length > 0) {
            query = query.where(sql.ref(sqlColumn), 'in', value)
          }
        } else if (operator === 'like' && typeof value === 'string') {
          // Text-suggest: case-insensitive LIKE
          query = query.where(
            sql`${sql.ref(sqlColumn)} COLLATE NOCASE`,
            'like',
            `%${value}%`
          )
        } else if (['=', '!=', '<', '>', '<=', '>='].includes(operator)) {
          // Numeric or exact match comparison
          const compValue = typeof value === 'string' ? value : Number(value)
          query = query.where(sql.ref(sqlColumn), operator as '=' | '!=' | '<' | '>' | '<=' | '>=', compValue)
        }
      }
    }
```

- [ ] **Step 2: Run existing tests to check for regressions**

Run: `npx vitest run tests/renderer/`
Expected: All tests pass (backend change, renderer tests don't hit real DB).

- [ ] **Step 3: Commit**

```bash
git add src/main/database/VariantRepository.ts
git commit -m "feat: type-aware column filter SQL generation

Replaces universal LIKE matching with operator-aware SQL:
numeric columns use real comparison operators, categorical
uses IN clause, text uses case-insensitive LIKE."
```

---

## Chunk 3: Composable and Active Filter Bar Updates

### Task 6: Update useColumnFilters composable for typed ColumnFilter

**Files:**
- Modify: `src/renderer/src/composables/useColumnFilters.ts`

- [ ] **Step 1: Rewrite useColumnFilters with typed state**

Replace the entire file:

```typescript
import { ref, computed } from 'vue'
import type { ColumnFilter, ColumnFiltersParam } from '../../../shared/types/column-filters'

/**
 * Composable for typed per-column filtering in data tables.
 * Stores operator + value per column instead of plain strings.
 */
export function useColumnFilters() {
  const columnFilters = ref<ColumnFiltersParam>({})

  const hasActiveFilters = computed(() => Object.keys(columnFilters.value).length > 0)

  const activeFilterCount = computed(() => Object.keys(columnFilters.value).length)

  function setColumnFilter(columnKey: string, filter: ColumnFilter): void {
    columnFilters.value = { ...columnFilters.value, [columnKey]: filter }
  }

  function clearColumnFilter(columnKey: string): void {
    const next = { ...columnFilters.value }
    delete next[columnKey]
    columnFilters.value = next
  }

  function clearAllColumnFilters(): void {
    columnFilters.value = {}
  }

  function hasFilter(columnKey: string): boolean {
    return columnKey in columnFilters.value
  }

  function getFilter(columnKey: string): ColumnFilter | undefined {
    return columnFilters.value[columnKey]
  }

  /** Get filters as a plain object for IPC */
  function getColumnFiltersParam(): ColumnFiltersParam | undefined {
    if (Object.keys(columnFilters.value).length === 0) return undefined
    return { ...columnFilters.value }
  }

  return {
    columnFilters,
    hasActiveFilters,
    activeFilterCount,
    setColumnFilter,
    clearColumnFilter,
    clearAllColumnFilters,
    hasFilter,
    getFilter,
    getColumnFiltersParam
  }
}
```

- [ ] **Step 2: Update useVariantData.ts to pass typed filters**

In `src/renderer/src/composables/useVariantData.ts`, the `getColumnFiltersParam()` call already returns the right shape — no changes needed since the function signature is compatible. But verify the debounced watcher still works with the new object shape.

Check if there's a watcher on `columnFilters` that uses string comparison — if so, update it to handle the object structure. The deep watch should still work since Vue's reactivity tracks nested objects.

- [ ] **Step 3: Run typecheck**

Run: `make typecheck`
Expected: Should pass (or show errors in VariantColumnHeader.vue which will be fixed in Task 9).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/composables/useColumnFilters.ts
git commit -m "refactor: useColumnFilters to typed ColumnFilter structure

Stores operator + value per column instead of plain strings.
Adds getFilter() method for retrieving individual column filters."
```

---

### Task 7: Add column filters to active filter bar

**Files:**
- Modify: `src/renderer/src/utils/filters/activeFilters.ts`
- Modify: `tests/renderer/utils/filters/activeFilters.test.ts`

- [ ] **Step 1: Write failing tests for column filter chips**

Add to the existing `tests/renderer/utils/filters/activeFilters.test.ts`:

```typescript
import type { ColumnFiltersParam } from '../../../../src/shared/types/column-filters'

// Add to existing describe('buildActiveFiltersList')

  it('includes numeric column filter chip', () => {
    const colFilters: ColumnFiltersParam = {
      cadd: { operator: '>=', value: 20 }
    }
    const result = buildActiveFiltersList(makeDefaultFilters(), [], colFilters)
    const chip = result.find((f) => f.id === 'col:cadd')
    expect(chip).toBeDefined()
    expect(chip!.label).toBe('CADD')
    expect(chip!.value).toBe('>= 20')
  })

  it('includes categorical column filter chip with count', () => {
    const colFilters: ColumnFiltersParam = {
      consequence: { operator: 'in', value: ['missense', 'stop_gained', 'frameshift'] }
    }
    const result = buildActiveFiltersList(makeDefaultFilters(), [], colFilters)
    const chip = result.find((f) => f.id === 'col:consequence')
    expect(chip).toBeDefined()
    expect(chip!.label).toBe('Consequence')
    expect(chip!.value).toBe('3 selected')
  })

  it('includes text column filter chip', () => {
    const colFilters: ColumnFiltersParam = {
      gene_symbol: { operator: 'like', value: 'BRCA' }
    }
    const result = buildActiveFiltersList(makeDefaultFilters(), [], colFilters)
    const chip = result.find((f) => f.id === 'col:gene_symbol')
    expect(chip).toBeDefined()
    expect(chip!.label).toBe('Gene')
    expect(chip!.value).toBe('~ BRCA')
  })

  it('returns empty when no column filters', () => {
    const result = buildActiveFiltersList(makeDefaultFilters(), [], {})
    expect(result.filter((f) => f.id.startsWith('col:'))).toEqual([])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/utils/filters/activeFilters.test.ts`
Expected: FAIL — `buildActiveFiltersList` doesn't accept a third argument yet.

- [ ] **Step 3: Update buildActiveFiltersList**

In `src/renderer/src/utils/filters/activeFilters.ts`, add the column filter parameter and chip generation:

Add import:
```typescript
import type { ColumnFiltersParam } from '../../../../shared/types/column-filters'
```

Update the function signature to accept a third parameter:
```typescript
export function buildActiveFiltersList(
  filters: FilterState,
  impactPresets: string[] = [],
  columnFilters: ColumnFiltersParam = {}
): ActiveFilter[] {
```

Add at the end of the function, before `return list`:
```typescript
  // Column filters
  const COLUMN_LABELS: Record<string, string> = {
    chr: 'Chr', pos: 'Position', gene_symbol: 'Gene', omim_mim_number: 'OMIM',
    func: 'Func', consequence: 'Consequence', transcript: 'Transcript',
    cdna: 'cDNA', aa_change: 'AA Change', gt_num: 'GT', gnomad_af: 'gnomAD AF',
    cadd: 'CADD', qual: 'Qual', hpo_sim_score: 'HPO Score', clinvar: 'ClinVar', moi: 'MoI'
  }

  for (const [key, colFilter] of Object.entries(columnFilters)) {
    const label = COLUMN_LABELS[key] ?? key
    let displayValue: string

    if (colFilter.operator === 'in' && Array.isArray(colFilter.value)) {
      displayValue = `${colFilter.value.length} selected`
    } else if (colFilter.operator === 'like') {
      displayValue = `~ ${colFilter.value}`
    } else {
      displayValue = `${colFilter.operator} ${colFilter.value}`
    }

    list.push({ id: `col:${key}`, label, value: displayValue })
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/utils/filters/activeFilters.test.ts`
Expected: PASS

- [ ] **Step 5: Update callers to pass column filters**

Search for all calls to `buildActiveFiltersList` in the codebase and pass the column filters as the third argument. This is typically in composables like `useFilterState.ts` or `useVariantData.ts` where `activeFiltersList` is computed.

- [ ] **Step 6: Run full renderer test suite**

Run: `npx vitest run tests/renderer/`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/utils/filters/activeFilters.ts tests/renderer/utils/filters/activeFilters.test.ts
git commit -m "feat: show column filters as chips in active filter bar

Column filters appear as removable chips with format:
numeric 'CADD >= 20', categorical 'Consequence: 3 selected',
text 'Gene ~ BRCA'. Prefixed with col: id for clear-filter routing."
```

---

## Chunk 4: Filter UI Components

### Task 8: NumericColumnFilter component

**Files:**
- Create: `src/renderer/src/components/variant-table/NumericColumnFilter.vue`
- Create: `tests/renderer/components/variant-table/NumericColumnFilter.test.ts`

- [ ] **Step 1: Write the failing test**

File: `tests/renderer/components/variant-table/NumericColumnFilter.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import NumericColumnFilter from '../../../../src/renderer/src/components/variant-table/NumericColumnFilter.vue'

const vuetify = createVuetify()

function mountFilter(props: Record<string, unknown> = {}) {
  return mount(NumericColumnFilter, {
    props: {
      columnTitle: 'CADD',
      min: 0,
      max: 42,
      ...props
    },
    global: { plugins: [vuetify] }
  })
}

describe('NumericColumnFilter', () => {
  it('renders column title', () => {
    const wrapper = mountFilter()
    expect(wrapper.text()).toContain('Filter: CADD')
  })

  it('shows data range hint', () => {
    const wrapper = mountFilter()
    expect(wrapper.text()).toContain('Range: 0 - 42')
  })

  it('emits apply with operator and value', async () => {
    const wrapper = mountFilter()
    // Set operator to >=
    const select = wrapper.findComponent({ name: 'VSelect' })
    await select.setValue('>=')
    // Set value
    const input = wrapper.findComponent({ name: 'VTextField' })
    await input.setValue(20)
    // Click Apply
    const applyBtn = wrapper.find('button:last-child')
    await applyBtn.trigger('click')
    expect(wrapper.emitted('apply')).toBeTruthy()
    expect(wrapper.emitted('apply')![0]).toEqual([{ operator: '>=', value: 20 }])
  })

  it('emits clear when Clear clicked', async () => {
    const wrapper = mountFilter()
    const clearBtn = wrapper.find('.v-card-actions .v-btn')
    await clearBtn.trigger('click')
    expect(wrapper.emitted('clear')).toBeTruthy()
  })

  it('does not show range when min/max not provided', () => {
    const wrapper = mountFilter({ min: undefined, max: undefined })
    expect(wrapper.text()).not.toContain('Range:')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/components/variant-table/NumericColumnFilter.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

File: `src/renderer/src/components/variant-table/NumericColumnFilter.vue`

```vue
<template>
  <v-card min-width="280" max-width="350">
    <v-card-title class="text-subtitle-2 py-2">Filter: {{ columnTitle }}</v-card-title>
    <v-divider />
    <v-card-text class="pa-3">
      <div class="d-flex ga-2 mb-2">
        <v-select
          v-model="operator"
          :items="operators"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 110px"
        />
        <v-text-field
          v-model.number="filterValue"
          type="number"
          density="compact"
          variant="outlined"
          hide-details
          placeholder="Value"
          autofocus
        />
      </div>
      <div v-if="min != null && max != null" class="text-caption text-medium-emphasis">
        Range: {{ min }} - {{ max }}
      </div>
    </v-card-text>
    <v-divider />
    <v-card-actions class="pa-2">
      <v-btn size="small" variant="text" @click="emit('clear')">Clear</v-btn>
      <v-spacer />
      <v-btn size="small" color="primary" variant="flat" :disabled="filterValue == null" @click="apply">
        Apply
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { ColumnFilterOperator } from '../../../../shared/types/column-filters'

const props = defineProps<{
  columnTitle: string
  min?: number
  max?: number
  /** Pre-populate from existing filter */
  initialOperator?: ColumnFilterOperator
  initialValue?: number
}>()

const emit = defineEmits<{
  apply: [filter: { operator: ColumnFilterOperator; value: number }]
  clear: []
}>()

const operators = ['=', '!=', '<', '>', '<=', '>=']
const operator = ref<ColumnFilterOperator>(props.initialOperator ?? '>=')
const filterValue = ref<number | null>(props.initialValue ?? null)

function apply(): void {
  if (filterValue.value != null) {
    emit('apply', { operator: operator.value, value: filterValue.value })
  }
}
</script>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/components/variant-table/NumericColumnFilter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/variant-table/NumericColumnFilter.vue tests/renderer/components/variant-table/NumericColumnFilter.test.ts
git commit -m "feat: add NumericColumnFilter component

Operator dropdown (=, !=, <, >, <=, >=) + value input with
data range hint. Emits typed ColumnFilter on Apply."
```

---

### Task 9: CategoricalColumnFilter component

**Files:**
- Create: `src/renderer/src/components/variant-table/CategoricalColumnFilter.vue`
- Create: `tests/renderer/components/variant-table/CategoricalColumnFilter.test.ts`

- [ ] **Step 1: Write the failing test**

File: `tests/renderer/components/variant-table/CategoricalColumnFilter.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import CategoricalColumnFilter from '../../../../src/renderer/src/components/variant-table/CategoricalColumnFilter.vue'

const vuetify = createVuetify()

const VALUES = ['missense_variant', 'stop_gained', 'frameshift_variant', 'synonymous_variant']

function mountFilter(props: Record<string, unknown> = {}) {
  return mount(CategoricalColumnFilter, {
    props: {
      columnTitle: 'Consequence',
      values: VALUES,
      ...props
    },
    global: { plugins: [vuetify] }
  })
}

describe('CategoricalColumnFilter', () => {
  it('renders column title', () => {
    const wrapper = mountFilter()
    expect(wrapper.text()).toContain('Filter: Consequence')
  })

  it('renders all values as checkboxes', () => {
    const wrapper = mountFilter()
    for (const val of VALUES) {
      expect(wrapper.text()).toContain(val)
    }
  })

  it('emits apply with selected values', async () => {
    const wrapper = mountFilter({ initialSelected: ['stop_gained'] })
    const okBtn = wrapper.findAll('.v-card-actions .v-btn').pop()!
    await okBtn.trigger('click')
    expect(wrapper.emitted('apply')).toBeTruthy()
    expect(wrapper.emitted('apply')![0]).toEqual([{ operator: 'in', value: ['stop_gained'] }])
  })

  it('emits clear when Clear clicked', async () => {
    const wrapper = mountFilter()
    const clearBtn = wrapper.find('.v-card-actions .v-btn')
    await clearBtn.trigger('click')
    expect(wrapper.emitted('clear')).toBeTruthy()
  })

  it('shows selected count', () => {
    const wrapper = mountFilter({ initialSelected: ['missense_variant', 'stop_gained'] })
    expect(wrapper.text()).toContain('2 selected')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/components/variant-table/CategoricalColumnFilter.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the component**

File: `src/renderer/src/components/variant-table/CategoricalColumnFilter.vue`

```vue
<template>
  <v-card min-width="280" max-width="350">
    <v-card-title class="text-subtitle-2 py-2">Filter: {{ columnTitle }}</v-card-title>
    <v-divider />
    <v-card-text class="pa-3">
      <v-text-field
        v-model="search"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        placeholder="Search values..."
        prepend-inner-icon="mdi-magnify"
        class="mb-2"
      />
      <div class="checkbox-list">
        <v-checkbox
          v-for="val in filteredValues"
          :key="val"
          :model-value="selected.includes(val)"
          :label="val"
          density="compact"
          hide-details
          @update:model-value="toggleValue(val)"
        />
      </div>
      <div class="text-caption text-medium-emphasis mt-2">
        {{ selected.length }} selected
      </div>
    </v-card-text>
    <v-divider />
    <v-card-actions class="pa-2">
      <v-btn size="small" variant="text" @click="emit('clear')">Clear</v-btn>
      <v-btn size="small" variant="text" @click="selectAll">Select All</v-btn>
      <v-spacer />
      <v-btn size="small" color="primary" variant="flat" @click="apply">OK</v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  columnTitle: string
  values: string[]
  initialSelected?: string[]
}>()

const emit = defineEmits<{
  apply: [filter: { operator: 'in'; value: string[] }]
  clear: []
}>()

const search = ref('')
const selected = ref<string[]>(props.initialSelected ? [...props.initialSelected] : [])

const filteredValues = computed(() => {
  if (!search.value) return props.values
  const q = search.value.toLowerCase()
  return props.values.filter((v) => v.toLowerCase().includes(q))
})

function toggleValue(val: string): void {
  if (selected.value.includes(val)) {
    selected.value = selected.value.filter((v) => v !== val)
  } else {
    selected.value = [...selected.value, val]
  }
}

function selectAll(): void {
  selected.value = [...filteredValues.value]
}

function apply(): void {
  emit('apply', { operator: 'in', value: [...selected.value] })
}
</script>

<style scoped>
.checkbox-list {
  max-height: 250px;
  overflow-y: auto;
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/components/variant-table/CategoricalColumnFilter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/variant-table/CategoricalColumnFilter.vue tests/renderer/components/variant-table/CategoricalColumnFilter.test.ts
git commit -m "feat: add CategoricalColumnFilter component

Searchable checkbox list of distinct values from case data.
Select All / Clear helpers. Emits IN operator with selected values."
```

---

### Task 10: TextSuggestColumnFilter component

**Files:**
- Create: `src/renderer/src/components/variant-table/TextSuggestColumnFilter.vue`
- Create: `tests/renderer/components/variant-table/TextSuggestColumnFilter.test.ts`

- [ ] **Step 1: Write the failing test**

File: `tests/renderer/components/variant-table/TextSuggestColumnFilter.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import TextSuggestColumnFilter from '../../../../src/renderer/src/components/variant-table/TextSuggestColumnFilter.vue'

const vuetify = createVuetify()

function mountFilter(props: Record<string, unknown> = {}) {
  return mount(TextSuggestColumnFilter, {
    props: {
      columnTitle: 'Gene',
      suggestions: ['BRCA1', 'BRCA2', 'TP53', 'EGFR'],
      ...props
    },
    global: { plugins: [vuetify] }
  })
}

describe('TextSuggestColumnFilter', () => {
  it('renders column title', () => {
    const wrapper = mountFilter()
    expect(wrapper.text()).toContain('Filter: Gene')
  })

  it('emits apply with like operator', async () => {
    const wrapper = mountFilter({ initialValue: 'BRCA' })
    const applyBtn = wrapper.findAll('.v-card-actions .v-btn').pop()!
    await applyBtn.trigger('click')
    expect(wrapper.emitted('apply')).toBeTruthy()
    expect(wrapper.emitted('apply')![0]).toEqual([{ operator: 'like', value: 'BRCA' }])
  })

  it('emits clear when Clear clicked', async () => {
    const wrapper = mountFilter()
    const clearBtn = wrapper.find('.v-card-actions .v-btn')
    await clearBtn.trigger('click')
    expect(wrapper.emitted('clear')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/components/variant-table/TextSuggestColumnFilter.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the component**

File: `src/renderer/src/components/variant-table/TextSuggestColumnFilter.vue`

```vue
<template>
  <v-card min-width="280" max-width="350">
    <v-card-title class="text-subtitle-2 py-2">Filter: {{ columnTitle }}</v-card-title>
    <v-divider />
    <v-card-text class="pa-3">
      <v-autocomplete
        v-model="filterValue"
        :items="filteredSuggestions"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        placeholder="Type to filter..."
        prepend-inner-icon="mdi-magnify"
        autofocus
        :menu-props="{ maxHeight: 200 }"
        @update:search="onSearch"
      />
    </v-card-text>
    <v-divider />
    <v-card-actions class="pa-2">
      <v-btn size="small" variant="text" @click="emit('clear')">Clear</v-btn>
      <v-spacer />
      <v-btn
        size="small"
        color="primary"
        variant="flat"
        :disabled="!filterValue"
        @click="apply"
      >
        Apply
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  columnTitle: string
  suggestions: string[]
  initialValue?: string
}>()

const emit = defineEmits<{
  apply: [filter: { operator: 'like'; value: string }]
  clear: []
}>()

const filterValue = ref<string | null>(props.initialValue ?? null)
const searchQuery = ref('')

const filteredSuggestions = computed(() => {
  if (!searchQuery.value) return props.suggestions
  const q = searchQuery.value.toLowerCase()
  return props.suggestions.filter((s) => s.toLowerCase().includes(q))
})

function onSearch(query: string): void {
  searchQuery.value = query ?? ''
}

function apply(): void {
  if (filterValue.value) {
    emit('apply', { operator: 'like', value: filterValue.value })
  }
}
</script>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/components/variant-table/TextSuggestColumnFilter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/variant-table/TextSuggestColumnFilter.vue tests/renderer/components/variant-table/TextSuggestColumnFilter.test.ts
git commit -m "feat: add TextSuggestColumnFilter component

Autocomplete text input with suggestions from case data.
Emits LIKE operator for case-insensitive partial matching."
```

---

## Chunk 5: Wire Everything Together

### Task 11: Update VariantColumnHeader to use typed filter components

**Files:**
- Modify: `src/renderer/src/components/variant-table/VariantColumnHeader.vue`

- [ ] **Step 1: Rewrite VariantColumnHeader to route to correct filter**

Replace the filter menu section in the template (lines 15-58) and update the script:

```vue
<template>
  <div
    class="d-flex align-center justify-space-between header-wrapper"
    :class="{ 'filtered-column': hasFilter }"
  >
    <div
      class="d-flex align-center flex-grow-1 sortable-header"
      :class="{ 'sorted-header': isSorted(headerColumn) }"
      @click.stop="toggleSort(headerColumn)"
    >
      <span class="header-title">{{ headerColumn.title }}</span>
      <span v-if="isSorted(headerColumn)" class="sort-indicator ml-1">
        <v-icon size="x-small">{{ getSortIcon(headerColumn) }}</v-icon>
        <span v-if="sortIndex > 0" class="sort-priority">{{ sortIndex }}</span>
      </span>
      <v-icon v-else size="x-small" class="ml-1 sort-icon-inactive">mdi-sort</v-icon>
    </div>
    <v-menu v-model="menuOpen" :close-on-content-click="false" location="bottom">
      <template #activator="{ props: menuProps }">
        <v-btn
          v-bind="menuProps"
          icon
          size="x-small"
          variant="text"
          :color="hasFilter ? 'primary' : undefined"
          @click.stop
        >
          <v-icon size="small">
            {{ hasFilter ? 'mdi-filter' : 'mdi-filter-outline' }}
          </v-icon>
          <v-tooltip activator="parent" location="bottom">Filter this column</v-tooltip>
        </v-btn>
      </template>

      <!-- Numeric filter -->
      <NumericColumnFilter
        v-if="filterMode === 'numeric'"
        :column-title="headerColumn.title"
        :min="columnMeta?.min"
        :max="columnMeta?.max"
        :initial-operator="currentFilter?.operator"
        :initial-value="currentFilter?.value as number | undefined"
        @apply="onApply"
        @clear="onClear"
      />

      <!-- Categorical filter -->
      <CategoricalColumnFilter
        v-else-if="filterMode === 'categorical'"
        :column-title="headerColumn.title"
        :values="columnMeta?.distinctValues ?? []"
        :initial-selected="currentFilter?.operator === 'in' ? (currentFilter.value as string[]) : undefined"
        @apply="onApply"
        @clear="onClear"
      />

      <!-- Text-suggest filter -->
      <TextSuggestColumnFilter
        v-else
        :column-title="headerColumn.title"
        :suggestions="columnMeta?.distinctValues ?? []"
        :initial-value="currentFilter?.operator === 'like' ? (currentFilter.value as string) : undefined"
        @apply="onApply"
        @clear="onClear"
      />
    </v-menu>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ColumnFilter, ColumnFilterMeta, ColumnFilterMode } from '../../../../shared/types/column-filters'
import NumericColumnFilter from './NumericColumnFilter.vue'
import CategoricalColumnFilter from './CategoricalColumnFilter.vue'
import TextSuggestColumnFilter from './TextSuggestColumnFilter.vue'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VuetifyInternalColumn = any

interface SortItem {
  key: string
  order?: boolean | 'asc' | 'desc'
}

interface Props {
  headerColumn: VuetifyInternalColumn
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSortIcon: (...args: any[]) => any
  toggleSort: (column: VuetifyInternalColumn) => void
  isSorted: (column: VuetifyInternalColumn) => boolean
  sortBy?: readonly SortItem[]
  hasFilter: boolean
  /** Current typed column filter (replaces old filterValue: string) */
  currentFilter?: ColumnFilter
  /** Column metadata for auto-detecting filter mode */
  columnMeta?: ColumnFilterMeta
  /** Resolved filter mode for this column */
  filterMode: ColumnFilterMode
}

const props = defineProps<Props>()

const sortIndex = computed(() => {
  if (!props.sortBy || props.sortBy.length <= 1) return 0
  const idx = props.sortBy.findIndex((s) => s.key === props.headerColumn.key)
  return idx >= 0 ? idx + 1 : 0
})

const menuOpen = ref(false)

const emit = defineEmits<{
  'apply-filter': [filter: ColumnFilter]
  'clear-filter': []
}>()

function onApply(filter: ColumnFilter): void {
  emit('apply-filter', filter)
  menuOpen.value = false
}

function onClear(): void {
  emit('clear-filter')
  menuOpen.value = false
}
</script>

<style scoped>
.header-wrapper {
  width: 100%;
  gap: 4px;
}

.filtered-column {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 6%, transparent);
  border-radius: 4px;
  padding: 0 4px;
}

/* ... keep all existing styles ... */
.sortable-header {
  cursor: pointer;
  user-select: none;
  min-width: 0;
}

.sortable-header:hover {
  opacity: 0.7;
}

.sorted-header {
  color: rgb(var(--v-theme-primary));
}

.header-title {
  font-weight: 600;
  font-size: 0.8125rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sort-indicator {
  display: inline-flex;
  align-items: center;
  gap: 1px;
}

.sort-priority {
  font-size: 0.625rem;
  font-weight: 700;
  line-height: 1;
  opacity: 0.8;
}

.sort-icon-inactive {
  opacity: 0.3;
}

.sortable-header:hover .sort-icon-inactive {
  opacity: 0.6;
}
</style>
```

- [ ] **Step 2: Update parent components that use VariantColumnHeader**

Find all usages of `VariantColumnHeader` and update them to pass the new props (`currentFilter`, `columnMeta`, `filterMode`) and handle the new events (`apply-filter`, `clear-filter` instead of `update:filter`).

Search for usages:
```bash
grep -rn "VariantColumnHeader" src/renderer/
```

For each usage, add:
- A computed `columnMetaMap` derived from the `filterOptions.columnMeta` array
- The `detectFilterMode()` call per column
- Wire `@apply-filter` to `setColumnFilter()` and `@clear-filter` to `clearColumnFilter()`

- [ ] **Step 3: Run typecheck and renderer tests**

Run: `make typecheck && npx vitest run tests/renderer/`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/variant-table/VariantColumnHeader.vue
git commit -m "feat: route VariantColumnHeader to typed filter components

Renders NumericColumnFilter, CategoricalColumnFilter, or
TextSuggestColumnFilter based on column metadata and config.
Adds primary tint background to filtered column headers."
```

---

### Task 12: Wire column metadata through the data flow

**Files:**
- Modify: `src/renderer/src/composables/useVariantData.ts` (or wherever filterOptions is consumed)
- Modify: Parent table components that render VariantColumnHeader

- [ ] **Step 1: Store columnMeta from filterOptions response**

In the composable or component that calls `api.variants.filterOptions(caseId)`, extract and store `columnMeta`:

```typescript
const columnMetaMap = computed(() => {
  const map: Record<string, ColumnFilterMeta> = {}
  for (const meta of filterOptions.value.columnMeta ?? []) {
    map[meta.key] = meta
  }
  return map
})
```

- [ ] **Step 2: Compute filter modes per column**

```typescript
import { detectFilterMode } from '../config/columnFilterConfig'

const columnFilterModes = computed(() => {
  const modes: Record<string, ColumnFilterMode> = {}
  for (const meta of filterOptions.value.columnMeta ?? []) {
    modes[meta.key] = detectFilterMode(meta)
  }
  return modes
})
```

- [ ] **Step 3: Pass to VariantColumnHeader in the table template**

In the table component's header slot, update the VariantColumnHeader usage:

```vue
<VariantColumnHeader
  :header-column="column"
  :get-sort-icon="getSortIcon"
  :toggle-sort="toggleSort"
  :is-sorted="isSorted"
  :sort-by="sortBy"
  :has-filter="hasColumnFilter(column.key)"
  :current-filter="getColumnFilter(column.key)"
  :column-meta="columnMetaMap[column.key]"
  :filter-mode="columnFilterModes[column.key] ?? 'text-suggest'"
  @apply-filter="(f) => setColumnFilter(column.key, f)"
  @clear-filter="clearColumnFilter(column.key)"
/>
```

- [ ] **Step 4: Update clear-all to include column filters**

Ensure the toolbar's "Clear" button calls both `clearAllFilters()` (drawer) AND `clearAllColumnFilters()` (column). Check the existing clear handler and add the column filter clear if not already present.

- [ ] **Step 5: Run full test suite and typecheck**

Run: `make typecheck && npx vitest run tests/renderer/`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: wire column metadata and typed filters through data flow

Column metadata from filterOptions drives auto-detection of filter
modes. VariantColumnHeader receives metadata, filter mode, and
current filter. Clear all clears both drawer and column filters."
```

---

## Chunk 6: Final Verification

### Task 13: Run full CI and Playwright E2E test

- [ ] **Step 1: Run lint**

Run: `make lint`
Expected: No errors. Fix any Prettier issues with `--fix`.

- [ ] **Step 2: Run typecheck**

Run: `make typecheck`
Expected: Pass.

- [ ] **Step 3: Run full renderer test suite**

Run: `npx vitest run tests/renderer/`
Expected: All tests pass.

- [ ] **Step 4: Build the app**

Run: `npx electron-vite build`
Expected: Build succeeds.

- [ ] **Step 5: Write Playwright E2E test**

File: `tests/e2e/filter-phase2-column-filters.e2e.ts`

Write a Playwright test that:
1. Launches the app, selects a case
2. Clicks the filter icon on a numeric column (e.g. CADD)
3. Verifies the numeric filter popup appears (operator dropdown + value input)
4. Sets operator to `>=` and value to `20`, clicks Apply
5. Verifies the column header has the filtered visual treatment
6. Verifies an active filter chip appears in the filter bar
7. Clicks the filter icon on a categorical column (e.g. Consequence)
8. Verifies checkboxes appear with available values
9. Takes screenshots at each step

- [ ] **Step 6: Run Playwright test**

Run: `npx playwright test tests/e2e/filter-phase2-column-filters.e2e.ts`
Expected: PASS

- [ ] **Step 7: Commit E2E test**

```bash
git add tests/e2e/filter-phase2-column-filters.e2e.ts
git commit -m "test: add E2E test for Phase 2 per-column typed filters

Verifies numeric filter popup, categorical checkboxes, column
header highlighting, and active filter bar integration."
```
