# Requirements: Varlens

**Defined:** 2026-01-27
**Core Value:** External collaborators can analyze variant data offline with a data-dense UX for research use

## v0.3.0 Requirements

Requirements for cohort analysis, security, and import enhancements milestone.

### Database Security

- [x] **DBSC-01**: App uses `better-sqlite3-multiple-ciphers` as drop-in replacement for `better-sqlite3` with SQLCipher encryption support
- [x] **DBSC-02**: Database accepts encryption key via PRAGMA key as the first operation after opening, before any schema initialization
- [x] **DBSC-03**: FTS5 virtual table creation occurs after PRAGMA key is set on encrypted databases
- [x] **DBSC-04**: User is prompted for a password when opening an encrypted database
- [x] **DBSC-05**: User can create a new encrypted database with a password
- [x] **DBSC-06**: User can change the password of an encrypted database via PRAGMA rekey
- [x] **DBSC-07**: All existing tests pass with the new database library on Windows, macOS, and Linux
- [x] **DBSC-08**: Build pipeline (electron-vite config, CI workflows, Makefile, package.json) updated for the new native module

### Database Selection

- [x] **DBSL-01**: User can select an existing SQLite database file via file picker dialog
- [x] **DBSL-02**: User can create a new empty database via dialog
- [x] **DBSL-03**: User can switch between databases without restarting the app
- [x] **DBSL-04**: App displays the current database name/path in the UI
- [x] **DBSL-05**: Prepared statement cache is invalidated when switching databases to prevent stale handle crashes
- [x] **DBSL-06**: DatabaseService supports open/close/switch lifecycle (replaces hardcoded singleton)

### External Links

- [ ] **EXTL-01**: Variant table rows include clickable icon buttons for gnomAD, ClinVar, and OMIM
- [ ] **EXTL-02**: gnomAD link opens variant page using `chr-pos-ref-alt` URL format in default browser
- [ ] **EXTL-03**: ClinVar link opens search using `chr:pos:ref:alt` URL format in default browser
- [ ] **EXTL-04**: OMIM link opens entry page using MIM number (when available) or gene search in default browser
- [ ] **EXTL-05**: External link URLs are constructed with proper URL encoding of variant data components
- [ ] **EXTL-06**: Shell openExternal domain allowlist is expanded to include gnomad.broadinstitute.org, ncbi.nlm.nih.gov, and omim.org

### Batch Import

- [ ] **BTCH-01**: User can select multiple JSON.gz files via multi-file picker dialog
- [ ] **BTCH-02**: User can select a folder to import all JSON.gz files within it
- [ ] **BTCH-03**: Batch import processes files sequentially with per-file error isolation (one failure does not abort the batch)
- [ ] **BTCH-04**: Batch import displays aggregate progress across all files (current file N of M, overall percentage)
- [ ] **BTCH-05**: Batch import shows a summary report on completion (files succeeded, failed, skipped)
- [ ] **BTCH-06**: Duplicate case names during batch import are handled gracefully (skip, rename, or overwrite with user choice)

### ZIP Import

- [ ] **ZIMP-01**: User can select a password-protected ZIP file for import
- [ ] **ZIMP-02**: User is prompted for the ZIP password before extraction
- [ ] **ZIMP-03**: ZIP extraction writes to a temporary directory and cleans up after import completes or fails
- [ ] **ZIMP-04**: ZIP extraction validates file paths to prevent Zip Slip path traversal attacks (reject `..`, absolute paths, UNC paths)
- [ ] **ZIMP-05**: Extracted JSON.gz files are fed to the existing import pipeline (single or batch)

### OMIM Data

- [ ] **OMIM-01**: Import pipeline extracts OMIM MIM numbers from variant annotation data
- [ ] **OMIM-02**: Import pipeline extracts OMIM disease names/associations from variant annotation data
- [ ] **OMIM-03**: Variants table schema includes columns for OMIM MIM number and disease name
- [ ] **OMIM-04**: OMIM disease associations are displayed inline in variant table rows
- [ ] **OMIM-05**: OMIM external link uses direct MIM entry URL when MIM number is available (falls back to gene search)

### Cohort Analysis

- [ ] **CHRT-01**: App provides a distinct cohort analysis view/mode separate from single-case analysis (tab-based navigation)
- [ ] **CHRT-02**: Cohort view displays an aggregated variant table across all imported cases (grouped by chr, pos, ref, alt)
- [ ] **CHRT-03**: Cohort variant table shows carrier count per variant (number of cases carrying the variant)
- [ ] **CHRT-04**: Cohort variant table shows cohort allele frequency per variant
- [ ] **CHRT-05**: Cohort variant table shows het/hom breakdown per variant
- [ ] **CHRT-06**: Cohort variant table provides per-case links (drill down from aggregated variant to individual case analyses)
- [ ] **CHRT-07**: User can search for a specific variant or gene across the entire cohort
- [ ] **CHRT-08**: Cohort search results show carrier summary (which cases carry the variant, zygosity, frequency)
- [ ] **CHRT-09**: Cohort view includes gene-level aggregation (burden summary per gene across all cases)
- [ ] **CHRT-10**: Cohort aggregation queries use proper composite indexes for performance on large datasets

## v0.2.0 Requirements (Complete)

Requirements for UI polish, branding, and trust signals milestone.

### App Chrome

- [x] **CHRM-01**: App displays a top app bar with "VarLens" name and DNA icon across all views
- [x] **CHRM-02**: App displays a footer bar with version number accessible via popup menu
- [x] **CHRM-03**: Footer includes GitHub repository link as small icon button
- [x] **CHRM-04**: Footer includes license link as small icon button
- [x] **CHRM-05**: Footer includes disclaimer acknowledgment status indicator
- [x] **CHRM-06**: Footer includes FAQ dialog trigger button
- [x] **CHRM-07**: Footer includes log viewer toggle button with error count badge
- [x] **CHRM-08**: App uses RequiForm warm palette (#a09588 primary, #E5AA94 footer background, #424242 secondary) via Vuetify theme config
- [x] **CHRM-09**: All UI text uses "research" language -- no "clinical" references anywhere

### Trust Signals

- [x] **TRST-01**: User sees a blocking disclaimer dialog on first launch stating research-use-only purpose
- [x] **TRST-02**: Disclaimer dialog lists specific limitations (not diagnostic, must be verified, no doctor-patient relationship)
- [x] **TRST-03**: User must acknowledge disclaimer before accessing the app
- [x] **TRST-04**: Disclaimer acknowledgment persists per app version in localStorage
- [x] **TRST-05**: User can re-open disclaimer from footer button at any time
- [x] **TRST-06**: User can open FAQ dialog from footer button
- [x] **TRST-07**: FAQ dialog displays searchable, categorized Q&A in expansion panels
- [x] **TRST-08**: FAQ content is loaded from a JSON configuration file (faqConfig.json)
- [x] **TRST-09**: Disclaimer text is configurable via JSON file

### Logging

- [x] **LOG-01**: App has a LogService with debug/info/warn/error/critical log methods
- [x] **LOG-02**: Log entries are stored in a Pinia store with circular buffer (configurable max entries)
- [x] **LOG-03**: Log store tracks statistics (total received, dropped, per-level counts)
- [x] **LOG-04**: User can open a LogViewer drawer from the footer button
- [x] **LOG-05**: LogViewer supports full-text search across log messages
- [x] **LOG-06**: LogViewer supports filtering by log level (multi-select)
- [x] **LOG-07**: User can download logs as JSON export
- [x] **LOG-08**: User can clear all logs from the viewer
- [x] **LOG-09**: LogViewer displays memory usage statistics
- [x] **LOG-10**: Log configuration (max entries, level) is stored in localStorage and configurable via JSON
- [x] **LOG-11**: Log sanitizer redacts sensitive genetic/medical data (HGVS notation, patient identifiers, genomic coordinates)

## Future Requirements

Deferred to later milestones.

### Core Features (v0.4+)

- **FEAT-01**: Virtual gene panels for targeted variant filtering
- **FEAT-02**: Advanced inheritance filters (de novo, compound het)
- **FEAT-03**: Statistics dashboard with variant summary metrics
- **FEAT-04**: PDF report generation

### Nice-to-Have (unscheduled)

- **NICE-01**: Dark mode toggle
- **NICE-02**: Keyboard shortcuts
- **NICE-03**: Internationalization (i18n) support

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real-time collaboration | Offline-first desktop app |
| Cloud sync | Not in v0.x scope |
| VCF import | JSON-only for current scope |
| CNV/SV analysis | SNV-focused for current scope |
| User authentication | Desktop app, single-user |
| Clinical diagnostic language | Research use only -- explicitly excluded |
| Affected/unaffected cohort split | Requires case metadata schema; deferred to v0.4+ |
| Cross-case variant comparison matrix | Complex UI; deferred to v0.4+ |
| Cohort statistics charts | Tabular data sufficient for v0.3.0 |
| Drag-and-drop import | Multi-file picker is sufficient for v0.3.0 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DBSC-01 | Phase 13 | Complete |
| DBSC-02 | Phase 13 | Complete |
| DBSC-03 | Phase 13 | Complete |
| DBSC-04 | Phase 14 | Pending |
| DBSC-05 | Phase 14 | Pending |
| DBSC-06 | Phase 14 | Pending |
| DBSC-07 | Phase 13 | Complete |
| DBSC-08 | Phase 13 | Complete |
| DBSL-01 | Phase 14 | Pending |
| DBSL-02 | Phase 14 | Pending |
| DBSL-03 | Phase 14 | Pending |
| DBSL-04 | Phase 14 | Pending |
| DBSL-05 | Phase 14 | Pending |
| DBSL-06 | Phase 14 | Pending |
| EXTL-01 | Phase 15 | Pending |
| EXTL-02 | Phase 15 | Pending |
| EXTL-03 | Phase 15 | Pending |
| EXTL-04 | Phase 15 | Pending |
| EXTL-05 | Phase 15 | Pending |
| EXTL-06 | Phase 15 | Pending |
| BTCH-01 | Phase 16 | Pending |
| BTCH-02 | Phase 16 | Pending |
| BTCH-03 | Phase 16 | Pending |
| BTCH-04 | Phase 16 | Pending |
| BTCH-05 | Phase 16 | Pending |
| BTCH-06 | Phase 16 | Pending |
| ZIMP-01 | Phase 16 | Pending |
| ZIMP-02 | Phase 16 | Pending |
| ZIMP-03 | Phase 16 | Pending |
| ZIMP-04 | Phase 16 | Pending |
| ZIMP-05 | Phase 16 | Pending |
| OMIM-01 | Phase 17 | Pending |
| OMIM-02 | Phase 17 | Pending |
| OMIM-03 | Phase 17 | Pending |
| OMIM-04 | Phase 17 | Pending |
| OMIM-05 | Phase 17 | Pending |
| CHRT-01 | Phase 18 | Pending |
| CHRT-02 | Phase 18 | Pending |
| CHRT-03 | Phase 18 | Pending |
| CHRT-04 | Phase 18 | Pending |
| CHRT-05 | Phase 18 | Pending |
| CHRT-06 | Phase 18 | Pending |
| CHRT-07 | Phase 18 | Pending |
| CHRT-08 | Phase 18 | Pending |
| CHRT-09 | Phase 18 | Pending |
| CHRT-10 | Phase 18 | Pending |
| CHRM-01 | Phase 9 | Complete |
| CHRM-02 | Phase 12 | Complete |
| CHRM-03 | Phase 12 | Complete |
| CHRM-04 | Phase 12 | Complete |
| CHRM-05 | Phase 12 | Complete |
| CHRM-06 | Phase 12 | Complete |
| CHRM-07 | Phase 12 | Complete |
| CHRM-08 | Phase 9 | Complete |
| CHRM-09 | Phase 9 | Complete |
| TRST-01 | Phase 11 | Complete |
| TRST-02 | Phase 11 | Complete |
| TRST-03 | Phase 11 | Complete |
| TRST-04 | Phase 11 | Complete |
| TRST-05 | Phase 11 | Complete |
| TRST-06 | Phase 11 | Complete |
| TRST-07 | Phase 11 | Complete |
| TRST-08 | Phase 11 | Complete |
| TRST-09 | Phase 11 | Complete |
| LOG-01 | Phase 10 | Complete |
| LOG-02 | Phase 10 | Complete |
| LOG-03 | Phase 10 | Complete |
| LOG-04 | Phase 10 | Complete |
| LOG-05 | Phase 10 | Complete |
| LOG-06 | Phase 10 | Complete |
| LOG-07 | Phase 10 | Complete |
| LOG-08 | Phase 10 | Complete |
| LOG-09 | Phase 10 | Complete |
| LOG-10 | Phase 10 | Complete |
| LOG-11 | Phase 10 | Complete |

**Coverage:**
- v0.3.0 requirements: 40 total
- Mapped to phases: 40/40 (all mapped)
- v0.2.0 requirements: 29 total (all complete)

---
*Requirements defined: 2026-01-27*
*Last updated: 2026-01-27 after v0.3.0 roadmap creation*
