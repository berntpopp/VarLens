# 02 — Case Workflow: Design & UX Assessment (Assessment A)

- **Date:** 2026-10-12 · **Build:** v0.83.0 (`bfd3d80e`), web runtime, Postgres, `http://127.0.0.1:8797`
- **Evaluator:** design-director walkthrough (Nielsen, cognitive load, clinical personas). This is one evaluator, so per schema §1.5 the scores still need a second evaluator before they are aggregated.
- **Scope:** login, disclaimer, app shell, home and case list, case switching, single-case variant table (cases 4 and 5, plus 7/8/9/10 for SV, CNV, STR and edge cases), shortlist, filtering (drawer, quick chips, DSL, presets, column filters), columns drawer, export, URL state, back/forward. Light and dark theme.
- **Dimensions scored:** D1, D2, D3, D9, D10, D11, D12, D13, D14 (schema `01-evaluation-schema.md`). D4–D8 belong to the technical agent. Where I saw obvious D4, D5, D6 or D8 issues, I list them for hand-off and leave them out of my scores.
- **Method:** headless Playwright (chromium) scripts in `~/.cache/varlens-session/uiux-1012/case-workflow/` (`s01`–`s32`). Viewports: 1440×900 (primary), 1920×1080, 1280×720, 390×844, and 720×450 (equivalent to 200 % zoom at 1440×900). Ground truth comes from paging `/api/variants/query` for each case (`truth-*.json`). Screenshots are in `screenshots/case-workflow/`.
- **Product-owner rule applied:** small text and controls are intentional. I judge legibility *at the shipped size* (font, weight, contrast, visual hierarchy, hit area through padding) and never recommend enlarging anything.
- **Labels:** **VERIFIED** = reproduced with a screenshot or measurement. **SUSPECTED** = from code reading only.
- **Shared environment:** other agents were changing shared data during the run (case 4 gained metadata "male, 7y, affected, Seizure", and new `audit-import-*` cases appeared). None of these changes affected the findings.

---

## 0. Headline

The case workflow is in a **much better state than on 2026-10-06**:

- All four P0s from the earlier audit in my area are fixed.
- Filtering returns correct results. Every known-answer task matched the ground truth exactly (§2).
- Export works, the URL carries case, tab, filter, search and sort, back/forward works, there is logout and a theme switch, the header is sticky, and sorting no longer blanks the table.

What remains is a **feedback and identity layer that sometimes contradicts the data**:

1. A DSL filter can be active while the bar says **"No filters applied"**.
2. A server error from a malformed DSL value is shown as **"No variants match your filters"**.
3. After browser Back, the **sidebar highlights a different case** than the one on screen.
4. At narrow widths, and at 200 % zoom, the responsive column budget **hides Chr, Position, Ref and Alt first**, so rows show only "ZNRF3 · MODIFIER".

None of these show wrong data. All four can lead a careful clinician to a wrong conclusion ("nothing passes", "I'm on case X", "which variant is this?"), so they are rated P1.

Visually, the product is still Vuetify-default with a dense, mostly competent table. The weak points are:

- Typographic hierarchy is inverted. The allele identity (Ref/Alt) is set in a hairline Courier New and is the faintest data on the row.
- A 16-target chip wall sits above the table.
- Each row repeats seven link and action icons.
- The red/orange ACMG palette puts VUS next to Pathogenic.

**Area score: 63.6 / 100** (needs work). No P0 cap applies. D13 on the case table is exactly 50 (P1 cap), so the "D13 < 50 caps the overall at 59" gate does not trigger.

---

## 1. Per-view scorecard

Band scores follow schema §1. Caps: an open P1 in a dimension caps it at 50.

| View | vw | D1 7 | D2 6 | D3 7 | D9 6 | D10 9 | D11 7 | D12 6 | D13 10 | D14 5 | View score |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Login + disclaimer | 3 | 75 | 100 | 100 | — | — | 75 | 100 | — | 75 | **87.5** |
| Home / case list / shell | 8 | 75 | 75 | 75 | 50 (P1 F3) | 75 | 75 | 75 | 75 | 50 | **70.6** |
| Case variant table (incl. shortlist, filters, chips, DSL, columns drawer) | 22 | 50 | 50 (P1 F4) | 50 | 50 (P1 F3) | 65 | 50 (P1 F1/F2) | 50 | 50 (P1 F2/F4) | 75 | **54.1** |
| Export | 5 | 75 | 75 | 75 | 100 | 75 | 100 | 75 | 75 | 75 | **80.2** |
| **Weighted (my area)** | 38 | | | | | | | | | | **63.6** |

How the dimension scores were derived (case table; sub-criteria a–e follow the schema text):

- **D1 = 50.** (a) Case identity and count read first: 75. (b) **Horizontal scroll at 1440**: the wrapper is 2032 px wide against 1150 px visible, so only 9 of 15 default columns show. 16 rows are visible at 1440×900 and 21 at 1920×1080 (target 25). At 1280×720, 11 rows and 8 columns show. (c) Grid: 75. (d) Grouping: 75. (e) Chrome competes with data: 25. There are 16 chips, 3 action icons per row and 2 link icons per row, so chrome is louder than data.
- **D2 = 50**, capped by P1 F4.
  - (a) Line height and size meet the product-owner rule.
  - (b) `tabular-nums` is applied on Position but not on gnomAD AF or CADD (`font-variant-numeric: normal`).
  - (c) HGVS is in monospace, but has defects (F11).
  - (d) Three font stacks: Roboto, ui-monospace and Courier New.
  - (f) Truncation uses an ellipsis. STR Position is truncated ("149,390,803…").
- **D3 = 50.**
  - The contrast sampler (schema 7.3) finds **0 text failures** on home, shortlist, filtered table and empty state, in both themes.
  - Active ACMG "LP" pill: #FF5722 on #FAFBFD measures about 3.0:1 in light theme (1 text failure).
  - Placeholder text measures about 2.4:1.
  - Semantic roles collide: VUS and P (F12).
- **D9 = 50.** Two clicks from home to the table, and per-route titles ("HG002-VEP-panel · Case · VarLens"). The case table loses the page index on reload and Back, and the sidebar highlight is wrong after Back (F3).
- **D10 = 65** (mean of a 75 / b 50 / c 100 / d 25 / e 75).
  - (a) The triage loop is keyboard-complete: ↑/↓, Enter, Esc, then s/c/a. Focus moves into the panel and back to the row.
  - (b) Presets apply in one click. However, the filter drawer **closes after every click** (F6), and DSL errors are not explained inline.
  - (c) Column visibility persists across reload.
  - (d) Bulk actions on variants are missing.
  - (e) The panel docks at 1440, but at 1280 it overlays the toolbar and the Gene column.
- **D11 = 50** (P1 F1, F2). The count pill, busy bar and export snackbar are good. Delete has a confirm with Cancel focused. The filter bar contradicts itself, and an error is shown as an empty result.
- **D12 = 50.** Esc does not close the drawers, contrary to the shortcut sheet. Chip labels differ depending on how a filter was set. There are 3 empty-value glyphs. ClinVar is humanised in the table but shown raw in the shortlist. Presets mix "≥" and ">=" notation.
- **D13 = 50.** All counts are correct (§2). IMPACT is shown under "Impact" and SO terms under "Consequence", not swapped. Against that:
  - HGVS display defects (F11).
  - Locus hidden at narrow widths (F4).
  - An error is shown as "No variants match" (F2).
  - The AF chip does not say that missing AF is included (F14).
  - Negative SV length (F15).
  - No genome build is shown next to HGVS.
- **D14 = 75.** The shortcut sheet is complete (except the wrong Esc claim). Preset tooltips and the Manage dialog describe each preset, including "or missing". "How the shortlist is built" explains pre-selection. The DSL placeholder has an example, and autocomplete exists. The empty state offers "Clear filters".

### Nielsen 10 heuristics (0–4), case-workflow area

| # | Heuristic | 10-06 | Now | Evidence |
|---|---|---|---|---|
| 1 | Visibility of system status | 2 | **2** | The count pill, busy bar without blanking, and URL are good. But "No filters applied" shows while a DSL filter is active (F1), and the sidebar highlights the wrong case after Back (F3). |
| 2 | Match with real world | 2 | **3** | The "Impact" header is now correct and consequences are humanised. Some raw tokens remain: `full_mutation`, shortlist `Uncertain_significance`, SV length −5000. |
| 3 | User control & freedom | 2 | **3** | Logout, back/forward, Clear all, Ctrl+Shift+X, and Esc on the panel. Esc does not close the drawers, and Clear also wipes sort. |
| 4 | Consistency & standards | 1 | **2** | The same filter gets two chip labels. Three empty glyphs. Three font stacks. Presets mix "≥" and ">=" notation. |
| 5 | Error prevention | 1 | **2** | Delete confirm with a safe default. Malformed DSL is still accepted as free text, and unknown fields are sent to the server. |
| 6 | Recognition rather than recall | 3 | **3** | Presets with tooltips, DSL autocomplete, labelled status icons. |
| 7 | Flexibility & efficiency | 3 | **3** | Shortcuts, DSL, presets and the column drawer. The drawer closes per click and there are no bulk actions. |
| 8 | Aesthetic & minimalist design | 2 | **2** | 16-chip wall, 7 icons per row, horizontal scroll at 1440. |
| 9 | Recognise, diagnose, recover from errors | 1 | **1** | A 400/500 is presented as "No variants match your filters". A parse error is only a red outline. |
| 10 | Help & documentation | 3 | **3** | FAQ, shortcut sheet, preset descriptions, shortlist explainer. |
| | **Total** | 20 | **24 / 40** | |

---

## 2. Data-integrity known-answer tasks (D13, weight 10)

Ground truth is every SNV row of the case fetched through the API (`s09-truth.js`), compared with the count the UI renders and with the values in the visible rows.

| # | Task (case) | Expected | UI result | Verdict |
|---|---|---|---|---|
| T1 | Preset "Rare (1%)" (4) | 75 with AF ≤ 0.01, +16 with missing AF = 91 | 91; every visible AF ≤ 0.01 or `--` | ✅ correct. Missing AF is included silently (see F14) |
| T2 | Search "MTMR3" (4) | 147 | 147; only MTMR3 rows | ✅ |
| T3 | DSL `gnomad_af:<:0.001` (4) | 52, +16 missing = 68 (`includeEmpty:true`) | 68 | ✅. But the bar says "No filters applied" (F1) |
| T4 | DSL `… AND gene:=:MTMR3` (4) | 10 | 10 | ✅ |
| T5 | Drawer Impact = MOD (4) | 15 | 15; all MODERATE | ✅ |
| T6 | Preset "HIGH Impact" (1) | 12 | 12; all HIGH | ✅ |
| T7 | Preset "HIGH Impact" (4; no HIGH variants) | 0 | Empty state, "Impact 1 selected" chip | ✅ |
| T8 | Export CSV with Impact = MODERATE (4) | 15 rows | 15 rows plus header; Impact and Consequence columns correctly named | ✅ |
| T9 | Out-of-order responses (odd responses delayed 1.2 s; MTMR3 then THOC5) | THOC5 only | THOC5, 107 | ✅ (prior P0-2 fixed) |
| T10 | Sort, all 12 sortable columns asc/desc | Monotone; aria-sort cycles asc → desc → none | All correct. Impact sorts by severity rank, chromosome order is natural | ✅ |

Clean. No silent exclusion and no wrong rows. This is the strongest part of the build.

---

## 3. Findings

### P1 (current milestone)

**F1 — An active DSL filter shows "No filters applied".** VERIFIED. View: case table. Dimensions: D11, D13.

- **What:** run `q=gnomad_af:<:0.001`. The count pill shows **68 / 1,585**, the Filters badge shows 1 and Clear is red, but the applied-filter bar reads *"No filters applied"*. The same happens for `… AND gene:=:MTMR3` (10 rows) and for every invalid DSL.
- **Why it matters:** the bar exists to say why rows are missing. A clinician trusting it would think 68 rows are the whole SNV set.
- **Evidence:** `screenshots/case-workflow/20-dsl-active-no-chip.png`.
- **Root cause (SUSPECTED):** `SlimFilterToolbar.vue:180-185` builds `activeFiltersList` only from structured filters. DSL rules land in `column_filters` and are never turned into chips.
- **Fix:** add one chip per DSL `column_filters` rule (for example "gnomAD AF < 0.001 (incl. missing)") with ✕ to remove it. Alternatively, show a single "DSL: <expr>" chip.

**F2 — A server error is presented as an empty result.** VERIFIED. View: case table. Dimensions: D11, D13.

- **What:** `q=foo:=:1` returns HTTP 500 and `q=gnomad_af:<:abc` returns HTTP 400. Both render the empty state *"No variants match your filters. Try adjusting…"*, with "No filters applied" above it.
- **Why it matters:** "0 of 1,585" after an error reads as "no variant passes". This is the HPO-501 pattern from the earlier audit, repeated in the core table.
- **Evidence:** `21-dsl-unknown-field-500.png`.
- **Root cause (SUSPECTED):** `VariantTable.vue:234` has a single empty template and no error branch. The DSL parser accepts unknown columns and non-numeric values for numeric fields (`dsl/parser.ts` validation against `FILTER_COLUMNS`).
- **Fix:**
  - Validate the column and the value type client-side. Unknown fields and non-numbers become parse errors, and no request is sent.
  - Add an error state ("Query failed — <userMessage>. Retry") that is visually distinct from "no matches" and occupies the same reserved height.

**F3 — The sidebar highlights the wrong case after browser Back.** VERIFIED. View: shell and case list. Dimension: D9.

- **What:** case 4 → click case 5 → browser Back. The table, h1, title and toolbar all show HG002-VEP-panel (case 4), but the sidebar still highlights **HG002-SnpEff** (case 5).
- **Why it matters:** two conflicting "where am I" signals while triaging related samples. This is the wrong-case risk named in D9's 0 band. The toolbar is correct, so a careful user can notice, which is why this is P1 and not P0.
- **Evidence:** `33-back-sidebar-highlight.png`.
- **Root cause:** `components/CaseList.vue:205` `selected` is local state written only by clicks (`watch(selected)` at :367 emits outward). Nothing syncs it from the URL-driven `selectedCaseId`.
- **Fix:** take `selectedCaseId` as a prop and `watch` it to set `selected = [id]`. Add an E2E test: back/forward, then assert `.v-list-item--active` equals the h1 case.

**F4 — The responsive column budget hides the variant's identity first.** VERIFIED. View: case table. Dimensions: D2, D13 (D8 hand-off).

- **What:**
  - At 390×844 the only data column left is Gene (Impact is the second, partly visible).
  - At 720×450 (= 200 % zoom at 1440×900) the columns are Gene, Impact, ClinVar and gnomAD AF. **Chr, Position, Ref, Alt and GT are gone**, so consecutive rows read "ZNRF3 · MODIFIER" and cannot be told apart.
  - At 720×450 the page cannot scroll (scrollHeight = 450). Only 3 rows show, and the pagination footer is out of view (WCAG 1.4.10).
- **Evidence:** `60-snv-390x844.png`, `60-snv-720x450.png`.
- **Root cause:** `utils/responsive-layout.ts:51-75` `COLUMN_PRIORITY` ranks gene, consequence, clinvar, gnomad_af and cadd (1–5) above chr, pos, ref and alt (8–11). The fixed-height layout in `CaseView.vue` adds to the problem.
- **Fix:**
  - Rank `chr`/`pos` as 1–2 and `ref`/`alt` as 3–4. Better: collapse them into one compact "Locus" cell (`22:29,001,799 T>TTATC`) that is never auto-hidden, the same as `annotations` in `ALWAYS_SHOWN_COLUMNS`.
  - Let the page scroll when the viewport is shorter than about 600 px.

**F5 — (D6 hand-off) Opening and closing the details panel at 1440 shifts the table.** VERIFIED. CLS-obs, including input-adjacent shifts:

| Viewport | Open | Close |
|---|---|---|
| 1440×900 | **0.208** | **0.306** |
| 1920×1080 | 0.0076 | 0.0067 |
| 1280×720 | 0.0065 | not measured |

Cause: the toolbar loses about 400 px, the preset chip row wraps to 2 lines, and the table moves down 22 px (`11-details-open.png`). This is outside the interaction gate (≤ 0.02).

- **Fix:** keep the chip row on one line (horizontal slide-group, or overflow into a "More presets" menu) at every toolbar width. No wrap means no shift.

### P2 (backlog, next two milestones)

**F6 — The filter drawer closes after every filter click, and Esc closes neither drawer.** VERIFIED.

- Clicking Impact HIGH/MOD/LOW, a Frequency preset (≤ 1 %) or a preset inside "All Filters" applies the filter **and closes the drawer**. This happens with Playwright's `click()` and with raw mouse down/up (`s14-drawer3.js`).
- Building "MOD + LOW + ≤ 0.1 % + ClinVar" therefore costs four drawer reopens, which defeats the drawer's purpose (it even has a "Done" button).
- **Esc does not close** the filter drawer or the columns drawer, while the shortcut sheet promises "Escape: Close drawer / blur search" (STILL OPEN from 10-06).
- **Root cause (SUSPECTED):** `FilterDrawerShell.vue:2-8` is a `temporary` `v-navigation-drawer`. The re-render of the clicked chip makes Vuetify's click-outside treat the click as outside.
- **Fix:** non-temporary (persistent) drawer without scrim, so results update visibly. Add `@keydown.esc` handling, or put the drawer in an overlay that has it.

**F7 — DSL error feedback.** VERIFIED.

- `gene = "BRCA1" AND (af < 0.01 OR` is still taken as free-text search, 0 rows, no error (STILL OPEN).
- Real parse errors (`gnomad_af:<<:0.01`, `(gene:=:MTMR3`) only turn the field outline red. The message exists in a hover-only tooltip (`DslSearchBar.vue:87-90`).
- The input is about 130 px wide at 1440, so typed expressions scroll out of view (`22-dsl-parse-error-hover.png`).
- **Fix:**
  - Show the parse message inline below the field, using the reserved applied-filter row, with the error position underlined.
  - Treat input containing `:`, `(` or an operator as DSL and report errors rather than falling back to search.
  - Let the field grow on focus (overlaying the ACMG pills) instead of keeping a fixed width.

**F8 — Default columns do not fit at 1440.** VERIFIED.

- The wrapper is 2032 px wide against 1150 px visible. CADD, Consequence, Transcript, cDNA and AA Change are off-screen. SV, CNV and STR tables are 1962–1994 px wide.
- Both Chr and Position cells carry a link-out icon on every row, which spends about 40 px per row on chrome.
- **Fix:** move the per-cell link-outs into the existing "Links" or hover affordance. Merge Chr+Pos+Ref+Alt into the "Locus" cell (F4). Show Transcript inside the cDNA cell (they repeat). This gets the default set to about 1150 px.

**F9 — Sticky header: the left sticky columns are painted over by body rows when scrolled.** VERIFIED.

- Vertical scroll fixes the header row (prior defect fixed), but the ★/Chr header cells disappear behind body cells (`09-sticky-scrolled.png`, `10-hscroll-right.png`).
- **Root cause (SUSPECTED):** `components/data-table-shared.css:189-212`. The `th:first-child`/`th:nth-child(2)` left-sticky rules set `position: sticky; left: …` without `top: 0`, so those header cells do not stick vertically.
- **Fix:** add `top: 0` to the two `th` rules (z-index 3 is already higher than td 2).

**F10 — Inverted typographic weight: the allele identity is the faintest data.** VERIFIED (`07-row-zoom.png`).

- Ref, Alt and Transcript use `"Courier New", monospace` at 11.9 px. Position uses `ui-monospace` at 13 px and cDNA uses `ui-monospace`.
- Courier New is a hairline face, so `T>TTATC` reads as light grey even though its colour is the same 87 % ink as the rest of the row. The **size is fine**; the **face and weight** are the problem.
- There are three font stacks per row (Roboto, ui-monospace, Courier New).
- **Fix:** keep the size and use the same `ui-monospace` stack as Position at weight 500 for Ref and Alt. Drop Courier New. Data becomes loud and chrome stays quiet.

**F11 — HGVS rendering defects.** VERIFIED.

- **(a)** AA Change shows URL-encoded synonymous notation, for example `ENSP00000215790.8:p.Val74%3D` (14 rows in case 4; raw VEP encoding). Decode `%3D` to `=` at import or display.
- **(b)** The shortlist prefixes "c." and "p." onto values that already contain transcript and prefix: `c.ENST00000401950.7:c.2446G>A`, `p.ENSP00000384651.3:p.Ala816Thr` (`71-shortlist-case4.png`).
- **(c)** The details header shows `ENST00000544604:ENST00000544604.7:c.426+17130A` (transcript twice, value clipped).
- **(d)** No genome build appears next to any HGVS string or locus (R06 C6).
- **Fix:** one `formatHgvs(transcript, value)` in `utils/formatters.ts` that strips an existing `ENST…:` / `c.` prefix and is used in the table, shortlist and panel. Show "GRCh38" once in the case strip.

**F12 — ACMG and ClinVar colour semantics put VUS next to Pathogenic.** VERIFIED (sampled computed colours; ΔE00 with `de.py` and Machado-2009 simulation).

- `utils/filters/constants.ts:12-18` defines P = `error` #B71C1C, LP = `deep-orange` #FF5722, VUS = `warning` #BF360C, LB = blue-grey #607D8B, B = `success` #1B5E20.
- Light theme measurements:

  | Pair | Normal vision | Deuteranopia | Protanopia |
  |---|---|---|---|
  | P–VUS | **7.7** (below the 20 pass line) | 4.6 | — |
  | P–B | — | — | 5.2 |
  | VUS–B | — | — | 3.1 |

- The LP chip is brighter than VUS, so the lightness order is not monotonic.
- The same `warning` colour gives the ClinVar "Uncertain significance" chip a red-orange that reads as "danger".
- Text labels keep this out of P1 (`52-acmg-pills-protanopia-light.png`: P, VUS and B are all olive).
- The LP pill text is about 3.0:1 on the light surface when active.
- **Fix:** a monotonic scale. P = dark red, LP = lighter red, VUS = neutral amber or grey with an outline style, LB = light teal, B = teal or dark green. Check every adjacent pair is ≥ 10 under protan and deutan simulation, and that LP text is ≥ 4.5:1.

**F13 — Sort counts as a filter.** VERIFIED (STILL OPEN). After a sort only, "Clear" turns red while the bar says "No filters applied". Ctrl+Shift+X also resets the sort.

- **Fix:** separate "Reset sort" (in the header) from "Clear filters".

**F14 — Filter chips are imprecise.** VERIFIED.

- The same Impact filter shows "Impact MODERATE" when set in the drawer, but "Impact 1 selected" when set by preset or URL (`26-drawer-moderate.png` vs `50-snv-dark.png`).
- The AF chip says "AF ≤ 1.00%" while the result includes the 16 variants with missing AF. Only the preset tooltip says "or missing".
- **Fix:** chips always state their values. Append "incl. missing" when `includeEmpty`.

**F15 — Raw or inconsistent value formatting.** VERIFIED.

- Three empty glyphs: `--` (table), `- -` (Gene cell, mono letter-spaced) and `—` (shortlist AF).
- SV Length `-5000` (signed SVLEN) and End `1005000` without separators, next to Position `1,000,000`. CNV Length `500000`.
- STR Status `full_mutation`.
- Consequence humanisation is inconsistent: `Upstream` / `Intergenic` / `NC Exon` next to `intron variant&non coding…` and `3 prime UTR variant`.
- The shortlist shows ClinVar as `Uncertain_significance` while the table shows "Uncertain significance".
- Notation mixes ASCII `>=`/`<=` in chips and drawer with `≤` in the applied chip.
- **Fix:** route all cells through `utils/formatters.ts`, with one `EMPTY = '—'`, abs + kb/Mb for lengths, thousands separators for all coordinates, an SO-term label map applied per `&`-split term, and Unicode ≤/≥ everywhere.

**F16 — (D5 hand-off) In dark theme the app bar and sidebar header are a bright #7BAED4 block with dark text.** VERIFIED (`04-home-dark.png`, `50-snv-dark.png`). It is the largest and brightest area on a dark screen, which causes glare.

- **Fix:** dark app bar on an elevated surface (about #1E2530) with the light-blue accent only on the active mode toggle.

**F17 — The Impact filter cannot express MODIFIER or "missing".** VERIFIED.

- The drawer offers HIGH / MOD / LOW only. In case 4, 1,534 variants are MODIFIER and 14 have no impact; neither can be filtered on directly.
- **Fix:** add MODIFIER and "(missing)" options.

**F18 — The page index is not part of URL state.** VERIFIED. Reload or Back from another case returns to page 1 ("26-50 of 91" becomes "1-25 of 91").

- **Fix:** add `&page=` to `useUrlState` as a `replace` step.

**F19 — The empty state is centred on the 2032 px table, not the viewport.** VERIFIED (STILL OPEN). The text is clipped: "…or clearing all filt" (`21-…png`, `50-empty-dark.png`).

- **Fix:** use a sticky-left empty block the width of the wrapper.

**F20 — Ctrl+click in the case list also opens the clicked case**, in addition to adding it to the multi-selection. VERIFIED (`38-multiselect.png`: gate-case-b opened). No bulk-action bar is visible for the 2 selected cases.

### P3 (opportunistic)

- **F21 Login** (STILL OPEN): after a wrong password, focus goes to `<body>` and the card moves up 29.5 px (201.75 → 172.25) when the alert is inserted.
  - **Fix:** focus the alert or the username field, and reserve the alert slot.
- **F22 Disclaimer** (STILL OPEN): inner scrollbar, a thick focus outline around the whole card, and a small CTA on a thin footer bar (`03-disclaimer-dark.png`).
- **F23 Shell:**
  - The case-list ⓘ "Case list help" opens nothing on click (hover-only tooltip).
  - The "VarLens Web" menu shows only `web:postgres`.
  - "All cases loaded" footer is noise (STILL OPEN).
  - The case list has no sort control.
- **F24 Columns drawer:** checkboxes have no accessible name (`getByRole('checkbox', {name:'Transcript'})` finds 0). Reorder appears to be drag-only (SUSPECTED; WCAG 2.5.7 needs an alternative such as move up/down).
- **F25 Hit areas:** preset chips render 18 px tall and sort buttons 20 px, with 4 px gaps.
  - Per the product-owner rule, **do not enlarge the visuals**. Extend the hit area to 24 px with transparent padding or `::after` (2.5.8 spacing), keeping the visual chip at 18 px.
- **F26 Placeholder:** text at 0.38 opacity is about 2.4:1. It carries an instruction ("Gene, chr:pos, or filter expression").
  - **Fix:** use the 0.6-emphasis token. The size stays.
- **F27 Irrelevant presets on non-SNV tabs:** AF, CADD and ClinVar presets show on SV, CNV and STR tabs, where those columns do not exist.
- **F28 No sanity check on imported values:** gate-case-a has `gnomad_af = 40` (impossible) and ClinVar codes `"1"`/`"2"`, both shown raw. This is a fixture artefact, but the UI should flag AF outside 0–1.
- **F29 Shortlist:**
  - 57 px rows (3-line variant cell).
  - The table is 1322 px wide against a 1150 px wrapper, so the Links column is clipped at 1440.
  - The ClinVar text overlaps the ★ column.
- **F30 Accessibility details:** `v-autocomplete__menu-icon` has `role=button` plus `aria-hidden` (the one unnamed "button"). The Tab order includes the non-interactive toolbar title "VarLens" and the case-name span.

---

## 4. Status of prior findings (2026-10-06) in this area

**FIXED (22):**

| Finding | Status / evidence |
|---|---|
| P0-1 same-locus rows | Rows are keyed by `variant.id` (`useVariantRenderRows.ts:20-47`, `item-value="rowKey"`). Code-verified; the fixtures have no same-locus pairs. |
| P0-2 stale results | T9 |
| P0-3 Cohort → case skeleton | The sidebar is off-canvas in cohort mode, so the path is gone. Returning to Case restores case 4 with its rows. |
| P0-5 "0-NaN of NaN" | Clear goes 107 → 1585 cleanly. |
| Default order ignores chromosome | `postgres-variant-order.ts` chr_rank; natural order seen in SV and STR |
| Sort blanks the table | Rows are kept and a busy bar shows. CLS 0 on all 24 sorts. |
| Column re-flow after sort | Fixed |
| Filter row pushes the table | The reserved "No filters applied" row; CLS 0 on filter apply |
| Header scrolls away | th top = wrapper top. New defect F9. |
| "Consequence" header showed IMPACT | Header now reads "Impact" |
| Shortlist telemetry | Now "Top 3 of 3 pre-selected candidates" with an explainer tooltip |
| Tab focus theft into DSL suggestions | Fixed |
| Export failing on Postgres | CSV and XLSX menu with counts; the CSV was correct (T8) |
| No URL state | case, tab, f, q and sort are in the URL. The page index is still missing (F18). |
| Sidebar auto-collapses on case open | Fixed |
| "? ?" status glyphs | Icons only when known; aria-labels such as "Affected status unknown, Sex unknown" |
| Unnamed icon buttons | 1 left (F30) |
| Dark theme unreachable | Follows the OS; Theme System/Light/Dark in the account menu |
| No logout or user admin | The account menu has Change password, User management, Theme and Sign out |
| Preset chips were divs | Now `role=button` with aria-label "Filter preset: …" |
| Clipped case-details ⓘ | Fixed |
| Sidebar shows "No database" flash | Not reproduced |

**STILL OPEN (17):**

- Malformed DSL taken as free text (F7)
- Empty state off-centre (F19)
- Three empty glyphs (F15)
- Three font stacks (F10)
- Esc does not close the Columns drawer (F6; the filter drawer too)
- The filter drawer is a temporary overlay you cannot watch results through (F6, now worse because it closes per click)
- "All cases loaded" (F23)
- Clear lights up after a sort and Ctrl+Shift+X resets the sort (F13)
- `>=` vs `≤` (F15)
- AF chip does not say missing AF is included (F14)
- Login focus and card jump (F21)
- Disclaimer scroll and focus ring (F22)
- "VarLens Web" menu shows only web:postgres (F23)
- Row action icons always at full opacity
- Faint selected-row tint
- Shortlist 57 px rows (F29)
- ClinVar shown raw in the shortlist (F15)
- 18 equal-weight chip targets (partly fixed; now 16)

**REGRESSED:** none.

**NEW:** F1, F2, F3, F4, F5, F6 (close-per-click), F9, F11, F12, F17, F18, F20.

---

## 5. Design-director critique (qualitative)

**Hierarchy.** The case strip (name · sex/age/affected · HPO chip) is now a clear anchor, and the h1 and route titles are right. Below it, three bands compete before the first row: the search and ACMG pill row, the count and actions, and the 9-chip preset wall. The applied-filter row adds a fourth band at 1440, which puts the first row at y = 289 px.

The data is quieter than the chrome:

- every row has ☆ ☑ 💬 plus 2 link-out icons;
- the inactive sort and filter glyphs repeat in every header;
- the alleles are the faintest text on the row.

Invert this. Make Locus, Gene and HGVS the loud ink, and show icons at reduced emphasis until hover or focus, or when set.

**Density.** The 36 px rows are right for operate mode. The table wastes width on per-cell link icons and on Transcript repeated in cDNA, not on row height.

**Typography.** Roboto with a monospace face for coordinates is fine. Standardise on one monospace face (ui-monospace 500) and put `tabular-nums` on AF and CADD so decimals align. Courier New is the single biggest legibility problem, and it can be fixed without touching size.

**Colour.** Impact is plain text everywhere in the table: HIGH and MODIFIER look the same. ClinVar is a coloured chip. ACMG uses a red/orange family where VUS is darker than LP. A small, monotonic, CVD-safe semantic scale used in the same way in table, chips and panel would do more than any polish pass. The light theme's warm-grey surfaces (#F0F4F8 page, #FAFBFD table) are calm. In dark theme, the body and tables are well tuned (#12141A, 90 % text), but the light-blue app bar breaks it (F16).

**Personas.**

- **Dr. Mara (clinical geneticist):** the filter results are now trustworthy, which is the big change. Her remaining risks are the "No filters applied" lie (F1), an error that looks like "nothing passes" (F2) and a sidebar pointing at the wrong sample after Back (F3).
- **Alex (power user):** gets a complete keyboard loop, DSL and URL state. Alex loses time to the drawer closing on every chip and to Esc not closing drawers.
- **Sam (200 % zoom):** loses the variant identity entirely at 200 % zoom (F4), and cannot reach pagination at that size.

---

## 6. Not done / limits

- I did not star, comment, classify, save presets or delete. Dialogs were opened and cancelled, so shared data was not changed by me.
- The XLSX download was not opened; only the CSV was checked.
- Column drag-reorder could not be driven by headless mouse events (SortableJS), so 2.5.7 is SUSPECTED.
- Cohort-view parity (D12a) was not tested here; the cohort agent owns it.
- D4–D8 were not scored. The items in F5, F12 and F16 are hand-offs.
- Screen readers were not used; accessibility evidence is DOM/ARIA only.
