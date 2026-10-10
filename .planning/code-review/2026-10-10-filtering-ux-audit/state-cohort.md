# VarLens saved state, cohort and shortlist audit

What this repo does: VarLens imports genetic variants and supports case filtering, cohort review, ranking and export. This audit assumes one analyst reviewing exome/genome-sized cases, switching cases while requests run, and occasionally reopening or sharing a web URL; both SQLite and PostgreSQL paths matter.

Read-only source audit on `chore/sprint-1-hardening-cleanup`. Initial HEAD: `6de042dde31e628b0bfd5305775f5e87102c4737`. Final source recheck: `8c2e01b480e0dd09a8b47aff2ad722314468d0d7`. The intervening changes touched `PostgresVariantReadRepository.ts`, `createPostgresStorageSession.ts`, and `VariantTable.vue`; I read that diff and none resolves these findings. Initial working tree was clean; at recheck another task had created `.planning/artifacts/filtering-ux-audit-2026-10-10/`. This agent writes only this report.

## Must fix

### 1. P1 — Clear all leaves cohort extension filters active

**Type:** confirmed bug. **Confidence:** high; source trace plus a pure, in-memory source probe.

**Scenario / actual / expected:** In the cohort drawer, set `sv.vaf >= 0.5`, then press Clear all. `filters.columnFilters` survives. The table and export keep applying it, although `hasActiveFilters` can become false. Clear all must remove the drawer filter as well as header and search filters.

**Evidence:** `useFilters.ts:189-213` resets a hand-maintained field list without `columnFilters`. `CohortFilterBar.vue:555-558` stores extension controls in that omitted dictionary; its Clear all handler at `563-568` clears only the shared scalar reset, DSL and separate table-header state. `CohortTable.vue:283-291` still merges the surviving dictionary into the query, and `409-415` reuses it for export. All paths are under `src/renderer/src/`.

**Smallest fix / reuse:** Clear `filters.value.columnFilters` in `createFilters().clearAllFilters()`. Prefer the existing `createFilterState()` defaults if replacing the manual reset is equally small; preserve the separate refs for search/preset UI. Do not add another reset layer.

**Affected callers:** cohort toolbar and drawer, `CohortTable`, `createFilters().reset()`, and cohort export on both backends. `AssociationConfigPanel` also owns a `createFilters()` instance, so retain its existing initialization behavior.

**Tests / acceptance:** `tests/renderer/composables/useFilters.test.ts:187-235` tests scalar/preset resets, but does not seed extension filters before reset. Add an extension-only reset case and a component assertion that the next table/export payload lacks `column_filters`. The probe using the real source returned `columnFiltersAfterClear={"sv.vaf":{"operator":">=","value":0.5}}`, `hasActiveFilters=false`, and the same filter in `getIpcParams()`.

**Issue-ready draft:**

> **Title:** fix(cohort): Clear all must remove drawer extension filters
>
> Applying an SV/CNV/STR drawer filter and pressing Clear all leaves that filter in the table and exported file. `createFilters().clearAllFilters()` omits `columnFilters`; header-filter clearing does not reach this separate dictionary. Clear it at the shared reset owner. Acceptance: an extension-only filter is removed from state, table request and export request by one Clear all action. Add the regression to `useFilters.test.ts` and the cohort toolbar/table boundary tests.

### 2. P1 — A newly selected case shows clickable shortlist rows from the previous case

**Type:** confirmed state-scope bug. **Confidence:** high for display/context mismatch; persisted annotation damage was not tested or claimed.

**Scenario / actual / expected:** Load case A's shortlist, then select B while B's shortlist query is delayed. A's `result` remains visible under B's case heading and can still open a detail panel. Case changes must immediately remove rows from the previous case; keeping rows during a same-case refresh is useful and can remain.

**Evidence:** `src/renderer/src/composables/useShortlistQuery.ts:91-106,127-132` starts the new request without clearing `result`. Its request ID correctly rejects late responses, but does not invalidate already displayed rows. `ShortlistPanel.vue:190-196` renders those rows and forwards clicks while loading. `CaseView.vue:473-479` keeps the same panel instance across case IDs; `325-327` accepts its row. `App.vue:69-74` supplies the currently selected case ID to details independently of that row. The stale CSS changes opacity only.

**Smallest fix / reuse:** In the case-change path, invalidate the displayed result before fetching. Follow the existing case table's reset behavior (`components/variant-table/useVariantData.ts:176-198`). Reuse `useTableLoadingState.resetFirstLoad()` where needed; no new cache or transport abstraction.

**Affected callers:** ShortlistPanel, CaseView row selection, and the case detail panel. Inline shortlist stars use `row.case_id`; the detail panel instead receives the selected case, so the risk is not identical across actions.

**Tests / acceptance:** `tests/renderer/composables/useShortlistQuery.test.ts:284-340` covers slow old responses after newer responses, not a case change while existing rows remain. Seed A, defer B, change case ID, assert A is immediately absent/non-interactive, then resolve B. Keep the existing same-case refresh behavior and late-response test.

**Issue-ready draft:**

> **Title:** fix(shortlist): clear old case rows immediately on case switch
>
> The shortlist retains case A's rows while case B loads. Those rows remain clickable, and details receive B's selected case ID with A's variant. Clear the result when the case ID changes, while preserving same-case stale-while-refresh behavior. Acceptance: delayed and failed B requests never leave A's variants actionable under B; late A responses cannot repopulate them. Add a deferred-response case-switch test.

### 3. P1 — STR ranking presents inferred disease-locus knowledge as a ClinVar P/LP assertion

**Type:** confirmed evidence/provenance bug. **Confidence:** high; pure scoring source was exercised in memory with only logging stubbed.

**Scenario / actual / expected:** A shortlisted STR has a nonempty disease name and `clinvar=null`. `scoreStr()` manufactures a ClinVar component of `0.9`, and the tooltip reports “Pinned: ClinVar P/LP.” This also happens with `str_status='normal'` or null. An inferred locus contribution must not claim an actual ClinVar classification.

**Evidence:** `src/main/services/scoring/score-str.ts:44-58` bases the shortcut only on `str_disease`. `scoring/index.ts:124-127` treats that component as ClinVar pin eligibility. `src/renderer/src/components/shortlist/RankScoreTooltip.vue:34-44` labels it ClinVar P/LP. The VCF parser accepts disease and status independently (`src/main/import/vcf/extension-parsers.ts:140-155`). Both shortlist services share this scorer.

**Smallest fix / reuse:** Use the existing `mapClinvarBoost(row.clinvar)` for the ClinVar component and pin. Keep any deliberate locus/status heuristic in the existing impact/pathogenicity components, with an explicit normal/unknown-status policy. Do not add a new evidence framework to fix this label/source mismatch.

**Affected callers:** both shortlist backends, comparator pin partitions, score tooltip and its pin label. Review ranking snapshots as a behavior change, not a mechanical snapshot update.

**Tests / acceptance:** `tests/main/services/scoring/score-str.test.ts:50-65` tests normal/null only with `str_disease=null`; its known-locus test at `78-85` uses pathologic status. Add the disease-present/status-normal-or-null cross-cases and a tooltip check. Probe output for normal and null status was `rank_score=0.725`, `rank_components.clinvar=0.9`, `rank_clinvar_pinned=true`, despite `clinvar=null`. Pathologic status with no ClinVar also receives the false evidence label.

**Issue-ready draft:**

> **Title:** fix(shortlist): do not label inferred STR locus boosts as ClinVar P/LP
>
> STR rows with a disease name and no ClinVar annotation receive a 0.9 ClinVar component and a “ClinVar P/LP” pin. Normal and unknown STR status are also eligible. Base ClinVar scoring/pinning on the actual annotation; represent any retained STR heuristic through the appropriate existing score components. Acceptance: missing ClinVar never displays a ClinVar assertion; test known disease with normal, unknown and pathologic status.

## Should fix

### 4. P2 — Carrier drilldown discards variant identity and opens the default case tab

**Type:** confirmed navigation bug. **Confidence:** high from the complete event chain.

**Scenario / actual / expected:** Expand a cohort SV without gene/cDNA annotation and click a carrier case. The event contains coordinates and alleles, but the destination drops them; it opens the case with no target search and normally lands on Shortlist. A carrier drilldown should open that carried variant in its type tab. Gene-only annotations also broaden the destination to every matching variant; transcript-specific cDNA can fail to match the carrier's representative annotation.

**Evidence:** `src/renderer/src/components/CohortTable.vue:555-565` emits chr/pos/ref/alt. `src/renderer/src/views/CohortView.vue:16-37,58` ignores them and creates only a gene/cDNA string. The payload omits variant type. `views/CaseView.vue:164-194,202-214` chooses the configured default, and `useShortlistQuery.ts:94-98` receives only case/preset, not this search.

**Smallest fix / reuse:** Carry type and exact identity through the existing navigation payload; open the corresponding case tab and apply an exact coordinate/allele filter through the existing typed filter state. Reuse the URL/tab binding where appropriate. Avoid adding another search syntax or identifying a variant by a transcript annotation.

**Affected callers:** CarrierExpandedRow → CohortDataTable → CohortTable → both CohortView layers → case selection/tab/filter restoration.

**Tests / acceptance:** `tests/renderer/composables/cohort-deep-link.test.ts` covers keeping `/cohort` during database startup, not carrier navigation. `tests/renderer/views/CaseView.test.ts` covers the default Shortlist behavior. Add a carrier-click integration test with null gene/cDNA, two alleles at one position, and an SV; the exact clicked carrier variant must be visible under its correct case/type.

**Issue-ready draft:**

> **Title:** fix(cohort): open the exact carried variant from carrier drilldown
>
> Carrier navigation supplies chr/pos/ref/alt but the receiving view discards them, searches gene/cDNA, and selects the default case tab. Unannotated variants therefore open an unrelated shortlist or unfiltered case. Preserve identity and type in the navigation intent. Acceptance: null gene/cDNA, multiple alleles and non-SNV variants all land on the exact carried variant.

### 5. P2 — Active case preset chips do not deactivate when their filters are edited

**Type:** confirmed reactivity bug. **Confidence:** high; installed Vue probe reproduced the missed notification.

**Scenario / actual / expected:** Apply a rare-frequency preset, then change AF from 0.001 to 0.05 in the case drawer. The query changes but the preset chip remains active. The chip must stop claiming that preset is applied once one of its managed values differs.

**Evidence:** `src/renderer/src/components/FilterToolbar.vue:434-453` serializes `toRaw(filters.value)` inside a computed value. Vue observes ref replacement but not the nested properties read through the raw object. `components/cohort/CohortFilterBar.vue:269-290` already uses the reactive object correctly. The pure Vue probe observed `currentFilter=0.05`, cached divergence key still `0.001`, and zero watcher notifications.

**Smallest fix / reuse:** Remove `toRaw` from this computed getter and retain `isPresetDiverged`. Follow the cohort watcher rather than creating another preset state system. Keep the temporary apply guard so applying multiple presets does not immediately deactivate them.

**Affected callers:** case FilterToolbar, preset chip display and next preset toggle/merge. This is not the old preset-save/default-merge bug.

**Tests / acceptance:** `tests/renderer/utils/filters/presetApplication.test.ts:118-132` directly calls the divergence helper and therefore cannot catch this watcher bug. Add a mounted toolbar test: apply preset, edit managed AF/CADD value, flush Vue, assert preset inactive and edited value retained. Unmanaged gene/search edits must not deactivate a matching preset.

**Issue-ready draft:**

> **Title:** fix(filters): track reactive field changes when deactivating presets
>
> The case toolbar watches `JSON.stringify(toRaw(filters.value))`, so nested edits never invalidate its computed divergence key. An AF/CADD preset remains marked active after the analyst changes its threshold. Serialize the reactive filter state as the cohort toolbar does. Acceptance: managed-field edits deactivate the preset without discarding the edit; unmanaged search/gene edits do not.

### 6. P2 — Cohort URLs lose the selected genome build

**Type:** confirmed state-restoration bug. **Confidence:** high from binding and initialization code; browser reload not run by this agent.

**Scenario / actual / expected:** In a database containing GRCh37 and GRCh38, choose GRCh37, refine filters, and reload/share the web URL. The URL retains filters and type but has no build binding. The new view defaults to GRCh38 and keeps it because that build exists, silently changing the result population. A reloadable cohort link must preserve this query scope.

**Evidence:** `src/renderer/src/components/CohortView.vue:90-103` registers filters and variant type only; search/sort are registered elsewhere. `composables/useCohortData.ts:179,371-381` initializes GRCh38 and only replaces it if absent. Queries apply `genome_build` in `buildIpcParams`, and export applies it at `components/CohortTable.vue:410-415`.

**Smallest fix / reuse:** Add a genome-build binding using the existing `useUrlParam`; validate against available builds and handle an unavailable linked build explicitly. No new persistence table is needed for URL parity.

**Affected callers:** CohortView build selector, URL reload/back/forward, cohort query, export scope and panel-region resolution.

**Tests / acceptance:** `tests/renderer/composables/useUrlState.test.ts` verifies the binding mechanism; `tests/renderer/utils/url-state/view-query.test.ts` round-trips filter snapshots and type/sort values. Neither registers a build. Add a mixed-build fixture and verify build + type + filters survive a fresh view/reload and drive identical query/export scope.

**Issue-ready draft:**

> **Title:** fix(cohort): preserve genome build in shareable view URLs
>
> GRCh37 cohort URLs reopen as GRCh38 when both builds are present because the selector has no URL binding. Register the selected build through `useUrlParam` and validate it when available builds load. Acceptance: a mixed-build URL round-trip preserves build, result membership and export scope; an unavailable build is reported instead of silently substituted.

### 7. P2 — Replace insertion-order shortlist preselection with complete ranking

**Type:** improvement opportunity with a concrete recall limit, not an undisclosed current-contract regression. **Confidence:** high for the omission mechanism; no performance estimate claimed.

**Scenario / actual / expected:** Under Tier 1 (`topN=50`), 200 qualifying SNVs have lower IDs than a subsequently imported qualifying pathogenic/starred SNV. That later row is never scored or pinned. A complete ranked shortlist should consider all qualifying rows and remain unchanged if their import order changes.

**Evidence:** `src/main/database/ShortlistService.ts:225` caps each type at `topN*4`; `shortlist-query.ts:130-131` applies ID order before the limit. PostgreSQL does the same at `src/main/storage/postgres/PostgresShortlistService.ts:63-77`. `src/renderer/src/components/shortlist/ShortlistPanel.vue:69-76` now clearly discloses capped preselection; `tests/main/database/ShortlistService.test.ts:394-413` explicitly locks in the cap. This is a deliberate existing limitation. “Likely candidates” does not describe a score-based preselection: it is the first matching IDs.

**Smallest complete change / reuse:** Reuse the current filter query, scorer and comparator while reading candidates in bounded ID pages and retaining the best N as pages are processed. Ensure every eligible row reaches scoring. A larger fixed cap, or sorting only by CADD, does not provide complete ranking under the existing configurable comparator. Measure before choosing optimizations; do not load unbounded genome results into renderer memory.

**Affected callers:** SQLite/PostgreSQL shortlist services, `totalCandidates` meaning, result summary and cap-specific tests.

**Tests / acceptance:** Retain filter/parity tests; replace the cap expectation with a >200-row Tier 1 fixture whose last row is pinned/highest scoring. Shuffle IDs/import order and assert the same ranked identities. Add a bounded-memory/performance check at the supported case size. This is independent of missingness policy; do not silently retune score weights while fixing candidate recall.

**Issue-ready draft:**

> **Title:** feat(shortlist): rank every qualifying candidate without insertion-order bias
>
> Tier 1 ranks only the first 200 matching rows per variant type, so a later pathogenic or starred match can never appear. The UI discloses this cap today. Replace ID-prefix preselection with bounded candidate scanning using the existing scorer/comparator. Acceptance: pinned/highest-scoring candidates beyond the old cap are found on both backends, results are import-order invariant, and memory stays bounded.

## Existing issues and verified strengths

- Open [#124](https://github.com/berntpopp/VarLens/issues/124) already owns durable per-case filter state and its audit trail. Extend that issue for complete analysis snapshots rather than opening a duplicate “save analysis” request. Current reusable presets intentionally save only supported managed fields; that is distinct from saving the whole analysis state.
- Closed [#504](https://github.com/berntpopp/VarLens/issues/504) fixed preset default merging, impact-chip saving, numeric-input clearing and header-filter request identity. Those fixes are present. Finding 5 is a separate surviving watcher defect; do not reopen all of #504's old claims.
- Closed [#516](https://github.com/berntpopp/VarLens/issues/516) concerned duplicate genotype resolution. It is not re-reported here; its title/body is historical context, not evidence of a current bug.
- Query/export membership is now deliberately shared: the case export receives `buildQueryFilters`, and cohort query/export use `buildCohortQueryParams`. Do not report the previous export filter omission as current.
- Both shortlist backends route candidate filters through the case filter pipeline; stored shortlist configuration is validated, and per-type failures abort instead of silently narrowing results. Existing backend/filter tests cover these important boundaries.
- Pagination has bounded page/cursor caches, latest-request guards, filter-aware request identity and count reuse. Existing tests cover stale response order and count-cache behavior. The remaining shortlist case-switch finding is about displayed scope, not a claim that all request guards are missing.
- Score components and pin reasons are visible, and candidate truncation is disclosed. Preserve that transparency while fixing the inaccurate STR evidence label.

## Verification limits

Read source, relevant tests and the three-file concurrent diff. Ran three read-only probes: installed Vue dependency tracking; `createFilters` reset/serialization from source transpiled in memory; shared scoring source transpiled in memory with logging stubbed. No repository files were executed as standalone scripts, no production files were changed, and no database or network writes were made by this agent. Root coordinates the test suite and browser checks; no passing full-suite or browser claim is made here.

Not exhaustively checked: every association statistical method/cancellation path, PostgreSQL query plans at WGS scale, all URL combinations, and real UI interaction timing. The strongest concrete findings are retained; speculative optimization and broad architecture changes are omitted.

Verdict: fix reset completeness, case-scoped shortlist display and STR evidence labeling first. The smallest fixes reuse existing state owners and scoring helpers.

Not checked: runtime browser reproduction or full CI by this agent. Risk: source-confirmed scope/provenance defects can mislead review even when queries themselves are correct.
