---
phase: 02-database-layer
plan: 01
subsystem: database
tags: [sqlite, better-sqlite3, fts5, typescript, schema]

dependency-graph:
  requires: [01-foundation]
  provides: [database-types, database-errors, database-schema]
  affects: [02-02, 02-03, 03-vcf-parsing]

tech-stack:
  added: []
  patterns: [custom-error-classes, fts5-external-content, keyset-pagination]

key-files:
  created:
    - src/main/database/types.ts
    - src/main/database/errors.ts
    - src/main/database/schema.ts
    - tests/main/database/schema.test.ts
  modified: []

decisions:
  - id: D011
    decision: Use snake_case for TypeScript properties to match SQLite columns
    rationale: Eliminates mapping layer between TypeScript and database
  - id: D012
    decision: FTS5 with external content table (content='variants')
    rationale: Data stored once in variants table, FTS index references it via content_rowid
  - id: D013
    decision: FTS5 triggers for INSERT/UPDATE/DELETE sync
    rationale: Automatic index maintenance without application-level code
  - id: D014
    decision: Object.setPrototypeOf for custom error classes
    rationale: Ensures instanceof checks work correctly with TypeScript error inheritance

metrics:
  duration: 3m 10s
  completed: 2026-01-26
---

# Phase 02 Plan 01: Database Types, Errors, and Schema Summary

TypeScript interfaces for Case/Variant entities with FTS5 full-text search schema and custom error classes supporting proper instanceof checks.

## What Was Built

### Task 1: TypeScript Types (types.ts - 94 lines)

Created database entity interfaces matching SQLite schema:

- **Case**: id, name, file_path, file_size, variant_count, created_at
- **Variant**: genomic fields (chr, pos, ref, alt) plus annotations (gene_symbol, consequence, gnomad_af, cadd, clinvar)
- **VariantFilter**: case_id (required), optional filters for gene, consequence, frequency, CADD
- **PaginationCursor**: keyset pagination with id and sort_value
- **PaginatedResult<T>**: generic wrapper with data, next_cursor, has_more, total_count

### Task 2: Custom Error Classes (errors.ts - 73 lines)

Created typed error hierarchy for database operations:

- **DatabaseError**: Base class with optional cause property for wrapping
- **NotFoundError**: For missing resources with standard message format
- **UniqueConstraintError**: For constraint violations with field/value context
- **TransactionError**: For transaction failures with cause tracking

All classes use `Object.setPrototypeOf` pattern for proper prototype chain.

### Task 3: Schema Definitions (schema.ts - 110 lines)

Created SQL constants and initialization function:

- **createTables**: cases and variants tables with foreign key
- **createIndexes**: 4 indexes (case_id, gene, position, filters)
- **createFTSTable**: FTS5 virtual table with unicode61 tokenizer and prefix='2 3'
- **createFTSTriggers**: INSERT/UPDATE/DELETE triggers for FTS sync
- **initializeSchema(db)**: Executes all schema SQL in order

### Task 3: Schema Tests (schema.test.ts - 413 lines)

18 comprehensive tests covering:

- Table creation with correct columns and types
- Index creation verification
- FTS5 virtual table creation
- Trigger functionality (INSERT, UPDATE, DELETE sync)
- initializeSchema idempotency
- Foreign key constraint enforcement
- ON DELETE CASCADE behavior
- FTS5 prefix search and case-insensitive matching

## Key Technical Details

**FTS5 Configuration:**
```sql
CREATE VIRTUAL TABLE variants_fts USING fts5(
  gene_symbol, consequence,
  content='variants', content_rowid='id',
  tokenize='unicode61 remove_diacritics 1',
  prefix='2 3'
);
```

- External content table (content='variants') - data stored once
- unicode61 tokenizer with diacritic removal for case-insensitive search
- Prefix indexes for 2 and 3 character prefixes (fast prefix search)

**FTS5 Triggers:**
- INSERT trigger: adds to FTS index
- DELETE trigger: uses special `INSERT INTO fts(fts, ...)` syntax with 'delete' command
- UPDATE trigger: delete old, insert new (FTS5 external content pattern)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Rebuilt better-sqlite3 native module**

- **Found during:** Task 3 test execution
- **Issue:** better-sqlite3 was compiled for different Node.js version (NODE_MODULE_VERSION 143 vs 137)
- **Fix:** Ran `npm rebuild better-sqlite3` to recompile for current Node.js
- **Files modified:** node_modules/better-sqlite3/build/Release/better_sqlite3.node

**2. [Rule 1 - Bug] Fixed prettier formatting in test file**

- **Found during:** Lint verification
- **Issue:** Multi-line method chain not formatted per prettier rules
- **Fix:** Ran `npm run lint` to auto-fix
- **Files modified:** tests/main/database/schema.test.ts

## Verification Results

| Check | Result |
|-------|--------|
| `npm run typecheck` | Pass - zero errors |
| `npm run lint:check` | Pass - zero errors |
| `npm run test` | Pass - 20/20 tests (18 new + 2 existing) |

## Commits

| Hash | Message |
|------|---------|
| 2c517e8 | feat(02-01): create TypeScript types for database entities |
| 6a4d5f4 | feat(02-01): create custom error classes for database operations |
| 5c7217a | feat(02-01): create schema definitions with FTS5 and tests |

## Files Changed

| File | Lines | Purpose |
|------|-------|---------|
| src/main/database/types.ts | 94 | Entity interfaces |
| src/main/database/errors.ts | 73 | Custom error classes |
| src/main/database/schema.ts | 110 | SQL schema definitions |
| tests/main/database/schema.test.ts | 413 | Schema tests |
| **Total** | **690** | |

## Next Phase Readiness

**For 02-02 (DatabaseService Implementation):**
- Types ready: Case, Variant, VariantFilter, PaginationCursor, PaginatedResult
- Errors ready: DatabaseError, NotFoundError, UniqueConstraintError, TransactionError
- Schema ready: initializeSchema(db) function
- FTS5 ready: Full-text search with prefix matching configured

**No blockers identified.**
