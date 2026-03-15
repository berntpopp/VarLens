# Filter System Phase 2: Per-Column Filter Enhancement

**Date**: 2026-03-15
**Phase**: 2 of 5 (filter system UX redesign)
**Depends on**: Phase 1 (completed — preset labels, value previews, section headers, filter bar)
**Scope**: Type-aware per-column filters with auto-detection from database metadata

---

## 1. Problem

The current per-column filter is a plain text field with `LIKE '%value%'` behavior applied identically to all columns. Users cannot:
- Do numeric comparisons (`CADD > 20`, `AF <= 0.01`) from column headers
- See available categorical values (consequence types, genotypes) for the current case
- Get auto-suggestions for text columns (genes, transcripts) based on case data

## 2. Solution

Replace the single text filter with three filter modes, **auto-detected from database metadata** per case:

| Mode | When | UI |
|------|------|----|
| **Numeric** | Column is numeric type with many distinct values | Operator dropdown + value input + range hint |
| **Categorical** | Any column with distinct values <= threshold (default 25) | Searchable checkbox list |
| **Text-suggest** | Text column with many distinct values | Text input with autocomplete from case data |

A static config provides overrides for edge cases (e.g. `gene_symbol` always uses text-suggest even with few genes in a small case).

## 3. Column Metadata System

### 3.1 Metadata structure

```typescript
interface ColumnFilterMeta {
  key: string                    // column key (e.g. 'cadd')
  dataType: 'numeric' | 'text'  // inferred from SQLite type affinity
  distinctCount: number          // count of unique non-null values
  distinctValues?: string[]      // populated only if distinctCount <= threshold
  min?: number                   // for numeric columns
  max?: number                   // for numeric columns
}
```

### 3.2 Auto-detection logic

```
if config has forceMode for column → use forced mode
else if dataType === 'numeric' AND distinctCount > threshold → numeric filter
else if distinctCount <= threshold → categorical filter
else → text-suggest filter
```

Default threshold: 25 distinct values. Configurable per-column in overrides.

### 3.3 Static config overrides

File: `src/renderer/src/config/columnFilterConfig.ts`

```typescript
const COLUMN_FILTER_OVERRIDES: Record<string, {
  forceMode?: 'numeric' | 'categorical' | 'text-suggest'
  threshold?: number
}> = {
  gene_symbol: { forceMode: 'text-suggest' },
  chr: { forceMode: 'categorical' },
}

const DEFAULT_CATEGORICAL_THRESHOLD = 25
```

### 3.4 Data source

Extend the existing `variants:filterOptions` IPC response to include `columnMeta: ColumnFilterMeta[]`. This avoids an extra round-trip — metadata is fetched once on case load alongside existing filter options.

Backend queries per filterable column:
```sql
SELECT COUNT(DISTINCT column) as distinct_count,
       MIN(column) as min_val, MAX(column) as max_val
FROM variants WHERE case_id = ?

-- If distinct_count <= threshold:
SELECT DISTINCT column FROM variants WHERE case_id = ? ORDER BY column
```

Metadata is cached until case switch.

## 4. Per-Column Filter UI

### 4.1 Numeric filter popup

```
+-----------------------------------+
| Filter: CADD                      |
+-----------------------------------+
| Operator: [>= v]  Value: [    ]   |
|                                    |
| Range: 0 - 42.00                  |
+-----------------------------------+
|                    [Clear] [Apply] |
+-----------------------------------+
```

- Operator `v-select`: `=`, `!=`, `<`, `>`, `<=`, `>=`
- Number `v-text-field` for value
- Data range hint from metadata (min/max)
- Explicit Apply button (no debounced auto-apply)
- No preset chips — kept minimal, presets live in the drawer

### 4.2 Categorical filter popup

```
+-----------------------------------+
| Filter: Consequence               |
+-----------------------------------+
| [Search values...            ]    |
+-----------------------------------+
| [x] stop_gained                   |
| [ ] missense_variant              |
| [ ] frameshift_variant            |
| [ ] synonymous_variant            |
+-----------------------------------+
| 1 selected                        |
|          [Clear] [Select All] [OK]|
+-----------------------------------+
```

- Search field to narrow the list
- Checkboxes for each distinct value (from metadata)
- No counts next to values
- Select All / Clear helpers
- Summary of selected count at bottom

### 4.3 Text-suggest filter popup

```
+-----------------------------------+
| Filter: Gene                      |
+-----------------------------------+
| [BRCA                        ]    |
| Matching: BRCA1, BRCA2            |
+-----------------------------------+
|                    [Clear] [Apply] |
+-----------------------------------+
```

- Text input with debounced autocomplete
- Suggestions fetched from case data (matching values)
- Partial match (contains) by default

### 4.4 Shared layout

All three variants use the same `v-menu` + `v-card` structure:
- `v-card-title` with column name
- `v-card-text` with filter-specific content
- `v-card-actions` with Clear + Apply/OK
- Card width: 280-350px
- `:close-on-content-click="false"` to keep menu open while interacting

## 5. Column Header Visual Feedback

### 5.1 Filter icon states

| State | Icon | Color | Header background |
|-------|------|-------|-------------------|
| No filter | `mdi-filter-outline` | muted/default | none |
| Filter active | `mdi-filter` (filled) | primary | subtle primary tint (`color-mix(in srgb, primary 6%, transparent)`) |

### 5.2 Active filter bar integration

Column filters appear as chips in the existing active filter bar:
- Numeric: `CADD >= 20`
- Categorical: `Consequence: 3 selected`
- Text: `Gene ~ BRCA`

Chips are closable (clicking X clears that column filter).

### 5.3 Clear all behavior

The toolbar "Clear" button clears BOTH drawer filters AND column filters. Each column filter popup also has its own "Clear" button for individual removal.

Drawer filters and column filters remain independent (AND together). Both filter systems coexist — setting AF in the column header does NOT affect the drawer's AF setting, and vice versa.

## 6. Data Flow & Backend Changes

### 6.1 New column filter IPC structure

Replace `Record<string, string>` with typed structure:

```typescript
interface ColumnFilter {
  operator: '=' | '!=' | '<' | '>' | '<=' | '>=' | 'like' | 'in'
  value: string | number | string[]  // string[] for categorical IN
}

type ColumnFiltersParam = Record<string, ColumnFilter>
```

### 6.2 Type-aware SQL generation

Replace the current `LIKE '%value%'` for all columns with:

| Filter mode | SQL |
|-------------|-----|
| Numeric | `WHERE cadd >= 20` (real comparison operators) |
| Categorical | `WHERE consequence IN ('stop_gained', 'missense_variant')` |
| Text-suggest | `WHERE gene_symbol LIKE '%BRCA%' COLLATE NOCASE` (current behavior) |

Column names validated against `SORTABLE_COLUMNS` whitelist (existing security measure).

### 6.3 Zod schema update

Update `VariantFilterPartialSchema` in `src/shared/types/ipc-schemas.ts` to validate the new `ColumnFilter` structure instead of plain strings.

## 7. File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/renderer/src/config/columnFilterConfig.ts` | Override config, threshold, auto-detect logic |
| Create | `src/renderer/src/components/variant-table/NumericColumnFilter.vue` | Numeric filter popup |
| Create | `src/renderer/src/components/variant-table/CategoricalColumnFilter.vue` | Checkbox filter popup |
| Create | `src/renderer/src/components/variant-table/TextSuggestColumnFilter.vue` | Text input with autocomplete |
| Modify | `src/renderer/src/components/variant-table/VariantColumnHeader.vue` | Route to correct filter component |
| Modify | `src/renderer/src/composables/useColumnFilters.ts` | Typed ColumnFilter structure, active filter bar integration |
| Modify | `src/main/database/VariantRepository.ts` | Type-aware SQL, metadata query |
| Modify | `src/shared/types/filters.ts` | ColumnFilter type, FilterIpcParams update |
| Modify | `src/shared/types/ipc-schemas.ts` | Zod schema for new column filter format |
| Modify | `src/renderer/src/utils/filters/activeFilters.ts` | Column filters in active filter chips |
| Create | `tests/renderer/components/variant-table/NumericColumnFilter.test.ts` | Unit tests |
| Create | `tests/renderer/components/variant-table/CategoricalColumnFilter.test.ts` | Unit tests |
| Create | `tests/renderer/components/variant-table/TextSuggestColumnFilter.test.ts` | Unit tests |
| Create | `tests/renderer/config/columnFilterConfig.test.ts` | Auto-detect logic tests |
| Modify | `tests/renderer/composables/useColumnFilters.test.ts` | Update for typed structure |

No new dependencies. Uses existing Vuetify components and SQLite queries.

## 8. Testing Strategy

- **Unit tests**: Auto-detect logic, column filter config, SQL generation for each filter type
- **Component tests**: Each filter popup renders correctly, emits correct values
- **Integration**: Column filters appear in active filter bar, Clear all clears both systems
- **E2E (Playwright)**: Open column filter on a numeric column, set operator + value, verify table filters
