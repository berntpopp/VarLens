# Feature Research: Variant Annotation & Case Metadata

**Domain:** Variant annotation, ACMG classification, enrichment, case metadata
**Researched:** 2026-01-28
**Applies to:** v0.4.0 milestone
**Confidence:** HIGH

---

## Executive Summary

This research examined how variant annotation workflows, ACMG classification, variant detail enrichment, and case metadata typically work in genetics analysis tools. Key tools analyzed include VarSeq (Golden Helix), Illumina Emedgene, Fabric Genomics, MOON (Diploid/Invitae), VarSome, ClinGen, PhenoTips, and Exomiser.

**Core findings:**
1. **Variant comments/notes** must support both global (all cases) and per-case contexts with timestamps
2. **ACMG 5-tier classification** is table stakes (Benign, Likely Benign, VUS, Likely Pathogenic, Pathogenic)
3. **Star/flag marking** is universal for "interesting" variant tagging
4. **Custom user-defined tags** enable flexible filtering and organization
5. **Side panel enrichment** aggregates external API data (VEP, ClinVar, literature)
6. **HPO phenotype terms** drive AI-powered variant prioritization (Exomiser, MOON achieve 94% top-3 ranking)
7. **Offline-first with graceful degradation** is a differentiator for Varlens' use case

---

## Feature Landscape

### Table Stakes (Users Expect These)

These features are present in all modern variant analysis tools. Missing any of these makes Varlens feel incomplete or unprofessional.

#### 1. Variant Comments/Notes

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|--------------|------------|------------|-------|
| Global variant comments | Every curation tool (ClinGen VCI, VarSome Clinical, Fabric) supports annotating variants with free-text notes | Medium | New `variant_annotations` table with (variant_id, comment_type, text, timestamp, user) | Comments apply to ALL cases containing this variant. Keyed by chr+pos+ref+alt. Used for sharing knowledge across analysis team |
| Per-case variant comments | Essential for case-specific observations that shouldn't propagate globally. VarSeq and ICA separate global vs case-specific notes | Medium | New `case_variant_annotations` table with (case_id, variant_id, text, timestamp) | Comments apply to one case only. Used for "this variant is de novo in this proband" or "segregates with phenotype in family 123" |
| Timestamps on all comments | Audit trail requirement. ClinGen VCI maintains complete audit trail for FDA compliance | Low | SQLite datetime field | ISO 8601 format timestamps. Display as relative time ("2 days ago") in UI |
| Comment authorship | Multi-user tools track who wrote each comment. Varlens is single-user, but may be used by different people sequentially | Low | `author` field (optional) | Could prompt for name on first use, store in app config. Or defer if single-user assumption holds |
| Comment edit/delete | Users need to correct mistakes. VarSome and Fabric both allow editing existing comments | Medium | Update/delete SQL operations | Must preserve audit trail (either version history or "edited at" timestamp) |
| Comment search/filter | Users need to find "all variants I commented on" or search within comment text | Medium | FTS5 on comment text | Add comment text to FTS5 search, or filter variants by "has comment" flag |

#### 2. ACMG Classification

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|--------------|------------|------------|-------|
| 5-tier classification system | ACMG 2015 guidelines define 5 categories: Benign, Likely Benign, VUS (Uncertain Significance), Likely Pathogenic, Pathogenic. Universal standard | Low | Add `acmg_classification` enum field to variant_annotations table | Store as integer 1-5 or text enum. Display with color coding (green/yellow/red scale) |
| Per-case classification override | Global classification may differ from case-specific context (e.g., variant is pathogenic for cardiomyopathy but benign for this patient's phenotype). VarSome Clinical supports this | Medium | Add `acmg_classification` to both global and case-specific tables | Case-specific classification overrides global when present |
| Classification timestamps | Track when classification was assigned and by whom. Required for regulatory compliance | Low | `classified_at` timestamp field | ISO 8601 timestamp. Display age of classification |
| Classification filter | Essential for triaging. "Show me all Pathogenic + Likely Pathogenic variants" | Low | WHERE clause on acmg_classification | Dropdown filter in variant table. Multi-select: "P + LP" vs "P + LP + VUS" |
| Visual classification indicators | Color-coded badges or chips in variant table. Red = P/LP, yellow = VUS, green = B/LB. Universal UX pattern | Low | Vuetify v-chip with color prop | Use Vuetify's color system. Must be colorblind-friendly (use icons + color) |
| ACMG criteria documentation | Advanced feature: track which ACMG criteria (PVS1, PS1-4, PM1-6, PP1-5, BA1, BS1-4, BP1-7) support classification | High | Separate `acmg_criteria` table with many-to-many relationship | Defer to v0.4.1+ unless users request. ClinGen VCI has full criteria tracking. Complex UI |

**ACMG Classification Details:**
- **Criteria weights:** PVS (very strong) = 8 points, PS (strong) = 4, PM (moderate) = 2, PP (supporting) = 1. Combine using Bayesian points system.
- **Gene-specific refinements:** ClinGen has published gene-specific ACMG criteria specifications (PALB2, RASopathy genes, etc.). Varlens stores pre-computed classifications; criteria refinement is upstream.
- **Automation:** VarSome Clinical, Fabric ACE, and Emedgene offer AI-powered ACMG classification. Varlens is offline-first; automated classification must come from import pipeline, not live API.

#### 3. Star/Flag Marking

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|--------------|------------|------------|-------|
| Star/flag toggle per variant | Universal "mark as interesting" feature. Every tool (VarSeq, ICA, Fabric) has star/flag/bookmark. Used for "candidate causal variant" or "follow-up needed" | Low | Add `is_starred` boolean to variant_annotations | Click to toggle. Display star icon when true. Filter: "show only starred" |
| Per-case flag override | Some tools support global flags + per-case flags. Enables "starred in this case but not others" | Medium | Add `is_starred` to case_variant_annotations | If case-specific flag exists, it overrides global flag for that case |
| Flag filter | Essential for triaging. "Show me my starred variants" | Low | WHERE clause on is_starred | Checkbox filter in variant table |
| Flag count indicator | Show "3 variants flagged" in summary stats | Low | COUNT query | Display in case header or cohort summary |

#### 4. Custom User-Defined Tags

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|--------------|------------|------------|-------|
| Free-form tags on variants | VarSeq, Slivar, and VarAFT support custom labels/tags. Users create arbitrary tags: "candidate", "de-novo", "compound-het", "review-with-clinician" | Medium | New `variant_tags` table with (variant_id, tag_name, created_at) | Many-to-many relationship. Store tags as strings, not enums (user-defined) |
| Tag autocomplete | Suggest existing tags when typing new tag. Prevents "de novo" vs "de-novo" vs "denovo" fragmentation | Medium | Query distinct tags from variant_tags table | Use Vuetify v-combobox with autocomplete |
| Tag filtering | Essential for organization. "Show all variants tagged 'compound-het'" | Medium | JOIN on variant_tags table | Multi-select tag filter in variant table |
| Tag colors | Optional visual enhancement. Assign colors to frequently used tags | Low | Add `color` field to tags | Store hex color or Vuetify color name |
| Tag management UI | Users need to rename/delete tags globally. "Rename all 'de novo' to 'de-novo'" | Medium | Update/delete operations on variant_tags | Settings page: list all tags, rename/delete/recolor |
| Per-case vs global tags | Some tools distinguish global tags (this variant in all cases) vs case-specific tags | High | Separate case_variant_tags table | Defer unless user research shows need. Start with global tags only |

#### 5. Variant Details Side Panel

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|--------------|------------|------------|-------|
| Expanded view showing all annotations | Every tool (VarSeq, VarSome, Fabric) has a detail panel/page with full annotation set. Main table shows summary; panel shows everything | Medium | New VariantDetailPanel component | Slide-out drawer (v-navigation-drawer) or dialog. Triggered by row click or expand icon |
| All database scores displayed | Show CADD, REVEL, SIFT, PolyPhen, SpliceAI, etc. Main table space is limited; detail panel can show 20+ scores | Low | Existing annotation fields | Display as labeled values or table. Group by type (pathogenicity, conservation, splicing) |
| Gene/transcript information | Ensembl gene ID, transcript ID, HGVS notation (c. and p.), exon number, domain information | Low | Existing annotation fields | Display as collapsible sections |
| Population frequencies | gnomAD v3/v4, ExAC, 1000 Genomes, ESP. Show all subpopulations (AFR, AMR, EAS, NFE, SAS) | Low | Existing annotation fields | Display as table with population labels |
| Clinical significance | ClinVar classification, review status, condition, submission count | Low | Existing ClinVar fields | Parse ClinVar classification from import data. Display with interpretation guidance |
| External database links | Links to gnomAD, ClinVar, ClinGen, OMIM, UCSC, Ensembl, Decipher, Franklin, MyGene.info | Low | Existing chr/pos/ref/alt/gene fields | Reuse external link patterns from v0.3.0. Add new targets |
| Copy-to-clipboard buttons | Users need to copy HGVS notation, chr:pos:ref:alt, rsID for external searches | Low | Navigator clipboard API | Small icon buttons next to copiable fields |

#### 6. Live API Enrichment (with Offline Graceful Degradation)

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|--------------|------------|------------|-------|
| Ensembl VEP API integration | VEP is THE standard variant annotation engine. 140+ data sources, updated quarterly. VarSome, Fabric, and ICA all integrate VEP | High | Ensembl VEP REST API | Fetch `/vep/human/hgvs/{hgvs}` or `/vep/human/region/{chr}:{pos}-{pos}:{strand}/{allele}`. Returns JSON with consequences, SIFT, PolyPhen, gnomAD AF, ClinVar |
| Offline detection | Check network connectivity before API calls. Don't hang UI on network timeouts | Low | `navigator.onLine` + fetch timeout | Show "Offline" indicator if network unavailable |
| Cached API responses | Don't re-fetch VEP data for same variant. Cache responses in SQLite or memory | Medium | New `api_cache` table or in-memory Map | TTL: 7 days for VEP. Shorter for rapidly updating sources |
| Graceful failure UI | If API fails (offline, rate limit, server error), show existing database annotations instead of blank panel | Medium | Error handling in API service | Display: "Showing database annotations (offline)" or "Live enrichment unavailable" |
| Rate limiting | Ensembl VEP REST API has rate limits: 15 req/sec (anonymous). Batch requests where possible | Medium | Queue with delay | Use p-queue or custom throttling |
| Literature links (PubMed/LitVar) | LitVar provides links to PubMed articles mentioning variants. VarSome Clinical and Fabric integrate literature search | Medium | LitVar API or direct PubMed search URL | LitVar query: `/api/v1/variant/rs{rsID}` returns PMIDs. Or construct PubMed search URL: `https://pubmed.ncbi.nlm.nih.gov/?term={chr}+{pos}+{gene}` |

**API Prioritization:**
1. **Ensembl VEP** (highest priority): Most comprehensive, widely used
2. **LitVar/PubMed** (medium priority): Literature search is high-value for clinicians
3. **ClinVar live** (low priority): Import data already has ClinVar; live fetch only needed for recent updates

#### 7. Case Metadata

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|--------------|------------|------------|-------|
| Affected/unaffected status | Standard case metadata. Required for trio analysis, segregation analysis, cohort stratification. Genomics England IVA, Blueprint Genetics trio analysis use this | Low | Add `affected_status` enum to cases table | Values: "affected", "unaffected", "unknown". Default "unknown". Filter cohort by status |
| Cohort group assignment | Users organize cases into arbitrary cohorts: "control group", "cardiomyopathy patients", "family 456". VarSeq and ICA support cohort/batch grouping | Medium | Add `cohort_groups` text array to cases table (JSON) | Store as JSON array of strings. Supports multiple group memberships. Autocomplete from existing groups |
| HPO phenotype terms | HPO (Human Phenotype Ontology) is THE standard for phenotype annotation. Exomiser, MOON, LIRICAL, Face2Gene all use HPO for variant prioritization | High | New `case_phenotypes` table with (case_id, hpo_id, hpo_label, added_at) | Many-to-many relationship. HPO IDs like "HP:0001250" (Seizures). Requires HPO API or bundled ontology |
| HPO term search with autocomplete | Users shouldn't memorize HPO IDs. PhenoTips provides searchable HPO tree. Type "seizure" → suggests "Seizure (HP:0001250)" | High | HPO API or bundled HPO JSON | Use OLS (Ontology Lookup Service) API or EBI HPO browser API. Fallback: ship JSON with ~16k HPO terms |
| HPO-based variant prioritization | Exomiser scores variants based on phenotype similarity. With HPO terms, 74% top-1 accuracy. Without HPO, only 3%. Game-changer for prioritization | Very High | Exomiser integration or phenotype similarity API | **Defer to v0.5+**: Complex. Requires gene-phenotype database, semantic similarity scoring. Could integrate Exomiser as external tool |
| Pedigree information | Family relationships (mother, father, siblings) for trio/family analysis. Blueprint Genetics and Amplexa trio analysis use PED format | High | New pedigree schema | **Defer to v0.4.1+**: Complex. Need father_id, mother_id, sex, proband flag. Essential for de novo and compound het filtering |

**HPO Implementation Options:**
- **Option 1 (Recommended for MVP):** Bundle static HPO JSON (16k terms, ~4MB compressed). Autocomplete from local data. Offline-first.
- **Option 2 (Online):** Use EBI OLS API (`https://www.ebi.ac.uk/ols4/api/search?q={query}&ontology=hp`). Fast, always current. Requires network.
- **Option 3 (Hybrid):** Ship bundled HPO, optionally sync from API when online. Best UX, most complex.

---

### Differentiators (Competitive Advantage)

Features that set Varlens apart from competitors. Not expected in every tool, but add significant value for offline external collaborator use case.

| Feature | Value Proposition | Complexity | Depends On | Notes |
|---------|-------------------|------------|------------|-------|
| Full offline HPO phenotype search | PhenoTips and most tools require internet for HPO autocomplete. Varlens can ship with bundled HPO ontology for true offline operation | Medium | Bundled HPO JSON (hpo.json from OBO files) | **Differentiator:** External collaborators work offline. Bundle 16k HPO terms as JSON. 4MB compressed, negligible size |
| Variant annotation history/audit trail | Track every classification change, comment edit, tag addition with full history. ClinGen VCI does this for regulatory compliance, but most tools don't | High | Audit table with (entity_type, entity_id, action, old_value, new_value, timestamp) | **Differentiator:** Useful for research reproducibility. "When did we classify this as Pathogenic?" |
| Global + per-case annotation duality | Many tools force choice: global annotations OR case-specific. Varlens supports BOTH with clear inheritance and override | Medium | Two annotation tables with fallback logic | **Differentiator:** Cohort use case demands global knowledge sharing + case-specific observations |
| Offline-first API enrichment | Most tools break without internet (VarSome, Fabric, ICA are web apps). Varlens degrades gracefully: database annotations always shown, API adds bonus data when online | Medium | Offline detection + cache + fallback UI | **Differentiator:** External collaborators have unreliable internet. Show database annotations first, enrich with API when available |
| Encrypted annotations at rest | Comments and classifications contain sensitive interpretations. SQLCipher encryption (v0.3.0) extends to annotation tables automatically | Low (inherit from v0.3.0) | SQLCipher database | **Differentiator:** Security story. "Your clinical interpretations are encrypted" |
| Tag-based batch operations | Select all variants with tag "candidate" → bulk classify as "Likely Pathogenic" → bulk add comment. Power-user feature | High | Multi-select + batch update UI | **Differentiator:** Efficiency for large variant sets. Defer to v0.4.1+ unless user demand |
| Cross-case phenotype similarity | "Find other cases with similar HPO profiles to this case". Uses semantic similarity (Exomiser/Phenomizer algorithms) | Very High | HPO semantic similarity computation | **Defer to v0.5+:** Research-grade feature. Would be unique in offline tools |

---

### Anti-Features (Commonly Requested, Often Problematic)

Features to explicitly NOT build in v0.4.0. Common mistakes in this domain that would add complexity without proportional value.

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| Automated ACMG classification engine | Users want "auto-classify variants as Pathogenic/Benign". VarSome Clinical, Fabric ACE, Emedgene offer this | **Complex + requires live data:** ACMG rules need population frequencies (gnomAD), functional evidence (ClinVar), in silico predictions (SIFT/PolyPhen), segregation data. Rules are gene-specific (ClinGen publishes 50+ gene-specific specs). Offline tool can't access live ClinVar/gnomAD updates. User expectations: "why did auto-classifier call this Benign when ClinVar says Pathogenic?" → constant support burden | Import pipeline should include pre-computed ACMG classifications. Varlens displays and allows manual override. Document: "For automated classification, use upstream annotation pipeline (OpenCRAVAT, VEP, ClinVar Miner)" |
| Interactive HPO ontology tree browser | Users want to explore HPO hierarchy visually (parent/child terms, branches). PhenoTips has tree view | **Complex UI + marginal value:** HPO has 16k terms in deep hierarchy. Tree view requires recursive rendering, expand/collapse state management. Most users just search for known terms ("seizure", "developmental delay"). Clinicians don't explore ontology; they search for patient symptoms | Provide search with autocomplete. Display full HPO label + ID. Link to HPO browser online (`https://hpo.jax.org/browse/term/{hpo_id}`) for users who want to explore |
| Real-time collaborative annotation | Users want "multiple analysts annotating variants simultaneously, seeing each other's changes live". Google Docs for variants | **Violates offline-first architecture:** Requires websockets, server backend, conflict resolution, network dependency. SQLite is single-writer. Varlens targets individual analysts or sequential use, not simultaneous collaboration | Share database files. Export annotations as JSON. Document: "For multi-user real-time collaboration, use web-based tools (Fabric Genomics, VarSome Clinical)" |
| Built-in Exomiser/phenotype prioritization | Users want "press button, Exomiser re-ranks variants using HPO terms". MOON does this in minutes | **Massive dependency + performance:** Exomiser requires 10GB+ data files (gene-phenotype associations, pathway databases, mouse/zebrafish models), Java runtime, 2-5 min computation time per case. Doesn't fit offline-first lightweight Electron app model | HPO terms in case metadata enable EXPORT to Exomiser. Add "Export case as Exomiser input" feature (VCF + phenopacket). User runs Exomiser externally, imports results. Or: document how to use Exomiser web service with exported data |
| Variant curation workflow with multi-level review | Users want "Analyst → Senior Analyst → Clinical Director approval chain". ClinGen VCI supports review workflow | **Requires user/role management:** Need user accounts, permissions, review status state machine, notification system. Varlens is single-user offline tool. Over-engineered for target use case | Use comment system + ACMG classification + audit trail. Senior analyst reviews by reading comments and checking classification history. If institutional workflow needed, export annotations to LIMS |
| GenBank/RefSeq transcript selector | Users want to choose which transcript to display (MANE Select, longest, canonical). Ensembl VEP supports transcript selection | **Complexity + import dependency:** Variant annotation already happened upstream (import pipeline). Transcript choice determines HGVS notation, consequence, exon number. Switching transcript in Varlens would require re-annotation. Most users trust annotation pipeline's transcript choice (usually MANE Select or canonical) | Display transcript ID from import data. If multiple transcripts annotated, show primary + "N other transcripts" with expand. Don't support re-annotation |
| In-app ACMG criteria specification editor | Users want to click checkboxes for PVS1, PS1-4, PM1-6, PP1-5 criteria and see classification computed. ClinGen VCI has full criteria UI | **High complexity + maintenance burden:** 28 criteria with complex rules (some gene-specific, some strength-adjustable). ClinGen publishes updates quarterly. UI would need 28 input fields, rule logic, gene-specific overrides, validation. Most users classify based on overall evidence, not criteria-by-criteria | Provide 5-tier classification dropdown. Add optional free-text "Classification rationale" comment field. Link to ClinGen ACMG guidelines. Power users can document criteria in comments ("PVS1 + PM2 + PP3 → LP") |

---

## Feature Dependencies

```
Variant Annotation Core:
  variant_annotations table (global) --> Comments
                                      --> ACMG classification
                                      --> Star/flag
                                      --> Timestamps
  case_variant_annotations table (per-case) --> Override global annotations

Custom Tags:
  variant_tags table --> Tag autocomplete
                     --> Tag filtering
                     --> Tag management UI
  Depends on: variant_annotations for linking

Variant Detail Panel:
  Database annotations --> Always available (offline)
  API enrichment layer --> VEP, LitVar, live ClinVar
                       --> Cached responses
                       --> Graceful offline fallback
  External links --> Reuse v0.3.0 URL templates
                 --> Add new targets (Decipher, Franklin, MyGene.info)

Case Metadata:
  cases table extensions --> affected_status enum
                         --> cohort_groups JSON array
  case_phenotypes table --> HPO ID + label
                        --> Many-to-many with cases
  HPO autocomplete --> Bundled HPO JSON (offline)
                   --> OR OLS/EBI API (online)
  Depends on: case_id foreign key

API Enrichment Stack:
  Network detection --> navigator.onLine
  API service layer --> VEP, LitVar, HPO OLS
  Cache layer --> api_cache table or in-memory Map
  Fallback UI --> Show database annotations if API unavailable

Filtering Integration:
  ACMG classification filter --> Existing filter chain
  Tag filter --> Existing filter chain
  HPO-based ranking --> FUTURE: Requires Exomiser integration (v0.5+)
```

---

## MVP Definition for v0.4.0

### Launch With (v0.4.0 MVP)

**Core annotation features (table stakes):**
1. Global variant comments (free text, timestamps)
2. Per-case variant comments (with fallback to global)
3. ACMG 5-tier classification (global + per-case)
4. Star/flag marking (global + per-case)
5. Classification + star filters in variant table
6. Comment search/filter

**Variant detail panel:**
7. Side panel showing all database annotations
8. External link buttons (gnomAD, ClinVar, OMIM, UCSC, Ensembl, Decipher, Franklin)
9. Copy-to-clipboard for HGVS, chr:pos, rsID

**Case metadata (phase 1):**
10. Affected/unaffected status per case
11. Cohort group assignment (free-form text array with autocomplete)
12. Display metadata in case list and case header

**Offline-first infrastructure:**
13. Offline detection (navigator.onLine)
14. "Offline mode" indicator in UI

### Add After Validation (v0.4.1)

**Custom tags:**
- User-defined tags on variants
- Tag autocomplete from existing tags
- Tag filtering
- Tag management UI (rename/delete/color)

**API enrichment:**
- Ensembl VEP API integration (fetch live annotations)
- API response caching (7-day TTL)
- Rate limiting for VEP API
- Graceful fallback: database annotations shown if API fails

**HPO phenotypes (basic):**
- Bundled HPO JSON (16k terms)
- HPO term search with autocomplete
- Assign HPO terms to cases (case_phenotypes table)
- Display HPO terms in case metadata

**Literature links:**
- LitVar integration (PubMed articles mentioning variant)
- PubMed search URL construction

### Future Consideration (v0.5+)

**Advanced features (defer unless user demand):**
- ACMG criteria tracking (28 criteria checkboxes, rule logic)
- Variant annotation history/audit trail (full change tracking)
- Tag-based batch operations (bulk classify, bulk comment)
- Pedigree information (trio analysis, de novo/compound het)
- HPO-based variant prioritization (Exomiser integration or phenotype similarity scoring)
- Cross-case phenotype similarity search
- Export annotations as ClinVar submission format
- Import ClinVar RCV data to populate classifications

---

## Feature Prioritization Matrix

| Feature | User Value | Complexity | Offline Feasibility | v0.4.0 Priority |
|---------|------------|------------|---------------------|-----------------|
| Global variant comments | HIGH | Medium | Full | **MUST SHIP** |
| Per-case comments | HIGH | Medium | Full | **MUST SHIP** |
| ACMG 5-tier classification | HIGH | Low | Full | **MUST SHIP** |
| Star/flag marking | HIGH | Low | Full | **MUST SHIP** |
| Variant detail panel (DB annotations) | HIGH | Medium | Full | **MUST SHIP** |
| External links (expanded set) | MEDIUM | Low | Partial (link-out requires online) | **MUST SHIP** |
| Affected/unaffected status | MEDIUM | Low | Full | **MUST SHIP** |
| Cohort group assignment | MEDIUM | Medium | Full | **MUST SHIP** |
| Custom user-defined tags | MEDIUM | Medium | Full | **SHOULD SHIP (v0.4.1)** |
| Ensembl VEP API | MEDIUM | High | Partial (graceful fallback) | **SHOULD SHIP (v0.4.1)** |
| HPO phenotype terms | HIGH (research use) | High | Full (with bundled JSON) | **SHOULD SHIP (v0.4.1)** |
| Literature links (LitVar/PubMed) | MEDIUM | Medium | Partial (link-out requires online) | **SHOULD SHIP (v0.4.1)** |
| ACMG criteria tracking | LOW | Very High | Full | **DEFER (v0.5+)** |
| HPO-based variant prioritization | HIGH (research) | Very High | Partial (requires large datasets) | **DEFER (v0.5+)** |
| Pedigree/trio analysis | MEDIUM | High | Full | **DEFER (v0.5+)** |
| Annotation history/audit trail | LOW | High | Full | **DEFER (v0.5+)** |

**Prioritization rationale:**
- **User value:** Based on feature prevalence in analyzed tools (VarSeq, VarSome, Fabric, ICA, MOON)
- **Complexity:** Development + testing + maintenance burden
- **Offline feasibility:** Alignment with Varlens' offline-first architecture
- **v0.4.0 priority:** Must ship (table stakes), Should ship (high value), Defer (nice-to-have or complex)

---

## Competitor Feature Analysis

### VarSeq (Golden Helix)

**Strengths:**
- VSClinical guided workflow for ACMG classification with auto-classifier algorithm
- Sophisticated filtering and annotation chains (can define complex workflows)
- Supports saving workflow templates for high-throughput labs
- Gene panels and custom templates

**Weaknesses:**
- Desktop app, but not offline-first (requires license server)
- No built-in HPO phenotype management
- Expensive ($5k+ per seat)

**Varlens can differentiate by:** Fully offline operation with encrypted database, free/open-source, HPO phenotype integration

### VarSome Clinical

**Strengths:**
- 140+ data source integration (massive knowledge base)
- Semi-automated ACMG classification with evidence display
- Custom transcripts and local population databases
- Phenotype-driven prioritization (VarSome Picks)
- CE-IVDR Class C certified (regulatory compliance)

**Weaknesses:**
- Web-based, requires internet (cannot work offline)
- Subscription pricing (not accessible to small labs or external collaborators)
- Overkill for pre-filtered data analysis

**Varlens can differentiate by:** Offline-first for pre-filtered data, no subscription, simpler UX for focused use case

### Fabric Genomics (Fabric Enterprise / Fabric Clinical)

**Strengths:**
- ACE AI classification engine (automated, explainable)
- End-to-end platform (alignment → annotation → reporting)
- Physician-ready reports in <2 hours for WGS
- FHIR integration for EHR connectivity

**Weaknesses:**
- Cloud-based, requires internet
- Enterprise pricing (not accessible to individual researchers)
- Complex platform (steep learning curve)

**Varlens can differentiate by:** Simple desktop app for offline analysis, zero cloud dependency, free/open-source

### MOON (Diploid/Invitae)

**Strengths:**
- AI-powered variant prioritization in minutes
- 94% diagnostic accuracy (correct variant in top 3)
- Phenotype-driven ranking using HPO terms
- Integrates with ClinVar and internal knowledge bases

**Weaknesses:**
- Requires Invitae platform (not standalone)
- Cloud-based, no offline mode
- Closed ecosystem (Invitae customers only)

**Varlens can differentiate by:** Offline-first, not tied to commercial lab, open-source, export-friendly

### Illumina Emedgene

**Strengths:**
- Automated ACMG classifications (SNV, indel, CNV, SV)
- Knowledge sharing across connected labs (private network)
- API integration with LIMS and pipelines
- 2-5x efficiency improvement claims

**Weaknesses:**
- Cloud-based, requires Illumina ecosystem
- Expensive (enterprise only)
- Overkill for simple variant review

**Varlens can differentiate by:** Standalone desktop app, no vendor lock-in, works with any annotation pipeline output

### PhenoTips

**Strengths:**
- Best-in-class HPO phenotype management
- Family pedigree tool with genetic modeling
- Integration with matchmaking portals (PhenomeCentral)
- Multilingual HPO support (10 languages)
- Used by NIH Undiagnosed Diseases Network

**Weaknesses:**
- Focuses on phenotype collection, not variant annotation
- Web-based, requires server setup
- No variant classification features

**Varlens can differentiate by:** Integrated phenotype + variant annotation in single offline tool

### Exomiser

**Strengths:**
- THE standard for HPO-based variant prioritization (74% top-1 accuracy with phenotypes)
- Open-source, well-validated (used by Genomics England and others)
- Supports exome and genome data
- Recent optimization study (2025) published recommendations

**Weaknesses:**
- Command-line tool (not user-friendly for clinicians)
- Requires large data files (10GB+) and Java runtime
- No GUI or curation features
- Slow (2-5 minutes per case)

**Varlens can differentiate by:** Provide GUI for Exomiser output, integrate HPO terms for export to Exomiser, offer lightweight curation on top of Exomiser rankings

---

## Implementation Ordering Rationale

Based on dependencies and risk analysis, recommended implementation order for v0.4.0:

### Phase 1: Annotation Core (Weeks 1-2)
1. **Database schema:** Create `variant_annotations` and `case_variant_annotations` tables
2. **Comments:** Global + per-case free-text comments with timestamps
3. **ACMG classification:** 5-tier enum field with color-coded display
4. **Star/flag:** Boolean field with toggle UI
5. **Filters:** Add classification + star + comment filters to variant table

**Why first:** Foundational schema. Low risk (standard CRUD operations). Immediate user value.

### Phase 2: Case Metadata Basic (Week 3)
6. **Affected status:** Add enum field to cases table
7. **Cohort groups:** Add JSON array field to cases table with autocomplete
8. **Case metadata UI:** Display in case list and case header

**Why second:** Simple schema extension. Enables cohort stratification for research users.

### Phase 3: Variant Detail Panel (Week 4)
9. **Detail panel component:** Slide-out drawer showing all database annotations
10. **External links:** Expand link set (Decipher, Franklin, MyGene.info, UCSC, Ensembl)
11. **Copy-to-clipboard:** Buttons for HGVS, chr:pos, rsID
12. **Offline indicator:** Show database annotation source

**Why third:** Depends on annotation schema (Phase 1). Pure UI enhancement, no schema changes.

### Phase 4: Custom Tags (Week 5) — v0.4.1
13. **Tags schema:** Create `variant_tags` table
14. **Tag UI:** Autocomplete, chips display, tag filter
15. **Tag management:** Settings page to rename/delete tags

**Why fourth:** Independent feature. Can ship after MVP if time-constrained.

### Phase 5: API Enrichment (Week 6-7) — v0.4.1
16. **Offline detection:** navigator.onLine + network check
17. **VEP API service:** Fetch annotations for selected variant
18. **API cache:** In-memory Map with TTL (consider SQLite table if cache persistence needed)
19. **Graceful fallback:** Display database annotations if API unavailable
20. **Rate limiting:** p-queue for VEP API throttling

**Why fifth:** High complexity. Depends on detail panel (Phase 3). Optional enhancement for online users.

### Phase 6: HPO Phenotypes (Week 8-9) — v0.4.1
21. **HPO data:** Bundle hpo.json (16k terms, convert from OBO format)
22. **case_phenotypes table:** Many-to-many with cases
23. **HPO search component:** Autocomplete with fuzzy matching
24. **HPO display:** Show terms in case metadata and case header

**Why sixth:** Complex (ontology integration). High value for research users but not blocking MVP.

---

## Technical Considerations

### ACMG Classification Storage

**Options:**
1. **Integer enum (1-5):** Compact, easy to index and sort
2. **Text enum:** "Benign", "Likely Benign", "VUS", "Likely Pathogenic", "Pathogenic"

**Recommendation:** Text enum for readability. SQLite CHECK constraint ensures valid values. Display logic maps to colors.

```sql
acmg_classification TEXT CHECK(acmg_classification IN (
  'Benign', 'Likely Benign', 'VUS', 'Likely Pathogenic', 'Pathogenic'
))
```

### Global vs Per-Case Annotations Logic

**Query pattern for variant display:**
```sql
SELECT
  v.*,
  COALESCE(cva.comment, va.comment) as comment,
  COALESCE(cva.acmg_classification, va.acmg_classification) as acmg_classification,
  COALESCE(cva.is_starred, va.is_starred, 0) as is_starred
FROM variants v
LEFT JOIN variant_annotations va ON va.chr = v.chr AND va.pos = v.pos AND va.ref = v.ref AND va.alt = v.alt
LEFT JOIN case_variant_annotations cva ON cva.case_id = v.case_id AND cva.variant_id = v.id
```

**Rationale:** Case-specific annotations override global. If no case-specific annotation, fall back to global.

### HPO Ontology Bundle

**HPO Data:**
- Source: [HPO OBO format](https://github.com/obophenotype/human-phenotype-ontology) or [HPO JSON export](https://hpo.jax.org/data/ontology)
- Size: ~16,000 terms, ~4MB JSON compressed
- Update frequency: HPO releases quarterly (Jan, Apr, Jul, Oct)

**Bundled JSON structure:**
```json
[
  {
    "id": "HP:0001250",
    "label": "Seizure",
    "synonyms": ["Seizures", "Epileptic seizure"],
    "definition": "A seizure is an intermittent abnormality of nervous system physiology...",
    "parents": ["HP:0012638"]
  }
]
```

**Search strategy:**
1. Load JSON into memory on app start (4MB is negligible for modern systems)
2. Index by ID and lowercase label for fast lookup
3. Fuzzy search using Fuse.js or simple substring match
4. Return top 10 matches for autocomplete

**Alternative: SQLite FTS5 table for HPO terms.** Allows reusing existing search infrastructure but adds schema complexity.

### Ensembl VEP API Details

**Endpoints:**
- `/vep/human/hgvs/{hgvs_notation}` — Query by HGVS (e.g., "NM_000038.5:c.1A>G")
- `/vep/human/region/{chr}:{pos}-{pos}:{strand}/{allele}` — Query by genomic coordinates

**Example:**
```
GET https://rest.ensembl.org/vep/human/region/1:55019343-55019343:1/C?content-type=application/json
```

**Response includes:**
- Consequences (missense, synonymous, etc.)
- SIFT/PolyPhen predictions
- gnomAD allele frequencies (v3/v4)
- ClinVar classifications
- CADD, REVEL, SpliceAI scores (if available)

**Rate limits:**
- Anonymous: 15 requests/second
- Registered: 55,000 requests/hour (requires API key)

**Caching strategy:**
- Cache successful responses for 7 days (VEP data updates quarterly)
- Cache failed responses (404) for 24 hours (variant may not be in Ensembl)
- Do not cache server errors (retry on next request)

### Offline Detection Strategy

**Approaches:**
1. **navigator.onLine:** Browser API, instant but unreliable (reports connection to router, not internet)
2. **Ping test:** Fetch small resource (Ensembl favicon) on app start and periodically
3. **API request with timeout:** Attempt API call, fallback on timeout/error

**Recommended hybrid:**
```typescript
async function checkOnlineStatus(): Promise<boolean> {
  if (!navigator.onLine) return false;

  try {
    const response = await fetch('https://rest.ensembl.org/', {
      method: 'HEAD',
      timeout: 3000
    });
    return response.ok;
  } catch {
    return false;
  }
}
```

Check on app start, on network change event (online/offline listeners), and before each API call.

### Performance Considerations

**Variant annotations query optimization:**
- Index on `variant_annotations(chr, pos, ref, alt)` for fast global annotation lookup
- Index on `case_variant_annotations(case_id, variant_id)` for per-case lookups
- COALESCE in SELECT for fallback logic adds negligible overhead

**HPO search performance:**
- In-memory search: 16k terms, ~10ms for fuzzy search on modern hardware
- Precompute lowercase labels for case-insensitive matching
- Use Fuse.js with threshold=0.3 for good fuzzy matching

**API cache size:**
- 1000 cached VEP responses ≈ 10MB memory (10KB per response)
- LRU eviction when cache exceeds 10MB or 1000 entries
- Persist cache to SQLite if users want cross-session caching

---

## Sources

### Tools Analyzed
- [VarSeq (Golden Helix)](https://www.goldenhelix.com/products/VarSeq/)
- [VSClinical ACMG Workflow](https://www.goldenhelix.com/products/VarSeq/vsclinical.html)
- [VarSome Clinical](https://landing.varsome.com/varsome-clinical)
- [VarSome Germline Classification](https://varsome.com/about/resources/germline-implementation/)
- [Fabric Genomics](https://fabricgenomics.com/)
- [Fabric Enterprise Variant Interpretation](https://fabricgenomics.com/products/applications/)
- [MOON (Diploid) Variant Prioritization](https://www.drugdiscoverynews.com/making-a-difference-with-moon-14076)
- [Illumina Emedgene](https://sapac.illumina.com/products/by-type/informatics-products/emedgene.html)
- [PhenoTips HPO Management](https://rd-connect.eu/phenotips-guide/)
- [Human Phenotype Ontology (HPO)](https://hpo.jax.org/)
- [Exomiser HPO Variant Prioritization](https://genomemedicine.biomedcentral.com/articles/10.1186/s13073-025-01546-1)

### ACMG Standards
- [ACMG Variant Interpretation Guidelines (2015)](https://pubmed.ncbi.nlm.nih.gov/25741868/)
- [ClinGen Variant Classification Guidance](https://clinicalgenome.org/tools/clingen-variant-classification-guidance/)
- [ClinGen Sequence Variant Interpretation](https://clinicalgenome.org/working-groups/sequence-variant-interpretation/)
- [ACMG 7-category variant system](https://www.medrxiv.org/content/10.1101/2023.01.23.23284909v1.full)
- [Updated ACMG/AMP PALB2 Specifications (2025)](https://www.cell.com/ajhg/fulltext/S0002-9297(25)00352-0)
- [RASopathy ACMG Specifications (2025)](https://www.gimopen.org/article/S2949-7744(25)01469-4/fulltext)

### APIs and Data Sources
- [Ensembl VEP REST API](https://github.com/Ensembl/ensembl-vep)
- [VEP Tutorial](https://pmc.ncbi.nlm.nih.gov/articles/PMC7613081/)
- [LitVar Literature Search](https://pubmed.ncbi.nlm.nih.gov/29762787/)
- [PubMind AI Literature Extraction (2025)](https://www.biorxiv.org/content/10.1101/2025.10.13.682183v1.full)
- [ClinVar](https://www.ncbi.nlm.nih.gov/clinvar/)
- [ClinVar Updates (2025)](https://pubmed.ncbi.nlm.nih.gov/39578691/)
- [HPO Ontology (2024)](https://academic.oup.com/nar/article/52/D1/D1333/7416384)

### Variant Annotation Tools
- [Slivar (custom tags)](https://github.com/brentp/slivar)
- [VarAFT (Variant Annotation Filter Tool)](https://academic.oup.com/nar/article/46/W1/W545/5025894)
- [VPOT (custom prioritization)](https://www.sciencedirect.com/science/article/pii/S1672022919301494)
- [ClinGen Variant Curation Interface](https://genomemedicine.biomedcentral.com/articles/10.1186/s13073-021-01004-8)

### Cohort and Trio Analysis
- [Trio Exome Diagnostic Yield (2025)](https://www.frontiersin.org/journals/genetics/articles/10.3389/fgene.2025.1580879/full)
- [Trio Analysis Best Practices](https://pmc.ncbi.nlm.nih.gov/articles/PMC9349217/)
- [Compound Heterozygous and De Novo Variants](https://www.nature.com/articles/s41598-024-79431-x)

### Standards and Interoperability
- [GA4GH Variant Annotation Specification](https://www.ga4gh.org/product/variant-annotation/)
- [FHIR Genomics Sync (2025)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10582236/)

---

**Research confidence:** HIGH
- ACMG guidelines and ClinGen recommendations are authoritative sources
- VEP, HPO, and ClinVar APIs are well-documented with stable endpoints
- Tool comparisons based on official product documentation and published research
- 2025-2026 literature confirms current best practices

**Open questions for user validation:**
- Do external collaborators need ACMG criteria tracking (28 criteria) or is 5-tier classification sufficient?
- Is HPO phenotype management high priority, or should it be deferred to v0.5?
- Should custom tags be in MVP or v0.4.1?
- What external database links are most valuable (prioritize top 5)?
