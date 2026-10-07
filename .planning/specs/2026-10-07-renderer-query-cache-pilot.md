# Renderer query cache pilot (Pinia Colada)

- **Issue:** #193, steps 2 and 3. Step 1 shipped in PR #465 (v0.76.3).
- **Status:** revision 2. Approved to implement on 2026-10-07 after an external
  review (Codex, `gpt-6-astra`, effort xhigh); section 10 lists what the review
  changed.
- **Branch / worktree:** `feat/renderer-colada-pilot` in `VarLens-wt/colada-pilot`, based on `c7ed3149`.

## 1. Goal

Move four server-derived, read-mostly caches onto one query cache with one key
convention and one invalidation entry point, and use the result to decide
whether the rest of the simple caches should follow (step 4).

Decided in #193 and not reopened here: the library is `@pinia/colada`; Pinia
Colada owns server-derived data and Pinia stores keep UI state; the tables, the
annotation cache, workflow guards, `summaryStale` and the "dim while
refetching" flag stay hand-written.

Design rules for this pilot: follow the layout the Pinia Colada documentation
recommends (key factories plus `defineQueryOptions` per domain, real `useQuery`
consumers), one module per responsibility, nothing duplicated between the four
domains, and no abstraction that only one caller needs.

## 2. What migrates

| Data | Today | Lines (`wc -l`) |
|---|---|---|
| Column metadata and variant types present | `useVariantColumnMeta.ts`: two module refs, two in-flight maps, `cacheEpoch` | 191 |
| Filter options | `useFilterOptionsCache.ts`: per-instance `LruMap(20)` | 182 |
| Tags (list and per-variant tags) | `useTags.ts`: two module caches, a loading map, `cacheEpoch` | 421 |
| Filter presets | `useFilterPresetStore.ts`: module list, `loaded` flag, in-flight promise | 214 |

Total 1,008 lines. `ExtensionColumnFilters.vue` also holds a local `metaMap`,
`failedKeys` and `pendingKeys` keyed by column, reset on scope or `cacheEpoch`
change.

One small addition is required for cohort parity (section 4.8): the list of
case ids that `CohortFilterBar` loads once on mount and uses as the cohort
scope. It is the input to the cohort column-metadata keys, so it has to be
invalidated with them.

Stays where it is, because it is UI state and not server data: which presets
are toggled on per scope (`activeByScope`), `getActiveFilterState`, and
`TAG_COLORS`.

## 3. Findings on the two open questions

**Does Pinia Colada hold large results shallowly?** Yes, with no configuration.
Each entry's `state` and `asyncStatus` are `shallowRef`s, the entry is
`markRaw`, and the cache map is a `shallowRef` updated with `triggerRef`.
Confirmed by running the library: a nested result is not reactive. A test pins
this so an upgrade cannot change it silently.

**Is the devtools dependency chain acceptable?** No; the pilot ships without
devtools. Measured with a lockfile-only install against Vue 3.5, Pinia 4 and
Vite 7:

| Install | Packages |
|---|---|
| Baseline | 91 |
| + `@pinia/colada@1.4.7` | 92 (adds `nostics`, a 97 kB diagnostics library) |
| + `@pinia/colada-devtools@2.0.1` and its four required peers | 134 |

The devtools add 42 packages, including a pre-1.0 `@vitejs/devtools-kit`
(0.7.x) and `@devframes/agentic`. That is a large addition to what Trivy,
Gitleaks and `npm audit` have to cover, for a tool the pilot does not need.

## 4. Design

### 4.1 Modules

New directory `src/renderer/src/queries/`, one responsibility per file:

| File | Responsibility |
|---|---|
| `client.ts` | Install Pinia Colada with the global defaults; `isRetryableError`. |
| `keys.ts` | The key factory. The only place a key is written. |
| `invalidation.ts` | `invalidateServerData(event)`, the one invalidation entry point. |
| `use-queries.ts` | `useQueries`: one `useQuery` per item of a reactive list (Colada has none). |
| `column-meta.ts`, `filter-options.ts`, `tags.ts`, `filter-presets.ts`, `cases.ts` | Per domain: `defineQueryOptions` (key, query function, capability gate). No Vue component state. |

The four existing composables stay as thin facades over these modules, so
their callers keep working.

### 4.2 Global defaults

| Option | Value | Why |
|---|---|---|
| `staleTime` | `Infinity` | Data only changes on known events; invalidation is explicit. |
| `refetchOnMount` | `true` | In Colada this means "refresh on mount only if stale or failed". With `staleTime: Infinity`, fresh data is never refetched on mount, which is the requirement. With `false`, an entry invalidated while nothing was mounted would be shown stale for ever (confirmed by the review). |
| `refetchOnWindowFocus`, `refetchOnReconnect` | `false` | The pilot does not change web behaviour. Step 4 turns these on for web, driven by a capability flag, not `isWebRuntime()`. |
| `gcTime` | 5 minutes (library default) | Bounds every cache; replaces the ad-hoc `LruMap(20)` and the unbounded maps. |
| retry | none | The retry plugin is not installed. |

Errors are typed `SerializableError | Error`. Without the retry plugin the
"never retry `VALIDATION`, `NOT_FOUND`, `FORBIDDEN`, `UNSUPPORTED_RUNTIME`,
`CONFLICT`" rule holds trivially. It is still written now as a pure function
`isRetryableError(error)` with tests, so step 4 can hand it to the retry plugin
in web mode.

### 4.3 Database identity and keys

`databaseStore` gains a `revision` counter, incremented every time it publishes
which database is open (open, create, Postgres profile, initial load, close).
The key root is `['db', revision]`. A path is not used: a database can be
recreated at the same path, and the web workspace has no path.

```
['db', rev, 'tags']
['db', rev, 'filter-presets']
['db', rev, 'case-ids']
['db', rev, 'case', caseId, 'filter-options']
['db', rev, 'case', caseId, 'variant-tags', variantId]
['db', rev, 'case', caseId, 'types-present']
['db', rev, 'case', caseId, 'column-meta', columnKey]
['db', rev, 'cohort', sortedCaseIds, 'types-present']
['db', rev, 'cohort', sortedCaseIds, 'column-meta', columnKey]
```

Every consumer passes its options as a getter, so a key is recomputed when the
revision or the scope changes; no key is captured at setup time. Cohort scope
keeps today's behaviour of sorting the case ids.

Because the identity lives in the store and not in the invalidation call, the
two places that react to one database switch (the path watcher and
`handleDatabaseSwitched`) cannot advance it twice.

### 4.4 Reading

All reads are real `useQuery` consumers, created during setup. That gives each
entry an owner, so the library handles garbage collection, refetch of mounted
queries on invalidation, the `enabled` gate and (in step 4) focus and
reconnect refetch. There is no imperative "fetch by key" helper.

- **Tag list, preset list, case ids, types present:** one `useQuery` each.
- **Filter options, tags of the shown variant:** the facade keeps a ref for
  the current target (`loadFilterOptions(caseId)` and
  `loadVariantTags(caseId, variantId)` set it) and one `useQuery` keyed by it.
- **Column metadata:** `useQueries` over the columns of the visible sections.
  A column that leaves the list is released and collected normally.

From the library, not from our code: one request per key however many callers
ask at once, a late response dropped when a newer request or an invalidation
supersedes it, and loading and error state.

An invalidation that cancels a request in flight makes the caller's promise
resolve with an empty pending state, not reject (confirmed by running the
library). The facades' `load*` functions therefore return `void` and callers
read the reactive result, as they do today.

### 4.5 Capability gates

Each query's `enabled` is the existing storage-capability check
(`currentCanUseFeature(path)` in `utils/backend-capabilities.ts`, which reads
the capability store and fails closed until the document has loaded):
`variants.columnMeta`, `variants.typesPresent` (flag exists, path is added),
`variants.filterOptions`, `workflow.tags`, `workflow.filterPresets`.

`enabled` stops automatic fetching but an explicit `refresh()` ignores it, so
the facades' `load*` functions check the same gate before refreshing and log
the block reason as today. No `isWebRuntime()` and no `typeof window.api.x`.

### 4.6 Invalidation: one entry point

`invalidateServerData(event)`:

| Event | Effect |
|---|---|
| `database-switch` | Cancel every request that is not under the current root and remove those entries that have no consumer. Entries still held by a component are left to the library: their consumers re-key to the new root and the old entries are collected. Safe to call more than once. |
| `data-changed` (import complete, case delete, delete all) | Invalidate everything under the current root. Mounted queries refetch once; the rest refresh on next mount. |

Entries are never removed while a component reads them; the library warns
about that and the reader would be disconnected from the cache.

Call sites:

- `useAppState.resetForDatabaseSwitch` → `database-switch`. Replaces
  `invalidateFilterPresets()`, `invalidateAllVariantColumnMeta()` and
  `resetTagCaches()`. `useCarriers().reset()` stays until step 4.
- `useShellLifecycle.handleImportComplete` and `handleBatchImportComplete` →
  `data-changed`. Replace `if (isWebRuntime()) variantColumnMeta.invalidateAll()`.
- `useCaseDeletion` → `data-changed` in the `finally` of `deleteCase`,
  `deleteCases` and `deleteAllCases`, next to the existing metadata eviction.
  This runs after the delete has settled. `App.handleCaseDeleted` fires
  before the delete starts (the list is updated optimistically), so its
  `isWebRuntime()` call is removed and not replaced there.

**Behaviour change:** on desktop, an import or delete now also invalidates,
where today only web does. The cost is one refetch of what is mounted,
including consumers in a kept-alive view. Step 1 showed desktop does not
strictly need it; one rule for both runtimes is the point of the entry point
and removes three `isWebRuntime()` branches. A test bounds the number of
refetches per event. The existing perf and UI gates do not exercise import or
delete, so they cannot show this cost; if the bound test or manual checking
shows a problem, the fallback is `invalidateQueries(…, false)` on desktop
(mark stale, refetch on next mount).

### 4.7 Writes

Signatures and semantics stay as they are.

- **Presets** (create, update, delete, reorder): after the IPC call, invalidate
  the preset key and await the refetch (today: `reloadPresets()`).
- **Tag list** (create, update, delete): after the IPC call, invalidate the tag
  list and the per-variant tag entries and await the refetch. This replaces
  three hand-written in-place cache edits.
- **Variant tags** (assign, remove, set): optimistic, through one shared
  helper that follows the documented pattern: capture the key and the root,
  cancel reads on that key, write the optimistic value, run the IPC call, and
  on failure roll back only if the cache still holds our value. If the root
  changed while the call was running, nothing is written.

`useMutation` is not adopted in the pilot. The callers await plain async
functions; wrapping them adds lines without removing any.

The nine-line error-formatting block repeated across `useTags.ts` and
`useFilterOptionsCache.ts` is replaced by the existing `formatError`.

### 4.8 Public shapes

| Composable | Kept | Removed |
|---|---|---|
| `useFilterOptionsCache` | `filterOptions` (read-only, same empty default), `loadFilterOptions`, `loadFilterOptionsAndTags` | `invalidateFilterOptionsCache` (zero callers; also dropped from `filter-types.ts` and `useFilterState`) |
| `useFilterPresetStore` | everything it returns today; the test reset helper, narrowed to the active-preset UI state | module export `invalidateFilterPresets` |
| `useTags` | everything a component uses, `TAG_COLORS` | `resetTagCaches`; `loadVariantTagsBatch`, `hasTag`, `toggleVariantTag`, `setVariantTags` if they still have no caller when the code is written |
| `useVariantColumnMeta` | — | replaced, see below |

Kept behaviours: tag and filter-option reads log and swallow errors; preset
reads reject; preset mutations resolve after the list has refreshed.

**`useVariantColumnMeta` and `ExtensionColumnFilters.vue`.** Of the two options
in the brief, the pilot takes the second. The composable becomes declarative:
`useVariantColumnMeta(scope, columnKeys)` returns `typesPresent`, the metadata
per column and the set of failed columns, all read from the query cache.
`ExtensionColumnFilters` is its only consumer; its local `metaMap`,
`failedKeys`, `pendingKeys`, `dataKey` and the `cacheEpoch` watch are deleted.
A failed column still fetches once and is not retried on re-render. Props,
emits and template stay the same.

**`CohortFilterBar.vue`** reads the case ids from the `case-ids` query in place
of its mount-time `loadCohortCaseIds()`.

No other component changes.

### 4.9 Case and cohort parity

Column metadata, types present and presets are shared by the case and cohort
views through the same composables, so both move in this one PR. The cohort
scope (the case-id list) is invalidated by the same event as the data keyed by
it, so after an import the cohort drawer asks for the new set of cases, not
the old subset.

## 5. Tests (written first, failing)

A shared helper in `tests/renderer/helpers/` runs a composable inside a mounted
component with Pinia and Pinia Colada installed.

`tests/renderer/queries/`:

- Keys: stable for reordered cohort ids; different revisions never equal; case
  and cohort scopes never collide.
- Defaults: fresh data is not refetched on remount; an entry invalidated while
  unmounted is refetched on remount; no retry after an error.
- `isRetryableError`: the five listed codes are never retryable, for both
  `SerializableError` and `Error`.
- Shallow storage: a nested result is not reactive.
- `useQueries`: one query per item; a removed item is released and collected.
- Capability gate: no fetch while the capability document is missing or the
  flag is off, including through `load*`; fetches once it turns on.
- Invalidation: `database-switch` is idempotent and never removes an entry
  that has a consumer; `data-changed` refetches each mounted query exactly
  once.

Stale-cache bug class, per data type (this is the step 3 evidence):

| Event | Asserted |
|---|---|
| Database switch | Old data is not shown for the same case id; a response in flight across the switch is not visible afterwards; the path watcher followed by `handleDatabaseSwitched` does not fetch twice. |
| Case switch | The new case never shows the previous case's result, including when the previous request resolves last. |
| Import complete | Mounted queries refetch; the cohort scope picks up the new case before its column metadata is asked for. |
| Case delete / delete all | Invalidation happens after the delete settles, on success and on failure. |
| Tag writes | A write that resolves or fails after a database switch changes nothing; a read racing an optimistic write does not overwrite it. |

Existing suites for the four composables and `ExtensionColumnFilters` (about
1,240 lines) are rewritten against the kept public shapes. Suites that mock a
composable (`AssociationConfigPanel`, `useShortlistQuery`, `useFilterState*`)
are adjusted only where a changed member is referenced.

`useAppState`, `useShellLifecycle` and `useCaseDeletion` tests assert that each
event calls `invalidateServerData` with the right argument.

## 6. Step 3 exit criteria and how each is measured

1. **Net authored source lines go down.** Added minus deleted lines from
   `git diff --numstat origin/main...HEAD -- src/`, so tests, `.planning/` and
   the lockfile do not count. The PR reports the number and a per-file table.
2. **The stale-cache bug class is structurally impossible for the migrated
   data.** Shown by the section 5 table, and by a test that the migrated
   modules hold no cache, epoch or in-flight map of their own.
3. **`make perf-interaction-gates` and the UI gates are unchanged.** Run on
   the base commit and on the branch, one at a time, under the 16G memory
   scope; both result sets go in the PR.

If any criterion fails, the PR is not pushed through: the numbers are
reported, #193 is proposed for closing as not planned, and the single in-house
helper is outlined instead.

The earlier estimate for criterion 1 (about 1,010 lines out, 780 in) predates
the review. The review added work (cohort scope, guarded writes) and removed
some (no imperative helper, simpler tag-list writes). The measured number is
reported whichever way it falls.

## 7. Out of scope

- Everything #193 lists as staying hand-written.
- The step 4 caches (comments, metrics, carriers, transcripts, protein data,
  VEP enrichment, panel resolution, `CaseDataInfoTab`).
- Turning on focus or reconnect refetch, and installing the retry plugin.
- Devtools.
- New import or delete scenarios in the E2E perf harness.
- Removing the remaining `isWebRuntime()` branches unrelated to these caches.

## 8. Risks

- **Test rewrite is the larger half of the diff.** #193 expected this.
- **Colada 1.x is young** (1.4.7, published 2026-10-02). TanStack Vue Query
  remains the fallback if a blocker appears; the key factory, the invalidation
  entry point and the behaviour tests are library-neutral and would carry
  over.
- **Kept-alive views keep their queries mounted**, so a hidden cohort view
  refetches on `data-changed`. Bounded by the refetch-count test.

## 9. Verification before the PR is marked ready

`make ci`, `make agent-check`, `make perf-interaction-gates`, the UI gates,
then, because a runtime dependency is added,
`make preflight-full PREFLIGHT_ARGS=--clean-install` on the clean commit. The
PR opens as a draft.

## 10. What the external review changed

| Finding | Resolution |
|---|---|
| Case-delete invalidation would run before the delete started | Moved to `useCaseDeletion`, after the IPC call settles (4.6). |
| Cohort scope (case-id list) stayed stale after an import | The list becomes a query under the same root (2, 4.8, 4.9). |
| Tag writes finishing after a database switch could write into the wrong root | One guarded optimistic helper (4.7). |
| Removing entries that a component still reads disconnects the reader | Only entries without a consumer are removed (4.6). |
| `refetchOnMount: false` would leave invalidated, unmounted data stale | `refetchOnMount: true` with `staleTime: Infinity` (4.2). |
| The imperative fetch helper had no owner, and the stated GC behaviour was wrong | Helper dropped; all reads are `useQuery` consumers (4.4). |
| `enabled` does not stop an explicit refresh; `typesPresent` gate missing | Explicit gate in `load*`; path added (4.5). |
| One database switch advanced the identity twice | Identity is the store's `revision`; the entry point is idempotent (4.3, 4.6). |
| Existing gates do not measure the invalidation cost | Stated; a refetch-count test is added (4.6). |
| Preset test-reset helper still needed for UI state | Kept, narrowed (4.8). |
| Dependency change needs `preflight-full --clean-install` | Section 9. |
