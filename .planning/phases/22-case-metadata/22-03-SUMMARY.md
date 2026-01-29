---
phase: 22-case-metadata
plan: 03
subsystem: ui
tags: [vue, vuetify, case-metadata, hpo, autocomplete, chips, ui-integration]

# Dependency graph
requires:
  - phase: 22-02
    provides: useCaseMetadata composable, StatusSelector, CohortCombobox
  - phase: 21-03
    provides: HPO API IPC handlers (optional, graceful degradation)
provides:
  - HpoTermSelector component with graceful Phase 21 degradation
  - CaseMetadataCard integrating all metadata editors
  - Enhanced CaseList with status icons and cohort chips
  - Full case metadata UI integration in App.vue
affects: [23-side-panel-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Graceful degradation pattern for HPO autocomplete when Phase 21 incomplete
    - Debounced search with minimum character threshold (2 chars, 300ms)
    - Cohort chip overflow display (max 3, then +N indicator)

key-files:
  created:
    - src/renderer/src/components/HpoTermSelector.vue
    - src/renderer/src/components/CaseMetadataCard.vue
  modified:
    - src/renderer/src/components/CaseList.vue
    - src/renderer/src/App.vue

key-decisions:
  - "HPO autocomplete checks for window.api.hpo.search availability, shows 'unavailable' message if Phase 21 not complete"
  - "CaseList loads metadata for all cases after cases.list() completes"
  - "Cohort chips capped at 3 visible + overflow indicator for compact display"
  - "CaseMetadataCard positioned between FilterToolbar and VariantTable in case view"
  - "Metadata cache cleared on database switch for data consistency"

patterns-established:
  - "Graceful API degradation: check for window.api.* availability, disable/message if unavailable"
  - "Debounced autocomplete: useDebounce composable + minimum character threshold"
  - "Chip overflow pattern: slice(0, 3) + conditional overflow chip"

# Metrics
duration: 5min
completed: 2026-01-29
---

# Phase 22 Plan 03: Case Metadata UI Integration Summary

**Complete UI integration of case metadata with HPO term selector and enhanced case list display**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-29T00:10:39Z
- **Completed:** 2026-01-29T00:15:39Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- HpoTermSelector provides debounced HPO autocomplete with chip display and graceful degradation
- CaseMetadataCard integrates status, cohort, and HPO term editors in a compact card layout
- CaseList displays status icons and cohort chips for all cases
- App.vue includes CaseMetadataCard in case analysis view with cache clearing on database switch

## Task Commits

Each task was committed atomically:

1. **Task 1: Create HpoTermSelector component** - `04f1528` (feat)
2. **Task 2: Create CaseMetadataCard component** - `443c01a` (feat)
3. **Task 3: Integrate metadata into CaseList and App** - `d786f62` (feat)

## Files Created/Modified
- `src/renderer/src/components/HpoTermSelector.vue` - HPO term autocomplete with chip display, graceful Phase 21 degradation, debounced search (300ms), minimum 2 characters
- `src/renderer/src/components/CaseMetadataCard.vue` - Card component integrating StatusSelector, CohortCombobox, and HpoTermSelector with three-row layout
- `src/renderer/src/components/CaseList.vue` - Enhanced with status icon (colored) and cohort chips (max 3 + overflow) for each case
- `src/renderer/src/App.vue` - Added CaseMetadataCard below FilterToolbar, metadata cache clearing on database switch

## Decisions Made

**1. Graceful degradation for HPO autocomplete**
- Rationale: Phase 21 (API Service Layer) may not be complete in some environments
- Pattern: Check `typeof window.api.hpo.search === 'function'` at mount
- Behavior: If unavailable, show "HPO search unavailable - complete Phase 21" message and disable autocomplete
- Users can still view/remove existing HPO terms from database imports

**2. Debounced search with minimum character threshold**
- Rationale: Prevent excessive API calls and improve UX
- Implementation: useDebounce composable with 300ms delay, minimum 2 characters before search
- Performance: Reduces API load while providing responsive autocomplete

**3. Cohort chip overflow display**
- Rationale: Case list sidebar is narrow (280px), need compact display
- Pattern: `slice(0, 3)` for visible chips, `+N` chip for overflow count
- Visual consistency: x-small chips with label variant for compact display

**4. CaseMetadataCard placement in case view**
- Rationale: Metadata should be visible and editable when viewing a case
- Position: Between FilterToolbar (case name) and VariantTable (variant data)
- Layout: Outlined card with 3 compact rows (Status / Cohorts / Phenotypes)

**5. Metadata cache clearing on database switch**
- Rationale: Prevent stale metadata from previous database
- Implementation: Call `clearMetadataCache()` in `handleDatabaseSwitched`
- Data consistency: Ensures fresh metadata load after database switch

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed template shadow warning in HpoTermSelector**
- **Found during:** Task 1, ESLint check
- **Issue:** Template slot parameter `props` shadowed component props variable
- **Fix:** Renamed template parameter to `itemProps` in `<template #item="{ item, props: itemProps }">`
- **Files modified:** `src/renderer/src/components/HpoTermSelector.vue`
- **Commit:** `04f1528` (included in Task 1 commit)

## Issues Encountered

**1. ESLint warnings for pre-existing code**
- Problem: ExternalLinksSection.vue has `no-undef` errors for `console` usage (2 errors)
- Resolution: Not addressed - pre-existing issue from Phase 23 work, outside scope of this plan
- Impact: None - does not block 22-03 completion

## Next Phase Readiness

**Ready for Phase 23 (Side Panel UI):**
- Case metadata fully visible and editable in main UI
- CaseMetadataCard can serve as reference for panel metadata display
- Composable pattern tested across multiple components

**Phase 22 (Case Metadata) Complete:**
- 22-01: Backend (DatabaseService + IPC + preload API) ✓
- 22-02: Composable & UI components (useCaseMetadata, StatusSelector, CohortCombobox) ✓
- 22-03: UI Integration (HpoTermSelector, CaseMetadataCard, enhanced CaseList, App integration) ✓

**No blockers.**

---
*Phase: 22-case-metadata*
*Completed: 2026-01-29*
