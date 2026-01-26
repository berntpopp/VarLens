# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-26)

**Core value:** External collaborators can analyze variant data offline with data-dense UX
**Current focus:** Phase 5 - UI Shell + Cases

## Current Position

Phase: 5 of 8 (UI Shell + Cases)
Plan: 1 of 3 in current phase
Status: In progress
Last activity: 2026-01-26 — Completed 05-01-PLAN.md (App Shell Layout)

Progress: [█████-----] 50.0% (4/8 phases complete, 1/3 plans in phase 5)

## Performance Metrics

**Velocity:**
- Total plans completed: 10
- Average duration: 4m 43s
- Total execution time: 0.79 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01    | 2     | 11m 3s | 5m 32s  |
| 02    | 3     | 10m 25s | 3m 28s  |
| 03    | 2     | 16m 9s | 8m 5s  |
| 04    | 3     | 9m 6s | 3m 2s   |

**Recent Trend:**
- Last 5 plans: 03-02 (13m 32s), 04-01 (3m 47s), 04-02 (2m 52s), 04-03 (2m 27s), 05-01 (1m 16s)
- Trend: Phase 05 started with fastest plan yet; UI shell layout complete

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

| ID | Decision | Phase | Impact |
|----|----------|-------|--------|
| D001 | Use electron-vite over webpack-based electron-builder | 01-01 | Faster HMR, simpler config |
| D002 | Enable strict TypeScript mode | 01-01 | Requires explicit types |
| D003 | Use single instance lock | 01-01 | Prevents multiple app instances |
| D004 | Auto-open DevTools in dev | 01-01 | Streamlines development |
| D005 | Vuetify 3 with autoImport | 01-01 | Smaller bundle via tree-shaking |
| D006 | ESLint 9 flat config format | 01-02 | Future-proof configuration |
| D007 | projectService over project | 01-02 | Supports project references |
| D008 | happy-dom over jsdom | 01-02 | Faster test execution |
| D009 | Coverage thresholds at 70% | 01-02 | Balanced quality requirement |
| D010 | vue-tsc for renderer code | 01-02 | Proper Vue SFC type checking |
| D011 | snake_case for TypeScript DB properties | 02-01 | Matches SQLite column naming |
| D012 | FTS5 with external content table | 02-01 | Data stored once, FTS references via content_rowid |
| D013 | FTS5 triggers for index sync | 02-01 | Automatic index maintenance |
| D014 | Object.setPrototypeOf for error classes | 02-01 | Proper instanceof checks |
| D015 | Make runTransaction public instead of private | 02-02 | Enables variant batch operations and testing |
| D016 | Test WAL mode with file-based temp database | 02-02 | In-memory dbs report 'memory' mode |
| D017 | Use BATCH_SIZE=5000 for variant batch inserts | 02-03 | Optimal SQLite transaction performance |
| D018 | Include null gnomAD AF in filters, exclude null CADD | 02-03 | Unknown AF passes rare filters, unknown CADD excluded |
| D019 | Column indices hardcoded based on test data analysis | 03-01 | Direct array access faster than header lookup |
| D020 | IMPACT_DICTIONARY as static constant | 03-01 | Impact codes consistent across VEP files |
| D021 | Gene dictionary loaded dynamically from file header | 03-01 | Gene ID mappings vary by annotation version |
| D022 | Invalid variants skipped rather than throwing errors | 03-01 | Import continues on partial data, skipped count reported |
| D023 | Use stream-json with pick+streamArray pattern | 03-02 | Memory-efficient JSON parsing without loading entire file |
| D024 | Extract Gene dictionary via separate header stream | 03-02 | Dictionary needed before variant processing |
| D025 | Track depth in parser events to identify top-level keys | 03-02 | stream-json emits low-level events requiring depth tracking |
| D026 | Seven error codes cover all IPC error scenarios | 04-01 | FILE_NOT_FOUND, PARSE_ERROR, DB_ERROR, CANCELLED, NOT_FOUND, UNIQUE_CONSTRAINT, UNKNOWN |
| D027 | Error serialization returns objects not thrown errors | 04-01 | Electron IPC Structured Clone Algorithm loses error prototypes |
| D028 | Namespaced API structure for logical grouping | 04-01 | window.api.cases/variants/import/system matches domain boundaries |
| D029 | Remove electron-toolkit electronAPI in favor of our typed API | 04-02 | Simpler preload, fewer dependencies exposed to renderer |
| D030 | Include src/shared/**/* in tsconfig.node.json | 04-02 | Enables proper TypeScript compilation for preload bridge |
| D031 | onProgress returns cleanup function for memory leak prevention | 04-02 | Pattern prevents accumulating event listeners, follows React best practices |
| D032 | DatabaseService singleton pattern for main process | 04-03 | Single database connection shared across all handlers via getDatabaseService() |
| D033 | Handler self-registration via module imports | 04-03 | Handlers register channels on import, avoiding explicit registration boilerplate |
| D034 | Progress throttling at 100ms intervals | 04-03 | Prevents overwhelming renderer with progress events during import |
| D035 | Import directory persistence in settings.json | 04-03 | File dialog defaults to last directory for better UX |
| D036 | Use permanent prop on v-navigation-drawer | 05-01 | Ensures v-main adjusts width automatically |
| D037 | selectedCaseId typed as number or null | 05-01 | Matches database case.id type for direct comparison |

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-01-26 18:17:33 UTC
Stopped at: Completed 05-01-PLAN.md (App Shell Layout)
Resume file: None
