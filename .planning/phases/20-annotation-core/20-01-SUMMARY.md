---
phase: 20-annotation-core
plan: 01
subsystem: database
tags: [better-sqlite3, ipc, electron, annotations, crud, atomic-upsert]

# Dependency graph
requires:
  - phase: 19-database-foundation
    provides: variant_annotations and case_variant_annotations tables with schema v2
provides:
  - DatabaseService annotation CRUD methods with atomic upsert
  - IPC handlers for 7 annotation operations
  - Typed preload API namespace for renderer access
  - Boolean to INTEGER conversion for starred field
affects: [20-02-annotation-ui, 23-side-panel-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic upsert with INSERT ON CONFLICT for race-free updates"
    - "COALESCE pattern for partial field updates"
    - "Boolean to 0/1 conversion for SQLite INTEGER columns"
    - "Combined fetch method (global + per-case) for UI efficiency"

key-files:
  created:
    - src/main/ipc/handlers/annotations.ts
  modified:
    - src/main/database/DatabaseService.ts
    - src/main/ipc/index.ts
    - src/preload/index.ts
    - src/shared/types/api.ts

key-decisions:
  - "Use INSERT ON CONFLICT DO UPDATE with COALESCE for atomic partial updates"
  - "Convert boolean starred to 0/1 in IPC handler before database write"
  - "Provide getAnnotationsForVariant for single-query fetch of both global and per-case"
  - "Use RETURNING * to get upserted row without separate SELECT"

patterns-established:
  - "Annotation upsert pattern: atomic INSERT ON CONFLICT with COALESCE for nullable fields"
  - "Boolean conversion layer: renderer uses boolean, IPC converts to 0/1, DB stores INTEGER"
  - "Combined fetch pattern: getAnnotationsForVariant returns {global, perCase} in one call"

# Metrics
duration: 5min
completed: 2026-01-28
---

# Phase 20 Plan 01: Annotation Backend Summary

**DatabaseService annotation CRUD with atomic upsert, 7 IPC handlers, and typed preload API for global/per-case variant annotations**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-28T21:50:31Z
- **Completed:** 2026-01-28T21:55:33Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Atomic annotation upsert methods using INSERT ON CONFLICT to prevent race conditions
- 7 IPC handlers (getGlobal, upsertGlobal, deleteGlobal, getPerCase, upsertPerCase, deletePerCase, getForVariant)
- Type-safe renderer API via window.api.annotations namespace
- Boolean to INTEGER conversion layer for starred field
- Combined fetch method for UI efficiency (single query for both global and per-case)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add annotation CRUD methods to DatabaseService** - `51ce5c0` (feat)
2. **Task 2: Create annotations IPC handler module** - `7101abf` (feat)
3. **Task 3: Extend preload API with annotations namespace** - `190b274` (feat)

## Files Created/Modified
- `src/main/database/DatabaseService.ts` - Added 7 annotation methods (get, upsert, delete for global and per-case, plus combined fetch)
- `src/main/ipc/handlers/annotations.ts` - New IPC handler module with 7 annotation channels
- `src/main/ipc/index.ts` - Registered annotations handler module
- `src/preload/index.ts` - Added annotations namespace to window.api
- `src/shared/types/api.ts` - Added GlobalAnnotationUpdates, PerCaseAnnotationUpdates, VariantAnnotationsResult, AnnotationsAPI types

## Decisions Made

**1. Use INSERT ON CONFLICT DO UPDATE with COALESCE for atomic partial updates**
- Rationale: Avoids race conditions from check-then-insert pattern. COALESCE only updates non-null fields in updates object.
- Impact: All annotation upserts are atomic and race-free. Per RESEARCH.md guidance on pitfall 5.

**2. Convert boolean starred to 0/1 in IPC handler, not DatabaseService**
- Rationale: Keep DatabaseService pure SQL (INTEGER), put conversion layer in IPC handler where renderer boolean meets database INTEGER.
- Impact: DatabaseService methods accept number (0/1), IPC handlers convert from boolean. Clear separation of concerns.

**3. Provide getAnnotationsForVariant for single-query fetch**
- Rationale: UI needs both global and per-case annotations for a variant. Single method reduces IPC calls and simplifies UI code.
- Impact: Renderer can get both annotation types in one call. More efficient than two separate IPC invocations.

**4. Use RETURNING * to get upserted row without separate SELECT**
- Rationale: SQLite 3.35.0+ supports RETURNING. Eliminates need for separate query after INSERT/UPDATE.
- Impact: Single statement for upsert + fetch. Cleaner code, slightly faster.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Backend annotation infrastructure complete. Ready for:
- **Plan 20-02:** UI components for annotation display and editing (star toggle, comment fields, ACMG classification)
- **Phase 21:** API service layer can use annotation data for VEP/HPO enrichment
- **Phase 23:** Side panel can display and edit annotations via window.api.annotations

All 7 IPC channels operational:
- annotations:getGlobal
- annotations:upsertGlobal
- annotations:deleteGlobal
- annotations:getPerCase
- annotations:upsertPerCase
- annotations:deletePerCase
- annotations:getForVariant

No blockers identified.

---
*Phase: 20-annotation-core*
*Completed: 2026-01-28*
