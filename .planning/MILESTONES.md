# Project Milestones: Varlens

## v0.4.0 Variant Annotation & Case Metadata (Shipped: 2026-01-29)

**Delivered:** Active analysis workbench with variant annotation (comments, stars, ACMG classification, custom tags), variant details side panel with live VEP API enrichment, and case metadata (status, cohorts, HPO phenotypes).

**Phases completed:** 19-25 (27 plans total)

**Key accomplishments:**

- Variant annotation system with global/per-case comments, star/flag, ACMG 5-tier classification, and custom tags with color management
- Variant details side panel with resizable drawer, annotation scores, external links (PubTator, LitVar, UCSC, Decipher, ClinGen, Ensembl), and copy-to-clipboard
- Live Ensembl VEP API enrichment with SQLite caching (30-day TTL), rate limiting (15 req/sec), and graceful offline degradation
- Case metadata with affected/unaffected status, cohort group assignment, and HPO phenotype terms via API-powered autocomplete
- Bundled HPO ontology (19,407 terms) for offline phenotype search
- Professional table UX with column preferences, draggable filter groups, sticky positioning, and Settings reset options

**Stats:**

- 73 files created/modified (+89,992 / -393 lines)
- 21,411 lines of TypeScript/Vue (current total)
- 7 phases, 27 plans, 142+ decisions documented
- 2 days (2026-01-28 → 2026-01-29)
- 66 commits

**Git range:** `0c4d6ec` (feat(19-01)) → `825eeb6` (feat(25))

**What's next:** Virtual gene panels, inheritance filters, statistics dashboard, automated ACMG classification, pedigree/trio analysis

---

## v0.3.0 Cohort Analysis, Security & Import Enhancements (Shipped: 2026-01-28)

**Delivered:** Transforms Varlens from a single-sample viewer into a cohort analysis platform with SQLCipher database encryption, database selection/switching, batch import with ZIP support, external genomic database links, OMIM MIM number integration, and cross-case cohort analysis with aggregated statistics.

**Phases completed:** 13-18 (13 plans total)

**Key accomplishments:**

- SQLCipher database encryption with password-gated open/create and PRAGMA key infrastructure
- Database lifecycle management with open/close/switch, rollback-safe switching, and recent databases persistence
- Configurable external links to gnomAD, ClinVar, OMIM, UCSC, VarSome, and Franklin with URL template system
- Batch import from multi-file picker, folder selection, and password-protected ZIP archives with Zip Slip prevention
- OMIM MIM number extraction from variant annotation data with inline clickable links to OMIM entries
- Cohort analysis view with aggregated variant table, carrier counts, allele frequency, het/hom breakdown, FTS5 search, gene burden analysis, and per-case drill-down navigation

**Stats:**

- 104 files created/modified (+18,646 / -448 lines)
- 11,402 lines of TypeScript/Vue (current total)
- 6 phases, 13 plans, 39 decisions documented
- 2 days (2026-01-27 → 2026-01-28)
- 77 commits

**Git range:** `7502aab` → `1717121`

**What's next:** Virtual gene panels, inheritance filters, statistics dashboard, OMIM disease name extraction, performance profiling with 50+ cases

---

## v0.2.0 UI Polish & Trust Signals (Shipped: 2026-01-27)

**Delivered:** Professional branding, trust signals, logging infrastructure, and app chrome on top of v0.1 POC.

**Phases completed:** 9-12 (8 plans total)

**Key accomplishments:**

- RequiForm warm palette branding with DNA icon app bar
- Blocking research-use disclaimer dialog with per-version acknowledgment
- Searchable FAQ dialog with JSON-configurable expansion panels
- Full-featured LogViewer drawer with level filtering, search, download, and memory stats
- App footer with version info, GitHub link, license link, disclaimer status, FAQ button, log viewer toggle

**Git range:** v0.1 → v0.2.0

---

## v0.1 POC (Shipped: 2026-01-27)

**Delivered:** Complete proof-of-concept validating Electron + Vue 3 + Vuetify 3 + better-sqlite3 stack with streaming import, paginated table, and FTS5-powered filtering.

**Phases completed:** 1-8 (17 plans total)

**Key accomplishments:**

- Complete Electron + Vue 3 + Vuetify 3 + better-sqlite3 stack validated
- Streaming import pipeline processes 65k gzipped JSON variants in ~20 seconds
- FTS5-powered full-text search with gene autocomplete and BM25 ranking
- Server-side paginated variant table with cursor-based navigation
- Data-dense filtering: gene symbol, consequence, gnomAD AF, CADD thresholds
- Complete end-to-end workflow: import → case management → filtering → display

**Stats:**

- 121 files created/modified
- 4,433 lines of TypeScript/Vue
- 8 phases, 17 plans, 66 decisions documented
- 2 days from project initialization to ship (2026-01-26 → 2026-01-27)
- 112 commits

**Git range:** `c9160c8` → `08e7eb4`

**What's next:** Virtual gene panels, inheritance filters, statistics dashboard (v0.2)

---

*Last updated: 2026-01-29 after v0.4.0 milestone*
