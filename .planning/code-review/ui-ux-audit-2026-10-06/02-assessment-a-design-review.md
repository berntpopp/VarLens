# Assessment A: Independent Design and UX Review of VarLens Web

- **Date:** 2026-10-06
- **Build:** v0.72.0 (`05bc72f6`), web mode, Postgres backend, `http://localhost:8787/`
- **Data:** 3 cases (LB26-0060, LB25-6119, LB25-4024), 19,578 variants, 15,626 unique
- **Reviewer stance:** product/UX design director plus senior frontend engineer. I did not run the impeccable detector, Lighthouse or axe, and I did not read any existing reviews. No source files were modified.
- **Tooling:** the Claude-in-Chrome extension was not connected (two attempts returned "Browser extension is not connected"), so the whole review ran on the **Playwright MCP fallback** (Chromium 154). All timings include the injected **75 ms API latency per request**. When I judge snappiness I mentally subtract about 75 ms per round trip.
- **Screenshots:** `screenshots/a-*.png` (about 55 files, referenced inline below).
- **Data hygiene:** I created one ACMG classification (PVS1 + PM2 on FKBP14, which auto-saved as LP). I then removed both criteria, which cleared the classification, and verified after a reload that no LP badge remained. That edit left activity-log/audit entries. I deleted nothing and made no user or password changes.

---

## 0. Headline

VarLens has the bones of a serious clinical tool. It has a ranked shortlist, a points-based ACMG engine with ClinGen SVI notes, a DSL search, presets, keyboard shortcuts and per-column filters. The web build, however, has **several correctness defects that put wrong data in front of a clinician**, and those outweigh the polish work:

1. **The variant table renders the wrong variant in a row.** Rows that share `chr:pos:ref:alt` (one variant, two transcript records) both display the *last* record. On the default page 1, the IQSEC3 coding row is displayed as IQSEC3-AS3. A search for FKBP14 shows a *Pathogenic frameshift (HIGH)* as **FKBP14-AS1 / NC Intron / LOW**, twice. Root cause: `buildVariantRenderRows` in `src/renderer/src/components/variant-table/useVariantRenderRows.ts` keys its cache and row objects by `chr:pos:ref:alt` and uses `Object.assign(cached, variant)`.
2. **The case table can stay on its loading skeleton indefinitely, showing another case's count.** Path: case A → Cohort mode → pick case B in the sidebar → SNV/Indel. Skeleton rows stay forever, the count pill reads `0 / 6,733` (case A's total), and no `variants/query` request is ever sent. Clear and tab switches do not recover it; only a full reload does.
3. **Search in the Cohort view does nothing.** A search chip appears and the Filters badge increments, but no `cohort/getVariants` request is sent and the count stays at 15,626 / 15,626. The Impact quick filters do work. This is a cohort-parity break.
4. **The default case-view order is `pos ASC` with chromosome ignored**, so chromosomes interleave (chr17:413k, then chr11:1.0M, then chr16, chr6, chrX…). Source: `buildPostgresVariantOrderBy` in `src/main/storage/postgres/PostgresVariantReadRepository.ts`. The cohort view correctly orders by `chr, pos`.

The overall design verdict is *competent, dense, mostly authored for the domain, but inconsistent and under-finished in web mode*. Several features are visible but dead: Export, HPO search, logout, user admin, the dark theme, and protein/ClinVar enrichment.

---

## 1. Per-view / per-function scores

Snappiness bands: **instant** <100 ms, **noticeable** 100 ms–1 s, **sluggish** >1 s. Wall times include the 75 ms injected latency.

| # | View / function | Score /10 | Justification | Snappiness | Flicker / CLS observed |
|---|---|---|---|---|---|
| 1 | **Login** (`/login`) | 7 | Clean and calm. Labels are bound, autocomplete is correct (`username`, `current-password`), the error uses `role=alert`, and the page honours dark mode. On a wrong password, focus drops to `<body>`, the wrong password stays filled, and the vertically centred card **jumps up about 30 px** when the alert inserts (a-01, a-02). | Instant (380 ms round trip) | Card jump on error |
| 2 | **Research-use disclaimer** | 6 | The content is appropriate and the dialog is correctly persistent. It shows an inner scrollbar inside the modal, and the CTA sits on a thin bar that reads as a footer, not a decision (a-03). | Instant | None |
| 3 | **App shell / header / footer** | 4.5 | The header carries two identical `?` glyphs (affected status = unknown, sex = unknown) with hover-only tooltips that can't be reached by keyboard or screen reader. The "VarLens Web" menu just shows `web:postgres`. There is **no logout and no user/admin entry**. The footer has 8 icon buttons of 12–20 px. 63 of 99 visible buttons have no accessible name. | Instant | — |
| 4 | **Home / case list** | 6 | The welcome state is clear and the case items show variant count and age. The sidebar header packs ⓘ and + with no names. "All cases loaded" is noise for 3 cases. **CLS 0.178** on first paint, from the infinite-scroll sentinel and the welcome row (a-03 frames). | Noticeable (~450 ms to populated) | CLS 0.178 / 0.175 on reload; "No database" flashes, then "VarLens Web" |
| 5 | **Shortlist (ranked)** | 6.5 | A strong concept: the first screen is a ranked Tier-1 candidate list. "Scored (capped): 200 → top 50 (10ms)" is developer telemetry, and ClinVar shows raw `Uncertain_significance` / `Pathogenic/Likely_pathogenic`. Impact is uncoloured. Rows are 57 px tall (3-line HGVS), so only 10 rows fit at 1440×900 (a-06). | Instant (273 ms) | None |
| 6 | **Case table (SNV/Indel)** | 3.5 | Density is good (36 px rows, about 15 visible) and the count pill and per-column filter icons work well. Several defects: the **P0 row-duplication** bug, the non-genomic default order, a **sticky header that scrolls away** (`thead` top = −121 px while `position: sticky`; a-32), two horizontal scrollbars, three empty-value glyphs (`- -`, `--`, `—`) and three font stacks (Roboto, ui-monospace, Courier New). | Sort, paging ~500–600 ms | **Sort collapses tbody from 25 rows to 1 loading row for ~180 ms** (blank flash); columns re-flow horizontally after sort (GT shifted ~100 px) |
| 7 | **Search / DSL** | 5 | Results are fast and a removable chip appears. A malformed expression (`gene = "BRCA1" AND (af < 0.01 OR`) is silently treated as free text and returns 0 rows, with no parse error. In the empty state, the header loses its Position label and Chr/Position overlap (a-15b). The empty-state message is centred on the 2,000 px table, not the viewport (a-12). Tabbing into the field moves focus into the suggestion list. | Instant to noticeable (~360 ms) | **Active-filter chip row inserts and pushes the table down 34 px**; full-table skeleton replaces rows during search |
| 8 | **Filter drawer** | 6.5 | Grouped sections, quick AF presets and an "Active" marker per section. It duplicates the toolbar's presets and search; the drawer search has a different placeholder; "Impact" contains "Specific consequences…" while a separate "Consequence" section also exists. It is a temporary overlay with a scrim, so you can't watch results update (a-16). | Each toggle ~360 ms | None measured |
| 9 | **Quick-filter chips + ACMG pills** | 5 | Useful one-click recipes, but **11 preset chips + 5 ACMG pills + star + comment** make 18 equal-weight targets in two rows. "Save" and "Clear all" are **vertically clipped** (a-15). The chips are `v-chip` divs, not buttons. | Instant | — |
| 10 | **Columns drawer** | 6 | Grouped, drag-reorder, "26 of 26 visible", Reset. **Escape does not close it**, contrary to the shortcut sheet ("Escape: Close drawer"). | Instant | — |
| 11 | **Export** | 2 | The button is enabled with a tooltip "Export 6,399 variants to Excel", then fails with a red toast: *"variant export is not available for PostgreSQL yet."* (a-31) | Noticeable | — |
| 12 | **Variant details panel** | 5 | Good structure: identity, transcripts, scores, ACMG, tags, comments, activity, 11 external links. **It keeps the previous scroll position when you open another variant**, so the identity block is hidden (a-25). It overlays the table with no scrim and hides the right columns. "Fetch VEP" is clipped. The gene header can disagree with the selected row (see P0-1). ClinVar (404) and protein mapping (501) fail silently. "Unknown Gene" is shown for intergenic/MT. | Noticeable (~250 ms to content) | Small spinner, then content swap; no layout shift |
| 13 | **ACMG classifier** | 6.5 | A genuinely domain-native points engine (PVS1 8 + PM2 1 = 9 → LP). Strength tiers are colour coded, PP5/BP6 are struck through, and tooltips quote the ClinGen SVI downgrade (a-27). **One click commits a classification**, with no confirmation, undo or "saved" acknowledgement. After all evidence is removed, the header still says "(has evidence)". Criteria labels are 10–11 px. | Each toggle ~400 ms, persisted | Tooltip lingers and covers the grid |
| 14 | **Comments / Tags** (panel) | 6 | Inline, global vs case scope is explicit. Placeholder text is at 38 % opacity (approx. 2.6:1). Not exercised beyond viewing. | — | — |
| 15 | **Cohort view: Variants** | 3.5 | Correct genomic order, carriers / cohort frequency / het-hom counts, and expandable carrier rows with "View in Case" (a-35). **Search is a no-op.** Func shows raw SO terms (`non_coding_transcript_intron_variant`) while the case view humanises them ("NC Intron"). Column order differs (Consequence/Func swapped). The star/comment icons overlap the "P" pill. | ~1.3 s to first page | — |
| 16 | **Cohort: Gene Burden** | 6.5 | Clear two-group layout, test choice and weighting. "Run Analysis" is disabled with no reason given, and nothing prevents the same case being in both groups (a-37). Not run. | Noticeable | — |
| 17 | **HPO / phenotypes** | 2.5 | The sidebar HPO filter only lists terms already assigned ("No data available"). In the case-metadata dialog, typing "seizure" shows **"No matching HPO terms"**, but the network shows `POST /api/hpo/search → 501 Not Implemented`. The error is presented as an empty result (a-45). | — | — |
| 18 | **Case metadata dialog** | 4.5 | Compact form for status, sex, age/DOB, cohorts and phenotypes. The **selected "Overview" tab is navy text on a slate bar and nearly invisible** (a-46). | Instant | — |
| 19 | **Import dialog** (Ctrl+I) | 6 | Four clear source cards. There is an empty footer band, and "Folder" / "ZIP Archive" are offered in a browser context. I did not complete an import. | Instant | — |
| 20 | **Database overview** | 6.5 | A good at-a-glance summary (cases, total/unique variants, genes, starred, classified). Not checked beyond that. | Noticeable (1.2 s) | — |
| 21 | **Settings menu / Application Preferences** | 4.5 | Well grouped, including a "Danger Zone". Preferences offer **Worker Threads** ("Auto: 31 threads, takes effect on next database open"), which means nothing in web mode. "Display Name" duplicates the logged-in user. **There is no theme control.** | Instant | — |
| 22 | **Theme (light/dark)** | 2 | `warmDark` is defined in `plugins/vuetify.ts` but nothing activates it. The app ignores `prefers-color-scheme`, while the login page honours it. A dark-mode user therefore goes from a dark login straight into a full-white app: a **theme flash on every sign-in** (a-52 vs a-04). | — | Theme flash at the login → app transition |
| 23 | **Admin / user management** | 1 | `components/UserManagement.vue` exists but is mounted nowhere, so it is unreachable from the UI. | — | — |
| 24 | **Logout** | 1 | There is no UI path. `auth:logout` exists on the server (`src/web/server/dispatcher.ts`), but no button calls it. This is unacceptable for shared clinical workstations. | — | — |
| 25 | **About / FAQ / Shortcuts** | 5.5 | The shortcut sheet is excellent and complete, and the FAQ is searchable. The About popover reads **"Electron vweb"**. Closing these dialogs does not return focus to the trigger (focus lands on `<body>`). | Noticeable (~850 ms) | — |
| 26 | **Error / empty states** | 5 | The table empty state has an icon, explanation and "Clear filters", which is good, but it is off-centre. Upstream failures (HPO, ClinVar, protein, export) are either silent or misreported. | — | — |
| 27 | **Keyboard-only** | 5 | ↑/↓ moves selection, Enter opens the panel, Esc closes the panel, `/`, Ctrl+Shift+X, `?` and Ctrl+I all work. Focus outlines are 2 px. Problems: the Tab order runs into the DSL suggestion list; Esc doesn't close the Columns drawer; focus is never moved into the panel or returned to the row; rows lack `aria-selected`; the selected-row tint is very faint. | Instant | — |
| 28 | **Responsive** | 6 | No page-level horizontal scroll at 1440/1280/1024/390. At 1024, Columns/Export collapse into an overflow menu. At 390 the sticky action and Chr columns take about 55 % of the width, so Gene is off-screen. The panel goes full-width (acceptable). The chip wall wraps to 4 rows at 390 (a-50-*). | — | — |
| 29 | **Session continuity** | 3 | No route deep-links a case: the URL stays at `/` throughout. A reload drops you back to Welcome, losing the case, tab, filters and selected variant. | — | — |

Average across the 29 rows is about **4.9/10**. Excluding the dead-feature rows (export, HPO, theme, admin, logout), the working core averages about **5.6/10**.

---

## 2. Nielsen's 10 heuristics (0–4)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | The count pill (`106 / 6,399`) and the active-filter chips are excellent. But the table can sit on a skeleton **forever** with another case's count, ACMG autosaves with no acknowledgement, and stale "(has evidence)" remains. |
| 2 | Match between system and real world | 2 | The column labelled **"Consequence" shows IMPACT** (HIGH/MODERATE/LOW), and the Shortlist calls the same field "Impact". ClinVar values keep underscores. The default order is non-genomic. "Scored (capped)" is dev jargon. |
| 3 | User control and freedom | 2 | Ctrl+Shift+X, chip ✕ and Clear are good. There is no undo for a one-click ACMG commit, no logout, and a reload loses all context (no URL state). |
| 4 | Consistency and standards | 1 | Case and cohort tables diverge (humanised vs raw SO terms, column order, fonts). The same field has two labels. Three empty-value glyphs and three font stacks. Esc closes some drawers but not others. The login is theme-aware but the app is not. |
| 5 | Error prevention | 1 | Export is offered and then fails. A malformed DSL is accepted silently. Evidence clicks commit instantly. Gene Burden allows overlapping groups. |
| 6 | Recognition rather than recall | 3 | Presets, the shortcut sheet, DSL suggestions, per-column filter menus and ACMG criterion tooltips are all good. The status/sex glyphs need hover to decode. |
| 7 | Flexibility and efficiency | 3 | Keyboard shortcuts, DSL, multi-sort, presets, page prefetch and the Shortlist serve power users. There is no bulk select or bulk classify. |
| 8 | Aesthetic and minimalist design | 2 | Dense where it should be, but the chip wall (18 equal-weight targets), the footer icon row and telemetry text all compete. Tall 3-line rows in the Shortlist waste space. |
| 9 | Help users recognise, diagnose and recover from errors | 1 | An HPO 501 is shown as "No matching HPO terms". ClinVar 404 and protein 501 are silent. The export error is honest but arrives after the fact. |
| 10 | Help and documentation | 3 | FAQ, shortcut sheet, disclaimer, ACMG criterion definitions and SVI notes. About says "Electron vweb". |
| | **Total** | **20 / 40** | **Acceptable (bottom of band; one point from Poor)** |

---

## 3. Design specificity verdict

**Mostly authored for the domain at the information level, but generic Material at the visual level.**

- **Hierarchy.** The case shell is correct in principle (case → variant type tabs → filter bar → table → detail panel). The detail panel, though, is a flat scroll of equal-weight sections, and the ACMG verdict, the most consequential element, is a row of 22 px outline pills. The header spends its strongest real estate on the brand blue and the Case/Cohort toggle instead of case identity: the case name is 14 px beside two ambiguous glyphs.
- **Information architecture.** The Shortlist as the default landing tab is a genuinely clinical decision. But the case view uses *tabs* for variant type while the cohort view uses a *select*. Presets live in three places (toolbar chips, the drawer, and the Shortlist preset select). Search appears twice (toolbar and drawer) with different placeholders.
- **Typography.** Roboto for UI, `ui-monospace` for HGVS/positions, and Courier New in places. Ref/Alt and transcript IDs are set at 11.9 px monospace in a lighter weight, which makes the alleles, the core identity of a variant, the *smallest* text in the row. ACMG strength labels are about 10 px.
- **Colour.** A warm palette with a navy app bar. Impact (HIGH/MODERATE) is plain text in the table but a red chip in the panel. ACMG strength colours are meaningful (purple very strong, orange strong/moderate, blue supporting, red stand-alone). Pathogenicity has no colour in the main table except a small LP badge.
- **Density.** The SNV table (36 px rows) is right for Operate mode. The Shortlist (57 px) is not. Chrome above the table takes **205 px at 1440×900** (header, tabs, case strip, toolbar, chip row), and adding the active-filter row takes it to 240 px.
- **States.** Loading uses skeleton rows (fine), but on sort it collapses to a single loading row. The empty state is good apart from its off-centre position. Error states for remote enrichment are missing.
- **Copy.** Mostly clinical-literate ("Tier 1 candidates", "Recessive candidates", "ClinGen SVI: use as supporting"). It is undermined by raw enum values (`Uncertain_significance`), dev telemetry, "Unknown Gene", "Electron vweb", "No data available".

**Verdict:** this is not interchangeable with an admin template. The Shortlist, the ACMG points engine and the DSL show real authorship. But the visual system has not been taken past Vuetify defaults, and consistency debt between the case, cohort, panel and shell surfaces makes it *feel* assembled rather than designed.

---

## 4. Cognitive-load checklist

| Item | Pass/Fail | Note |
|---|---|---|
| Single focus per screen | **Fail** | The case view presents tabs, the case strip, search, 18 chips/pills, count, Clear/Filters/Columns/Export and the table at once. |
| Chunking (≤4 per group) | **Fail** | 11 preset chips in one undifferentiated row; 11 external links; 25+ ACMG criteria (acceptable as a domain grid, but ungrouped visually beyond strength). |
| Grouping | Pass | The filter drawer and columns drawer are well grouped. |
| Visual hierarchy | **Fail** | The ACMG verdict and case identity are under-weighted; the chip row and footer icons are over-weighted. |
| One thing at a time | Pass (partial) | Detail and filter/column drawers are mutually exclusive overlays. |
| ≤4 options per decision point | **Fail** | See the list below. |
| Working memory | **Fail** | Selecting a variant opens the panel scrolled to an arbitrary section, so the user has to remember which variant they clicked. The table row may also show a different gene than the panel (P0-1). |
| Progressive disclosure | Pass | The Evidence editor, Activity Log and per-column filters are collapsed by default. |

**Failures: 5 of 8.**

**Decision points with more than 4 visible options:**

- Quick-filter row: 11 presets, plus 5 ACMG pills, star, and comment.
- Toolbar right cluster: count, Clear, Filters, Columns, Export (5).
- Footer: 8 icon buttons.
- External Links: 11 tiles.
- ACMG evidence grid: 28 criteria (domain-appropriate, but needs a "suggested first" lane).
- Settings menu: 9 items (grouped, acceptable).
- Import sources: exactly 4 (passes).

---

## 5. Emotional journey (peak-end)

1. **Sign-in** is calm and trustworthy. The disclaimer is serious and appropriate, though it is a wall of text with an inner scrollbar.
2. **Welcome** feels pleasant but empty; there is no "continue where you left off" or "last opened case".
3. **Opening a case lands on the Shortlist**, which is the peak. "Here are your top 50 candidates, ranked" is exactly the reassurance a time-pressed clinician wants.
4. **Switching to the full table** brings friction: MT variants first, then chromosomes interleaved by position, with no obvious "why this order?".
5. **ACMG classification** is the high-stakes moment and the weakest emotionally. One click on PVS1 *already writes a classification* (LP appears in the table immediately) without "Saved", "Undo" or a confirmation that it is attributed to *you*. Removing evidence silently erases the classification. A clinician will not trust a control that changes the record of truth this casually.
6. **End:** there is no logout, and Export fails at the moment of hand-off. The journey ends on a red toast. Peak-end memory: *"great shortlist, but I'm not sure what got saved and I couldn't get my results out."*

---

## 6. Personas

### Alex: power user (keyboard, bulk, speed)

- Positive: `/` focuses search, Ctrl+Shift+X clears, ↑/↓/Enter/Esc drive selection and the panel, `s`/`c`/`a` act on rows, DSL `gnomad_af:<:0.01`, prefetch of the next page (paging feels instant).
- **Red flags**
  - No bulk selection, so Alex can't star, tag or classify N variants at once.
  - Tabbing from the case strip lands *inside the DSL suggestion list* before the input (focus theft).
  - Esc doesn't close the Columns drawer.
  - Ctrl+Shift+X also resets the sort, which is surprising; "Clear" also lights up after only a sort.
  - Sorting blanks the table for about 180 ms each time.
  - No URL state, so Alex can't bookmark or share a filtered view, and reload loses everything.
  - The duplicate-row bug means keyboard ↓ through same-locus rows shows identical rows that open *different* details.

### Sam: screen reader, keyboard, contrast, 200 % zoom

- **Red flags**
  - **63 of 99 visible buttons have no accessible name.** Star, comment and ACMG toolbar toggles, row actions, the sidebar ⓘ/+, the panel close button and the case-info "i" are announced as "button".
  - The case affected-status/sex glyphs are non-focusable icons with hover-only tooltips, so the information is unavailable to Sam.
  - Opening the detail panel does not move focus, and closing it does not restore it. The panel heading does not name the variant at the scroll position where it opens.
  - Table rows lack `aria-selected`; selection is conveyed only by a faint grey tint.
  - Dialogs (Shortcuts, About, FAQ) return focus to `<body>`, not the trigger.
  - Contrast: placeholder and hint text at 38 % alpha is about 2.6:1 (approximate, own calculation). The selected "Overview" tab in case metadata is near-invisible. 11.9 px light monospace alleles at 200 % zoom are readable, but it is the smallest text in the row.
  - 90 of 99 targets are under 24×24 px (WCAG 2.2 SC 2.5.8 AA).
  - 200 % zoom roughly equals the 720 px layout. At 1024 and 390 the chrome above the table grows to 227–295 px, leaving very little table.

### Dr. Mara: clinical geneticist triaging a trio under time pressure

- Positive: the Shortlist answers "what should I look at first?" immediately. Presets like "Recessive candidates" and "Rare HIGH+MOD" match how she thinks. The cohort view shows het/hom per carrier, which supports trio reasoning.
- **Red flags**
  - **She may be shown the wrong variant.** A pathogenic FKBP14 frameshift appears in the table as an FKBP14-AS1 intronic LOW change. She might filter it out mentally.
  - After checking the trio in Cohort mode and jumping to the next case from the sidebar, **the table never loads**, and the count shows the previous case's number. Under time pressure she may conclude "0 variants pass".
  - Cohort search for the candidate gene silently does nothing, so she sees "15,626" and assumes the gene isn't there.
  - HPO entry fails ("No matching HPO terms" for *seizure*), so phenotype-driven prioritisation is impossible in web mode, and the UI implies HPO doesn't contain seizure.
  - There is no trio/inheritance view in the case table (GT only), and no parent genotypes alongside.
  - One mis-click on an ACMG criterion writes a classification with no undo.
  - She cannot export the shortlist for the report, and cannot log out of a shared workstation.

---

## 7. Strengths

1. **Shortlist-first landing.** A ranked "Tier 1 candidates" view as the default case tab, with a preset selector, is the single most clinically authored decision in the product.
2. **ACMG points engine.** Tavtigian-style point tally, strength-tiered colour coding, deprecated criteria struck through, ClinGen SVI caveats in tooltips, and an "Auto-suggest" affordance are domain depth that generic tools lack.
3. **The filter model's feedback loop.** The live `n / total` pill, removable active-filter chips, per-column filter icons, a DSL with examples, Ctrl+Shift+X, and page prefetch make the core triage loop fast (most interactions finish in 300–600 ms including the 75 ms injected latency).

---

## 8. Priority issues

### [P0] Same-locus rows render the wrong variant
- **What:** When a page contains two records with the same `chr:pos:ref:alt` (multi-transcript or overlapping-gene records), both table rows display the *last* record's gene, transcript, function and impact. I reproduced it on default page 1 (IQSEC3 shown as IQSEC3-AS3) and on FKBP14 (a Pathogenic frameshift shown as FKBP14-AS1 / NC Intron / LOW, twice). The API returns the two distinct rows correctly (ids 15537 and 15538).
- **Why it matters:** clinically unsafe. A pathogenic HIGH-impact variant is visually indistinguishable from a benign intronic one, and the details panel shows a gene different from the row that was clicked.
- **Fix:** key render rows by `variant.id`, not `chr:pos:ref:alt`, in `src/renderer/src/components/variant-table/useVariantRenderRows.ts` (`variantKey` and `buildVariantRenderRows`, which currently does `Object.assign(cached, variant)`). Pass `item-value="id"` to `v-data-table-server` in `components/VariantTable.vue`. Keep coordinate keys only for annotation lookups in `useVariantRowViewModel.ts`. Add a unit test with two same-locus variants.
- **Command:** `harden`

### [P0] Case table stuck on skeleton with another case's count after Cohort → case
- **What:** Case A → Cohort mode → select case B in the sidebar → SNV/Indel. The skeleton never resolves, the count pill shows case A's total (`0 / 6,733`), the table shows `0-0 of 0`, and the cohort's "HIGH Impact" filter chip leaks into the case view. No `variants/query` request is ever issued. Neither Clear nor tab switching recovers; only a reload does. Reproduced twice.
- **Why it matters:** silent false negatives ("nothing passes") at exactly the moment a clinician moves between trio members.
- **Fix:** on case change or `onActivated`, force `invalidateAndReload` in the case table data path (`components/variant-table/useVariantData.ts` / `VariantTable.vue`), and reset the total count when `caseId` changes. Scope the filter state per mode, or deliberately carry it with a visible notice.
- **Command:** `harden`

### [P0] Cohort search is a no-op
- **What:** Typing a gene or term into the cohort DSL search adds a "Search X" chip and increments the Filters badge, but no `cohort/getVariants` request is sent and the results do not change. Impact presets do work.
- **Why it matters:** cohort parity is broken, and users conclude a gene is absent.
- **Fix:** trace `components/cohort/CohortFilterBar.vue` (`useDslFilterIntegration({ searchQueryRef: searchTerm, emitFilters: emitFilterChange })`) through `@filter-change` to `CohortTable.vue`'s `handleFilterChange` → `invalidateAndReload`. The `cohortFilterKey` watcher covers `filters` but not `searchTerm`. I did not confirm the root cause. Add an E2E test that types into cohort search and asserts a request is sent and the count changes.
- **Command:** `harden`

### [P1] Default case-view order ignores chromosome
- **What:** `buildPostgresVariantOrderBy` falls back to `v.pos ASC`, so rows interleave across chromosomes (MT, 17, 11, 11, 16, 6, X…).
- **Why it matters:** this breaks every clinician's mental model of genomic order and makes adjacent variants (compound-het candidates) impossible to spot.
- **Fix:** default to a natural chromosome order (1–22, X, Y, MT) then `pos`, `ref`, `alt` in `src/main/storage/postgres/PostgresVariantReadRepository.ts`, matching the cohort query. Verify that SQLite does the same.
- **Command:** `harden`

### [P1] HPO search fails with 501 but reports "No matching HPO terms"; enrichment failures are silent
- **What:** `POST /api/hpo/search` returns 501, which the UI renders as an empty result (`components/HpoTermSelector.vue` / `HpoAutocomplete.vue`). `api/gnomad/getClinVarVariants` (404) and `api/protein/getMapping` (501) fail with no UI signal.
- **Why it matters:** a misleading empty state is worse than an error, because the clinician concludes the ontology lacks the term. Phenotype-driven prioritisation is impossible in web mode.
- **Fix:** distinguish "unavailable in this deployment" from "no matches". Hide or disable features the web runtime doesn't support, behind one capability map shared with Export.
- **Command:** `clarify`

### [P1] Accessibility: unnamed controls, sub-minimum targets, faint focus/selection model
- **What:** 63 of 99 visible buttons have no accessible name (tooltip-only `aria-describedby`). 90 of 99 targets are under 24 px. The case status/sex glyphs are unfocusable. Rows lack `aria-selected`. Dialogs and the panel don't manage focus. The case-metadata "Overview" tab is near-invisible.
- **Why it matters:** WCAG 2.2 AA failures (SC 4.1.2, 2.5.8, 1.4.3, 2.4.3).
- **Fix:** add `aria-label` alongside every icon-only `v-btn` (start with `FilterToolbar.vue`, `VariantTable.vue` row actions, `AppSidebar.vue` header, `VariantDetailsPanel.vue` close, `AppToolbar.vue`). Render `CaseStatusIcons.vue` as a labelled focusable chip ("Affected: unknown · Sex: unknown"). Return focus to the trigger on dialog/drawer close. Fix the selected-tab colour in `CaseMetadataModal.vue`.
- **Command:** `audit`, then `harden`

### [P1] ACMG classification commits on one click with no acknowledgement or undo
- **What:** Toggling a criterion immediately persists a classification (LP appears in the table). Removing evidence silently clears it. There is no "Saved by <user>" and no undo, and "(has evidence)" stays after all evidence is removed.
- **Why it matters:** this is the highest-stakes action in the product and it has the least reassurance.
- **Fix:** in `components/AcmgClassificationPanel.vue` and `components/acmg/AcmgSummaryBar.vue`, keep the evidence as a draft and add an explicit "Apply classification" with a summary ("LP · 9 pts · PVS1, PM2"). Show an undo snackbar and attribution. Fix the stale "(has evidence)" computed.
- **Command:** `clarify`

### [P1] Missing session and identity controls in web mode: logout, user admin, theme
- **What:** No logout UI (the server supports `auth:logout`). `UserManagement.vue` is never mounted. The dark theme is defined but unreachable, and the app ignores `prefers-color-scheme` while the login honours it, which causes a dark → light flash on sign-in.
- **Why it matters:** shared clinical workstations require logout, admins can't manage accounts, and dark-mode users get a jarring flash.
- **Fix:** turn the "VarLens Web" menu in `AppToolbar.vue` into an account menu (user name, role, Change password, User management for admins, Theme: System/Light/Dark, Sign out). Wire the theme to `vuetify.theme.global.name` with a `matchMedia` listener in `plugins/vuetify.ts`.
- **Command:** `onboard` (account menu), `colorize` (dark theme)

### [P2] Sticky header scrolls away; sort blanks the table; filter row pushes the layout
- **What:** `thead` scrolls out of view despite `position: sticky` (a-32). Sorting swaps 25 rows for one loading row (about 180 ms of blank). The active-filter chip row inserts above the table and shifts it 34 px. Columns re-flow horizontally after sort.
- **Fix:** in `VariantTable.vue` / `data-table-shared.css`, make the scroll container the `.v-table__wrapper` with a fixed height so sticky works. Keep previous rows rendered with an overlay or progress bar while loading (Vuetify `loading` without replacing `items`). Reserve the chip-row height, or render chips inline in the toolbar. Set `min-width` on columns.
- **Command:** `layout`, `animate`

### [P2] Inconsistent vocabulary and formatting across surfaces
- **What:**
  - The column "Consequence" shows impact, while the Shortlist calls it "Impact".
  - The cohort shows raw SO terms where the case view humanises them.
  - ClinVar values keep underscores.
  - Three empty glyphs (`- -`, `--`, `—`).
  - Column order differs between case and cohort.
  - "Scored (capped): 200 → top 50 (10ms)" and "Electron vweb" are shown to users.
- **Fix:**
  - Rename the column header to "Impact" and show the SO term under "Consequence" (the DB field names can stay).
  - Route all cells through `utils/formatters.ts` in both `VariantTable` and `cohort/CohortDataTable.vue`, with one `EMPTY = '—'`.
  - Humanise ClinVar.
  - Move the shortlist telemetry to a tooltip in `shortlist/ShortlistPanel.vue`.
  - Fix the About copy in `AppFooter.vue`.
- **Command:** `clarify`, `polish`

### [P2] Export offered and then failing
- **What:** Export is enabled and tooltipped in web mode, then errors with "not available for PostgreSQL yet".
- **Fix:** gate it via a runtime capability. Disable it with an explanatory tooltip, or hide it.
- **Command:** `harden`

### [P3] No URL state
- **What:** The route never encodes the case, tab, filters or selected variant. Reload loses context, and views can't be shared or bookmarked.
- **Fix:** use `/case/:id?tab=&q=&sel=` with the router already present.
- **Command:** `harden`

---

## 9. Minor observations

- Disclaimer focus ring: the whole dialog card gets a thick blue outline when focused programmatically.
- "All cases loaded" footer for 3 cases is noise.
- The sidebar case items use a `?` icon for unknown status (the same glyph as the "help" icon in the footer).
- Row action icons (star / ACMG / comment) are always visible at full opacity on every row. Consider showing them on hover/focus, or dimming them unless set.
- A tooltip lingers after "Done" in the filter drawer ("Keyboard Shortcuts (?)" overlays the pagination).
- The details panel opens with no scrim and covers the rightmost 400 px of the table. A push layout at ≥1440 px would keep context.
- "rsID: N/A" for every variant in this dataset. Hide the empty field.
- An intergenic/MT variant headline reads "Unknown Gene". Use the locus as the title instead.
- The quick chips "Rare (1%)" and "CADD >= 20" use ASCII `>=` while the active chip shows `AF ≤ 0.01%`. Use one notation.
- The AF filter `≤ 0.01%` includes variants with **no** gnomAD AF (MNVs with `--`). This is clinically defensible but should be explicit ("includes absent from gnomAD").
- Many MNVs appear with Impact HIGH and missense-like protein changes. This is probably a data/annotation issue, not UI, but worth checking in the importer.
- Gene Burden: "Run Analysis" is disabled without a reason, and the same case can be selected in both groups.
- Preferences: "Display Name, used for audit trail" duplicates the authenticated identity in web mode.
- At 390 px the Case/Cohort toggle loses its labels (it keeps aria-labels, which is good) and the chip wall wraps to 4 rows.

## 10. Provocative questions

1. If the Shortlist is the real product, why does the full table still default to an order no geneticist uses, and why can't the Shortlist be exported or bulk-classified?
2. Should a single click ever be allowed to change a variant's pathogenicity class in a tool whose disclaimer insists on independent verification?
3. What would the case view look like if it were designed around the **trio** (proband, mother, father genotypes side by side) instead of a single-sample GT column?
4. Web mode currently inherits desktop affordances (Worker Threads, Folder/ZIP import, Electron in About) and loses web essentials (logout, accounts, URLs). Is web a port, or a product?
5. Of the 18 equal-weight chips above the table, which three would Dr. Mara miss if the rest moved into the drawer?

---

## Appendix: steps not performed or limited

- **Claude in Chrome** was unavailable ("Browser extension is not connected", twice), so I used Playwright MCP throughout.
- **Real import:** I only opened the dialog. No files were uploaded, because the browser file picker and server write were out of scope.
- **Export:** I clicked it to observe behaviour, and it failed server-side. No file was produced.
- **Logout and admin/user management:** not testable, because no UI exists.
- **Dark theme in the app:** not testable, because there is no toggle and the app ignores the OS preference. The login dark mode was captured instead (a-52).
- **Screen reader:** not run with an actual AT. Accessible-name, focus and role findings come from DOM/ARIA inspection.
- **Contrast numbers:** approximate, from my own in-page calculation (not axe). The 38 %-alpha placeholder figure (~2.6:1) should be confirmed by Assessment B or the audit tool.
- **200 % zoom:** approximated through 720–1024 px viewport tests, not browser zoom.
- **Cohort search root cause:** not confirmed in code; observed only as "no request issued".
