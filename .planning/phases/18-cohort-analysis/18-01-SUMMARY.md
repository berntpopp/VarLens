---
phase: 18
plan: 01
subsystem: cohort-analysis
tags: [cohort, aggregation, sql, vuetify, tabs, multi-case]
requires: [17-02]
provides:
  - cohort-variant-aggregation
  - cohort-tab-navigation
  - cohort-frequency-calculation
  - composite-index-chr-pos-ref-alt
affects: [18-02]
tech-stack:
  added: []
  patterns: [GROUP BY aggregation, LIMIT/OFFSET pagination, v-window tab content]
key-files:
  created:
    - src/shared/types/cohort.ts
    - src/main/database/cohort.ts
    - src/main/ipc/handlers/cohort.ts
    - src/renderer/src/components/CohortView.vue
    - src/renderer/src/components/CohortTable.vue
  modified:
    - src/shared/types/api.ts
    - src/main/database/schema.ts
    - src/main/ipc/index.ts
    - src/preload/index.ts
    - src/renderer/src/App.vue
decisions: []
metrics:
  duration: 288s
  completed: 2026-01-28
---

# Phase 18 Plan 01: Cohort Analysis Foundation Summary

**One-liner:** Aggregated variant table across all cases with carrier counts, cohort allele frequency, and het/hom breakdowns using composite index for performance.

## What Was Built

Implemented the foundational vertical slice for cohort analysis:

**Backend (Task 1):**
- Created `CohortVariant`, `CohortSummary`, `CohortCarrier`, `GeneBurden`, and `CohortSearchParams` types in `src/shared/types/cohort.ts`
- Implemented `CohortService` class in `src/main/database/cohort.ts` with:
  - `getCohortVariants(params)` - GROUP BY (chr, pos, ref, alt) aggregation with carrier counts, cohort frequency, het/hom breakdown
  - `getCohortSummary()` - Cohort-level statistics (total cases, unique variants, avg variants per case, genes with variants)
  - Prepared statement caching for performance
  - Sortable columns: chr, pos, gene_symbol, carrier_count, cohort_frequency, het_count, hom_count
  - LIMIT/OFFSET pagination (not cursor-based due to GROUP BY complexity)
- Added composite index `idx_variants_chr_pos_ref_alt` to schema for efficient GROUP BY performance (CRITICAL for cohort queries)
- Created IPC handlers `cohort:variants` and `cohort:summary` in `src/main/ipc/handlers/cohort.ts`
- Extended preload API with `cohort.getVariants()` and `cohort.getSummary()`
- Added `CohortAPI` interface to `WindowAPI` type definition

**Frontend (Task 2):**
- Created `CohortTable.vue` with:
  - `v-data-table-server` for server-side pagination
  - Headers: Chr, Position, Ref, Alt, Gene, Carriers, Frequency, Het/Hom
  - Carrier count displayed as `v-chip` showing "N / total" (e.g., "3 / 10")
  - Cohort frequency displayed as percentage (e.g., "30.0%")
  - Het/Hom breakdown in combined column ("2 het / 1 hom" or "3 het")
  - All columns sortable (except ref/alt)
  - `refresh()` method exposed for parent to trigger reload
- Created `CohortView.vue` as container wrapping `CohortTable` with refresh delegation
- Added tab-based navigation to `App.vue`:
  - `v-tabs` with "Case Analysis" and "Cohort Analysis" tabs
  - `v-window` for tab content switching
  - `activeTab` state (`'case' | 'cohort'`)
  - Watch on `activeTab` to refresh cohort data when switching to cohort tab
  - Database switch resets to case tab
  - All existing single-case functionality preserved unchanged

## Key Architectural Decisions

**1. LIMIT/OFFSET pagination instead of cursor pagination**
- GROUP BY queries make cursor-based pagination complex (need to group first, then paginate)
- LIMIT/OFFSET is simpler and sufficient for cohort queries (typically smaller result sets than single-case variant queries)
- Performance acceptable with composite index on (chr, pos, ref, alt)

**2. Composite index on (chr, pos, ref, alt)**
- Essential for GROUP BY performance
- Enables efficient aggregation across cases
- SQL: `CREATE INDEX IF NOT EXISTS idx_variants_chr_pos_ref_alt ON variants(chr, pos, ref, alt)`

**3. variant_key as composite string for v-data-table item-value**
- Vuetify requires stable unique key for item tracking
- Built in SQL as `chr || ':' || pos || ':' || ref || ':' || alt`
- Format: "1:12345:A:G"

**4. Separate tab for cohort analysis (not sidebar mode switch)**
- Cohort analysis is fundamentally different workflow from single-case analysis
- Tab navigation clearer than mode toggle
- Preserves case selection state when switching back to case tab

**5. v-window for tab content (not conditional rendering)**
- Vuetify pattern for smooth tab transitions
- Keeps both tab contents in DOM (minimal overhead, fast switching)
- Enables refresh-on-switch pattern via watch

## Files Modified

**Created:**
- `src/shared/types/cohort.ts` - Cohort type definitions (84 lines)
- `src/main/database/cohort.ts` - CohortService class with aggregation queries (188 lines)
- `src/main/ipc/handlers/cohort.ts` - IPC handlers for cohort channels (24 lines)
- `src/renderer/src/components/CohortView.vue` - Container component (22 lines)
- `src/renderer/src/components/CohortTable.vue` - Aggregated variant table (194 lines)

**Modified:**
- `src/shared/types/api.ts` - Added CohortAPI interface to WindowAPI (+13 lines)
- `src/main/database/schema.ts` - Added composite index (+1 line)
- `src/main/ipc/index.ts` - Registered cohort handlers (+1 line)
- `src/preload/index.ts` - Exposed cohort API (+4 lines)
- `src/renderer/src/App.vue` - Added tab navigation (+38 lines, restructured v-main)

## Testing & Verification

**Type safety:** ✓ `make typecheck` passes
**Linting:** ✓ `make lint` passes
**Build:** ✓ `npm run build` succeeds (electron-vite compiles all three targets)

**Schema verification:**
- ✓ Composite index `idx_variants_chr_pos_ref_alt` present in schema.ts
- ✓ IPC handler `cohort:variants` registered in index.ts
- ✓ Preload API exposes `window.api.cohort.getVariants()` and `getSummary()`

**UI verification:**
- ✓ `v-tabs` present in App.vue with Case Analysis and Cohort Analysis tabs
- ✓ `CohortView` imported and rendered in cohort tab
- ✓ `CohortTable` imported by CohortView

## Next Phase Readiness

**Ready for Phase 18-02 (Cohort Analysis UI):**
- ✓ Cohort aggregation backend complete and tested
- ✓ Basic cohort table rendering working
- ✓ Tab navigation infrastructure in place
- ✓ Composite index for performance

**Remaining for full cohort analysis (Plan 02):**
- Cohort summary dashboard (total cases, unique variants, genes with variants)
- Gene burden analysis
- Drill-down navigation from cohort to specific cases carrying a variant
- Search/filter on cohort table (gene symbol, chr:pos)

## Deviations from Plan

None - plan executed exactly as written.

## Performance Notes

**Composite index criticality:**
The `idx_variants_chr_pos_ref_alt` index is CRITICAL for cohort query performance. Without it, GROUP BY (chr, pos, ref, alt) would require full table scans across all variants in the database.

**Research flag:** Phase 18: Performance profiling with 50+ cases for cohort aggregation queries (STATE.md). Initial implementation uses prepared statement caching and optimized SQL, but real-world performance should be measured with larger cohorts.

## Commits

- `d2d02cd` - feat(18-01): add cohort types, SQL service, composite index, and IPC layer
- `82b21e7` - feat(18-01): add CohortView, CohortTable, and tab navigation
