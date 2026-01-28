---
phase: 20-annotation-core
plan: 03
subsystem: ui
tags: [vue, composables, optimistic-updates, annotations, ACMG]

# Dependency graph
requires:
  - phase: 20-01
    provides: IPC annotation handlers (upsertGlobal, upsertPerCase)
  - phase: 20-02
    provides: useAnnotations composable with cache structure
provides:
  - Comment getter methods (getGlobalComment, getPerCaseComment)
  - Comment mutation methods (upsertGlobalComment, upsertPerCaseComment)
  - Comment delete wrappers (deleteGlobalComment, deletePerCaseComment)
  - ACMG classification mutation method (setAcmgClassification)
affects: [20-04-comment-dialogs, 20-05-acmg-dropdown, phase-23-side-panel]

# Tech tracking
tech-stack:
  added: []
  patterns: [optimistic-update-with-revert, cache-key-by-variant]

key-files:
  created: []
  modified:
    - src/renderer/src/composables/useAnnotations.ts

key-decisions:
  - "Pass variantId as parameter to per-case methods (caller has access via item.id)"
  - "Delete methods are wrappers that upsert null (preserve other fields)"
  - "All mutation methods follow same optimistic update pattern as toggleGlobalStar"

patterns-established:
  - "Optimistic update pattern: update cache, call IPC, revert on failure"
  - "Per-case methods require variantId parameter from caller"

# Metrics
duration: 4min
completed: 2026-01-28
---

# Phase 20 Plan 03: Annotation Mutation Methods Summary

**Extended useAnnotations composable with 7 mutation methods for comments and ACMG classification with optimistic UI updates**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-28T22:18:00Z
- **Completed:** 2026-01-28T22:22:49Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Added getGlobalComment and getPerCaseComment cache accessor methods
- Added upsertGlobalComment and upsertPerCaseComment mutation methods with optimistic updates
- Added deleteGlobalComment and deletePerCaseComment convenience wrappers
- Added setAcmgClassification mutation method for ACMG assignment
- All 7 methods follow consistent optimistic update pattern with automatic revert on failure

## Task Commits

Each task was committed atomically:

1. **Task 1: Add comment getter and mutation methods** - `456a876` (feat)
2. **Task 2: Add ACMG classification mutation method** - `87540c7` (feat)

## Files Created/Modified

- `src/renderer/src/composables/useAnnotations.ts` - Extended with 7 new methods: getGlobalComment, getPerCaseComment, upsertGlobalComment, upsertPerCaseComment, deleteGlobalComment, deletePerCaseComment, setAcmgClassification

## Decisions Made

1. **variantId as parameter for per-case methods** - The per-case IPC requires variantId, which is not in the cache. Rather than adding a lookup, pass variantId from caller (VariantTable has item.id).

2. **Delete methods as null-upsert wrappers** - deleteGlobalComment and deletePerCaseComment call upsert with null comment. This preserves other annotation fields (star, ACMG) while clearing just the comment.

3. **Consistent optimistic update pattern** - All mutation methods follow the same pattern as toggleGlobalStar: (1) save previous value, (2) optimistically update cache, (3) call IPC, (4) update cache with response, (5) revert on failure.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Composable now exposes all annotation mutation methods
- UI components can call these methods directly
- Ready for Phase 20-04 (comment dialog UI) and Phase 20-05 (ACMG dropdown)
- Pattern established for future annotation operations

---
*Phase: 20-annotation-core*
*Completed: 2026-01-28*
