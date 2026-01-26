---
phase: 05-ui-shell-cases
plan: 02
subsystem: ui
tags: [vue, vuetify, ipc, electron, context-menu]

# Dependency graph
requires:
  - phase: 05-01
    provides: App shell layout with sidebar and main content area
  - phase: 04-03
    provides: IPC handlers for cases.list and cases.delete
provides:
  - Complete case management UI with list, selection, and deletion
  - Context menu pattern for right-click interactions
  - Dialog pattern for confirmations
  - Snackbar pattern for user feedback
affects: [06-variant-table, future-ui-components]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Context menu with absolute positioning via composable
    - Promise-based dialog component with defineExpose
    - Global snackbar for toast notifications
    - IPC data loading in onMounted lifecycle

key-files:
  created:
    - src/renderer/src/composables/useContextMenu.ts
    - src/renderer/src/components/DeleteCaseDialog.vue
    - src/renderer/src/components/AppSnackbar.vue
    - src/renderer/src/components/CaseList.vue
  modified:
    - src/renderer/src/App.vue
    - src/renderer/src/components/AppSidebar.vue

key-decisions:
  - "Context menu positioned at mouse coordinates using fixed positioning"
  - "Delete dialog uses promise-based API exposed via defineExpose"
  - "Snackbar notifications managed globally with ref forwarding"
  - "Case selection uses v-list select-strategy='single-leaf'"

patterns-established:
  - "useContextMenu composable: Manages show state and x/y coordinates for absolute positioning"
  - "Dialog pattern: Promise-based show() method that returns boolean confirmation"
  - "Snackbar pattern: Global component with show(message, type) method"
  - "IPC loading: Load data in onMounted, display in filtered computed property"

# Metrics
duration: 1m 17s
completed: 2026-01-26
---

# Phase 5 Plan 02: Case Management UI Summary

**Case list with search, selection, right-click delete with confirmation, and snackbar notifications using Vuetify components and IPC**

## Performance

- **Duration:** 1m 17s
- **Started:** 2026-01-26T19:49:28Z
- **Completed:** 2026-01-26T19:50:45Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- Case list displays all imported cases with search filtering
- Click selection propagates to App.vue for main content updates
- Right-click context menu enables case deletion
- Confirmation dialog with case details before deletion
- Success snackbar after deletion with automatic list refresh

## Task Commits

Each task was committed atomically:

1. **Task 1: Create useContextMenu composable and supporting components** - `96ba645` (feat)
2. **Task 2: Create CaseList component with full functionality** - `8eae329` (feat)
3. **Task 3: Integrate CaseList into App shell** - `e9a8942` (feat)

## Files Created/Modified
- `src/renderer/src/composables/useContextMenu.ts` - Composable for positioning context menus at click coordinates
- `src/renderer/src/components/DeleteCaseDialog.vue` - Promise-based confirmation dialog for case deletion
- `src/renderer/src/components/AppSnackbar.vue` - Global snackbar for toast notifications
- `src/renderer/src/components/CaseList.vue` - Main case list with search, selection, context menu, and IPC integration
- `src/renderer/src/App.vue` - Wired CaseList events to selection state, placeholder for selected case
- `src/renderer/src/components/AppSidebar.vue` - Minor formatting improvements
- `src/main/ipc/errorHandler.ts` - ESLint formatting fixes
- `src/preload/index.ts` - ESLint formatting fixes
- `src/shared/types/api.ts` - ESLint formatting fixes

## Decisions Made

**Context menu positioning:**
- Used absolute positioning with fixed strategy rather than v-menu's default positioning
- Provides precise control over menu location at mouse coordinates
- Pattern reusable for other context menu needs

**Promise-based dialog API:**
- Dialog component exposes show() method returning Promise<boolean>
- Enables async/await in calling code: `const confirmed = await dialog.show(name, count)`
- Cleaner than event-based callback pattern

**Single-leaf selection strategy:**
- Vuetify v-list with select-strategy="single-leaf" for single selection
- Selected array watched to emit case-selected event
- Clear selection when deleted case was selected

**ESLint strict mode compliance:**
- Changed `if (confirmed)` to `if (confirmed === true)` for strict-boolean-expressions
- Added `// eslint-disable-next-line no-undef` for window.api calls (defined in preload)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed ESLint strict-boolean-expressions error**
- **Found during:** Task 2 (CaseList implementation)
- **Issue:** ESLint strict-boolean-expressions rule requires explicit boolean comparison for optional chaining results
- **Fix:** Changed `if (confirmed)` to `if (confirmed === true)` since confirmed is Promise<boolean> result
- **Files modified:** src/renderer/src/components/CaseList.vue
- **Verification:** npm run lint passes
- **Committed in:** e9a8942 (Task 3 commit)

**2. [Rule 1 - Bug] Fixed ESLint no-undef errors for window.api**
- **Found during:** Task 2 (CaseList implementation)
- **Issue:** ESLint no-undef rule flags window.api as undefined (it's injected by preload)
- **Fix:** Added `// eslint-disable-next-line no-undef` comments before window.api calls
- **Files modified:** src/renderer/src/components/CaseList.vue
- **Verification:** npm run lint passes, typecheck passes
- **Committed in:** e9a8942 (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (2 linting bugs)
**Impact on plan:** ESLint compliance fixes required for code quality. No functional changes or scope creep.

## Issues Encountered

None - all tasks completed as specified in plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for Phase 6 (Variant Table):**
- Case selection state properly managed in App.vue
- selectedCaseId available as prop for future VariantTable component
- Case deletion flow complete with refresh and feedback
- All IPC integration working correctly

**Patterns established for Phase 6:**
- Context menu pattern reusable for variant row actions
- Dialog confirmation pattern reusable for other destructive actions
- Snackbar feedback pattern for operation results

**No blockers or concerns.**

---
*Phase: 05-ui-shell-cases*
*Completed: 2026-01-26*
