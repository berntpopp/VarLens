# Phase 7: Filters - Research

**Researched:** 2026-01-26
**Domain:** Vue 3 filter UI with Vuetify 3, debounced inputs, FTS5 search
**Confidence:** HIGH

## Summary

Phase 7 implements a filter toolbar above the variant table that narrows results via gene symbol text input, consequence multi-select dropdown, gnomAD AF maximum threshold, CADD minimum score, and FTS5 full-text search. The user has specified a horizontal toolbar with toggle chips/pills (similar to Varvis design), auto-apply with 300ms debounce, and compact density.

The standard approach uses Vuetify 3 components (v-chip, v-chip-group, v-autocomplete, v-text-field) with Vue 3 Composition API. Filters bind to a reactive filter state object, use watchEffect for auto-applying to the backend (more performant than deep watch), and reset pagination cursors when filters change. The existing database layer already supports all required filters through the VariantFilter interface and getVariants method.

Key technical concerns: debounce cleanup on unmount (memory leak prevention), cursor cache invalidation when filters change (pagination correctness), and v-chip-group state management with arrays (known Vuetify bugs with complex values).

**Primary recommendation:** Use reactive filter state object with watchEffect + debounce wrapper, v-chip-group for preset buttons, v-autocomplete for gene search, v-select for consequence multi-select. Clear cursor cache whenever filters change to maintain pagination correctness.

## Standard Stack

The established libraries/tools for Vue 3 filter UIs with Vuetify 3:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vue 3 | 3.5.27 | Framework with Composition API | Project standard, reactive system for filter state |
| Vuetify 3 | 3.11.7 | Material Design components | Project standard, provides v-chip, v-chip-group, v-autocomplete, v-select |
| TypeScript | 5.9.3 | Type safety | Project standard, strict mode enabled |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| better-sqlite3 | 12.6.2 | Database with FTS5 | Already used, FTS5 virtual table for gene search |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| watchEffect | watch with deep: true | watchEffect more performant for filter objects (only tracks accessed properties vs. recursive tracking) |
| Built-in debounce | lodash.debounce | Built-in avoids dependency, but lodash provides cancel method for cleanup |
| v-chip-group | v-btn-toggle | v-chip-group matches design requirement for colored pills |

**Installation:**
```bash
# All dependencies already installed in package.json
# No additional packages needed
```

## Architecture Patterns

### Recommended Component Structure
```
src/renderer/src/components/
├── VariantTable.vue           # Existing - receives filter state via props
├── FilterToolbar.vue          # NEW - horizontal toolbar with all filters
└── (optional sub-components)
    ├── GeneFilter.vue         # Gene symbol autocomplete input
    ├── ConsequenceFilter.vue  # Multi-select dropdown
    └── NumericFilters.vue     # AF/CADD with preset chips

src/renderer/src/composables/
└── useDebounce.ts             # NEW - reusable debounce composable
```

### Pattern 1: Reactive Filter State with watchEffect

**What:** Single reactive object holding all filter values, watched with watchEffect for auto-apply
**When to use:** Filter UIs with multiple inputs that need coordinated updates

**Example:**
```typescript
// FilterToolbar.vue
import { ref, reactive, watchEffect, onBeforeUnmount } from 'vue'

interface FilterState {
  geneSymbol: string
  consequences: string[]
  maxGnomadAf: number | null
  minCadd: number | null
}

const filters = reactive<FilterState>({
  geneSymbol: '',
  consequences: [],
  maxGnomadAf: null,
  minCadd: null
})

// Debounced filter application
let debounceTimer: ReturnType<typeof setTimeout> | null = null

watchEffect(() => {
  // Access filter properties to track them
  const currentFilters = {
    gene_symbol: filters.geneSymbol,
    consequences: filters.consequences.join(','),
    gnomad_af_max: filters.maxGnomadAf,
    cadd_min: filters.minCadd
  }

  // Clear existing timer
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
  }

  // Apply filters after debounce delay
  debounceTimer = setTimeout(() => {
    applyFilters(currentFilters)
  }, 300)
})

// CRITICAL: Cleanup on unmount to prevent memory leaks
onBeforeUnmount(() => {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
  }
})
```

**Why watchEffect over watch:** watchEffect only tracks properties accessed in the callback, avoiding recursive traversal of the entire filter object. More performant for complex reactive objects.

### Pattern 2: Cursor Cache Invalidation on Filter Change

**What:** Clear pagination cursor cache whenever filters change to prevent stale cursors
**When to use:** Cursor-based pagination with filtering (this project's pattern)

**Example:**
```typescript
// VariantTable.vue - add filter watching
const props = defineProps<{
  caseId: number
  filters: VariantFilter  // NEW prop
}>()

// Clear cache when filters change (existing pattern for sort)
watch(
  () => props.filters,
  () => {
    cursorCache.value.clear()
    page.value = 1
  },
  { deep: true }
)
```

**Critical for correctness:** Cursor values are relative to the filtered dataset. If filters change, cursors from previous filter state become invalid and can return wrong results or skip rows.

### Pattern 3: Preset Quick-Pick Chips with v-chip-group

**What:** Toggle chips that set filter values on click (e.g., "1%", "0.1%", "0.01%" for AF)
**When to use:** Numeric filters with common threshold values (user requirement)

**Example:**
```typescript
<template>
  <!-- AF Presets -->
  <v-chip-group
    v-model="selectedAfPreset"
    selected-class="text-primary"
    column
  >
    <v-chip
      v-for="preset in afPresets"
      :key="preset.value"
      :value="preset.value"
      filter
      variant="outlined"
      size="small"
    >
      {{ preset.label }}
    </v-chip>
  </v-chip-group>

  <!-- Text input for custom values -->
  <v-text-field
    v-model="filters.maxGnomadAf"
    type="number"
    density="compact"
    hide-details
    clearable
  />
</template>

<script setup lang="ts">
const afPresets = [
  { label: '1%', value: 0.01 },
  { label: '0.1%', value: 0.001 },
  { label: '0.01%', value: 0.0001 }
]

const selectedAfPreset = ref<number | null>(null)

// Sync preset selection to filter value
watch(selectedAfPreset, (preset) => {
  if (preset !== null) {
    filters.maxGnomadAf = preset
  }
})

// Sync filter value to preset selection
watch(() => filters.maxGnomadAf, (value) => {
  const matchingPreset = afPresets.find(p => p.value === value)
  selectedAfPreset.value = matchingPreset ? matchingPreset.value : null
})
</script>
```

### Pattern 4: Gene Symbol Autocomplete with FTS5

**What:** Text input with autocomplete suggestions from FTS5 virtual table
**When to use:** Open-ended gene symbol search with prefix matching

**Example:**
```typescript
<template>
  <v-autocomplete
    v-model="filters.geneSymbol"
    :items="geneSymbolSuggestions"
    :loading="loadingSuggestions"
    density="compact"
    clearable
    placeholder="Gene symbol..."
    @update:search="searchGeneSymbols"
  />
</template>

<script setup lang="ts">
const geneSymbolSuggestions = ref<string[]>([])
const loadingSuggestions = ref(false)

// Debounced search for autocomplete
let suggestionTimer: ReturnType<typeof setTimeout> | null = null

const searchGeneSymbols = (query: string) => {
  if (suggestionTimer !== null) {
    clearTimeout(suggestionTimer)
  }

  if (!query || query.length < 2) {
    geneSymbolSuggestions.value = []
    return
  }

  loadingSuggestions.value = true

  suggestionTimer = setTimeout(async () => {
    try {
      // Use FTS5 searchVariants for prefix matching
      const results = await window.api.variants.search(props.caseId, query, 10)
      // Extract unique gene symbols
      geneSymbolSuggestions.value = [
        ...new Set(results.map(v => v.gene_symbol).filter(Boolean))
      ]
    } finally {
      loadingSuggestions.value = false
    }
  }, 200) // Shorter debounce for autocomplete (feels snappier)
}

onBeforeUnmount(() => {
  if (suggestionTimer !== null) {
    clearTimeout(suggestionTimer)
  }
})
</script>
```

**Note:** FTS5 searchVariants method already exists in DatabaseService with prefix matching support (appends * to query).

### Pattern 5: Multi-Select Consequence Dropdown

**What:** Dropdown populated with distinct consequence values from database
**When to use:** Categorical filters with known set of values (user requirement)

**Example:**
```typescript
<template>
  <v-select
    v-model="filters.consequences"
    :items="consequenceOptions"
    multiple
    chips
    closable-chips
    density="compact"
    clearable
    placeholder="Consequence..."
  />
</template>

<script setup lang="ts">
const consequenceOptions = ref<string[]>([])

// Load filter options on mount
onMounted(async () => {
  const options = await window.api.variants.getFilterOptions(props.caseId)
  consequenceOptions.value = options.consequences
})
</script>
```

**IPC handler:** variants:filterOptions already exists, returns distinct consequences from database.

### Anti-Patterns to Avoid

- **Deep watch on filter object:** Use watchEffect instead (more performant, only tracks accessed properties)
- **No debounce cleanup:** Always clear timers in onBeforeUnmount to prevent memory leaks
- **Forgetting cursor invalidation:** Filters changing without clearing cursor cache causes pagination bugs
- **Complex values in v-chip-group:** Use primitives (numbers, strings) as chip values, not arrays or objects (known Vuetify bugs)

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Debounced reactive value | Custom setTimeout/clearTimeout per input | Composable with cleanup logic | Consistent debounce, memory leak prevention, reusable |
| Filter state management | Separate ref for each filter | Reactive filter object | Easier to pass to IPC, atomic state updates |
| Gene symbol suggestions | Custom text matching | FTS5 searchVariants method | Already implemented, handles prefix matching, BM25 ranking |
| Consequence dropdown population | Manual database query | variants:filterOptions IPC | Already implemented, returns distinct values |

**Key insight:** The database layer already has comprehensive filter support. Don't reimplement filtering logic in the frontend - just bind UI inputs to the VariantFilter interface and let the backend handle WHERE clause construction.

## Common Pitfalls

### Pitfall 1: Debounce Timer Memory Leaks

**What goes wrong:** Debounced timers not cleared on component unmount, causing callbacks to fire after component destroyed

**Why it happens:** setTimeout returns a timer ID that must be explicitly cleared. Vue doesn't auto-cleanup timers on unmount.

**How to avoid:**
```typescript
let timer: ReturnType<typeof setTimeout> | null = null

onBeforeUnmount(() => {
  if (timer !== null) {
    clearTimeout(timer)
  }
})
```

**Warning signs:** Console errors about accessing reactive state after unmount, increased memory usage over time

### Pitfall 2: Stale Pagination Cursors After Filter Change

**What goes wrong:** Cursor values become invalid when filters change, causing wrong results or skipped rows

**Why it happens:** Cursors are keyset-based (sort_value, id), relative to the current filtered dataset. Different filter = different dataset = invalid cursor.

**How to avoid:**
```typescript
watch(
  () => props.filters,
  () => {
    cursorCache.value.clear()
    page.value = 1
  },
  { deep: true }
)
```

**Warning signs:** Table shows wrong rows on page 2+, duplicate rows across pages, "Showing X of Y" count doesn't match actual results

### Pitfall 3: v-chip-group State Management with Arrays

**What goes wrong:** Vuetify 3.3.11 has a bug where v-chip with array values don't show selected styling correctly

**Why it happens:** Vuetify's internal comparison logic for arrays is flawed in this version

**How to avoid:** Use primitive values (numbers or strings) as chip values, not arrays or objects
```typescript
// BAD
<v-chip :value="[0.01, 'AF']">1%</v-chip>

// GOOD
<v-chip :value="0.01">1%</v-chip>
```

**Warning signs:** Chips don't show active state when selected, v-model updates but visual feedback missing

### Pitfall 4: Deep Reactivity Performance with Large Filter Objects

**What goes wrong:** Using watch with `deep: true` on filter object causes performance issues

**Why it happens:** Deep watch recursively tracks every nested property, creating thousands of dependencies for complex objects

**How to avoid:** Use watchEffect (only tracks accessed properties) or watch specific filter keys individually

**Warning signs:** Lag when typing in filter inputs, multiple re-renders per keystroke, high CPU usage

### Pitfall 5: Not Handling Null Values in Numeric Filters

**What goes wrong:** Database has null CADD/AF values, filter logic must explicitly handle nulls per D018 decision

**Why it happens:** SQL NULL handling is non-intuitive (NULL != any value, including NULL)

**How to avoid:** Backend already handles this correctly:
- gnomad_af_max: `(gnomad_af IS NULL OR gnomad_af <= ?)` (includes nulls)
- cadd_min: `(cadd IS NOT NULL AND cadd >= ?)` (excludes nulls)

**Warning signs:** Filter results exclude expected rows with null values, or include unexpected nulls

### Pitfall 6: Race Conditions with Multiple Debounced Filters

**What goes wrong:** Fast filter changes cause multiple debounced callbacks queued, last-set filter may not be last-applied

**Why it happens:** Each filter input has separate debounce timer, timers can fire out of order

**How to avoid:** Use single debounce point for all filters (watchEffect on entire filter object) rather than per-input debounce

**Warning signs:** Filter results don't match current UI state, intermediate filter states flash briefly

## Code Examples

Verified patterns from database layer and Vue/Vuetify documentation:

### Existing Database Filter Support (DatabaseService.ts)
```typescript
// Source: /home/bernt-popp/development/varlens/src/main/database/DatabaseService.ts
// Lines 397-477

getVariants(
  filter: VariantFilter,
  limit: number,
  cursor?: PaginationCursor,
  sortBy?: SortItem[]
): PaginatedResult<Variant> {
  // Build dynamic WHERE clause
  const conditions: string[] = ['case_id = ?']
  const params: (string | number | null)[] = [filter.case_id]

  if (filter.gene_symbol !== undefined && filter.gene_symbol !== '') {
    conditions.push('gene_symbol LIKE ?')
    params.push(`%${filter.gene_symbol}%`)
  }

  if (filter.consequence !== undefined && filter.consequence !== '') {
    conditions.push('consequence = ?')
    params.push(filter.consequence)
  }

  if (filter.gnomad_af_max !== undefined) {
    conditions.push('(gnomad_af IS NULL OR gnomad_af <= ?)')
    params.push(filter.gnomad_af_max)
  }

  if (filter.cadd_min !== undefined) {
    conditions.push('(cadd IS NOT NULL AND cadd >= ?)')
    params.push(filter.cadd_min)
  }

  // ... pagination logic ...
}
```

### FTS5 Search for Gene Autocomplete (DatabaseService.ts)
```typescript
// Source: /home/bernt-popp/development/varlens/src/main/database/DatabaseService.ts
// Lines 490-507

searchVariants(caseId: number, query: string, limit: number = 50): Variant[] {
  // Append * for prefix matching and quote the query for safety
  const ftsQuery = `"${query.replace(/"/g, '""')}"*`

  const results = this.db
    .prepare(
      `
      SELECT v.* FROM variants v
      JOIN variants_fts fts ON v.id = fts.rowid
      WHERE v.case_id = ? AND variants_fts MATCH ?
      ORDER BY bm25(variants_fts)
      LIMIT ?
    `
    )
    .all(caseId, ftsQuery, limit) as Variant[]

  return results
}
```

**Note:** FTS5 prefix matching automatically appends `*` to query. Returns results ranked by BM25 relevance score.

### Existing IPC Preload Bridge (preload/index.ts)
```typescript
// Source: /home/bernt-popp/development/varlens/src/preload/index.ts
// Lines 21-27

variants: {
  query: (
    caseId: number,
    filters: Omit<VariantFilter, 'case_id'>,
    cursor?: PaginationCursor,
    limit?: number,
    sortBy?: SortItem[]
  ) => ipcRenderer.invoke('variants:query', caseId, filters, cursor, limit, sortBy),

  getFilterOptions: (caseId: number) => ipcRenderer.invoke('variants:filterOptions', caseId)
}
```

**Note:** IPC layer already supports filters parameter. Just needs frontend UI to populate it.

### Filter Options IPC Handler (ipc/handlers/variants.ts)
```typescript
// Source: /home/bernt-popp/development/varlens/src/main/ipc/handlers/variants.ts
// Lines 30-65

ipcMain.handle('variants:filterOptions', async (_event, caseId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()

    // Get distinct consequences
    const consequencesResult = db.database
      .prepare(
        'SELECT DISTINCT consequence FROM variants WHERE case_id = ? AND consequence IS NOT NULL ORDER BY consequence'
      )
      .all(caseId) as { consequence: string }[]

    // Get CADD range
    const caddRange = db.database
      .prepare(
        'SELECT MIN(cadd) as min_cadd, MAX(cadd) as max_cadd FROM variants WHERE case_id = ? AND cadd IS NOT NULL'
      )
      .get(caseId) as { min_cadd: number | null; max_cadd: number | null } | undefined

    // Get gnomAD AF range
    const afRange = db.database
      .prepare(
        'SELECT MIN(gnomad_af) as min_af, MAX(gnomad_af) as max_af FROM variants WHERE case_id = ? AND gnomad_af IS NOT NULL'
      )
      .get(caseId) as { min_af: number | null; max_af: number | null } | undefined

    const filterOptions: FilterOptions = {
      consequences: consequencesResult.map((r) => r.consequence),
      minCadd: caddRange?.min_cadd ?? null,
      maxCadd: caddRange?.max_cadd ?? null,
      minGnomadAf: afRange?.min_af ?? null,
      maxGnomadAf: afRange?.max_af ?? null
    }

    return filterOptions
  })
})
```

**Note:** Returns distinct consequences and min/max ranges for CADD and gnomAD AF. Call once on case load to populate dropdowns.

### Vuetify Chip Component Pattern
```typescript
// Pattern: Toggle chips with filter variant
// Source: Vuetify 3 documentation + user requirements

<v-chip
  filter
  variant="outlined"
  color="primary"
  :model-value="isActive"
  @click="toggle"
>
  Label
</v-chip>
```

**Props:**
- `filter`: Shows check icon when active (Material Design filter chip pattern)
- `variant="outlined"`: Outlined style when inactive
- `color`: Color when active
- `closable`: Shows X to remove (for selected items in multi-select)

### Clear All Filters Button
```typescript
// Pattern: Show Clear All button when any filter is active

<template>
  <v-btn
    v-if="hasActiveFilters"
    variant="text"
    size="small"
    prepend-icon="mdi-close"
    @click="clearAllFilters"
  >
    Clear All
  </v-btn>
</template>

<script setup lang="ts">
const hasActiveFilters = computed(() => {
  return (
    filters.geneSymbol !== '' ||
    filters.consequences.length > 0 ||
    filters.maxGnomadAf !== null ||
    filters.minCadd !== null
  )
})

const clearAllFilters = () => {
  filters.geneSymbol = ''
  filters.consequences = []
  filters.maxGnomadAf = null
  filters.minCadd = null
}
</script>
```

### Result Count Display
```typescript
// Pattern: Show filtered count vs total count

<template>
  <span class="text-caption text-grey">
    Showing {{ filteredCount.toLocaleString() }}
    <template v-if="filteredCount !== totalCount">
      of {{ totalCount.toLocaleString() }}
    </template>
    variants
  </span>
</template>

<script setup lang="ts">
// totalCount from PaginatedResult.total_count (filtered count)
// To show "X of Y", need to fetch unfiltered count once on case load
const unfilteredCount = ref(0)

onMounted(async () => {
  const result = await window.api.variants.query(props.caseId, {}, undefined, 1)
  unfilteredCount.value = result.total_count
})
</script>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Options API with data() | Composition API with reactive() | Vue 3 (2020) | Better logic organization, reusable composables |
| Manual v-model on each input | watchEffect on filter object | Vue 3 (2020) | Single debounce point, fewer watchers |
| watch with deep: true | watchEffect for filter objects | Vue 3 (2020) | Better performance, automatic dependency tracking |
| v-btn-toggle | v-chip-group | Vuetify 3 (2022) | Material Design 3, better for filter chips |
| beforeDestroy | onBeforeUnmount | Vue 3 (2020) | Composition API lifecycle hook |
| Offset pagination | Cursor pagination | N/A (project choice) | Stable pagination with concurrent writes |

**Deprecated/outdated:**
- Vuetify 2 prop names: `item-text` → `item-title`, `item-value` remains same
- Vue 2 lifecycle: `beforeDestroy` → `onBeforeUnmount` (Composition API)
- Deep watchers for filter objects: watchEffect is now preferred pattern

## Open Questions

Things that couldn't be fully resolved:

1. **Should FTS5 search be a separate filter or integrated with gene symbol filter?**
   - What we know: DatabaseService has separate searchVariants method using FTS5
   - What's unclear: User requirement FLT-06 says "FTS5 search integration" but doesn't specify UI
   - Recommendation: Start with gene symbol autocomplete using FTS5 (matches user's "text filter" requirement). Add separate full-text search box only if user requests it.

2. **How to handle consequence filter when consequence field allows multiple values?**
   - What we know: Database schema shows consequence as single string field (nullable)
   - What's unclear: Do variants have comma-separated consequences, or always single value?
   - Recommendation: Implement as exact match (existing backend uses `consequence = ?`). If multi-value needed later, change to `consequence LIKE ?` with wildcards.

3. **Should filter state persist across case switches?**
   - What we know: Filters apply to selected case (VariantFilter.case_id required)
   - What's unclear: User expectation when switching cases - keep same filters or reset?
   - Recommendation: Clear filters on case switch (different cases have different consequence lists, gene sets). Less confusing than applying same filters to different data.

4. **Exact threshold behavior for AF and CADD filters**
   - What we know: Backend uses `<=` for AF max, `>=` for CADD min
   - What's unclear: Should UI show "up to" vs "at most" language?
   - Recommendation: Use "Max AF" and "Min CADD" labels (matches scientific convention). Inclusive bounds are intuitive for thresholds.

## Sources

### Primary (HIGH confidence)
- DatabaseService.ts - Existing filter implementation: /home/bernt-popp/development/varlens/src/main/database/DatabaseService.ts
- Existing IPC handlers: /home/bernt-popp/development/varlens/src/main/ipc/handlers/variants.ts
- Database types: /home/bernt-popp/development/varlens/src/main/database/types.ts
- Package.json versions: /home/bernt-popp/development/varlens/package.json
- Phase context: .planning/phases/07-filters/07-CONTEXT.md

### Secondary (MEDIUM confidence)
- [Vue 3 Official Composables Guide](https://vuejs.org/guide/reusability/composables.html) - Composable patterns
- [Vue 3 Official Watchers Guide](https://vuejs.org/guide/essentials/watchers) - watch vs watchEffect
- [Vuetify 3 Chip Component](https://vuetifyjs.com/en/components/chips/) - v-chip API
- [Vuetify 3 Chip Group Component](https://vuetifyjs.com/en/components/chip-groups/) - v-chip-group API
- [Vuetify 3 Select Component](https://vuetifyjs.com/en/components/selects/) - v-select API
- [SQLite FTS5 Extension](https://sqlite.org/fts5.html) - FTS5 prefix matching
- [Skeleton Loading UX Best Practices - LogRocket](https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/) - Loading state patterns
- [Filter UX Design Patterns - Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-filtering) - Clear button patterns

### Tertiary (LOW confidence - flagged for validation)
- [Vue Debounce Patterns - Cloudinary](https://cloudinary.com/guides/web-performance/vue-debounce) - General debounce guidance
- [How to Create Debounced Ref - The Road to Enterprise](https://theroadtoenterprise.com/blog/how-to-create-a-debounced-ref-in-vue-3-using-composition-api) - customRef pattern
- [Vue 3 Performance Pitfalls - Medium](https://medium.com/simform-engineering/7-vue-3-performance-pitfalls-that-quietly-derail-your-app-33c7180d68d4) - Deep watch performance
- [Avoiding Memory Leaks - Vue 2 Cookbook](https://v2.vuejs.org/v2/cookbook/avoiding-memory-leaks.html?redirect=true) - Cleanup patterns
- [Vuetify GitHub Issues](https://github.com/vuetifyjs/vuetify/issues/18855) - v-chip-group array bug

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All dependencies already in package.json, versions verified
- Architecture: HIGH - Database layer already implements filters, IPC layer exists, only frontend UI needed
- Pitfalls: HIGH - Identified from existing codebase patterns (cursor cache) and documented Vuetify bugs
- Code examples: HIGH - All examples from actual project files or official documentation

**Research date:** 2026-01-26
**Valid until:** 30 days (2026-02-25) - Stable domain, Vue 3 and Vuetify 3 APIs stable, but monitor for Vuetify bug fixes
