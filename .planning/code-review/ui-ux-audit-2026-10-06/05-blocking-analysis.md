# 05 — Blocking / Responsiveness Analysis

**Date:** 2026-10-06 · **Scope:** renderer, web server (Fastify + pg), Electron main, SQLite/Postgres, import/export workers
**Version:** v0.72.0 (`05bc72f6`) · **Method:** static read-only review of `src/` (all citations checked with `grep -n`/`sed -n`), plus empirical measurements against the running web instance (`http://localhost:8787`, `NODE_ENV=development`, 75 ms injected API latency, 3 cases / ~19.5k variants).
**Requirement under test:** the app is completely non-blocking — UI main thread, interaction, server event loop, Electron main, DB access, imports/exports, network.

Severity: **P0** freezes UI/server >1 s or blocks all users · **P1** jank >100 ms or blocks a workflow · **P2** scaling risk · **P3** hygiene. Effort: S (<½ day) / M (1–3 days) / L (>3 days).

---

## 1. Non-blocking score

| Layer | Score (0–10) | One-line verdict |
|---|---|---|
| Renderer (UI main thread) | **7** | Server-side paging, `shallowRef`/`markRaw`, lazy heavy libs are in place; loses points for stale/duplicate query races, undebounced autocomplete, full-SVG/D3 re-renders, ~85 ms long task per table page render. |
| Web server (event loop + pool) | **6** | Event loop itself stays healthy under load (livez p95 < 8 ms for normal pages); blocking is in the **DB pool** (max 4, 3 round-trips/request) and in request-path global rebuilds/TRUNCATE locks; adm-zip is synchronous. |
| Electron main | **4** | Reads are in a Piscina worker pool, but *every* write, all frequency maintenance, multi-file append, cohort export, rekey/encryption migration and DB open/migrations run synchronously on main; `busy_timeout=5000` turns worker write locks into 5 s app freezes. |
| Database (query shape at WGS scale) | **4** | OFFSET pagination everywhere, `COUNT(*)` on every filter change, default sort `pos ASC NULLS LAST` with no `(case_id,pos)` index, global FTS/summary/index rebuilds per import/delete, live whole-table aggregates for cohort summary/gene burden. |
| Import / export | **6** | Single/batch import, delete, variant export run in workers with throttled progress and cancel; but tail steps (frequencies), multi-file append, cohort export and ZIP extraction run on the main/event-loop thread; no export cancel; web import holds the HTTP request. |
| **Overall** | **5 / 10** | Architecture is right (workers, streaming, summary tables); the remaining blockers are concentrated in a small number of "tail" paths and query shapes that are fixable. |

---

## 2. Empirical measurements

### 2.1 Web server — event-loop vs pool responsiveness under load

Script: `scratchpad/loadtest.mjs` (logs in via `POST /api/auth/login`, fires realistic dispatcher calls from N concurrent workers while probing `/livez` (no DB → pure event-loop latency) and `/healthz` (`SELECT 1` → pool-acquisition latency) every 10 ms).

| Scenario (20 s–25 s) | rps | `/livez` p50 / p95 / max | `/healthz` p50 / p95 / max | API p50 / p95 |
|---|---|---|---|---|
| Idle | – | 0.3 / 0.6 / 1.4 ms | 0.4 / 0.9 / 2.6 ms | – |
| **A. Normal**: 16 workers, `variants:query` 50–100 rows × 4 sorts, filtered + unfiltered counts, `columnMeta`, cohort 50-row pages, `getSummary`, `cases:list` | 181 | 0.3 / 0.6 / **3.9 ms** | 0.4 / 3.1 / **102.8 ms** | `variants:query` 87 / 98 ms (75 ms is injected) |
| **B. Large pages**: 20 workers, `variants:query` limit 1000 (884 KiB JSON), `cohort:getVariants` limit 10000 (4 MiB JSON) / 5000 | 72 | **9.2 / 43.8 / 76.6 ms** | 34 / 108 / **168 ms** | 258 / 353 ms; cohort 331 / 434 ms |
| **C. Aggregates**: 20 workers, `cohort:getSummary` + `cohort:getGeneBurden` | 80 | 0.5 / 7.6 / 14.9 ms | 0.5 / **130 / 154 ms** | 252 / 271 ms |

Interpretation:
- **The Node event loop is not the bottleneck for normal-size pages** (A: livez max 3.9 ms). The 75 ms latency injection is `setTimeout`-based and non-blocking (`src/web/server/dispatcher.ts:146-149`), dev-only (`:133`).
- **Large responses do block the loop** (B: livez p95 44 ms, max 77 ms) — synchronous `JSON.stringify` of 0.9–4 MiB payloads (no response schema / no streaming / no compression; `content-encoding` absent on all responses). At WGS-scale row widths and 10k-row cohort pages this grows linearly.
- **Pool contention, not CPU, is what other users feel** (A/C: healthz p95 up to 130 ms while livez p95 < 8 ms). Pool `max = 4` (`src/main/storage/config.ts:31`) and each API call does ≥3 sequential DB round-trips (live user re-check `src/web/server/auth.ts:319`, handler, awaited audit insert `dispatcher.ts:359-367,384-387`). With a WGS dataset, a single 30 s aggregate holds 1 of 4 connections; 4 concurrent ones block every user (after 5 s `connectionTimeoutMillis` → errors).
- Dataset caveat: 19.5k variants total. `cohort:getSummary` costs ~29 ms of DB time here (104 ms − 75 ms injected) and scans *all* variants — it is O(total variants), see W-4.

### 2.2 Renderer — long tasks during real interaction (headless Chromium, web build)

Script: `scratchpad/longtasks.cjs` (PerformanceObserver `longtask` + `long-animation-frame`, desktop-class CPU, no throttling).

| Interaction | Long tasks | Attribution (LoAF) | API calls observed |
|---|---|---|---|
| App boot | 1 × 95–98 ms | `main-*.js` evaluation | 6 parallel startup calls (good) |
| Open case (Shortlist tab) | 69–116 ms | `Response.text.then` → render | `typeCounts`, `getFullMetadata`, `variants:query`, `presets:list`, `shortlist` |
| Switch to SNV/Indel tab | **137–176 ms** | `BUTTON.onclick` (Vuetify table mount, synchronous) | `batchGet`, `analysisGroups`, `presets`, `getFilterOptions`, `tags` (parallel) |
| Each column sort (×4) | 81–86 ms each | `Response.text.then` → 50-row table re-render | **2 × `variants:query` per click** (duplicate, ~95 ms apart) |
| Row click → details | 58–63 ms | `TR.onclick` | `transcripts:list`, `tags:list`, `getVariantTags` |

Interpretation: no >1 s freeze, but every page render of 50 rows is an ~85 ms main-thread task on a fast desktop (≈ 300+ ms on a 4×-slower clinical laptop), and **every sort fires the query twice** (R-1). Lighthouse/CLS work is covered by the parallel audit and not duplicated here.

---

## 3. Summary table of findings

| ID | Sev | Layer | Finding | Fix | Effort |
|---|---|---|---|---|---|
| M-1 | P0 | Electron main | Frequency maintenance (`updateFrequencies` / `decrementFrequencies` / `recomputeAllFrequencies`) runs on main over whole case / whole DB | Move into import/delete workers | M |
| M-2 | P0 | Electron main | Multi-file import (2nd..Nth file) parses + inserts on main, holds `BEGIN IMMEDIATE` for the whole file, then global FTS rebuild + ANALYZE on main | Route through import worker (append mode) | L |
| M-3 | P0 | Electron main | Cohort export (≤100k rows + `XLSX.write`) entirely on main, no progress/cancel | Move into export worker; stream CSV | M |
| M-4 | P0 | Electron main / DB | `busy_timeout=5000` on main connection: any main-thread write during a worker write txn freezes the app ≤5 s then fails | Write worker (single writer) or `busy_timeout≈50` + async retry | M–L |
| M-5 | P0 | Electron main | `PRAGMA rekey`, plaintext→encrypted migration (2× `copyFileSync`, integrity_check, SHA-256 of all rows) on main | utilityProcess/worker with progress | M |
| M-6 | P0 (upgrade) / P1 | Electron main | Window created only after `await initDatabaseManager()` (schema, migrations, `CREATE INDEX` on variants, scrypt) | Show window first with "opening database" state; migrate in worker | M |
| W-1 | P0 | Server / DB | `cases:delete` (PG) `TRUNCATE variant_frequency` + full GROUP BY rebuild inside request txn → ACCESS EXCLUSIVE lock blocks every `variants:query` | Incremental decrement by case; background job | M |
| W-2 | P0 | Server / DB | Cohort read can run a synchronous `TRUNCATE`+rebuild of `cohort_variant_summary` inside the request (<50 cases or never built); concurrent stale reads each rebuild | Always background + single-flight; serve stale with warning | S–M |
| W-3 | P0 | Server event loop / Electron main | adm-zip reads (≤256 MB) and inflates (≤512 MB) synchronously in `batch-import:extractZip` / `testZipPassword` | Streaming unzip (yauzl/unzipper) in a worker | M |
| W-4 | P1→P0 at WGS | Server / DB | `cohort:getSummary`, `cohort:getGeneBurden` aggregate all variants per call, no cache, gene burden unbounded | Precompute in summary tables; cache per cohort-version | M |
| W-5 | P1 | Server | Pool `max=4` + 3 sequential round-trips/request (user re-check, handler, awaited audit insert) | Pool 10–20; cache user check (≤5 s); fire-and-forget batched audit | S |
| W-6 | P1 | Server event loop | Large JSON responses serialized synchronously (measured livez p95 44 ms / max 77 ms); cohort limit up to 10000; `cases:query` limit unvalidated (`LIMIT NULL`) | Cap pages (≤500), response schemas (fast-json-stringify), validate autorouted args | S |
| D-1 | P0 | DB (SQLite) | Import/delete rebuild *global* structures: DROP all variant indexes, FTS5 `rebuild` of all rows, full ANALYZE, full cohort summary rebuild | Per-case incremental FTS/summary; keep indexes | L |
| D-2 | P1 | DB (both) | Default sort `pos ASC NULLS LAST, id` has no `(case_id,pos)` index → full sort of the case per page/prefetch | Add `(case_id,pos,id)` index; drop NULLS LAST or match index | S |
| D-3 | P1 | DB (both) | `COUNT(*)` on every filter change; OFFSET pagination everywhere | Capped/estimated counts, keyset pagination | M |
| D-4 | P1 | DB (PG) | Trio filters use `NOT IN (subquery)` | `NOT EXISTS` anti-join | S |
| D-5 | P1 | DB | FTS global (SQLite) / GIN defeated by `OR EXISTS` (PG); `LIKE '%x%'` filters | Case-scoped FTS / UNION; trigram indexes | M |
| R-1 | P1 | Renderer | `useOffsetPagination` has no request token → stale results win; sort/filter change fires 2 identical queries (measured) | Generation token + AbortController; single trigger | S |
| R-2 | P1 | Renderer | Gene autocomplete not debounced, no stale guard; cohort variant fetch (with COUNT) per keystroke | 200 ms debounce + token + `_count_needed:false` | S |
| R-3 | P1 | Renderer | Gene Burden: one `getFullMetadata` IPC per case (`Promise.all` of N) | Batch endpoint | S–M |
| R-4 | P1 | Renderer | Manhattan/Volcano: SVG scatter, `Plotly.newPlot` on every change; D3 lollipop/gene plots tear down on every resize tick | `scattergl`/`Plotly.react`; rAF-throttled resize with equality check | S–M |
| R-5 | P1 | Renderer | 50-row table render ≈ 85 ms long task; tab switch 137–176 ms | Profile row view-model; reduce per-cell components/tooltips; `v-data-table-virtual` | M |

Full detail, evidence and additional P2/P3 findings below.

---

## 4. Findings — Renderer (`src/renderer/src`)

**R-1 · P1 · Pagination races and duplicate queries** — `composables/useOffsetPagination.ts:145-203` writes `items.value = result.data` (`:160`, `:185`) and `loading.value=false` (`:202`) without any request generation token; whichever response arrives last wins. `invalidateAndReload` (`:218-223`) sets `page.value = 1` then calls `loadPage()`, and when the page was ≠1 `v-data-table-server` also emits `@update:options` (`components/VariantTable.vue:22`, `CohortTable.vue:100`) → second identical query. Sort changes: `update:options` loads, then the `sortKey` watcher (`:230-238`) resets `page` → another load. **Measured:** 2 × `variants:query` per sort click. `useCohortData.ts:380-444` has a generation guard but is unused by `CohortTable`. Fix: monotonic `requestId` checked before assignment, `AbortController` passed through `window.api` (web: `fetch` signal; desktop: drop result), single source of load triggers. Effort S.

**R-2 · P1 · Cohort view double query on mount** — `CohortTable` first fetch uses default `genomeBuild='GRCh38'` (`useCohortData.ts:174`) while `components/CohortView.vue:131` awaits `loadAvailableBuilds()`; a build switch triggers `refresh()` via the watcher at `:144`; combined with R-1 the slower response may overwrite the correct one. Fix: resolve builds before first query (or gate query on `buildsLoaded`). S.

**R-3 · P1 · Undebounced gene autocomplete** — `CohortFilterBar.vue:427-451` runs `api.cohort.getVariants({gene_symbol, limit:100})` per keystroke, without `_count_needed:false` (so a COUNT runs too). `useGeneAutocomplete.ts:49` `searchGeneSymbols` claims "debounced IPC" (`:22`) but is not. No stale guard. Fix: `useDebounceFn(…, 200)` + token + dedicated gene-symbol endpoint. S.

**R-4 · P1 · N IPC calls for Gene Burden** — `composables/useAssociation.ts:61-64` `Promise.all(caseList.map(c => api.caseMetadata.getFullMetadata(c.id)))` on every mount/refresh (`GeneBurdenView.vue:213,223`). Fix: `caseMetadata:getManyFull(ids)`. S–M.

**R-5 · P1 · SVG plots and D3 full redraws** — `ManhattanPlot.vue:69`, `VolcanoPlot.vue:70,80` `type:'scatter'` (SVG, ~20k nodes) with `Plotly.newPlot` on every `props.results` change (`:114/:105`, watchers `:117/:108`). `useLollipopPlot.ts:878`, `useGeneStructurePlot.ts:558` call `render()` from `watchEffect` and `render()` starts with `selectAll('*').remove()` (`:317/:105`); `useResizeObserver.ts:30` assigns a new `{width,height}` object every tick (no equality check / rAF). Fix: `scattergl` + `Plotly.react`; rAF-coalesced resize with equality check; D3 enter/update/exit. S–M.

**R-6 · P1 · Association search not debounced** — `AssociationResultsTable.vue:5` → `filteredResults` (`:165-169`) filters + client `v-data-table` re-sort on each keystroke; results in deep `ref` (`GeneBurdenView.vue:155`). Fix: debounce 200 ms, `shallowRef`. S.

**R-7 · P1 · Table render cost (measured)** — each 50-row page render ≈ 81–86 ms long task; SNV/Indel tab mount 137–176 ms (LoAF `BUTTON.onclick`, Vuetify). Fix: profile `variant-table/useVariantRowViewModel.ts`, remove per-cell tooltip/menu instances (lazy-activate on hover), consider `v-data-table-virtual` for 100-row pages; keep previous rows rendered while loading (no flash). M.

**R-8 · P2 · Case list grows without bound and races** — `CaseList.vue:322` `cases.value = markRaw([...cases.value, ...result.data])` (O(n) copy per page), plain `v-for` in `v-infinite-scroll`, no token in `onLoad` (`:296`) vs `resetList` (`:343`) → old-filter results appended to new list. Fix: token + `v-virtual-scroll`. S.

**R-9 · P2 · O(n²) / unvirtualized lists** — `association/GroupBuilder.vue:64` one `v-checkbox` per case with `selectedIds.includes` per row and in `allSelected/someSelected` (`:133-139`) → use a `Set`. `shortlist/ShortlistTable.vue:221-232` up to 500 rows each with a `v-tooltip`. `cohort/CarrierExpandedRow.vue:13` plain `v-for`; `useCarriers.ts:36` module-level deep `ref(Map)` never evicted, no in-flight dedupe (`:121-123`). `panels/PanelEditorDialog.vue:78` `v-for` over thousands of genes. S each.

**R-10 · P2 · More stale-result races** — `views/CaseView.vue:141-147` (`loadTypeCounts` on fast case switch shows previous case's tabs), `useTranscripts.ts:18-30,60`, `useFilterOptionsCache.ts:70-92`, `HpoTermSelector.vue:103`, `BatchImportDialog.vue:192-203` (also unhandled rejection in `setTimeout`). Fix: shared `useLatestRequest()` helper. S.

**R-11 · P2 · Bundled HPO JSON parsed on main thread** — `useHpoBundled.ts:56` imports 1.5 MB `assets/data/hpo-terms.json`; concurrent callers busy-wait in a 50 ms polling loop (`:45-48`). Fix: load in a Web Worker (or `JSON.parse` from `fetch` in idle time) and share a single promise. S.

**R-12 · P2 · Sequential independent awaits** — `stores/databaseStore.ts:127-128, 148-149, 163-165, 205-206` `await loadCapabilities(); await fetchRecent()`; concurrent `getCurrentUnsupportedReason` each trigger `loadCapabilities` (`utils/backend-capabilities.ts:85-87`). Fix: `Promise.all` + memoized in-flight promise. S.

**R-13 · P2 · `CohortView.vue:42`** fetches the full `cases.list()` to look up a single name. Fix: `cases:get(id)`. S.

**R-14 · P2 · Per-cell function calls in cohort table** — `cohort/CohortDataTable.vue:57-59` (`isGlobalStarred`, `getGlobalAcmgClassification`, `getGlobalComment` per cell) vs VariantTable's precomputed row view-model (cohort-parity gap). M.

**R-15 · P3** — repeated `JSON.stringify` of filter state (`useFilterState.ts:112`, `FilterToolbar.vue:438` — also `toRaw` breaks tracking, `useVariantData.ts:54`, `CohortFilterBar.vue:271,468`); `stores/logStore.ts:76-80` copies up to 1000 entries per log; `usePanelResize.ts:38` mousemove without rAF; `useShellNavigation.ts:47-59` + `ViewTransitionOverlay.vue:2-6` persistent full-screen overlay during `router.push` (blocks input briefly); `useAnnotations.ts:304-306,329-331` `triggerRef` per key; `dsl/autocomplete.ts:90` regex per keystroke (not catastrophic). No Web Workers exist in the renderer.

---

## 5. Findings — Web server (`src/web/server`, `src/main/storage/postgres`)

**W-1 · P0 · Case delete takes a global ACCESS EXCLUSIVE lock** — `PostgresCaseLifecycleRepository.ts:143` `TRUNCATE "variant_frequency"` then full `GROUP BY chr,pos,ref,alt` rebuild (`:144-148`) inside the request transaction; plus unscoped `UPDATE cohort_variant_summary` (`cohort-annotation-flags-sql.ts:159-163`) and cascade delete of ~5M rows. Every `variants:query` joins `variant_frequency` (`PostgresVariantReadRepository.ts:191`) → all users block, then fail at `lock_timeout` 5 s (`config.ts:29`); the delete itself likely hits `statement_timeout` 30 s (`config.ts:27`) at WGS scale. Fix: decrement `variant_frequency` by the deleted case's coord set (`UPDATE … FROM (SELECT DISTINCT coord_hash … WHERE case_id=$1)`), batch the cascade delete in chunks (or soft-delete via the existing `cases_all` provisional visibility from migration `0015` and purge in a background worker), return 202 + SSE progress. M.

**W-2 · P0 · Synchronous cohort summary rebuild on read** — `cohort-read-freshness.ts:158-169` runs `runSynchronousRebuild` when never built or stale with < 50 cases (`:28`, `VARLENS_PG_COHORT_SUMMARY_SYNC_MAX_CASES`). `rebuild()` = `TRUNCATE cohort_variant_summary` (`PostgresCohortSummaryRepository.ts:133`) + aggregate with correlated subqueries (`:139-240`). Only the background path is single-flight (`:129-143`), so N concurrent stale reads start N rebuilds on N of the 4 pool connections. Fix: always rebuild in background single-flight; serve previous summary with `warnings.stale`; build into a shadow table + `ALTER TABLE … RENAME` swap instead of TRUNCATE. S–M.

**W-3 · P0 · Synchronous ZIP extraction on the event loop** — `src/main/import/ZipExtractor.ts:52` `new AdmZip(zipPath)` (sync read up to 256 MB, limit `:30`), `:119` `entry.getData()` sync inflate up to 128 MB/entry, 512 MB total (`:32-33`); comment at `:28` acknowledges sync. Reachable from `routes/batch-import.ts:160` (`extractZip`) and `:198` (`testZipPassword` → `batch-import-logic.ts:273`, which inflates every entry). Same code on Electron main. Fix: `yauzl`/streaming unzip in a `worker_thread`; password test on first entry only. M.

**W-4 · P1 (P0 at WGS) · Whole-table aggregates per request** — `PostgresCohortRepository.ts:386-433` `getSummary` (`COUNT(*)`, `GROUP BY chr,pos,ref,alt`, `COUNT(DISTINCT gene_symbol)` over all variants + 6 annotation counts); `:486-497` `getGeneBurden` (`COUNT(DISTINCT (chr,pos,ref,alt))` grouped by gene, no LIMIT, ~20k rows plain `JSON.stringify`). No caching. Measured 252 ms p50 under 20-way concurrency on only 19.5k variants. Fix: read counts from `cohort_variant_summary` (`COUNT(*)` of summary = unique variants) and maintain a `gene_burden_summary` alongside it; cache keyed on summary version. M.

**W-5 · P1 · Pool size 4 and per-request round-trips** — `config.ts:31` `DEFAULT_PG_POOL_MAX = 4`; one pool shared by storage and auth (`server.ts:141`). Every authenticated call: `authService.getUser` (`auth.ts:319`) + handler + awaited audit insert (`dispatcher.ts:359-367,384-387`; read-audit exclusion list `audit.ts:18-33` is tiny). Cohort page adds freshness probe + total-cases count + `COUNT(*)` + page. Measured: healthz p95 130 ms while event loop p95 7.6 ms (pool queueing). Fix: pool 10–20 (sized to PG `max_connections`/replicas); cache live-user check for ~5 s keyed on session; enqueue audit rows into an in-memory buffer flushed every 250 ms via one multi-row `INSERT` (still durable enough; or keep sync for writes only); run independent cohort pre-queries with `Promise.all`. S.

**W-6 · P1 · Large synchronous serialization / unbounded limits** — measured 884 KiB (`variants:query` 1000 rows) and 4 MiB (`cohort:getVariants` 10000 rows) JSON bodies → livez p95 44 ms / max 77 ms. Cohort `limit ≤ 10000` (`src/shared/types/ipc-schemas.ts:80`) vs variants `≤ 1000` (`:348`). Autorouted reads skip validation (`task-types.ts:13-67`, `dispatcher.ts:372-375`): `cases:query` passes `limit` straight to SQL (`PostgresCasesQueryRepository.ts:15,88`, missing → `LIMIT NULL` = all rows); `cohort:query` uncapped; `OffsetSchema` no max (`ipc-schemas.ts:324`); `cases:list` no LIMIT (`PostgresCaseListRepository.ts:28`). No response compression. Fix: cap UI pages at 500, validate every autorouted arg with Zod, add Fastify response schemas (fast-json-stringify) for hot routes, enable `@fastify/compress` with async zlib only above ~16 KiB (or at the reverse proxy). S.

**W-7 · P2 · Imports single-flight per process; HTTP request held open** — `import-logic.ts:98` throws "already in progress" for any second user; web route awaits the entire import (`routes/import.ts:137`); `import:cancel` cancels whoever's import is running (`import-logic.ts:142`). Import txn updates `cohort_variant_summary` rows (`postgres-import-worker.ts:154-167`), contending with rebuilds/deletes. Fix: job queue (per-user job id, 202 + SSE progress, cancel by job id). M.

**W-8 · P2 · Argon2 on the default 4-thread libuv pool** — async (`@node-rs/argon2`) but 64 MiB, t=3, p=4 (`src/main/auth/argon2-provider.ts:10-14`); `UV_THREADPOOL_SIZE` unset (Dockerfile `:67`). Concurrent logins compete with async fs/static serving. Fix: `UV_THREADPOOL_SIZE=8–16`, cap concurrent hashes with a semaphore. S.

**W-9 · P2 · SSE without backpressure/heartbeat** — `events.ts:57-58` ignores `reply.raw.write` return value; no keep-alive ping (proxies drop idle streams). Fix: check `write()`→drop/close slow clients; 25 s `:ping`. S.

**W-10 · P2 · Login rate limit keyed on `request.ip` without `trustProxy`** — `rate-limit.ts:78`, 10/min; behind the reverse proxy all users share one IP → site-wide 429s (blocks all users from logging in). Fix: `trustProxy` set to the proxy CIDR. S.

**W-11 · P2 · No Fastify server limits** — no `bodyLimit`, `requestTimeout`, `connectionTimeout`, `trustProxy` in `src/web`. Upload staging is in-memory `Map` (`upload-staging.ts:40`). S.

**W-12 · P3** — per-item query loops in transactions (`PostgresTagsRepository.ts:183`, `PostgresFilterPresetsRepository.ts:201`); `cohort:getColumnMeta` cache never invalidated (`PostgresCohortRepository.ts:588`, stale not blocking); session cookie re-encrypted every response (`auth.ts:336`); pino to stdout (sync by default); `existsSync` in `upload-staging.ts:53`, `statSync`/`readdirSync` in `vcf-preview.ts:27,131`; `web-gene-reference.ts:59` sync SQLite (fixtures-only).

---

## 6. Findings — Electron main (`src/main`)

**Read path map.** Off-main (Piscina `DbPool`, `createSqliteStorageSession.ts:49-54`, `query_only` at `workers/db-worker.ts:52`): variants query/filterOptions/search/geneSymbols/typeCounts/columnMeta, cohort query/columnMeta/summary/carriers/geneBurden, cases list/query, case-metadata reads, annotation reads, tags/transcripts/gene lists reads, overview, association data build. Separate workers: import, batch import, delete, cohort-summary rebuild, variant export, statistics. **On main:** every write (`SqliteWriteExecutor.ts:36-325`, annotations, tags, panels, presets, comments, `ApiCache.ts:33`), plus the items below. No `sendSync`, no `ipcMain.on` returnValue, no `show*DialogSync` (good).

**M-1 · P0 · Frequency maintenance on main** — `SqliteImportExecutor.ts:198` → `VariantFrequencyService.ts:16-27` (`INSERT…SELECT DISTINCT … ON CONFLICT` over the whole case); batch import loops it per case (`batch-import-logic.ts:201-206`); single delete `cases-logic.ts:141` → `decrementFrequencies` (`VariantFrequencyService.ts:34-46`, incl. full-scan `DELETE … WHERE case_count<=0`); batch/delete-all `cases-logic.ts:203,248` (and error path `:163`) → `recomputeAllFrequencies` (`:53-60`, GROUP BY over every variant; DELETE and INSERT not in one txn). Fix: perform inside the import/delete worker transaction that already touches those rows. M.

**M-2 · P0 · Multi-file append on main** — `ipc/handlers/import-logic-append.ts:11-13` ("This runs on the main thread (not in a worker)"), parse/map/`insertBatch` 5000 rows (`:96-206`), second connection with key derivation (`:69`), `BEGIN IMMEDIATE` for the whole file (`:94`); finish: `finishBulkInsertNoCount()` (`import-logic.ts:384` → `VariantRepository.ts:183-211`: global FTS rebuild, ANALYZE, optimize) and decrement+update frequencies (`:423-424`). Fix: add `mode:'append', caseId` to the import worker pipeline. L.

**M-3 · P0 · Cohort export on main** — `export-logic.ts:242-326`: `getCohortVariants({limit:100000})` (`:250-255`), `aoa_to_sheet` (`:278`), cohort summary (`:289`), `XLSX.write` (`:325`). No progress, no cancel. Variant export is correctly in a worker (`export-worker-client.ts:40`) but `ExportWorkerClient.cancel()` (`:90`) is never wired to IPC, and the pre-count `getExportCount` (`export-logic.ts:77`, `VariantRepository.ts:389-394`) runs `count(*)` on main. Fix: reuse export worker for cohort; stream CSV; wire cancel; move count into the worker. M.

**M-4 · P0 · Lock wait freezes the event loop** — main connection `busy_timeout = 5000` (`DatabaseService.ts:93`, `src/shared/config/database.config.ts:16`). Long worker write locks: import (drops indexes `import-pipeline.ts:37-47`, then FTS/summary/index rebuild `import-worker.ts:268-271,296-304`), rebuild-summary worker, delete worker, multi-file append on a second connection. Any main write (annotation star, comment, tag, API cache write from VEP lookup) during those → synchronous wait up to 5 s → SQLITE_BUSY. For the append path the lock holder is the same thread → guaranteed 5 s freeze. Fix: dedicated **write worker** (single writer queue, async from main's perspective) or `busy_timeout` ≈ 50 ms with async retry/backoff + optimistic UI; shorten worker transactions (commit per batch, not per phase). M–L.

**M-5 · P0 · Rekey/encryption migration on main** — `database.ts:340` → `database-lifecycle-logic.ts:432` → `DatabaseService.ts:312` `PRAGMA rekey` (rewrites file); `database-migration-logic.ts:138` → `plaintext-migration.ts:325,362` (`copyFileSync` ×2), `:329` rekey, `:166,240` integrity_check, `plaintext-migration-signal.ts:66-78` SHA-256 over every row ×2. Minutes for multi-GB DBs. Fix: `utilityProcess`/worker with progress events; close main connection meanwhile. M.

**M-6 · P0 on upgrade / P1 normally · Startup gated on DB** — `index.ts:209` `await initDatabaseManager()` precedes IPC registration (`:219`) and `createWindow()` (`:269`). Open runs key setup (`DatabaseService.ts:78`), schema/column migrations + `CREATE INDEX IF NOT EXISTS` on variants (`schema.ts:247-252`), `runMigrations` (`:104`, e.g. `migrations.ts:1425` `UPDATE variants SET variant_type…`, indexes `:246-252,1300,1330,1433-1436`), and after a crashed import rebuilds dropped indexes (`import-worker.ts:299`). `openDetectEncryption` opens the DB fully twice (`DatabaseManager.ts:79-81`, close runs `optimize` + `wal_checkpoint(TRUNCATE)` `DatabaseService.ts:339-341`). Password open: `scryptSync` N=16384 ×2 (`db-key-passphrase.ts:20,38`; `database-lifecycle-logic.ts:150,158`) and up to 3 full opens (`:181-188`). Fix: create window immediately (`show:false`+`ready-to-show` already exist, `index.ts:73,91`), renderer shows "Opening database…"; run migrations in a worker (better-sqlite3 works in worker_threads) with progress; async `crypto.scrypt`; cheap header probe for encryption detection. M.

**M-7 · P1 · Shortlist on main** — `ipc/handlers/shortlist.ts:104-105` → `ShortlistService.ts:161-194` (≤4 filtered queries + JS scoring/sort), `SqliteReadExecutor.ts:169-170` bypasses the pool. Fix: add `variants:shortlist` to `db-worker-dispatch.ts`. S.

**M-8 · P1 · Other main-thread heavy paths** — `region-files:importBed` chunked sync txns up to 1M rows (`GeneListRepository.ts:132-171`); `audit:query` up to 10k rows (`audit-log.ts:49,109`); `vep:getCacheStats` `SUM(LENGTH(response_data))` (`ApiCache.ts:50-55`); association FDR + sort + `JSON.parse(JSON.stringify(results))` (`AssociationEngine.ts:108,116`, `cohort-logic.ts:396`) and per-gene unthrottled progress to renderer (`WorkerPool.ts:55-59`, `cohort.ts:128-129`). Fix: move to worker / throttle progress to 10 Hz. S–M.

**M-9 · P1 hygiene · `dialog.showErrorBox` on every uncaught exception / unhandled rejection** (`index.ts:48,57`) — modal blocks main until dismissed. Fix: log + non-modal renderer toast; reserve modal for fatal startup errors. S.

**M-10 · P2 · Network calls without timeouts** — `EnsemblApiClient.ts:128`, `InterProApiClient.ts:154`, `SpliceAIApiClient.ts:204`, `GnomadApiClient.ts:174,330`, `UniProtApiClient.ts:153`, `MyVariantApiClient.ts:195`, `AlphaFoldApiClient.ts:136`, `VepApiClient.ts:243`; several are single-flight (`GnomadApiClient.ts:76`, `MyVariantApiClient.ts:106`, `SpliceAIApiClient.ts:96`, `InterProApiClient.ts:43`) → one hung request stalls the feature indefinitely (not the thread). Fix: `AbortSignal.timeout(15000)` + `AbortSignal.any` with user cancel. S.

**M-11 · P3** — electron-log file transport is `sync: true` (`writeFileSync` per line) and each line is broadcast to every window (`MainLogger.ts:35-37,80-92`); `xlsx` and `adm-zip` imported at module scope before window creation (`export-logic.ts:8`, `ZipExtractor.ts:1`); cheap sync fs on IPC paths (`import-logic.ts:271,337`, `export.ts:33`, `vcf-preview.ts:27,131`); dev-only `copyFileSync` in `gene-ref.ts:106`. Side bug: API cache singletons keep the first DB handle across DB switches (`vep.ts:23`, `protein.ts:35`).

---

## 7. Findings — Database (both backends, WGS ≈ 5M variants/case)

**D-1 · P0 · SQLite import/delete cost scales with the whole DB** — `import-worker.ts:55` runs `DROP_INDEXES` (`import-pipeline.ts:37-47`: case-coords, filter-covering, gene indexes for **all** cases — other readers lose them for the duration) and rebuilds them at `:296`; `:270` → `worker-db.ts:52-55` FTS5 `'rebuild'` of every row + full `ANALYZE` (worker never sets `analysis_limit`; only `DatabaseService.ts:97` does); `:272` full cohort summary rebuild in one write txn (`cohort-summary-rebuild.ts:8-60`) although `CohortSummaryService.incrementalAdd/Remove` (`:71,:94`) exist unused; `synchronous=OFF`, `wal_autocheckpoint=0` (`worker-db.ts:48,53`) → unbounded WAL slows readers. Delete worker repeats FTS + summary rebuild (`delete-worker.ts:69-70`). Fix: keep indexes (insert cost is acceptable vs. global rebuild) or drop only for empty DB; incremental FTS insert for the new rowid range (`INSERT INTO variants_fts(rowid,…) SELECT … WHERE case_id=?`); use `incrementalAdd/Remove`; `ANALYZE` with `analysis_limit`; periodic `wal_checkpoint(PASSIVE)` between batches. L.

**D-2 · P1 · Default sort has no index** — `VariantFilterBuilder.ts:711` and `PostgresVariantReadRepository.ts:319-321` `ORDER BY pos ASC NULLS LAST, id ASC`; indexes are `(case_id, chr, pos, …)` (SQLite `migrations.ts:249`, PG `0003:138`) → every page and prefetch sorts the full filtered case. SQLite's default NULL order for ASC is NULLS FIRST, so `NULLS LAST` defeats index order there (inference). Fix: index `(case_id, pos, id)` and emit `pos IS NULL, pos, id` matching an expression/partial index, or default sort to `(chr_order, pos, id)` with a matching index. S.

**D-3 · P1 · COUNT per filter change; OFFSET everywhere** — SQLite `VariantRepository.ts:323-333`, PG `PostgresVariantReadRepository.ts:422-431` (+ unfiltered count `:447`; `includeUnfilteredCount` could use `cases.variant_count`); cohort `PostgresCohortRepository.ts:311,356`, SQLite `cohort.ts:329` counts every variant in the DB. OFFSET at `VariantRepository.ts:342`, `PostgresVariantReadRepository.ts:440`, `cohort.ts:256`, `postgres-cohort-summary-query.ts:80`, `CaseRepository.ts:288`, `PostgresCasesQueryRepository.ts:89`, `AuditLogRepository.ts:78`. No `VACUUM ANALYZE` after PG COPY import (visibility map unset → index-only counts hit heap). Fix: `COUNT` capped (`SELECT count(*) FROM (… LIMIT 10001)` → "10,000+"), run count in parallel with page, `ANALYZE` (PG) after import, keyset pagination `(sort_val, id) > ($1,$2)` for next/prev with OFFSET only for jump-to-page. M.

**D-4 · P1 · PG trio `NOT IN (subquery)`** — `postgres-variant-clinical-filter-sql.ts:177,192,213`: cannot become an anti-join; spills to per-row subplan beyond `work_mem` (O(N·M)). Fix: `NOT EXISTS (SELECT 1 … WHERE p.coord_hash = v.coord_hash)`. S.

**D-5 · P1 · Search** — SQLite FTS is global, not per case (`search-clause-emitter.ts:88-94` `id IN (SELECT rowid FROM variants_fts WHERE MATCH ?)`; FTS indexes low-cardinality `consequence`, `schema.ts:92`) → common terms materialize tens of millions of rowids. PG: `search_document @@ … OR EXISTS(variant_sv…) OR EXISTS(variant_str…)` (`PostgresVariantReadRepository.ts:163-175`) defeats the GIN bitmap scan. Substring `LIKE '%x%'`: `VariantFilterBuilder.ts:287,528`, `variant-where-builder.ts:126,201`, `search-clause-emitter.ts:103`, `cohort.ts:276-293`, `cohort-search-emitter.ts:50`, PG cohort `postgres-cohort-summary-query.ts` (`cvs.gene_symbol ILIKE`, no trigram index). Fix: add `case_id UNINDEXED` column to FTS and filter in MATCH, drop `consequence` from FTS; PG `UNION` of the three branches; `pg_trgm` GIN on `cohort_variant_summary.gene_symbol`. M.

**D-6 · P1 · SQLite filter options computed live per case open** — `VariantRepository.ts:448-530` `COUNT(DISTINCT)` on ~21 columns + MIN/MAX over 5M rows; per-column meta `:561-696`, fired once per extension column (`ExtensionColumnFilters.vue:171-187`). Only mitigation: renderer LRU (`useFilterOptionsCache.ts:58`). Fix: materialize per-case metadata at import like PG's `cohort_column_meta`. M.

**D-7 · P1 · Cohort default sort / recompute** — `carrier_count DESC NULLS LAST, chr, pos, ref, alt` (`cohort.ts:227`, PG summary query) cannot use `idx_cvs_carrier` (`0010:39`) → full top-N sort per page. `RECOMPUTE_ALL_FREQUENCIES_SQL` (`cohort-summary-rebuild.ts:193-195`) and PG `recomputeCohortFrequency` (`PostgresCohortSummaryRepository.ts:279-290`) rewrite every summary row after each import/delete. Fix: index `(carrier_count DESC NULLS LAST, chr, pos, ref, alt)`; store `carrier_count` and derive frequency at read time (`carrier_count / total_cases`) instead of rewriting. S–M.

**D-8 · P1 · PG migrations lock big tables** — plain `CREATE INDEX` on `variants` (`0007:13,18`, `0009:8`), stored generated-column rewrite (`0004:99-112`), full `UPDATE variant_transcripts` (`0014`), `lock_timeout 0` (`PostgresMigrationRunner.ts:94`). `0009:8` btree on `(chr,pos,ref,alt)` reintroduces the >2 KB key limit that `coord_hash` (`0003:140-141`) avoided → long SV alleles can fail inserts. Fix: `CREATE INDEX CONCURRENTLY` in non-transactional migrations; index `coord_hash` instead. M.

**D-9 · P2** — no cancellation of superseded reads (SQLite `DbPool.run` no abort `DbPool.ts:99-108`; PG no `pg_cancel_backend`, only 30 s `statement_timeout`) → stale queries occupy 1 of 4 pool slots; column-meta caches never invalidated (SQLite worker copies `cohort.ts:456` vs main-only invalidation `cohort-logic.ts:449`; PG `PostgresCohortRepository.ts:242`); PG starred/ACMG filters as correlated EXISTS from the variant side with `starred::text` cast (`postgres-variant-clinical-filter-sql.ts:69,100-120`); association `.all()` of all qualifying variants (`AssociationDataBuilder.ts:62-84`, in worker → memory); missing indexes SQLite `(case_id,pos)`, `(case_id,gene_symbol)`, `(case_id,gt_num)`, `(case_id,qual)`, `variant_frequency(case_count)`; PG `(case_id, gnomad_af|cadd|qual|clinvar|gt_num)`; ~16 SQLite indexes on `variants` with redundant ones (`idx_variants_chr_pos_ref_alt` `schema.ts:75` = `idx_variants_coords` `migrations.ts:1740`; `idx_variants_pos`, `idx_variants_gene`, `idx_variants_type` are prefixes/overlaps) slowing every insert.

**D-10 · P3** — `read_uncommitted = ON` (`db-worker.ts:49`) is a no-op without shared cache; PG BRIN on `(chr,pos)` (`0007:13`) ineffective because rows load per case.

---

## 8. Findings — Import / Export

Covered above; consolidated view:

| Path | Off-thread? | Chunked | Progress | Cancel | Blocking residue |
|---|---|---|---|---|---|
| Desktop single-file import | Worker (`import-worker.ts`) | 10k-row txns (`import-pipeline.ts:122`) | Throttled 100 ms (`import-worker.ts:156-168`) | Message + `terminate()` (`import-worker-client.ts:93-107`) | M-1 frequencies on main; D-1 global rebuilds hold write lock → M-4 |
| Desktop batch import | Worker | Yes | Yes | Yes | M-1 per-case frequency loop on main (`batch-import-logic.ts:201-206`); W-3 ZIP on main |
| Desktop multi-file append | **Main** | 5k rows, one txn/file | Partial | Cooperative only | M-2 (P0) |
| Desktop delete | Worker (`cases-logic.ts:43-75`) | – | – | – | M-1 decrement on main; D-1 rebuild |
| Desktop variant export | Worker (`export-worker-client.ts:40`) | CSV streamed w/ backpressure (`export-pipeline.ts:72-103`); XLSX buffers ≤100k rows (`:155-183`) | – | **Not wired** (`:90`) | Pre-count on main (`export-logic.ts:77`) |
| Desktop cohort export | **Main** | No (100k rows) | No | No | M-3 (P0) |
| Web import | Worker + own pg client (`PostgresImportExecutor.ts:165`), COPY | Yes | SSE | Global, not per job (`import-logic.ts:142`) | W-7: process-wide single-flight, HTTP request held open; uploads streamed to disk w/ backpressure (`upload-staging.ts:226-253`) ✔ |
| Web export | `pg-query-stream` + drain (`PostgresExportRepository.ts:26-41`, `export-logic.ts:162-183`) | Yes | – | – | Fixture-gated (`routes/export.ts:268`); holds a pool client for the whole stream (pool of 4) |

UI stays usable during imports: "Continue in Background" (`VcfImportDialog.vue:481`, `BatchImportDialog.vue:422`) ✔ — except M-4 freezes when the user writes annotations during an import's write-lock phase.

---

## 9. Already non-blocking and done well

- **Renderer:** server-side paging (≤100 rows) with count caching and next-page prefetch (`useOffsetPagination.ts:79-125,176-191`); `shallowRef`/`markRaw` for row arrays (`useOffsetPagination.ts:71`, `useVariantData.ts:116`, `useCohortData.ts:156,426`, `CaseList.vue:225`, `useShortlistQuery.ts:69,114`, `useCaseMetadata.ts:38`); annotation LRU with microtask-batched `triggerRef` (`useAnnotations.ts:33,44-53`); per-row view models (`variant-table/useVariantRowViewModel.ts`, `useVariantRenderRows.ts`); request tokens in `useShortlistQuery.ts:95,109`, `useVepEnrichment.ts:142,162`, `useProteinData.ts:54`, `useAnnotations.ts:289,315`; ~12 debounced inputs (`useFilterState.ts:109`, `useDslSearch.ts:67`, `CohortFilterBar.vue:465`, `useVariantData.ts:181`, `CohortTable.vue:537`, `CohortDataTable.vue:318`, `CaseList.vue:349`, `HpoTermSelector.vue:136`, `HpoAutocomplete.vue:117`, `LogViewer.vue:148`, `FaqDialog.vue:63`, `panels/GeneAutocomplete.vue:82`); `v-virtual-scroll` with rAF scroll in `LogViewer.vue:69,245`; lazy routes + idle prefetch (`router/index.ts:16,28,40`); async components (`App.vue:113-122`, `AppDialogHost.vue:42-49`, `VariantDetailsPanel.vue:211-231`); Plotly, Mol*, D3 dynamically imported; parallel startup requests (measured: 6 concurrent); non-blocking `fetchInfo` (`App.vue:361`).
- **Web server:** event loop measured healthy for normal pages; dev latency injection uses `setTimeout`; argon2 async; imports in a worker with own client + advisory lock; uploads streamed to disk; export streamed; `/livez` independent of DB, `/healthz` capped at 1.5 s (`server.ts:363-378`); statement/lock/idle-in-txn timeouts configured (`config.ts:27-30,201-204`); entitlement/JWKS caches with single-flight and fetch timeouts (`platform-identity.ts:84,260-274`); `cohort_column_meta` materialized per case; background summary rebuild single-flight for ≥50 cases; named prepared statements; UNNEST bulk writes; bounded metric labels; OpenAPI generated once.
- **Electron main:** no `sendSync`/`*DialogSync`; Piscina read pool with `query_only` connections; key derivation inside workers; WAL + `synchronous=NORMAL`; workers for import/delete/summary rebuild/variant export/statistics; single-flight job runner (`SqliteImportExecutor.ts:247`); `show:false`+`ready-to-show`; update check delayed 5 s; API cache cleanup deferred; async argon2.
- **DB:** cohort list served from summary tables with covering indexes; PG COPY import with generated `search_document` + GIN, `pg_trgm` on `gene_symbol`, `coord_hash`, provisional hidden rows during import (`0015`); incremental PG summary on import and on annotation edits; SQLite FTS triggers dropped during bulk ops; annotation batch lookup (no N+1); large panels via temp table; no unindexed `info_json` filters.

---

## 10. Path to fully non-blocking (prioritized)

**Phase 1 — stop the freezes (P0, ~1–2 weeks)**
1. **Single-writer worker for SQLite** (M-4): route all `SqliteWriteExecutor` calls through one `worker_thread` owning the write connection; main never calls a sync write. Interim quick win: `busy_timeout` 50 ms on main + async retry with backoff (S).
2. **Move frequency maintenance into import/delete workers** (M-1) and **cohort export into the export worker** (M-3); wire `export:cancel` (S–M).
3. **PG case delete → background job** with case-scoped `variant_frequency` decrement, chunked cascade, no TRUNCATE (W-1).
4. **Never rebuild cohort summary inside a read** (W-2): background single-flight, shadow-table swap instead of TRUNCATE.
5. **Streaming unzip in a worker** (W-3) — fixes both web event loop and Electron main.
6. **Rekey / encryption migration / DB open+migrations off main** (M-5, M-6): window first, progress UI.

**Phase 2 — remove per-interaction jank (P1, ~1–2 weeks)**
7. Renderer `useLatestRequest()` helper (generation token + AbortController) applied to `useOffsetPagination`, CaseList, CaseView type counts, transcripts, filter options, HPO, autocomplete; dedupe sort/page triggers (R-1, R-2, R-10).
8. Debounce gene autocomplete + association search 200 ms (R-3, R-6); batch case-metadata endpoint (R-4); `scattergl` + `Plotly.react`, rAF-throttled resize (R-5).
9. Server: pool 10–20, cached live-user check, buffered audit writes, `Promise.all` for cohort pre-queries (W-5); validate autorouted args, cap pages ≤500, response schemas (W-6).
10. DB quick wins: `(case_id,pos,id)` index + NULL-order fix (D-2), `NOT EXISTS` trio filters (D-4), cohort carrier sort index (D-7), `ANALYZE` after PG import, capped counts (D-3).
11. Shortlist into the read pool (M-7); timeouts on all external API clients (M-10); replace `showErrorBox` (M-9).

**Phase 3 — WGS-scale headroom (P2, ~2–4 weeks)**
12. Incremental FTS + incremental cohort summary in SQLite; stop dropping global indexes (D-1).
13. Precomputed `gene_burden_summary` + cached cohort summary counts on PG (W-4); materialized per-case filter metadata on SQLite (D-6).
14. Keyset pagination for next/prev (D-3); case-scoped FTS, UNION for PG search, trigram on summary gene symbol (D-5).
15. Web import job queue with per-user job ids, 202 + SSE, per-job cancel (W-7); `trustProxy`, server limits, SSE heartbeat/backpressure, `UV_THREADPOOL_SIZE` (W-8–W-11).
16. Query cancellation: PG `pg_cancel_backend` on client abort (Fastify `request.raw.on('close')`), SQLite worker-side abandon of superseded tasks (D-9).
17. Renderer: virtualize case list / carriers / panel editor; reduce per-row component cost in tables (R-7, R-8, R-9).

**Gate:** add a CI-able regression check — extend `tests/e2e/renderer-perf-phase1.e2e.ts` with "max long task during sort < 50 ms" and "1 query per sort", and keep `scratchpad`-style event-loop probe (livez p95 < 10 ms, healthz p95 < 20 ms under 20-way load) as a web-gate perf test.

---

### Appendix — reproduction

```bash
# web server event-loop / pool probe (≤20 concurrent, ≤30 s)
node loadtest.mjs 16 20                      # normal mix
HEAVY=1 node heavy.mjs 20 25                 # 1000-row / 10k-row pages
AGG=1 node agg.mjs 20 15                     # getSummary + getGeneBurden
# renderer long tasks (headless Chromium, cwd = repo root)
NODE_PATH=$PWD/node_modules node longtasks.cjs <outdir>
```
Scripts live in the session scratchpad (`/tmp/claude-1000/-home-bernt-popp-development-VarLens/4596cad7-…/scratchpad/`), not in the repo.
