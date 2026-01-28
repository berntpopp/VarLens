# Requirements: Varlens v0.4.0

**Defined:** 2026-01-28
**Core Value:** External collaborators can analyze variant data offline with data-dense UX for research use

## v0.4.0 Requirements

Requirements for v0.4.0 — Variant Annotation & Case Metadata. Each maps to roadmap phases.

### Annotation Storage

- [ ] **ANNOT-01**: User can add a global comment to any variant (persists across all cases containing that variant)
- [ ] **ANNOT-02**: User can add a per-case comment to a variant (specific to one case's context)
- [ ] **ANNOT-03**: User can edit and delete existing comments (global and per-case)
- [ ] **ANNOT-04**: All comments display creation and last-updated timestamps
- [ ] **ANNOT-05**: User can star/flag a variant to mark it as interesting (toggle on/off)
- [ ] **ANNOT-06**: User can assign ACMG 5-tier classification to a variant (Pathogenic, Likely Pathogenic, VUS, Likely Benign, Benign)
- [ ] **ANNOT-07**: ACMG classification displays with color-coded badges in variant table rows
- [ ] **ANNOT-08**: User can create custom tags with name and color
- [ ] **ANNOT-09**: User can assign multiple custom tags to any variant (per-case)
- [ ] **ANNOT-10**: User can manage tags (rename, delete, recolor) in a settings view
- [ ] **ANNOT-11**: User can filter variant table by star/flag status, ACMG classification, and custom tags
- [ ] **ANNOT-12**: Annotations are preserved when database is closed and reopened
- [ ] **ANNOT-13**: Deleting a case cascades deletion of that case's per-case annotations

### Variant Details Panel

- [ ] **PANEL-01**: User can click a variant row to open a details side panel (right drawer)
- [ ] **PANEL-02**: Side panel displays all annotation scores from the database (CADD, REVEL, SpliceAI, gnomAD AF, etc.)
- [ ] **PANEL-03**: Side panel provides live Ensembl VEP API enrichment for the selected variant (consequence predictions, additional scores)
- [ ] **PANEL-04**: VEP API responses are cached in SQLite with configurable TTL to avoid redundant requests
- [ ] **PANEL-05**: Side panel shows external link buttons to PubTator, LitVar, UCSC Genome Browser, Decipher, and Franklin (in addition to existing gnomAD, ClinVar, OMIM)
- [ ] **PANEL-06**: Side panel includes copy-to-clipboard buttons for HGVS notation, chr:pos:ref:alt, and rsID
- [ ] **PANEL-07**: When offline, side panel shows database annotations and displays "API enrichment unavailable — offline" message instead of VEP data
- [ ] **PANEL-08**: When VEP API returns cached data, side panel shows "Cached data from [date]" indicator
- [ ] **PANEL-09**: Side panel shows loading skeleton while VEP API request is in flight
- [ ] **PANEL-10**: VEP API requests respect rate limits (max 15 req/sec) with exponential backoff on 429 responses

### Case Metadata

- [ ] **META-01**: User can set affected/unaffected/unknown status for each case
- [ ] **META-02**: User can assign cases to cohort groups with arbitrary user-defined names
- [ ] **META-03**: Cohort group names autocomplete from previously created groups
- [ ] **META-04**: User can create new cohort groups with name and optional description
- [ ] **META-05**: User can assign a case to multiple cohort groups
- [ ] **META-06**: User can add HPO phenotype terms to a case via searchable autocomplete (API-powered)
- [ ] **META-07**: HPO autocomplete searches by term name, ID, and synonyms
- [ ] **META-08**: User can remove HPO terms from a case
- [ ] **META-09**: Case metadata (status, cohorts, HPO terms) displays in the case list and case header
- [ ] **META-10**: When HPO API is unavailable (offline), user sees "HPO search unavailable — offline" message
- [ ] **META-11**: Deleting a case cascades deletion of its metadata, cohort links, and phenotype associations

### Infrastructure

- [ ] **INFRA-01**: New annotation tables created automatically when opening existing databases (schema migration)
- [ ] **INFRA-02**: Schema migration works correctly on SQLCipher-encrypted databases
- [ ] **INFRA-03**: All API calls (VEP, HPO) are proxied through Electron main process (not renderer)
- [ ] **INFRA-04**: App detects online/offline status and adjusts API feature availability accordingly
- [ ] **INFRA-05**: External link domains (PubTator, LitVar, UCSC, Decipher, Franklin, HPO browser) added to shell.openExternal allowlist
- [ ] **INFRA-06**: All user-entered data (comments, tags, HPO terms) uses parameterized SQL queries (no injection risk)

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
| ANNOT-01 | Phase 19-20 | Pending |
| ANNOT-02 | Phase 19-20 | Pending |
| ANNOT-03 | Phase 19-20 | Pending |
| ANNOT-04 | Phase 19-20 | Pending |
| ANNOT-05 | Phase 19-20 | Pending |
| ANNOT-06 | Phase 19-20 | Pending |
| ANNOT-07 | Phase 19-20 | Pending |
| ANNOT-08 | Phase 19-20 | Pending |
| ANNOT-09 | Phase 19-20 | Pending |
| ANNOT-10 | Phase 19-20 | Pending |
| ANNOT-11 | Phase 19-20 | Pending |
| ANNOT-12 | Phase 19-20 | Pending |
| ANNOT-13 | Phase 19-20 | Pending |
| PANEL-01 | Phase 19-20 | Pending |
| PANEL-02 | Phase 19-20 | Pending |
| PANEL-03 | Phase 19-20 | Pending |
| PANEL-04 | Phase 19-20 | Pending |
| PANEL-05 | Phase 19-20 | Pending |
| PANEL-06 | Phase 19-20 | Pending |
| PANEL-07 | Phase 19-20 | Pending |
| PANEL-08 | Phase 19-20 | Pending |
| PANEL-09 | Phase 19-20 | Pending |
| PANEL-10 | Phase 19-20 | Pending |
| META-01 | Phase 19-20 | Pending |
| META-02 | Phase 19-20 | Pending |
| META-03 | Phase 19-20 | Pending |
| META-04 | Phase 19-20 | Pending |
| META-05 | Phase 19-20 | Pending |
| META-06 | Phase 19-20 | Pending |
| META-07 | Phase 19-20 | Pending |
| META-08 | Phase 19-20 | Pending |
| META-09 | Phase 19-20 | Pending |
| META-10 | Phase 19-20 | Pending |
| META-11 | Phase 19-20 | Pending |
| INFRA-01 | Phase 19-20 | Pending |
| INFRA-02 | Phase 19-20 | Pending |
| INFRA-03 | Phase 19-20 | Pending |
| INFRA-04 | Phase 19-20 | Pending |
| INFRA-05 | Phase 19-20 | Pending |
| INFRA-06 | Phase 19-20 | Pending |

**Coverage:**
- v0.4.0 requirements: 40 total
- Mapped to phases: 0 (awaiting roadmap)
- Unmapped: 40 ⚠️

---
*Requirements defined: 2026-01-28*
*Last updated: 2026-01-28 after initial definition*
