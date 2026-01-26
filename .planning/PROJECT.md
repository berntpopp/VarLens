# Varlens

## What This Is

Varlens is an Electron-based desktop application for offline analysis of genetic variant data. It enables external collaborators to analyze pre-filtered and annotated genetic variant data without exposing login credentials, using a local SQLite database for efficient querying and storage.

## Core Value

External collaborators can analyze variant data offline with the same data-dense UX experience as clinical platforms, without needing credentials or internet access.

## Current Milestone: v0.1 POC

**Goal:** Validate the core stack by building a working proof-of-concept with import, table view, and basic filtering.

**Target features:**
- JSON/gzipped import into SQLite
- Paginated variant table with server-side data
- Basic filters (gene, consequence, gnomAD AF, CADD)
- Case management (list, select, delete)

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Import gzipped JSON variant files into SQLite database
- [ ] Display variants in a paginated, sortable data table
- [ ] Filter variants by gene symbol (text search)
- [ ] Filter variants by consequence type (dropdown)
- [ ] Filter variants by gnomAD allele frequency threshold
- [ ] Filter variants by minimum CADD score
- [ ] Full-text search on gene symbols and variant annotations
- [ ] Manage cases (list imported cases, select, delete)
- [ ] Show import progress with real-time feedback

### Out of Scope

- Virtual gene panels — deferred to v0.2+
- Advanced inheritance filters (de novo, compound het) — deferred to v0.2+
- Statistics dashboard — deferred to v0.2+
- PDF report generation — deferred to v0.2+
- External links integration — deferred to v0.2+
- Dark mode toggle — nice-to-have, not blocking POC
- Keyboard shortcuts — nice-to-have, not blocking POC

## Context

- **Existing reference**: `plan/PLAN.md` has full project vision, `plan/POC.md` has detailed implementation specs
- **Test data available**: `test-data/case-892-snv-annotations.json.gz` (65k variants), `test-data/case-892-snv-sample.json.gz` (251 variants)
- **Stack decision**: Vue 3 + Vuetify 3 + Electron + better-sqlite3 (documented in PLAN.md)
- **Reference project**: [sqlite-search](https://github.com/berntpopp/sqlite-search) provides architecture template

## Constraints

- **Tech stack**: Electron + Vue 3 + Vuetify 3 + TypeScript + better-sqlite3 — already decided
- **Offline-first**: No network dependencies in core functionality
- **Performance**: Import 65k variants in <30 seconds, table pagination <100ms
- **Platform**: Primary development on Ubuntu, cross-platform target (Windows, macOS, Linux)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| better-sqlite3 over sql.js | Synchronous API, 2-3x faster, better TypeScript support | — Pending |
| electron-vite for build | Modern, fast, recommended for Vue + Electron | — Pending |
| Vuetify v-data-table-server | Built-in server-side pagination, professional component | — Pending |
| FTS5 for text search | Fast gene/variant name searching | — Pending |
| Streaming JSON parser | Memory efficient for large files | — Pending |

---
*Last updated: 2026-01-26 after milestone v0.1 initialization*
