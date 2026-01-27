# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-27)

**Core value:** External collaborators can analyze variant data offline with data-dense UX for research use
**Current focus:** Milestone v0.3.0 -- Cohort Analysis, Security & Import Enhancements

## Current Position

Phase: 14 -- Database Selection & Encryption UX
Plan: 1 of 2
Status: In progress
Last activity: 2026-01-27 -- Completed 14-01-PLAN.md

Progress: ███░░░░░░░░░░░░░░░░░ 3/12 plans (25%)

## Milestone History

- **v0.1 POC** -- 8 phases, 17 plans -- shipped 2026-01-27
- **v0.2.0 UI Polish & Trust Signals** -- 4 phases, 8 plans -- shipped 2026-01-27

## v0.3.0 Phase Summary

| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 13 | SQLCipher Foundation | 2 | ✓ Complete |
| 14 | Database Selection & Encryption UX | 2 | In Progress (1/2) |
| 15 | External Links | 2 | Not Started |
| 16 | Batch Import & ZIP Extraction | 2 | Not Started |
| 17 | OMIM Data Extraction | 2 | Not Started |
| 18 | Cohort Analysis | 2 | Not Started |

## Accumulated Context

### Decisions

All decisions from v0.1 are archived in `.planning/milestones/v0.1-ROADMAP.md`.
v0.2.0 decisions are archived in `.planning/milestones/v0.2.0-ROADMAP.md`.

Key architectural decisions carried forward:

| Decision | Summary | Impact |
|----------|---------|--------|
| better-sqlite3 | Synchronous SQLite with native bindings | Core persistence layer (migrating to SQLCipher in v0.3.0) |
| FTS5 | Full-text search for gene autocomplete | Query patterns |
| Cursor pagination | Efficient large result sets | API contract |
| Streaming import | Memory-efficient JSON parsing | Import architecture |
| Warm palette theme | #a09588 primary, #424242 secondary | All UI components |
| HTTPS-only + domain whitelist | shell:openExternal validates protocol and hostname | Security pattern for external links |

v0.3.0 decisions (accumulated during milestone):

| # | Decision | Rationale | Phase |
|---|----------|-----------|-------|
| 1 | Use better-sqlite3-multiple-ciphers v12.6.2 | Matches existing better-sqlite3 version for compatibility, enables encryption capability | 13 |
| 2 | Keep @types/better-sqlite3 devDependency | TypeScript types are compatible with both libraries (same API surface) | 13 |
| 3 | String interpolation for PRAGMA key acceptable in Phase 13 | Test-only usage with hardcoded keys; Phase 14 must sanitize user-provided keys | 13 |
| 4 | PRAGMA key ordering: key → WAL → foreign keys → schema | Encryption key must be first operation after opening database connection | 13 |
| 5 | Use simple JSON file for recent databases persistence | Avoid electron-store (ESM-only) to keep build simple; JSON sufficient for this use case | 14 |
| 6 | Implement rollback pattern in switchDatabase | User should never lose database connection on failed switch; critical for robustness | 14 |
| 7 | Encryption detection via test SELECT query | SQLCipher doesn't mark file headers; only way to detect is attempt to query | 14 |
| 8 | Keep backward-compatible getDatabaseService wrapper | All existing IPC handlers continue working unchanged; reduces refactoring risk | 14 |

### Pending Todos

None yet.

### Blockers/Concerns

None.

### Research Flags

- Phase 13: Verify `better-sqlite3-multiple-ciphers` v12.6.2 prebuilt binaries for Electron 40 on all 3 platforms
- Phase 14: Verify PRAGMA rekey behavior for in-place encryption of existing unencrypted databases
- Phase 17: Investigate source JSON annotation file to identify OMIM column indices (MIM number, disease name)
- Phase 18: Performance profiling with 50+ cases for cohort aggregation queries

## Session Continuity

Last session: 2026-01-27
Stopped at: Completed 14-01-PLAN.md execution
Resume file: None

## Next Steps

1. Execute Phase 14-02 (Database Selection UI)
2. Continue through phases 15-18

---
*Updated: 2026-01-27 after Phase 14-01 execution*
