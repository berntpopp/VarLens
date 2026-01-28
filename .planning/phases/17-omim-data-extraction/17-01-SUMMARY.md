---
phase: 17-omim-data-extraction
plan: 01
subsystem: database
tags: [sqlite, fts5, import-pipeline, omim, better-sqlite3]

# Dependency graph
requires:
  - phase: 16-batch-import-zip-extraction
    provides: Import pipeline infrastructure and field extraction patterns
provides:
  - OMIM MIM number storage in variants table
  - FTS5 search including omim_mim_number
  - Import pipeline extracting MIM numbers from source column 25
affects: [17-02-omim-links, cohort-analysis, variant-table-display]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Multi-value field extraction with selected transcript pattern (OMIM follows same pattern as gene_symbol)"
    - "FTS5 rebuild strategy for schema upgrades with legacy compatibility"

key-files:
  created: []
  modified:
    - src/main/database/types.ts
    - src/main/database/schema.ts
    - src/main/database/DatabaseService.ts
    - src/main/import/config/fieldMapping.ts
    - src/main/import/transforms/FieldMapper.ts

key-decisions:
  - "OMIM field uses selected transcript extraction pattern (not dictionary-based)"
  - "FTS5 rebuild drops and recreates index on schema changes to ensure all columns included"
  - "Legacy FTS5 definitions preserved for databases without omim_mim_number column"

patterns-established:
  - "FTS5 schema migration: DROP table/triggers, check column existence, CREATE with appropriate schema, repopulate from variants table"

# Metrics
duration: 5min
completed: 2026-01-28
---

# Phase 17 Plan 01: OMIM Data Extraction Summary

**OMIM MIM number extraction from source column 25 with FTS5 full-text search support and backward-compatible schema migration**

## Performance

- **Duration:** 5 min 20 sec
- **Started:** 2026-01-28T00:19:29Z
- **Completed:** 2026-01-28T00:24:49Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Variant type, schema, and FTS5 index now include omim_mim_number field
- Import pipeline extracts OMIM MIM numbers from source JSON column 25 using selected transcript pattern
- Existing databases gain omim_mim_number column via ALTER TABLE migration
- FTS5 full-text search includes omim_mim_number with automatic rebuild for schema updates
- DatabaseService INSERT statement updated to persist omim_mim_number (20 parameters)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend Variant type, schema, migration, and FTS5 for omim_mim_number** - `b7f4d2f` (feat)
   - Added omim_mim_number to Variant interface
   - Extended schema CREATE TABLE and migration with omim_mim_number column
   - Updated FTS5 virtual table definition to include omim_mim_number
   - Updated all three FTS5 triggers (ai, ad, au) with omim_mim_number
   - Added legacy FTS5 definitions for backward compatibility
   - Implemented FTS5 rebuild in initializeSchema for schema upgrades

2. **Task 2: Add OMIM field mapping, extraction, and INSERT to import pipeline** - `42d2f7f` (feat)
   - Added COLUMN_INDICES.OMIM = 25 constant
   - Added OMIM field mapping (isMultiValue: true, hasDictionary: false)
   - Implemented omim_mim_number extraction in FieldMapper using selected transcript pattern
   - Updated DatabaseService INSERT to include omim_mim_number (20 parameters)
   - Updated debug logging and transaction loop parameters

## Files Created/Modified

- `src/main/database/types.ts` - Added omim_mim_number: string | null to Variant interface
- `src/main/database/schema.ts` - Extended variants table, migration, FTS5 table/triggers, and initializeSchema with omim_mim_number support and legacy compatibility
- `src/main/database/DatabaseService.ts` - Updated INSERT statement to include omim_mim_number (20 parameters total)
- `src/main/import/config/fieldMapping.ts` - Added OMIM: 25 constant and OMIM field mapping configuration
- `src/main/import/transforms/FieldMapper.ts` - Added omim_mim_number extraction using extractValue pattern

## Decisions Made

**1. OMIM extraction uses selected transcript pattern without dictionary**
- Rationale: OMIM MIM numbers are plain 6-digit strings (e.g., "616765"), not coded IDs requiring dictionary lookup. Uses same multi-value extraction pattern as gene_symbol but with hasDictionary: false.

**2. FTS5 rebuild strategy for schema upgrades**
- Rationale: `CREATE VIRTUAL TABLE IF NOT EXISTS` doesn't update existing FTS5 schemas. Must explicitly DROP table/triggers, check column existence, then CREATE with appropriate schema (new or legacy). Ensures existing databases get updated FTS5 index on app upgrade.

**3. Legacy FTS5 definitions for backward compatibility**
- Rationale: Very old databases that somehow lack omim_mim_number column (e.g., migration failed) can still function with old FTS5 schema. Prevents app from crashing on legacy databases.

**4. FTS5 repopulation happens after table creation**
- Rationale: Direct INSERT into variants_fts bypasses triggers (triggers only fire on variants table changes). Repopulation must happen after creating FTS5 table but can happen before or after triggers (triggers are for future changes).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**1. TypeScript error during Task 1 verification**
- Issue: TypeScript reported omim_mim_number missing from MappedVariant in FieldMapper.ts
- Resolution: Expected error - Task 2 adds the omim_mim_number extraction. TypeScript error resolved after Task 2 completion.

**2. Stale .d.ts files causing npx tsc --noEmit errors**
- Issue: Direct npx tsc command failed with "Output file has not been built from source file" errors
- Resolution: Used make typecheck command instead, which runs correct TypeScript configurations (vue-tsc + tsc)

**3. Pre-existing test failures in renderer tests**
- Issue: 2 failing tests in App.test.ts (Vuetify/API initialization errors)
- Resolution: Pre-existing failures unrelated to database schema changes. 182 tests passed including all database and import tests.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for Phase 17 Plan 02 (OMIM Links):**
- Backend fully supports omim_mim_number field from import through query
- FTS5 search includes MIM numbers for autocomplete/search
- Variant query results return omim_mim_number for frontend display
- After importing a case file, variants have populated omim_mim_number values

**What's available:**
- `variant.omim_mim_number` field in Variant interface (string | null)
- Database column populated during import
- FTS5 index searchable by MIM number

**Next plan can:**
- Add omim_mim_number column to variant table UI
- Implement OMIM external link logic (https://www.omim.org/entry/{MIM})
- Wire up click handler following Phase 15 external links pattern

**No blockers or concerns.**

---
*Phase: 17-omim-data-extraction*
*Completed: 2026-01-28*
