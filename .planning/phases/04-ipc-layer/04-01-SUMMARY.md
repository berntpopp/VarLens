---
phase: 04-ipc-layer
plan: 01
subsystem: ipc
tags: [electron, typescript, ipc, error-handling, contextbridge]

# Dependency graph
requires:
  - phase: 02-database-layer
    provides: "DatabaseService, DatabaseError classes, and type definitions"
  - phase: 03-import-service
    provides: "ImportService types (ProgressUpdate, ImportResult)"
provides:
  - "WindowAPI interface defining IPC contract for cases, variants, import, and system namespaces"
  - "SerializableError type and ErrorCode enum for type-safe IPC error handling"
  - "Error serialization infrastructure (toSerializableError, wrapHandler) for IPC handlers"
  - "Shared types importable across main, preload, and renderer processes"
affects: [04-02, 04-03, renderer-layer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared types in src/shared/types for cross-process type safety"
    - "Error serialization wrapper pattern for IPC handlers"
    - "Namespaced API structure (cases, variants, import, system)"

key-files:
  created:
    - src/shared/types/api.ts
    - src/shared/types/errors.ts
    - src/shared/types/index.ts
    - src/main/ipc/errorHandler.ts
    - src/main/ipc/index.ts
  modified: []

key-decisions:
  - "D026: Seven error codes (FILE_NOT_FOUND, PARSE_ERROR, DB_ERROR, CANCELLED, NOT_FOUND, UNIQUE_CONSTRAINT, UNKNOWN) cover all IPC error scenarios"
  - "D027: Error serialization returns plain objects not thrown errors to avoid prototype loss across IPC boundary"
  - "D028: Namespaced API structure (window.api.cases.*, window.api.variants.*, etc.) for logical grouping"

patterns-established:
  - "Pattern: Shared types in src/shared/types/ directory importable by main, preload, and renderer"
  - "Pattern: wrapHandler wraps all IPC handlers to catch and serialize errors"
  - "Pattern: Error classes map to specific ErrorCode enum values for type-safe error handling"

# Metrics
duration: 3m 47s
completed: 2026-01-26
---

# Phase 04 Plan 01: IPC Foundation Summary

**Type-safe IPC contracts with WindowAPI interface and error serialization infrastructure for cross-process communication**

## Performance

- **Duration:** 3 min 47 sec
- **Started:** 2026-01-26T17:42:42Z
- **Completed:** 2026-01-26T17:46:29Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created shared type definitions for IPC API surface (WindowAPI with four namespaces)
- Implemented error serialization infrastructure that converts database errors and system errors to IPC-safe format
- Established src/shared/types/ directory for types importable across main, preload, and renderer processes
- Defined seven error codes covering all expected IPC error scenarios
- Created wrapHandler function for consistent error handling across all IPC operations

## Task Commits

Each task was committed atomically:

1. **Task 1: Create shared IPC types** - `867b8bf` (feat)
2. **Task 2: Create IPC error handler and registration infrastructure** - `f9a7005` (feat)

## Files Created/Modified
- `src/shared/types/api.ts` - WindowAPI interface with CasesAPI, VariantsAPI, ImportAPI, SystemAPI namespaces; re-exports database and import types
- `src/shared/types/errors.ts` - ErrorCode enum, SerializableError interface, IpcResult type, isIpcError type guard
- `src/shared/types/index.ts` - Barrel export for shared types
- `src/main/ipc/errorHandler.ts` - toSerializableError function mapping error types to codes; wrapHandler for async error catching
- `src/main/ipc/index.ts` - registerIpcHandlers placeholder for handler registration (handlers added in Plan 03)

## Decisions Made

**D026: Seven error codes cover all IPC scenarios**
- Rationale: FILE_NOT_FOUND, PARSE_ERROR, DB_ERROR, CANCELLED, NOT_FOUND, UNIQUE_CONSTRAINT, UNKNOWN provide specific error types for all expected failures plus fallback
- Impact: Renderer can handle errors appropriately (retry DB_ERROR, accept CANCELLED, show user message for NOT_FOUND)

**D027: Error serialization returns objects instead of throwing**
- Rationale: Electron IPC Structured Clone Algorithm only serializes error.message; custom properties and prototypes are lost
- Impact: toSerializableError converts errors to plain objects with code/message/userMessage; wrapHandler returns these instead of throwing

**D028: Namespaced API structure for logical grouping**
- Rationale: window.api.cases.*, window.api.variants.*, window.api.import.*, window.api.system.* groups related operations
- Impact: Clearer API surface, easier to reason about permissions, matches domain boundaries

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**TypeScript compilation errors during verification**
- Issue: Pre-existing errors in test files and missing type declarations for stream-json
- Resolution: Verified new files in isolation using `npx tsc --noEmit src/shared/types/*.ts src/main/ipc/*.ts` which passed successfully
- Impact: None - new code compiles correctly; existing issues are outside scope of this plan

**Generated .d.ts files conflicting with TypeScript**
- Issue: Project uses composite mode which generates .d.ts files; `git clean -fdX` removed node_modules requiring reinstall
- Resolution: Removed generated files manually and reinstalled dependencies with `npm install`
- Impact: Added ~3 minutes to execution time for dependency reinstall

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for Plan 02 (Preload Script):**
- WindowAPI interface defines complete type contract
- SerializableError type available for renderer-side error handling
- Shared types can be imported in preload script to implement contextBridge exposure

**Ready for Plan 03 (IPC Handlers):**
- wrapHandler ready to wrap all ipcMain.handle callbacks
- toSerializableError handles all database and system error types
- registerIpcHandlers ready to import handler modules

**No blockers identified.**

---
*Phase: 04-ipc-layer*
*Completed: 2026-01-26*
