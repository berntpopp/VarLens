# Phase 2: Database Layer - Research

**Researched:** 2026-01-26
**Domain:** SQLite with better-sqlite3, FTS5 full-text search, TypeScript
**Confidence:** HIGH

## Summary

The Database Layer for genomic variant storage should use better-sqlite3 (v12.6.2 already installed) with SQLite's FTS5 extension for full-text search. Better-sqlite3 is 11.7x faster than node-sqlite3 for single-row selection and 15.6x faster for batch transactions, using a synchronous API that paradoxically provides better concurrency than async alternatives.

For an Electron application storing genomic variants (cases and variants tables), the standard approach is:
- Single DatabaseService class with typed methods (not repositories - simpler for single data source)
- WAL mode for concurrent reads during imports
- FTS5 with unicode61 tokenizer and prefix indexes for gene/consequence search
- Prepared statement caching built into better-sqlite3
- Transactions with 5000-row batches for optimal insert performance
- Database stored in `app.getPath('userData')` for cross-platform persistence

**Primary recommendation:** Use a single DatabaseService class that encapsulates all database operations with typed methods, prepared statement caching, and transaction wrappers. The synchronous API of better-sqlite3 is ideal for Electron's main process and eliminates async complexity.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.6.2 | SQLite driver for Node.js | 11.7x-24.4x faster than alternatives, synchronous API prevents mutex contention, official @types support |
| @types/better-sqlite3 | 7.6.13 | TypeScript definitions | Maintained in DefinitelyTyped, comprehensive type coverage for Database, Statement, Transaction |
| SQLite FTS5 | Built-in | Full-text search extension | Native SQLite feature, superior to FTS3/FTS4, supports prefix search and BM25 ranking |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| better-sqlite-pool | Latest | Connection pooling | Only if multi-threaded worker scenarios needed (unlikely for Electron) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| better-sqlite3 | node-sqlite3 | Async API but 11.7x-24.4x slower; better-sqlite3 is synchronous but more performant |
| FTS5 | FTS3/FTS4 | Older versions, inferior prefix search support; FTS5 is current recommended version |
| Single service | Repository pattern | Repository adds abstraction layers unnecessary for single data source; service pattern simpler |

**Installation:**
```bash
npm install better-sqlite3@12.6.2
npm install --save-dev @types/better-sqlite3@7.6.13
```

Already installed in this project (confirmed via package.json).

## Architecture Patterns

### Recommended Project Structure
```
src/
├── main/
│   ├── database/
│   │   ├── DatabaseService.ts      # Main service class
│   │   ├── schema.ts                # Schema definitions
│   │   ├── types.ts                 # TypeScript interfaces
│   │   └── errors.ts                # Custom error classes
│   └── index.ts
```

### Pattern 1: Single DatabaseService Class
**What:** A single service class that encapsulates all database operations with typed methods
**When to use:** Applications with a single SQLite database (this project)
**Example:**
```typescript
// Source: Repository pattern research + better-sqlite3 best practices
import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';

class DatabaseService {
  private db: Database.Database;
  private statements: Map<string, Database.Statement>;

  constructor() {
    const dbPath = path.join(app.getPath('userData'), 'varlens.db');
    this.db = new Database(dbPath);
    this.statements = new Map();

    // Enable WAL mode for concurrent reads
    this.db.pragma('journal_mode = WAL');

    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');

    this.initializeSchema();
  }

  // Prepared statement caching
  private getStatement(sql: string): Database.Statement {
    if (!this.statements.has(sql)) {
      this.statements.set(sql, this.db.prepare(sql));
    }
    return this.statements.get(sql)!;
  }

  // Transaction wrapper
  public transaction<T>(fn: () => T): T {
    const txn = this.db.transaction(fn);
    return txn();
  }

  // Typed method example
  public createCase(name: string, filePath: string, fileSize: number): number {
    const stmt = this.getStatement(
      'INSERT INTO cases (name, file_path, file_size, created_at) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(name, filePath, fileSize, Date.now());
    return result.lastInsertRowid as number;
  }

  public close(): void {
    this.db.close();
  }
}
```

### Pattern 2: FTS5 Integration
**What:** Virtual FTS5 table that indexes gene_symbol and consequence columns
**When to use:** Full-text search requirements with prefix matching
**Example:**
```typescript
// Source: https://sqlite.org/fts5.html
const createFTSTable = `
  CREATE VIRTUAL TABLE variants_fts USING fts5(
    gene_symbol,
    consequence,
    content='variants',
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 0',
    prefix='2 3'
  );
`;

// Triggers to maintain FTS index
const createFTSTriggers = `
  CREATE TRIGGER variants_ai AFTER INSERT ON variants BEGIN
    INSERT INTO variants_fts(rowid, gene_symbol, consequence)
    VALUES (new.id, new.gene_symbol, new.consequence);
  END;

  CREATE TRIGGER variants_ad AFTER DELETE ON variants BEGIN
    DELETE FROM variants_fts WHERE rowid = old.id;
  END;

  CREATE TRIGGER variants_au AFTER UPDATE ON variants BEGIN
    UPDATE variants_fts
    SET gene_symbol = new.gene_symbol, consequence = new.consequence
    WHERE rowid = new.id;
  END;
`;

// Search query with BM25 ranking
const searchVariants = (query: string) => {
  const stmt = db.prepare(`
    SELECT v.*
    FROM variants v
    JOIN variants_fts fts ON v.id = fts.rowid
    WHERE variants_fts MATCH ?
    ORDER BY bm25(variants_fts)
    LIMIT 50
  `);
  return stmt.all(query + '*'); // Prefix search
};
```

### Pattern 3: Cursor-Based Pagination
**What:** Keyset pagination using compound keys (id, sort_column) for efficient large dataset navigation
**When to use:** Paginating through variant results without offset performance degradation
**Example:**
```typescript
// Source: Keyset pagination best practices
interface PaginationCursor {
  id: number;
  sortValue: any;
}

interface PaginatedResult<T> {
  data: T[];
  nextCursor: PaginationCursor | null;
  hasMore: boolean;
}

function getVariants(
  caseId: number,
  limit: number,
  cursor?: PaginationCursor
): PaginatedResult<Variant> {
  let sql = `
    SELECT * FROM variants
    WHERE case_id = ?
  `;

  const params: any[] = [caseId];

  if (cursor) {
    // Keyset condition: (sort_col, id) > (cursor_sort, cursor_id)
    sql += ` AND (pos > ? OR (pos = ? AND id > ?))`;
    params.push(cursor.sortValue, cursor.sortValue, cursor.id);
  }

  sql += ` ORDER BY pos, id LIMIT ?`;
  params.push(limit + 1); // Fetch one extra to check hasMore

  const stmt = db.prepare(sql);
  const results = stmt.all(...params);

  const hasMore = results.length > limit;
  const data = hasMore ? results.slice(0, limit) : results;

  const nextCursor = hasMore
    ? { id: data[data.length - 1].id, sortValue: data[data.length - 1].pos }
    : null;

  return { data, nextCursor, hasMore };
}
```

### Pattern 4: Batch Insert with Transactions
**What:** Insert variants in batches within a transaction for optimal performance
**When to use:** Importing large VCF files with thousands of variants
**Example:**
```typescript
// Source: SQLite batch insert performance research
const BATCH_SIZE = 5000;

function insertVariantsBatch(caseId: number, variants: Variant[]): void {
  const insertStmt = db.prepare(`
    INSERT INTO variants (
      case_id, chr, pos, ref, alt, gene_symbol,
      consequence, gnomad_af, cadd, clinvar
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((batch: Variant[]) => {
    for (const v of batch) {
      insertStmt.run(
        caseId, v.chr, v.pos, v.ref, v.alt, v.gene_symbol,
        v.consequence, v.gnomad_af, v.cadd, v.clinvar
      );
    }
  });

  // Process in batches of 5000
  for (let i = 0; i < variants.length; i += BATCH_SIZE) {
    const batch = variants.slice(i, i + BATCH_SIZE);
    insertMany(batch);
  }
}
```

### Anti-Patterns to Avoid
- **Async/await with better-sqlite3:** The library is synchronous by design; wrapping in promises adds overhead without benefit
- **Multiple database instances:** better-sqlite3 should use a single instance per database file; multiple instances cause locking issues
- **Offset pagination:** `LIMIT X OFFSET Y` degrades linearly with offset size; use keyset/cursor pagination instead
- **Exposing raw SQL to callers:** Keep SQL inside DatabaseService; callers should use typed methods only

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Full-text search | Custom LIKE queries or in-memory filtering | SQLite FTS5 | FTS5 handles tokenization, stemming, prefix search, relevance ranking; custom solutions miss edge cases (diacritics, Unicode) |
| Prepared statements | String concatenation or template literals | better-sqlite3's prepare() | Prevents SQL injection, enables statement caching, validates SQL at compile time |
| Transaction management | Manual BEGIN/COMMIT/ROLLBACK | better-sqlite3's transaction() | Automatically handles rollback on exceptions, prevents nested transaction bugs |
| Connection pooling | Custom queue/pool implementation | Single instance (or better-sqlite-pool if needed) | SQLite is single-writer; pooling adds complexity without concurrency benefit in Electron |
| Cursor encoding | Custom base64/JSON schemes | Store cursor as opaque string, decode server-side | Prevents client manipulation, allows cursor format changes |
| Batch deletion | Loop with individual DELETs | ON DELETE CASCADE + batched deletes | Cascading deletes with indexes are faster than explicit loops; batch to avoid long locks |

**Key insight:** SQLite and better-sqlite3 have battle-tested solutions for search, transactions, and performance. Building custom abstractions adds bugs and maintenance burden. Trust the library's synchronous API design.

## Common Pitfalls

### Pitfall 1: Foreign Keys Not Enabled
**What goes wrong:** ON DELETE CASCADE doesn't work; orphaned variant rows remain after case deletion
**Why it happens:** SQLite disables foreign key enforcement by default for backward compatibility
**How to avoid:** Run `PRAGMA foreign_keys = ON` immediately after opening database connection
**Warning signs:** Variants table grows indefinitely; cases deleted but variant count doesn't decrease

### Pitfall 2: Missing Indexes on Foreign Keys
**What goes wrong:** Case deletion with thousands of variants takes 20+ seconds; database locks during deletion
**Why it happens:** Without indexes on child table foreign keys, CASCADE DELETE scans entire table
**How to avoid:** Create index on `variants.case_id` immediately after table creation
**Warning signs:** DELETE operations block UI; CPU spikes during case removal

### Pitfall 3: WAL Mode Not Enabled
**What goes wrong:** Import operations block all reads; UI freezes during large VCF imports
**Why it happens:** Default rollback journal mode is single-writer single-reader; writers block readers
**How to avoid:** Run `PRAGMA journal_mode = WAL` during database initialization
**Warning signs:** "database is locked" errors; UI unresponsive during imports

### Pitfall 4: Transactions Wrapping Async Functions
**What goes wrong:** Transaction commits after first await, before function completes; partial data corruption
**Why it happens:** better-sqlite3 transactions don't support async functions; transaction scope ends at first await
**How to avoid:** Keep transaction functions synchronous; perform async operations (file I/O) outside transaction, pass data in
**Warning signs:** Import fails but some variants inserted; inconsistent state after errors

### Pitfall 5: Case-Sensitive FTS Search
**What goes wrong:** Search for "brca1" doesn't match "BRCA1"; users report "missing" genes
**Why it happens:** Incorrect FTS5 tokenizer configuration or column comparison in WHERE clause
**How to avoid:** Use unicode61 tokenizer (default), verify case-insensitive matching with test data
**Warning signs:** Search works for exact case matches only; lowercase queries return no results

### Pitfall 6: Database in Wrong Path
**What goes wrong:** Database file created in development directory; lost after app updates or packaging
**Why it happens:** Using `__dirname` or relative paths instead of `app.getPath('userData')`
**How to avoid:** Always use `path.join(app.getPath('userData'), 'database.db')` for production
**Warning signs:** Data lost after app update; different data in dev vs production

### Pitfall 7: Large Offset Pagination
**What goes wrong:** Loading page 100 of variants takes 10x longer than page 1; UI lag on late pages
**Why it happens:** `LIMIT 50 OFFSET 5000` forces SQLite to scan and discard 5000 rows on every query
**How to avoid:** Use keyset/cursor pagination with `WHERE (pos, id) > (last_pos, last_id)`
**Warning signs:** Linear degradation in query time as user pages through results

### Pitfall 8: Batch Size Too Large
**What goes wrong:** Long-running transaction locks database for 30+ seconds; other operations time out
**Why it happens:** Inserting 50,000 variants in single transaction holds write lock entire time
**How to avoid:** Use 5000-row batches; balance transaction overhead vs lock duration
**Warning signs:** "database is locked" during imports; progress bar freezes for long periods

## Code Examples

Verified patterns from official sources:

### Schema Definition
```typescript
// Source: SQLite official docs + genomic variant storage best practices
export const createTables = `
  CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL,
    chr TEXT NOT NULL,
    pos INTEGER NOT NULL,
    ref TEXT NOT NULL,
    alt TEXT NOT NULL,
    gene_symbol TEXT,
    consequence TEXT,
    gnomad_af REAL,
    cadd REAL,
    clinvar TEXT,
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_variants_case_id ON variants(case_id);
  CREATE INDEX IF NOT EXISTS idx_variants_gene ON variants(gene_symbol);
  CREATE INDEX IF NOT EXISTS idx_variants_pos ON variants(chr, pos);
  CREATE INDEX IF NOT EXISTS idx_variants_filters ON variants(gnomad_af, cadd);
`;
```

### Error Class Hierarchy
```typescript
// Source: TypeScript custom error best practices
export class DatabaseError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'DatabaseError';
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }
}

export class NotFoundError extends DatabaseError {
  constructor(resource: string, id: number | string) {
    super(`${resource} with id ${id} not found`);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class UniqueConstraintError extends DatabaseError {
  constructor(field: string, value: string) {
    super(`${field} '${value}' already exists`);
    this.name = 'UniqueConstraintError';
    Object.setPrototypeOf(this, UniqueConstraintError.prototype);
  }
}

export class TransactionError extends DatabaseError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = 'TransactionError';
    Object.setPrototypeOf(this, TransactionError.prototype);
  }
}
```

### Complete DatabaseService Example
```typescript
// Source: better-sqlite3 official API docs + Electron best practices
import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import { DatabaseError, NotFoundError, UniqueConstraintError } from './errors';
import type { Case, Variant, VariantFilter } from './types';

export class DatabaseService {
  private db: Database.Database;
  private statements = new Map<string, Database.Statement>();

  constructor(dbPath?: string) {
    const finalPath = dbPath || path.join(app.getPath('userData'), 'varlens.db');

    try {
      this.db = new Database(finalPath);
      this.initialize();
    } catch (error) {
      throw new DatabaseError('Failed to open database', error as Error);
    }
  }

  private initialize(): void {
    // Enable WAL mode for concurrent reads
    this.db.pragma('journal_mode = WAL');

    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');

    // Create schema
    this.db.exec(createTables);
    this.db.exec(createFTSTable);
    this.db.exec(createFTSTriggers);
  }

  private stmt(sql: string): Database.Statement {
    if (!this.statements.has(sql)) {
      this.statements.set(sql, this.db.prepare(sql));
    }
    return this.statements.get(sql)!;
  }

  // Case operations
  public createCase(name: string, filePath: string, fileSize: number): number {
    try {
      const result = this.stmt(`
        INSERT INTO cases (name, file_path, file_size, created_at)
        VALUES (?, ?, ?, ?)
      `).run(name, filePath, fileSize, Date.now());

      return result.lastInsertRowid as number;
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new UniqueConstraintError('Case name', name);
      }
      throw new DatabaseError('Failed to create case', error);
    }
  }

  public getCase(id: number): Case {
    const result = this.stmt('SELECT * FROM cases WHERE id = ?').get(id);
    if (!result) {
      throw new NotFoundError('Case', id);
    }
    return result as Case;
  }

  public deleteCase(id: number): void {
    const result = this.stmt('DELETE FROM cases WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new NotFoundError('Case', id);
    }
  }

  public getAllCases(): Case[] {
    return this.stmt('SELECT * FROM cases ORDER BY created_at DESC').all() as Case[];
  }

  // Variant operations
  public insertVariantsBatch(caseId: number, variants: Variant[]): void {
    const insert = this.stmt(`
      INSERT INTO variants (
        case_id, chr, pos, ref, alt, gene_symbol,
        consequence, gnomad_af, cadd, clinvar
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertBatch = this.db.transaction((batch: Variant[]) => {
      for (const v of batch) {
        insert.run(
          caseId, v.chr, v.pos, v.ref, v.alt, v.gene_symbol,
          v.consequence, v.gnomad_af, v.cadd, v.clinvar
        );
      }
    });

    const BATCH_SIZE = 5000;
    for (let i = 0; i < variants.length; i += BATCH_SIZE) {
      const batch = variants.slice(i, i + BATCH_SIZE);
      insertBatch(batch);
    }
  }

  public searchVariants(query: string, limit = 50): Variant[] {
    return this.stmt(`
      SELECT v.*
      FROM variants v
      JOIN variants_fts fts ON v.id = fts.rowid
      WHERE variants_fts MATCH ?
      ORDER BY bm25(variants_fts)
      LIMIT ?
    `).all(query + '*', limit) as Variant[];
  }

  public close(): void {
    this.db.close();
  }
}
```

### FTS5 Prefix Configuration
```typescript
// Source: https://sqlite.org/fts5.html
// Configure FTS5 with unicode61 tokenizer and prefix indexes
const FTS_CONFIG = {
  // Remove diacritics: ä -> a, ô -> o, ñ -> n
  removeDiacritics: true,

  // Create prefix indexes for 2 and 3 character prefixes
  // Enables fast prefix search: "BR" matches "BRCA1", "BRCA2"
  prefixIndexes: [2, 3],

  // Use unicode61 for case-insensitive, Unicode-aware tokenization
  tokenizer: 'unicode61'
};

const createFTSTable = `
  CREATE VIRTUAL TABLE variants_fts USING fts5(
    gene_symbol,
    consequence,
    content='variants',
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 1',
    prefix='2 3'
  );
`;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| node-sqlite3 (async) | better-sqlite3 (sync) | 2016-present | 11.7x-24.4x faster; simpler error handling; no promise chains |
| FTS3/FTS4 | FTS5 | SQLite 3.9.0 (2015) | Better prefix search, BM25 ranking, improved performance |
| Offset pagination | Cursor/keyset pagination | Ongoing best practice | O(1) vs O(n) performance; scales to millions of rows |
| Manual BEGIN/COMMIT | transaction() wrapper | better-sqlite3 core feature | Automatic rollback on errors; prevents transaction leaks |
| Repository pattern | Service pattern (for single DB) | Ongoing discussion | Simpler for single data source; less abstraction overhead |

**Deprecated/outdated:**
- **FTS3/FTS4:** Replaced by FTS5 in SQLite 3.9.0; FTS5 has superior tokenization and ranking
- **node-sqlite3:** Still maintained but dramatically slower than better-sqlite3; async API doesn't benefit SQLite
- **Manual PRAGMA per query:** better-sqlite3 persists PRAGMA settings; run once during initialization
- **@types/better-sqlite3 v6.x:** Version 7.6+ required for better-sqlite3 v12.x; older types missing new features

## Open Questions

Things that couldn't be fully resolved:

1. **Optimal batch size for variant insertion**
   - What we know: 5000 rows recommended by research; balance between transaction overhead and lock duration
   - What's unclear: Exact optimal size depends on variant data size (number of columns, string lengths)
   - Recommendation: Start with 5000; benchmark with real VCF data; adjust if imports take >30 seconds per batch

2. **FTS5 trigram tokenizer for partial gene matching**
   - What we know: Trigram tokenizer enables substring matching (e.g., "RCA" matches "BRCA1")
   - What's unclear: Performance impact vs unicode61 with prefix indexes for typical gene name searches
   - Recommendation: Use unicode61 + prefix='2 3' initially; evaluate trigram if users need infix matching

3. **Generic repository vs domain repositories**
   - What we know: Single DatabaseService class is simpler for this project (one database, two tables)
   - What's unclear: If the schema expands to 10+ tables, would splitting into repositories help?
   - Recommendation: Keep single service class for now; refactor to repositories if complexity grows beyond 5 tables

4. **Database backup/export strategy**
   - What we know: better-sqlite3 has `.backup()` method that returns a promise
   - What's unclear: Best UX for exporting cases (full database vs per-case export)
   - Recommendation: Implement per-case export (easier for collaborators); use `.backup()` for full database backup

## Sources

### Primary (HIGH confidence)
- better-sqlite3 GitHub README - https://github.com/WiseLibs/better-sqlite3 - Library features, performance benchmarks, API overview
- better-sqlite3 API Documentation - https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md - Complete API reference for Database, Statement, Transaction
- SQLite FTS5 Extension - https://sqlite.org/fts5.html - Official FTS5 documentation, tokenizer configuration, BM25 ranking
- SQLite Write-Ahead Logging - https://sqlite.org/wal.html - WAL mode concurrency characteristics, performance benefits
- SQLite Datatypes - https://www.sqlite.org/datatype3.html - Type affinity system, storage classes

### Secondary (MEDIUM confidence)
- [A Step-by-Step Guide to Integrating Better-SQLite3 with Electron JS](https://dev.to/arindam1997007/a-step-by-step-guide-to-integrating-better-sqlite3-with-electron-js-app-using-create-react-app-3k16) - Electron integration patterns, userData path usage
- [SQLite FTS5 tokenizer configuration (Sling Academy)](https://www.slingacademy.com/article/an-in-depth-look-at-tokenizer-settings-for-sqlite-full-text-search/) - Tokenizer options deep dive
- [TypeScript custom errors guide (Medium)](https://medium.com/@Nelsonalfonso/understanding-custom-errors-in-typescript-a-complete-guide-f47a1df9354c) - Error class hierarchy with Object.setPrototypeOf pattern
- [Repository vs Service Pattern (Startup House)](https://startup-house.com/glossary/repository-vs-service-pattern) - Pattern comparison for data access layers
- [SQLite keyset pagination (DEV Community)](https://dev.to/appwrite/this-is-why-you-should-use-cursor-pagination-4nh5) - Cursor-based pagination advantages
- [SQLite batch insert performance (PDQ)](https://www.pdq.com/blog/improving-bulk-insert-speed-in-sqlite-a-comparison-of-transactions/) - Transaction batching benchmarks
- [How to store user data in Electron (Cameron Nokes)](https://cameronnokes.com/blog/how-to-store-user-data-in-electron/) - app.getPath('userData') best practices
- [SQLite index best practices (Android Developers)](https://developer.android.com/topic/performance/sqlite-performance-best-practices) - Foreign key indexing, multicolumn indexes

### Tertiary (LOW confidence - marked for validation)
- [GenomicSQLite](https://mlin.github.io/GenomicSQLite/) - Genomic-specific SQLite extension (not needed for this project but shows domain patterns)
- [VCFdbR](https://www.biorxiv.org/content/10.1101/2020.04.28.066894v1.full) - VCF to SQLite pipeline (research paper, schema design insights)
- better-sqlite-pool library - Connection pooling (unlikely needed for Electron single-process model)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - better-sqlite3 is the established Node.js SQLite library; @types/better-sqlite3 maintained in DefinitelyTyped
- Architecture: HIGH - Service pattern well-documented for single data source; FTS5 integration official SQLite feature
- Pitfalls: MEDIUM-HIGH - Foreign key enforcement, WAL mode, pagination issues well-documented; async transaction trap confirmed in better-sqlite3 docs
- FTS5 tokenizer: MEDIUM - unicode61 default is documented; specific prefix='2 3' configuration requires testing with gene names
- Batch size: MEDIUM - 5000 rows recommendation from general SQLite literature; project-specific tuning may be needed

**Research date:** 2026-01-26
**Valid until:** 2026-07-26 (6 months - SQLite and better-sqlite3 are stable, slow-moving technologies)
