# Requirements: Varlens v0.4.0

**Defined:** 2026-01-28
**Core Value:** External collaborators can analyze variant data offline with data-dense UX for research use

## v0.4.0 Requirements

Requirements for v0.4.0 — Variant Annotation & Case Metadata. Each maps to roadmap phases.

### Annotation Storage

- [x] **ANNOT-01**: User can add a global comment to any variant (persists across all cases containing that variant)
- [x] **ANNOT-02**: User can add a per-case comment to a variant (specific to one case's context)
- [x] **ANNOT-03**: User can edit and delete existing comments (global and per-case)
- [x] **ANNOT-04**: All comments display creation and last-updated timestamps
- [x] **ANNOT-05**: User can star/flag a variant to mark it as interesting (toggle on/off)
- [x] **ANNOT-06**: User can assign ACMG 5-tier classification to a variant (Pathogenic, Likely Pathogenic, VUS, Likely Benign, Benign)
- [x] **ANNOT-07**: ACMG classification displays with color-coded badges in variant table rows
- [ ] **ANNOT-08**: User can create custom tags with name and color
- [ ] **ANNOT-09**: User can assign multiple custom tags to any variant (per-case)
- [ ] **ANNOT-10**: User can manage tags (rename, delete, recolor) in a settings view
- [ ] **ANNOT-11**: User can filter variant table by star/flag status, ACMG classification, and custom tags
- [x] **ANNOT-12**: Annotations are preserved when database is closed and reopened
- [x] **ANNOT-13**: Deleting a case cascades deletion of that case's per-case annotations

### Variant Details Panel

- [ ] **PANEL-01**: User can click a variant row to open a details side panel (right drawer)
- [ ] **PANEL-02**: Side panel displays all annotation scores from the database (CADD, REVEL, SpliceAI, gnomAD AF, etc.)
- [x] **PANEL-03**: Side panel provides live Ensembl VEP API enrichment for the selected variant (consequence predictions, additional scores)
- [x] **PANEL-04**: VEP API responses are cached in SQLite with configurable TTL to avoid redundant requests
- [ ] **PANEL-05**: Side panel shows external link buttons to PubTator, LitVar, UCSC Genome Browser, Decipher, and Franklin (in addition to existing gnomAD, ClinVar, OMIM)
- [ ] **PANEL-06**: Side panel includes copy-to-clipboard buttons for HGVS notation, chr:pos:ref:alt, and rsID
- [x] **PANEL-07**: When offline, side panel shows database annotations and displays "API enrichment unavailable — offline" message instead of VEP data
- [x] **PANEL-08**: When VEP API returns cached data, side panel shows "Cached data from [date]" indicator
- [x] **PANEL-09**: Side panel shows loading skeleton while VEP API request is in flight
- [x] **PANEL-10**: VEP API requests respect rate limits (max 15 req/sec) with exponential backoff on 429 responses

### Case Metadata

- [ ] **META-01**: User can set affected/unaffected/unknown status for each case
- [ ] **META-02**: User can assign cases to cohort groups with arbitrary user-defined names
- [ ] **META-03**: Cohort group names autocomplete from previously created groups
- [ ] **META-04**: User can create new cohort groups with name and optional description
- [ ] **META-05**: User can assign a case to multiple cohort groups
- [x] **META-06**: User can add HPO phenotype terms to a case via searchable autocomplete (API-powered)
- [x] **META-07**: HPO autocomplete searches by term name, ID, and synonyms
- [ ] **META-08**: User can remove HPO terms from a case
- [ ] **META-09**: Case metadata (status, cohorts, HPO terms) displays in the case list and case header
- [x] **META-10**: When HPO API is unavailable (offline), user sees "HPO search unavailable — offline" message
- [ ] **META-11**: Deleting a case cascades deletion of its metadata, cohort links, and phenotype associations

### Infrastructure

- [x] **INFRA-01**: New annotation tables created automatically when opening existing databases (schema migration)
- [x] **INFRA-02**: Schema migration works correctly on SQLCipher-encrypted databases
- [x] **INFRA-03**: All API calls (VEP, HPO) are proxied through Electron main process (not renderer)
- [x] **INFRA-04**: App detects online/offline status and adjusts API feature availability accordingly
- [ ] **INFRA-05**: External link domains (PubTator, LitVar, UCSC, Decipher, Franklin, HPO browser) added to shell.openExternal allowlist
- [x] **INFRA-06**: All user-entered data (comments, tags, HPO terms) uses parameterized SQL queries (no injection risk)

## Future Requirements

Deferred to v0.5+ milestones. Tracked but not in current roadmap.

### Advanced Classification

- **CLASS-01**: Automated ACMG classification engine with evidence criteria evaluation
- **CLASS-02**: ACMG criteria tracking with 28 individual criteria checkboxes and rule logic
- **CLASS-03**: Gene-specific ACMG criteria specifications (ClinGen rule sets)

### Advanced Phenotype Analysis

- **PHENO-01**: HPO-based variant prioritization (Exomiser-style phenotype similarity scoring)
- **PHENO-02**: Interactive HPO ontology tree browser
- **PHENO-03**: Cross-case phenotype similarity search
- **PHENO-04**: Bundled offline HPO ontology for zero-API phenotype search

### Annotation Export

- **EXPORT-01**: Export annotations as ClinVar submission format
- **EXPORT-02**: Annotation history/audit trail with full change tracking
- **EXPORT-03**: Batch tag/classification operations across multiple variants

### Advanced Analysis

- **ANALYSIS-01**: Pedigree information and trio analysis (de novo, compound het)
- **ANALYSIS-02**: Virtual gene panels for targeted variant filtering
- **ANALYSIS-03**: Statistics dashboard with variant summary metrics

## Out of Scope

| Feature | Reason |
|---------|--------|
| Automated ACMG classification engine | High complexity, requires live data feeds, gene-specific rules, and continuous maintenance; users manually classify |
| Real-time collaborative annotation | Violates offline-first architecture, requires server backend; Varlens targets sequential single-user use |
| Built-in Exomiser/phenotype prioritization | 10GB+ data, Java runtime, 2-5 min per case; export HPO terms for external Exomiser use instead |
| In-app ACMG criteria editor (28 checkboxes) | Very high complexity; 5-tier dropdown + free-text rationale sufficient for v0.4.0 |
| VEP local install | 60GB+ cache, Perl dependencies; REST API is simpler and always current |
| Interactive HPO tree browser | 16k terms, complex tree UI, marginal value; search autocomplete suffices |
| Import ClinVar RCV classifications | Requires ClinVar data feed integration; manual classification sufficient for offline use |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ANNOT-01 | Phase 20 | Complete |
| ANNOT-02 | Phase 20 | Complete |
| ANNOT-03 | Phase 20 | Complete |
| ANNOT-04 | Phase 20 | Complete |
| ANNOT-05 | Phase 20 | Complete |
| ANNOT-06 | Phase 20 | Complete |
| ANNOT-07 | Phase 20 | Complete |
| ANNOT-08 | Phase 24 | Pending |
| ANNOT-09 | Phase 24 | Pending |
| ANNOT-10 | Phase 24 | Pending |
| ANNOT-11 | Phase 24 | Pending |
| ANNOT-12 | Phase 20 | Complete |
| ANNOT-13 | Phase 20 | Complete |
| PANEL-01 | Phase 23 | Pending |
| PANEL-02 | Phase 23 | Pending |
| PANEL-03 | Phase 21 | Complete |
| PANEL-04 | Phase 21 | Complete |
| PANEL-05 | Phase 23 | Pending |
| PANEL-06 | Phase 23 | Pending |
| PANEL-07 | Phase 21 | Complete |
| PANEL-08 | Phase 21 | Complete |
| PANEL-09 | Phase 21 | Complete |
| PANEL-10 | Phase 21 | Complete |
| META-01 | Phase 22 | Pending |
| META-02 | Phase 22 | Pending |
| META-03 | Phase 22 | Pending |
| META-04 | Phase 22 | Pending |
| META-05 | Phase 22 | Pending |
| META-06 | Phase 21 | Complete |
| META-07 | Phase 21 | Complete |
| META-08 | Phase 22 | Pending |
| META-09 | Phase 22 | Pending |
| META-10 | Phase 21 | Complete |
| META-11 | Phase 22 | Pending |
| INFRA-01 | Phase 19 | Complete |
| INFRA-02 | Phase 19 | Complete |
| INFRA-03 | Phase 21 | Complete |
| INFRA-04 | Phase 21 | Complete |
| INFRA-05 | Phase 23 | Pending |
| INFRA-06 | Phase 19 | Complete |

**Coverage:**
- v0.4.0 requirements: 40 total
- Mapped to phases: 40/40 (100%)
- Unmapped: 0

**Requirement Distribution:**
- Phase 19 (Database Foundation): 3 requirements (INFRA-01, INFRA-02, INFRA-06)
- Phase 20 (Annotation Core): 9 requirements (ANNOT-01 to ANNOT-07, ANNOT-12, ANNOT-13)
- Phase 21 (API Service Layer): 11 requirements (PANEL-03, PANEL-04, PANEL-07, PANEL-08, PANEL-09, PANEL-10, META-10, INFRA-03, INFRA-04)
- Phase 22 (Case Metadata): 8 requirements (META-01 to META-05, META-08, META-09, META-11)
- Phase 23 (Side Panel UI): 7 requirements (PANEL-01, PANEL-02, PANEL-05, PANEL-06, ANNOT-03, ANNOT-04, ANNOT-07, INFRA-05)
- Phase 24 (Custom Tags + HPO Autocomplete): 6 requirements (ANNOT-08 to ANNOT-11, META-06, META-07)

---
*Requirements defined: 2026-01-28*
*Last updated: 2026-01-28 — Phase 20 requirements marked complete*
