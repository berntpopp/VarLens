# Roadmap: Varlens v0.3.0

**Milestone:** v0.3.0 -- Cohort Analysis, Security & Import Enhancements
**Phases:** 6 (Phase 13-18, continuing from v0.2.0 Phase 12)
**Requirements:** 40 v1 requirements across 7 categories
**Depth:** Balanced

## Overview

This milestone transforms Varlens from a single-sample viewer into a cohort analysis platform. The work delivers SQLCipher database encryption, database selection/switching, batch import with password-protected ZIP support, external links to genomic databases, OMIM disease associations, and cross-case cohort analysis with variant aggregation. Phases are ordered by dependency chain: the native module swap is highest risk and foundational, database lifecycle enables multi-file workflows, import infrastructure enables cohort analysis, and external links / OMIM are independent enhancements that slot in between.

---

## Phase 13: SQLCipher Foundation

**Goal:** App uses the encrypted database library with all existing functionality preserved across all three platforms -- no user-facing changes yet, but the encryption infrastructure is in place.

**Dependencies:** None (foundation for all subsequent phases)

**Plans:** 2 plans

Plans:
- [x] 13-01-PLAN.md -- Native module swap from better-sqlite3 to better-sqlite3-multiple-ciphers with full build pipeline update
- [x] 13-02-PLAN.md -- PRAGMA key integration into DatabaseService constructor with FTS5 ordering, encrypted database tests

**Requirements:**
- DBSC-01: App uses `better-sqlite3-multiple-ciphers` as drop-in replacement for `better-sqlite3` with SQLCipher encryption support
- DBSC-02: Database accepts encryption key via PRAGMA key as the first operation after opening, before any schema initialization
- DBSC-03: FTS5 virtual table creation occurs after PRAGMA key is set on encrypted databases
- DBSC-07: All existing tests pass with the new database library on Windows, macOS, and Linux
- DBSC-08: Build pipeline (electron-vite config, CI workflows, Makefile, package.json) updated for the new native module

**Success Criteria:**
1. User can launch the app and use all existing features (import, query, filter, search) identically to v0.2.0 -- the library swap is invisible
2. All existing tests pass on Windows, macOS, and Linux CI runners with the new native module
3. An encrypted database can be created programmatically, reopened with the correct key, and queried (including FTS5 search) without errors
4. The build pipeline produces installable packages on all three platforms

---

## Phase 14: Database Selection & Encryption UX

**Goal:** User can create, open, switch, and encrypt databases through the UI without restarting the app.

**Dependencies:** Phase 13 (SQLCipher library must be in place)

**Plans:** 2 plans

Plans:
- [x] 14-01-PLAN.md -- DatabaseService lifecycle manager with open/close/switch, statement cache invalidation, IPC handlers
- [x] 14-02-PLAN.md -- Database picker UI, encrypted database password dialogs, current database indicator

**Requirements:**
- DBSL-01: User can select an existing SQLite database file via file picker dialog
- DBSL-02: User can create a new empty database via dialog
- DBSL-03: User can switch between databases without restarting the app
- DBSL-04: App displays the current database name/path in the UI
- DBSL-05: Prepared statement cache is invalidated when switching databases to prevent stale handle crashes
- DBSL-06: DatabaseService supports open/close/switch lifecycle (replaces hardcoded singleton)
- DBSC-04: User is prompted for a password when opening an encrypted database
- DBSC-05: User can create a new encrypted database with a password
- DBSC-06: User can change the password of an encrypted database via PRAGMA rekey

**Success Criteria:**
1. User can open a file picker, select an existing .sqlite database file, and the app loads its cases and variants without restarting
2. User can create a new empty database from the UI, and it becomes the active database ready for imports
3. User can switch between two databases back and forth, and variant data reflects the correct database each time with no crashes or stale data
4. User sees the current database name/path displayed in the UI at all times
5. User is prompted for a password when opening an encrypted database, can create a new encrypted database with a password, and can change the password of an open encrypted database

---

## Phase 15: External Links

**Goal:** User can open variant-specific pages on gnomAD, ClinVar, and OMIM directly from the variant table, with fully configurable link templates via a settings UI.

**Dependencies:** None (architecturally independent; can be developed in parallel with Phase 14)

**Plans:** 3 plans

Plans:
- [x] 15-01-PLAN.md -- URL builder utility functions for six genomic databases (eight functions including search variants) with unit tests and domain allowlist expansion
- [x] 15-02-PLAN.md -- Clickable data values in variant table columns as external links with visual indicators and error feedback
- [x] 15-03-PLAN.md -- Configurable external links with Pinia store, settings dialog, URL template system, and dynamic domain allowlist sync

**Requirements:**
- EXTL-01: Variant table rows include clickable data values linking to gnomAD, ClinVar, and OMIM (the data IS the link, with external-link icon suffix)
- EXTL-02: gnomAD link opens variant page using `chr-pos-ref-alt` URL format in default browser
- EXTL-03: ClinVar link opens coordinate search using `chr:pos:ref:alt` URL format in default browser (ClinVar ID-based link deferred to Phase 17 when clinvar_id field is added)
- EXTL-04: OMIM link opens gene search using gene symbol in default browser (direct MIM entry link deferred to Phase 17 when omim_mim_number field is added)
- EXTL-05: External link URLs are constructed with proper URL encoding of variant data components
- EXTL-06: Shell openExternal domain allowlist is expanded to include gnomad.broadinstitute.org, ncbi.nlm.nih.gov, and omim.org

**Success Criteria:**
1. User sees clickable data values (position, chr, ClinVar significance, gene symbol) in the variant table with external-link icon suffixes
2. User clicks the position value and the correct gnomAD variant page opens in the default browser using the chr-pos-ref-alt URL format
3. User clicks the ClinVar significance chip and a ClinVar coordinate search opens in the default browser using chr:pos:ref:alt format
4. User clicks the gene symbol and an OMIM gene search opens in the default browser
5. No non-allowlisted domains can be opened through the external link mechanism

---

## Phase 16: Batch Import & ZIP Extraction

**Goal:** User can import multiple case files at once -- from multi-file selection, folder selection, or a password-protected ZIP archive -- with per-file progress and error isolation.

**Dependencies:** Phase 14 (database lifecycle must support stable connections for sequential imports)

**Plans:** 2 plans

Plans:
- [x] 16-01-PLAN.md -- BatchImportOrchestrator with multi-file picker, folder selection, sequential processing, aggregate progress, and summary report
- [x] 16-02-PLAN.md -- ZipExtractor with password prompt, temp directory extraction, Zip Slip prevention, and pipeline integration

**Requirements:**
- BTCH-01: User can select multiple JSON.gz files via multi-file picker dialog
- BTCH-02: User can select a folder to import all JSON.gz files within it
- BTCH-03: Batch import processes files sequentially with per-file error isolation (one failure does not abort the batch)
- BTCH-04: Batch import displays aggregate progress across all files (current file N of M, overall percentage)
- BTCH-05: Batch import shows a summary report on completion (files succeeded, failed, skipped)
- BTCH-06: Duplicate case names during batch import are handled gracefully (skip, rename, or overwrite with user choice)
- ZIMP-01: User can select a password-protected ZIP file for import
- ZIMP-02: User is prompted for the ZIP password before extraction
- ZIMP-03: ZIP extraction writes to a temporary directory and cleans up after import completes or fails
- ZIMP-04: ZIP extraction validates file paths to prevent Zip Slip path traversal attacks (reject `..`, absolute paths, UNC paths)
- ZIMP-05: Extracted JSON.gz files are fed to the existing import pipeline (single or batch)

**Success Criteria:**
1. User can select multiple JSON.gz files via a file picker and all selected files are imported sequentially, with progress showing "File N of M" and overall percentage
2. User can select a folder and all JSON.gz files within it are discovered and imported
3. If one file in a batch fails (malformed JSON, duplicate case), the remaining files continue importing and the user sees a summary report showing which files succeeded, failed, or were skipped
4. User can select a password-protected ZIP file, enter the password, and the contained JSON.gz files are extracted and imported with temp files cleaned up afterward
5. A ZIP file containing path traversal entries (../) is rejected with a clear error, and no files are written outside the temp directory

---

## Phase 17: OMIM Data Extraction

**Goal:** User sees OMIM MIM numbers inline in the variant table and can link directly to OMIM entries using extracted MIM numbers.

**Dependencies:** Phase 15 (external link infrastructure for OMIM link-out)

**Plans:** 2 plans

Plans:
- [ ] 17-01-PLAN.md -- Schema extension, FTS5 rebuild, and import pipeline field mapping for OMIM MIM number extraction from source column 25
- [ ] 17-02-PLAN.md -- Dedicated OMIM column in variant table with clickable MIM number links and OMIM gene search link removal

**Requirements:**
- OMIM-01: Import pipeline extracts OMIM MIM numbers from variant annotation data
- OMIM-02: Import pipeline extracts OMIM disease names/associations from variant annotation data
- OMIM-03: Variants table schema includes columns for OMIM MIM number and disease name
- OMIM-04: OMIM disease associations are displayed inline in variant table rows
- OMIM-05: OMIM external link uses direct MIM entry URL when MIM number is available (falls back to gene search)

**Success Criteria:**
1. After importing a case file that contains OMIM annotation data, the user sees MIM numbers and disease names in dedicated columns of the variant table
2. User can see disease association text inline in variant rows without needing to click through to an external site
3. When a MIM number is available for a variant, clicking the OMIM link opens the direct MIM entry page (not a search page)
4. Variants without OMIM data show no disease association and the OMIM link falls back to a gene search

---

## Phase 18: Cohort Analysis

**Goal:** User can analyze variants across all imported cases in a dedicated cohort view with aggregated statistics, carrier counts, and gene-level burden summaries.

**Dependencies:** Phase 16 (batch import must be working so multiple cases exist for testing), Phase 17 (OMIM data enriches cohort display)

**Plans:** 2 plans

Plans:
- [ ] 18-01-PLAN.md -- Cohort SQL views, IPC handlers, composite indexes, and CohortView with aggregated variant table
- [ ] 18-02-PLAN.md -- Cohort search, carrier summary, gene-level burden aggregation, and per-case drill-down

**Requirements:**
- CHRT-01: App provides a distinct cohort analysis view/mode separate from single-case analysis (tab-based navigation)
- CHRT-02: Cohort view displays an aggregated variant table across all imported cases (grouped by chr, pos, ref, alt)
- CHRT-03: Cohort variant table shows carrier count per variant (number of cases carrying the variant)
- CHRT-04: Cohort variant table shows cohort allele frequency per variant
- CHRT-05: Cohort variant table shows het/hom breakdown per variant
- CHRT-06: Cohort variant table provides per-case links (drill down from aggregated variant to individual case analyses)
- CHRT-07: User can search for a specific variant or gene across the entire cohort
- CHRT-08: Cohort search results show carrier summary (which cases carry the variant, zygosity, frequency)
- CHRT-09: Cohort view includes gene-level aggregation (burden summary per gene across all cases)
- CHRT-10: Cohort aggregation queries use proper composite indexes for performance on large datasets

**Success Criteria:**
1. User can navigate to a distinct cohort analysis view via tab-based navigation, separate from the single-case variant table
2. User sees an aggregated variant table showing each unique variant (chr, pos, ref, alt) with carrier count, cohort allele frequency, and het/hom breakdown across all imported cases
3. User can click on a variant in the cohort table to see which specific cases carry it (per-case drill-down) with individual case zygosity
4. User can search for a gene or variant across the entire cohort and see a carrier summary showing which cases carry it and at what frequency
5. User can view a gene-level burden summary showing aggregate variant counts per gene across all cases

---

## Progress

| Phase | Name | Status | Requirements |
|-------|------|--------|--------------|
| 13 | SQLCipher Foundation | Complete | DBSC-01, DBSC-02, DBSC-03, DBSC-07, DBSC-08 |
| 14 | Database Selection & Encryption UX | Complete | DBSL-01 - DBSL-06, DBSC-04, DBSC-05, DBSC-06 |
| 15 | External Links | Complete | EXTL-01 - EXTL-06 |
| 16 | Batch Import & ZIP Extraction | Complete | BTCH-01 - BTCH-06, ZIMP-01 - ZIMP-05 |
| 17 | OMIM Data Extraction | Complete | OMIM-01 - OMIM-05 |
| 18 | Cohort Analysis | Not Started | CHRT-01 - CHRT-10 |

## Coverage

| Requirement | Phase | Status |
|-------------|-------|--------|
| DBSC-01 | Phase 13 | Complete |
| DBSC-02 | Phase 13 | Complete |
| DBSC-03 | Phase 13 | Complete |
| DBSC-04 | Phase 14 | Complete |
| DBSC-05 | Phase 14 | Complete |
| DBSC-06 | Phase 14 | Complete |
| DBSC-07 | Phase 13 | Complete |
| DBSC-08 | Phase 13 | Complete |
| DBSL-01 | Phase 14 | Complete |
| DBSL-02 | Phase 14 | Complete |
| DBSL-03 | Phase 14 | Complete |
| DBSL-04 | Phase 14 | Complete |
| DBSL-05 | Phase 14 | Complete |
| DBSL-06 | Phase 14 | Complete |
| EXTL-01 | Phase 15 | Complete |
| EXTL-02 | Phase 15 | Complete |
| EXTL-03 | Phase 15 | Complete |
| EXTL-04 | Phase 15 | Complete |
| EXTL-05 | Phase 15 | Complete |
| EXTL-06 | Phase 15 | Complete |
| BTCH-01 | Phase 16 | Complete |
| BTCH-02 | Phase 16 | Complete |
| BTCH-03 | Phase 16 | Complete |
| BTCH-04 | Phase 16 | Complete |
| BTCH-05 | Phase 16 | Complete |
| BTCH-06 | Phase 16 | Complete |
| ZIMP-01 | Phase 16 | Complete |
| ZIMP-02 | Phase 16 | Complete |
| ZIMP-03 | Phase 16 | Complete |
| ZIMP-04 | Phase 16 | Complete |
| ZIMP-05 | Phase 16 | Complete |
| OMIM-01 | Phase 17 | Complete |
| OMIM-02 | Phase 17 | Complete |
| OMIM-03 | Phase 17 | Complete |
| OMIM-04 | Phase 17 | Complete |
| OMIM-05 | Phase 17 | Complete |
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

**Total: 40/40 requirements mapped. No orphans.**

---
*Roadmap created: 2026-01-27*
*Milestone: v0.3.0 -- Cohort Analysis, Security & Import Enhancements*
