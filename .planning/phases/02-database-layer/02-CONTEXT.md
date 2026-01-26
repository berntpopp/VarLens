# Phase 2: Database Layer - Context

**Gathered:** 2026-01-26
**Status:** Ready for planning

<domain>
## Phase Boundary

SQLite database with schema, FTS5 full-text search, and complete DatabaseService API for case/variant management. This phase delivers the data layer that all subsequent phases depend on — case CRUD, variant storage, paginated queries, and search.

</domain>

<decisions>
## Implementation Decisions

### Schema design
- Case names must be unique (UNIQUE constraint enforced)
- Track import metadata: original file path, import timestamp, file size
- Variants table stores only display-relevant columns: chr, pos, ref, alt, gene_symbol, consequence, gnomAD_AF, CADD, ClinVar
- No uniqueness constraint on variants — allow duplicates if present in source file

### DatabaseService API
- Throw typed errors (DatabaseError, NotFoundError, etc.) rather than returning Result objects
- Typed methods only — no raw SQL exposure to callers
- Cursor-based pagination (keyset) for variant queries

### FTS5 configuration
- Index gene_symbol and consequence columns
- Enable prefix search (typing 'BRC' matches 'BRCA1', 'BRCA2')
- Case-insensitive matching
- Relevance ranking using bm25 scoring

### Transaction behavior
- Batch size: 5000 rows per batch for inserts
- All-or-nothing imports: rollback everything on failure
- Enable WAL mode for concurrent read/write
- Batched deletion for case removal (avoid long locks on large cases)

### Claude's Discretion
- DatabaseService structure (single class vs repositories) — research best practices for better-sqlite3 service patterns
- Exact column types and indexes beyond explicit constraints
- FTS5 tokenizer configuration details
- Specific error class hierarchy

</decisions>

<specifics>
## Specific Ideas

- Cursor-based pagination chosen for better performance on large datasets
- WAL mode preferred for Electron apps where UI reads may happen during imports

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-database-layer*
*Context gathered: 2026-01-26*
