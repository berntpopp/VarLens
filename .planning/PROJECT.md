# Varlens

## What This Is

Varlens is an Electron-based desktop application for offline analysis of genetic variant data. It enables external collaborators to analyze pre-filtered and annotated genetic variant data without exposing login credentials, using a local SQLite database with FTS5 search for efficient querying and storage.

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

### Active

#### v0.2.0 — UI Polish, Branding & Trust Signals

- [ ] Top app bar with app name and DNA icon
- [ ] Footer with version info, GitHub link, license link, disclaimer status, FAQ button, log viewer toggle (small icons)
- [ ] Blocking research-use disclaimer dialog (acknowledged once per version, stored in localStorage)
- [ ] FAQ dialog with searchable, categorized expansion panels (JSON-configurable)
- [ ] Full-featured client-facing logging system (LogViewer drawer, level filtering, search, download, memory stats)
- [ ] Branding with RequiForm warm palette (#a09588 primary, #E5AA94 footer, #424242 secondary)
- [ ] JSON config files for FAQ content, disclaimer text, and log config (build-time)
- [ ] Remove all "clinical" language — research use only throughout
- [ ] Modern, consistent design matching reference tools (phentrieve, RequiForm, kidney-genetics-db)

### Out of Scope

- Virtual gene panels — deferred to v0.2+
- Advanced inheritance filters (de novo, compound het) — deferred to v0.2+
- Statistics dashboard — deferred to v0.2+
- PDF report generation — deferred to v0.2+
- External links integration — deferred to v0.2+
- Dark mode toggle — nice-to-have, not blocking POC
- Keyboard shortcuts — nice-to-have, not blocking POC
- Real-time collaboration — Offline-first desktop app
- Cloud sync — Not in v0.x scope
- VCF import — JSON-only for POC
- CNV/SV analysis — SNV-focused for POC
- User authentication — Desktop app, single-user

## Context

**Current state:** Shipped v0.1 POC with 4,433 lines TypeScript/Vue across 121 files.

**Tech stack:** Electron + Vue 3 + Vuetify 3 + better-sqlite3 + FTS5

**Test data:** `test-data/case-892-snv-annotations.json.gz` (65k variants), `test-data/case-892-snv-sample.json.gz` (251 variants)

**Performance validated:**
- Import: 65k variants in ~20-32 seconds (target: <30s)
- Pagination: <100ms query response

**Reference project:** [sqlite-search](https://github.com/berntpopp/sqlite-search) provided architecture template

**v0.2.0 reference projects:**
- [RequiForm](../RequiForm) — branding config JSON, warm palette (#a09588/#E5AA94), FAQ dialog, disclaimer, footer pattern
- [phentrieve](../phentrieve) — disclaimer dialog with Pinia store, LogViewer drawer, FAQ view, footer with icon buttons
- [kidney-genetics-db](../kidney-genetics-db) — footer with version popup, full logging system with sanitizer, log store

## Constraints

- **Tech stack**: Electron + Vue 3 + Vuetify 3 + TypeScript + better-sqlite3 — established
- **Offline-first**: No network dependencies in core functionality
- **Performance**: Import 65k variants in <30 seconds, table pagination <100ms
- **Platform**: Primary development on Ubuntu, cross-platform target (Windows, macOS, Linux)

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

## Current Milestone: v0.2.0 UI Polish & Trust Signals

**Goal:** Add professional branding, research-use disclaimer, FAQ, client-facing logging, and app chrome (top bar + footer) to establish trust and usability for external collaborators.

**Target features:**
- App bar with branding + footer with version/links
- Research-use disclaimer (blocking, per-version acknowledgment)
- FAQ dialog (JSON-configurable, searchable)
- Client-facing logging system (full-featured LogViewer)
- RequiForm warm palette branding
- Remove all "clinical" references

---
*Last updated: 2026-01-27 after v0.2.0 milestone initialization*
