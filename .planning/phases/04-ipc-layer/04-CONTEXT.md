# Phase 4: IPC Layer - Context

**Gathered:** 2026-01-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Type-safe IPC bridge connecting renderer to main process services. Preload script exposes typed API via contextBridge, main process handlers execute DatabaseService and ImportService operations, progress events stream to renderer during import.

</domain>

<decisions>
## Implementation Decisions

### API shape
- Namespaced structure: `window.api.cases.*`, `window.api.variants.*`, `window.api.import.*`, `window.api.system.*`
- Four namespaces: cases (CRUD), variants (queries), import (file import), system (app-level ops like paths, versions)
- IPC channel naming: `domain:action` format (e.g., `cases:list`, `variants:query`, `import:start`)
- Full TypeScript typing with shared types in `src/shared/types` — preload and main import same interfaces

### Progress streaming
- Push via IPC events — main process sends progress; renderer listens with `window.api.import.onProgress(callback)`
- Granularity: phase + count (matches existing ImportService progress callback)
- Throttled updates: at most every 100-250ms to avoid flooding renderer
- Import is cancellable: `window.api.import.cancel()` stops import and rolls back partial data

### Error handling
- Serialized error objects: `{ code, message, details }` that serialize cleanly across IPC
- Typed error codes: shared `ErrorCode` enum (FILE_NOT_FOUND, PARSE_ERROR, DB_ERROR, CANCELLED, etc.)
- Both technical and user-friendly messages: `{ code, message (technical), userMessage (display-ready) }`
- Centralized handling: all IPC calls go through wrapper that catches, normalizes, and re-throws typed errors

### File dialog UX
- File filters: `*.json`, `*.json.gz` only — matches import format
- Persist last directory: store in app settings, open there next time
- Single file selection only — one import at a time for POC
- Cancellation: throw specific `CancelledError` that UI can distinguish from other errors

### Claude's Discretion
- Exact throttle interval (100-250ms range given)
- Internal structure of IPC handler modules
- How to store persisted directory path (electron-store, simple JSON, etc.)
- Cleanup strategy for cancelled imports

</decisions>

<specifics>
## Specific Ideas

- Channel naming should be easy to trace in DevTools during debugging
- Error structure should make it simple for UI to show appropriate messages without parsing

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-ipc-layer*
*Context gathered: 2026-01-26*
