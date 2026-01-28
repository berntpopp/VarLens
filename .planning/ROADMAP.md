# Roadmap: Varlens

## Milestones

- ✅ **v0.1 POC** - Phases 1-8 (shipped 2026-01-27)
- ✅ **v0.2.0 UI Polish & Trust Signals** - Phases 9-12 (shipped 2026-01-27)
- ✅ **v0.3.0 Cohort Analysis, Security & Import Enhancements** - Phases 13-18 (shipped 2026-01-28)
- 🚧 **v0.4.0 Variant Annotation & Case Metadata** - Phases 19-24 (in progress)

## Phases

<details>
<summary>✅ v0.1 POC (Phases 1-8) - SHIPPED 2026-01-27</summary>

Complete proof-of-concept validating Electron + Vue 3 + Vuetify 3 + better-sqlite3 stack with streaming import, paginated table, and FTS5-powered filtering.

</details>

<details>
<summary>✅ v0.2.0 UI Polish & Trust Signals (Phases 9-12) - SHIPPED 2026-01-27</summary>

Professional branding, trust signals, logging infrastructure, and app chrome on top of v0.1 POC.

</details>

<details>
<summary>✅ v0.3.0 Cohort Analysis, Security & Import Enhancements (Phases 13-18) - SHIPPED 2026-01-28</summary>

Transforms Varlens from a single-sample viewer into a cohort analysis platform with SQLCipher database encryption, database selection/switching, batch import with ZIP support, external genomic database links, OMIM MIM number integration, and cross-case cohort analysis with aggregated statistics.

</details>

### 🚧 v0.4.0 Variant Annotation & Case Metadata (In Progress)

**Milestone Goal:** Transform Varlens from a read-only viewer into an active analysis workbench with variant annotation, classification, enriched detail views, and structured case metadata.

**Phase Numbering:**
- Integer phases (19-24): Planned milestone work
- Decimal phases (e.g., 19.1, 19.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 19: Database Foundation** - Schema, migration, encrypted DB testing ✓
- [x] **Phase 20: Annotation Core** - IPC handlers, comments, stars, ACMG classification ✓
- [ ] **Phase 21: API Service Layer** - VEP + HPO clients, caching, rate limiting, offline detection
- [ ] **Phase 22: Case Metadata** - Status, cohorts, HPO terms, UI
- [ ] **Phase 23: Side Panel UI** - Drawer, tabs, annotation editing, VEP display, external links
- [ ] **Phase 24: Custom Tags + HPO Autocomplete** - Tag management, HPO search component

## Phase Details

### Phase 19: Database Foundation
**Goal**: Database schema supports all annotation, case metadata, and API caching features with encrypted DB migration validated.

**Depends on**: Nothing (extends v0.3.0 schema)

**Requirements**: INFRA-01, INFRA-02, INFRA-06

**Success Criteria** (what must be TRUE):
  1. New annotation tables exist in SQLite schema (variant_annotations, case_metadata, cohort_groups, case_cohort_links, api_cache, tags, variant_tags)
  2. Schema migration function runs successfully on SQLCipher-encrypted databases without "file is not a database" errors
  3. Foreign key enforcement is verified ON with cascade delete test (deleting case removes all per-case annotations)
  4. ACMG classification model separates evidence storage from final classification (supports provenance tracking)
  5. All annotation writes use parameterized SQL queries (injection-proof)

**Plans**: 2 plans

Plans:
- [x] 19-01-PLAN.md — Schema additions, migration system with PRAGMA user_version, TypeScript types ✓
- [x] 19-02-PLAN.md — Migration tests on encrypted databases, cascade delete verification ✓

### Phase 20: Annotation Core
**Goal**: Users can annotate variants with comments, stars/flags, and ACMG classification with persistent storage.

**Depends on**: Phase 19 (schema must exist)

**Requirements**: ANNOT-01, ANNOT-02, ANNOT-03, ANNOT-04, ANNOT-05, ANNOT-06, ANNOT-07, ANNOT-12, ANNOT-13

**Success Criteria** (what must be TRUE):
  1. User can add a global comment to any variant visible to all cases containing that variant
  2. User can add a per-case comment to a variant specific to one case's context
  3. User can edit and delete existing comments with preserved timestamps (created_at, updated_at)
  4. User can toggle star/flag on any variant to mark as interesting
  5. User can assign ACMG 5-tier classification (Pathogenic, Likely Pathogenic, VUS, Likely Benign, Benign) to any variant
  6. ACMG classification displays with color-coded badges in variant table rows
  7. Deleting a case cascades deletion of that case's per-case annotations without orphaned records

**Plans**: 4 plans

Plans:
- [x] 20-01-PLAN.md — Backend: IPC handlers + DatabaseService annotation methods ✓
- [x] 20-02-PLAN.md — Frontend: VariantTable star + ACMG columns, useAnnotations composable ✓
- [x] 20-03-PLAN.md — Gap closure: Extend useAnnotations with comment and ACMG mutation methods ✓
- [x] 20-04-PLAN.md — Gap closure: AcmgMenu and CommentDialog UI components ✓

### Phase 21: API Service Layer
**Goal**: VEP and HPO API clients provide enriched annotation data with SQLite caching, rate limiting, and graceful offline degradation.

**Depends on**: Phase 19 (api_cache table must exist)

**Requirements**: PANEL-03, PANEL-04, PANEL-07, PANEL-08, PANEL-09, PANEL-10, META-06, META-07, META-10, INFRA-03, INFRA-04

**Success Criteria** (what must be TRUE):
  1. Ensembl VEP REST API returns consequence predictions and additional scores for any variant with response validation (zod schema)
  2. VEP API responses are cached in SQLite with 30-day TTL to avoid redundant requests
  3. VEP API requests respect 15 req/sec rate limit with exponential backoff on 429 responses (1s, 2s, 4s, 8s, max 3 retries)
  4. HPO API autocomplete returns phenotype terms matching search query by name, ID, and synonyms
  5. When offline, API requests fail gracefully with "API enrichment unavailable - offline" message instead of hanging or crashing
  6. Cached API data displays with "Cached data from [date]" indicator to user
  7. All API calls are proxied through Electron main process (not renderer) with no API keys in renderer code

**Plans**: 3 plans

Plans:
- [ ] 21-01-PLAN.md — API infrastructure: ApiCache, NetworkStatus, zod schemas, clinical thresholds
- [ ] 21-02-PLAN.md — VEP API client with rate limiting, caching, MANE Select transcript
- [ ] 21-03-PLAN.md — HPO API client, VEP/HPO IPC handlers, preload API

### Phase 22: Case Metadata
**Goal**: Users can assign status, cohort groups, and HPO phenotype terms to cases for stratification and phenotype-driven analysis.

**Depends on**: Phase 21 (HPO API client needed for autocomplete)

**Requirements**: META-01, META-02, META-03, META-04, META-05, META-08, META-09, META-11

**Success Criteria** (what must be TRUE):
  1. User can set affected/unaffected/unknown status for each case
  2. User can assign cases to cohort groups with user-defined names that autocomplete from previously created groups
  3. User can create new cohort groups with name and optional description
  4. User can assign a case to multiple cohort groups simultaneously
  5. User can add and remove HPO phenotype terms from a case via searchable autocomplete
  6. Case metadata (status, cohorts, HPO terms) displays in case list and case header
  7. Deleting a case cascades deletion of its metadata, cohort links, and phenotype associations

**Plans**: 3 plans

Plans:
- [ ] 22-01-PLAN.md — Backend: DatabaseService + IPC handlers for case metadata, cohorts, HPO terms
- [ ] 22-02-PLAN.md — Frontend: useCaseMetadata composable, StatusSelector, CohortCombobox
- [ ] 22-03-PLAN.md — UI Integration: CaseMetadataCard, HpoTermSelector, CaseList enhancement

### Phase 23: Side Panel UI
**Goal**: Variant details side panel displays all database annotations, comments, ACMG classification, and external links with edit capabilities.

**Depends on**: Phase 20 (annotation backend)

**Requirements**: PANEL-01, PANEL-02, PANEL-05, PANEL-06, ANNOT-03, ANNOT-04, ANNOT-07, INFRA-05

**Success Criteria** (what must be TRUE):
  1. User can click a variant row to open a details side panel (right drawer, persistent during navigation)
  2. Side panel displays all annotation scores from database (CADD, gnomAD AF)
  3. Side panel provides external link buttons to PubTator, LitVar, UCSC Genome Browser, Decipher, ClinGen, and Ensembl (with shell.openExternal allowlist updated)
  4. Side panel includes copy-to-clipboard buttons for HGVS notation, chr:pos:ref:alt, and genomic position
  5. User can edit and delete comments directly from side panel with inline editing and immediate UI update
  6. ACMG classification displays with color-coded badge and is editable via dropdown
  7. Panel width is resizable and preference persists across sessions

**Plans**: 3 plans

Plans:
- [ ] 23-01-PLAN.md — Panel infrastructure: resizable drawer, close behaviors, row click integration
- [ ] 23-02-PLAN.md — Content sections: variant identity, score chips, external links, copy-to-clipboard
- [ ] 23-03-PLAN.md — Comments editing, ACMG editing, shell domain allowlist

### Phase 24: Custom Tags + HPO Autocomplete
**Goal**: Users can create custom tags with colors, assign to variants, filter by tags, and search HPO terms with autocomplete.

**Depends on**: Phase 19 (tags schema), Phase 23 (side panel for tag assignment UI)

**Requirements**: ANNOT-08, ANNOT-09, ANNOT-10, ANNOT-11, META-06, META-07

**Success Criteria** (what must be TRUE):
  1. User can create custom tags with name and color in settings view
  2. User can assign multiple custom tags to any variant (per-case) with tag autocomplete from existing tags
  3. User can manage tags (rename, delete, recolor) in settings view without losing variant associations
  4. User can filter variant table by custom tags with multi-select dropdown
  5. HPO term autocomplete displays matching terms with ID, name, and synonyms as user types (min 2 characters)
  6. HPO term search works offline using bundled HPO JSON (16k terms, fallback when API unavailable)

**Plans**: 3 plans

Plans:
- [ ] 24-01-PLAN.md — Backend: Tag IPC handlers, useTags composable, useHpoBundled composable, bundled HPO JSON
- [ ] 24-02-PLAN.md — Tag management: TagManagementDialog, ColorSwatchPicker, settings integration
- [ ] 24-03-PLAN.md — UI integration: FilterToolbar tag filter, TagsSection in side panel, HpoAutocomplete component

## Progress

**Execution Order:**
Phases execute in numeric order: 19 → 20 → 21 → 22 → 23 → 24

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 19. Database Foundation | 2/2 | ✓ Complete | 2026-01-28 |
| 20. Annotation Core | 4/4 | ✓ Complete | 2026-01-28 |
| 21. API Service Layer | 0/3 | Ready | - |
| 22. Case Metadata | 0/3 | Ready | - |
| 23. Side Panel UI | 0/3 | Planned | - |
| 24. Custom Tags + HPO Autocomplete | 0/3 | Planned | - |

---
*Last updated: 2026-01-29 — Phase 24 plans created*
