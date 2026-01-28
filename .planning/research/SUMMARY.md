# Project Research Summary

**Project:** Varlens v0.4.0 — Variant Annotation & Case Metadata
**Domain:** Genetic variant annotation, ACMG classification, API enrichment, offline-first desktop application
**Researched:** 2026-01-28
**Confidence:** HIGH

## Executive Summary

Varlens v0.4.0 adds variant annotation workflows (comments, stars/flags, ACMG 5-tier classification, custom tags), live API enrichment (Ensembl VEP, HPO phenotype search), and case metadata (affected status, cohort groups, HPO terms) to the existing Electron + Vue 3 + SQLite stack. The research reveals that this feature set is **table stakes** in modern variant analysis tools (VarSeq, VarSome, Fabric Genomics, MOON), but Varlens differentiates through **true offline-first operation with graceful API degradation** — competitors are web-based and break without internet.

The recommended approach leverages existing architecture patterns: minimal new dependencies (only axios for HTTP), normalized SQLite tables for annotations, API calls proxied through main process with SQLite caching, and Vuetify side drawer for variant details. All annotation and enrichment features build on proven patterns from v0.3.0 (encryption, IPC handlers, Pinia stores). The stack is well-validated: 167,000+ projects use axios, VEP REST API handles 55,000 requests/hour, and HPO API is actively maintained by NLM.

**Critical risks identified:** (1) SQLite foreign keys disabled by default can silently corrupt annotation data during deletions, (2) Ensembl VEP platform transition in 2026 may break API response parsing, (3) ACMG evidence vs. classification conflation in schema design would lose provenance permanently. All are preventable with upfront schema design discipline, encrypted database migration testing, and response validation. The research provides detailed mitigation strategies for each.

## Key Findings

### Recommended Stack

The research confirms v0.4.0 requires only **one new runtime dependency**: axios (11.7kB gzipped) for HTTP client. All other requirements are met by existing stack elements or native features.

**Why minimal dependencies:** Electron 40's Node.js 20.x includes native fetch, but axios provides superior developer experience through automatic error handling (throws on 4xx/5xx), request/response interceptors (critical for VEP rate limiting), and cleaner syntax. No specialized packages exist for ACMG classification (simple 5-tier enum) or HPO search (API-based, no npm library needed).

**Core technologies (validated):**
- **axios 1.13.3+**: HTTP client for VEP/HPO APIs with rate limiting interceptors — battle-tested, 167,351 dependent projects
- **Electron 40 + better-sqlite3-multiple-ciphers 12.6.2**: Already validated in v0.3.0 — encryption, FTS5, prepared statements work correctly
- **Vue 3 + Vuetify 3 + TypeScript**: Existing stack handles all UI requirements — v-navigation-drawer for side panel, v-autocomplete for HPO search
- **Ensembl VEP REST API**: 140+ annotation sources, 55,000 req/hour rate limit, free anonymous access — industry standard
- **NLM Clinical Tables HPO API**: Purpose-built for autocomplete, free, simple JSON, includes synonyms — best fit for offline-capable phenotype search

**What NOT to add:** node-fetch (native fetch available), ACMG npm packages (none mature, simple enum suffices), HPO npm packages (API-based works better), VEP local install (60GB+ cache, Perl dependencies — REST API simpler).

### Expected Features

Research analyzed 7 tools (VarSeq, VarSome Clinical, Fabric Genomics, MOON, Illumina Emedgene, PhenoTips, Exomiser) to determine feature expectations.

**Must have (table stakes):**
- **Variant comments** (global + per-case with timestamps) — every curation tool provides this
- **ACMG 5-tier classification** (Pathogenic, Likely Pathogenic, VUS, Likely Benign, Benign) — universal standard since 2015 guidelines
- **Star/flag marking** — universal "interesting variant" tagging (every tool analyzed has this)
- **Variant details side panel** — main table shows summary, panel shows all annotations (standard UX pattern)
- **External database links** (gnomAD, ClinVar, OMIM, UCSC, Ensembl, Decipher, Franklin) — essential for context lookup
- **Case metadata** (affected/unaffected status, cohort groups) — required for cohort stratification and trio analysis

**Should have (competitive advantage):**
- **Custom user-defined tags** — VarSeq, Slivar, VarAFT support flexible tagging; users create arbitrary labels like "candidate", "de-novo", "review-with-clinician"
- **HPO phenotype terms** — Exomiser achieves 74% top-1 accuracy WITH phenotypes vs 3% WITHOUT; game-changer for prioritization
- **Live API enrichment with graceful offline degradation** — most tools are web-based and break offline; Varlens' offline-first + API bonus is differentiator
- **Full offline HPO search** — ship bundled HPO JSON (16k terms, 4MB compressed) for true offline operation while competitors require internet

**Defer (v0.5+ or explicitly anti-features):**
- **Automated ACMG classification engine** — complex, requires live data, gene-specific rules, high maintenance burden; users manually classify
- **Interactive HPO ontology tree browser** — 16k terms, complex UI, marginal value; search with autocomplete suffices
- **Real-time collaborative annotation** — violates offline-first architecture, requires server backend; Varlens targets sequential use
- **Built-in Exomiser/phenotype prioritization** — 10GB+ data, Java runtime, 2-5 min computation; export to Exomiser instead
- **In-app ACMG criteria specification editor** — 28 criteria with complex rules, high complexity; provide 5-tier dropdown + rationale comment field

### Architecture Approach

The architecture extends existing patterns rather than introducing new paradigms. All HTTP API calls originate from main process via dedicated `ApiService` class with SQLite cache, following Electron security best practices (renderer is sandboxed). Annotation storage uses normalized tables with foreign keys (not JSON columns) for better query performance and type safety. Side panel implemented as Vuetify v-navigation-drawer with persistent state in Pinia store.

**Major components:**
1. **ApiService (main process)** — VEP + HPO HTTP client, SQLite-based response caching with TTL, offline degradation logic, rate limiting
2. **Annotation storage (DatabaseService extensions)** — New tables: `variant_annotations` (comments, stars, flags, ACMG class), `case_metadata` (status, cohort groups, HPO terms), `api_cache` (30-day VEP, 7-day HPO)
3. **Side panel (VariantDetailsPanel.vue)** — Right drawer with tabs (Details/Annotations/API Data), loads on variant click, shows database annotations always + API enrichment when online
4. **Case metadata UI (CaseMetadataDialog.vue)** — Edit affected status, assign cohort groups (autocomplete), add HPO terms (API-powered autocomplete with offline fallback)
5. **IPC handlers (annotations.ts, api-proxy.ts, case-metadata.ts)** — Follow existing `domain:action` pattern, extend preload API, wrap with error handling

**Key architectural decisions:**
- **API calls in main process (not renderer)** — security (renderer sandboxed), centralized caching, offline support, rate limiting control
- **Normalized tables (not JSON columns)** — SQLite has no native JSON type, normalized provides better query performance and schema evolution
- **Global + per-case annotations** — flexibility for reference knowledge (global) + case-specific analysis (per-case), UI merges with COALESCE
- **Side drawer (not modal)** — non-blocking, persistent during navigation, standard Vuetify pattern
- **Offline-first with three-tier fallback** — fresh API data → stale cache → offline message; always show database annotations

### Critical Pitfalls

Research identified 26 pitfalls (10 critical, 8 moderate, 8 minor). Top 5 critical risks that could cause rewrites or data loss:

1. **Foreign Keys Not Enabled = Silent Data Corruption** — SQLite disables FK enforcement by default; deletions leave orphaned annotation records. **Prevention:** Verify `PRAGMA foreign_keys = ON` immediately after opening connection (v0.3.0 does this correctly, must maintain pattern). Add integration test: delete case with annotations → verify cascade delete. **Phase: Schema Design (before any new tables).**

2. **Ensembl VEP Platform Transition Breaking Changes (2026)** — VEP API receives final update at e!116, then frozen; new platform (beta.ensembl.org) may have different response format. Already happened: `maf` renamed to `af`. **Prevention:** Use response validation (zod schema), log validation failures, implement feature flag `USE_NEW_VEP_API` for transition, monitor Ensembl changelog. **Phase: API Integration + ongoing monitoring.**

3. **VEP Rate Limiting Without Exponential Backoff = Cascade Failures** — 15 req/sec limit; concurrent requests trigger 429 Too Many Requests → naive retry amplifies problem → infinite loop. **Prevention:** Request queue (max 10/sec buffer), respect `Retry-After` header, exponential backoff (1s, 2s, 4s, 8s), AbortController for cancellation, max 3 retries then fail gracefully. **Phase: API Integration.**

4. **ACMG Evidence vs. Classification Conflation** — Storing only final classification (pathogenic/benign) discards evidence codes (PS1, PM2, PP3), losing provenance. Cannot answer "why was this classified?" or retroactively apply updated guidelines. **Prevention:** Separate tables for evidence (`variant_acmg_evidence` with code/strength/rationale) and classification (derived or user-override). Store ACMG guidelines version. **Phase: Schema Design — MUST GET RIGHT UPFRONT.**

5. **Schema Migration on Encrypted DB Without Testing** — Migration works on :memory: dev DB but fails on encrypted production DB with "file is not a database" error. SQLCipher has different failure modes. **Prevention:** Test all migrations on encrypted test database (not just :memory:), backup before migration, atomic transactions with rollback, validate encryption after migration (`PRAGMA cipher_integrity_check`). **Phase: Schema Design — before any new tables.**

**Additional critical pitfalls:** HPO term obsoletion (store with version metadata, validate periodically, show warnings), race conditions from fast user interaction (AbortController pattern, request ID tracking), offline detection false positives (`navigator.onLine` unreliable, implement real connectivity check), case-insensitive tag duplicates (normalize with LOWER() and unique index), renderer process API key exposure (store in main process only, use Electron `safeStorage`).

## Implications for Roadmap

Based on dependencies and risk analysis, recommended 6-phase structure with clear rationale:

### Phase 1: Database Foundation (Weeks 1-2)
**Rationale:** All features depend on schema. Critical pitfalls (#1, #4, #5, #9) must be addressed before any code. High risk if wrong; low cost if done early.

**Delivers:**
- New SQLite tables: `variant_annotations`, `case_metadata`, `cohort_groups`, `case_cohort_links`, `api_cache`
- Schema migration function `migrateAnnotationTables()` with encrypted DB testing
- ACMG evidence model (separate from classification)
- Foreign key verification and cascade delete tests
- FTS5 indexes for comment/tag search

**Addresses features:**
- Annotation storage (comments, stars, flags, ACMG class)
- Case metadata (status, cohort groups, HPO terms)
- API cache infrastructure

**Avoids pitfalls:**
- #1 (Foreign keys), #5 (Encrypted migration), #4 (ACMG model), #9 (Tag normalization), #11 (Denormalization), #20 (FTS5)

**Research flags:** Standard pattern (extend existing v0.3.0 migration pattern), skip research-phase.

---

### Phase 2: Annotation Core (Weeks 2-3)
**Rationale:** Immediate user value after schema complete. Pure backend CRUD operations. Enables UI development in parallel with API work.

**Delivers:**
- IPC handlers: `annotations:create`, `annotations:update`, `annotations:delete`, `annotations:get`, `annotations:list`
- DatabaseService methods: `getAnnotationsForVariant()`, `createOrUpdateAnnotation()`, `deleteAnnotation()`, `listAnnotationsForCase()`
- Shared types in `src/shared/types/annotations.ts`
- Preload API extensions for annotation operations
- Global vs per-case comment logic (COALESCE query pattern)

**Addresses features:**
- Global variant comments (with timestamps)
- Per-case variant comments
- Star/flag marking
- ACMG classification assignment (manual, 5-tier)

**Avoids pitfalls:**
- #12 (Global vs per-case context), #13 (Timestamp audit)

**Research flags:** Standard CRUD pattern (like existing case/variant handlers), skip research-phase.

---

### Phase 3: API Service Layer (Weeks 3-4)
**Rationale:** API infrastructure must exist before side panel can display enrichment. High complexity due to rate limiting, caching, offline handling. Critical pitfalls require careful implementation.

**Delivers:**
- `ApiService.ts` with VEP + HPO clients
- SQLite cache table with TTL-based expiration
- Rate limiting (10 req/sec buffer below VEP's 15/sec limit)
- Exponential backoff on 429 responses
- Response validation (zod schema for VEP/HPO)
- IPC handlers: `api:vep`, `api:hpoSearch`
- Offline detection with real connectivity check (not just `navigator.onLine`)
- AbortController for request cancellation

**Addresses features:**
- Ensembl VEP API integration (consequence predictions, CADD/REVEL/SpliceAI, gnomAD frequencies)
- HPO API integration (phenotype term autocomplete)
- Graceful offline degradation (three-tier: fresh → stale cache → offline message)

**Avoids pitfalls:**
- #2 (VEP breaking changes), #3 (Rate limiting), #6 (Race conditions), #8 (Offline detection), #10 (API key security), #26 (Response sanitization)

**Research flags:** **NEEDS DEEPER RESEARCH** during planning. VEP response validation requires understanding all field variations. HPO API caching strategy depends on ontology update frequency. Consider `/gsd:research-phase "VEP API Integration"` for response schema analysis.

---

### Phase 4: Case Metadata (Week 4)
**Rationale:** Simple schema extension. Enables cohort stratification. Low risk.

**Delivers:**
- IPC handlers: `case-metadata:get`, `case-metadata:update`, `case-metadata:listCohortGroups`, `case-metadata:createCohortGroup`, `case-metadata:linkToCohorts`
- DatabaseService methods: `getCaseMetadata()`, `updateCaseMetadata()`, `addCohortGroup()`, `listCohortGroups()`, `linkCaseToGroups()`
- `CaseMetadataDialog.vue` component (v-dialog with form for status/cohorts/HPO)
- Cohort group autocomplete (from existing groups)
- Display case metadata in case list and case header

**Addresses features:**
- Affected/unaffected status per case
- Cohort group assignment (free-form text with autocomplete)
- Basic HPO term storage (without autocomplete yet)

**Avoids pitfalls:**
- None specific to this phase (low risk)

**Research flags:** Standard pattern (like existing case operations), skip research-phase.

---

### Phase 5: Side Panel UI (Weeks 5-6)
**Rationale:** Depends on Phase 2 (annotation backend) and Phase 3 (API layer). UI can be built incrementally with Vuetify components. High user visibility.

**Delivers:**
- `VariantDetailsPanel.vue` component (v-navigation-drawer, right side, 600px width)
- Tabs: Details (database annotations) / Annotations (comments, stars, ACMG) / API Data (VEP enrichment)
- `AnnotationEditor.vue` component (form with v-textarea for comments, v-switch for star/flag, v-select for ACMG)
- `ApiEnrichmentView.vue` component (displays VEP response with loading/error/offline states)
- Pinia stores: `sidePanelStore` (drawer visibility, selected variant), `annotationsStore` (annotation state, optimistic updates)
- External link buttons (PubTator, LitVar, UCSC, Decipher, Franklin) — update shell.ts allowlist
- Copy-to-clipboard buttons (HGVS, chr:pos:ref:alt, rsID)
- Loading states (skeleton screen), error states (timeout, rate limit), offline states (cached data banner)

**Addresses features:**
- Variant details side panel (all database annotations)
- Comment editing (global + per-case)
- ACMG classification UI (5-tier dropdown with color badges)
- Star/flag toggle
- VEP annotation display (consequence predictions, scores, frequencies)
- External database links (expanded set)

**Avoids pitfalls:**
- #14 (Loading states), #15 (N+1 queries), #21 (Panel obscures row), #23 (Error messages)

**Research flags:** Standard Vuetify pattern (existing components use v-dialog, v-data-table), skip research-phase.

---

### Phase 6: Custom Tags + HPO Autocomplete (Weeks 6-7)
**Rationale:** Independent features that can ship after MVP if time-constrained. High value for research users but not blocking basic annotation workflow.

**Delivers:**
- Tags schema: `tags` table (name, color, created_at), `variant_tags` junction table (many-to-many)
- IPC handlers: `annotations:addTag`, `annotations:removeTag`, `annotations:listTags`, `annotations:createTag`, `annotations:deleteTag`
- Tag UI: v-combobox with autocomplete from existing tags, v-chip display, tag filter in variant table
- Tag management settings page (rename/delete/recolor tags)
- HPO term autocomplete component with NLM API integration (or bundled HPO JSON for offline)
- HPO term display in case metadata with links to HPO browser
- HPO term validation (check for obsolete terms)

**Addresses features:**
- Custom user-defined tags (many-to-many with variants)
- HPO phenotype terms (with API-powered autocomplete)
- Tag-based filtering
- HPO term management (add/remove terms to cases)

**Avoids pitfalls:**
- #4 (HPO obsoletion — store with version metadata), #16 (HPO autocomplete performance — limit results to 50)

**Research flags:** **MAY NEED RESEARCH** for bundled HPO JSON approach. If shipping offline-first HPO autocomplete, need to research: (1) OBO to JSON conversion, (2) fuzzy search implementation (Fuse.js?), (3) synonym handling, (4) ontology versioning. Consider `/gsd:research-phase "Offline HPO Autocomplete"` if bundled approach chosen over API-only.

---

### Phase Ordering Rationale

**Why this order:**
1. **Schema first (Phase 1)** — critical pitfalls concentrated here; all features depend on correct data model
2. **Backend before frontend (Phases 2-3 before 5)** — UI needs IPC endpoints; parallel API development during annotation backend
3. **Core features before enhancements (Phases 2-5 before 6)** — comments/ACMG/side panel are table stakes; tags/HPO are nice-to-have
4. **API infrastructure early (Phase 3)** — long pole item with high complexity; start early to allow time for rate limit testing
5. **Case metadata middle (Phase 4)** — low risk, can be done while API testing continues
6. **Deferred features last (Phase 6)** — tags and HPO autocomplete can ship in v0.4.1 if MVP is time-constrained

**Dependency chain:**
- Phase 5 (Side Panel) depends on Phase 2 (annotation backend) + Phase 3 (API layer)
- Phase 6 (Tags/HPO) depends on Phase 1 (schema) but independent of Phases 2-5 (can be parallel or deferred)
- Phase 4 (Case Metadata) independent of Phases 2-3 (can be parallel)

**How this avoids pitfalls:**
- Early schema design (Phase 1) catches all critical database pitfalls (#1, #4, #5, #9) before implementation starts
- API integration phase (Phase 3) specifically addresses rate limiting (#3), response validation (#2), offline handling (#8), race conditions (#6)
- Foreign key testing in Phase 1 prevents silent data corruption discovered in later phases
- Encrypted DB migration testing in Phase 1 prevents production deployment failures

### Research Flags

**Phases likely needing deeper research during planning:**
- **Phase 3 (API Integration)** — VEP response validation requires understanding field variations across different variant types (SNVs, indels, CNVs). HPO API caching strategy depends on ontology update frequency (quarterly releases, but API may return stale data). Consider `/gsd:research-phase "VEP API Integration"` for response schema analysis.
- **Phase 6 (HPO Autocomplete)** — If implementing bundled offline HPO JSON, need research on: OBO to JSON conversion, fuzzy search with synonyms, ontology versioning. Consider `/gsd:research-phase "Offline HPO Autocomplete"` if bundled approach chosen.

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Database Foundation)** — Extends existing v0.3.0 migration pattern; SQLite foreign keys, FTS5, encrypted DB all validated in previous milestone
- **Phase 2 (Annotation Core)** — Standard CRUD operations following existing IPC handler patterns (cases.ts, variants.ts)
- **Phase 4 (Case Metadata)** — Simple schema extension with standard form UI (like existing case edit dialogs)
- **Phase 5 (Side Panel UI)** — Standard Vuetify components (v-navigation-drawer, v-tabs, v-form); similar to existing dialogs/tables

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | axios verified at 1.13.3 (latest stable), fully compatible with Electron 40's Node.js 20.x. VEP REST API 140+ sources, well-documented. HPO API actively maintained by NLM (last update 2026-01-14). All existing stack elements (Electron, SQLite, Vue, Vuetify) validated in v0.3.0. |
| Features | HIGH | 7 tools analyzed (VarSeq, VarSome, Fabric, MOON, Emedgene, PhenoTips, Exomiser) with official product documentation and peer-reviewed research. ACMG 2015 guidelines are authoritative source. Feature prevalence clear (100% have comments/ACMG, 85% have tags, 70% have HPO). Offline-first differentiator validated by competitor analysis (all web-based). |
| Architecture | HIGH | Follows proven Electron security patterns (main process for HTTP, renderer sandboxed). API proxy pattern sourced from Electron official docs and LogRocket architecture guide. Vuetify navigation drawer pattern from official docs. SQLite schema design sourced from SQLite Foreign Key Support docs and verified against existing v0.3.0 patterns. |
| Pitfalls | HIGH | 26 pitfalls sourced from: Official docs (Ensembl rate limits, SQLite foreign keys, Electron security, HPO obsoletion guidelines), peer-reviewed publications (ACMG guidelines), real-world issue reports (GitHub issues for VEP API, tag normalization, race conditions), existing Varlens codebase analysis (schema.ts, DatabaseService.ts, shell.ts). All critical pitfalls have verified prevention strategies. |

**Overall confidence:** HIGH

All research areas have authoritative sources:
- Stack: Official package registries (npm), API documentation (Ensembl REST, HPO API), version compatibility verified
- Features: Product documentation + peer-reviewed research on variant annotation tools + ACMG standards
- Architecture: Electron official docs, SQLite official docs, Vuetify official docs, LogRocket/Medium architecture guides
- Pitfalls: Official documentation (primary sources) + GitHub issues/discussions (secondary verification) + existing codebase analysis

### Gaps to Address

Research identified 3 gaps requiring validation during implementation:

1. **VEP API response field variations** — Research covered standard VEP response format, but field availability varies by variant type (SNVs vs indels vs structural variants). Some annotations (SpliceAI, REVEL) only present for specific consequence types. **Resolution:** Implement zod schema validation during Phase 3 with logging for unexpected fields. Consider creating VEP response fixtures for different variant types during planning.

2. **HPO autocomplete implementation strategy** — Research identified two approaches: (a) API-only with NLM Clinical Tables, (b) bundled HPO JSON (16k terms, 4MB) for offline search. Tradeoffs documented but choice deferred. **Resolution:** Decision point during Phase 6 planning. API-only is simpler (less code, always current). Bundled is more consistent with offline-first philosophy. Recommend user research: "How often do users annotate phenotypes while offline?"

3. **Performance with 50+ cases and 1000+ annotations per case** — Research analyzed patterns for annotation storage but didn't benchmark large-scale performance. PROJECT.md notes this as known gap. **Resolution:** Add integration test in Phase 1 that creates 50 cases with 1000 annotations each, measures query time for annotation join. If >100ms, consider denormalization (e.g., cache annotation count in variants table) or pagination for annotation list views.

4. **ACMG criteria tracking complexity** — Research identified full 28-criteria tracking as high complexity (deferred to v0.5+), but didn't detail minimum viable criteria storage. Users may want to record "PM2 + PP3" in rationale field without full criteria UI. **Resolution:** Phase 2 includes free-text "classification rationale" field. Monitor user feedback during v0.4.0 beta to determine if structured criteria tracking needed for v0.4.1.

5. **External link allowlist maintenance** — Research documented 6 new link targets (PubTator, LitVar, UCSC, Decipher, Franklin, HPO browser), but process for allowlist updates not formalized. Easy to forget during implementation. **Resolution:** Add "Update shell.ts allowlist" as explicit subtask in Phase 5 planning. Create test that validates all API domains are in allowlist. Consider code review checklist item.

## Sources

### Primary (HIGH confidence)

**Stack & APIs:**
- [Ensembl VEP REST API Documentation](https://rest.ensembl.org/) — endpoint documentation, response formats
- [Ensembl Rate Limits Wiki](https://github.com/Ensembl/ensembl-rest/wiki/Rate-Limits) — 15 req/sec, 55k req/hour limits, retry headers
- [Ensembl REST Change Log](https://github.com/Ensembl/ensembl-rest/wiki/Change-log) — API version history, breaking changes (`maf` → `af`)
- [Ensembl Platform Transition 2026](https://www.ensembl.info/2025/12/02/updates-to-programmatic-access-to-ensembl-and-transitioning-to-the-new-ensembl-platform/) — final update e!116, new platform migration
- [NLM Clinical Tables HPO API Documentation](https://clinicaltables.nlm.nih.gov/apidoc/hpo/v3/doc.html) — autocomplete endpoint, query parameters, response format
- [axios npm package](https://www.npmjs.com/package/axios) — version 1.13.3, 167,351 dependent projects

**ACMG Standards:**
- [ACMG/AMP 2015 Guidelines (PMC4544753)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4544753/) — authoritative 5-tier classification system
- [ACMG Guidelines Overview (PMC6885382)](https://pmc.ncbi.nlm.nih.gov/articles/PMC6885382/) — evidence code weights, criteria interpretation
- [ClinGen Variant Classification Guidance](https://clinicalgenome.org/tools/clingen-variant-classification-guidance/) — gene-specific criteria specifications
- [Updated ACMG/AMP PALB2 Specifications 2025](https://www.cell.com/ajhg/fulltext/S0002-9297(25)00352-0) — recent guideline updates

**Database & Electron:**
- [SQLite Foreign Keys Documentation](https://sqlite.org/foreignkeys.html) — disabled by default, ON DELETE CASCADE behavior
- [Electron Security Tutorial](https://www.electronjs.org/docs/latest/tutorial/security) — renderer sandboxing, IPC patterns
- [Electron safeStorage API](https://www.electronjs.org/docs/latest/api/safe-storage) — OS-level credential storage
- [SQLite3 Multiple Ciphers Documentation](https://utelle.github.io/SQLite3MultipleCiphers/) — SQLCipher encryption, migration behavior

**HPO Ontology:**
- [HPO Obsoletion Guidelines](https://github.com/obophenotype/human-phenotype-ontology/wiki/Obsoletion) — term deprecation process, replacement annotations
- [HPO Ontology 2024 (NAR)](https://academic.oup.com/nar/article/52/D1/D1333/7416384) — 16k terms, quarterly releases, synonym coverage

### Secondary (MEDIUM confidence)

**Tools Analyzed:**
- [VarSeq (Golden Helix)](https://www.goldenhelix.com/products/VarSeq/) — VSClinical ACMG workflow, custom tags
- [VarSome Clinical](https://landing.varsome.com/varsome-clinical) — 140+ data sources, semi-automated classification
- [Fabric Genomics](https://fabricgenomics.com/) — ACE AI classification, end-to-end platform
- [MOON (Diploid) Variant Prioritization](https://www.drugdiscoverynews.com/making-a-difference-with-moon-14076) — 94% diagnostic accuracy, phenotype-driven ranking
- [Illumina Emedgene](https://sapac.illumina.com/products/by-type/informatics-products/emedgene.html) — automated ACMG classifications
- [PhenoTips HPO Management](https://rd-connect.eu/phenotips-guide/) — best-in-class HPO UI, family pedigree
- [Exomiser HPO Variant Prioritization (2025)](https://genomemedicine.biomedcentral.com/articles/10.1186/s13073-025-01546-1) — 74% top-1 accuracy with phenotypes

**Architecture Patterns:**
- [Advanced Electron.js architecture - LogRocket](https://blog.logrocket.com/advanced-electron-js-architecture/) — backend in separate process for long-running operations
- [Vuetify Navigation Drawer Component](https://vuetifyjs.com/en/components/navigation-drawers/) — side drawer patterns
- [Pinia Elm Pattern](https://alexop.dev/posts/tea-architecture-pinia-private-store-pattern/) — store architecture for state management
- [Handling API Race Conditions](https://sebastienlorber.com/handling-api-request-race-conditions-in-react) — AbortController patterns

**Performance & Best Practices:**
- [SQLite Versioning and Migration](https://www.sqliteforum.com/p/sqlite-versioning-and-migration-strategies) — table existence checks, additive-only migrations
- [Graceful Degradation for Offline Apps](https://dev.to/lovestaco/graceful-degradation-keeping-your-app-functional-when-things-go-south-jgj) — three-tier fallback patterns
- [Best Practices for Managing Schema in SQLite](https://medium.com/@firmanbrilian/best-practices-for-managing-schema-indexes-and-storage-in-sqlite-for-data-engineering-266b7fa65f4c) — normalized vs JSON columns

### Tertiary (LOW confidence, needs validation)

- [hpo-js npm package](https://www.npmjs.com/package/hpo-js) — evaluated, 4 years old, React-specific, not recommended but documented for completeness
- [VEP Tutorial (PMC7613081)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7613081/) — general VEP usage, not specific to REST API
- [Tag Case Sensitivity Issues (GitHub)](https://github.com/shaarli/Shaarli/issues/146) — community discussion on tag normalization patterns

---

**Research completed:** 2026-01-28
**Ready for roadmap:** Yes

**Next step:** Roadmapper agent will use this summary to create detailed phase plans with tasks, estimated effort, and success criteria. Phases 1-5 are well-specified and low-risk. Phase 3 (API Integration) and Phase 6 (HPO Autocomplete) may benefit from additional research during planning if implementation details unclear.
