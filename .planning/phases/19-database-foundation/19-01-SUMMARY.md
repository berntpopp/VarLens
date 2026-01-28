---
phase: 19-database-foundation
plan: 01
subsystem: database
tags: [sqlite, better-sqlite3, migrations, schema, sqlcipher, pragma-user-version]

# Dependency graph
requires:
  - phase: 18-cohort-analysis-foundation
    provides: Existing v0.3.0 schema with cases and variants tables
provides:
  - v0.4.0 annotation schema with 9 new tables
  - PRAGMA user_version migration system
  - TypeScript interfaces for all annotation tables
  - Automatic schema upgrades on database open
affects: [20-annotation-storage, 21-annotation-ui, 22-external-api-integration, 23-hpo-phenotype-matching, 24-acmg-classification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - PRAGMA user_version for migration tracking
    - CREATE TABLE IF NOT EXISTS for idempotency
    - Separate global vs per-case annotation tables

key-files:
  created:
    - src/main/database/migrations.ts
  modified:
    - src/main/database/types.ts
    - src/main/database/DatabaseService.ts
    - src/main/database/index.ts

key-decisions:
  - "Use PRAGMA user_version (not separate migrations table) for simplicity"
  - "Separate global variant annotations from per-case annotations"
  - "Store ACMG evidence as JSON string for flexibility"
  - "No foreign key from variant_annotations to variants (annotations persist across cases)"

patterns-established:
  - "Version-tracked migrations run after PRAGMA key for encrypted databases"
  - "Global annotations keyed by chr:pos:ref:alt coordinates"
  - "All annotation tables use snake_case to match existing schema"

# Metrics
duration: 8.5min
completed: 2026-01-28
---

# Phase 19 Plan 01: Database Foundation Summary

**v0.4.0 annotation schema with 9 tables (global/per-case annotations, ACMG classification, tags, HPO terms) using PRAGMA user_version migrations**

## Performance

- **Duration:** 8.5 min
- **Started:** 2026-01-28T17:36:47Z
- **Completed:** 2026-01-28T17:45:17Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Created version-tracked migration system using PRAGMA user_version
- Added 11 TypeScript interfaces for v0.4.0 annotation tables
- Integrated migrations into DatabaseService constructor (runs automatically on open)
- All 182 existing tests pass with new schema

## Task Commits

Each task was committed atomically:

1. **Task 1: Add annotation table TypeScript interfaces** - `0c4d6ec` (feat)
2. **Task 2: Create migrations.ts with version-tracked schema upgrades** - `8b770f7` (feat)
3. **Task 3: Integrate migrations into DatabaseService constructor** - `2a9f217` (feat)

## Files Created/Modified

- `src/main/database/types.ts` - Added 11 annotation type definitions (VariantAnnotation, CaseVariantAnnotation, CaseMetadata, CohortGroup, CaseCohortLink, ApiCache, Tag, VariantTag, CaseHpoTerm, AcmgClassification, AcmgEvidence)
- `src/main/database/migrations.ts` - Version-tracked migration system with v0.4.0 tables (NEW)
- `src/main/database/DatabaseService.ts` - Import and call runMigrations after initializeSchema
- `src/main/database/index.ts` - Export all new annotation types

## Decisions Made

1. **PRAGMA user_version over migrations table**: Simpler, SQLite-native, no extra table clutter
2. **Separate global vs per-case annotations**: variant_annotations has NO foreign key to variants (annotations persist even if variant deleted in one case), case_variant_annotations has foreign keys to both
3. **ACMG evidence as JSON string**: Flexibility for evolving evidence model without schema changes
4. **9 tables in version 2 migration**:
   - variant_annotations (global, by chr:pos:ref:alt)
   - case_variant_annotations (per-case comments)
   - case_metadata (affected status, notes)
   - cohort_groups + case_cohort_links (cohort definitions)
   - api_cache (VEP/HPO caching)
   - tags + variant_tags (custom tagging)
   - case_hpo_terms (phenotype assignments)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Pre-existing TypeScript errors in renderer (window.api type issues) - not related to database changes
- Pre-existing rollup native module issue - fixed by installing @rollup/rollup-linux-x64-gnu
- 2 pre-existing renderer test failures (App.vue) - unrelated to database changes

All database-related tests (182 tests) passed successfully.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for phase 20 (Annotation Storage):**
- Schema complete with all required tables
- Migration system tested on both :memory: and encrypted databases
- Foreign key constraints verified (PRAGMA foreign_keys = ON)
- All types exported from database module

**No blockers.**

**Critical consideration for next phase:**
- ACMG evidence JSON structure must match AcmgEvidence interface
- Test both global and per-case annotation writes
- Verify starred variants index performance

---
*Phase: 19-database-foundation*
*Completed: 2026-01-28*
