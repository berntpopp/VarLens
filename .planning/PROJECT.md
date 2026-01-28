# Varlens

## What This Is

Varlens is an Electron-based desktop application for offline analysis of genetic variant data. It enables external collaborators to analyze pre-filtered and annotated genetic variant data without exposing login credentials, using a local SQLCipher-encrypted SQLite database with FTS5 search for efficient querying and storage. It supports single-case and cross-case cohort analysis with external genomic database links.

## Core Value

External collaborators can analyze variant data offline with a data-dense UX experience designed for research use, without needing credentials or internet access.

## Requirements

### Validated

- ✓ Import gzipped JSON variant files into SQLite database — v0.1
- ✓ Display variants in a paginated, sortable data table — v0.1
- ✓ Filter variants by gene symbol (FTS5 search with autocomplete) — v0.1
- ✓ Filter variants by consequence type (dropdown) — v0.1
- ✓ Filter variants by gnomAD allele frequency threshold — v0.1
- ✓ Filter variants by minimum CADD score — v0.1
- ✓ Full-text search on gene symbols and variant annotations — v0.1
- ✓ Manage cases (list imported cases, select, delete) — v0.1
- ✓ Show import progress with real-time feedback — v0.1
- ✓ Top app bar with app name and DNA icon — v0.2.0
- ✓ Footer with version info, GitHub link, license link, disclaimer status, FAQ button, log viewer toggle — v0.2.0
- ✓ Blocking research-use disclaimer dialog (per-version acknowledgment) — v0.2.0
- ✓ FAQ dialog with searchable, categorized expansion panels (JSON-configurable) — v0.2.0
- ✓ Full-featured client-facing logging system (LogViewer drawer, level filtering, search, download, memory stats) — v0.2.0
- ✓ Branding with RequiForm warm palette — v0.2.0
- ✓ JSON config files for FAQ content, disclaimer text, and log config — v0.2.0
- ✓ Research-only language throughout UI — v0.2.0
- ✓ SQLCipher database encryption (password-gated database open/create) — v0.3.0
- ✓ Database selection and switching (choose/create/switch .sqlite files) — v0.3.0
- ✓ Batch import from multiple JSON.gz files (multi-file picker + folder import) — v0.3.0
- ✓ Password-protected ZIP file import (decrypt and extract during import) — v0.3.0
- ✓ External links to ClinVar, gnomAD, OMIM from variant rows — v0.3.0
- ✓ Configurable external link URL templates with settings UI — v0.3.0
- ✓ OMIM MIM number extraction and inline display with clickable links — v0.3.0
- ✓ Cohort analysis view with aggregated variant table across all cases — v0.3.0
- ✓ Cohort variant search (query variant/gene, see carrier summary across cohort) — v0.3.0
- ✓ Cohort summary stats (carrier count, allele frequency, het/hom breakdown, per-case links, gene-level aggregation) — v0.3.0

### Active

(No active milestone -- planning next milestone)

### Out of Scope

- Virtual gene panels — deferred to v0.4+
- Advanced inheritance filters (de novo, compound het) — deferred to v0.4+
- Statistics dashboard — deferred to v0.4+
- PDF report generation — deferred to v0.4+
- Dark mode toggle — nice-to-have, not blocking
- Real-time collaboration — Offline-first desktop app
- Cloud sync — Not in v0.x scope
- VCF import — JSON-only for current scope
- CNV/SV analysis — SNV-focused for current scope
- OMIM disease name extraction — deferred from v0.3.0 (MIM numbers delivered)
- Affected/unaffected cohort split — requires case metadata schema; deferred to v0.4+
- Cross-case variant comparison matrix — complex UI; deferred to v0.4+
- Cohort statistics charts — tabular data sufficient for v0.3.0
- Drag-and-drop import — multi-file picker is sufficient

## Context

**Current state:** Shipped v0.3.0 with SQLCipher encryption, database selection/switching, batch import with ZIP support, external genomic database links, OMIM MIM numbers, and cohort analysis with aggregated variant table, search, gene burden, and drill-down navigation.

**Tech stack:** Electron 40 + Vue 3 + Vuetify 3 + better-sqlite3-multiple-ciphers (SQLCipher) + FTS5 + TypeScript + electron-vite

**Codebase:** 11,402 lines of TypeScript/Vue across 104+ files. 9 IPC handler modules, 42+ channels.

**Test data:** `test-data/case-892-snv-annotations.json.gz` (65k variants), `test-data/case-892-snv-sample.json.gz` (251 variants)

**Performance validated:**
- Import: 65k variants in ~20-32 seconds (target: <30s)
- Pagination: <100ms query response
- Cohort aggregation: Composite index on (chr, pos, ref, alt) for GROUP BY performance

**Known issues / tech debt:**
- OMIM disease name extraction deferred (MIM numbers only)
- Cohort performance not profiled with 50+ cases
- No E2E tests for cohort search and drill-down
- Franklin URL format has LOW confidence
- Debug console.log in DatabaseService (info-level)

## Constraints

- **Tech stack**: Electron 40 + Vue 3 + Vuetify 3 + TypeScript + better-sqlite3-multiple-ciphers — established
- **Offline-first**: No network dependencies in core functionality
- **Performance**: Import 65k variants in <30 seconds, table pagination <100ms
- **Platform**: Primary development on Ubuntu, cross-platform target (Windows, macOS, Linux)
- **Security**: HTTPS-only + domain allowlist for shell.openExternal; SQLCipher for data at rest

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| better-sqlite3 over sql.js | Synchronous API, 2-3x faster, better TypeScript support | ✓ Good — 20-32s import for 65k variants |
| electron-vite for build | Modern, fast, recommended for Vue + Electron | ✓ Good — Fast HMR, simple config |
| Vuetify v-data-table-server | Built-in server-side pagination, professional component | ✓ Good — Works excellently |
| FTS5 for text search | Fast gene/variant name searching | ✓ Good — Autocomplete with BM25 |
| Streaming JSON parser | Memory efficient for large files | ✓ Good — Handles 65k variants |
| Cursor-based pagination | Efficient for large result sets, stable ordering | ✓ Good — Fast navigation |
| snake_case for DB properties | Matches SQLite column naming conventions | ✓ Good — Clean mapping |
| ESLint 9 flat config | Future-proof configuration approach | ✓ Good — Works with Vue + TS |
| happy-dom for tests | Faster than jsdom for component testing | ✓ Good — Quick test runs |
| better-sqlite3-multiple-ciphers | SQLCipher encryption with same API surface | ✓ Good — Zero-change library swap |
| DatabaseManager lifecycle pattern | Open/close/switch with rollback safety | ✓ Good — Reliable switching |
| URL template system for external links | User-configurable links with variable substitution | ✓ Good — Extensible |
| adm-zip (pure JS) for ZIP extraction | No native rebuild, cross-platform | ✓ Good — Works everywhere |
| FTS5 rebuild for schema upgrades | DROP and recreate ensures all columns indexed | ✓ Good — Backward compatible |
| LIMIT/OFFSET for cohort pagination | GROUP BY makes cursor pagination complex | ✓ Good — Simple, sufficient |
| Tab navigation for cohort analysis | Different workflow from single-case | ✓ Good — Clear UX |
| Lazy carrier loading in cohort | Load on expand, cache in Map | ✓ Good — Fast UI |

---
*Last updated: 2026-01-28 after v0.3.0 milestone*
