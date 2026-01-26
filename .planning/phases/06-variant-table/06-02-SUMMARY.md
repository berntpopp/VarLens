---
phase: 06-variant-table
plan: 02
subsystem: database
tags: [sqlite, better-sqlite3, cursor-pagination, sorting, sql]

# Dependency graph
requires:
  - phase: 02-database-layer
    provides: DatabaseService with getVariants method and cursor-based pagination
provides:
  - Dynamic sorting support for variant queries with NULL handling
  - SortItem interface for frontend-backend sort specification contract
  - Updated PaginationCursor with sort_key field for correct continuation
  - Cursor pagination that works with any sortable column
affects: [06-03-variant-table-ui, variant-filtering, performance-optimization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SQL NULL handling with NULLS FIRST/LAST clauses"
    - "Keyset pagination with dynamic sort columns"
    - "Cursor validation to prevent pagination errors on sort changes"

key-files:
  created: []
  modified:
    - src/main/database/types.ts
    - src/main/database/DatabaseService.ts
    - src/main/ipc/handlers/variants.ts
    - src/shared/types/api.ts
    - src/preload/index.ts

key-decisions:
  - "Use ?? (nullish coalescing) for strict boolean expression compliance"
  - "Always append id as tiebreaker for stable pagination with any sort"
  - "Validate cursor.sort_key matches current sort to prevent pagination bugs"
  - "SORTABLE_COLUMNS whitelist prevents SQL injection via column names"

patterns-established:
  - "buildSortClause: Generate dynamic ORDER BY with NULL handling"
  - "buildCursorCondition: Keyset pagination adapted to any sort column"
  - "Cursor includes sort_key to detect sort changes between pages"

# Metrics
duration: 5m 39s
completed: 2026-01-26
---

# Phase 6 Plan 2: Backend Sorting Summary

**Dynamic variant sorting with cursor-based pagination supporting seven sortable columns with SQL standard NULL handling**

## Performance

- **Duration:** 5m 39s
- **Started:** 2026-01-26T20:00:10Z
- **Completed:** 2026-01-26T20:05:49Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Backend accepts sort parameters in variant query chain (renderer → preload → IPC → database)
- Dynamic ORDER BY generation with SQL standard NULL handling (ASC: NULLS LAST, DESC: NULLS FIRST)
- Cursor-based pagination works with any sortable column (chr, pos, gene_symbol, consequence, gnomad_af, cadd, clinvar)
- Multi-column sorting with id as stable tiebreaker

## Task Commits

Each task was committed atomically:

1. **Task 1: Add SortItem interface and update getVariants signature** - `db7d815` (feat)
2. **Task 2: Implement dynamic ORDER BY with NULL handling** - `e1a4e4d` (feat)
3. **Task 3: Update IPC layer and preload bridge** - `3225413` (feat)

## Files Created/Modified
- `src/main/database/types.ts` - Added SortItem interface, updated PaginationCursor with sort_key and nullable sort_value
- `src/main/database/DatabaseService.ts` - Added buildSortClause and buildCursorCondition helpers, updated getVariants with dynamic sorting
- `src/main/ipc/handlers/variants.ts` - Updated variants:query handler to accept and pass sortBy parameter
- `src/shared/types/api.ts` - Exported SortItem, updated VariantsAPI interface with sortBy parameter
- `src/preload/index.ts` - Updated preload bridge to accept sortBy and pass to IPC

## Decisions Made

**D042: Use ?? (nullish coalescing) for strict boolean expression compliance**
- **Context:** ESLint @typescript-eslint/strict-boolean-expressions requires explicit null/undefined handling
- **Decision:** Use `sortItem?.key ?? 'pos'` instead of `sortItem?.key || 'pos'`
- **Rationale:** Prevents unexpected coercion of empty strings; aligns with TypeScript strict mode

**D043: Always append id as tiebreaker for stable pagination**
- **Context:** Sorting by non-unique columns (e.g., gnomad_af) can cause pagination inconsistency
- **Decision:** buildSortClause always adds `id ASC` if not already present
- **Rationale:** Ensures deterministic row order for keyset pagination

**D044: Validate cursor.sort_key matches current sort**
- **Context:** User might change sort while paginating (e.g., from pos to gnomad_af)
- **Decision:** buildCursorCondition checks `cursor.sort_key !== sortKey` and returns impossible condition `1 = 0`
- **Rationale:** Forces frontend to reset pagination when sort changes rather than returning wrong page

**D045: SORTABLE_COLUMNS whitelist prevents SQL injection**
- **Context:** Sort column name comes from user input (frontend sort selection)
- **Decision:** Map frontend keys to SQL columns via SORTABLE_COLUMNS Record, skip invalid keys
- **Rationale:** Only allows pre-approved column names in ORDER BY clause

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Rebuilt better-sqlite3 for Node.js version mismatch**
- **Found during:** Task 2 verification (npm run test)
- **Issue:** better-sqlite3 compiled for NODE_MODULE_VERSION 143, current Node.js requires 137
- **Fix:** Ran `npm rebuild better-sqlite3`
- **Files modified:** node_modules/better-sqlite3/build/Release/better_sqlite3.node
- **Verification:** All 71 database tests pass
- **Committed in:** Not committed (node_modules excluded from git)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential for test execution. No scope creep.

## Issues Encountered

None - plan executed smoothly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Backend sorting foundation complete. Frontend can now:
- Pass `sortBy: [{ key: 'gnomad_af', order: 'asc' }]` to `window.api.variants.query()`
- Handle cursor.sort_key changes (requires resetting pagination)
- Expect NULL values sorted per SQL standard (ASC: NULLS LAST, DESC: NULLS FIRST)

**Ready for:** Phase 6 Plan 3 - Frontend variant table with sortable columns

**Key integration point:** Frontend must reset cursor to undefined when user changes sort (cursor.sort_key mismatch will return no results)

---
*Phase: 06-variant-table*
*Completed: 2026-01-26*
