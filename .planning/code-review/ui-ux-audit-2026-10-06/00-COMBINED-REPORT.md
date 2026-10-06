# VarLens Web — Combined UI/UX, Performance, Stability & Non-Blocking Audit

**Date:** 2026-10-06 · **Build:** v0.72.0 (`05bc72f6`), web mode, Postgres, `make web-dev` (75 ms injected API latency)
**Data:** 3 cases, ~19.6k variants · **Method:** dual-agent impeccable critique (A: design review, B: detector + axe) plus 5 specialist passes (standards research, Lighthouse/CWV, blocking analysis, resolution scaling, table-loading forensics) and a direct icon probe.
**Note:** Claude-in-Chrome was not connected for the design reviewer (2 failed attempts). All browser work ran in Playwright (MCP + headless scripts). Screen-reader findings come from DOM/ARIA inspection, not from NVDA/VoiceOver.

Detail reports (this folder): `01` standards rubric · `02` design review · `03` detector + axe · `04` Lighthouse/CLS · `05` blocking · `06` scaling · `07` table loading · `08` icons.

---

## 1. Scorecard

| Dimension | Score | Band | Source |
|---|---|---|---|
| Nielsen heuristics | **20 / 40** | Acceptable (bottom) | 02 |
| Impeccable technical audit | **13 / 20** | Acceptable | 03 |
| Lighthouse desktop (Perf / A11y / BP / SEO) | **55–75 / 77–81 / 95–100 / 100** | — | 04 |
| Lighthouse mobile (Perf / A11y / BP / SEO) | **36–59 / 81–96 / 100 / 100** | — | 04 |
| Lighthouse login page | 100 / 100 / 100 / 50 (SEO capped by intentional `noindex`) | — | 04 |
| Core Web Vitals | **Fail:** CLS 0.19 (home, open case), INP 247 ms desktop / 1.19 s mobile (case), LCP 12.2 s mobile (home) | Poor | 04 |
| Snappiness & stability | **4.5 / 10** | — | 04 |
| Table loading smoothness | **4.5 / 10** (spec target ≈ 9) | — | 07 |
| Non-blocking (renderer 7 · web server 6 · Electron main 4 · DB 4 · import/export 6) | **5 / 10** | — | 05 |
| Resolution & density scaling | **5.0 / 10** | — | 06 |
| WCAG 2.2 AA (axe, all signed-in views) | **Fails** (Level A 4.1.2/1.3.1 + AA 1.4.3/2.5.8) | — | 03 |
| Data correctness in UI | **3 P0 defects** | Blocking | 02, verified |

**Composite (equal-weight over the 8 normalised dimensions): ≈ 46 / 100.** The architecture is solid: server pagination, workers, CSP, fast API (healthz p95 0.6 ms), and markRaw rows. The low scores come from how the client renders state changes, from accessibility semantics, and from incomplete web-mode features.

Previous claims ("0 impeccable warnings, 100 Lighthouse best practices", commit `019d63ff`) hold only for the static source scan and the login page. Signed-in views fail axe, and Best Practices drops to 95 when a variant detail panel is opened.

### Nielsen heuristics (A)
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of status | 2 | Skeleton swap on every refetch; HPO 501 shown as "No matching terms" |
| 2 | Match real world | 2 | "Scored (capped): 200 → top 50", raw SO terms, "Consequence" column shows IMPACT |
| 3 | User control | 2 | ACMG saves in one click with no undo; Esc doesn't close the Columns drawer; reload loses case and filters |
| 4 | Consistency | 1 | Case and cohort tables load, search and format differently; 6 icon sizes |
| 5 | Error prevention | 1 | Export is offered and then fails on Postgres; stale results can render |
| 6 | Recognition vs recall | 3 | Shortlist and presets are visible; DSL syntax errors are silent |
| 7 | Flexibility | 3 | Good shortcuts and DSL; no bulk actions |
| 8 | Minimalist | 2 | 18 equal-weight quick-filter targets; 245–335 px of chrome above the first row |
| 9 | Error recovery | 1 | Silent 404/501, "0-NaN of NaN" footer, skeleton stuck forever |
| 10 | Help | 3 | FAQ and shortcuts dialog exist |

### Per-view scores (0–10, A; flicker and speed from 04/07)
Login 7 · Disclaimer 6 · Shell/header 4.5 · Home/case list 6 · Shortlist 6.5 · **Case table 3.5** · Search/DSL 5 · Filter drawer 6.5 · Quick chips 5 · Columns drawer 6 · **Export 2** · Details panel 5 · ACMG 6.5 · **Cohort 3.5** · Gene burden 6.5 · **HPO 2.5** · Case metadata 4.5 · Import 6 · Settings 4.5 · **Theme 2** · **Admin 1** · **Logout 1** · About/FAQ 5.5 · Keyboard 5 · Responsive 6 · **URL/session state 3**.

---

## 2. P0: defects that show clinicians wrong or missing data

| # | Defect | Root cause | Fix |
|---|---|---|---|
| P0-1 | **Wrong variant shown in a row.** Two records with the same chr:pos:ref:alt both display the second one. The FKBP14 Pathogenic HIGH frameshift renders as "FKBP14-AS1 / intron / LOW". *Verified in code.* | `components/variant-table/useVariantRenderRows.ts:19-47` keys the render cache and `rowViewModels` by locus, then `Object.assign`s onto the shared cached object | Key by `variant.id` everywhere (cache, view-model map, `item-value`); add a unit test with two same-locus variants |
| P0-2 | **Stale results render permanently.** Out-of-order responses win, e.g. FLNB in the search box while 184 HIGH variants show; last-page rows under a "1-25" footer | `composables/useOffsetPagination.ts:145-204` has no latest-request guard or abort | Copy the request-id guard from `useShortlistQuery.ts:83-110`; add `AbortController` in web mode |
| P0-3 | **Case table stuck on a skeleton** after case A → Cohort → pick case B → SNV/Indel. No query is sent, the count is from case A, and a cohort filter chip leaks in | Cross-view state is not reset on case switch (see 02 §repro) | Reset per-case table state on `selectedCaseId` change; regression E2E |
| P0-4 | **Cohort search does nothing.** A chip appears but no request is sent (parity bug) | `CohortFilterBar.vue:465-470` doesn't watch `searchTerm` | Watch it and route through the shared filter state |
| P0-5 | **Footer reads "0-NaN of NaN"** on Clear | `useOffsetPagination.ts:176,187-190` reads `cachedTotalCount!` after a concurrent reset | Keep the last known total and never render null |
| P1 | **Default case sort ignores chromosome** (MT, 17, 11, 16…), while cohort sorts chr+pos | `PostgresVariantReadRepository.ts` falls back to `v.pos ASC` | `ORDER BY chr_rank, pos` plus a `(case_id, chr_rank, pos)` index (05) |

---

## 3. Flicker, layout shift and snappiness

**What the user sees:** on every sort, page change, filter or search, the case table's rows are replaced by a skeleton for 130–200 ms (600 ms at 4× CPU, 1.2 s on a slow network), then columns jump 80–134 px sideways when data arrives. The applied-filter bar slides in and pushes the table 34 px down. Clear sends 2–5 requests and shows two skeleton cycles. Home loads with "Import Variants" before swapping to "Select a case" (CLS 0.18). Opening a case animates the sidebar shut and reflows the whole view (CLS 0.19).

| Root cause | Location | Fix |
|---|---|---|
| `#loading` slot makes Vuetify replace rows on every load | `VariantTable.vue:223-226` (Vuetify `VDataTableRows.js:76`) | Remove the slot; keep stale rows, dim to 0.6 after 150 ms; thin top bar delayed 150 ms, minimum 300 ms visible; skeleton only on first load, with real row height |
| Auto table layout, no column widths | `data-table-shared.css:119-125` | `table-layout: fixed` + per-column widths in `variant-table/columns.ts` (and cohort) |
| Header not sticky | VariantTable / CohortTable | `fixed-header` + flex height |
| Filter bar inserted with height animation | `SlimFilterToolbar.vue:124-151` | Reserve the row (min-height); no expand transition |
| Clear assigns new `{}` → double reload | `useColumnFilters.ts:34-36`, `useVariantData.ts:181-185`, `CohortTable.vue:514-524` | Single "apply" path; no-op if unchanged |
| Chip clicks wait 300 ms (typing debounce) | `useFilterState.ts:109-115` | Discrete clicks apply immediately; typing 250 ms |
| Prev page always refetches; cache entries deleted on read | `useOffsetPagination.ts:155` | Small LRU page cache + idle prefetch prev/next |
| Home empty-state decided before cases load | `EmptyState.vue` / `App.vue` | Render nothing (fixed-height block) until the case list resolves |
| Sidebar auto-collapses on case open | `App.vue:234` | Don't collapse on desktop (or no transition) |
| Shortlist remounts and skeletons each visit | `CaseView.vue:454-455` (`v-if`), `ShortlistPanel.vue:117-149` | `v-show`/`KeepAlive`, keep rows on refresh |
| Per-cell tooltips and menus (243+ tooltip nodes) cost 81–86 ms per page render, 137–176 ms on tab switch | AnnotationsCell and table cells | One delegated tooltip and menu; `v-memo` rows → INP < 200 ms |
| Dark-OS flash (dark login → white → light app) | login.html vs app theme | Pre-mount background + `color-scheme`; honour system theme |

**Network and assets (04):**
- No brotli/gzip on API or assets, and hashed assets are served with `max-age=0`: 54 requests and 1.95 MB per load.
- An unused Google Fonts stylesheet blocks render for 280–730 ms.
- Only 34% of the 1.5 MB startup JS executes. The protein modal (137 KB) is mounted unconditionally, `vuedraggable` pulls the full Vue compiler build, and the details panel and both views load on Home.

---

## 4. Blocking (05)

The web server's event loop is healthy under load (p95 0.6 ms). The weak points are the 4-connection pool, whole-table rebuilds and the Electron main thread.

- **P0 desktop freezes:**
  - Writes during import wait synchronously up to 5 s (`DatabaseService.ts:93`, busy_timeout).
  - Frequency upkeep, multi-file append, cohort export (100k rows + XLSX, no cancel), re-encryption and migrations all run on the main thread.
  - The window is created only after the DB opens (`index.ts:209,269`).
- **P0 web, all users:** case delete runs `TRUNCATE variant_frequency` + full rebuild in-request (`PostgresCaseLifecycleRepository.ts:143`). Cohort reads can rebuild the summary in-request. ZIP extraction is synchronous up to 256 MB / 512 MB (`ZipExtractor.ts:52,119`).
- **P1:**
  - Pool size 4, plus 3 sequential DB calls per request (`config.ts:31`, `auth.ts:319`, `dispatcher.ts:359-387`).
  - No `(case_id,pos)` index; `COUNT(*)` on every filter change; `OFFSET` paging.
  - Undebounced gene autocomplete; one Gene Burden call per case.
  - 1,000-row and 10,000-row JSON pages serialised synchronously and uncompressed.

---

## 5. Accessibility (03 + 02)

- **Level A failures:**
  - Unnamed icon buttons and row action icons: 50–75 per page, 120 of 138 icon buttons unnamed.
  - `aria-*` on disallowed roles (`AnnotationsCell.vue:47,95`, `DslSearchBar.vue:3`).
  - Option items inside a plain list (`CaseList.vue:69-98`).
  - 243 empty tooltip nodes.
- **AA failures:**
  - Grey text at 2.4–3.5:1 (`EmptyPlaceholder.vue`, `ClinVarCell.vue`, `VariantTable.vue:220`, case-list subtitles).
  - Targets under 24 px: 53 in cohort view; 20 px filter toggles; 17.5 px row icons.
- **Structure:**
  - No `h1`/headings and no skip link in case, details or cohort views; every route is titled "VarLens".
  - Row selection is not announced; focus doesn't move into the details panel (~150 tab stops away) and isn't restored after Clear.
  - No `aria-busy` or live region for result counts; reduced motion is honoured in one file only.
- **Dark theme:** defined but unreachable. When forced it breaks: the footer `#dfe4ea` makes its content invisible and the mode toggle measures 1.9:1.

## 6. Icons (08)

All SVG paths are valid; the visible problems come from sizing, clipping and meaning.

- **Clipped icons:**
  - The case-details ⓘ is a 20 px icon inside a **12×12 px** button with `overflow:hidden`, so only a bare "i" shows. The sidebar toggle and gear are also clipped.
  - Cause: `size="x-small"` icon buttons + global `VBtn density: 'compact'` (`plugins/vuetify.ts:101`). The same default collapses 252 buttons to 8–16 px ("Fetch VEP" is 8 px tall, label cut).
- **"? ?" status icons:** unknown sex and unknown affected status both render `mdiHelpCircleOutline` in the header and on every case (`useCaseMetadata.ts:514,528`). They read as help buttons.
- **Inconsistent sizing:** 6 icon sizes on one screen; the ⓘ is jammed against the + in the Cases header; the star column header is a text "★" while rows use SVG.
- **Blank icon:** `icon="mdi-close"` string with the mdi-svg set renders nothing (`NumericRangeControl.vue:27`).

## 7. Resolution scaling (06)

- **Best:** 2560×1440. **Worst:** 1366×768 and 1080p at 125–150% OS scaling, which are the most common hospital setups.
  - At 1280×720 CSS (1080p @150%): 10 rows, no cDNA, AA, ClinVar or gnomAD.
  - At 200% zoom or 320 px: 0 rows, and the page can't scroll (WCAG 1.4.10 fail).
- **Fixed-height layout:** `CaseView.vue:476` uses `calc(100vh-80px)` with `overflow:hidden`.
- **Details panel overlays** pagination, the toolbar and the Gene column (up to 800 px, not viewport-capped).
- **Columns:** responsive column-priority code exists but is unused (`useResponsiveLayout.ts:35-67`).
- **Truncation:** HGVS/transcript cells truncate at 200 px with no tooltip.
- **Text resize:** px-based chips and buttons clip at 200% text.
- **Electron window** has no `minWidth`/`minHeight`.

## 8. Web-mode completeness (02)

- No logout UI, no admin/user management (the component is mounted nowhere) and no theme toggle.
- Export fails on Postgres but is still offered.
- HPO and protein endpoints return 501; ClinVar returns 404. All of these surface as empty results or console errors.
- No URL state: reload loses the case and filters.
- About says "Electron vweb"; Settings shows the desktop-only "Worker Threads".

---

## 9. Recommendations: staged PR roadmap

Each PR ships case and cohort together (parity rule) and adds its own regression gate.

| PR | Scope | Key changes | Expected effect |
|---|---|---|---|
| **1. Correctness hotfix (P0)** | Renderer | Row identity by `variant.id`; latest-request-wins + abort; null-safe totals; reset table state on case switch; cohort search watcher; chr+pos default sort | Removes every wrong-data path; unit + E2E repro tests |
| **2. Smooth table** | VariantTable, CohortTable, ShortlistPanel, composables | `useDelayedFlag` + `useTableLoadingState` (stale-while-revalidate, dim at 150 ms, min 300 ms bar); fixed column widths; sticky header; reserved filter row; single request per Clear; immediate chip apply / 250 ms typing debounce; LRU page cache + prefetch; `aria-busy` + polite count announcement; focus retention; reduced motion | Table smoothness 4.5 → ~9; CLS ≈ 0 on interactions; blank-body time 0 ms |
| **3. First impression & Lighthouse performance** | App shell, web server, build | Defer home empty-state until cases load; no sidebar auto-collapse; brotli + `immutable` caching; drop Google Fonts; lazy-mount protein modal, details panel, drawers; Vue runtime-only alias; skip unsupported 501/404 calls in web; pre-mount background + `color-scheme`; delegated tooltips/menus | Desktop Perf ~55–75 → 95+; mobile ~40 → 80+; CLS < 0.02; INP < 200 ms; BP 100 |
| **4. Accessibility to 100** | Shared components | `IconButton` wrapper (required `aria-label`, ≥ 24 px target, icon via prop); drop global compact `VBtn` density; contrast-safe grey token; list/option roles; `h1` + headings, skip link, per-route titles; focus into the panel and back; remove empty tooltips; reduced-motion strategy | axe 0 violations, Lighthouse A11y 100; fixes clipped icons |
| **5. Icon & visual system** | Theme, icons | 3 icon sizes (16/20/24) via `defaults.VIcon`; unknown status = no icon or one muted "Unknown" label; SVG star header; lint rule against `icon="mdi-*"` strings; then `/impeccable typeset` + `/impeccable colorize` to move off default-Vuetify look (tabular mono for HGVS, ACMG colour semantics not by colour alone) | Consistency heuristic 1 → 3 |
| **6. Scaling** | CaseView, panel, columns | Scrollable page on short viewports; collapse preset chips; panel docks at ≥ 1440 px, `min(800px, 45vw)`; wire `useResponsiveLayout` column priority; merge 7 link-out columns; HGVS tooltip; rem typography; sidebar breakpoint `md`; Electron `minWidth 1024 / minHeight 640`; "Auto (fit)" page size | Scaling 5 → 8.5; WCAG 1.4.4/1.4.10 pass |
| **7. Web-mode completeness** | Web shell | Logout, admin mount, theme toggle + fixed dark tokens (footer, mode toggle), export for Postgres or hide it, explicit "not available in web" states for HPO/protein/ClinVar, URL state for case/tab/filters/sort, ACMG confirm + undo | Heuristics 3/5/9 +1 each |
| **8. Non-blocking backend** | Main, web server, DB | Single writer thread; frequency upkeep, cohort export (with progress/cancel) and ZIP into workers; case delete as a background job; window before DB; pool 10–20, cached auth check, batched audit writes; `(case_id, chr_rank, pos)` index, keyset paging, async/approximate counts; compressed responses | Non-blocking 5 → 8+; no main-thread task > 50 ms |

**CI gates to lock it in** (tools from 01):
- `@axe-core/playwright` on the 5 key states (0 serious/critical).
- Lighthouse CI user-flow with budgets (Perf ≥ 95 desktop, A11y/BP 100, CLS ≤ 0.02).
- Extend `renderer-perf-phase1.e2e.ts` with layout-shift/INP observers asserting CLS ≈ 0 and INP < 200 ms per table interaction, ≤ 1 query per sort, and no stale render under delayed-first-request.
- A unit test for same-locus row identity.

**Unreachable target:** SEO 100 on the login page conflicts with the intentional `noindex`. The ceiling is 92 after adding a meta description and a public `/robots.txt`.

## 10. What works (keep)
- Server-side pagination with markRaw/shallow rows, lazy heavy libraries, a strict CSP, and a fast, non-blocking request loop.
- Ranked Shortlist-first triage and the ACMG points engine.
- DSL search plus keyboard shortcuts.
- Details panel open and close is instant with zero shift (9.5–10).
- No horizontal page overflow at any viewport; dialogs scroll correctly everywhere.
- The Shortlist already uses the correct stale-response guard; it is the template for P0-2.
