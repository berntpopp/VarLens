# Roadmap: Varlens v0.1 POC

## Overview

Varlens v0.1 POC validates the core Electron + Vue 3 + SQLite stack by delivering a working application that imports gzipped JSON variant data, displays variants in a paginated table, and provides basic filtering. The 8 phases build from foundation through full user experience, with each phase delivering verifiable functionality.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Scaffold project with electron-vite and configure tooling
- [x] **Phase 2: Database Layer** - SQLite schema, FTS5, and DatabaseService
- [x] **Phase 3: Import Service** - Streaming JSON parser and batch insert
- [x] **Phase 4: IPC Layer** - Preload bridge and main process handlers
- [ ] **Phase 5: UI Shell + Cases** - App layout and case management UI
- [ ] **Phase 6: Variant Table** - Paginated data table with sorting
- [ ] **Phase 7: Filters** - Filter controls and FTS5 search integration
- [ ] **Phase 8: Import UI + Polish** - Import dialog and end-to-end verification

## Phase Details

### Phase 1: Foundation
**Goal**: Working Electron app scaffold with all tooling configured
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, FOUND-06
**Success Criteria** (what must be TRUE):
  1. `make dev` launches Electron window with Vue 3 + Vuetify rendering
  2. `make lint` passes with zero errors
  3. `make test` runs Vitest with happy-dom environment
  4. `make typecheck` passes with zero TypeScript errors
  5. better-sqlite3 imports without native module errors
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — Scaffold project, configure Vuetify 3, integrate better-sqlite3
- [x] 01-02-PLAN.md — Configure ESLint, Vitest, and Makefile

### Phase 2: Database Layer
**Goal**: SQLite database with schema, FTS5, and complete DatabaseService API
**Depends on**: Phase 1
**Requirements**: DB-01, DB-02, DB-03, DB-04, DB-05, DB-06, DB-07, DB-08
**Success Criteria** (what must be TRUE):
  1. Database file created in userData path with cases and variants tables
  2. Case CRUD operations work (create, read, delete with cascade)
  3. Variants can be inserted in batches within transactions
  4. Paginated queries return correct page/total counts
  5. FTS5 search on gene_symbol returns matching variants
**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md — Create types, error classes, and schema definitions with FTS5
- [x] 02-02-PLAN.md — Create DatabaseService with initialization and case CRUD
- [x] 02-03-PLAN.md — Add variant batch insert, pagination, filters, and FTS5 search

### Phase 3: Import Service
**Goal**: Import gzipped JSON files into database with progress reporting
**Depends on**: Phase 2
**Requirements**: IMP-01, IMP-02, IMP-03, IMP-04, IMP-05
**Success Criteria** (what must be TRUE):
  1. Gzipped JSON files are read and decompressed as streams
  2. Large JSON arrays are parsed without loading entire file into memory
  3. Progress callback fires with phase and count during import
  4. 65k variants import in under 30 seconds
  5. Case record created with correct variant_count
**Plans**: 2 plans

Plans:
- [x] 03-01-PLAN.md — Create import types, field mapping config, and FieldMapper Transform
- [x] 03-02-PLAN.md — Create ImportService with streaming pipeline and integration tests

### Phase 4: IPC Layer
**Goal**: Type-safe IPC bridge connecting renderer to main process services
**Depends on**: Phase 3
**Requirements**: IPC-01, IPC-02, IPC-03, IPC-04, IPC-05, IPC-06, IPC-07
**Success Criteria** (what must be TRUE):
  1. Preload script exposes typed API via contextBridge
  2. window.api calls reach main process handlers
  3. File selection dialog opens and returns path
  4. Import progress events stream to renderer
  5. Variant queries execute and return paginated results
**Plans**: 3 plans

Plans:
- [x] 04-01-PLAN.md — Create shared IPC types and error handling infrastructure
- [x] 04-02-PLAN.md — Implement preload bridge and integrate IPC registration
- [x] 04-03-PLAN.md — Implement domain IPC handlers (cases, variants, import, system)

### Phase 5: UI Shell + Cases
**Goal**: App layout with case sidebar that lists, selects, and deletes cases
**Depends on**: Phase 4
**Requirements**: CASE-01, CASE-02, CASE-03
**Success Criteria** (what must be TRUE):
  1. Case list displays all imported cases with name and variant count
  2. Clicking a case selects it and updates the main content area
  3. Delete button with confirmation removes case and its variants
  4. Empty state shown when no cases exist
**Plans**: 2 plans

Plans:
- [ ] 05-01-PLAN.md — App shell layout with collapsible sidebar and empty state
- [ ] 05-02-PLAN.md — Case list with selection, context menu delete, and notifications

### Phase 6: Variant Table
**Goal**: Paginated variant table using Vuetify v-data-table-server
**Depends on**: Phase 5
**Requirements**: TBL-01, TBL-02, TBL-03, TBL-04, TBL-05
**Success Criteria** (what must be TRUE):
  1. Table displays variants for selected case with server-side pagination
  2. Page navigation and items-per-page selector work correctly
  3. Column sorting (single and multi-column) updates query
  4. All required columns visible: chr, pos, ref, alt, gene, consequence, gnomAD AF, CADD, ClinVar
  5. Formatted display: positions with commas, AF in scientific notation, colored ClinVar chips
**Plans**: TBD

Plans:
- [ ] 06-01: TBD

### Phase 7: Filters
**Goal**: Filter toolbar with gene, consequence, AF, CADD, and FTS5 search
**Depends on**: Phase 6
**Requirements**: FLT-01, FLT-02, FLT-03, FLT-04, FLT-05, FLT-06
**Success Criteria** (what must be TRUE):
  1. Gene symbol text filter narrows results with debounced input
  2. Consequence dropdown populated from database distinct values
  3. gnomAD AF slider/input filters variants below threshold
  4. CADD minimum score filter excludes low-scoring variants
  5. Clear filters button appears when filters are active and resets all
**Plans**: TBD

Plans:
- [ ] 07-01: TBD

### Phase 8: Import UI + Polish
**Goal**: Complete import dialog and end-to-end POC verification
**Depends on**: Phase 7
**Requirements**: UIMP-01, UIMP-02, UIMP-03, UIMP-04, UIMP-05
**Success Criteria** (what must be TRUE):
  1. Import dialog opens with case name input and file selector
  2. File selector filters for .json and .json.gz files
  3. Progress indicator shows real-time import status
  4. Error messages display on import failure
  5. Newly imported case auto-selected and displayed in table
**Plans**: TBD

Plans:
- [ ] 08-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 2/2 | Complete | 2026-01-26 |
| 2. Database Layer | 3/3 | Complete | 2026-01-26 |
| 3. Import Service | 2/2 | Complete | 2026-01-26 |
| 4. IPC Layer | 3/3 | Complete | 2026-01-26 |
| 5. UI Shell + Cases | 0/2 | Not started | - |
| 6. Variant Table | 0/TBD | Not started | - |
| 7. Filters | 0/TBD | Not started | - |
| 8. Import UI + Polish | 0/TBD | Not started | - |

---
*Roadmap created: 2026-01-26*
*Total requirements: 40 | Phases: 8*
