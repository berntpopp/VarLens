# Phase 18 Plan 02: Cohort Analysis UI Enhancements Summary

**One-liner:** Complete interactive cohort analysis with FTS5 search, expandable per-case drill-down, collapsible dashboard, gene burden table, and case navigation

---

## Plan Details

- **Phase:** 18-cohort-analysis
- **Plan:** 02
- **Type:** execute
- **Wave:** 2
- **Dependencies:** 18-01

---

## What Was Built

Completed the cohort analysis feature by adding search capabilities, expandable drill-down with per-case carrier details, summary statistics dashboard, and gene-level burden analysis with seamless navigation to individual cases.

### Task 1: Search, Carriers, and Gene Burden Backend

**Backend enhancements:**
- Extended `CohortService` with three new methods:
  - `getCarriers(chr, pos, ref, alt)`: Returns per-case carriers with case name and zygosity for drill-down
  - Enhanced `getCohortVariants()` with hybrid search strategy:
    - **Gene symbols** → FTS5 with special character escaping (wraps `-`, `*`, `"` in quotes) and prefix matching
    - **Genomic positions** (`chr:pos`) → Direct chr/pos equality filtering with chr normalization
    - **HGVS notations** (`c.` or `p.` prefix) → LIKE search on cdna and aa_change columns
    - **Fallback** → Broad LIKE search across gene_symbol, cdna, and aa_change
  - `getGeneBurden()`: Gene-level aggregation showing variant counts, unique variants, and affected cases
- Registered `cohort:carriers` and `cohort:geneBurden` IPC handlers
- Extended preload API and TypeScript interfaces

**Files modified:**
- `src/main/database/cohort.ts` (+82 lines)
- `src/main/ipc/handlers/cohort.ts` (+21 lines)
- `src/preload/index.ts` (+4 lines)
- `src/shared/types/api.ts` (+10 lines)

### Task 2: Search Bar, Expandable Drill-Down, Dashboard, Gene Burden UI, and Navigation

**Three new Vue components:**

1. **CohortDashboard.vue** (136 lines)
   - Collapsible expansion panel with "Cohort Summary" title
   - Five stat cards in responsive grid (4 cols on lg, 2 on md, 1 on sm):
     - Total Cases
     - Total Variants (formatted with toLocaleString)
     - Unique Variants (formatted)
     - Avg Variants/Case (1 decimal)
     - Genes with Variants
   - Each stat uses v-card with tonal variant and Material Design icons
   - Collapsed by default, shows skeleton loader while loading
   - Fetches data via `window.api.cohort.getSummary()` on mount

2. **GeneBurdenTable.vue** (123 lines)
   - Client-side sortable `v-data-table` showing per-gene burden
   - Headers: Gene, Total Variants, Unique Variants, Cases Affected, Case Frequency
   - Case frequency displayed as "N / total (X%)" format
   - Default sort by affected_case_count descending
   - Density: compact, 25 items per page with [10, 25, 50, 100] options
   - Fetches data via `window.api.cohort.getGeneBurden()` on mount
   - Shows progress bar while loading

3. **Enhanced CohortTable.vue** (+180 lines)
   - **Search bar:**
     - Text field with magnify icon and placeholder text
     - 300ms debounce using setTimeout/clearTimeout
     - Filters table in-place, resets to first page on search
     - Clearable with outlined variant
   - **Expandable rows:**
     - `show-expand` prop on v-data-table-server
     - Nested table in expanded row showing carrier details:
       - Case name
       - Zygosity chip (warning for het, error for hom)
       - "View in Case" button with open-in-app icon
     - Lazy-loaded on expansion: `getCarriers()` called once per variant, cached in `carrierMap`
     - Helper functions: `isHomozygous()`, `formatZygosity()`
   - **Navigation:**
     - Emits `navigate-to-case` event with payload: `{ caseId, chr, pos, ref, alt }`
     - Handled by parent to switch tabs

**Updated components:**

4. **CohortView.vue**
   - Layout now includes all three components:
     - CohortDashboard at top
     - CohortTable in middle (re-emits navigate-to-case)
     - Divider + "Gene Burden" heading
     - GeneBurdenTable at bottom
   - `refresh()` method calls refresh on all three child components
   - Re-emits navigation event to App.vue

5. **App.vue**
   - `handleNavigateToCase(payload)`:
     - Switches `activeTab` to `'case'`
     - Sets `selectedCaseId` to payload.caseId
     - Fetches case list to look up case name
     - Sets `selectedCaseName`
     - User lands on Case Analysis tab with selected case loaded
   - Wires event: `<CohortView @navigate-to-case="handleNavigateToCase" />`

---

## Technical Decisions

### Decision 36: FTS5 for gene symbol search with escaping
**Context:** Gene symbols can contain special FTS5 characters (e.g., `BRCA-1`, `OR4K*`)
**Choice:** Wrap terms containing `-`, `*`, or `"` in double quotes with internal quote escaping (`"BRCA-1"` not `BRCA-1`)
**Rationale:** FTS5 interprets `-` as NOT operator and `*` as wildcard; quoting treats them as literals while preserving fast indexed search
**Impact:** Hybrid search pattern detection determines strategy per search term

### Decision 37: Lazy loading of carrier data
**Context:** Expanding every row immediately would cause N queries (one per variant)
**Choice:** Load carriers only when row expands, cache in `Map<variant_key, CohortCarrier[]>`
**Rationale:** Most users won't expand every row; lazy loading minimizes queries and memory
**Impact:** Carrier data fetched on first expansion, instant on subsequent expansions

### Decision 38: Navigate to case tab without variant pre-filtering
**Context:** "View in Case" button could navigate to case with variant pre-filtered
**Choice:** Switch to case tab with case selected, don't apply variant filter
**Rationale:** User may want full case context; they can search for variant in case table if needed. Pre-filtering adds complexity.
**Impact:** Simpler navigation logic, user sees full variant list for selected case

### Decision 39: 300ms search debounce
**Context:** Search triggers backend query on every keystroke
**Choice:** Debounce search input with 300ms delay using setTimeout
**Rationale:** Prevents flooding backend with queries while typing, UX standard for search
**Impact:** Backend only queries after user stops typing for 300ms

---

## Requirements Satisfied

All Phase 18 cohort analysis requirements (CHRT-01 through CHRT-10) from PROJECT.md:

- **CHRT-01:** Aggregated variant table across all cases ✓ (from Plan 01)
- **CHRT-02:** Carrier count and cohort frequency columns ✓ (from Plan 01)
- **CHRT-03:** Search by gene symbol using FTS5 ✓
- **CHRT-04:** Search by genomic position (chr:pos) ✓
- **CHRT-05:** Search by HGVS notation ✓
- **CHRT-06:** Expandable rows showing per-case carriers ✓
- **CHRT-07:** "View in Case" drill-down navigation ✓
- **CHRT-08:** Collapsible summary dashboard ✓
- **CHRT-09:** Gene-level burden table ✓
- **CHRT-10:** Het/Hom zygosity breakdown ✓ (Plan 01 + Plan 02)

---

## Deviations from Plan

None - plan executed exactly as written.

---

## Key Files

### Created
- `.planning/phases/18-cohort-analysis/18-02-SUMMARY.md` (this file)
- `src/renderer/src/components/CohortDashboard.vue` - Collapsible summary stats panel
- `src/renderer/src/components/GeneBurdenTable.vue` - Gene-level burden aggregation table

### Modified
- `src/main/database/cohort.ts` - Added getCarriers(), getGeneBurden(), enhanced search in getCohortVariants()
- `src/main/ipc/handlers/cohort.ts` - Registered cohort:carriers and cohort:geneBurden handlers
- `src/preload/index.ts` - Exposed getCarriers() and getGeneBurden() to renderer
- `src/shared/types/api.ts` - Extended CohortAPI interface with new methods
- `src/renderer/src/components/CohortTable.vue` - Added search bar, expandable rows, lazy carrier loading, navigation emit
- `src/renderer/src/components/CohortView.vue` - Orchestrates dashboard, table, and gene burden components
- `src/renderer/src/App.vue` - Added handleNavigateToCase for tab switching and case selection

---

## Testing Notes

**TypeScript:** `npm run typecheck` passes
**Linting:** `npm run lint` passes
**Build:** `npm run build` succeeds

**Manual testing required:**
1. Search by gene symbol (e.g., `BRCA1`, `BRCA-1`) → verify FTS5 escaping works
2. Search by position (e.g., `chr17:41234567`) → verify exact match
3. Search by HGVS (e.g., `c.1234G>A`) → verify LIKE search
4. Expand variant row → verify carriers load with case names and zygosity chips
5. Click "View in Case" → verify switches to Case Analysis tab with correct case selected
6. Dashboard shows correct stats and is collapsed by default
7. Gene burden table shows per-gene counts sorted by affected cases

**Known limitations:**
- No pre-filtering of variants when navigating to case (by design - Decision 38)
- Search doesn't support complex FTS5 queries (AND, OR, NEAR) - single term only

---

## Performance Characteristics

**Backend queries:**
- Search via FTS5 uses existing `variants_fts` index (fast)
- Genomic position search uses composite index `(chr, pos, ref, alt)` from Plan 01 (fast)
- Gene burden query scans all variants but returns small result set (bounded by genome ~20K genes)
- Carrier query uses composite index (fast)

**Frontend:**
- Debounced search prevents query flooding
- Lazy carrier loading minimizes unnecessary queries
- Client-side gene burden table (data size is small)
- Dashboard stats fetched once per cohort tab visit

**Scalability:**
- Tested with development database (unknown case count)
- FTS5 and indexed queries should scale to 50+ cases
- Gene burden query may slow with 100K+ variant observations (mitigated by GROUP BY on indexed column)

---

## Next Phase Readiness

**Phase 18 complete.** All cohort analysis requirements satisfied.

**Blockers for future phases:** None

**Recommendations:**
1. Performance profiling with 50+ cases to validate query performance (matches Phase 18 research flag in STATE.md)
2. Add E2E tests for cohort search and drill-down navigation
3. Consider caching gene burden results (data rarely changes until new case imported)

---

## Related Documentation

- **Requirements:** `.planning/phases/18-cohort-analysis/18-cohort-analysis-CONTEXT.md`
- **Plan 01 Summary:** `.planning/phases/18-cohort-analysis/18-01-SUMMARY.md` (aggregation backend and tab navigation)
- **Project decisions:** `.planning/STATE.md` (Decisions 32-39)

---

**Duration:** ~5 minutes
**Completed:** 2026-01-28

---

## Metadata

```yaml
phase: 18
plan: 02
subsystem: frontend-cohort-analysis
tags:
  - cohort
  - search
  - fts5
  - drill-down
  - navigation
  - dashboard
  - gene-burden
  - vuetify
requires:
  - 18-01-aggregation-backend
provides:
  - cohort-search-fts5
  - cohort-expandable-rows
  - cohort-drill-down-navigation
  - cohort-dashboard
  - gene-burden-table
affects:
  - future-cohort-features
  - case-navigation-ux
tech-stack:
  added: []
  patterns:
    - hybrid-search-strategy
    - lazy-loading-pattern
    - debounced-input
    - event-emission-navigation
key-files:
  created:
    - src/renderer/src/components/CohortDashboard.vue
    - src/renderer/src/components/GeneBurdenTable.vue
  modified:
    - src/main/database/cohort.ts
    - src/main/ipc/handlers/cohort.ts
    - src/preload/index.ts
    - src/shared/types/api.ts
    - src/renderer/src/components/CohortTable.vue
    - src/renderer/src/components/CohortView.vue
    - src/renderer/src/App.vue
decisions:
  - id: 36
    summary: FTS5 for gene symbol search with escaping
  - id: 37
    summary: Lazy loading of carrier data
  - id: 38
    summary: Navigate to case tab without variant pre-filtering
  - id: 39
    summary: 300ms search debounce
metrics:
  duration: 5min
  tasks: 2
  commits: 2
  files-modified: 7
  files-created: 2
  lines-added: ~620
completed: 2026-01-28
```
