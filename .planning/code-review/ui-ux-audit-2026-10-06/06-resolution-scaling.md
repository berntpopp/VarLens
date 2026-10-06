# 06: Resolution, pixel density, and zoom scaling audit

**Date:** 2026-10-06
**Target:** VarLens web mode (v0.72.0) at `http://localhost:8787/`, user `admin`, DB with 3 cases (~19.6k variants). The Electron renderer is the same code.
**Method:** Headless Chromium 1.63 (Playwright) driven by node scripts. I did not use the shared Chrome or the Playwright MCP. Each matrix cell ran in a fresh context with a saved `storageState`. A DOM probe measured each cell, and I checked the screenshots by eye. I did not change any source or app data.
**Artifacts:** `scaling/` has 118 PNGs. Shots wider than 1920 px were downscaled to 1920 wide. The `crop-dpr-*` files are native-resolution crops for checking hairline borders. The raw metrics (`results.json`) and the scripts are in the session scratchpad and are not committed.

Each cell was probed for these values:
- Horizontal overflow of the whole page.
- Clipped text and clipped critical table cells (Gene, cDNA, AA change, transcript, Func, consequence, ClinVar).
- Overlapping and occluded interactive elements.
- Targets smaller than 24 px, plus the WCAG 2.5.8 spacing-exception check.
- Rows and columns visible above the fold, and how far down the first data row starts.
- Toolbar row count, plus how often the preset chips wrap.
- Dialog geometry and whether the dialog scrolls internally.
- Histogram of font sizes in px.
- Vuetify display tier.
- Width of the open detail drawer.

---

## 1. Summary

| State | Score /10 | One-line verdict |
|---|---|---|
| Login (`/login`, static HTML) | **8.5** | Reflows cleanly down to 320 px. Fonts are hard-coded in px, so text-only resize does nothing. |
| Home / case list | **6.5** | Below 1145 px the sidebar starts hidden, yet the empty state says "select a case from the sidebar". At 320×200 the case list cannot be reached. |
| Case view: variant table | **4.0** | No sticky header. ClinVar sits off-screen at every width up to 1920. 245 px of chrome above the first row. At 200 % zoom, 0 rows are visible. |
| Case view + details panel | **3.0** | The 400 px panel is an overlay. It covers the pagination, Filters/Columns/Export and, at ≤1024, the Gene column. The "Fetch VEP" button renders 8 px tall. |
| Cohort view | **4.5** | Same table defects as the case view. 263 px of chrome. Long HGVS is cut off with an ellipsis and has no tooltip. 42–77 targets fail the 2.5.8 spacing check. |
| Typical dialog (Application Preferences) | **7.5** | `max-width=600` plus `scrollable` behaves well at every size. With 200 % text, labels and the Close button are clipped. |
| **Overall** | **5.0** | Designed for 1920×1080 at 100 %. It degrades badly at the most common clinical setups: 1366×768, and 1920×1080 at 125–150 % Windows scaling. |

**Best resolutions:** 2560×1440 at DPR 1 shows 22 of 26 columns and the full page of 25 rows. 1920×1080 at 100 % shows 20 rows and 16 columns, but ClinVar is still off-screen.
**Worst resolutions:**
- 200 % zoom (640×400 CSS): 0 data rows.
- 320 px reflow: 0 data rows, and the page cannot scroll.
- 960×540 (1920×1080 physical at 200 %): 4 rows.
- 853×533 (150 % zoom of 1280×800): 4 rows.
- 1024×768 with the panel open: 5 columns, no Gene, no pagination.

---

## 2. Matrix

Legend: **P** = pass, **m** = minor, **F** = fail. Abbreviations used in the cells:
- *rows*: data rows fully visible in the table viewport (the page size is 25).
- *cols*: columns fully visible out of 26 (case) or 18 (cohort).
- *chrome*: px from the top of the viewport to the first data row.

| Viewport (CSS px @ DPR) | Login | Home | Case table | Case + details panel | Cohort | Dialog |
|---|---|---|---|---|---|---|
| 1024×768 @1 (compact tier) | P | m: sidebar hidden, copy points to it | F: 11 rows, 9 cols, no cDNA/AA/ClinVar/gnomAD/Consequence; chips wrap to 3 rows; chrome 267 | **F**: 5 cols, Gene hidden, pagination and toolbar under panel | m/F: 10 rows, 9/18 cols, chrome 285 | P (600×665 fits) |
| 1280×720 @1 (=1920×1080 @150 %) | P | P | F: 10 rows, 11 cols, no cDNA/AA/ClinVar/gnomAD; chrome 245 (34 % of height) | **F**: 8 cols, pagination hidden | m: 10 rows, ClinVar/gnomAD off-screen | P (fits with 27 px spare) |
| 1280×800 @1 | P | P | m/F: 12 rows, 11 cols | F: 8 cols | m: 12 rows | P |
| 1366×768 @1 | P | P | m/F: 11 rows, 11 cols, ClinVar/AA/cDNA off-screen | F: 8 cols (Chr…OMIM only) | m: 11 rows, 5 HGVS cells truncated | P |
| 1440×900 @1 | P | P | m: 15 rows, 12 cols | F: 9 cols | m | P |
| 1536×864 @1 and @1.25 (=1920×1080 @125 %) | P | P | m: 14 rows, 13 cols, ClinVar/gnomAD off-screen | m/F: 10 cols, pagination hidden | m | P |
| 1920×1080 @1 | P | P | m: 20 rows, 16 cols, **ClinVar off-screen** | m: 12 cols, pagination hidden | P/m: 20 rows, 15/18 | P |
| 2560×1440 @1 | P | m: empty-state hero alone in a 2280 px field | P: 25/25 rows, 22 cols (≈45 % of the table area is empty, see §3.9) | P/m | P | P |
| 3840×2160 @1 | P | m | m: all 26 cols, but 25 rows fill <45 % of the height; 14 px text looks tiny | m | m | P |
| Portrait 1080×1920 @1 | P | m: sidebar hidden | m/F: 9 cols, no HGVS/ClinVar; ≈850 px empty below | F: 6 cols, Gene hidden | m/F | P |
| Tablet 768×1024 @1 (narrow tier) | P | m | F: 7 cols | F: panel goes full-width (by design) | F: 8 cols | P |
| Phone 390×844 @1 | P | m | F: 4 cols, chips wrap to 5 rows, chrome 335, case ID truncated | F (full-width panel) | F | P (332 px, fits) |
| DPR 1.25 @1536×864 | — | — | m: chip outlines blur (see §3.11) | m | — | P |
| DPR 1.5 @1280×720 | — | — | m: same as 1280×720 plus chip outlines blur | F | — | P |
| DPR 2 @960×540 (=1080p @200 %) | — | — | **F: 4 rows** | **F: 5 rows, 5 cols** | — | P (scrolls internally) |
| Zoom 80 % (1600×1000 @0.8) | — | P | m: 18 rows, 13 cols | m/F: 10 cols | — | P |
| Zoom 125 % (1024×640 @1.25) | — | m | F: 7 rows | F: 7 rows, 5 cols | — | P (scrolls) |
| Zoom 150 % (853×533 @1.5) | — | m | **F: 4 rows**, 7 cols | **F: 4 cols** | — | P (scrolls) |
| Zoom 200 % (640×400 @2) | — | m | **F: 0 rows** (WCAG 1.4.4) | **F** | — | P (scrolls) |
| Reflow 320 px (1280 @400 % = 320×200 @4; also 320×512) | P | **F: case list unreachable at 320×200** (list never renders) | **F: table viewport 48 px, 0 rows, page cannot scroll; case ID truncated to "LB26…"; toolbar clipped** (WCAG 1.4.10) | F | — | — |
| Text-only 200 % (root font-size, 1280×800) | m: px fonts don't grow | F: case-list rows clipped vertically | **F: preset chips, Filters/Columns/Export and search field clipped vertically; ACMG chips overlap; footer icons clipped** | F | — | m/F: field labels/hints stay 12 px; "Close" clipped; title overflows |

There was no horizontal page overflow (`documentElement.scrollWidth > clientWidth`) in any cell. The app shell locks the page height and width, so content is clipped or hidden instead of overflowing. That is exactly why the zoom and reflow cells fail.

### Live resize 1920 → 1600 → 1366 → 1280 → 1144 → 1024 → 839 → 1024 → 1366 → 1920 (one page, panel open)

- **State survives:**
  - The panel stays open.
  - The selected row (`MT 14,470`) stays selected and in view.
  - The table keeps `scrollTop`/`scrollLeft` (160/150).
  - The tab stays the same.
  - No horizontal page overflow at any step.
- **Jarring transitions:**
  - Crossing 1145 px (Vuetify `lg`) flips the left drawer to temporary/closed and removes the Case/Cohort labels and the toolbar ACMG chips. That one step produced a layout-shift burst of 0.77.
  - At 839 px the detail panel jumps from 400 to 829 px (full-width).
  - Cumulative layout-shift value: 4.31 over the sequence. These are resize-induced and excluded from CLS, so this is informational.
- **Initial load:** one shift of 0.10 at ~390 ms, before any input. On its own that sits right at the "needs improvement" threshold.
- Screenshots: `resize-1-1920-before.png`, `resize-2-1024-mid.png`, `resize-3-1920-after.png`.

---

## 3. Findings (root causes)

### 3.1 Table header is not sticky (all sizes) — P1
After scrolling the table body, the column headers scroll out of view. Measured at 1366×768 with `scrollTop = 400`: `th.top = −195` while the wrapper top is at 205, so the header is gone (`x-1366x768__case-table-scrolled-no-sticky-header.png`). At 720/768 heights only 10–11 rows fit, so users scroll constantly. They then lose track of which column is Ref/Alt/GT/gnomAD/CADD, which is a misreading risk for clinical values.
- **Root cause:** no `v-data-table-server` uses `fixed-header` (grep finds zero hits). `data-table-shared.css:158-182` makes the first two columns sticky (`position: sticky; left: …`) but gives `thead th` no `top`.
- **Fix:** add `fixed-header` to `VariantTable.vue`, `CohortTable.vue`, `GeneBurdenTable.vue` and the shortlist table. Raise the z-index of the sticky corner cells (`th:first-child`, `th:nth-child(2)`) above both the sticky header and the sticky columns (z 4). **Effort S.**

### 3.2 Clinically critical columns are off-screen by default at common widths — P1
In the case view, ClinVar is off-screen at **every width ≤ 1920 px**. cDNA and AA change are off-screen at ≤ 1366. With the panel open at 1920, AA change, gnomAD and ClinVar are all off-screen. Measured visible columns (case table):
- 9 at 1024
- 11 at 1280 and 1366
- 13 at 1536
- 16 at 1920
- 22 at 2560

The width is spent elsewhere:
- **Order:** the default order (`variant-table/columns.ts:52-72`) is Chr, Pos, Ref, Alt, GT, Gene, OMIM, Func, Consequence, Transcript, cDNA, AA, gnomAD, CADD, Qual, **ClinVar**, … followed by 7 link-out columns (VarSome, Franklin, PubTator, LitVar, DECIPHER, ClinGen, Ensembl) at 80 px each.
- **Wide, low-value cells:** Ref and Alt each have a fixed 100 px width, but the Alt cell grows to its 150 px `.allele-cell` max. GT takes ~85 px for "0/1".
- **Dead code:** `useResponsiveLayout.ts:35-67` already defines `maxAutoVisibleColumns` and `COLUMN_PRIORITY` (gene 1, consequence 2, clinvar 3, gnomad 4 …), but **nothing consumes them** (grep shows they are only defined and returned).
- **Fixes:**
  - Wire the priority map into `useVariantColumns`/`useColumnPreferences` as a *default* visibility set per tier, without overriding explicit user choices. Do the same for the cohort table (parity rule).
  - Move ClinVar and gnomAD AF ahead of Transcript/OMIM/Qual in the default order.
  - Merge Chr/Pos/Ref/Alt into one compact "Variant" cell (`7:30019110 T>TG`), as the Shortlist already does.
  - Collapse the 7 link-out columns into one "Links" menu column.
  - **Effort M.**

### 3.3 Details panel overlays content instead of docking — P1 (hides data and navigation)
`VariantDetailsPanel.vue:2-9` is a `temporary`, `persistent`, `:scrim="false"` right drawer, 400 px wide by default (resizable 300–800, `usePanelResize.ts` defaults). Because it overlays the table instead of pushing it aside, at every width it covers:
- the **pagination controls** (only "Items per page:" stays visible). You cannot page while the panel is open.
- the **result count, Filters, Columns and Export** in the toolbar.
- the right-hand columns. At 1024 and at portrait 1080 this includes **Gene**: 5–6 columns stay visible (Chr, Pos, Ref, Alt, GT), and the panel itself says "Unknown Gene" for intergenic rows.

The resize maximum (800) is also never clamped to the viewport (`usePanelResize` has no viewport clamp, unlike `FilterDrawerShell.vue:78-91`, which clamps to 40 %). At 1024 a user can drag it to cover 78 % of the screen.
- **Fixes:**
  - At ≥1440 px, render the panel non-temporary (docked) so `v-main` shrinks and the table/footers reflow. Keep it as an overlay below that.
  - Clamp the width to `min(800, 45vw)`.
  - Move the pagination into a toolbar region that is not covered, or offset the `v-data-table-footer` by the panel width.
  - **Effort M.**

### 3.4 Fixed-height app shell plus vertical chrome stack leaves almost no table at short heights or high zoom — P1 (WCAG 1.4.4 / 1.4.10)
`CaseView.vue:473-478` sets `.case-content { height: calc(100vh - 48px - 32px); overflow: hidden }`. The table has to fit in whatever space is left. Above the first data row, 245 px are fixed chrome at the `full` tier (267 px at compact, 335 px on phone):
- app bar 48
- variant-type tabs 36
- case header 32
- search/filter toolbar 48
- preset-chip row 27–49
- the 12 px "top scrollbar" strip
- table header 40

Below the rows, another ~95 px go to the table footer (60) and the app footer (29). The hard-coded `32px` also doesn't match the real 29 px footer, and at 200 % text the footer is 41 px, so 9 px of the table hide under it.

| Viewport | Rows visible |
|---|---|
| 1280×720 | 10 |
| 1024×640 (125 % zoom) | 7 |
| 853×533 (150 %) | 4 |
| 960×540 | 4 |
| 640×400 (200 %) | **0** |
| 320 px reflow | **0** |

The page itself never scrolls, so the content is not just inconvenient to reach but **unreachable**.
- **Fixes:**
  - Below a height threshold (`@media (max-height: 640px)` or a `useDisplay().height` check), let `.case-content` fall back to normal document flow (`height: auto; overflow: visible`) so the page scrolls. Alternatively, make the tabs, case header and preset chips collapse or scroll away and keep only the search bar sticky.
  - Collapse the preset chips into a single "Presets ▾" menu or a horizontally scrolling single row (`flex-wrap: nowrap; overflow-x: auto`).
  - Merge the case header into the tabs row.
  - Replace `calc(100vh - 48px - 32px)` with flex layout from `v-main` (`height: 100%`, using `--v-layout-top/bottom`), or `100dvh` minus the actual layout vars.
  - **Effort M–L.**

### 3.5 Global `density: 'compact'` combined with `size="x-small"`/`"small"` collapses buttons to 8/16 px — P1 (WCAG 2.5.8, clipped labels)
`plugins/vuetify.ts:101-108` defaults every `VBtn` to `density: 'compact'`, which Vuetify implements as `height: calc(var(--v-btn-height) - 12px)`. For text buttons:
- `x-small` (20 px) becomes **8 px**
- `small` (28 px) becomes **16 px**

For icon buttons (−8 px), `x-small` becomes 12 px and `small` becomes 20 px. The codebase has **93** x-small and **159** small `v-btn` usages. Visible results:
- The **"Fetch VEP" button in the Transcripts card is 8 px tall**, with its label cut through the middle (`TranscriptSection.vue:188-196`; probe: `height 8px, --v-btn-height 20px, content 24px`). See `x-1366x768__detail-panel-crop.png`.
- "Export" in the toolbar is 91×16 px, the footer version button is 117×16, and there are several (36×8) icon/menu buttons.
- Spacing-exception failures (targets <24 px whose 24 px circles overlap another target):

| View | Failures |
|---|---|
| Case view (1366) | 4–10 |
| Cohort view (1366) | 42 |
| Cohort view (1920) | 72 |
| Cohort view (2560) | 77 |
| Phone | up to 52 |

- **Fixes:**
  - Don't put density on the global `VBtn` default. Keep it on tables, lists and fields.
  - Or add a CSS floor: `.v-btn { min-height: 24px } .v-btn--icon { min-width: 24px; min-height: 24px }`.
  - Audit `size="x-small"` text buttons and change them to `size="small"` with `density="default"`.
  - **Effort S (floor) to M (audit).**

### 3.6 Truncation of HGVS and consequence with no way to read the full value — P1
`data-table-shared.css:119-126` caps every `td` at `max-width: 200px` with `text-overflow: ellipsis; white-space: nowrap`, and adds no `title` or tooltip. Examples from the cohort table at every width up to 2560:
- `n.2411+3252_2411+3253delinsTG` becomes `n.2411+3252_2411+3253…`
- `p.(Pro4115_Ala4116delinsArgSer)` is cut off
- `non_coding_transcript_intron_variant` becomes `non_coding_transcript_intr…`

In the case table, `AA Change` and `Transcript` truncate as soon as text is enlarged. `VariantTable.vue:680-688` also cuts `.transcript-truncated` at 120 px. Only `AlleleCell` has a tooltip.
- **Fixes:**
  - Add `:title="value"` (cheap) or a `v-tooltip` to `HgvsCell` and to the cohort `cdna`/`aa_change`/`func` cells (`CohortTableRow.vue:86-106`).
  - Use middle-ellipsis for HGVS so the variant end stays visible.
  - Let the HGVS columns be resizable or wrap to 2 lines in a "comfortable" density.
  - **Effort S.**

### 3.7 Text-only resize (root 200 %) breaks fixed-height controls — P1 (WCAG 1.4.4)
With `html { font-size: 200% }` at 1280×800, controls keep px heights while their rem-based text doubles:
- Preset chips stay **18 px** tall with 24 px text, so the labels are clipped top and bottom.
- Toolbar buttons (Filters/Columns/Export), the search field and the ACMG P/LP/VUS chips clip or overlap.
- Case-list rows in the sidebar clip their second line ("6,399 variant…").
- Footer icons are clipped.
- In the dialog, field labels and hints stay at 12 px (fixed px) while the title overflows and "Close" is clipped.

The fixed px font sizes behind this:
- **18 px declarations** in components (`FilterDrawer.vue:849` 10 px, `CohortFilterDrawer.vue:672` 10 px, `ExternalLinksSection.vue:212` 11 px, `AcmgEvidenceGrid.vue:174,191` with `!important`, plus the protein tooltips).
- `src/web/login/login.html` (all px).

Browser-zoom scaling itself works, because everything scales, but that path fails on height (§3.4).
- **Fixes:** convert the remaining px font sizes to rem. Use `min-height` instead of fixed `height` on chips and buttons (Vuetify chip `size="x-small"` sets a px height, so override with `height: auto; min-height: 1.5em`). Let the virtual-scroller item height derive from rem. **Effort M.**

### 3.8 Breakpoint behaviour below 1145 px (Vuetify `lg`) — P2
- **Sidebar:** `App.vue:20` passes no `temporary`/`mobile-breakpoint`, so Vuetify's default `mobile` handling makes the left drawer temporary *and closed* below 1145 px. That covers 1024×768, every tablet, and portrait 1080 (`compact` tier). The home empty state still says "← Select a case from the sidebar" while the sidebar is hidden (`vp-1024x768__home.png`).
- **Overlay without scrim:** at the compact tier the temporary drawer overlays content with no scrim (`:scrim="tier === 'narrow'"`).
- **Labels disappear:** at the same boundary the Case/Cohort labels and the toolbar ACMG chips vanish, which is the 0.77 layout-shift burst seen during resize.
- **Fixes:**
  - Set the drawer to `mobile-breakpoint="md"` (840) so 1024-wide workstations keep a persistent, possibly `rail`, sidebar.
  - Auto-open the sidebar on Home when no case is selected.
  - Change the empty-state copy and add an "Open case list" button when the drawer is closed.
  - **Effort S.**

### 3.9 Large screens: page size is not adaptive and table chrome is fixed — P2
`useOffsetPagination.ts:66` uses `settingsStore.itemsPerPage` (default 25, options 10/25/50/100).
- At 2560×1440 and 3840×2160 more than half of the table viewport is empty.
- At portrait 1080×1920 ~850 px are empty.
- At 720/768 heights only 10–11 of the 25 rows are visible, so every page needs a scroll *and* a page change.

Other large-screen issues:
- The search input is capped at 320 px (`FilterToolbar.vue:722-724`), so even at 3840 the placeholder reads "Gene, chr:pos, or filter expres…".
- The home hero sits alone in an unbounded field. That is fine, because text blocks are short and line length is ≤ 640 px.
- **Fixes:** add an "Auto (fit to height)" page-size option that computes rows from the wrapper height divided by row height (36 px). Let the search grow (`max-width: clamp(320px, 30vw, 640px)`). **Effort S–M.**

### 3.10 Small type in the data grid — P2
At 1920×1080 the DOM probe found 85 of 422 text elements below 12 px, and at 1366 it found 47 of 212. The minimum was 10 px.
- **Main source:** `.variant-data-mono { font-family: 'Courier New'; font-size: 0.85em }` (11.9 px), defined **three times with conflicting values**:
  - `table-cells.scss:14-17`: 'Courier New', 0.85em
  - `custom.css:73-78`: ui-monospace stack, 0.875rem
  - `VariantTable.vue:674-677` and `CohortTableRow.vue:254-257`: 'Courier New', 0.85em
- **Visible effect:** Ref/Alt/HGVS/transcript render as thin Courier at about 12 px. At 1366×768 with 125 % scaling on a 14" laptop this is the hardest-to-read data in the app, and it is exactly the data that must be read.
- **Fix:** keep one definition (`custom.css`), using `var(--font-mono)` at a minimum of `0.8125rem` (13 px). Drop Courier New. **Effort S.**

### 3.11 DPR and crispness — P3
I sampled pixel columns from the native-resolution crops (`crop-dpr-*`):
- **Row dividers:** they stay 1 device px at DPR 1, 1.25 and 1.5, and 2 px at DPR 2. They are crisp but very faint at every DPR: gray 219 on 242, about 1.2:1.
- **Outlined preset/ACMG chips:** their 1 px borders turn into 2-px anti-aliased smears at 1.25 and 1.5 (gray 147+101, 157+93). At 125/150 % they look soft or blurry.
- **Text and icons:** MDI SVG icons and text render sharply at all DPRs.
- **Charts:** there are no canvas or SVG charts in the audited states. The protein/lollipop panels were not opened.
- **Fixes:** raise the divider opacity to `--v-border-opacity: .2`. Use a 1px `box-shadow: inset 0 0 0 1px` on outlined chips, which snaps better than a border at fractional DPR. **Effort S.**

### 3.12 Electron window has no minimum size, and the default is larger than 1366×768 screens — P2
`src/main/index.ts:70-85` creates the `BrowserWindow` with `width: 1440, height: 900` (`app.config.ts`) and **no `minWidth`/`minHeight`**. Two consequences:
- On a 1366×768 laptop the first launch is bigger than the work area.
- Users can shrink the window into the 0-row states described in §3.4.
- **Fix:** add `minWidth: 1024, minHeight: 640`. Size the first launch from `screen.getPrimaryDisplay().workAreaSize` (for example 90 %, capped at 1440×900) and persist the bounds. **Effort S.**

### 3.13 Other — P3
- **Dead strip:** `custom.css:7-10` sets `scrollbar-gutter: stable` on `html`, but the shell never scrolls the root at desktop sizes. That leaves a permanent dead strip of 10 px (20 px while a dialog is open) at the right edge of every view, visible in all screenshots.
- **Case ID truncated:** at ≤ 390 px the case ID is cut to "LB26…" in the case header. The identifier should never truncate.
- **Duplicate status icons:** the context indicator shows two status icons ("? ? LB26-0060 i") at every width, which wastes app-bar space at compact widths.
- **Phone/tablet:** functional but not usable for analysis (4 columns, 5 rows of preset chips). That is acceptable as secondary targets, provided §3.4 makes everything reachable.

---

## 4. Prioritised issues

| # | Pri | Issue | Files | Fix | Effort |
|---|---|---|---|---|---|
| 1 | P1 | Table header not sticky | `VariantTable.vue`, `CohortTable.vue`, `GeneBurdenTable.vue`, `data-table-shared.css:158-182` | `fixed-header` + corner z-index | S |
| 2 | P1 | Fixed shell height leaves 0–4 rows at zoom 150–200 %, 320 px reflow, and 540 px heights; page can't scroll (1.4.4/1.4.10) | `CaseView.vue:473-478`, `CohortView.vue`, `FilterToolbar.vue`, `PresetBar.vue` | Short-height fallback to document scroll; preset chips in one scrolling row or a menu; merge the case header into the tabs | M–L |
| 3 | P1 | Detail panel overlays pagination, toolbar and Gene; width not clamped | `VariantDetailsPanel.vue:2-9`, `usePanelResize.ts`, `useResponsiveLayout.ts` | Dock at ≥1440, clamp `min(800, 45vw)`, keep pagination uncovered | M |
| 4 | P1 | ClinVar/HGVS/gnomAD off-screen by default ≤1920; priority map is dead code | `variant-table/columns.ts:52-72`, `useResponsiveLayout.ts:35-67`, cohort column defs | Tier-based default visibility, reorder, compact Variant cell, one "Links" column | M |
| 5 | P1 | Global compact density turns x-small/small buttons into 8/16 px (Fetch VEP unreadable; 2.5.8) | `plugins/vuetify.ts:101-108`, `TranscriptSection.vue:188`, ~250 call sites | Drop global VBtn density or add a 24 px min-height floor | S–M |
| 6 | P1 | HGVS/Func truncated at 200 px with no tooltip | `data-table-shared.css:119-126`, `CohortTableRow.vue:86-106`, `table-cells/HgvsCell.vue`, `VariantTable.vue:680` | `title`/tooltip, middle ellipsis, resizable columns | S |
| 7 | P1 | Text-only 200 %: chips/buttons/list rows clip; px fonts don't scale | `custom.css`, 18 px declarations listed in §3.7, `src/web/login/login.html` | rem fonts, `min-height` instead of `height`, rem-derived virtual row height | M |
| 8 | P2 | Sidebar hidden and closed below 1145 px; empty state points to it | `App.vue:20`, `components/EmptyState.vue` | `mobile-breakpoint="md"`, auto-open on Home, CTA button | S |
| 9 | P2 | Electron has no `minWidth`/`minHeight`; 1440×900 default exceeds 1366×768 | `src/main/index.ts:70`, `shared/config/app.config.ts` | `minWidth 1024 / minHeight 640`, work-area sizing, persisted bounds | S |
| 10 | P2 | Fixed 25-row page size (empty space at 1440p/4K/portrait, scroll+page at 768) | `useOffsetPagination.ts:66`, `app.config.ts` | "Auto (fit)" page size | S–M |
| 11 | P2 | 11.9 px Courier for genomic data; three conflicting `.variant-data-mono` definitions | `custom.css:73`, `table-cells.scss:14`, `VariantTable.vue:674`, `CohortTableRow.vue:254` | One definition: `--font-mono`, at least 13 px | S |
| 12 | P2 | Panel jumps 400→829 px at 839 px; sidebar/labels flip at 1145 (layout shift 0.77) | `useResponsiveLayout.ts`, `App.vue` | Animate or hysteresis, overlay with scrim, fewer simultaneous changes at one breakpoint | S |
| 13 | P3 | Faint row dividers; outlined chips blur at DPR 1.25/1.5 | Vuetify theme vars, `PresetBar.vue` | Border opacity .2; inset box-shadow outlines | S |
| 14 | P3 | `scrollbar-gutter: stable` creates a permanent 10 px dead strip | `custom.css:7-10` | Remove it, or apply it only to real scroll containers | S |
| 15 | P3 | Search field capped at 320 px even at 4K | `FilterToolbar.vue:722`, `CohortFilterBar.vue:638` | `clamp(320px, 30vw, 640px)` | S |
| 16 | P3 | Case ID truncated at narrow widths; duplicate status icons in the app bar | `AppToolbar.vue:283-287`, `CaseStatusIcons.vue` | Never truncate the ID (shrink other items first); dedupe icons | S |
| 17 | P3 | Initial-load layout shift 0.10 | Case/home mount (skeletons) | Reserve skeleton heights | S |

## 5. Suggested sequencing
1. **Quick wins, one PR:** items 1, 5 (CSS floor), 6, 9, 11, 14. All are size S, and together they remove most of the clipped-data and target-size failures.
2. **Layout PR:** items 2, 3, 8, 12. Rework the vertical chrome and the panel docking. Verify with this harness at 1280×720, 1024×640 @1.25, 640×400 @2 and 320×512, aiming for ≥ 8 rows at 720 px heights and ≥ 1 reachable row at 320 px.
3. **Columns PR (cohort parity mandatory):** items 4, 10, 15.
4. **Typography PR:** item 7, plus `login.html` rem conversion.
