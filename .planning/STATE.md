# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-27)

**Core value:** External collaborators can analyze variant data offline with data-dense UX for research use
**Current focus:** Milestone v0.3.0 -- Cohort Analysis, Security & Import Enhancements

## Current Position

Phase: 17 -- OMIM Data Extraction
Plan: 02 of 2
Status: Phase complete
Last activity: 2026-01-28 -- Completed 17-02-PLAN.md

Progress: ███████████░░░░░░░░░ 11/13 plans (85%)

## Milestone History

- **v0.1 POC** -- 8 phases, 17 plans -- shipped 2026-01-27
- **v0.2.0 UI Polish & Trust Signals** -- 4 phases, 8 plans -- shipped 2026-01-27

## v0.3.0 Phase Summary

| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 13 | SQLCipher Foundation | 2 | ✓ Complete |
| 14 | Database Selection & Encryption UX | 2 | ✓ Complete (2/2) |
| 15 | External Links | 3 | ✓ Complete (3/3) |
| 16 | Batch Import & ZIP Extraction | 2 | ✓ Complete (2/2) |
| 17 | OMIM Data Extraction | 2 | ✓ Complete (2/2) |
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
| 9 | Set VTooltip default contentClass to bg-secondary | Light gray tooltips unreadable on light backgrounds; dark background improves contrast globally | 14 |
| 10 | Pure URL builders with primitive parameters | URL builders take individual parameters (chr, pos, ref, alt) not full Variant object for testability and reuse | 15 |
| 11 | null return semantics for missing data | URL builders return null when data missing; UI layer interprets as "show dash placeholder, no link" | 15 |
| 12 | ClinVar coordinate search for Phase 15 | Use chr:pos:ref:alt search since Variant lacks clinvar_id; ID-based links deferred to Phase 17+ | 15 |
| 13 | OMIM gene search for Phase 15 | Use gene_symbol search since Variant lacks omim_mim_number; MIM-based links deferred to Phase 17 | 15 |
| 14 | Explicit null checks for strict boolean expressions | @typescript-eslint/strict-boolean-expressions requires chr == null || chr === '' instead of !chr | 15 |
| 15 | URL template system for external links | Use {variable} syntax with regex replacement for configurable links; supports 10 variables including derived ones | 15 |
| 16 | Store genome build in externalLinksStore | Genome build affects multiple links and should be user-configurable; moved from VariantTable component state | 15 |
| 17 | Defaults merging on localStorage load | Merge stored links with built-in defaults to handle app updates with new default links | 15 |
| 18 | Domain extraction via dummy substitution | Extract domains from URL templates by replacing variables with dummy values then parsing with URL constructor | 15 |
| 19 | Dynamic v-data-table headers from store | Virtual link columns computed dynamically; headers are reactive to store changes | 15 |
| 20 | Use adm-zip (pure JS) for ZIP extraction | No native rebuild needed, works across platforms, sufficient for variant file archives | 16 |
| 21 | Default duplicate strategy 'skip' for ZIP imports | Freshly extracted temp files won't have name collisions; skip is safest default | 16 |
| 22 | Type cast for adm-zip password API | @types/adm-zip lags behind runtime API; cast is safe and well-documented | 16 |
| 23 | Idempotent cleanupZipTemp on all exit paths | Ensures no orphaned temp directories even on error or unexpected dialog close | 16 |
| 24 | getData(password) over extractAllTo for ZIP | extractAllTo/extractEntryTo trigger uncaught async zlib errors crashing Electron; getData is synchronous and catchable | 16 |
| 25 | Check both encrypted/encripted header properties | @types/adm-zip declares legacy typo "encripted" but runtime uses "encrypted"; check both for compatibility | 16 |
| 26 | Remove app.exit(1) from uncaughtException handler | Non-fatal errors (e.g., zlib) should show dialog but not kill the app | 16 |
| 27 | OMIM extraction uses selected transcript pattern without dictionary | OMIM MIM numbers are plain strings, not coded IDs; follows same multi-value pattern as gene_symbol | 17 |
| 28 | FTS5 rebuild strategy for schema upgrades | DROP and recreate FTS5 table/triggers on schema changes; IF NOT EXISTS doesn't update existing virtual tables | 17 |
| 29 | Legacy FTS5 definitions for backward compatibility | Preserve old FTS5 schema for databases without omim_mim_number column to prevent crashes | 17 |
| 30 | OMIM link uses dedicated inline pattern not template system | MIM number is authoritative single identifier; simpler UX with direct buildOmimUrl than configurable template | 17 |
| 31 | Remove OMIM gene search link from defaults | Users see exact OMIM entry when MIM available, nothing when absent; no generic gene search fallback | 17 |

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

Last session: 2026-01-28
Stopped at: Completed 17-02-PLAN.md (Phase 17 complete - OMIM Data Extraction)
Resume file: None

## Next Steps

1. Execute Phase 18-01 (Cohort aggregation backend)
2. Execute Phase 18-02 (Cohort analysis UI)

---
*Updated: 2026-01-28 after completing Phase 17-02 (Phase 17 plan 2 of 2 - OMIM UI display)*
