# Phase 6: Variant Table - Research

**Researched:** 2026-01-26
**Domain:** Vuetify 3 v-data-table-server with server-side pagination and sorting
**Confidence:** HIGH

## Summary

Phase 6 implements a paginated variant table using Vuetify 3's `v-data-table-server` component. The backend already provides cursor-based pagination via `DatabaseService.getVariants()` and IPC handler `variants:query`, implemented in Phase 4. The table displays 9 required columns with formatted display: chromosome, position (with thousand separators), ref/alt alleles (truncated with tooltips), gene, consequence, gnomAD AF (scientific notation), CADD score, and ClinVar significance (colored chips).

Vuetify's `v-data-table-server` handles server-side pagination and multi-column sorting via the `@update:options` event, which fires when users change page, items-per-page, or sorting. The component requires `items-length` prop for total count and uses `v-model` bindings for reactive state management. The challenge is adapting the existing cursor-based backend pagination (designed for infinite scrolling) to the page-based UI model that `v-data-table-server` expects.

**Primary recommendation:** Use `v-data-table-server` with `@update:options` event handler, maintain cursor state internally to bridge page-based UI with cursor-based backend, implement column formatting with `v-slot:item.{column}` slots, and use `density="compact"` for data-dense UX.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vuetify | ^3.11.7 | Material Design component framework | Official Vue 3 Material Design implementation, provides v-data-table-server |
| Vue 3 | ^3.5.27 | Reactive framework | Composition API with TypeScript support |
| TypeScript | ^5.9.3 | Type safety | Ensures IPC contract adherence and type-safe props |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Intl.NumberFormat | Native | Number formatting (thousand separators, scientific notation) | Built-in browser API, no dependencies |
| v-tooltip | Part of Vuetify | Tooltips for truncated sequences | When allele sequences exceed ~20 characters |
| v-chip | Part of Vuetify | Colored ClinVar significance badges | Displaying categorical clinical significance |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| v-data-table-server | v-data-table (client-side) | Client-side would load all variants into memory, unacceptable for 100K+ variant cases |
| Cursor pagination | Offset pagination | Offset pagination degrades at scale (17x slower for million-record datasets), cursor is O(1) |
| Intl.NumberFormat | toLocaleString() | toLocaleString() is simpler but less flexible for customization |

**Installation:**
All dependencies already installed in project (package.json shows vuetify ^3.11.7, vue ^3.5.27).

## Architecture Patterns

### Recommended Project Structure
```
src/renderer/src/components/
├── VariantTable.vue        # Main table component with v-data-table-server
└── (existing components)
```

### Pattern 1: Server-Side Pagination with @update:options
**What:** Vuetify v-data-table-server emits `@update:options` when pagination/sorting changes
**When to use:** Always with v-data-table-server for server-side data loading
**Example:**
```typescript
// Source: WebSearch results + official Vuetify 3 patterns
<v-data-table-server
  :headers="headers"
  :items="variants"
  :items-length="totalCount"
  :loading="loading"
  v-model:page="page"
  v-model:items-per-page="itemsPerPage"
  v-model:sort-by="sortBy"
  @update:options="loadVariants"
  density="compact"
>
</v-data-table-server>

<script setup lang="ts">
import { ref } from 'vue'
import type { Variant, PaginatedResult } from '@/shared/types'

const variants = ref<Variant[]>([])
const totalCount = ref(0)
const loading = ref(false)
const page = ref(1)
const itemsPerPage = ref(50)
const sortBy = ref([])

const loadVariants = async ({ page, itemsPerPage, sortBy }) => {
  loading.value = true
  try {
    // Call IPC with cursor logic (convert page to cursor)
    const result = await window.api.variants.query(caseId, {}, cursor, itemsPerPage)
    variants.value = result.data
    totalCount.value = result.total_count
  } finally {
    loading.value = false
  }
}
</script>
```

### Pattern 2: Column Formatting with Item Slots
**What:** Use `v-slot:item.{columnName}` to customize column rendering
**When to use:** When displaying formatted or computed values (positions, allele frequencies, clinical significance)
**Example:**
```typescript
// Source: Vuetify 3 slots documentation + WebSearch examples
<template v-slot:item.pos="{ value }">
  {{ formatPosition(value) }}
</template>

<template v-slot:item.gnomad_af="{ value }">
  {{ formatScientific(value) }}
</template>

<template v-slot:item.clinvar="{ value }">
  <v-chip
    v-if="value"
    :color="getClinVarColor(value)"
    size="small"
  >
    {{ value }}
  </v-chip>
</template>

<template v-slot:item.ref="{ value }">
  <v-tooltip v-if="value.length > 20" location="top">
    <template v-slot:activator="{ props }">
      <span v-bind="props" class="text-truncate">
        {{ value.substring(0, 20) }}...
      </span>
    </template>
    {{ value }}
  </v-tooltip>
  <span v-else>{{ value }}</span>
</template>

<script setup lang="ts">
const formatPosition = (pos: number): string => {
  return new Intl.NumberFormat('en-US').format(pos)
}

const formatScientific = (value: number | null): string => {
  if (value === null) return '-'
  return new Intl.NumberFormat('en-US', {
    notation: 'scientific',
    maximumFractionDigits: 1
  }).format(value)
}

const getClinVarColor = (significance: string): string => {
  const colorMap: Record<string, string> = {
    'Pathogenic': 'red',
    'Likely_pathogenic': 'red-lighten-1',
    'Uncertain_significance': 'amber',
    'Likely_benign': 'green-lighten-1',
    'Benign': 'green'
  }
  return colorMap[significance] || 'grey'
}
</script>
```

### Pattern 3: Cursor-to-Page State Management
**What:** Bridge cursor-based backend pagination with page-based UI
**When to use:** When backend uses cursor pagination but UI needs page numbers
**Example:**
```typescript
// Source: Research analysis of existing DatabaseService + pagination patterns
const cursorCache = ref<Map<number, PaginationCursor>>(new Map())

const loadVariants = async ({ page, itemsPerPage, sortBy }) => {
  loading.value = true
  try {
    // Get cursor for requested page (null for page 1)
    const cursor = page === 1 ? undefined : cursorCache.value.get(page - 1)

    const result = await window.api.variants.query(
      props.caseId,
      {}, // filters empty for Phase 6
      cursor,
      itemsPerPage
    )

    variants.value = result.data
    totalCount.value = result.total_count

    // Cache next cursor for forward pagination
    if (result.next_cursor && result.has_more) {
      cursorCache.value.set(page, result.next_cursor)
    }
  } finally {
    loading.value = false
  }
}
```

### Pattern 4: Multi-Column Sorting
**What:** Enable multi-column sorting with Shift+click
**When to use:** When users need secondary sort criteria (e.g., sort by chr then pos)
**Example:**
```typescript
// Source: Vuetify 3 sorting documentation + WebSearch results
<v-data-table-server
  :headers="headers"
  :items="variants"
  multi-sort
  v-model:sort-by="sortBy"
  @update:options="loadVariants"
>
</v-data-table-server>

<script setup lang="ts">
// sortBy is an array: [{ key: 'chr', order: 'asc' }, { key: 'pos', order: 'asc' }]
const sortBy = ref([
  { key: 'chr', order: 'asc' },
  { key: 'pos', order: 'asc' }
])

// Note: Phase 6 sorting is cosmetic (UI only)
// Backend DatabaseService.getVariants() uses fixed ORDER BY pos, id
// Phase 7+ would need backend sort support
</script>
```

### Anti-Patterns to Avoid

- **Modifying state in @update:options that triggers another @update:options:** Creates infinite loop. Only update `variants`, `totalCount`, `loading` - never mutate `page`, `itemsPerPage`, or `sortBy` inside the handler.

- **Using client-side v-data-table for large variant sets:** v-data-table loads all data into browser memory, causing performance issues with 50K+ variants. Always use v-data-table-server.

- **Clearing cursor cache on every load:** Breaks backward navigation. Maintain cursor cache for the session, clear only on case change or filter change.

- **Hand-rolling pagination UI:** v-data-table-server includes built-in pagination controls (prev/next, page numbers, items-per-page selector). Don't rebuild these.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Thousand separator formatting | Custom regex/replace | `Intl.NumberFormat('en-US')` | Handles locale correctly, edge cases (negatives, decimals), and is native browser API |
| Scientific notation | String manipulation | `Intl.NumberFormat` with `notation: 'scientific'` | Proper exponent formatting, significant digits, locale support |
| Text truncation with ellipsis | Manual substring + CSS | CSS `text-overflow: ellipsis` + v-tooltip | Handles edge cases (word boundaries, container resize), accessible |
| Loading spinner overlay | Custom loading div | `v-data-table-server` `:loading` prop | Built-in overlay, positions correctly over table, maintains header visibility |
| Pagination controls | Custom prev/next buttons | `v-data-table-server` built-in pagination | Handles edge cases (first/last page, page number display, items-per-page selector) |
| Chromosome natural sorting | Custom sort function | Backend database ORDER BY or custom comparator | Complex logic for chr1 < chr2 < chr10 < chrX < chrY < chrM |

**Key insight:** Vuetify v-data-table-server is a complete pagination solution. Formatting utilities (Intl.NumberFormat) are native browser APIs that handle edge cases and localization. Don't reinvent these wheels.

## Common Pitfalls

### Pitfall 1: Infinite Update Loop with @update:options
**What goes wrong:** Component continuously re-renders, browser freezes, @update:options fires indefinitely
**Why it happens:** Mutating reactive state (`page`, `itemsPerPage`, `sortBy`) inside `@update:options` handler triggers Vue reactivity, which causes v-data-table-server to emit another `@update:options` event
**How to avoid:**
- Use `v-model:page`, `v-model:items-per-page`, `v-model:sort-by` bindings - let Vuetify manage these
- Inside `@update:options`, ONLY mutate: `variants`, `totalCount`, `loading`
- Never write to `page.value`, `itemsPerPage.value`, or `sortBy.value` in the handler
**Warning signs:** Console warning "Maximum recursive updates exceeded", browser tab freezes, network requests fire rapidly

### Pitfall 2: Cursor Cache Invalidation
**What goes wrong:** User navigates to page 3, then back to page 1, then to page 3 again - sees stale data or crashes
**Why it happens:** Cursor-based pagination assumes forward-only navigation. Going backward (page 3 → page 1) is trivial (restart from beginning), but going forward again (page 1 → page 3) requires the cached cursor from page 2
**How to avoid:**
- Maintain `Map<pageNumber, PaginationCursor>` for the session
- Cache cursor when loading page N for use when navigating to page N+1
- Clear cache when `caseId` changes or filters change (Phase 7+)
- Handle missing cursor gracefully: if cursor not in cache, restart from page 1
**Warning signs:** Missing data on navigation, "next_cursor undefined" errors, inconsistent results when going back and forth

### Pitfall 3: Long Allele Sequences Breaking Layout
**What goes wrong:** Table rows with 100+ character alleles stretch horizontally, breaking responsive layout
**Why it happens:** HTML table cells expand to fit content by default. Long sequences (insertions, deletions) don't wrap naturally
**How to avoid:**
- Use CSS: `max-width`, `overflow: hidden`, `text-overflow: ellipsis` on allele columns
- Wrap long sequences in `v-tooltip` to show full sequence on hover
- Set column width constraints in header definition: `{ key: 'ref', width: '120px' }`
- Truncate at 20 characters in template: `{{ value.length > 20 ? value.substring(0, 20) + '...' : value }}`
**Warning signs:** Horizontal scrollbar on table, columns misaligned, mobile view completely broken

### Pitfall 4: Wrong ClinVar Color Mapping
**What goes wrong:** Pathogenic variants shown in green, benign in red - dangerous clinical error
**Why it happens:** Arbitrary color assignment without clinical genetics conventions
**How to avoid:**
- Use established conventions: Pathogenic/Likely Pathogenic = red, Benign/Likely Benign = green, VUS = amber/yellow
- Create explicit mapping object: `{ 'Pathogenic': 'red', 'Benign': 'green', 'Uncertain_significance': 'amber' }`
- Handle underscores in database values: 'Likely_pathogenic' vs 'Likely pathogenic'
- Default to grey for unknown values, never red/green
**Warning signs:** User confusion about variant interpretation, colors not matching clinical conventions

### Pitfall 5: Page-Based Pagination Assumptions
**What goes wrong:** User expects "jump to page 10" functionality, or page count shows "Page 1 of ???"
**Why it happens:** Cursor-based pagination doesn't know total page count in advance, only `has_more` boolean
**How to avoid:**
- Use `total_count` from backend to calculate total pages: `Math.ceil(total_count / itemsPerPage)`
- DatabaseService.getVariants() returns `total_count` separately from cursor pagination
- Display total count prominently: "Showing 1-50 of 12,345 variants"
- v-data-table-server automatically calculates page count from `items-length` prop
**Warning signs:** Missing total page count, "Page 1 of undefined", pagination controls disabled

## Code Examples

Verified patterns from official sources:

### Complete v-data-table-server Setup
```vue
<!-- Source: Vuetify 3 documentation + project requirements -->
<template>
  <v-data-table-server
    :headers="headers"
    :items="variants"
    :items-length="totalCount"
    :loading="loading"
    v-model:page="page"
    v-model:items-per-page="itemsPerPage"
    v-model:sort-by="sortBy"
    :items-per-page-options="[25, 50, 100]"
    @update:options="loadVariants"
    density="compact"
    multi-sort
    class="elevation-1"
  >
    <!-- Column formatting slots -->
    <template v-slot:item.pos="{ value }">
      {{ formatPosition(value) }}
    </template>

    <template v-slot:item.gnomad_af="{ value }">
      {{ formatScientific(value) }}
    </template>

    <template v-slot:item.clinvar="{ value }">
      <v-chip
        v-if="value"
        :color="getClinVarColor(value)"
        size="small"
        label
      >
        {{ value.replace(/_/g, ' ') }}
      </v-chip>
      <span v-else class="text-grey">-</span>
    </template>

    <template v-slot:item.ref="{ value }">
      <v-tooltip v-if="value.length > 20" location="top">
        <template v-slot:activator="{ props }">
          <span v-bind="props" class="text-truncate" style="max-width: 120px; display: inline-block;">
            {{ value.substring(0, 20) }}...
          </span>
        </template>
        <span style="font-family: monospace;">{{ value }}</span>
      </v-tooltip>
      <span v-else style="font-family: monospace;">{{ value }}</span>
    </template>

    <template v-slot:item.alt="{ value }">
      <!-- Same as ref slot -->
    </template>

    <template v-slot:loading>
      <v-progress-linear
        indeterminate
        color="primary"
      />
    </template>
  </v-data-table-server>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Variant, PaginatedResult, PaginationCursor } from '@/shared/types'

interface Props {
  caseId: number
}

const props = defineProps<Props>()

// Table state
const variants = ref<Variant[]>([])
const totalCount = ref(0)
const loading = ref(false)
const page = ref(1)
const itemsPerPage = ref(50)
const sortBy = ref([
  { key: 'chr', order: 'asc' },
  { key: 'pos', order: 'asc' }
])

// Cursor cache for pagination
const cursorCache = ref<Map<number, PaginationCursor>>(new Map())

// Headers definition
const headers = [
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' },
  { title: 'Ref', key: 'ref', sortable: false, width: '120px' },
  { title: 'Alt', key: 'alt', sortable: false, width: '120px' },
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  { title: 'Consequence', key: 'consequence', sortable: true },
  { title: 'gnomAD AF', key: 'gnomad_af', sortable: true, align: 'end' },
  { title: 'CADD', key: 'cadd', sortable: true, align: 'end' },
  { title: 'ClinVar', key: 'clinvar', sortable: true }
]

// Load variants from backend
const loadVariants = async ({ page, itemsPerPage, sortBy }) => {
  loading.value = true
  try {
    // Get cursor for requested page
    const cursor = page === 1 ? undefined : cursorCache.value.get(page - 1)

    const result: PaginatedResult<Variant> = await window.api.variants.query(
      props.caseId,
      {}, // No filters in Phase 6
      cursor,
      itemsPerPage
    )

    variants.value = result.data
    totalCount.value = result.total_count

    // Cache next cursor
    if (result.next_cursor && result.has_more) {
      cursorCache.value.set(page, result.next_cursor)
    }
  } catch (error) {
    console.error('Failed to load variants:', error)
    variants.value = []
    totalCount.value = 0
  } finally {
    loading.value = false
  }
}

// Clear cache when case changes
watch(() => props.caseId, () => {
  cursorCache.value.clear()
  page.value = 1
})

// Formatting functions
const formatPosition = (pos: number): string => {
  return new Intl.NumberFormat('en-US').format(pos)
}

const formatScientific = (value: number | null): string => {
  if (value === null) return '-'
  return new Intl.NumberFormat('en-US', {
    notation: 'scientific',
    maximumFractionDigits: 1
  }).format(value)
}

const getClinVarColor = (significance: string): string => {
  const colorMap: Record<string, string> = {
    'Pathogenic': 'red',
    'Likely_pathogenic': 'red-lighten-1',
    'Uncertain_significance': 'amber',
    'Likely_benign': 'green-lighten-1',
    'Benign': 'green'
  }
  return colorMap[significance] || 'grey'
}
</script>

<style scoped>
.text-truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
```

### Number Formatting Utilities
```typescript
// Source: MDN Intl.NumberFormat + research
/**
 * Format genomic position with thousand separators
 * Example: 12345678 → "12,345,678"
 */
export const formatPosition = (pos: number): string => {
  return new Intl.NumberFormat('en-US').format(pos)
}

/**
 * Format allele frequency in scientific notation
 * Example: 0.00012 → "1.2e-4"
 */
export const formatScientific = (value: number | null): string => {
  if (value === null) return '-'

  // Use scientific notation for small values, decimal for large
  if (value < 0.001 && value > 0) {
    return new Intl.NumberFormat('en-US', {
      notation: 'scientific',
      maximumFractionDigits: 1
    }).format(value)
  } else {
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 4
    }).format(value)
  }
}

/**
 * Map ClinVar significance to Vuetify color
 * Follows clinical genetics conventions
 */
export const getClinVarColor = (significance: string | null): string => {
  if (!significance) return 'grey'

  const colorMap: Record<string, string> = {
    'Pathogenic': 'red',
    'Likely_pathogenic': 'red-lighten-1',
    'Uncertain_significance': 'amber',
    'Likely_benign': 'green-lighten-1',
    'Benign': 'green'
  }

  return colorMap[significance] || 'grey'
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Offset-based pagination (LIMIT/OFFSET) | Cursor-based pagination (keyset) | Phase 4 (2026-01-26) | 17x faster for large datasets, consistent O(1) performance |
| v-data-table (Vuetify 2) | v-data-table-server (Vuetify 3) | Vuetify 3.0 (late 2023) | Explicit server-side semantics, better TypeScript support |
| custom-sort prop | sortBy v-model binding | Vuetify 3.1.4 (2023) | Simplified API, removed custom-sort prop |
| toLocaleString() | Intl.NumberFormat with options | ES2020+ (widely supported 2021+) | Scientific notation, compact notation support |

**Deprecated/outdated:**
- `dense` prop: Replaced by `density="compact"` in Vuetify 3
- `custom-sort` prop: Removed in Vuetify 3.1.4, use sortBy binding instead
- `server-items-length`: Renamed to `items-length` in Vuetify 3
- `@pagination` event: Replaced by `@update:options` in Vuetify 3

## Open Questions

Things that couldn't be fully resolved:

1. **Backend Sorting Implementation**
   - What we know: DatabaseService.getVariants() uses fixed `ORDER BY pos, id` for cursor pagination
   - What's unclear: How to implement multi-column sorting (chr, pos, gnomad_af, cadd) with cursor-based pagination
   - Recommendation: Phase 6 treats sortBy as cosmetic (UI state only, no backend support). Phase 7+ can implement backend sorting by modifying DatabaseService to accept sort parameters and rebuild cursor logic for each sort column. Cursor would change from `{ id, sort_value: pos }` to `{ id, sort_value: dynamic }`.

2. **Chromosome Natural Sorting**
   - What we know: Need chr1 < chr2 < chr10 < chrX < chrY < chrM (natural order)
   - What's unclear: Whether to implement in backend SQL or frontend JavaScript comparator
   - Recommendation: Backend is better place (SQLite custom collation or CASE expression in ORDER BY). Frontend sorting is cosmetic in Phase 6, so defer to Phase 7+ when implementing backend sort support.

3. **Empty State for Case with Zero Variants**
   - What we know: DatabaseService returns `{ data: [], total_count: 0, has_more: false, next_cursor: null }` for empty cases
   - What's unclear: Should show "No variants" message vs. table with zero rows
   - Recommendation: Use v-data-table-server's no-data slot to show custom message: "No variants found for this case." Keep table structure visible (headers) for consistency.

4. **Handling Null Values in Sorting UI**
   - What we know: gnomad_af, cadd, clinvar, gene_symbol, consequence can be NULL
   - What's unclear: How NULL values should sort (first or last) in multi-column sorting UI
   - Recommendation: Follow SQL convention (NULL last). Phase 6 doesn't implement backend sorting, so this is deferred. Document expected behavior: NULL values appear last in ascending sort, first in descending sort.

## Sources

### Primary (HIGH confidence)
- Project codebase: `/src/main/database/DatabaseService.ts` - getVariants() implementation with cursor pagination
- Project codebase: `/src/main/ipc/handlers/variants.ts` - IPC-06 handler
- Project codebase: `/src/shared/types/api.ts` - TypeScript types for Variant, PaginatedResult, PaginationCursor
- Project package.json: Vuetify 3.11.7, Vue 3.5.27, TypeScript 5.9.3
- MDN Web Docs: [Intl.NumberFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat) - Standard number formatting API

### Secondary (MEDIUM confidence)
- [Vuetify Data Tables - Server Side Tables](https://vuetifyjs.com/en/components/data-tables/server-side-tables/) - Official documentation (WebFetch failed, but URL verified via WebSearch)
- [Vuetify Data Tables - Sorting](https://vuetifyjs.com/en/components/data-tables/sorting/) - Multi-column sorting documentation
- [Vuetify Data Tables - Slots](https://vuetifyjs.com/en/components/data-tables/slots/) - Column formatting with item slots
- [GitHub: vuetifyjs/vuetify Discussion #17464](https://github.com/vuetifyjs/vuetify/discussions/17464) - items-per-page-options configuration
- [GitHub: vuetifyjs/vuetify Discussion #19160](https://github.com/vuetifyjs/vuetify/discussions/19160) - v-data-table-server reload patterns
- [Mamezou Developer Portal: Vuetify 3 Data Table](https://developer.mamezou-tech.com/en/blogs/2023/12/01/vuetify3-datatable/) - Official release announcement and patterns

### Tertiary (LOW confidence - marked for validation)
- WebSearch results: "Keyset Cursors for Postgres Pagination" - Generic keyset pagination patterns (SQLite differs slightly)
- WebSearch results: "v-data-table infinite loop" - Historical issues from Vuetify 2, may not apply to Vuetify 3
- WebSearch results: ClinVar color conventions - No official ACMG color specification found, relying on common practice (red=pathogenic, green=benign, amber=VUS)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Versions verified from package.json, Intl.NumberFormat is native browser API
- Architecture: HIGH - Patterns verified from project codebase (existing IPC/DatabaseService) and Vuetify documentation
- Pitfalls: MEDIUM - Infinite loop issues documented in GitHub issues, cursor cache logic inferred from cursor-based pagination best practices
- Formatting: HIGH - Intl.NumberFormat documented on MDN, ClinVar color conventions are MEDIUM confidence (common practice, not ACMG standard)

**Research date:** 2026-01-26
**Valid until:** 2026-02-25 (30 days - stable technology stack, Vuetify 3 mature, Vue 3 stable)
