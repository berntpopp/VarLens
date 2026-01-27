# Project Research Summary

**Project:** Varlens v0.3.0
**Domain:** Electron desktop app for offline genetic variant analysis -- cohort analysis, database encryption, batch import, external links
**Researched:** 2026-01-27
**Confidence:** HIGH

## Executive Summary

Varlens v0.3.0 adds six major capabilities to an existing Electron + Vue 3 + better-sqlite3 desktop application: database encryption via SQLCipher, database selection/switching, batch import with password-protected ZIP support, external links to genomic databases, OMIM data extraction, and cross-case cohort analysis. The existing codebase has a clean three-layer architecture (main process with SQLite, preload bridge, Vue 3 renderer) that accommodates all six features through well-defined extension points. The total new dependency footprint is minimal: one package replacement (`better-sqlite3` to `better-sqlite3-multiple-ciphers`) and one new package (`unzipper` for ZIP extraction). Cohort aggregation, external links, and database selection require no new dependencies at all.

The recommended approach is to lead with the SQLCipher dependency swap because it replaces the core database library that every other feature depends on. This is also the highest-risk change -- it touches 8+ files across the build pipeline, and a missed reference causes runtime crashes. After the foundation is stable, database selection and external links can proceed in parallel since they are architecturally independent. Batch import and ZIP extraction come next to enable the multi-case workflow that cohort analysis depends on. Cohort analysis is the most complex new feature and should come last, when all import infrastructure is proven and multiple test cases exist in the database.

The key risks are: (1) the native module swap breaking the cross-platform build pipeline if any of the 8+ `better-sqlite3` references are missed; (2) the PRAGMA key ordering requirement for FTS5 virtual tables in encrypted databases, which causes silent failures; (3) Zip Slip path traversal vulnerabilities in ZIP extraction; and (4) main-process blocking from synchronous cohort aggregation queries on large datasets. All four risks have clear prevention strategies documented in the research and should be addressed proactively during implementation, not reactively.

## Key Findings

### Recommended Stack

The v0.3.0 stack changes are deliberately minimal. Only two runtime dependencies change, and the build process remains structurally identical.

**Core technologies:**
- `better-sqlite3-multiple-ciphers` (v12.6.2): Drop-in replacement for `better-sqlite3` with SQLCipher encryption -- API-compatible fork with prebuilt Electron 40 binaries confirmed. Uses SQLCipher legacy=4 mode for AES-256 encryption compatible with industry tools.
- `unzipper` (v0.12.3): Pure JavaScript streaming ZIP extraction with ZipCrypto password support -- no native dependencies, 1,697 npm dependents. Does NOT support AES-256 encrypted ZIPs (acceptable for the expected use case; `@zip.js/zip.js` is the fallback if AES-256 becomes required).
- SQLite (existing): All cohort aggregation uses SQL GROUP BY, COUNT, window functions, and CTEs. No ORM or query builder needed.
- Electron built-ins (existing): `shell.openExternal()` for external links, `dialog.showOpenDialog()` for database/file selection. No new Electron dependencies.

**Critical version note:** `better-sqlite3-multiple-ciphers` v12.6.2 (released January 19, 2026) is confirmed to have Electron v40 prebuilt binaries. Do not use an older version.

### Expected Features

**Must have (table stakes):**
- External links to gnomAD, ClinVar, OMIM per variant/gene (low complexity, immediate user value)
- Multi-file batch import with per-file error isolation and progress reporting
- Database file selection/switching with recent databases list
- Database encryption (SQLCipher) with password prompt, create, and open flows
- Password-protected ZIP import with temp file cleanup
- Cohort aggregated variant table with carrier count, allele frequency, het/hom breakdown
- Cohort variant search reusing existing filter patterns

**Should have (differentiators):**
- Gene-level burden view across cohort (research-grade feature from tools like VARPRISM)
- Per-case drill-down from cohort variant view
- OMIM disease associations displayed inline in variant table
- Combined encryption story: encrypted ZIP transport + encrypted SQLCipher at rest

**Defer (post v0.3.0):**
- Affected/unaffected cohort split (requires schema extension for case metadata)
- Cross-case variant comparison matrix (complex UI, v0.4+ territory)
- Cohort statistics charts (numbers in a table are sufficient for clinical genetics)
- Folder import with drag-and-drop (multi-file picker is sufficient)
- VCF import, CNV/SV analysis, multi-user access, live API fetching (all anti-features)

### Architecture Approach

The existing architecture extends cleanly. The most disruptive change is the SQLCipher migration, which affects the DatabaseService constructor and build pipeline but preserves the API surface. Database selection transforms the singleton factory into a lifecycle manager (open/close/switch). Batch import wraps the existing streaming pipeline in a sequential orchestrator. Cohort analysis adds new SQL views and a separate CohortView component (tab-based navigation, not vue-router). External links are pure renderer-side URL generation with an expanded shell handler whitelist.

**Major components:**
1. **DatabaseService lifecycle manager** -- replaces hardcoded singleton with open/close/switch capability; accepts encryption key at construction time
2. **ZipExtractor** -- new pre-processing step that extracts .json.gz from password-protected ZIPs to temp directory before feeding to existing ImportService
3. **BatchImportOrchestrator** -- sequential file processing wrapper around existing ImportService with aggregate progress reporting and per-file error isolation
4. **CohortView + CohortVariantTable** -- new Vue components for cross-case aggregation display; separate from existing VariantTable to avoid conditional complexity
5. **External link utilities** -- renderer-side URL builders for gnomAD, ClinVar, OMIM, UCSC; main-process shell handler whitelist expansion

### Critical Pitfalls

1. **Build pipeline breakage during SQLCipher swap** -- `better-sqlite3` is referenced in 8+ locations across package.json, vite config, CI workflows, and Makefile. Missing any one causes runtime crashes. Prevention: grep for every occurrence, update atomically in one commit, verify CI passes on all 3 platforms before merging.
2. **FTS5 fails when PRAGMA key is not called before schema initialization** -- encrypted databases require `PRAGMA key` as the very first operation. The current constructor initializes schema immediately. Prevention: modify constructor to accept key parameter; order must be `new Database()` -> `PRAGMA key` -> `PRAGMA journal_mode` -> `initializeSchema()`.
3. **Prepared statement cache segfaults on database switch** -- cached Statement objects are tied to the old connection's native handle. Using stale statements after switching databases causes SIGSEGV. Prevention: clear statement cache on close, add `isClosed` guard, ensure IPC handlers never cache the DatabaseService reference.
4. **Zip Slip path traversal in ZIP extraction** -- malicious ZIP entries with `../` paths can write files outside the target directory. Prevention: validate every resolved path starts with the target directory; reject entries with `..`, absolute paths, or UNC paths.
5. **shell.openExternal RCE with expanded domain allowlist** -- each new allowlisted domain is attack surface. URL construction from user-controlled variant data enables injection. Prevention: keep allowlist approach, URL-encode all variable components, validate final URL after construction.

## Implications for Roadmap

Based on combined research, the suggested structure is 6 phases plus integration. The ordering is driven by dependency analysis: encryption is foundational, database switching enables batch workflows, batch import enables cohort analysis.

### Phase 1: SQLCipher Foundation
**Rationale:** Every other feature depends on the database library. Swapping `better-sqlite3` for `better-sqlite3-multiple-ciphers` is the highest-risk change and must be validated on all 3 CI platforms before any feature work begins. This is a pure infrastructure change with no user-facing features yet.
**Delivers:** Encrypted database support at the library level; all existing tests pass with the new dependency; CI green on Windows/macOS/Linux.
**Addresses:** Database encryption infrastructure (table stakes)
**Avoids:** Pitfall 1 (build pipeline breakage), Pitfall 2 (FTS5 + PRAGMA key ordering), Pitfall 8 (cross-platform compilation), Pitfall 12 (TypeScript type divergence)

### Phase 2: Database Selection and Encryption UX
**Rationale:** Database switching must work before batch import (users need to create/select databases). Encryption UX builds directly on the Phase 1 foundation. This phase transforms the singleton into a lifecycle manager.
**Delivers:** File picker for database selection, create new database, recent databases list, current database indicator in UI, password prompt for encrypted databases, change password, encryption migration for existing unencrypted databases.
**Addresses:** Database selection/switching (table stakes), database encryption UX (table stakes)
**Avoids:** Pitfall 3 (statement cache invalidation), Pitfall 6 (migration data loss), Pitfall 10 (singleton architecture limitation), Pitfall 15 (WAL cleanup)

### Phase 3: External Links
**Rationale:** Fully independent of phases 1-2 at the code level (can be developed in parallel). Zero schema changes, zero new dependencies. Pure renderer-side URL generation plus shell handler whitelist expansion. Provides immediate user value with minimal risk.
**Delivers:** gnomAD, ClinVar, OMIM link icons in variant table rows; links open in default browser; expanded shell handler domain allowlist.
**Addresses:** External links (table stakes)
**Avoids:** Pitfall 5 (shell.openExternal RCE), Pitfall 14 (brittle URL templates)

### Phase 4: Batch Import and ZIP Extraction
**Rationale:** Depends on Phase 2 (database lifecycle management) because batch import needs a stable database connection. Extends the proven single-file import pipeline with a sequential orchestrator. ZIP extraction is a pre-processing step, not a modification to ImportService.
**Delivers:** Multi-file picker, sequential batch processing with per-file error isolation, import summary report, duplicate case name handling, password-protected ZIP extraction with temp file cleanup, batch progress UI.
**Addresses:** Batch import (table stakes), ZIP extraction (table stakes)
**Avoids:** Pitfall 4 (Zip Slip path traversal), Pitfall 9 (per-file error isolation), Pitfall 13 (ZIP bomb)

### Phase 5: OMIM Data Extraction
**Rationale:** Requires investigation of the source JSON annotation format to identify OMIM column indices. Should follow batch import because single-file import can validate OMIM extraction before scaling to batch. Adds schema columns and field mapping changes.
**Delivers:** OMIM MIM number and disease name columns in variants table, inline disease association display, enhanced OMIM link-out with MIM number (direct entry link instead of search).
**Addresses:** OMIM disease associations (differentiator)
**Avoids:** No critical pitfalls; moderate risk around data source investigation.

### Phase 6: Cohort Analysis
**Rationale:** Most complex feature. Depends on batch import being complete (need multiple cases in the database to test). New SQL views, new IPC channels, new Vue components (CohortView, CohortVariantTable, CohortSummary). Performance-sensitive with large datasets.
**Delivers:** Aggregated variant table across all cases, carrier count per variant, cohort allele frequency, het/hom breakdown, per-case drill-down, cohort variant search, gene-level burden aggregation.
**Addresses:** Cohort analysis (table stakes + differentiator features)
**Avoids:** Pitfall 7 (main process blocking), Pitfall 11 (IPC serialization overhead)

### Phase Ordering Rationale

- **Dependency chain:** SQLCipher -> Database lifecycle -> Batch import -> Cohort analysis. Each phase builds on the previous one's infrastructure.
- **Risk front-loading:** The highest-risk change (native module swap) comes first when there are no other moving parts to complicate debugging.
- **External links in parallel:** Phase 3 has zero dependencies on phases 1-2 and can be developed concurrently.
- **OMIM before cohort:** OMIM extraction modifies the import pipeline (field mapping). Better to validate this with single-file imports before batch processing is layered on top.
- **Cohort last:** It is the most complex feature, benefits from all infrastructure being in place, and needs multiple imported cases for realistic testing.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (SQLCipher Foundation):** Research the exact prebuilt binary availability for Electron 40 on all 3 platforms. Verify `@electron/rebuild` v4.0.2 downloads prebuilts correctly for the new package.
- **Phase 2 (Database Selection + Encryption UX):** Research the `PRAGMA rekey` behavior in `better-sqlite3-multiple-ciphers` for in-place encryption of existing unencrypted databases. The STACK.md mentions `rekey` but PITFALLS.md warns about data loss risk.
- **Phase 5 (OMIM Data Extraction):** Requires investigation of the actual source JSON annotation file to identify which column indices contain OMIM data (MIM number, disease name). This cannot be determined from research alone -- must examine test data files.
- **Phase 6 (Cohort Analysis):** Performance profiling with realistic data volumes (50+ cases, 65K variants each). Need to determine whether SQL views are fast enough or if materialized summary tables are required.

Phases with standard patterns (skip research-phase):
- **Phase 3 (External Links):** Well-documented URL patterns for gnomAD, ClinVar, OMIM. Existing `shell.openExternal` handler. Straightforward implementation.
- **Phase 4 (Batch Import + ZIP):** Extends proven single-file pipeline. `unzipper` API is well-documented. Sequential processing pattern is standard.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | `better-sqlite3-multiple-ciphers` v12.6.2 verified with Electron 40 prebuilts. `unzipper` v0.12.3 is well-established. Only gap: AES-256 ZIP support (not available, fallback identified). |
| Features | HIGH | Feature landscape mapped against 6+ commercial/academic tools (VarSeq, IVA, AVT, ICA, VARPRISM, VGC). Clear table stakes vs. differentiator distinction. Anti-features well-defined. |
| Architecture | HIGH | Current codebase has clean extension points. All proposed changes follow existing patterns (IPC channel convention, handler wrapper, Transform pipeline). Tab-based navigation avoids vue-router dependency. |
| Pitfalls | HIGH | 15 pitfalls identified with prevention strategies. Critical pitfalls verified against official documentation (SQLite3 Multiple Ciphers FAQ, Snyk Zip Slip research, Electron security docs). Phase-specific warnings mapped. |

**Overall confidence:** HIGH

### Gaps to Address

- **OMIM column indices in source JSON:** Cannot be determined from research. Must examine an actual annotation file to find OMIM-related fields. Block Phase 5 planning on this investigation.
- **PRAGMA rekey vs. ATTACH/export for encryption migration:** Two approaches documented with conflicting complexity assessments. STACK.md says `PRAGMA rekey` works for in-place encryption; PITFALLS.md warns about data loss with the ATTACH approach. Need to verify which approach `better-sqlite3-multiple-ciphers` supports and test it.
- **Cohort query performance at scale:** No benchmarks available. The assumption that SQL views with proper indexing are fast enough for 50+ cases needs validation. Plan for a performance testing spike in Phase 6.
- **unzipper AES-256 limitation:** If the upstream data provider uses AES-256 encrypted ZIPs (rather than ZipCrypto), `unzipper` will not work. Confirm the expected encryption scheme before Phase 4.
- **Electron 40 worker_threads compatibility:** If cohort aggregation queries block the main process, moving them to a worker thread is the mitigation. There is a known Electron bug with better-sqlite3 in worker threads (issue #43513). Verify if this is resolved for Electron 40.

## Sources

### Primary (HIGH confidence)
- [better-sqlite3-multiple-ciphers GitHub](https://github.com/m4heshd/better-sqlite3-multiple-ciphers) -- API compatibility, Electron 40 prebuilt binaries, encryption PRAGMAs
- [better-sqlite3-multiple-ciphers releases](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/releases) -- v12.6.2 release (January 19, 2026) with Electron v29-v40 prebuilts
- [SQLite3 Multiple Ciphers documentation](https://utelle.github.io/SQLite3MultipleCiphers/) -- PRAGMA key/rekey/cipher usage, FTS5 compatibility
- [SQLite3 Multiple Ciphers FAQ](https://utelle.github.io/SQLite3MultipleCiphers/docs/faq/faq_overview/) -- FTS5 + encryption ordering requirement
- [better-sqlite3 API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) -- Statement lifecycle, db.close() behavior
- [Zip Slip vulnerability research (Snyk)](https://security.snyk.io/research/zip-slip-vulnerability) -- path traversal prevention
- [shell.openExternal dangers (Benjamin Altpeter)](https://benjamin-altpeter.de/shell-openexternal-dangers/) -- RCE vectors in Electron
- [Electron security documentation](https://www.electronjs.org/docs/latest/tutorial/security) -- context isolation, shell.openExternal
- [ClinVar linking documentation](https://www.ncbi.nlm.nih.gov/clinvar/docs/linking/) -- verified URL formats
- [gnomAD browser](https://gnomad.broadinstitute.org/) -- verified variant URL pattern
- [OMIM linking help](https://www.omim.org/help/linking) -- verified entry URL format

### Secondary (MEDIUM confidence)
- [Golden Helix VarSeq](https://www.goldenhelix.com/products/VarSeq/) -- cohort analysis Count Alleles algorithm
- [Genomics England IVA](https://re-docs.genomicsengland.co.uk/iva_variant/) -- cohort variant stats, het/hom breakdown
- [Genomics England AVT](https://re-docs.genomicsengland.co.uk/avt/) -- aggregate variant testing patterns
- [unzipper npm](https://www.npmjs.com/package/unzipper) -- password-protected ZIP extraction, AES-256 limitation (issue #86)
- [SQLCipher unencrypted-to-encrypted migration](https://discuss.zetetic.net/t/how-to-encrypt-a-plaintext-sqlite-database-to-use-sqlcipher-and-avoid-file-is-encrypted-or-is-not-a-database-errors/868) -- ATTACH + sqlcipher_export approach
- [sqlite-search (GitHub)](https://github.com/berntpopp/sqlite-search) -- database selection/switching reference pattern

### Tertiary (LOW confidence)
- [Electron worker_threads bug #43513](https://github.com/electron/electron/issues/43513) -- better-sqlite3 in worker threads; status for Electron 40 unverified
- [Ensembl VEP URL patterns](https://www.ensembl.org/) -- requires rsID, not chr:pos; needs verification before implementing
- [@zip.js/zip.js](https://gildas-lormeau.github.io/zip.js/) -- AES-256 fallback; not tested for this project

---
*Research completed: 2026-01-27*
*Ready for roadmap: yes*
