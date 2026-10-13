# 02 — Re-audit, Assessment B (technical): detector, a11y, perf, stability, colour

- **Date:** 2026-10-12 (evening) · **Build:** `origin/main @ 1d9c2d6c` (v0.84.0; audit PRs #588 #592 #593 #594 #598 merged) · web on `127.0.0.1:8832` (gate server, schema `reaudit_tech_*`, now dropped) + Electron 43 production build (`out/`).
- **Same method as baseline `05` / `06`:** the same scripts, copied and pointed at the new worktree (`~/.cache/varlens-session/uiux-1012/reaudit/tech/`). The data is seeded the same way (3 gate JSON cases + HG002 VEP/SnpEff, the trio proband, SV, CNV, STR and edge cases; all VCFs imported with `genomeBuild: 'GRCh38'`; case 4 = HG002-VEP-panel). The run used 1440×900, 75 ms `/api` latency, 1× CPU (3 rounds) and 4× CPU (2 rounds), plus mobile 390×844. Lighthouse 13 ran as user flows, median of 3, with the desktop and mobile presets. axe-core 4.x used the CI tag set. Schema snippets 7.1/7.2/7.3 were used, with colorjs.io for ΔE2000 and APCA.
- **Difference from the baseline:** I enabled the *protein*, *gnomAD* and *VEP* lookups as admin on my own throwaway server. Only gene symbols and public GIAB coordinates are sent. With that, the **lollipop and Mol\* 3D views were rendered and measured for the first time** (the baseline could only compute them from source).
- **Raw data:** `reaudit/tech/data/` (axe, contrast and detector per state × theme; `technical-cls-*`, `technical-palette.json`, `technical-typography-apca.json`, `technical-keyboard.json`, `technical-misc.json`, `technical-fonts.json`), `reaudit/tech/lh/summary-*.json`, `reaudit/tech/shots/`, `reaudit/tech/electron/{electron-results.json,shots/}`.
- **Product-owner rules applied:** dense UI is intentional, so size is never scored. Legibility is judged by contrast, APCA and font.
- **Scope:** D2–D8 per view (this assessment's dimensions), plus the desktop items in the brief. The design agent's `01-design.md` did not exist when I finished, so **only B is reported**. The combined number has to be computed later with the formula in §8.

---

## 0. Headline (baseline → now)

| Metric | Baseline (05/06, 2026-10-12 am) | Now |
|---|---|---|
| Detail-panel open / close CLS incl. input (desktop web) | **0.208 / 0.306** | **0.0126 / 0.0147** |
| Same, Electron | 0.200 / 0.306 | 0.0129 / 0.0147 |
| Mobile filter / preset / DSL CLS | 0.18 | 0.0001–0.0011 |
| Navigation CLS (LH desktop median): case / cohort / home | 0.040 / 0.093 / 0.013 | **0.0168 / 0.0191 / 0.0084** |
| Mobile nav CLS case table | 0.132 | 0.056 |
| Deep-link initial-load CLS | 0.033 | 0.0156 |
| App-bar focus ring contrast (9 stops) | **1.00:1** | **11.5:1** light / 9.9:1 dark |
| axe serious/critical, baseline's 11 states × 2 themes | 2 states failing (columns drawer 26 critical, filter drawer 3) | **0 in all 22**. New states: import review 5 (light) / 3 (dark), protein modal 1, 3D dark 1 |
| Contrast sampler text failures, same states | T-01…T-05: 36 in the ACMG grid, score chips at 1.81, ClinVar grey at 2.35 | **0** in 20 of 22. Details panel 1 (`--` at 4.2 on the selected row) |
| `error` vs `warning` ΔE00 (normal / deutan) | 7.4 / 4.6 | **24.0 / 12.5** |
| ClinVar lollipop LP vs LB under deuteranopia | **2.5** (red/green only) | ≥ 10 for every pair. The scale is now the ACMG palette |
| Theme flash, dark OS: login → app | light → light → dark | **dark throughout** (login `#12141A`, first app frame dark) |
| Electron launch with dark preference | light splash `#F0F4F8` | boot `rgb(18,20,26)` |
| Electron `renderer-interactive` | 343–428 ms | **228–276 ms** (3 launches) |
| LH desktop Perf / A11y / BP (login, home, case, cohort) | 1.00 / 0.99 / 1.00 / 0.98 · 1 · 1 | 1.00 / 0.98 / 1.00 / 1.00 · 1 · 1 |
| INP 1× (sort, page, filter, select, panel) | 16–54 ms | 16–40 ms |
| Technical sub-score (vw-weighted) | **≈ 66** | **≈ 76.5** (see §7) |

---

## 1. Deterministic detector (impeccable)

**Static CLI**

| Target | Exit | Findings | Triage |
|---|---|---|---|
| `src/renderer/src` | **2** (baseline 0) | `overused-font` ×2, `fonts.css:6,34` ("Inter") | **False positive under the brief.** Inter + JetBrains Mono are the bundled type system recommended in `07`. The detector's slop rule does not know that the brief chose them. No action needed. |
| `src/web` | 0 | advisory `gpt-thin-border-wide-shadow` on `login/login.html` (1 px border + 16 px blur) | **REGRESSED P3.** It was gone at baseline, and the theme/dark-login rework brought it back. Pick one: an edge or an elevation. |

No `impeccable-disable` comments and no `.impeccable/config.json`, so nothing is suppressed.

**Browser `detect.js`** (visible elements, light theme):

| Rule | Counts |
|---|---|
| layout-transition | home 27 · case 45 · details 55 · filter drawer 81 · cohort 42 |
| tiny / undersized text | case 12/4 · details 12/7 · filter drawer 12/12 |
| text-occlusion | filter drawer 103 |
| clipped-overflow | 1–7 |
| nested / edge-flush cards | 1–2 |
| **low-contrast** | **0** (baseline 2) |
| overused-font | 0 |

- **layout-transition:** Vuetify internals, false positive.
- **tiny / undersized text:** PO rule, not a defect.
- **text-occlusion:** the scrim, false positive.
- **clipped-overflow:** scroll containers.

**Verdict:** the deterministic layer is clean. The only true positive is the returned login advisory.

---

## 2. Accessibility: axe WCAG 2.2 A/AA (serious + critical nodes)

| State | Light | Dark | Baseline (L/D) |
|---|---|---|---|
| login | 0 | 0 | 0 / 0 |
| home | 0 | 0 | 0 / 0 |
| case-table | 0 | 0 | 0 / 0 |
| details-panel | 0 | 0 | 0 / 0 |
| filter-drawer | **0** | 0 | 3 color-contrast / 0 → **FIXED** |
| columns-drawer | **0** | **0** | 26 label (critical) + 2 aria-conditional-attr → **FIXED** |
| acmg-dialog | 0 | 0 | 0 / 0 |
| cohort | 0 | 0 | 0 / 0 |
| settings (preferences) | 0 | 0 | 0 / 0 |
| import-dialog (select step) | 0 | 0 | 0 / 0 |
| **import review / genome-build confirm (new state)** | **label ×1 (critical), aria-progressbar-name ×2, color-contrast ×2** | label ×1, aria-progressbar-name ×2 | not measured |
| **protein modal: lollipop (rendered, new)** | aria-required-attr ×1 (critical) | same | baseline only saw the "unavailable" dialog |
| **protein modal: 3D (rendered, new)** | 0 | color-contrast ×1 | not measured |

**New failures (VERIFIED, `data/technical-axe-import-preview-*.json`, `…protein-*.json`):**

- **A-11 (P2), import review step.**
  - The per-file variant-type `v-select` (the box showing "SN…") has no accessible name. axe `label`, critical, `#input-v-1-0-24`.
  - The import-status ring in the app bar ("1/1 (100%)") and the linear progress bar have no name (`aria-progressbar-name`).
  - The "Genome build" radio legend and its hint ("Contig lengths match GRCh38 …") are **4.43:1** on `#F0F4F8`, which is medium-emphasis on the dialog's background colour rather than on surface.
  - The "Unknown caller" chip is `grey` at **2.59:1** (contrast sampler).
  - These sit on the new build-confirmation step, a core import path. Screenshot: `shots/state-import-preview-light.png`.
- **A-12 (P2), protein modal.**
  - The "Find variant, position or domain" field renders a `v-field` with `role="combobox"` but without `aria-expanded` / `aria-controls` (axe `aria-required-attr`, critical, both themes).
  - Dark theme: the header chips "473 aa" / "Q96MU8" and the tab labels are white on `#90A4AE`, **2.59:1**.
  - Dark 3D toolbar: the inactive "Surface" / "Ball+Stick" buttons are **2.14:1**, and the "AlphaFold v6" chip is 2.32:1.
- **CI gate scope.** The UI gate still covers 5 states, and the two new failing states (import review, protein modal) are outside it, exactly as the drawers were this morning. Add `import-review` and `protein-modal` to `GATE_STATES`.

---

## 3. Lighthouse 13 (median of 3)

| Step | Desk Perf | A11y | BP | LCP ms | CLS | TBT | INP | Mob Perf | Mob LCP | Mob CLS | Mob TBT | Mob INP |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nav login | 1.00 | 1 | 1 | 241 | 0 | 0 | — | 1.00 | 901 | 0 | 0 | — |
| nav home | 0.98 | 1 | 1 | 1057 | 0.0084 | 0 | — | **0.75** | **4960** | 0.051 | 49 | — |
| nav case table | 1.00 | 1 | 1 | 436 | **0.0168** | 0 | — | 0.97 | 1688 | 0.056 | 156 | — |
| nav cohort | 1.00 | 1 | 1 | 389 | **0.0191** | 13 | — | 0.97 | 1588 | 0.0064 | 180 | — |
| ts sort | 1.00 | — | 1 | — | 0 | 0 | 30 | 1.00 | — | 0.0005 | 13 | 74 |
| ts page | 1.00 | — | 1 | — | 0.0001 | 0 | 55 | 1.00 | — | 0.0005 | 56 | 128 |
| ts open details | 1.00 | — | 1 | — | 0.0085 | 0 | 25 | (no row click target at 390 px, as in the baseline) | | | | |
| ts filter (HIGH Impact) | 1.00 | — | 1 | — | 0.0017 | 0 | 36 | 1.00 | — | 0.001 | 25 | 100 |
| ts switch case | 1.00 | — | 1 | — | 0.0004 | 0 | 56 | 0.98 | — | 0.0018 | 130 | 196 |

**Against the baseline:**

- Navigation CLS for case and cohort is now inside the 0.02 budget, but with little headroom: 0.0168 and 0.0191.
- The remaining navigation culprit on all pages is the sidebar `v-infinite-scroll__side` loader. It jumps from y 233 to y 745 (0.0081–0.0108), the same as S-04 in the baseline. The preset `v-slide-group` adds 0.0063–0.0083.
- Mobile home is slightly worse: Perf 0.79 → **0.75**, LCP 4.51 → 4.96 s. Render-blocking went from 40 ms to **120 ms**, which fits the newly bundled webfonts (see §4.3). Mobile is not a gate. **P3, Y-03.**
- `unused-javascript` 154 KiB and `legacy-javascript` 16–18 KiB are unchanged.

---

## 4. Visual stability and flicker

### 4.1 Per-interaction CLS including input-adjacent shifts (1440×900, 75 ms latency; 1× median of 3 / 4× median of 2)

| Interaction | CLS incl. input | Baseline | INP 1× | INP 4× | LoAF max (4×) | Busy indicator / flicker |
|---|---|---|---|---|---|---|
| Initial load (deep link) | 0.0156 | 0.033 | — | — | — | skeleton **100 + 117 ms** (still two blinks), progress 33–50 ms |
| Sort Gene asc / desc | 0 / 0 | 0 / 0 | 16 / 16 | 80 / 56 | 94 | none |
| Next / previous page | 0.0001 | 0 | 40 / 32 | 136 / 144 | 137 | none |
| Preset "Rare (1%)" on / off | 0.001 | 0.001 | 16 | 56 / 40 | 96 | none |
| Preset "CADD ≥ 20" on / off | 0.0009 | 0.0009 | 16 | 64 / 40 | 58 | none |
| DSL search / clear | 0.0014 / 0.0012 | 0.0011 | 24 / 16 | 96 / 64 | 89 | none at 1×. At 4×: progress 383 ms, body dimmed 19 frames (intended stale-while-loading) |
| **Open details panel** | **0.0126** | **0.208** | 16 | 72 | 135 | panel skeleton 34–50 ms (sub-300 ms flash, S-03 still open) |
| Next variant (↓) | 0 | 0 | 16 | 56 | 123 | none |
| **Close details panel** | **0.0147** | **0.306** | 24 | 128 | 116 | — |
| Switch case | 0.0004 | 0.0025 | 40 | 168 | 153 | skeleton 117 ms, progress 484 ms (4×) |
| Open cohort | 0.0064 | 0.0065 | 16 | 32 | 183 | "Loading items" + progress 116 ms (sub-300 ms flash, still open) |
| Back to case | 0 | 0 | 16 | 40 | 100 | none |
| Open protein modal (now the real lollipop) | 0.0012 | 0.013 ("unavailable" dialog) | 16 | 32 | 154 | skeleton 100–134 ms |
| Theme toggle dark / light | 0 / 0 | 0 / 0 | 72 / 64 | **304 / 248** | 269 | no flash |
| **Mobile** (390×844): sort, page, preset, DSL | ≤ 0.0011 | **0.18** | 16–24 | — | — | none |

- **S-01 (P1) is FIXED.** The preset row now sits in a non-wrapping slide group (`state-details-panel-light.png`: the chips scroll, with arrows), so opening the panel no longer moves the table. What is left of the 0.013 is the panel's own sections settling.
- **S-02 is FIXED** on mobile.
- **P-01, theme toggle at 4× CPU:** INP rose from 208–216 to **248–304 ms**, and the LoAF is 269 ms. At 1× it is 64–72 ms, as before. **Slightly REGRESSED.** It stays P3, because it is a rare, user-initiated action.

### 4.2 Flicker catalogue

| # | Item | Status |
|---|---|---|
| 1 | Table → skeleton → table on sort, page, filter or search | still **FIXED**: 0 frames in 3 × 10 interactions |
| 2 | Details-panel skeleton 34–50 ms | **STILL OPEN** (P3) |
| 3 | Cohort "Loading items" + progress bar ≈ 116 ms | **STILL OPEN** (P3) |
| 4 | Deep link shows "Welcome / Select a case" before the case | not re-filmed; the initial-load sampler still shows minRows 0 → skeleton. Treat as STILL OPEN (P3). |
| 5 | Initial skeleton double blink (100 ms + 117 ms) | **STILL OPEN** (P3) |
| 6 | Dark-OS theme flash, login → app | **FIXED**: `samples` = login `rgb(18,20,26)`, then `html/body` and `.v-application` dark from the first sample (30 ms) |

### 4.3 Font load (new check)

- Inter Variable (`font-display: swap`) loads at 117–147 ms, at the same time as the first shift (0.0091, sidebar loader plus the app-bar `v-btn-group`). Most of that shift comes from the loader. The `Inter Fallback` metric-override face keeps the swap shift small.
- **JetBrains Mono Variable uses `font-display: block`** and loads at 224–311 ms. Ref, Alt, Position and HGVS text is therefore **invisible for up to ≈ 300 ms** on a cold load (FOIT). This is data, not chrome. **P3, Y-02:** use `swap` with a metric-matched fallback, as Inter already does.
- The login page uses the system stack rather than Inter, a small mismatch between login and app (P3).

---

## 5. Colour

### 5.1 Tokens (`plugins/vuetify.ts`, `shared/config/domain.config.ts` `SEMANTIC_COLORS`)

| Pair | Light WCAG / APCA | Dark WCAG / APCA | Baseline dark |
|---|---|---|---|
| on-surface / surface | 16.3 / 101 | 13.6 / −90 | same |
| muted / surface | 5.84 / 78 | 8.32 / −61 | 7.04 / −53 |
| primary / surface | 11.1 / 94 | 9.2 / −66.5 | 7.12 / −54 |
| error / warning on surface | 8.73 / 5.24 | 7.45 / 11.7 | — |
| app bar text on app bar | 11.5 (white on `#1E3A5F`) | 9.94 (`#E4E7EC` on `#30353E`) | 7.8 on bright `#7BAED4` |

- **E-02 is FIXED.** The dark app bar is a calm `surface-bright` `#30353E` with its own `app-bar` / `on-app-bar` tokens.
- **Residual (STILL OPEN, P2, renamed E-02b):** the **sidebar "Cases (10)" header in dark** is still a bright light-blue band about 280×48 px (`state-details-panel-dark.png`). Give it the same `app-bar` token.

### 5.2 Contrast sampler (snippet 7.3), all states × both themes

| Baseline ID | Item | Now |
|---|---|---|
| T-01 | ACMG evidence grid | **FIXED.** Inactive buttons are `on-surface` outlined, suggested ones `warning`, deprecated ones `muted`. 0 failures in the dialog and the panel, in both themes. |
| T-02 | Score chips | **FIXED.** `scoreThresholds` now returns `muted` / `warning` / `error`, so "gnomAD 0.970" and "CADD --" pass. |
| T-03 | MODIFIER impact chip | **FIXED** (`muted`) |
| T-03 | Transcript "Import" source chip | WCAG passes; APCA in dark is only Lc 49.6 at 10 px (advisory) |
| T-04 | ClinVar "other" grey | **FIXED** (`on-surface`) |
| T-05 / A-04 | Filter-drawer overline | **FIXED** |

New or remaining text failures:

| Where | Light | Dark | Note |
|---|---|---|---|
| Details-panel transcript table, `--` in the selected row | 4.2:1 (`#5C6370` on `#D2D8E0`) | pass | **P3, T-06.** Muted placeholder on the selected-row tint |
| Import review: "Genome build" legend + hint | 4.43 | pass | A-11 |
| Import review: "Unknown caller" chip `grey` | 2.59 | pass | A-11, a hard-coded Material grey |
| Protein modal header chips and tabs | pass | 2.59 | A-12 |
| 3D toolbar | pass | 2.14–2.32 | A-12 |
| 3D / lollipop "Benign" chip (`acmg-b` `#5C8DFF` on `#2A313A`) | — | 4.18 | P3 |

**APCA small text (advisory; the PO rule weights it), case table body plus panel, 156 table items:**

- Light: 16 below Lc 75 (baseline 11), 82 below Lc 90 (baseline 90).
- Dark: **53 below Lc 75 (baseline 53)**, 100 below Lc 90 (baseline 106).
- Dark chr/position links went from Lc 51 to **60**, an improvement, but muted text at Lc 55–61 still misses the 75 target for 13–14 px data.
- **E-06 is STILL OPEN (P2, narrower).** Raising dark muted from `#B4B6BA` to about `#C4C7CC`, and primary for text to about `#B5D3EC`, would clear Lc 70+.

### 5.3 Colour-blind safety (Machado 2009, severity 1.0; ΔE00 normal / protan / deutan / tritan; achromatopsia ratio)

| Palette | Worst pairs now | Baseline worst | Verdict |
|---|---|---|---|
| Impact (`IMPACT_COLORS`) | HIGH~MODERATE 24.0 / 17.6 / **12.5** / **12.4**. LOW~MODIFIER normal 17.5. Achromatopsia MOD~LOW 1.06, with labels. | 7.4 / 7.0 / 4.6 / 4.0 | **FIXED** (E-03). All ≥ 10 under CVD. One normal-vision pair is under 20, but text labels disambiguate it. |
| ACMG class (one source for row, filter and dialog chips) | P~LP 18.7 / 16.3 / 14.5 / **11.6**. VUS~LB normal 16.2. Dark P~LP deutan **11.0**. | filter chips P~VUS 4.0, VUS~B protan 3.0 | **FIXED.** E-04 is fixed too: one palette across row, filter and dialog. |
| ClinVar table chips | P~LP 11.6 tritan. Dark VUS~other 11.8 on all. conflicting~VUS deutan 12.3 | LP~VUS 5.6; VUS~LB protan 1.3 | **FIXED.** All ≥ 10 under CVD. |
| **ClinVar lollipop / 3D marks** (`CLINVAR_COLORS` = the light ACMG tokens) | P~LP tritan **11.6**, deutan 14.5. Uncertain~LB normal 16.2. Other `#8A8A8A` | LP~LB deutan **2.5** | **FIXED** (E-05, P1 → closed). Every pair is ≥ 10. The marks are 8–14 px diamonds, so the ≥ 15 small-mark rule fails for P~LP under tritan and deutan. **All marks still share one shape.** Class text is in the tooltip, the "Nearby variants" list ("4 VUS, 1 Likely benign, 2 Benign") and List view. P3, E-05b. |
| Lollipop consequence (`CONSEQUENCE_COLORS`), gnomAD dots and lollipop heads | missense~inframe deutan **4.6**; missense~splice protan 14.6 | same | **STILL OPEN** (E-07, P2). Colour-only on the dots; the legend is the only key. |
| Protein domains (`DOMAIN_TYPE_COLORS`) | domain~repeat 3.5 normal; motif~coiled-coil 4.6 normal | same | **STILL OPEN** (P3; domains are labelled in the plot) |
| Zygosity | hom~het deutan 12.5. Dark: no flags | 4.6 | **FIXED** |
| Score chips | red~orange deutan 12.5 | 8.8 | **FIXED** |
| ACMG evidence strength (active fills) | strong~moderate deutan **9.0** | 3.3 (inactive) | Text (code names) carries the meaning. P3. |

CVD composites: `reaudit/tech/shots/cvd-{case-table,details-panel,acmg-dialog,palette-sheet}.png`.

### 5.4 Semantic-role consistency (D3e)

- **FIXED.** There is one map, `SEMANTIC_COLORS`, plus the `ACMG_COLORS`, `IMPACT_COLORS` and `ZYGOSITY_COLORS` token maps. It feeds the theme, the table, filter and dialog chips, and the lollipop / Mol\* marks. The baseline's three ACMG schemes and two ClinVar schemes are now one each.
- **Residual: the protein views do not follow the theme in dark** (`state-protein-modal-dark.png`, `state-protein-3d-dark.png`):
  - The lollipop plot area, the legend strip and the Mol\* canvas (`#faf8f6`, `MolstarViewer.vue:116,129`) stay light.
  - The modal header is the light blue-grey `#90A4AE`.
  - **E-08 (P2, D5):** large light panels inside the dark UI.

---

## 6. Keyboard, Esc and focus (`data/technical-keyboard.json`, `probe4/5`)

| Check | Baseline | Now |
|---|---|---|
| Skip link, first Tab stop | ✓ | ✓ "Skip to main content" visible at 0,0 |
| App-bar focus ring | **1.00:1 (A-02, P1)** | **11.5:1 light / 9.9:1 dark → FIXED** |
| Sidebar header icon buttons ("Case list help", "Import data") | not reported | outline 1:1 on the primary header; a faint halo (`box-shadow`) is the only cue. **P3, A-13.** |
| Filter drawer | no focus, no Esc | **focus moves inside, Esc closes, focus returns to "Filters" → FIXED** (A-03) |
| Columns drawer | no focus, no Esc | **same → FIXED** |
| Details panel Esc | does not close | **closes** (drawer moves off-canvas, x = 1805), and focus returns to the selected row → **FIXED** (03-7 too) |
| ACMG dialog (`a`) | ✓ | ✓, and focus returns to the panel heading |
| Preferences / import / shortcuts dialogs: focus after Esc | `<body>` | returns to "Application settings" (preferences, import). After the shortcuts sheet it lands on the case header. **A-05 FIXED.** |
| Menus (settings, export, account, column filter) | ✓ | ✓, focus returns to the origin |
| Protein view by keyboard | Enter on "Open protein view" did nothing (SUSPECTED) | **Enter on the focused "Lollipop" button opens nothing** (0 dialogs after 3 s); the `p` shortcut opens it. **VERIFIED, still open, P2, A-06.** |
| Tab path to the first row action | 77 | 76 |

The comment-Esc-saves bug (P-03, report 03) was not re-tested here. It belongs to the design agent's area.

---

## 7. Typography computed-style checks (D2)

- **Bundled type system shipped:** `Inter Variable` (UI) and `JetBrains Mono Variable` (Ref, Alt, Position, HGVS), with a metric fallback face. The baseline had an unshipped Roboto, Courier New and mixed mono stacks. **X-10 FIXED** (computed: table body is 88 Inter + 68 JetBrains Mono nodes; no Courier New).
- **`tabular-nums`:** Position (mono) and gnomAD AF use it. The remaining `normal` numeric column is the `--` placeholder column. **Y-01 FIXED.**
- **HGVS:** mono, `overflow-wrap: break-word`, never hyphenated. The panel heading now **names the variant**, "ZNRF3 · ENST00000544604.7:c.426+16212A>G", with an ellipsis; the full value is in the body. The doubled transcript prefix is gone (X-05).
- **The result-count chip still collapses to "1,"** when the panel is open (`probe-panel.png`), and the full count is not visible (P3, carried from baseline E-06).
- **Mixed consequence labels** "Downstream" vs "intron variant" in the same column are still present in Electron (`electron/shots/09-export-debug.png`). That is a D12/D13 item, noted for the design pass.

---

## 8. Electron desktop (brief items)

The run used isolated `HOME` / `userData` / `appData`, `xvfb-run`, X11, and native dialogs stubbed in the main process. Script: `reaudit/tech/electron/ele.cjs`. Results: `electron-results.json`.

| Item | Baseline (06) | Now |
|---|---|---|
| Startup milestones, 3 cold launches | app-ready 44 → window 79 → db 358 → interactive 428 ms | app-ready 41–84 → window 69–114 → db 173–223 → **interactive 228–276 ms** |
| Dark-preference launch (E-10) | light splash, then dark at about 1.2 s | **boot already `rgb(18,20,26)`; FIXED** (`backgroundColor` follows `nativeTheme`) |
| First run with no database (E-05, P1) | Welcome page invites import; import fails generically | Welcome page says *"No database is open. Create or open one from the database menu in the toolbar."* Import attempts show the same message as an error snackbar. **FIXED.** (Create/Open buttons in the empty state would be better; P3.) |
| Import with build confirm | n/a | Wizard Review step shows the file name and path (E-16 partly fixed). The build radio is pre-set to GRCh38 with "GRCh37 (hg19) — header disagrees" and "Contig lengths match GRCh38 (25 of 25)". It also offers the neighbouring `test-regions.bed` as a filter. Import of 1,585 variants takes **143 ms**. |
| Case list after import (E-02, P1) | not refreshed until reload | **"Cases (1) · HG005 · Just now" right after Done; FIXED** |
| Two import menu entries (E-16) | present | still present: "Import VCF Files — multi-file case" and "Import Data — one or many files". Each now has a one-line hint. P3. |
| Table: sort / next page / preset on / off | 0–0.001 CLS, 51–78 ms | 0 / 0.0001 / 0.0012 / 0.001 CLS; 28–66 ms |
| Panel open / Esc-close | **0.200 / 0.306** | **0.0129 / 0.0147; Esc closes** |
| Case → cohort → case | 0.0116 | 0.0064 / 0 |
| **Export over the open database (E-03, P1)** | XLSX overwrote the encrypted DB | Save-dialog stub pointed at the open `audit.db` → **the DB header was unchanged** (`2ac46ff6…`, still ciphertext). No file was written and no success toast appeared. A normal export then wrote 1,011,461 bytes in 1.09 s ("Exported to …/export.xlsx"). **FIXED.** I did not capture a refusal message, so whether the user is told why is unverified (P3). |
| Dark contrast, desktop table | Fetch VEP 2.31:1 | 0 sampler failures in 19 visible text nodes, and "Fetch VEP" passes |
| Gene burden hang (E-01), encrypted "Open…" (E-04), last DB reopen (E-07) | P1 / P1 / P2 | **not re-tested** (not in this brief) |

---

## 9. Baseline finding status (05 + desktop items of 06)

| ID | Sev | Item | Status |
|---|---|---|---|
| S-01 / E-06(06) / X-01 | P1 | Panel open/close reflow | **FIXED** (0.013 / 0.015, web and Electron) |
| A-02 / X-02 | P1 | App-bar focus ring 1:1 | **FIXED**. Residual sidebar-header case → A-13 (P3, new) |
| A-01 / X-03 | P1 | Columns drawer unnamed checkboxes | **FIXED** |
| E-05 / C-01 | P1 | Lollipop/3D ClinVar red/green only | **FIXED** (CVD-safe palette). One shape remains → E-05b (P3) |
| A-03 / X-06 | P2 | Drawers / panel: focus and Esc | **FIXED** |
| T-01 | P2 | ACMG evidence grid contrast | **FIXED** |
| T-02/03/04 / X-08 | P2 | Score, MODIFIER and ClinVar grey chips | **FIXED** |
| E-01 / X-07 / E-10(06) | P2 | Theme flash, dark OS (web + desktop) | **FIXED** |
| E-03 / X-09 | P2 | `error` ≈ `warning` | **FIXED** (ΔE 24) |
| E-04 | P2 | Two ACMG colour schemes | **FIXED** |
| E-02 / X-04 | P2 | Dark app-bar slab | **FIXED**. Sidebar header residual → E-02b (P2) |
| E-06 | P2 | Dark APCA small text | **STILL OPEN** (53 of 156 below Lc 75; links improved from 51 to 60) |
| S-02 | P2 | Mobile filter CLS 0.18 | **FIXED** |
| S-04 | P2 | Navigation CLS case 0.04 / cohort 0.09 | **FIXED** (0.0168 / 0.0191), with thin headroom. The sidebar loader is still the main source. |
| S-03 | P3 | Panel skeleton flash | **STILL OPEN** |
| S-05 | P3 | Sidebar toggle animates `v-main` | not re-measured |
| S-06 | P3 | Empty state centred in the 2032 px width | not re-measured |
| S-07 | P3 | Deep-link Welcome blink / double skeleton | **STILL OPEN** |
| A-04 | P3 | Filter-drawer overline 4.39 | **FIXED** |
| A-05 | P3 | Focus to `<body>` after dialogs | **FIXED** |
| A-06 | P3 → **P2** | Protein view by keyboard | **STILL OPEN, now VERIFIED**: Enter on Lollipop does nothing; `p` works |
| E-07 | P3 | Consequence palette / domain colours / dark SVG colours | **STILL OPEN** (palette). Dark plot area stays light → E-08 |
| Y-01 | P3 | AF/CADD not tabular | **FIXED** |
| P-01 | P3 | Theme toggle INP at 4× | **slightly REGRESSED** (208–216 → 248–304 ms; 1× unchanged) |
| Detector `login.html` advisory | — | border + shadow | **REGRESSED** (advisory, P3) |
| 06 E-02 / E-03 / E-05 | P1 | Desktop list refresh / export-over-DB / no-keyring first run | **FIXED** |
| 06 E-14 | P2 | Desktop contrast (score chips 1.81, Fetch VEP 2.31) | **FIXED** |

**Counts (27 items re-checked): FIXED 20, STILL OPEN 5, REGRESSED 2** (theme-toggle INP at 4×; the login detector advisory).

### New findings

| ID | Sev | View | Dim | Finding |
|---|---|---|---|---|
| A-11 | P2 | Import review (build confirm) | D8, D3 | Unnamed variant-type select (axe critical); two unnamed progress bars; build legend and hint 4.43:1; "Unknown caller" grey chip 2.59:1 |
| A-12 | P2 | Protein modal (lollipop / 3D) | D8, D3 | `role=combobox` without `aria-expanded` / `aria-controls` (critical, both themes); dark header chips and tabs 2.59:1; dark 3D toolbar 2.14–2.32:1 |
| E-08 | P2 | Protein modal, dark | D5 | Plot area, legend strip and Mol\* canvas stay light (`#faf8f6`), and the header is light blue-grey: glaring panels in dark mode |
| E-02b | P2 | Shell, dark | D5 | The sidebar "Cases" header is still a bright light-blue slab |
| Y-02 | P3 | All data views | D6, D2 | JetBrains Mono uses `font-display: block`, so mono data is invisible for up to about 300 ms on a cold load |
| Y-03 | P3 | Home, mobile | D7 | Render-blocking went from 40 to 120 ms; mobile Perf 0.79 → 0.75, LCP 4.5 → 4.96 s |
| T-06 | P3 | Details-panel transcript table | D3 | `--` on the selected-row tint is 4.2:1 |
| A-13 | P3 | Sidebar header | D8 | The focus outline is invisible (1:1) on the 2 icon buttons; only a faint halo shows |
| E-05b | P3 | Lollipop | D4 | All ClinVar marks are diamonds; P~LP misses the small-mark ΔE 15 rule (11.6 tritan) |

No P0 was found in my scope. I did not re-test the baseline P0 F-01 (hidden Shortlist keys).

---

## 10. Scores (D2–D8, schema §1/§4/§5; worse of the two themes for D3/D4/D5)

The scorecard below is for the web build. No P1 is open in my dimensions any more, so no dimension is capped.

| View | vw | D2 6 | D3 7 | D4 6 | D5 5 | D6 8 | D7 8 | D8 10 | **V now** | V baseline |
|---|---|---|---|---|---|---|---|---|---|---|
| Login | 3 | 100 | 100 | — | 100 (flash fixed) | 100 | 100 | 100 | **100** | 94 |
| Home / case list / shell | 8 | 100 | 100 | 100 | 75 (E-02b) | 75 (nav 0.0084) | 75 (mobile Perf 0.75) | 75 (A-13) | **84.5** | 74 |
| Case variant table (+ drawers, DSL) | 22 | 75 (count chip "1,") | 75 (0 failures; APCA dark) | 75 (pairs < 20 normal, labelled) | 75 | 75 (≤ 0.0168; double skeleton) | 100 | 75 | **79** | 64 |
| Variant details panel (+ ACMG) | 16 | 75 | 50 (T-06, 1 failure) | 75 | 75 | 75 (0.013 / 0.015; skeleton flash) | 100 | 75 (A-06 partial) | **75.5** | 61 |
| Gene schema / lollipop (rendered) | 6 | 75 | 50 (4 dark failures) | 50 (consequence colour-only) | 25 (E-08) | 75 | 75 | 50 (A-12 critical, A-06) | **58.5** | 42 |
| 3D structure (rendered) | 4 | 75 | 25 (8 dark failures) | 75 | 25 (E-08) | n/m | n/m | 50 (dark serious) | **50** | n/a |
| Cohort + gene burden | 13 | 75 | 75 | 75 | 75 | 75 (nav 0.0191, loading flash) | 100 | 75 | **79** | 64 |
| Import (select + build review) | 9 | 75 | 50 (A-11, 3 failures) | — | 75 | 100 | 100 | 50 (A-11 critical) | **74.4** | 75 |
| Settings / preferences / theme | 4 | 75 | 100 | — | 75 | 100 | 75 (toggle 4×) | 75 | **83.5** | 80 |

- **Technical sub-score:** `O_raw(B) = Σ vw·V / Σ vw = 6503.6 / 85 ≈ 76.5`. The baseline was ≈ 66 over vw 81 without 3D; that comparable set gives 77.8 now.
- **Dimension profile now (vw-weighted)**, baseline in brackets:
  - D2 78 (76)
  - D3 68 (63)
  - D4 76 (72)
  - D5 70 (50)
  - D6 80 (61)
  - D7 94 (96)
  - D8 70 (53)
- **Import is the only view that did not move.** The fixes landed elsewhere, while the new build-review step added A-11.

**Gates (B side):**

- No P0 found in this scope. **The baseline P0 F-01 was not re-tested by me**, and if it is still open it caps O at 49.
- D8 is ≥ 50 on every core view.
- **CI hard thresholds:**
  - CLS ≤ 0.02 navigation and interaction: pass, desktop.
  - INP < 200 ms: pass.
  - LH Perf ≥ 0.95: pass.
  - **axe 0 serious/critical per route and state: fails** on the import-review and protein-modal states, which are outside the CI gate. A strict reading of §6 therefore leaves the **79 cap** in place; it is not binding at 76.5.

**Combined web overall.** `01-design.md` was not present when this report was written. Compute it as `Combined_v = (63·A_v + 37·B_v)/100`, as in `00-COMBINED-REPORT`, and then `O_raw = Σ vw·Combined_v / Σ vw` over all 13 views. Apply the caps: P0 → 49, D13 < 50 on table/panel → 59, D8 < 50 on a core view → 69, failing CI thresholds → 79.

**Desktop overall (partial re-score of `06`).** Only the cells that my measurements change were updated; everything else carries over from `06`.

| View | Cell changes | V |
|---|---|---|
| Shell | D5 50 → 75, D14 50 → 75 | 68.5 → **71.4** |
| Import | D11 50 → 75 (E-02) | 73.7 → **75.5** |
| Case table | D6 50 → 75 | 66.2 → **68.3** |
| Details | D6 50 → 75 | 68.4 → **70.5** |
| Export | D11 25 → 75 (E-03) | 70.7 → **74.4** |
| Cohort, settings, shortcuts, about | unchanged | — |

- **Desktop O_raw ≈ 69.3** (baseline 67.6).
- The CLS cap is gone, and there is no P0.
- It is held down by cells not re-tested here, chiefly the cohort and gene burden (E-01 hang, P1), D9–D13 judgments and E-04.

---

## 11. Not covered / caveats

- One evaluator; screen readers were not used; the 200 % zoom and WCAG 1.4.12 spacing tests were not re-run.
- Mol\* keyboard operability was not tested.
- In mobile Lighthouse and Playwright, opening the details panel still cannot be scripted, because there is no row click target at 390 px.
- The comment-Esc bug (P-03), the Shortlist P0 (F-01), the desktop gene burden (E-01) and the encrypted "Open…" (E-04) were not re-tested.
- The export guard is verified by the database file staying intact. The refusal message was not captured.
- The server and its schema were stopped and dropped with SIGTERM, and the worktree `VarLens-wt/reaudit-tech` was removed. The Electron isolation roots under `/tmp` were deleted.
