# Renderer query cache pilot (Pinia Colada)

- **Issue:** #193, steps 2 and 3. Step 1 shipped in PR #465 (v0.76.3).
- **Status:** draft, awaiting approval. No code is written until this is approved.
- **Branch / worktree:** `feat/renderer-colada-pilot` in `VarLens-wt/colada-pilot`, based on `c7ed3149`.

## 1. Goal

Move four server-derived, read-mostly caches onto one query cache with one key
convention and one invalidation entry point, and use the result to decide
whether the rest of the simple caches should follow (step 4).

Decided in #193 and not reopened here: the library is `@pinia/colada`; Pinia
Colada owns server-derived data and Pinia stores keep UI state; the tables, the
annotation cache, workflow guards, `summaryStale` and the "dim while
refetching" flag stay hand-written.

## 2. What migrates

| Data | Today | Lines |
|---|---|---|
| Column metadata and variant types present | `useVariantColumnMeta.ts`: two module refs, two in-flight maps, `cacheEpoch` | 191 |
| Filter options | `useFilterOptionsCache.ts`: per-instance `LruMap(20)` | 182 |
| Tags (list and per-variant tags) | `useTags.ts`: two module caches, a loading map, `cacheEpoch` | 421 |
| Filter presets | `useFilterPresetStore.ts`: module list, `loaded` flag, in-flight promise | 214 |

Total 1,008 lines. `ExtensionColumnFilters.vue` also holds a local `metaMap`,
`failedKeys` and `pendingKeys` keyed by column, reset on scope or `cacheEpoch`
change.

Stays where it is, because it is UI state and not server data: which presets
are toggled on per scope (`activeByScope`), `getActiveFilterState`, and
`TAG_COLORS`.

## 3. Findings on the two open questions

**Does Pinia Colada hold large results shallowly?** Yes, with no configuration.
Read from the 1.4.7 source: each entry's `state` and `asyncStatus` are
`shallowRef`s, the entry itself is `markRaw`, and the cache map is a
`shallowRef` updated with `triggerRef`. Query results are never made deeply
reactive. A test in the pilot asserts this (`isReactive(data) === false` for a
nested result) so an upgrade cannot change it silently.

**Is the devtools dependency chain acceptable?** Recommendation: no, ship
without devtools. Measured with a lockfile-only install against Vue 3.5,
Pinia 4 and Vite 7:

| Install | Packages |
|---|---|
| Baseline | 91 |
| + `@pinia/colada@1.4.7` | 92 (adds `nostics`, a 97 kB diagnostics library) |
| + `@pinia/colada-devtools@2.0.1` and its four required peers | 134 |

The devtools add 42 packages, including a pre-1.0 `@vitejs/devtools-kit`
(0.7.x) and `@devframes/agentic`. That is a large addition to what Trivy,
Gitleaks and `npm audit` have to cover, for a tool the pilot does not need.
It can be revisited after step 3.

## 4. Design

### 4.1 Setup and global defaults

New directory `src/renderer/src/data/`. `main.ts` installs `PiniaColada` right
after Pinia with these defaults:

| Option | Value | Why |
|---|---|---|
| `staleTime` | `Infinity` | Data only changes on known events; invalidation is explicit. |
| `refetchOnMount` | `false` | A remounted toolbar must not refetch. |
| `refetchOnWindowFocus`, `refetchOnReconnect` | `false` | The pilot does not change web behaviour. Step 4 turns these on for web, driven by a capability flag, not `isWebRuntime()`. |
| `gcTime` | 5 minutes (library default) | Bounds every cache; replaces the ad-hoc `LruMap(20)` and the unbounded maps. |
| retry | none | The retry plugin is not installed. |

Errors are typed `SerializableError | Error`. Because there is no retry on
desktop, the "never retry `VALIDATION`, `NOT_FOUND`, `FORBIDDEN`,
`UNSUPPORTED_RUNTIME`, `CONFLICT`" rule holds trivially in the pilot. It is
still written now as a pure function `isRetryableError(error)` with tests, so
step 4 can pass it to the retry plugin in web mode without a second design
round.

### 4.2 Query keys

One module, `data/query-keys.ts`, builds every key. Nothing else writes a key
literal.

```
[ 'db', <databaseIdentity>, 'tags' ]
[ 'db', <databaseIdentity>, 'filter-presets' ]
[ 'db', <databaseIdentity>, 'case', <caseId>, 'filter-options' ]
[ 'db', <databaseIdentity>, 'case', <caseId>, 'variant-tags', <variantId> ]
[ 'db', <databaseIdentity>, 'case', <caseId>, 'types-present' ]
[ 'db', <databaseIdentity>, 'case', <caseId>, 'column-meta', <columnKey> ]
[ 'db', <databaseIdentity>, 'cohort', <sortedCaseIds>, 'types-present' ]
[ 'db', <databaseIdentity>, 'cohort', <sortedCaseIds>, 'column-meta', <columnKey> ]
```

`databaseIdentity` is `<database path or "default">@<switch counter>`. The path
alone is not enough: a database can be deleted and recreated at the same path,
and the web workspace has no path. The counter is bumped by the invalidation
entry point on every database switch, so two databases can never share a key
even when their case ids collide.

Cohort scope keeps today's behaviour of sorting the case ids, so `[3,1,2]` and
`[1,2,3]` are one entry.

### 4.3 Reading

Two forms, both in `data/`:

1. **`useQuery`** for data with one key per consumer: tag list, preset list,
   filter options (keyed by a case-id ref), types present.
2. **`fetchQuery(key, queryFn)`**, a small helper over the query cache
   (`ensure` + `track` + `refresh`), for a variable number of keys that are
   asked for imperatively: column metadata per column and tags per variant.
   Colada has no `useQueries`. The helper tracks the entry against the calling
   effect scope so it is garbage-collected like any other; without that,
   entries created through `ensure` alone are never collected (read from the
   source: the GC timer only starts on `untrack`).

Both forms get, from the library and not from our code: one request per key
however many callers ask at once, a late response dropped when a newer request
or an invalidation supersedes it, and loading and error state.

### 4.4 Capability gates

Each query's `enabled` option is the existing capability check, read reactively
from the capability store: `variants.columnMeta`, `variants.filterOptions`,
`workflow.tags`, `workflow.filterPresets`. A disabled query does not fetch.
`getColumnMeta`, which today rejects with the block reason, keeps rejecting
with the same reason. No `isWebRuntime()` and no `typeof window.api.x`.

Presets and the tag list are not gated today outside one call path. The pilot
gates them consistently; on every current backend those capabilities are on,
so nothing visible changes.

### 4.5 Invalidation: one entry point

`data/invalidation.ts` exports `invalidateServerData(event)`:

| Event | Effect |
|---|---|
| `database-switch` | Bump the switch counter (new key root), cancel in-flight requests and remove every entry under the old root. |
| `import-complete` | Invalidate everything under the current root. Mounted queries refetch once; the rest refetch on next use. |
| `case-deleted` (with the case id) | As `import-complete`, and remove that case's entries. |
| `all-cases-deleted` | As `import-complete`, and remove every case and cohort entry. |

Call sites, each next to the existing `incrementDataGeneration()` (which stays,
because it drives the tables):

- `useAppState.resetForDatabaseSwitch` — replaces `invalidateFilterPresets()`,
  `invalidateAllVariantColumnMeta()` and `resetTagCaches()`.
  `useCarriers().reset()` stays until step 4.
- `useShellLifecycle.handleImportComplete` and `handleBatchImportComplete` —
  replace `if (isWebRuntime()) variantColumnMeta.invalidateAll()`.
- `App.vue` `handleCaseDeleted` — replaces the same gated call.
- `App.vue` `handleDeleteAllCases` — new; nothing is invalidated there today.

**Behaviour change to accept or reject:** on desktop, an import or delete now
also invalidates, where today only web does. The cost is one refetch of
whatever is mounted (typically filter options, and column metadata if the
filter drawer is open) per import or delete. Step 1 showed desktop does not
strictly need it. I recommend accepting it: one rule for both runtimes is the
point of the entry point, and it removes three `isWebRuntime()` branches. If
`make perf-interaction-gates` moves, the fallback is to invalidate without
refetching mounted queries on desktop.

### 4.6 Writes

Tag and preset mutations keep their current signatures and semantics:

- Preset create, update, delete and reorder invalidate the preset key (today:
  `reloadPresets()`).
- Tag create, update and delete write the tag-list entry with `setQueryData`
  and patch per-variant entries with `setQueriesData` (today: in-place cache
  edits).
- Assign, remove and set variant tags keep the optimistic update and the
  revert on failure, written through `setQueryData`.

`useMutation` is not adopted in the pilot. These are plain async functions
today and the callers await them; wrapping them adds lines without removing
any.

### 4.7 Public shapes

Components do not change, with one planned exception.

| Composable | Kept | Removed |
|---|---|---|
| `useFilterOptionsCache` | `filterOptions`, `loadFilterOptions`, `loadFilterOptionsAndTags` | `invalidateFilterOptionsCache` (zero callers; also dropped from `filter-types.ts` and `useFilterState`) |
| `useFilterPresetStore` | everything it returns today | module export `invalidateFilterPresets`; `__resetFilterPresetStoreForTest` becomes unnecessary |
| `useTags` | everything it returns today, `TAG_COLORS` | module export `resetTagCaches` |
| `useVariantColumnMeta` | `getColumnMeta`, `ensureTypesPresent` | `invalidate`, `invalidateAll`, `cacheEpoch`, `extensionColumnMeta`, `variantTypesPresent`, module export `invalidateAllVariantColumnMeta` |

Everything in the "removed" column is either unused or an invalidation hook
that the entry point replaces.

**`ExtensionColumnFilters.vue`** is the exception. Of the two options in the
brief, the pilot takes the second: the local `metaMap`, `failedKeys`,
`pendingKeys`, `dataKey` and the `cacheEpoch` watch are deleted, and the
component reads metadata and error state from the query cache for the current
scope. A failed column still fetches once and is not retried on re-render,
which is the reason `failedKeys` exists. Its props, emits and template stay
the same.

### 4.8 Case and cohort parity

Column metadata, types present and presets are shared by the case and cohort
views through the same composables, so both move in this one PR.
`FilterToolbar` and `CohortFilterBar` get the same test coverage for scope
switch and invalidation.

## 5. Tests (written first, failing)

New `tests/renderer/data/`:

- Keys: stable for reordered cohort ids; different database identity never
  equals; case and cohort scopes never collide.
- Defaults: no refetch on remount, no refetch while fresh, no retry after an
  error.
- `isRetryableError`: the five listed codes are never retryable, for both
  `SerializableError` and `Error`.
- Shallow storage: a nested result is not reactive.
- Garbage collection: an entry read through `fetchQuery` is collected after
  its scope is disposed.

Stale-cache bug class, one test per data type and event (this is the step 3
evidence):

| Event | Asserted |
|---|---|
| Database switch | Old data is not returned for the same case id; a response in flight across the switch is not visible afterwards. |
| Case switch | The new case never shows the previous case's result, including when the previous request resolves last. |
| Import complete | The next read refetches. |
| Case delete / delete all | The deleted case's entries are gone; the next read refetches. |

Existing suites for the four composables and `ExtensionColumnFilters`
(about 1,240 lines) are rewritten against the kept public shapes. Suites that
mock a composable (`AssociationConfigPanel`, `useShortlistQuery`,
`useFilterState*`) are adjusted only where a removed member is referenced. A
shared `tests/renderer/helpers` setup installs Pinia and Pinia Colada.

`useAppState.test.ts` and the `useShellLifecycle` tests assert that each of the
four events calls `invalidateServerData` with the right event.

## 6. Step 3 exit criteria and how each is measured

1. **Net authored source lines go down.** Measured as added minus deleted
   lines from `git diff --numstat origin/main...HEAD -- src/`, so tests,
   `.planning/` and the lockfile do not count. The PR reports the number and a
   per-file table. Baseline for the four composables is 1,008 lines.
2. **The stale-cache bug class is structurally impossible for the migrated
   data.** Shown by the section 5 table, and by the fact that no migrated
   module holds a cache, an epoch or an in-flight map of its own any more
   (checked by a grep-based test over the four files).
3. **`make perf-interaction-gates` and the UI gates are unchanged.** Run on
   the base commit and on the branch, one at a time, under the 16G memory
   scope; both result sets go in the PR.

If any criterion fails, the PR is not pushed through: I report the numbers,
propose closing #193 as not planned, and outline the single in-house helper
instead.

My estimate for criterion 1 is roughly 1,010 lines out and 780 in (four slimmer
composables plus about 200 lines of shared `data/` code). That margin is real
but not large, and the shared code is a one-off that step 4 would reuse. I
will report the measured number whichever way it falls.

## 7. Out of scope

- Everything #193 lists as staying hand-written.
- The step 4 caches (comments, metrics, carriers, transcripts, protein data,
  VEP enrichment, panel resolution, `CaseDataInfoTab`).
- Turning on focus or reconnect refetch, and installing the retry plugin.
- Devtools.
- Removing the remaining `isWebRuntime()` branches unrelated to these caches.

## 8. Risks

- **`track` / `untrack` are public store actions but are mostly used by the
  library itself.** `fetchQuery` depends on them. Mitigation: the GC test in
  section 5 fails if their behaviour changes; the version is pinned by the
  lockfile.
- **Test rewrite is the larger half of the diff.** #193 expected this.
- **Colada 1.x is young** (1.4.7, published 2026-10-02). TanStack Vue Query
  remains the fallback if a blocker appears; the key module, the invalidation
  entry point and the tests are library-neutral and would carry over.

## 9. Verification before the PR is marked ready

`make ci`, `make agent-check`, `make perf-interaction-gates`, the UI gates,
then `make preflight` on the clean commit. The PR opens as a draft.
