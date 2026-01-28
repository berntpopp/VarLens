# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-27)

**Core value:** External collaborators can analyze variant data offline with data-dense UX for research use
**Current focus:** Milestone v0.3.0 -- Cohort Analysis, Security & Import Enhancements

## Current Position

Phase: 18 -- Cohort Analysis
Plan: 2 of 2
Status: Phase complete
Last activity: 2026-01-28 -- Completed 18-02-PLAN.md

Progress: █████████████░░░░░░░ 13/13 plans (100%)

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
| 18 | Cohort Analysis | 2 | ✓ Complete (2/2) |

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
| 32 | LIMIT/OFFSET pagination for cohort aggregation | GROUP BY queries make cursor pagination complex; LIMIT/OFFSET simpler and sufficient for cohort use case | 18 |
| 33 | Composite index on (chr, pos, ref, alt) | Essential for GROUP BY performance in cohort aggregation queries | 18 |
| 34 | variant_key as composite string for v-data-table | Stable unique key for Vuetify item tracking; built in SQL as chr:pos:ref:alt | 18 |
| 35 | Separate tab for cohort analysis | Cohort is fundamentally different workflow from single-case; tab navigation clearer than mode toggle | 18 |
| 36 | FTS5 for gene symbol search with escaping | Gene symbols can contain special FTS5 characters (e.g., BRCA-1); wrap terms with -, *, or " in double quotes to treat as literals | 18 |
| 37 | Lazy loading of carrier data | Load carriers only when row expands to minimize queries; cache in Map for instant subsequent expansions | 18 |
| 38 | Navigate to case tab without variant pre-filtering | Switch to case with full variant list; user can search if needed; simpler than automatic filtering | 18 |
| 39 | 300ms search debounce | Prevent flooding backend with queries while typing; UX standard for search input | 18 |

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
Stopped at: Completed 18-02-PLAN.md (Phase 18 complete - Cohort analysis with search, drill-down, dashboard, gene burden)
Resume file: None

## Next Steps

**Phase 18 complete.** Milestone v0.3.0 complete (all 6 phases, 13 plans).

**v0.3.0 ready for testing and release.**

Next milestone planning (v0.4.0 or later) should consider:
1. Performance profiling with 50+ cases (Research flag from Phase 18)
2. E2E tests for cohort search and drill-down navigation
3. Additional cohort analysis features (variant filtering, export, etc.)

---
*Updated: 2026-01-28 after completing Phase 18-02 (Phase 18 plan 2 of 2 - Cohort analysis UI enhancements)*
