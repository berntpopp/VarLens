# Renderer query cache, step 4: the remaining simple caches

- **Issue:** #193, step 4. Steps 2 and 3 are the pilot, PR #470.
- **Convention:** `.planning/specs/2026-10-07-renderer-query-cache-pilot.md`,
  sections 4 and 10 to 12. This document only says what moves where; it does
  not reopen anything decided there.

## 1. Scope

Eight caches or fetch race guards move onto the query cache in three PRs, then
a fourth PR turns on focus and reconnect refetch in web mode.

Out of scope, unchanged from #193: the case, cohort and shortlist tables, the
annotation cache, import-wizard and other workflow guards, `summaryStale` and
the "dim while refetching" flag. `useCaseMetadata`'s own metadata cache is not
on the step 4 list and stays.

## 2. Rules for every PR

- One `defineQueryOptions` module per domain in `src/renderer/src/queries/`.
- Keys are written only in `keys.ts`, rooted at `['db', revision]`, then case
  or cohort scope where the data has one.
- Reads are real `useQuery` consumers created during setup, options passed as
  a getter.
- Capability gates go through `canQuery()` / `loadIfAllowed()`. Where the
  storage flag exists but the renderer's `CapabilityPath` does not list it,
  the path is added.
- `invalidateServerData()` stays the only cross-cutting invalidation. A write
  invalidates its own key after the IPC call has succeeded; a refetch that
  fails afterwards is logged by the cache and never fails the write.
- Every moved module is added to `MIGRATED` in
  `tests/renderer/queries/no-private-caches.test.ts`.
- Tests are written first and fail first. Per cache: database switch; scope
  switch with the old response arriving last; import complete and case delete
  (`data-changed`); any optimistic write.
- Case and cohort view stay in parity in the same PR.
- Each PR reports `git diff --numstat origin/main...HEAD -- src/`.

## 3. PR 1: the case metadata modal

| Data | Today | Key | Stale time |
|---|---|---|---|
| Case comments | `useCaseComments.ts` over `per-case-cache.ts` | `[db, rev, 'case', id, 'comments']` | 0 |
| Case metrics | `useCaseMetrics.ts` over `per-case-cache.ts` | `[db, rev, 'case', id, 'metrics']` | 0 |
| Metric definitions | module ref plus `loaded` flag | `[db, rev, 'metric-definitions']` | default |
| Data info tab | six reads behind a generation counter in `CaseDataInfoTab.vue` | `[db, rev, 'case', id, 'data-info']` | 0 |

- **Stale time 0** keeps today's behaviour: these are edited by people and are
  refetched each time their tab mounts or moves to another case. It is the
  same exception the pilot made for tags.
- **Gates:** `workflow.caseComments` and `workflow.caseMetrics` are added to
  `CapabilityPath`. The data info reads have no storage flag and are gated on
  the case id only.
- **Writes:** comment create, update and delete, metric upsert and delete, and
  metric-definition create invalidate their key and await the refetch. This
  replaces four hand-written in-place cache edits.
- **Data info** is an edit form. One query returns what the tab loads today
  (data info, external ids, platform and id-type suggestions, gene lists,
  region files), all or nothing as now. The form fields are filled once per
  case from the first result and are not overwritten by a later refetch, so
  typing is never lost. Saving stays blocked until the current case's data
  has loaded. External-id writes and the gene-list and region-file dialogs
  invalidate the query. An entry is dropped as soon as nothing shows it
  (`gcTime: 0`), so reopening a case never fills the form from a copy older
  than the user's last save.
- **Tab badges** in `CaseMetadataModal` read the same queries while the modal
  is open, so the counts show without first visiting the tab.
- **Goes away:** `per-case-cache.ts`; the comment and metric eviction in
  `useCaseMetadata.clearCache`, `invalidateCase` and `invalidateAllCases`
  (the database revision and `data-changed` cover them).

## 4. PR 2: the variant details panel (case and cohort view)

| Data | Today | Key |
|---|---|---|
| Transcripts of a variant | `useTranscripts.ts`, token guard | `[db, rev, 'variant', id, 'transcripts']` |
| Protein mapping, gene structure | `useProteinData.ts`, generation guard | `[db, rev, 'protein', 'mapping' \| 'gene-structure', gene]` |
| Protein domains, structure | same | `[db, rev, 'protein', 'domains' \| 'structure', accession]` |
| VEP, MyVariant, SpliceAI | `useVepEnrichment.ts`, generation guard | `[db, rev, 'enrichment', provider, chr, pos, ref, alt]` |

- Protein and enrichment data come from external services, not the open
  database. They are still keyed under the root so one rule covers every key;
  the cost is a refetch of what is mounted after an import, which the
  main-process caches absorb.
- Domains and structure are enabled once the mapping query has an accession
  (a dependent query).
- VEP enrichment stays on demand: its three queries are enabled when the user
  asks, and the request is forgotten when the variant changes, as today.
- Transcript switch and insert-and-switch invalidate the transcript key.
- Gates are the existing feature checks (`proteinViewer`, `vepEnrichment`,
  `myvariantEnrichment`, `spliceaiEnrichment`), read reactively.

## 5. PR 3: the cohort table and the filter toolbar

| Data | Today | Key |
|---|---|---|
| Carriers of a cohort variant | `useCarriers.ts`: map, error set, in-flight map, epoch | `[db, rev, 'carriers', variantKey]` |
| Panel resolution status | `usePanelResolutionStatus.ts`, generation guard | `[db, rev, 'panel-resolution', requestKey]` |

- Each expanded row owns its carrier query (the pattern of
  `ExtensionColumnControl`). `expandedRows` is UI state and stays. Gate:
  `cohort.carriers`, added to `CapabilityPath`.
- `useCarriers().reset()` in `resetForDatabaseSwitch` and the
  `reloadExpanded` calls go away: the revision and `data-changed` cover them.
  The summary-rebuild event invalidates the carrier keys.
- Panel resolution keeps clearing the previous answer on a scope change (no
  placeholder), and is invalidated when the panel list changes and when a
  kept-alive view is activated. Gate: `workflow.panels`. Used by case and
  cohort view through the same composable.

## 6. PR 4: focus and reconnect refetch in web mode

- The capability document gains `refetchOnFocus: boolean`, computed in
  `computeCapabilityDocument`: true for the web runtime, false for desktop.
  The renderer reads it from the capability store, never from
  `isWebRuntime()`.
- Nothing in the cache goes stale by time (`staleTime: Infinity`), so the
  library's own `refetchOnWindowFocus` / `refetchOnReconnect` would never
  fire; they stay off. `queries/focus-refetch.ts` listens instead and, when
  the flag is on, sends `invalidateServerData('data-changed')`: mounted
  entries are marked stale and refetched, the cohort scope first.
- Focus refetches at most once per 30 seconds; a reconnect always refetches.
- No retry plugin is installed. If one is added for web later it must use
  `isRetryableError()`.
- Desktop behaviour does not change; a test pins that no query refetches on
  focus with the desktop document.
