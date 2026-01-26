---
phase: 02-database-layer
plan: 03
subsystem: database
tags: [sqlite, better-sqlite3, batch-insert, pagination, fts5, filtering]

dependency-graph:
  requires: [02-01, 02-02]
  provides: [variant-batch-insert, cursor-pagination, variant-filtering, fts5-search]
  affects: [03-vcf-parsing, 04-ipc, 05-ui-components]

tech-stack:
  added: []
  patterns: [batch-transaction, cursor-pagination, dynamic-sql-filters, fts5-match-bm25]

key-files:
  created:
    - tests/main/database/variants.test.ts
  modified:
    - src/main/database/DatabaseService.ts

decisions:
  - id: D017
    decision: Use BATCH_SIZE=5000 for variant batch inserts
    rationale: Optimal SQLite transaction performance for bulk imports
  - id: D018
    decision: Include null gnomAD AF in filters, exclude null CADD
    rationale: Unknown AF should pass rare variant filters, unknown CADD means no pathogenicity evidence

metrics:
  duration: 3m 44s
  completed: 2026-01-26
---

# Phase 02 Plan 03: Variant Operations Summary

Extended DatabaseService with batch insert, cursor-based pagination, dynamic filtering, and FTS5 search using bm25 relevance ranking.

## What Was Built

### Task 1-2: Variant Operations (DatabaseService.ts - 380 lines total)

Added four new methods to DatabaseService:

**insertVariantsBatch(caseId, variants) - DB-04:**
```typescript
insertVariantsBatch(caseId: number, variants: Omit<Variant, 'id' | 'case_id'>[]): number {
  // Verify case exists first
  this.getCase(caseId)

  const insertBatch = this.db.transaction((batch) => {
    for (const v of batch) {
      insert.run(caseId, v.chr, v.pos, ...)
    }
  })

  // Process in BATCH_SIZE chunks
  for (let i = 0; i < variants.length; i += BATCH_SIZE) {
    insertBatch(variants.slice(i, i + BATCH_SIZE))
  }

  this.updateCaseVariantCount(caseId, variants.length)
  return variants.length
}
```

**getVariantCount(caseId) - Helper:**
- Simple COUNT(*) query for case variants

**getVariants(filter, limit, cursor) - DB-05, DB-06:**
- Dynamic WHERE clause building based on filter object
- Filters: gene_symbol (LIKE partial), consequence (exact), gnomad_af_max, cadd_min
- Null handling: `(gnomad_af IS NULL OR gnomad_af <= ?)` vs `(cadd IS NOT NULL AND cadd >= ?)`
- Cursor pagination: `(pos > ? OR (pos = ? AND id > ?))`
- Returns PaginatedResult with data, next_cursor, has_more, total_count

**searchVariants(caseId, query, limit) - FTS5 Search:**
```typescript
searchVariants(caseId: number, query: string, limit: number = 50): Variant[] {
  const ftsQuery = `"${query.replace(/"/g, '""')}"*`  // Prefix match, escape quotes

  return this.db.prepare(`
    SELECT v.* FROM variants v
    JOIN variants_fts fts ON v.id = fts.rowid
    WHERE v.case_id = ? AND variants_fts MATCH ?
    ORDER BY bm25(variants_fts)
    LIMIT ?
  `).all(caseId, ftsQuery, limit)
}
```

### Task 3: Comprehensive Tests (variants.test.ts - 821 lines)

29 tests covering all variant operations:

| Group | Tests | Coverage |
|-------|-------|----------|
| insertVariantsBatch | 6 | Insert count, case update, batch boundary, multiple batches, NotFoundError, FTS5 index |
| getVariantCount | 2 | Zero count, correct count |
| getVariants pagination | 6 | First page, has_more true/false, cursor navigation, total_count, empty result |
| getVariants filters | 7 | gene_symbol partial, consequence exact, gnomad_af_max, null AF included, cadd_min, null CADD excluded, combined filters |
| searchVariants FTS5 | 6 | Prefix match, consequence search, relevance order, no matches, limit, case-insensitive |
| Edge cases | 2 | All null optional fields, special characters |

Test helpers created:
- `createTestCase(db, name)` - Creates case with standard fields
- `createTestVariants(count, options)` - Generates varied test data

## Key Technical Details

**Batch Insert Transaction Pattern:**
Each batch of 5000 variants is wrapped in a transaction. If any insert fails, only that batch rolls back. FTS5 triggers automatically maintain the search index.

**Dynamic SQL Filter Building:**
Conditions array accumulates based on filter values, then joined with AND. Params array grows in parallel. Count query excludes cursor condition for accurate total.

**FTS5 Query Safety:**
Quotes user input and escapes internal quotes: `"user""input"*`
This prevents FTS5 syntax injection while enabling prefix matching.

**Cursor Pagination Logic:**
Uses composite cursor (pos, id) for deterministic ordering. Fetches limit+1 to detect has_more without separate query.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed strict boolean expression lint errors**

- **Found during:** Task 2 verification
- **Issue:** ESLint strict-boolean-expressions flagged `if (filter.gene_symbol)` for optional strings
- **Fix:** Changed to explicit checks: `if (filter.gene_symbol !== undefined && filter.gene_symbol !== '')`
- **Files modified:** src/main/database/DatabaseService.ts
- **Commit:** eac2d62

**2. [Rule 2 - Missing Critical] Ran prettier auto-fix on test file**

- **Found during:** Task 3 verification
- **Issue:** Multi-line object literals not formatted per prettier rules
- **Fix:** Ran `npm run lint` auto-fix
- **Files modified:** tests/main/database/variants.test.ts
- **Commit:** afc7a0d

## Verification Results

| Check | Result |
|-------|--------|
| `npm run typecheck` | Pass - zero errors |
| `npm run lint:check` | Pass - zero errors |
| `npm run test` | Pass - 73/73 tests (29 new + 44 existing) |
| Coverage | 98.24% statements, 87.5% branches |

## Commits

| Hash | Message |
|------|---------|
| eac2d62 | feat(02-03): add variant batch insert and query operations |
| afc7a0d | test(02-03): add comprehensive variant operation tests |

## Files Changed

| File | Lines | Purpose |
|------|-------|---------|
| src/main/database/DatabaseService.ts | +171 | Variant operations |
| tests/main/database/variants.test.ts | +821 | Comprehensive tests |
| **Total** | **992** | |

## Next Phase Readiness

**For 03-VCF-Parsing:**
- insertVariantsBatch ready for bulk import workflow
- Batch size (5000) optimized for typical VCF files
- FTS5 index auto-maintained via triggers

**For 04-IPC:**
- getVariants provides paginated data for renderer
- searchVariants enables real-time search UI
- All methods return typed results

**No blockers identified.**
