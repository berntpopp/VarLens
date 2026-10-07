# Renderer Query Cache Pilot Implementation Plan

> **For agentic workers:** executed natively in one session (the owner asked for
> end-to-end implementation). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move column metadata, filter options, tags and filter presets onto
Pinia Colada with database-rooted keys and one invalidation entry point, then
measure the step 3 exit criteria of #193.

**Architecture:** A `queries/` directory holds the key factory, the client
setup, the invalidation entry point and one `defineQueryOptions` module per
domain. The four existing composables become facades that create `useQuery`
consumers during setup. `databaseStore.revision` is the database identity.

**Tech Stack:** Vue 3.5, Pinia 4, `@pinia/colada` 1.4.7, Vitest (happy-dom),
`@vue/test-utils`.

**Spec:** `.planning/specs/2026-10-07-renderer-query-cache-pilot.md`

## Global Constraints

- `@pinia/colada` pinned at `1.4.7`; no devtools, no retry plugin.
- Defaults: `staleTime: Infinity`, `refetchOnMount: true`,
  `refetchOnWindowFocus: false`, `refetchOnReconnect: false`, `gcTime` 5 min.
- Keys are only written in `queries/keys.ts`; root is `['db', revision]`.
- All reads are `useQuery` consumers created during setup; options are passed
  as getters.
- No `console.*`, no `isWebRuntime()` feature decisions, no
  `typeof window.api.x`. Source files stay under 600 lines.
- Out of scope: tables, annotation cache, workflow guards, `summaryStale`,
  dim-while-refetching, the step 4 caches.
- Tests are written first and seen to fail.

## Review Focus

1. A response that arrives after the user has moved to another case or
   database must never be shown (tasks 3, 5, 6, 7).
2. A capability document that has not loaded, or failed to load, must not
   produce a fetch or an unhandled rejection (task 2, each domain task).
3. A tag write that fails must leave the tags as they were before, and must
   not disturb a different database opened meanwhile (task 6).
4. An empty cohort (no cases) must not fetch column metadata or types
   (task 5).
5. A column whose metadata fetch fails must not be retried on every render
   (task 5).

## File Structure

Create under `src/renderer/src/queries/`:

| File | Exports |
|---|---|
| `client.ts` | `QUERY_DEFAULTS`, `installQueryCache(app: App, pinia: Pinia): void`, `isRetryableError(error: unknown): boolean` |
| `keys.ts` | `queryKeys` (`root()`, `tags()`, `filterPresets()`, `caseIds()`, `scope(scope)`, `filterOptions(caseId)`, `variantTags(caseId, variantId)`, `typesPresent(scope)`, `columnMeta(scope, columnKey)`), `isVariantTagsKey(key)`, type `QueryScope = { caseId?: number; caseIds?: number[] }` |
| `invalidation.ts` | `invalidateServerData(event: 'database-switch' \| 'data-changed'): Promise<void>` |
| `use-queries.ts` | `useQueries<T, D>(items: () => readonly T[], idOf: (item: T) => string, optionsOf: (item: T) => UseQueryOptions<D>): ComputedRef<ReadonlyMap<string, UseQueryReturn<D>>>` |
| `gate.ts` | `canQuery(path: CapabilityPath): boolean` (reactive, fail-closed), `requireApi(): WindowAPI` |
| `column-meta.ts` | `columnMetaQuery(scope, columnKey)`, `typesPresentQuery(scope)` |
| `filter-options.ts` | `filterOptionsQuery(caseId)` |
| `tags.ts` | `tagListQuery()`, `variantTagsQuery(caseId, variantId)`, `writeOptimistic<T>(key, next: T, run: () => Promise<unknown>): Promise<void>` |
| `filter-presets.ts` | `filterPresetsQuery()` |
| `cases.ts` | `caseIdsQuery()` |

Modify: `main.ts`, `stores/databaseStore.ts` (`revision`),
`utils/backend-capabilities.ts` (`variants.typesPresent`), the four
composables, `useAppState.ts`, `useShellLifecycle.ts`, `useCaseDeletion.ts`,
`useFilterState.ts`, `filter-types.ts`, `App.vue`,
`components/filters/ExtensionColumnFilters.vue`,
`components/cohort/CohortFilterBar.vue`, `package.json`.

Tests: `tests/renderer/helpers/with-queries.ts` (mounts a host component with
Pinia + Colada and returns the composable result, the pinia and `unmount`),
`tests/renderer/queries/*.test.ts`, and the rewritten suites of the four
composables, `ExtensionColumnFilters`, `useAppState`, `useShellLifecycle`,
`useCaseDeletion`.

---

### Task 1: Dependency, client, keys, database identity

**Files:** `package.json`, `queries/client.ts`, `queries/keys.ts`,
`stores/databaseStore.ts`, `main.ts`; tests `tests/renderer/queries/client.test.ts`,
`keys.test.ts`, `tests/renderer/helpers/with-queries.ts`.

- [ ] Add `@pinia/colada@1.4.7` (exact) to dependencies.
- [ ] Failing tests: keys (cohort order, revision inequality, case/cohort
      separation, empty scope), `isRetryableError` (five codes, `Error`,
      `SerializableError`), defaults (fresh remount does not refetch;
      invalidated-while-unmounted refetches on remount; no retry after an
      error), shallow storage, `databaseStore.revision` increments on each
      publish.
- [ ] Implement; wire `installQueryCache` into `main.ts` after Pinia.
- [ ] `npx vitest run tests/renderer/queries` green; commit.

### Task 2: Gate, `useQueries`, invalidation entry point

**Files:** `queries/gate.ts`, `queries/use-queries.ts`,
`queries/invalidation.ts`, `utils/backend-capabilities.ts`; tests
`tests/renderer/queries/use-queries.test.ts`, `invalidation.test.ts`,
`gate.test.ts`.

- [ ] Failing tests: `useQueries` creates one query per item, releases a
      removed item (collected after `gcTime`), disposes with its owner;
      `database-switch` is idempotent, cancels and removes consumer-less
      entries outside the current root, never removes an entry with a
      consumer; `data-changed` refetches each mounted query exactly once and
      leaves unmounted ones stale; `canQuery` is false without a document.
- [ ] Implement; green; commit.

### Task 3: Filter presets and case ids

**Files:** `queries/filter-presets.ts`, `queries/cases.ts`,
`composables/useFilterPresetStore.ts`, `components/cohort/CohortFilterBar.vue`;
tests `useFilterPresetStore.test.ts` (rewrite), `tests/renderer/queries/cases.test.ts`.

- [ ] Failing tests: existing preset behaviours (dedupe, refetch after
      mutation, retry after failed load, visible filter, toggle, merge,
      per-scope isolation) plus: refetch after `database-switch` shows the new
      database's list and never the old; `loadPresets` rejects on failure.
- [ ] Implement facade over `useQuery(filterPresetsQuery)`; mutations
      invalidate and await; `CohortFilterBar` reads `caseIdsQuery`.
- [ ] Green; commit.

### Task 4: Filter options

**Files:** `queries/filter-options.ts`, `composables/useFilterOptionsCache.ts`,
`useFilterState.ts`, `filter-types.ts`; tests `useFilterOptionsCache.test.ts`
(rewrite), `useFilterState*.test.ts` (adjust).

- [ ] Failing tests: empty default; loads on miss; no second call on hit;
      cases cached separately; case switch never shows the previous case's
      options when the previous request resolves last; errors logged and
      swallowed; gate off means no call; `loadFilterOptionsAndTags` loads both.
- [ ] Implement; green; commit.

### Task 5: Column metadata and `ExtensionColumnFilters`

**Files:** `queries/column-meta.ts`, `composables/useVariantColumnMeta.ts`,
`components/filters/ExtensionColumnFilters.vue`; tests
`useVariantColumnMeta.test.ts` (rewrite), `ExtensionColumnFilters.test.ts`
(rewrite against the real composable with a mocked `window.api`),
`AssociationConfigPanel.test.ts` (adjust mock).

- [ ] Failing tests: one call per (scope, column); concurrent consumers share
      it; cohort scope forwarded as `caseIds`; empty scope fetches nothing;
      scope switch shows only the new scope's metadata; a failed column is
      asked once per scope; `data-changed` refetches; `database-switch`
      re-keys.
- [ ] Implement `useVariantColumnMeta(scope, columnKeys)` returning
      `{ typesPresent, metaByColumn, failedColumns }`; delete the component's
      local caches.
- [ ] Green; commit.

### Task 6: Tags

**Files:** `queries/tags.ts`, `composables/useTags.ts`; tests
`useTags.test.ts` (replaces `useTags.reset.test.ts`).

- [ ] Failing tests: list load and dedupe; list writes refresh the list and
      mounted variant tags; optimistic assign/remove with rollback on failure;
      a write settling after a database switch changes nothing in either
      root; a read racing an optimistic write does not overwrite it; variant
      switch never shows the previous variant's tags; loading flag per
      variant.
- [ ] Implement; drop members without callers; green; commit.

### Task 7: Call sites and removal of old invalidation

**Files:** `useAppState.ts`, `useShellLifecycle.ts`, `useCaseDeletion.ts`,
`App.vue`; tests `useAppState.test.ts`, `useShellLifecycle.test.ts`,
`useCaseDeletion.test.ts`, `tests/renderer/queries/stale-cache-class.test.ts`
(the step 3 table, including "no module-level cache in migrated modules").

- [ ] Failing tests: each event calls `invalidateServerData` with the right
      argument; delete invalidates after settle on success and failure; the
      watcher-plus-handler switch sequence fetches once.
- [ ] Implement; remove the three `isWebRuntime()` invalidation branches;
      green; commit.

### Task 8: Verification and step 3 measurement

- [ ] `make typecheck`, `make lint-check`, `make format-check`,
      `make agent-check`.
- [ ] `make rebuild-node && make test` (16G scope).
- [ ] Line count: `git diff --numstat origin/main...HEAD -- src/`.
- [ ] Open the app (`make dev`) and exercise case filters, cohort filters,
      tags and presets, a database switch, an import and a delete.
- [ ] `make perf-interaction-gates` and UI gates on base and branch.
- [ ] `make ci`, then `make preflight-full PREFLIGHT_ARGS=--clean-install` on
      the clean commit; draft PR; decide step 3; update #193.
