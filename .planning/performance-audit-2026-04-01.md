# VarLens Performance And Maintainability Audit

Date: 2026-04-01

## Scope

This review focused on:

- Daily UI responsiveness in the Electron renderer
- Data loading and pagination paths for case and cohort views
- Import, export, delete, and rebuild throughput
- Main-process blocking risks
- Architectural maintainability issues that make performance work harder over time

The review combined:

- Local code inspection of the current repository
- Parallel sub-agent reviews for renderer, query/database, and import/worker paths
- Current primary-source best practices for the stack

## Executive Summary

The codebase already has several good foundations: worker-thread reads, WAL mode, summary tables, pagination, route-level lazy loading, and some request/count caching. The main problem is not missing primitives. It is inconsistent application of them.

The biggest bottlenecks are:

1. Renderer work per visible row is too high, especially in `VariantTable`.
2. Hidden kept-alive views can continue doing live work when not visible.
3. Cohort pagination does not currently honor the skip-count optimization, so page/sort changes still pay full `COUNT(*)` cost.
4. JSON/object/columnar imports still rebuild FTS and run `ANALYZE` per flushed batch instead of once per file.
5. The import worker materializes whole files in memory, and sometimes two files at once.
6. Export builds large result sets multiple times in memory.
7. Some preprocessing and post-import finalization still runs on the Electron main thread.

If the goal is a snappy, fast, maintainable desktop app, the highest-ROI work is:

- Reduce renderer recomputation in large tables
- Make hidden route instances inactive, not merely hidden
- Fix cohort count caching
- Convert imports to true bounded streaming with one bulk-finalization pass per file
- Move remaining heavy preparation/finalization work off the main thread

## Stack Guidance From Official Docs

Relevant official guidance aligns strongly with the issues above:

- Electron recommends never blocking the main process and avoiding synchronous IPC or long-running work on the UI thread.  
  Source: https://www.electronjs.org/docs/latest/tutorial/performance
- Vue recommends lazy loading, stabilizing props, virtualizing large lists, reducing reactivity overhead for large immutable structures, and avoiding unnecessary component abstractions.  
  Source: https://vuejs.org/guide/best-practices/performance
- Vite recommends auditing plugin cost, avoiding barrel-heavy loading patterns, and using dynamic imports/code splitting for non-critical features.  
  Source: https://vite.dev/guide/performance.html
- Piscina notes that workers are most beneficial for synchronous compute-heavy work; simply moving async I/O into workers often gives limited benefit, and worker pool settings need tuning to avoid memory and queue issues.  
  Source: https://piscinajs.dev/advanced-topics/Performance%20Notes/

## What Is Already Good

- Read-heavy database queries can run through a Piscina-backed pool in [`src/main/database/DbPool.ts`](/home/bernt-popp/development/VarLens/src/main/database/DbPool.ts).
- SQLite is configured with WAL and sensible performance pragmas in [`src/main/database/DatabaseService.ts`](/home/bernt-popp/development/VarLens/src/main/database/DatabaseService.ts).
- Renderer pagination is already server-side, and the shared pagination composable includes count caching and prefetching in [`src/renderer/src/composables/useOffsetPagination.ts`](/home/bernt-popp/development/VarLens/src/renderer/src/composables/useOffsetPagination.ts).
- Route-level lazy loading exists for the cohort view in [`src/renderer/src/router/index.ts`](/home/bernt-popp/development/VarLens/src/renderer/src/router/index.ts).
- Some destructive or long-running operations already run in workers, such as delete/rebuild flows.

The report below focuses on where those good choices are currently undermined.

## Findings

### High

#### 1. Variant table rendering does too much work per cell

[`src/renderer/src/components/VariantTable.vue:8`](/home/bernt-popp/development/VarLens/src/renderer/src/components/VariantTable.vue#L8) renders a dense `v-data-table-server` with many slots. Inside those slots, it repeatedly calls lookup functions such as `getLinkForColumn(...)`, `resolveLink(...)`, `isStarred(...)`, `getAcmgClassification(...)`, `getPerCaseComment(...)`, and `getGlobalComment(...)` for every rendered cell and rerender.

Examples:

- [`src/renderer/src/components/VariantTable.vue:53`](/home/bernt-popp/development/VarLens/src/renderer/src/components/VariantTable.vue#L53)
- [`src/renderer/src/components/VariantTable.vue:73`](/home/bernt-popp/development/VarLens/src/renderer/src/components/VariantTable.vue#L73)
- [`src/renderer/src/components/VariantTable.vue:101`](/home/bernt-popp/development/VarLens/src/renderer/src/components/VariantTable.vue#L101)
- [`src/renderer/src/components/VariantTable.vue:131`](/home/bernt-popp/development/VarLens/src/renderer/src/components/VariantTable.vue#L131)

Impact:

- UI jank on larger page sizes
- Extra reactivity churn on selection changes, annotation changes, and hover/tooltips
- Harder profiling because expensive work is scattered through templates

Recommendation:

- Precompute row view-models for links and annotation flags
- Memoize per-column link configuration once per render
- Consider `v-memo` or a virtualized table/list path for high row counts
- Prefer stable props over repeated function calls inside slots

#### 2. Kept-alive hidden views can continue doing live work

[`src/renderer/src/App.vue:37`](/home/bernt-popp/development/VarLens/src/renderer/src/App.vue#L37) wraps routed views in `<keep-alive :max="2">`. The cohort path registers live summary listeners in [`src/renderer/src/composables/useCohortData.ts:122`](/home/bernt-popp/development/VarLens/src/renderer/src/composables/useCohortData.ts#L122), while cleanup is only exposed via `cleanupListeners()`.

The cohort table consumes that composable in [`src/renderer/src/components/CohortTable.vue:148`](/home/bernt-popp/development/VarLens/src/renderer/src/components/CohortTable.vue#L148). This makes it easy for an inactive but cached route to remain subscribed and react to updates while off-screen.

Impact:

- Hidden screens still burn IPC and DB work
- More memory stays hot than necessary
- Background work competes with the active view

Recommendation:

- Use `onActivated` / `onDeactivated` to gate subscriptions and refreshes
- Move listener registration to an active route shell instead of a long-lived kept-alive child
- Re-evaluate whether both route trees need to remain alive simultaneously

#### 3. Cohort pagination skip-count optimization is implemented but not actually used

The shared pagination composable passes a `skipCount` hint in [`src/renderer/src/composables/useOffsetPagination.ts:166`](/home/bernt-popp/development/VarLens/src/renderer/src/composables/useOffsetPagination.ts#L166). The backend cohort service honors `_count_needed !== false` in [`src/main/database/cohort.ts:236`](/home/bernt-popp/development/VarLens/src/main/database/cohort.ts#L236).

But the cohort table fetcher in [`src/renderer/src/components/CohortTable.vue:229`](/home/bernt-popp/development/VarLens/src/renderer/src/components/CohortTable.vue#L229) ignores the composable’s `skipCount` argument, so routine page and sort navigation still pays the count query cost.

Impact:

- Noticeably slower cohort browsing on larger datasets
- Avoidable `COUNT(*)` load on summary tables

Recommendation:

- Forward `skipCount` from the pagination composable into the cohort request
- Remove duplicate count-caching logic once one canonical approach is in place

#### 4. JSON/object/columnar imports rebuild FTS and run `ANALYZE` on every flushed batch

Both generic strategies currently flush via `insertVariantsBatch()`:

- [`src/main/import/strategies/ColumnarStrategy.ts:53`](/home/bernt-popp/development/VarLens/src/main/import/strategies/ColumnarStrategy.ts#L53)
- [`src/main/import/strategies/ObjectStrategy.ts:33`](/home/bernt-popp/development/VarLens/src/main/import/strategies/ObjectStrategy.ts#L33)
- [`src/main/import/transforms/BatchAccumulator.ts:74`](/home/bernt-popp/development/VarLens/src/main/import/transforms/BatchAccumulator.ts#L74)

`insertVariantsBatch()` wraps each call in `beginBulkInsert()` / `finishBulkInsert()`, and `finishBulkInsert()` rebuilds FTS, restores triggers, runs `ANALYZE`, and optimizes FTS:

- [`src/main/database/VariantRepository.ts:141`](/home/bernt-popp/development/VarLens/src/main/database/VariantRepository.ts#L141)

Impact:

- Large imports do expensive finalization work every 5k rows instead of once per file
- Import throughput is artificially capped by repeated index rebuild overhead

Recommendation:

- Start one bulk session per file
- Call `insertBatch()` for intermediate flushes
- Call `finishBulkInsert()` once after the final batch
- Reuse the structurally better VCF bulk-finalization pattern

#### 5. Import worker defeats streaming by materializing whole files

The batch import worker pre-parses full files into arrays before inserting them, and can pre-parse the next file while the current one is still being inserted:

- [`src/main/workers/import-worker.ts:101`](/home/bernt-popp/development/VarLens/src/main/workers/import-worker.ts#L101)
- [`src/main/workers/import-worker.ts:186`](/home/bernt-popp/development/VarLens/src/main/workers/import-worker.ts#L186)
- [`src/main/workers/import-worker.ts:578`](/home/bernt-popp/development/VarLens/src/main/workers/import-worker.ts#L578)
- [`src/main/workers/import-worker.ts:614`](/home/bernt-popp/development/VarLens/src/main/workers/import-worker.ts#L614)

Impact:

- Peak RSS grows roughly with one or two full files plus transcript payloads
- More GC churn
- Higher import latency and more crash risk on very large inputs

Recommendation:

- Parse and insert in bounded chunks inside the worker
- Overlap bounded chunk parsing with inserts if needed, not full-file arrays
- Keep memory proportional to batch size, not file size

#### 6. Export builds the dataset multiple times in memory

[`src/main/workers/export-worker.ts:42`](/home/bernt-popp/development/VarLens/src/main/workers/export-worker.ts#L42) loads all rows with `.all()`, then copies them into `rows`, then passes `[headers, ...rows]` into `aoa_to_sheet(...)` in [`src/main/workers/export-worker.ts:79`](/home/bernt-popp/development/VarLens/src/main/workers/export-worker.ts#L79). Cancellation is explicitly not supported in [`src/main/workers/export-worker.ts:137`](/home/bernt-popp/development/VarLens/src/main/workers/export-worker.ts#L137).

Impact:

- Memory spikes on large exports
- Long worker stalls with poor cancellation UX

Recommendation:

- Stream DB rows with `.iterate()` where possible
- Prefer streaming CSV for large exports
- Keep XLSX for smaller exports or move to a streaming-capable writer

### Medium

#### 7. Case switches do an extra query before the table can settle

[`src/renderer/src/components/variant-table/useVariantData.ts:115`](/home/bernt-popp/development/VarLens/src/renderer/src/components/variant-table/useVariantData.ts#L115) resets state and then performs an extra `variants.query(... limit 1 ...)` to fetch the unfiltered count on case change, while normal page loading immediately follows through the pagination flow.

Impact:

- Slower first paint when selecting a case
- More IPC chatter during common navigation

Recommendation:

- Return filtered and unfiltered counts together in the page response
- Or defer the unfiltered count until after first rows are visible

#### 8. Annotation loading has no stale-request guard

Visible-page annotation preloading starts from [`src/renderer/src/components/variant-table/useVariantData.ts:141`](/home/bernt-popp/development/VarLens/src/renderer/src/components/variant-table/useVariantData.ts#L141). The batch loader in [`src/renderer/src/composables/useAnnotations.ts:219`](/home/bernt-popp/development/VarLens/src/renderer/src/composables/useAnnotations.ts#L219) avoids duplicate in-flight keys, but it does not cancel or invalidate requests when the visible page changes quickly.

Impact:

- Extra annotation IPC work during rapid paging/filtering
- Cache filled with data the user may never look at

Recommendation:

- Add request generations or cancellation tokens
- Only let the latest visible-page request populate state

#### 9. Panel interval expansion still blocks the Electron main thread

The variants IPC handler computes panel intervals before dispatching to the DB pool:

- [`src/main/ipc/handlers/variants.ts:102`](/home/bernt-popp/development/VarLens/src/main/ipc/handlers/variants.ts#L102)
- [`src/main/ipc/handlers/panelIntervalHelper.ts`](/home/bernt-popp/development/VarLens/src/main/ipc/handlers/panelIntervalHelper.ts)

The same pattern exists in the cohort handler:

- [`src/main/ipc/handlers/cohort.ts:52`](/home/bernt-popp/development/VarLens/src/main/ipc/handlers/cohort.ts#L52)

Impact:

- Panel-heavy filters can still freeze or delay input even though SQL executes off-thread

Recommendation:

- Move interval expansion/merging into the worker-side task
- Treat interval preparation as part of the query workload, not UI-thread preprocessing

#### 10. Cohort response serialization does avoidable object copying

After the worker or service returns cohort variants, the handler remaps every row into a new plain object in [`src/main/ipc/handlers/cohort.ts:83`](/home/bernt-popp/development/VarLens/src/main/ipc/handlers/cohort.ts#L83).

Impact:

- Extra CPU and allocation cost per page
- More overhead on a path already intended to feel fast during routine browsing

Recommendation:

- Normalize row shapes once in the worker/service
- Avoid per-request full remapping when the returned objects are already IPC-safe

#### 11. Filter/query state is duplicated across composables

There is overlapping filter-state and request-shaping logic across:

- [`src/renderer/src/composables/useFilterState.ts`](/home/bernt-popp/development/VarLens/src/renderer/src/composables/useFilterState.ts)
- [`src/renderer/src/composables/useFilters.ts`](/home/bernt-popp/development/VarLens/src/renderer/src/composables/useFilters.ts)
- [`src/renderer/src/components/CohortTable.vue:184`](/home/bernt-popp/development/VarLens/src/renderer/src/components/CohortTable.vue#L184)
- [`src/renderer/src/composables/useCohortData.ts:156`](/home/bernt-popp/development/VarLens/src/renderer/src/composables/useCohortData.ts#L156)

Impact:

- Performance fixes must be repeated in multiple places
- Higher chance of drift between case/cohort behavior
- Harder to introduce shared caching or canonical request hashing

Recommendation:

- Consolidate request-shaping into one canonical filter/query layer
- Keep case vs cohort differences as thin adapters

#### 12. Query specialization is incomplete

The variant and cohort repositories have reasonable foundations, but several hot paths still use broad query construction that serves count, page, and export needs together:

- [`src/main/database/VariantRepository.ts:225`](/home/bernt-popp/development/VarLens/src/main/database/VariantRepository.ts#L225)
- [`src/main/database/VariantRepository.ts:820`](/home/bernt-popp/development/VarLens/src/main/database/VariantRepository.ts#L820)
- [`src/main/database/cohort.ts:83`](/home/bernt-popp/development/VarLens/src/main/database/cohort.ts#L83)

Impact:

- Harder to keep count queries cheap
- More work than necessary for specialized flows

Recommendation:

- Split query paths into page-only, count-only, and full-export variants
- Precompute or denormalize only what hot filters need
- Re-check EXPLAIN QUERY PLAN for the top 5 interactive queries after each change

## Prioritized Roadmap

### Phase 1: Highest ROI

- Fix cohort `skipCount` wiring
- Change JSON/object import batching to use one `finishBulkInsert()` per file
- Remove hidden kept-alive background work with activation/deactivation gating
- Cut `VariantTable` template-time lookup calls by precomputing row display state

### Phase 2: Throughput And Stability

- Convert import worker from pre-parse-all to bounded streaming inserts
- Rework export to streaming CSV or streaming XLSX
- Move panel interval preprocessing and post-import frequency maintenance off the main thread

### Phase 3: Structural Maintainability

- Consolidate filter/query state
- Split query builders by use case
- Lazy-load non-critical dialogs/panels from the app shell
- Add repeatable performance benchmarks for import, cohort paging, and case-switch latency

## Suggested Metrics To Track

- Time to first rows after case selection
- Time to next page in cohort and case tables
- Mean/95th percentile filter-apply latency
- Import throughput in variants/sec by format
- Peak RSS during large imports and large exports
- Time spent on main-thread preprocessing before worker dispatch

## Recommended First Four Changes

If only a small number of changes can be funded immediately, do these first:

1. Wire cohort pagination to honor `skipCount`.
2. Fix columnar/object import batching so FTS rebuild and `ANALYZE` run once per file.
3. Stop hidden kept-alive views from processing live cohort updates.
4. Replace expensive per-cell lookups in `VariantTable` with precomputed row state.

These four changes should improve both perceived responsiveness and maintainability without requiring a full architectural rewrite.
