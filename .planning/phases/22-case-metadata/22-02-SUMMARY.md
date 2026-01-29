---
phase: 22-case-metadata
plan: 02
subsystem: ui
tags: [vue, vuetify, composables, case-metadata, reactive-state, optimistic-updates]

# Dependency graph
requires:
  - phase: 22-01
    provides: DatabaseService methods and IPC handlers for case metadata CRUD
provides:
  - useCaseMetadata composable with reactive cache and optimistic updates
  - StatusSelector component for affected status selection
  - CohortCombobox component for cohort assignment with inline creation
affects: [22-03, 23-side-panel-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Optimistic UI updates for case metadata (status, cohorts, HPO terms)
    - Deterministic hash-based color assignment for cohort chips
    - Separate create event pattern for inline cohort creation

key-files:
  created:
    - src/renderer/src/composables/useCaseMetadata.ts
    - src/renderer/src/components/StatusSelector.vue
    - src/renderer/src/components/CohortCombobox.vue
  modified: []

key-decisions:
  - "Optimistic updates revert on IPC failure to show real server state"
  - "Cohort colors derived from name hash for visual consistency"
  - "CohortCombobox emits create:cohort for parent to handle IPC, keeps component stateless"
  - "Temporary ID (0) with created_at timestamp for optimistic HPO term display before server response"

patterns-established:
  - "Composable pattern: cache (Map<caseId, FullCaseMetadata>) + loading states + IPC methods"
  - "Optimistic update pattern: update cache immediately, call IPC, revert on error"
  - "Combobox inline creation: separate existing items from typed strings, emit create event"

# Metrics
duration: 3min
completed: 2026-01-29
---

# Phase 22 Plan 02: Case Metadata Composable & UI Summary

**Reactive case metadata composable with optimistic updates and reusable status/cohort selector components**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-29T00:03:33Z
- **Completed:** 2026-01-29T00:06:49Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- useCaseMetadata composable provides reactive cache per case with optimistic updates for status, cohorts, and HPO terms
- StatusSelector dropdown with icon + label display using status-specific colors
- CohortCombobox with chips, inline creation support, and deterministic color assignment

## Task Commits

Each task was committed atomically:

1. **Task 1: Create useCaseMetadata composable** - `521c293` (feat)
2. **Task 2: Create StatusSelector component** - `a68f548` (feat)
3. **Task 3: Create CohortCombobox component** - `8c30c9b` (feat)

## Files Created/Modified
- `src/renderer/src/composables/useCaseMetadata.ts` - Reactive case metadata state management with cache, loading states, and optimistic IPC updates
- `src/renderer/src/components/StatusSelector.vue` - Dropdown selector for affected status (affected/unaffected/unknown) with icons and colors
- `src/renderer/src/components/CohortCombobox.vue` - Multi-select combobox for cohort assignment with inline creation support

## Decisions Made

**1. Optimistic updates with rollback on error**
- Rationale: Provides immediate UI feedback while maintaining data integrity if IPC fails
- Pattern: Update cache immediately → call IPC → revert cache on error
- Applied to: status updates, cohort assignment, HPO term add/remove

**2. Deterministic hash-based cohort colors**
- Rationale: Same cohort name always gets same color across UI, visual consistency without database storage
- Implementation: `getCohortColor(name)` uses character code hash modulo color array length
- Color palette: 10 Vuetify theme colors (primary, secondary, success, info, warning, purple, pink, indigo, teal, cyan)

**3. CohortCombobox emits create:cohort for parent handling**
- Rationale: Keeps component stateless, parent (CaseMetadataCard) handles IPC via composable's createAndAssignCohort
- Pattern: `handleSelectionChange` separates CohortGroup objects from string names, emits create event for strings
- Parent workflow: On create event → call composable → newly created cohort added to cache → selection updated

**4. Temporary HPO term ID for optimistic display**
- Rationale: CaseHpoTerm requires id and created_at fields for type safety
- Implementation: Use temporary id=0 and Date.now(), replace with server response after IPC completes
- Ensures smooth UI without type errors during optimistic update

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**1. CaseHpoTerm type requires id and created_at fields**
- Problem: Optimistic update for assignHpoTerm initially constructed partial CaseHpoTerm without id/created_at
- Solution: Added temporary id (0) and created_at (Date.now()) for optimistic display, replaced with server response
- Resolution: TypeScript type safety maintained while providing immediate UI feedback

## Next Phase Readiness

**Ready for Phase 22-03 (Case Metadata UI):**
- useCaseMetadata composable provides all state management methods
- StatusSelector and CohortCombobox ready for integration into CaseMetadataCard
- Optimistic updates ensure responsive UI

**Ready for Phase 23 (Side Panel UI):**
- Composable cache pattern tested and working
- Components follow Vuetify v3 patterns

**No blockers.**

---
*Phase: 22-case-metadata*
*Completed: 2026-01-29*
