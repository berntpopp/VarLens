# 04 — Web performance, Lighthouse, CLS, flicker and INP audit

**Date:** 2026-10-06 · **Build:** v0.72.0 (`out/web`, `VARLENS_WEB_BASE=/ npm run build:web`) · **Target:** VarLens web mode at `http://localhost:8787/` (Fastify + Postgres, `NODE_ENV=development`, **75 ms injected latency on every `/api/*` call**)
**Method:** Headless only. Lighthouse 13.5.0 (CLI + user-flow API with puppeteer-core 25 and `/usr/bin/google-chrome` 154), Playwright 1.63 headless chromium with injected PerformanceObservers, a rAF DOM sampler, a MutationObserver and CDP screencast filmstrips. I ran each Lighthouse config 3× and report the **median**. To compare latency I started a second server instance on `:8797` with `VARLENS_WEB_API_LATENCY_MS=0` and the same schema, used it read-only, and killed it afterwards. I did not modify any repository source or app data. I logged in once (rate limit: 10/min/IP) and reused the cookie.

Artifacts:
- `lighthouse/nav-{login,home}-{desktop,mobile}-run{1,2,3}.report.{html,json}`: navigation reports. Home uses the cookie in `--extra-headers` and Lighthouse's storage reset, so the first-visit disclaimer modal is open.
- `lighthouse/flow-{desktop,mobile}-run{1,2,3}.report.{html,json}`: user flows. Each flow runs: navigation (home, disclaimer acknowledged) → snapshot → timespan (open case + SNV/Indel tab) → snapshot → timespan (sort, next page, quick filter on/off, DSL search, clear, open details, expand Evidence editor) → snapshot → timespan (switch to Cohort, sort, page) → snapshot.
- `perf-evidence/`: filmstrip contact sheets, forensic summaries per run (`forensics-*.txt`), the snappiness table, and the instrumentation scripts (`instrument.js`, `forensics.cjs`, `analyze2.cjs`, `flow.mjs`), so the numbers can be reproduced.

> **Caveats.** Other agents were driving browsers on the same host (load average about 9 on 32 cores), which is why I took the median of 3 runs. In timespan steps, Lighthouse TBT also counts puppeteer's own `pptr:internal` selector tasks (about 150 ms each, 3–5 per desktop step). Read timespan TBT as an upper bound, and rely on the Playwright long-task numbers below for app-only CPU. Mobile timespans run with Lighthouse's 4× CPU throttle. Snapshot steps have no performance score. "n/a" below means the category does not exist for that mode.

---

## 1. Lighthouse scores (median of 3)

| Route (mode) | Preset | Perf | A11y | Best-Pr. | SEO |
|---|---|---:|---:|---:|---:|
| Login `/login` (navigation, unauthenticated) | desktop | **100** | **100** | **100** | 50 |
| Login `/login` | mobile | **100** | **100** | **100** | 50 |
| Home `/` (navigation, first visit, disclaimer modal open) | desktop | 72 | 79 | 100 | 100 |
| Home `/` (navigation, first visit) | mobile | 59 | 96 | 100 | 100 |
| Home `/` (flow navigation, returning user) | desktop | 75 | 78 | 100 | 100 |
| Home `/` (flow navigation, returning user) | mobile | 56 | 96 (snapshot 91) | 100 | 100 |
| Case view: open case + SNV tab (timespan) / table snapshot | desktop | 57 | 81 | 100 | 100 |
| Case view: interactions (timespan) / details-panel snapshot | desktop | 55 | 77 | **95** | 100 |
| Case view: open case (timespan) / table snapshot | mobile | 38 | 81 | 100 | 100 |
| Case view: interactions (timespan) / details snapshot | mobile | 45 | 81 | 100 | 100 |
| Cohort view: switch + sort + page (timespan) / snapshot | desktop | 73 | 81 | **95** | 100 |
| Cohort view (timespan) / snapshot | mobile | 36 | 81 | 100 | 100 |

The 0-latency comparison on `:8797` (1 run each) scored home 83 on desktop (CLS 0.027 instead of 0.191) and 58 on mobile (LCP 12.8 s). Mobile load cost comes from the bundle and transfer. The API latency only matters for the CLS race described in finding F2.

### What blocks 100 in each category

**Performance (home, navigation)**
- `cumulative-layout-shift` 0.191 desktop / 0.106 mobile. The top culprit is the EmptyState `v-row` (score 0.180, finding F2). The case list `v-list` also shifts while loading (0.011).
- `largest-contentful-paint` 2.2–2.4 s desktop / 12.2–12.8 s mobile. LCP is the "Welcome to VarLens" paragraph, and its *element render delay* is 837 ms because the page renders client-side only behind a JS waterfall.
- `render-blocking-insight`: `fonts.googleapis.com/css2?family=Roboto+Mono` costs an estimated 280–730 ms, and the font is **never used** (finding F5).
- `unused-javascript` 873–879 KiB, `unused-css-rules` 10 KiB, `legacy-javascript` 56 KiB.
- `network-dependency-tree-insight`: HTML → `index.js` → dynamic `import(main)` → `vuetify`/`main.css` → more than 40 lazy chunks. No compression and `max-age=0` on hashed assets (finding F4).
- Mobile: FCP 5.0–6.7 s and SI 5.0–6.7 s under simulated slow 4G, because 1.9 MB is sent uncompressed.

**Performance (case and cohort timespans)**
- `interaction-to-next-paint` 247 ms desktop / **1,192 ms mobile** in case view. The worst interaction is the SNV/Indel tab mount: 154 ms processing + 91 ms presentation.
- `total-blocking-time` 331–626 ms desktop / 3.9–5.9 s mobile. Long tasks in `main-*.js` reach 186–195 ms.
- `cumulative-layout-shift` 0.193 in "open case". `div.case-content` shifts 0.186 because the sidebar auto-collapses and animates `v-main` (finding F3). Cohort scores 0.057 desktop / 0.144 mobile (finding F9).
- `forced-reflow-insight`, `bootup-time` 1.4 s (15.1 s mobile), `mainthread-work-breakdown` 3.3 s (23 s mobile).

**Accessibility (78–81 in app, 100 on login)**
- `aria-required-children` / `aria-required-parent`: `CaseList` renders `v-list role="list"` containing `v-list-item`s with `aria-selected` and `tabindex="-2"`.
- `button-name`:
  - The AppSidebar info button (`AppSidebar.vue:13`) and the "+" import menu button (`:24`).
  - `AppToolbar.vue:42` (case details).
  - The `VariantColumnHeader.vue` column-filter `v-btn`, about 20 per table.
  - The SlimFilterToolbar star and comment toggle icon buttons, and the preset-bar x-small button.
- `aria-allowed-attr` and `aria-command-name`: in `AnnotationsCell.vue`, a `<span>` menu activator carries `aria-haspopup/aria-owns`, and `<v-icon @click>` renders `<i role="button">` with no name. This repeats 75+ times per page.
- `color-contrast`: `text-grey` (#9E9E9E) on light surfaces in `EmptyState.vue`, `VariantIdentitySection` (HGVS prefix, "rsID:", "N/A"), the annotation-scores hint, and the CaseList subtitles.
- `target-size`: preset chips (`PresetBar.vue`, `x-small`) and toolbar icon buttons are under 24×24 px.
- `td-has-header`: the select and action columns have empty header titles.
- `aria-tooltip-name`: empty `v-tooltip` overlays are left in `.v-overlay-container`. I counted **243 overlay nodes** after one case view.
- `label-content-name-mismatch`: the `AppFooter` log-viewer button's badge text "1" is not part of its aria-label. The badge appears because of the console errors in finding F12.

**Best practices (95)**
- `errors-in-console`: `POST /api/protein/getMapping` returns **501** (web capability unsupported) and `POST /api/gnomad/getClinVarVariants` returns **404**. Both fire whenever the variant details panel opens (finding F12).

**SEO (login 50)**
- `is-crawlable` fails because `<meta name="robots" content="noindex, nofollow">` (`src/web/login/login.html:6`). This is intentional and should stay.
- `meta-description` is missing on the login page.
- `robots-txt`: `/robots.txt` is redirected by the page gate (302 → `/login?next=/robots.txt`), so Lighthouse parses HTML and reports 491 errors.
- With noindex kept, the best achievable SEO score on login is 92.

---

## 2. Core Web Vitals per route

Thresholds: LCP ≤ 2.5 s, CLS ≤ 0.1, INP ≤ 200 ms (TBT ≤ 200 ms is the lab proxy).
"LH" columns are Lighthouse lab results (desktop preset / mobile simulated throttling). "PW" columns are Playwright headless chromium, unthrottled, 1440×900 or 390×844, real 75 ms API latency.

| Route | LCP LH desk / mob | LCP PW | CLS LH desk / mob | CLS PW desk / mob | INP LH desk / mob | INP PW worst (1× / 4× CPU) | TBT LH desk / mob |
|---|---|---|---|---|---|---|---|
| Login | 0.24 s ✅ / 0.90 s ✅ | — | 0 ✅ / 0 ✅ | — | — | — | 0 / 0 ✅ |
| Home | 2.25 s ✅(edge) / **12.2 s ❌** | 0.41 s ✅ | **0.191 ❌** / **0.106 ❌** | **0.175 ❌** / 0.105 ❌ | — | — | 0–4 ms ✅ / 85–100 ms ✅ |
| Case view (soft nav) | n/a | first table paint about 0.35 s after tab click | **0.193 ❌** (open case) / **0.125 ❌** | 0.013 ✅ per interaction*; 0.13 hidden by input window | **247 ms ❌** / **1,192 ms ❌** | **248 ms** (tab) / **872 ms** | 331–626 ms ❌ / 3.9–5.9 s ❌ |
| Cohort view | n/a | — | 0.057 ✅ / **0.144 ❌** | 0.052 / **0.145 ❌** (`hadRecentInput`) | 124 ms ✅ / **357 ms ❌** | 128 ms / 384 ms | 337 ms ❌ / 4.0 s ❌ |

\* Per-interaction shifts on sort, page and filter are flagged `hadRecentInput` (within 500 ms of the click), so they are excluded from CLS, but they are visible to users. They add up to 0.01–0.11 per action (see §3).

---

## 3. Layout-shift and flicker forensics (Playwright, headless, 1440×900 and 390×844)

Per-interaction data. `skel` is the time skeleton rows replaced real rows. `settle` is the time to the last visual DOM change. CLS includes `hadRecentInput` shifts. Full tables are in `perf-evidence/snappiness-table.txt` and `forensics-*.txt`.

| Interaction (desktop, 75 ms) | INP (ms) | click→first change | click→data settled | skeleton shown | CLS (incl. input) | API req / KB | Mobile CLS |
|---|---:|---:|---:|---:|---:|---|---:|
| Initial load (home) | — | FCP 340 ms | LCP 408 ms | sidebar skeleton | **0.175** (no input) | 6 / 2 + 54 asset req / 1.9 MB | 0.105 |
| Open case (sidebar click) | 88 | 101 | 504 | 158 | **0.175** (sidebar animates `v-main`) | 5 / 89 | 0.118 |
| SNV/Indel tab (first mount) | **248** | 233 | 345 | 0 | 0 | 5 / 9 | 0 |
| Sort Gene asc | 72 | 95 | 268 | **173** | 0.016 | 3 / 46 | 0.022 |
| Sort Gene desc | 64 | 88 | 255 | **167** | 0.017 | 3 / 45 | 0.023 |
| Next page (prefetched) | **176** | 213 | 213 | 0 | 0.004 | 2 / 23 | 0.010 |
| Previous page (not cached) | 64 | 85 | 247 | **161** | 0.015 | 2 / 44 | 0.019 |
| Quick filter "Rare HIGH" on | 56 | 84 | **545** | **173** | **0.065** | 3 / 44 | **0.106** |
| Quick filter off | 40 | 58 | **548** | 185 | 0.033 | 2 / 44 | 0.058 |
| DSL search "TTN" + Enter | 56 | 70 | 987 (incl. typing) | 129 | 0.064 | 2 / 5 | 0.089 |
| Clear search | 56 | 58 | 360 | 164 | 0.033 | 2 / 44 | 0.045 |
| Open variant details | 72 | 95 | 121 | 0 (panel skeleton) | 0.001 | 5 / 1 (**2 errors**) | 0.008 |
| Expand Evidence editor | 24 | 51 | 199 | 0 | 0.014 | 0 | **0.060** |
| Switch to Cohort | 56 | 93 | 409 | **261** ("Loading items…") | **0.052** | 9 / 28 | **0.145** |
| Cohort sort | 80 | 234 | 234 | 0 | 0.002 | 3 / 19 | 0 |
| Cohort next page | 128 | 158 | 158 | 0 | 0.004 | 2 / 11 | 0 |
| Back to Case (keep-alive) | 24 | 79 | 79 | 0 | 0 | 0 | 0 |
| Reload (home) | — | FCP 116 ms | LCP 172 ms | sidebar skeleton | **0.175** | 54 conditional requests (all 304) | 0.105 |

### Flicker catalogue (what the filmstrips show)

1. **Table → skeleton → table on every sort, previous page, filter, search and clear** (`perf-evidence/filmstrip-sort-skeleton-swap.png`). All 25 data rows are replaced by `v-skeleton-loader type="table-row@10"` for 130–190 ms unthrottled and **570–660 ms at 4× CPU**, then the rows return.
   - While the skeleton (a single `colspan` cell) is shown, `table-layout:auto` recomputes column widths. Headers jump horizontally (for example the "Ref" column 54 → 182 px and "Consequence" `th` x 722 → 1042), then jump back. These are the repeated 0.009–0.015 shifts whose sources are `thead th.v-data-table__th--sortable`.
   - The frames show `.v-data-table-rows-loading` present for 4–8 frames per action.
   - Root cause: `src/renderer/src/components/VariantTable.vue:224-226`. Providing the `#loading` slot makes Vuetify's `VDataTableRows` replace rows even when items exist. The code comment on line 223 says this is "to prevent layout shift", but it causes it.
2. **Home: "Import Variants" CTA → "Select a case" swap** (`perf-evidence/filmstrip-dark-os-login-to-app.png`, frames 6–12).
   - `EmptyState` renders the no-cases branch (Import button, `.json` hint, drag-drop line) until `cases/query` returns. The centred `v-row` then shrinks from 566 to 460 px and moves down 53 px.
   - CLS 0.166–0.180. It is latency-dependent: 0.027 at 0 ms API latency and 0.191 at 75 ms.
   - Users who have cases briefly see an import call-to-action meant for empty workspaces.
3. **Open case: sidebar slide-out reflows the whole case view** (`perf-evidence/filmstrip-open-case.png`). `handleCaseSelected` → `closeSidebar()` (`src/renderer/src/App.vue:228-235`) animates the non-temporary drawer, so `v-main` padding animates and `div.case-content` moves x 275 → 256 → 214 → 11 over 4 frames.
   - Lighthouse counts it: 0.186 in the open-case timespan.
   - At the same time the main area goes from an empty frame, to the `ShortlistPanel` skeleton, to "Preset" select resizing (217 → 93 px, mobile), to data. On mobile `shortlist-panel__body` also shifts 32 px (0.113).
4. **Applied-filters bar slides in and pushes the table** (`perf-evidence/filmstrip-quick-filter.png`). `SlimFilterToolbar.vue:125-151` uses `<v-expand-transition>` on `.applied-filters-bar`. The `.table-container` drops 14 px over 6 animation frames (table heights 600/586/585/580/577/574), and the count chip and "Clear" button shift left.
   - The `expand-x-transition` on the DSL field's clearable icon adds another small shift.
   - `PresetBar.vue:2` also wraps the bar in `v-expand-transition`.
5. **Cohort: header then deferred filter bar** (`perf-evidence/filmstrip-to-cohort.png`).
   - The Genome Build select first renders **"undefined (undefined cases)"**. In `CohortView.vue:7`, `item-title` is called with the raw `'GRCh38'` string before `availableBuilds` loads.
   - Next comes "Loading items…" for 260 ms.
   - Then `CohortFilterBar` (`v-if="firstActivated"`, `CohortTable.vue:64-66`) appears and pushes the table 76 px on desktop and **142 px on mobile** (CLS 0.139). The data-table footer pops in, and the columns re-layout.
6. **Login (dark OS) → app: dark → white → light flash** (`perf-evidence/filmstrip-dark-os-login-to-app.png`).
   - `login.html` honours `prefers-color-scheme: dark` (body `#12141A`).
   - `src/web/index.html` has no `color-scheme` meta or background, so 2 frames are blank white. The SPA then mounts in `warmLight`, because the SPA has **no dark mode or theme toggle** even though `warmDark` exists in `plugins/vuetify.ts:61`.
   - No theme toggle exists, so I could not run the "toggle dark theme" and "reload with saved dark theme" tests. The observed behaviour is a light-only SPA after a dark login page.
7. **Sidebar case list skeleton → 3 items.** The skeleton height does not match the content, so "All cases loaded" jumps from y 761 to 249 (0.010).
8. **Details panel.** It shows a `v-skeleton-loader` for about 100 ms, then the sections. Expanding the Evidence editor collapses and re-lays-out the Tags, Comments and Activity sections (13 shifts, 0.06 mobile).
9. **No FOIT.** Icons are inline SVG (`vuetify/iconsets/mdi-svg`), so there is no icon-font flash. The body font "Roboto" is declared but never loaded, so text uses the system font with no swap.

### Long tasks and INP root causes

At 1× CPU the worst interactions are:
- SNV/Indel first mount: INP 248 ms, 233 ms presentation delay, long task 189 ms.
- Next page: INP 176 ms, 174 ms presentation. The prefetched page renders inside the click frame.
- Cohort next page: 128 ms.

At 4× CPU (a typical clinical laptop, or Lighthouse mobile):
- SNV tab **872–928 ms**
- Next page **664–696 ms**
- Open details 304–432 ms
- Open case 392 ms

The cost is render, not data:
- The case table has **2,476 DOM nodes for 25 rows** and 4,687 nodes in the document.
- Each row has an `AnnotationsCell` with 3 `v-tooltip` plus `v-menu` activators (`AnnotationsCell.vue`).
- Each header has a `v-menu` + `v-tooltip` filter button (`VariantColumnHeader.vue:21-33`).
- The off-canvas FilterDrawer and ColumnsDrawer are fully rendered at x > 1430 with more than 40 inputs.
- The overlay container accumulates 243 nodes.

---

## 4. Snappiness: what the 75 ms latency costs vs the client CPU

| Interaction | settle @75 ms | settle @0 ms | Δ latency | settle @75 ms + 4× CPU | Bound by |
|---|---:|---:|---:|---:|---|
| Open case | 504 | 396 | 108 | 1,550 | CPU (render) + 1 RTT |
| SNV tab | 345 | 338 | 7 | 1,079 | **CPU** |
| Sort | 268 | 223 | 45 | 849 | CPU + skeleton swap |
| Next page (prefetched) | 213 | 206 | 7 | 719 | **CPU** |
| Previous page | 247 | 235 | 12 | 875 | CPU + skeleton |
| Quick filter | 545 | 514 | 31 | 1,081 | **300 ms debounce** + CPU |
| Clear search | 360 | 360 | 0 | 999 | CPU |
| Open details | 121 | 142 | ≈0 | 545 | CPU |
| To Cohort | 409 | 332 | 77 | 1,258 | CPU + 1 RTT |
| Cohort next page | 158 | 153 | 5 | 443 | **CPU** |

**Conclusion.** The injected 75 ms latency adds at most one round trip (0–110 ms). Requests within an interaction run in parallel, with no waterfalls beyond 1 level. **Client render cost and the 300 ms filter debounce dominate.** At 4× CPU every table interaction takes 0.7–1.6 s.

Network per interaction:
- **Sort, filter and page each send 2 `variants/query` calls** (about 22 KB each, uncompressed JSON). This is not a bug: the second is the next-page prefetch (`useOffsetPagination.ts:95-125`). However, the prefetch only goes forward, so "Previous page" refetches and shows the skeleton.
- `annotations/batchGet` follows every page change (about 1.2 KB).
- `presets/list` is fetched 3× in one session (open case, SNV tab, cohort). This is duplicate over-fetching, about 4 KB each.
- Opening the details panel sends 5 calls, 2 of which fail (501/404).
- Switching to Cohort sends 9 calls, including 2× `cohort/getVariants` (page + prefetch).
- API JSON is sent **uncompressed**: `content-encoding` is empty, at about 900 B per row.

---

## 5. Bundle and asset analysis (`out/web/public`)

| Chunk | Raw | gzip -9 | brotli | Loaded on first visit to `/`? |
|---|---:|---:|---:|---|
| `index-*.js` (bootstrap) | 8 KB | 3.1 KB | 2.8 KB | yes (HTML) |
| `main-*.js` (Vuetify components 224 K, app components 103 K, @mdi/js 52 K) | 470 KB | 158 KB | 130 KB | yes (dynamic import) |
| `main-*.css` | 362 KB | 50 KB | 29 KB | yes |
| `vuetify-*.js` (actually the Vue runtime + some Vuetify) | 189 KB | 73 KB | 65 KB | yes |
| `AnnotationDialogs…-*.js` (**@vue/compiler-core 71 K + compiler-dom 9 K**, vuedraggable 50 K, sortablejs 44 K) | 290 KB | 94 KB | 82 KB | **yes**, a static import from CaseView/VariantTable/CohortTable |
| `ProteinVisualizationModal-*.js` (d3) | 141 KB | 43 KB | — | **yes**, mounted unconditionally inside VariantDetailsPanel |
| `AppDialogHost-*.js` | 98 KB | 29 KB | 25 KB | yes |
| `CaseView-*.js` / `CohortView-*.js` | 80 / 81 KB | 23 / 24 KB | 20 / 21 KB | yes (`/` redirects to `/case`; cohort prefetched on idle) |
| `viewer-*.js` (Mol*, h264 encoder) | 5.2 MB | 1.48 MB | 1.16 MB | no (lazy) ✅ |
| `plotly-basic.min-*.js` | 1.2 MB | 400 KB | 330 KB | no (lazy) ✅ |

- **First visit: 54 requests and 1.95 MB transferred uncompressed.** That is 1.51 MB of JS, of which only **34 % is used** (V8 coverage), and 434 KB of CSS (68 % used). After opening a case only 20 % of the loaded JS has executed. The biggest unused items are AnnotationDialogs (212 K), main (207 K), ProteinVisualizationModal (120 K), vuetify (83 K), AppDialogHost (80 K), CohortView (72 K) and CaseView (65 K).
- **A duplicate Vue with a compiler is bundled.** `vuedraggable@4.1.0` ships only a UMD build (`require("vue")`). Rollup's CJS interop resolves that to `node_modules/vue/index.js` → `vue/dist/vue.cjs.prod.js`, which pulls `@vue/compiler-dom` and `@vue/compiler-core` (about 80 KB minified) into the AnnotationDialogs chunk.
- **No compression** for HTML, JS, CSS or JSON. There is no `@fastify/compress` and no `preCompressed`. Cache headers are `Cache-Control: public, max-age=0` with weak ETags, even for content-hashed `/assets/*`, so every reload sends 54 conditional requests (all 304). The server speaks **HTTP/1.1** only (6-connection limit for 54 requests). `/data/hpo-terms.json` is 1.5 MB and uncompressed (lazy).
- **Fonts:** `index.html` loads `fonts.googleapis.com` Roboto Mono as a **render-blocking stylesheet** that **no CSS rule references**. `--font-mono` is `ui-monospace, SFMono-Regular, …`, and `VariantTable.vue` uses `'Courier New'`. The page also depends on a third-party origin in a clinical, offline-capable product. There are no `woff2` files in the bundle and no MDI font (SVG icons ✅).
- **Preload hints:** only `<link rel="modulepreload" errors-*.js>`. `main-*.js`, `vuetify-*.js` and `main-*.css` are discovered only after `index-*.js` runs `await import('../renderer/src/main')` (`src/web/bootstrap.ts`), which adds a full RTT to the critical path. CSS is injected by JS, so it does not block rendering, but there is also no pre-paint background.
- **Waste in the public dir:** `publicDir: src/renderer/src/assets` (`vite.web-renderer.config.ts:66`) also publishes `styles/main.scss`, `styles/table-cells.scss` and `custom.css` raw. `DnaIcon.vue` is 43 KB of inline SVG inside `main-*.js`. `favicon.svg` is 40 KB. Sourcemaps are public (fine for OSS).

---

## 6. Root causes in code, with proposed fixes

| # | Problem | File / line | Fix |
|---|---|---|---|
| F1 | Rows swap to a skeleton on every load, and the columns jump | `src/renderer/src/components/VariantTable.vue:224-226` (`<template #loading>`) | Show the skeleton only when there are no rows yet. Vuetify renders the loading slot whenever the slot exists and `loading` is true, so the slot must be conditional: wrap it as `<template v-if="renderRows.length === 0" #loading>`. For refetches, keep the stale rows and mark them as loading (CSS below). Also set `table-layout: fixed` plus explicit `width`/`minWidth` per header in `variant-table/columns.ts` so the columns never re-flow. Do the same for `CohortDataTable` (cohort parity rule). |
| F2 | EmptyState shows the import CTA while cases are still loading | `src/renderer/src/views/CaseView.vue:41,357-362`; `components/EmptyState.vue:15-36` | Add a `casesLoaded` flag (App.vue already has `handleCasesLoaded`). Pass `:loading="!casesLoaded"` and render a neutral line inside a fixed-height slot (`<div class="empty-state-cta" style="min-height: 140px">`) so neither branch changes the height of the centred block. |
| F3 | Sidebar collapse animates `v-main` after a case is selected | `src/renderer/src/App.vue:20,228-235` | On the `full`/`compact` tiers, do not auto-close. Or close it without animation (`.v-main { transition: none }` while closing), or use `temporary` overlay mode so `v-main` never reflows. On the narrow tier it is already an overlay. |
| F4 | No compression, no immutable caching | `src/web/server/static.ts:46-59` (+ `src/web/server.ts` plugin registration) | Register `@fastify/compress` (`encodings: ['br','gzip']`, `threshold: 1024`, also covers `/api` JSON). Or pre-compress at build time (`.br`/`.gz`) and use `@fastify/static` `preCompressed: true`. In `setHeaders`: for `/assets/` send `Cache-Control: public, max-age=31536000, immutable`, and for `index.html` send `no-cache`. |
| F5 | Unused render-blocking Google Font | `src/web/index.html:10-15` (and `src/renderer/index.html:16`) | Delete the `preconnect` and `stylesheet` links. Drop `fonts.googleapis.com`/`fonts.gstatic.com` from the CSP in `static.ts:22` and `index.html`. If Roboto Mono is wanted, self-host one `woff2` with `font-display: swap` and `size-adjust`, and add it to `--font-mono`. |
| F6 | Bootstrap waterfall | `src/web/bootstrap.ts` | Replace the top-level `await import(...)` with static imports in the correct order (an `install-api` module first, then `main`). ESM evaluation order guarantees `window.api` exists first, and Vite then emits `modulepreload` for `main` and `vuetify` plus a `<link rel=stylesheet>` for `main.css` in the HTML. |
| F7 | Heavy chunks loaded at startup | `components/VariantDetailsPanel.vue:184-189`; `App.vue:51,114-117`; `components/ColumnsDrawer.vue:103`, `ColumnVisibilityMenu.vue:51` | `<ProteinVisualizationModal v-if="proteinModalOpen" …>`. Mount `VariantDetailsPanel` only after the first open (`v-if="panelEverOpened"`). Load the drawers with `defineAsyncComponent` on first open. Remove the duplicate Vue: add `resolve.alias: [{ find: /^vue$/, replacement: 'vue/dist/vue.runtime.esm-bundler.js' }]` in `vite.web-renderer.config.ts` and `electron.vite.config.ts`, or replace `vuedraggable` with `vue-draggable-plus` (ESM). |
| F8 | 300 ms debounce on discrete filter clicks | `composables/useFilterState.ts:98,109-115`; `shared/config/app.config.ts:8` | Call `emitFilters()` directly from preset, chip and checkbox handlers (`useFilterPresets(filters, () => emitFilters())`). Keep the debounce only for typed input. |
| F9 | Filter bars appear late and push the table | `components/SlimFilterToolbar.vue:125-151`, `PresetBar.vue:2`, `CohortTable.vue:64-66`, `CaseView.vue:411` | Remove `v-expand-transition`. Reserve the row with a `min-height`, or render the applied-filter chips inline in the existing toolbar row. For deferred bars, render a placeholder of the same height (`v-else`) instead of nothing. |
| F10 | Cohort build label shows "undefined (undefined cases)" | `components/CohortView.vue:7` | `:item-title="(b) => typeof b === 'string' ? b : \`${b.build} (${b.caseCount} cases)\`"`, or render the select only once `availableBuilds.length > 0`. |
| F11 | Row and header render cost (INP) | `components/table-cells/AnnotationsCell.vue`, `variant-table/VariantColumnHeader.vue:21-33`, `FilterDrawer.vue`/`ColumnsDrawer.vue` | Replace the per-cell `v-tooltip` with plain `<button :aria-label :title>` or a single shared delegated tooltip. Create the `v-menu` on demand (one menu instance with a dynamic `activator`). Lazy-mount the drawer contents (`v-if="open"` after the first open). Consider `v-data-table-virtual` or fewer default columns at the compact tier. Schedule prefetched-page rendering after the next paint (`requestAnimationFrame` then `setTimeout 0`) so the click frame paints the pagination state first. |
| F12 | Console errors in web mode (BP 95) | `composables/useProteinData.ts:52`, `components/protein/ProteinVisualizationModal.vue:227` | Gate on backend capabilities (`getCurrentUnsupportedReason('protein.getMapping')`) before calling. Add `gnomad:getClinVarVariants` to the web capability map, or skip it in web mode. |
| F13 | Theme flash and no dark mode | `src/web/index.html`, `plugins/vuetify.ts:86-91` | Add `<meta name="color-scheme" content="light dark">` and inline critical CSS `html,body{background:#F0F2F5}` with an `@media (prefers-color-scheme: dark)` variant matching `warmDark`. Set Vuetify `defaultTheme: 'system'` (Vuetify ≥3.7) so login and app agree. |
| F14 | A11y blockers | `CaseList.vue` (list roles), `AppSidebar.vue:13,24`, `AppToolbar.vue:42`, `VariantColumnHeader.vue:22`, `AnnotationsCell.vue:6-17,33-40`, `EmptyState.vue`, `VariantIdentitySection.vue`, `PresetBar.vue`, `AppFooter.vue` | Add `aria-label`s. Use `role="listbox"`+`option` or drop `aria-selected`. Use `<v-btn icon>` instead of a clickable `<v-icon>`. Replace `text-grey` with `text-medium-emphasis`. Give chips a 24 px minimum. Add visually-hidden header titles. Include the badge count in the aria-label. |
| F15 | SEO on the login page | `src/web/login/login.html`, `src/web/server/page-gate.ts`/`probe-paths.ts` | Add `<meta name="description">`. Serve a public `/robots.txt` (`User-agent: *\nDisallow: /`) before the gate. Keep `noindex`, which caps the score at 92. |

**CSS for the F1 "stale rows while loading" pattern:**

```css
.variant-table--sticky.v-data-table--loading tbody { opacity: .55; transition: opacity 120ms ease 150ms; }
```

The 150 ms delay keeps fast responses from dimming at all. Vuetify's built-in `v-data-table-progress` linear bar in the `thead` still signals the activity.

---

## 7. Score: Snappiness and Stability **4.5 / 10**

**Why it is not lower:**
- The API is fast: 75–125 ms with the injected 75 ms, and requests run in parallel.
- The login page is a perfect 100/100/100.
- Keep-alive tab switching and Cohort ↔ Case navigation are instant (79 ms).
- Next-page prefetch makes forward paging data-instant.
- Heavy viewers (Mol* 5.2 MB, Plotly 1.2 MB) are correctly lazy.
- Icons are SVG, so there is no font flash.

**Why it is not higher:**
- **Every core table action visibly flickers.** Rows become a skeleton and columns jump, for 130–190 ms unthrottled and about 600 ms on a 4×-slower CPU.
- **Two first-impression CLS failures:** home at 0.19, and open-case at 0.19 in Lighthouse.
- Quick filters wait an unnecessary 300 ms.
- INP is 248 ms on desktop and **1.2 s on mobile**.
- 66 % of the 1.5 MB of startup JS is unused.
- Nothing is compressed or cached immutably.
- A render-blocking third-party font is loaded and never used.
- Dark-OS users get a dark → white → light flash on login.

---

## 8. Path to 100/100/100/100 and zero layout shift (prioritised)

| Pri | Change (file → concrete edit) | Expected impact | Effort |
|---|---|---|---|
| **P0** | **F1** `VariantTable.vue:224-226`: make the `#loading` slot conditional on `renderRows.length === 0`. Dim stale rows with the CSS above. Fixed `table-layout` plus header widths in `variant-table/columns.ts`. Same for `CohortDataTable` (parity). | Removes the table→skeleton→table flicker and the header jumps on sort, page, filter and search. Per-action layout shifts drop from 0.01–0.02 to 0. Perceived latency −130 to −600 ms. | S (slot) / M (fixed widths) |
| **P0** | **F2** `CaseView.vue` + `EmptyState.vue`: add a `casesLoaded` flag and a fixed-height CTA slot. | Home CLS 0.19 → ≈0. Desktop perf +12–15 points (75 → ~88). No wrong "Import" CTA for users who have cases. | S |
| **P0** | **F3** `App.vue:228-235`: no auto-collapse on the full/compact tiers, or collapse without transition. | Open-case CLS 0.19 → ≈0. Removes 4 frames of full-table reflow. | S |
| **P0** | **F4** `static.ts`: brotli/gzip (assets + API) and `immutable` caching for `/assets/*`. | First load 1.95 MB → ~0.45 MB. Mobile FCP 6.7 s → ~2.5 s, LCP 12 s → ~4–5 s, mobile perf 56 → ~75. Reloads send 0 revalidation requests instead of 54. | S |
| **P0** | **F5** `src/web/index.html` (+ `src/renderer/index.html`): delete the Google Fonts links and the CSP origins. | −280 to −730 ms render-blocking. FCP improves on every load. Removes a third-party dependency. | S |
| **P1** | **F7**: `v-if` on ProteinVisualizationModal, mount VariantDetailsPanel on first open, lazy ColumnsDrawer/ColumnVisibilityMenu, alias `vue` → runtime ESM build (drops the 80 KB compiler). | Startup JS −~550 KB raw (−35 %). `unused-javascript` audit 879 KiB → ~300 KiB. Mobile TBT/LCP improve. | M |
| **P1** | **F8** `useFilterState.ts`: emit preset and chip filters immediately. | Quick filter settle 545 → ~245 ms. | S |
| **P1** | **F9** `SlimFilterToolbar.vue`, `PresetBar.vue`, `CohortTable.vue:64`, `CaseView.vue:411`: no expand transitions; reserved heights or placeholders. | Filter and search CLS 0.03–0.11 → 0. Cohort entry CLS 0.14 (mobile) / 0.05 → 0. | S |
| **P1** | **F11**: replace per-cell tooltips and menus with plain buttons and one shared tooltip/menu; lazy drawer contents; defer prefetched-page render past the click paint. | Table DOM 2.5 k → ~1.2 k nodes. INP 248 → <150 ms desktop, 1.2 s → ~400 ms mobile. TBT halves. Also fixes the `aria-command-name`, `aria-allowed-attr` and `aria-tooltip-name` audits. | M–L |
| **P1** | **F14** a11y list: labels, roles, contrast, target size, header titles, footer badge label. | A11y 77–81 → 100 on every app snapshot. | M |
| **P1** | **F12**: capability-gate `protein.getMapping` and `gnomad.getClinVarVariants` in web mode. | Best practices 95 → 100. Removes 2 failed requests per details open. | S |
| **P2** | **F6** `src/web/bootstrap.ts`: static import order, so `modulepreload` for main and vuetify and the CSS link are in the HTML. | −1 RTT on the critical path (~100–300 ms LCP on mobile). | S |
| **P2** | **F13**: inline background plus `color-scheme` in `index.html`; Vuetify `defaultTheme: 'system'` with `warmDark`. | Removes the dark → white → light flash. Login and app themes agree. | S (flash) / M (dark mode QA) |
| **P2** | **F10** `CohortView.vue:7`: guard `item-title`. | Removes the "undefined (undefined cases)" flash. | S |
| **P2** | Back-page caching in `useOffsetPagination.ts`: keep the previous page in `prefetchCache`, and do not clear on a pure page move. Dedupe `presets/list` (fetched 3×) via the Pinia store cache. | Previous page instant. −2 requests per session. | S |
| **P2** | **F15**: login `meta description` + public `/robots.txt`. | Login SEO 50 → 92. 100 is impossible while `noindex` stays, which is intended. | S |
| **P3** | HTTP/2 at the reverse proxy (or Fastify `http2: true` behind TLS). Optimise the `DnaIcon.vue` (43 KB) and `favicon.svg` (40 KB) SVGs. Stop publishing raw `styles/*.scss` (`publicDir`). Decide the body font: self-host Roboto `woff2` or declare a system stack. | Fewer bytes and connections; tidier output. | S |
| **P3** | Make the skeletons match the content: CaseList skeleton row count/height, and the details-panel skeleton to section heights. Remove the layout reflow on Evidence-editor expand. | Removes the remaining ≤0.06 shifts. | S |

**Projected end state after P0+P1:**
- Desktop: home perf ~95, case/cohort timespans ≥90.
- Mobile: home perf ~80–85. The remainder is the Vuetify + Vue baseline under slow 4G.
- A11y 100, best practices 100, SEO 100 (app) / 92 (login, noindex by design).
- CLS ≈0 on every route and interaction.
- INP < 200 ms desktop; mobile depends on F11 depth.
