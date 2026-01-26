# Requirements: Varlens

**Defined:** 2026-01-26
**Core Value:** External collaborators can analyze variant data offline with data-dense UX

## v0.1 POC Requirements

Requirements for proof-of-concept release. Each maps to roadmap phases.

### Foundation ✓

- [x] **FOUND-01**: Project scaffolded with electron-vite (Vue 3 + TypeScript template)
- [x] **FOUND-02**: Vuetify 3 installed and configured
- [x] **FOUND-03**: better-sqlite3 installed and rebuilt for Electron
- [x] **FOUND-04**: ESLint flat config with TypeScript and Vue rules
- [x] **FOUND-05**: Vitest configured with happy-dom environment
- [x] **FOUND-06**: Makefile with dev/build/lint/test/typecheck commands

### Database ✓

- [x] **DB-01**: SQLite schema created (cases, variants tables with indexes)
- [x] **DB-02**: FTS5 virtual table for gene/variant text search
- [x] **DB-03**: DatabaseService with case CRUD operations
- [x] **DB-04**: DatabaseService with variant batch insert
- [x] **DB-05**: DatabaseService with paginated variant query
- [x] **DB-06**: DatabaseService with filter support (gene, consequence, gnomAD AF, CADD)
- [x] **DB-07**: Prepared statement caching for performance
- [x] **DB-08**: Transaction wrapper for batch operations

### Import ✓

- [x] **IMP-01**: Gzipped JSON file reading with streaming
- [x] **IMP-02**: Memory-efficient JSON array parsing
- [x] **IMP-03**: Batch insert with configurable batch size
- [x] **IMP-04**: Progress callback reporting (phase, count)
- [x] **IMP-05**: Case creation on import with variant count update

### IPC ✓

- [x] **IPC-01**: Preload script with contextBridge API
- [x] **IPC-02**: Type declarations for renderer API
- [x] **IPC-03**: File selection dialog handler
- [x] **IPC-04**: Import variants IPC handler with progress events
- [x] **IPC-05**: Cases list/delete IPC handlers
- [x] **IPC-06**: Variants query IPC handler
- [x] **IPC-07**: Filter options IPC handler

### UI - Cases ✓

- [x] **CASE-01**: Case list component showing imported cases
- [x] **CASE-02**: Case selection updates variant table
- [x] **CASE-03**: Case deletion with confirmation

### UI - Table

- [ ] **TBL-01**: Variant table using v-data-table-server
- [ ] **TBL-02**: Server-side pagination with page/itemsPerPage controls
- [ ] **TBL-03**: Column sorting (multiple columns)
- [ ] **TBL-04**: Display columns: chr, pos, ref, alt, gene, consequence, gnomAD AF, CADD, ClinVar
- [ ] **TBL-05**: Formatted display (position with commas, AF in scientific notation, colored ClinVar chips)

### UI - Filters

- [ ] **FLT-01**: Gene symbol text filter with debounced input
- [ ] **FLT-02**: Consequence dropdown filter populated from database
- [ ] **FLT-03**: gnomAD AF maximum threshold filter
- [ ] **FLT-04**: CADD minimum score filter
- [ ] **FLT-05**: Clear filters button (visible when filters active)
- [ ] **FLT-06**: FTS5 search integration for text queries

### UI - Import

- [ ] **UIMP-01**: Import dialog with case name input
- [ ] **UIMP-02**: File selection for .json/.json.gz files
- [ ] **UIMP-03**: Import progress indicator
- [ ] **UIMP-04**: Error display on import failure
- [ ] **UIMP-05**: Auto-select case after successful import

## v0.2+ Requirements

Deferred to future releases. Tracked but not in current roadmap.

### Enhanced Features

- **ENH-01**: Virtual gene panels (create, edit, apply)
- **ENH-02**: Inheritance filters (de novo, recessive, dominant)
- **ENH-03**: Compound het detection
- **ENH-04**: Quality filters (read depth, allele fraction)
- **ENH-05**: Dark/light theme toggle
- **ENH-06**: Keyboard shortcuts

### Statistics

- **STAT-01**: Statistics dashboard
- **STAT-02**: Variant counts by gene
- **STAT-03**: Variant counts by consequence
- **STAT-04**: Frequency distribution charts

### Export

- **EXP-01**: CSV/TSV export
- **EXP-02**: Filtered variant export
- **EXP-03**: PDF report generation

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Real-time collaboration | Offline-first desktop app |
| Cloud sync | Not in v0.x scope |
| VCF import | JSON-only for POC |
| CNV/SV analysis | SNV-focused for POC |
| User authentication | Desktop app, single-user |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Complete |
| FOUND-02 | Phase 1 | Complete |
| FOUND-03 | Phase 1 | Complete |
| FOUND-04 | Phase 1 | Complete |
| FOUND-05 | Phase 1 | Complete |
| FOUND-06 | Phase 1 | Complete |
| DB-01 | Phase 2 | Complete |
| DB-02 | Phase 2 | Complete |
| DB-03 | Phase 2 | Complete |
| DB-04 | Phase 2 | Complete |
| DB-05 | Phase 2 | Complete |
| DB-06 | Phase 2 | Complete |
| DB-07 | Phase 2 | Complete |
| DB-08 | Phase 2 | Complete |
| IMP-01 | Phase 3 | Complete |
| IMP-02 | Phase 3 | Complete |
| IMP-03 | Phase 3 | Complete |
| IMP-04 | Phase 3 | Complete |
| IMP-05 | Phase 3 | Complete |
| IPC-01 | Phase 4 | Complete |
| IPC-02 | Phase 4 | Complete |
| IPC-03 | Phase 4 | Complete |
| IPC-04 | Phase 4 | Complete |
| IPC-05 | Phase 4 | Complete |
| IPC-06 | Phase 4 | Complete |
| IPC-07 | Phase 4 | Complete |
| CASE-01 | Phase 5 | Complete |
| CASE-02 | Phase 5 | Complete |
| CASE-03 | Phase 5 | Complete |
| TBL-01 | Phase 6 | Pending |
| TBL-02 | Phase 6 | Pending |
| TBL-03 | Phase 6 | Pending |
| TBL-04 | Phase 6 | Pending |
| TBL-05 | Phase 6 | Pending |
| FLT-01 | Phase 7 | Pending |
| FLT-02 | Phase 7 | Pending |
| FLT-03 | Phase 7 | Pending |
| FLT-04 | Phase 7 | Pending |
| FLT-05 | Phase 7 | Pending |
| FLT-06 | Phase 7 | Pending |
| UIMP-01 | Phase 8 | Pending |
| UIMP-02 | Phase 8 | Pending |
| UIMP-03 | Phase 8 | Pending |
| UIMP-04 | Phase 8 | Pending |
| UIMP-05 | Phase 8 | Pending |

**Coverage:**
- v0.1 requirements: 40 total
- Mapped to phases: 40
- Unmapped: 0

---
*Requirements defined: 2026-01-26*
*Last updated: 2026-01-26 — Phase 5 complete (29 requirements)*
