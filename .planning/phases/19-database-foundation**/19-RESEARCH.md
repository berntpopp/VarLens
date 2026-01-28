# Phase 19: Database Foundation - Research

**Researched:** 2026-01-28
**Domain:** SQLite schema migration, SQLCipher encryption, foreign key enforcement, ACMG classification data modeling
**Confidence:** HIGH

## Summary

This phase extends the existing v0.3.0 SQLite schema with new annotation tables while maintaining SQLCipher encryption compatibility and ensuring foreign key enforcement. The core challenge is safe schema migration on production databases (both plaintext and encrypted) without data loss.

The existing codebase already demonstrates correct patterns for SQLCipher integration (PRAGMA key first, then WAL/foreign keys/schema), ALTER TABLE column additions for schema evolution, and foreign key cascade testing. The new annotation tables follow similar patterns but require careful separation of global annotations (across all cases) vs per-case annotations to support the ACMG classification provenance tracking requirement.

**Primary recommendation:** Use ALTER TABLE ADD COLUMN for schema migration (safe, instant, no data rewrite), track schema version with PRAGMA user_version, verify foreign keys with CASCADE DELETE tests on encrypted databases, and separate ACMG evidence storage from final classification in the schema.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3-multiple-ciphers | 8.3.0+ | SQLite with SQLCipher encryption | Drop-in replacement for better-sqlite3, supports legacy SQLCipher databases, same synchronous API |
| SQLite | 3.37.0+ | Embedded database | Native ALTER TABLE ADD COLUMN support with constraint validation on existing rows |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | Current | Test schema migrations | Test encrypted database migrations, foreign key cascades on real file databases (not just :memory:) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ALTER TABLE | 12-step table rebuild | Only needed for column modifications beyond ADD/DROP/RENAME - adds complexity and migration time |
| PRAGMA user_version | Migration file naming | user_version is built into SQLite, atomic, zero dependencies |

**Installation:**
Already installed in project (better-sqlite3-multiple-ciphers@8.3.0).

## Architecture Patterns

### Recommended Project Structure
```
src/main/database/
├── schema.ts              # Schema definitions + initializeSchema()
├── migrations.ts          # Migration version checks + ALTER TABLE statements (NEW)
├── DatabaseService.ts     # Core service (existing)
└── types.ts               # Type definitions (existing)

tests/main/database/
├── schema.test.ts         # Schema creation tests (existing)
├── migrations.test.ts     # Migration tests on encrypted DBs (NEW)
└── sqlcipher.test.ts      # Encryption tests (existing)
```

### Pattern 1: Safe Schema Migration with PRAGMA user_version

**What:** Track schema version in PRAGMA user_version, apply incremental migrations conditionally.

**When to use:** Every time new tables/columns are added to the schema.

**Example:**
```typescript
// Source: SQLite official docs + community best practices
// https://sqlite.org/pragma.html#pragma_user_version
// https://levlaz.org/sqlite-db-migrations-with-pragma-user_version/

function migrateSchema(db: Database.Database): void {
  const currentVersion = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version

  if (currentVersion < 1) {
    // v0.3.0 base schema (already exists via initializeSchema)
    db.exec('PRAGMA user_version = 1')
  }

  if (currentVersion < 2) {
    // v0.4.0 annotation tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS variant_annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chr TEXT NOT NULL,
        pos INTEGER NOT NULL,
        ref TEXT NOT NULL,
        alt TEXT NOT NULL,
        global_comment TEXT,
        starred INTEGER DEFAULT 0,
        acmg_classification TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(chr, pos, ref, alt)
      )
    `)
    db.exec('PRAGMA user_version = 2')
  }

  // Future migrations: if (currentVersion < 3) { ... }
}
```

### Pattern 2: Global vs Per-Case Annotation Schema

**What:** Separate tables for annotations that apply globally (variant-level) vs annotations specific to a case context.

**When to use:** When annotations have different scopes (global comment applies to chr:pos:ref:alt across all cases, per-case comment applies to one case's interpretation).

**Example:**
```typescript
// Source: GA4GH Variant Annotation spec + Varlens requirements
// https://www.ga4gh.org/product/variant-annotation/

// Global annotations (keyed by variant coordinates)
CREATE TABLE variant_annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chr TEXT NOT NULL,
  pos INTEGER NOT NULL,
  ref TEXT NOT NULL,
  alt TEXT NOT NULL,
  global_comment TEXT,              -- Applies to ALL cases with this variant
  starred INTEGER DEFAULT 0,         -- User flagged as interesting
  acmg_classification TEXT,          -- Final 5-tier classification
  acmg_evidence TEXT,                -- JSON: { criteria: ['PS1', 'PM2'], notes: '...' }
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(chr, pos, ref, alt)
)

// Per-case annotations (keyed by case_id + variant_id)
CREATE TABLE case_variant_annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  variant_id INTEGER NOT NULL,      -- FK to variants.id
  per_case_comment TEXT,             -- Case-specific interpretation
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE,
  UNIQUE(case_id, variant_id)
)
```

### Pattern 3: ACMG Evidence vs Classification Separation

**What:** Store ACMG classification evidence separately from the final classification to support provenance tracking.

**When to use:** When users need to track WHY a classification was made, not just the final result.

**Example:**
```typescript
// Source: ACMG/AMP Guidelines 2015
// https://pmc.ncbi.nlm.nih.gov/articles/PMC4544753/

// Evidence stored as JSON (flexible for 28 criteria codes)
interface AcmgEvidence {
  pathogenic: string[]        // e.g., ['PVS1', 'PS1', 'PM2']
  benign: string[]           // e.g., ['BA1', 'BS2']
  notes: string              // Free-text rationale
  classification_date: number
}

// In variant_annotations table:
// acmg_classification: 'Pathogenic' | 'Likely Pathogenic' | 'VUS' | 'Likely Benign' | 'Benign'
// acmg_evidence: JSON string of AcmgEvidence

// This allows:
// 1. UI to show final classification badge
// 2. Details panel to show which criteria were used
// 3. Editing to preserve previous rationale
// 4. Future: conflict detection if criteria don't match classification
```

### Anti-Patterns to Avoid

- **Testing migrations only on :memory: databases:** :memory: doesn't test encryption key handling or WAL file cleanup. Use temporary file databases for migration tests.
- **Running PRAGMA key after other operations:** Encryption key MUST be the first PRAGMA issued, before WAL mode, foreign keys, or schema operations. (Existing code is correct.)
- **Not verifying PRAGMA foreign_keys = ON:** SQLite disables foreign keys by default. Always check with `PRAGMA foreign_keys` in tests. (Existing code is correct.)
- **Assuming ALTER TABLE is instant without testing:** While ADD COLUMN is instant for simple types, adding columns with CHECK constraints or NOT NULL validates all existing rows (SQLite 3.37.0+). Test with realistic data volumes.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema version tracking | Custom migration table or file naming | PRAGMA user_version | Built into SQLite, atomic, 32-bit signed integer sufficient for version tracking |
| Foreign key cascade testing | Manual delete + count queries | Existing pattern in schema.test.ts | Already validated in v0.3.0 tests, proven to work with SQLCipher |
| Encryption detection | Parsing database file header | DatabaseManager.openDetectEncryption() | Existing implementation handles SQLCipher "file is encrypted or is not a database" error correctly |
| ACMG criteria validation | Custom rules engine | JSON evidence storage + UI validation | ACMG has 28 criteria with complex combining rules - defer to v0.5+ if automated validation needed |

**Key insight:** SQLite's ALTER TABLE ADD COLUMN is instant (modifies schema table only, doesn't touch data) and safe for production migrations. The 12-step table rebuild procedure is only needed for column modifications beyond ADD/DROP/RENAME.

## Common Pitfalls

### Pitfall 1: Foreign Keys Silently Disabled

**What goes wrong:** Tests pass, cascade deletes work, but production databases have orphaned data because PRAGMA foreign_keys wasn't enabled.

**Why it happens:** SQLite disables foreign keys by default for backwards compatibility. Each connection must explicitly enable them.

**How to avoid:**
- Always check `PRAGMA foreign_keys` returns 1 in tests
- Add assertion in DatabaseService constructor (existing code already does this via pragma call)
- Test cascade deletes on file databases, not just :memory:

**Warning signs:**
- Deleting a case doesn't delete its variants
- Foreign key constraint violation errors in development but not production

### Pitfall 2: Schema Migration on Encrypted Database Without Testing

**What goes wrong:** Migration works on plaintext test databases but fails on production encrypted databases with "file is not a database" error.

**Why it happens:** PRAGMA key must be issued before ANY database operations, including ALTER TABLE. In-memory tests don't catch this.

**How to avoid:**
- Create migration tests on temporary encrypted file databases (see sqlcipher.test.ts pattern)
- Test migration path: create v1 encrypted DB → close → reopen with key → run migration to v2
- Verify PRAGMA user_version persists correctly on encrypted databases

**Warning signs:**
- Migrations work in CI (plaintext test DBs) but fail when users open encrypted production databases
- Error message mentions "file is encrypted" during schema operations

### Pitfall 3: ACMG Classification Without Evidence Provenance

**What goes wrong:** Users classify a variant as "Pathogenic" but can't remember why 6 months later. Cannot easily retrofit evidence tracking to existing classifications.

**Why it happens:** Schema only stores final classification (single TEXT column) without separate evidence storage.

**How to avoid:**
- Design schema with separate `acmg_classification` and `acmg_evidence` columns from day one
- Use JSON for evidence to support all 28 ACMG criteria without schema changes
- Add created_at/updated_at timestamps to track when classification was made

**Warning signs:**
- User requests "show me why I classified this as Pathogenic"
- Cannot export classification rationale to ClinVar submission format
- No way to detect conflicting evidence (e.g., PVS1 + BA1 should not both be selected)

### Pitfall 4: ALTER TABLE ADD COLUMN with NOT NULL on Existing Data

**What goes wrong:** Migration fails with "NOT NULL constraint failed" when adding a required column to a table with existing rows.

**Why it happens:** SQLite 3.37.0+ validates NOT NULL constraints on existing rows during ALTER TABLE.

**How to avoid:**
- Add new columns as nullable: `ALTER TABLE variants ADD COLUMN new_col TEXT`
- Or provide a DEFAULT value: `ALTER TABLE variants ADD COLUMN new_col TEXT DEFAULT ''`
- Never add NOT NULL without DEFAULT on tables that have data

**Warning signs:**
- Migration works on empty test database but fails on production database with variants
- Error message: "Cannot add a NOT NULL column with default value NULL"

## Code Examples

Verified patterns from official sources:

### Schema Version Check and Migration

```typescript
// Source: SQLite PRAGMA documentation
// https://sqlite.org/pragma.html#pragma_user_version

export function runMigrations(db: Database.Database): void {
  const result = db.prepare('PRAGMA user_version').get() as { user_version: number }
  const currentVersion = result.user_version

  // v0.3.0 baseline
  if (currentVersion < 1) {
    initializeSchema(db)
    db.exec('PRAGMA user_version = 1')
  }

  // v0.4.0 annotation tables
  if (currentVersion < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS variant_annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chr TEXT NOT NULL,
        pos INTEGER NOT NULL,
        ref TEXT NOT NULL,
        alt TEXT NOT NULL,
        global_comment TEXT,
        starred INTEGER DEFAULT 0,
        acmg_classification TEXT,
        acmg_evidence TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(chr, pos, ref, alt)
      )
    `)

    db.exec(`
      CREATE TABLE IF NOT EXISTS case_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL UNIQUE,
        affected_status TEXT,
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
      )
    `)

    db.exec(`
      CREATE TABLE IF NOT EXISTS cohort_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at INTEGER NOT NULL
      )
    `)

    db.exec(`
      CREATE TABLE IF NOT EXISTS case_cohort_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        cohort_id INTEGER NOT NULL,
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
        FOREIGN KEY (cohort_id) REFERENCES cohort_groups(id) ON DELETE CASCADE,
        UNIQUE(case_id, cohort_id)
      )
    `)

    db.exec(`
      CREATE TABLE IF NOT EXISTS api_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cache_key TEXT NOT NULL UNIQUE,
        response_data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `)

    db.exec(`CREATE INDEX IF NOT EXISTS idx_api_cache_expiry ON api_cache(expires_at)`)

    db.exec('PRAGMA user_version = 2')
  }
}
```

### Foreign Key Cascade Test on Encrypted Database

```typescript
// Source: Existing sqlcipher.test.ts pattern
// Extended for new annotation tables

it('cascades delete to annotations when case is deleted', () => {
  const dbPath = tempDbPath()
  const key = 'test-cascade-key'

  let service = new DatabaseService(dbPath, key)

  // Insert case + variant + annotation
  const caseId = service.createCase('test-case', '/path/to/file.vcf', 1024)
  service.insertVariantsBatch(caseId, [{ chr: '1', pos: 100, ref: 'A', alt: 'G', ... }])

  const variantId = service.database
    .prepare('SELECT id FROM variants WHERE case_id = ?')
    .get(caseId) as { id: number }

  service.database
    .prepare('INSERT INTO case_variant_annotations (case_id, variant_id, per_case_comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(caseId, variantId.id, 'Test comment', Date.now(), Date.now())

  service.close()

  // Reopen and verify annotation exists
  service = new DatabaseService(dbPath, key)
  let annotations = service.database.prepare('SELECT COUNT(*) as count FROM case_variant_annotations').get() as { count: number }
  expect(annotations.count).toBe(1)

  // Delete case and verify cascade
  service.deleteCase(caseId)
  annotations = service.database.prepare('SELECT COUNT(*) as count FROM case_variant_annotations').get() as { count: number }
  expect(annotations.count).toBe(0)

  service.close()
})
```

### Parameterized Query Pattern (SQL Injection Prevention)

```typescript
// Source: OWASP SQL Injection Prevention Cheat Sheet
// https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html

// CORRECT: Use placeholders (?) for all user input
function addGlobalComment(chr: string, pos: number, ref: string, alt: string, comment: string): void {
  this.stmt(`
    INSERT INTO variant_annotations (chr, pos, ref, alt, global_comment, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chr, pos, ref, alt) DO UPDATE SET
      global_comment = excluded.global_comment,
      updated_at = excluded.updated_at
  `).run(chr, pos, ref, alt, comment, Date.now(), Date.now())
}

// INCORRECT: String concatenation (vulnerable to SQL injection)
// function addGlobalComment(comment: string): void {
//   db.exec(`UPDATE variant_annotations SET global_comment = '${comment}'`)
// }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual migration scripts | PRAGMA user_version tracking | SQLite 3.7.0 (2010) | Schema version persists in database file, no external migration state needed |
| String concatenation | Prepared statements with placeholders | better-sqlite3 initial release | 98% reduction in SQL injection vulnerabilities |
| Table rebuild for all changes | ALTER TABLE ADD/DROP/RENAME COLUMN | SQLite 3.25.0 (2018) | Instant schema changes, no data rewrite |
| Add column validation at runtime | ALTER TABLE validates constraints | SQLite 3.37.0 (2021) | NOT NULL and CHECK constraints validated on existing rows during migration |

**Deprecated/outdated:**
- 12-step table rebuild for column additions: Only needed for column modifications (type changes, constraint changes beyond NOT NULL/CHECK). ALTER TABLE ADD COLUMN is now preferred.
- `better-sqlite3` without encryption: Use `better-sqlite3-multiple-ciphers` for drop-in SQLCipher support with legacy database compatibility.

## Open Questions

Things that couldn't be fully resolved:

1. **Custom Tags Schema**
   - What we know: Requirements mention custom tags with name and color (ANNOT-08 to ANNOT-11)
   - What's unclear: Should tags be global (apply to variant across all cases) or per-case? Requirements say "assign to any variant (per-case)" but tag management is global.
   - Recommendation: Use two-table approach - `tags` table (global definitions) + `variant_tags` junction table with case_id for per-case assignments. This supports both global tag management and per-case application.

2. **HPO Term Storage Model**
   - What we know: Users can add HPO phenotype terms to cases (META-06)
   - What's unclear: Store as case_id + hpo_id links, or denormalized JSON array on case_metadata?
   - Recommendation: Normalized linking table `case_hpo_terms (case_id, hpo_id, hpo_label, created_at)` for query flexibility. Denormalized JSON on case_metadata is simpler but harder to query for "all cases with HP:0001250".

3. **API Cache TTL Strategy**
   - What we know: VEP API responses cached with configurable TTL (PANEL-04)
   - What's unclear: Default TTL value, cache invalidation strategy
   - Recommendation: Start with 30-day TTL for variant annotations (stable data), expose as user setting in v0.5+. Add cache_version column to invalidate all entries on schema changes.

## Sources

### Primary (HIGH confidence)
- [SQLite ALTER TABLE Documentation](https://sqlite.org/lang_altertable.html) - Official docs on ADD COLUMN safety
- [SQLite Foreign Key Support](https://sqlite.org/foreignkeys.html) - PRAGMA foreign_keys enforcement
- [SQLite PRAGMA user_version](https://sqlite.org/pragma.html#pragma_user_version) - Schema version tracking
- [better-sqlite3-multiple-ciphers npm](https://www.npmjs.com/package/better-sqlite3-multiple-ciphers) - Library documentation
- [ACMG/AMP Variant Interpretation Guidelines (PMC4544753)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4544753/) - 28 criteria codes and classification framework

### Secondary (MEDIUM confidence)
- [SQLite DB Migrations with PRAGMA user_version](https://levlaz.org/sqlite-db-migrations-with-pragma-user_version/) - Community migration pattern
- [SQLite's user_version pragma for schema versioning](https://gluer.org/blog/sqlites-user_version-pragma-for-schema-versioning/) - Practical implementation guide
- [OWASP SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html) - Parameterized query best practices
- [How to Safely Modify Table Columns in SQLite with Production Data](https://synkee.com.sg/blog/safely-modify-sqlite-table-columns-with-production-data/) - 12-step rebuild process
- [SQLCipher API Documentation](https://www.zetetic.net/sqlcipher/sqlcipher-api/) - PRAGMA key and encryption

### Tertiary (LOW confidence)
- [GA4GH Variant Annotation Specification](https://www.ga4gh.org/product/variant-annotation/) - High-level framework, no schema implementation details
- WebSearch results on ACMG database schemas - No specific 2026 implementations found, framework is stable from 2015 guidelines

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - better-sqlite3-multiple-ciphers is already in use, SQLite ALTER TABLE is well-documented
- Architecture: HIGH - Schema migration patterns verified in official docs, existing codebase already uses correct PRAGMA key ordering
- Pitfalls: HIGH - Foreign key enforcement and encryption testing issues are well-documented in SQLite community
- ACMG model: MEDIUM - Framework is clear (5-tier + 28 criteria) but specific schema implementation is custom to Varlens requirements

**Research date:** 2026-01-28
**Valid until:** 90 days (stable domain - SQLite, SQLCipher, ACMG guidelines change infrequently)
