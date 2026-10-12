# 05 — Technical audit: detector, accessibility, performance, visual stability, colour (Assessment B)

- **Date:** 2026-10-12 · **Build:** v0.83.0 web (`main @ bfd3d80e`), `http://127.0.0.1:8797` (Fastify + Postgres, shared seeded schema).
- **Scope:** dimensions D3, D4, D5, D6, D7 and D8, plus D2 computed-style checks. Schema: `01-evaluation-schema.md`. Baseline: `../../../../VarLens/.planning/code-review/ui-ux-audit-2026-10-06/03-*.md` and `04-*.md`.
- **Tools:**
  - impeccable 0.1.5: the CLI `detect`, plus `detect.js` injected into pages.
  - @axe-core/playwright with axe-core 4.13, WCAG 2.2 A/AA tags (`wcag2a/2aa/21a/21aa/22aa`, the same set as `make ui-gates`).
  - Lighthouse 13.5.0 user flows (puppeteer-core with Playwright chromium-1243). Cookie set via `setCookie`; disclaimer pre-acknowledged.
  - Playwright 1.63 headless at 1440×900 (plus 1350×940, 1280×800, 1920×1080 and 390×844 where noted).
  - Schema snippets 7.1, 7.2 and 7.3, plus an Event-Timing / long-animation-frame (LoAF) observer and a per-frame rAF DOM sampler for flicker.
  - colorjs.io 0.7.1 for CIEDE2000 and APCA.
- **Conditions:**
  - Interactions ran with **75 ms injected `/api/*` latency** through `page.route`, which matches the baseline. They ran at 1× CPU (3 rounds, median) and at 4× CPU through CDP (2 rounds).
  - Other agents were driving the same server in parallel. Case metadata and the case count (10 → 16) changed during the run. That did not affect the measured views.
- **Product-owner rule applied (coordinator, mid-run):**
  - Small font sizes and visual target sizes are intentional, so they are **not scored as defects**. The baseline's "10 px text" item is withdrawn on that basis.
  - Contrast at small sizes is weighted more heavily. Small text is judged against the APCA small-text target (Lc ≥ 90 preferred, ≥ 75 minimum).
- **Raw data** is in `data/`:
  - Axe, contrast and detector results per state and theme: `technical-axe-*.json`, `technical-contrast-*.json`, `technical-detect-*.json`.
  - Summaries and supporting data: `technical-axe-summary.json`, `technical-detector.json` (CLI), `technical-detect-browser-raw.json`, `technical-lighthouse-summary.json`, `technical-lh-flow-{desktop,mobile}-run1.html`, `technical-cls-*.json`, `technical-palette.json`, `technical-rendered-chips.json`, `technical-typography-apca.json`, `technical-keyboard.json`, `technical-misc.json`.
- **Screenshots** are in `screenshots/technical/`.
- **Scripts** (reproducible) are in `~/.cache/varlens-session/uiux-1012/technical/`: `states.cjs`, `interact.cjs`, `lh.mjs`, `palette.mjs`, `cvd.cjs`, `kbd.cjs`, `kbd2.cjs`, `misc.cjs`, `typo.mjs`, `det2.cjs`.

**Legend:** VERIFIED = reproduced and measured or screenshotted. SUSPECTED = based on code reading or computation only.

---

## 0. Headline

**The release fixed the table flicker, the layout shifts, INP, the bundle and the axe violations.** The numbers from 2026-10-06 to now:

| Metric | 2026-10-06 | Now |
|---|---|---|
| axe serious/critical in app states | 100–250 nodes per view | **0**, except the columns drawer |
| Lighthouse Accessibility | 77–81 | **100** |
| Home, desktop Performance | 72 | 99 |
| Home CLS | 0.191 | 0.013 |
| Desktop INP | 247 ms | 25–57 ms |
| Skeleton swap on sort/page/filter | 130–190 ms per action | **0 frames** |

**What remains** is concentrated in five areas:

- **Detail-panel open/close reflow.** The preset row wraps, so the table jumps 22 px. CLS including input is 0.21 on open and 0.31 on close.
- **Shell focus ring is invisible.** The ring is drawn in `primary` on the `primary` app bar, a 1:1 contrast.
- **Drawers and the details panel.** The filter and columns drawers do not take focus and do not close on Esc. Esc does not close the details panel either.
- **Low-contrast semantic colours.** These are Material named colours that bypass the theme: the ACMG evidence grid, the score chips and the ClinVar orange and light-green.
- **Theme and colour encoding:**
  - A light → dark flash for dark-OS users. The login page and `index.html` are hard-coded light.
  - The `error` and `warning` tokens are almost the same colour (ΔE00 7.4).
  - The lollipop ClinVar track uses red/green as its only cue.

---

## 1. Deterministic detector (impeccable 0.1.5)

### 1.1 Static CLI

| Target | Exit | Primary | Advisory |
|---|---|---|---|
| `src/renderer/src` | **0** | 0 | 0 |
| `src/renderer/src --no-config` | 0 | 0 | 0 |
| `src/web` | 0 | 0 | 0 |

- The run exited 0, not 2, so there is nothing to triage.
- There are no `impeccable-disable` comments and no `.impeccable/config.json`, so the clean result is not caused by suppression.
- The baseline advisory on the `login.html` hairline border plus wide shadow is gone.
- As in the baseline, the static scan cannot see Vuetify runtime DOM or utility colour classes. That is why the browser pass below exists.

### 1.2 Browser `detect.js` (injected, light theme; counts are visible elements)

| Rule | home | case-table | details | filter-drawer | cohort | Triage |
|---|---|---|---|---|---|---|
| layout-transition | 30 | 39 | 49 | 72 | 43 | **False positive.** Vuetify internals: drawer, field and expansion-panel width/height transitions. P3 at most. |
| tiny-text (11.9 px) / undersized-ui-text (10 px) | 0 / 0 | 12 / 1 | 12 / 4 | 12 / 9 | 5 / 0 | **Not a defect (PO rule).** Ref/Alt/HGVS cells and the tab count badge are intentional density. |
| low-contrast | 0 | 0 | 2 | 2 | 0 | **True positive.** `#607d8b` on `#fafbfd` (4.2:1) in the transcript "Import" source chip. Matches CR-scan T-03. |
| text-occlusion | 0 | 0 | 0 | 103 | 0 | **False positive.** The drawer scrim covers the page behind it, as intended. |
| clipped-overflow-container | 1 | 2 | 5 | 5 | 4 | Mostly intended scroll containers. One real symptom is the empty-state row centred across the 2032 px table width (S-06). |
| nested-cards / edge-flush-cards / cramped-padding / overused-font | 1/0/0/1 | 1/1/0/1 | 2/1/0/1 | 2/1/1/1 | 1/0/0/1 | Advisory or stylistic, mostly false positives. `v-btn-group` is counted as a card, and the table header sits flush by design. Roboto is declared but is a system fallback. |

---

## 2. Accessibility: axe-core (WCAG 2.2 A/AA), 11 states × 2 themes

Counts are serious or critical violation nodes. `inc.CC` is axe's "incomplete" colour-contrast count: axe could not decide because of tonal chip underlays or stacked backgrounds, so CR-scan (§5.2) covers those nodes.

| State | Light | Dark | inc.CC | Notes |
|---|---|---|---|---|
| login | 0 | 0 | 0 | Clean, as in the baseline. |
| home | 0 | 0 | 7 | Baseline: button-name 2, aria-required-children/parent 4, color-contrast 8. **Fixed.** |
| case-table (case 4) | 0 | 0 | 16 | Baseline: 20 button-name, 50 aria-command-name, 26 aria-allowed-attr, 243 aria-tooltip-name. **Fixed.** |
| details-panel | 0 | 0 | 23 | |
| filter-drawer | **color-contrast ×3** | 0 | 177 | The filter-section overline is `text-medium-emphasis` at 10 px: `#74767a` on `#fafbfd` gives **4.39:1** (`FilterDrawer.vue:13,214,338,438`). See A-04. |
| columns-drawer | **label ×26 (critical), aria-conditional-attr ×2** | same | 176 | Every column checkbox has no accessible name (`ColumnsDrawer.vue:39,74`, `v-checkbox-btn`). The group checkbox has `aria-checked="mixed"` on a native checkbox. See A-01. |
| acmg-dialog | 0 | 0 | 55 | axe passes, but CR-scan finds 36 text failures (T-01). |
| cohort | 0 | 0 | 30 | Baseline: 42 button-name, 75 aria-command-name, 53 target-size. **Fixed.** |
| settings (Application Preferences) | 0 | 0 | 23 | |
| import-dialog | 0 | 0 | 17 | |
| protein modal | 0 | 0 | 24 | In web mode this is the "Protein view unavailable" dialog, because external lookups are off on this server. The lollipop and Mol* canvases could not be rendered (see §5.4). |

- **`tests/ui-gates/support/known-failures.ts`** has an empty `KNOWN_FAILURES` map. Its comment says `axe:dark:home` was fixed by track 4 and `lighthouse:switch-cohort:cls` by track 2.
- So nothing is masked. However, the CI gate covers only 5 states (login, home, case-table, case-details-panel, cohort). The two failing states above, filter drawer and columns drawer, are **outside the gate**. That is why they regressed unnoticed or were never covered.

---

## 3. Lighthouse 13 (median of 3; desktop preset and default mobile)

| Step | Desk Perf | A11y | BP | LCP ms | CLS | TBT | INP ms | Mob Perf | Mob LCP ms | Mob CLS | Mob TBT | Mob INP |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nav login | **1.00** | 1 | 1 | 241 | 0 | 0 | — | 1.00 | 901 | 0 | 0 | — |
| nav home | **0.99** | 1 | 1 | 969 | 0.013 | 0 | — | 0.79 | 4510 | 0.051 | 50 | — |
| nav case table (case 4) | **1.00** | 1 | 1 | 358 | **0.040** | 0 | — | 0.91 | 1538 | **0.132** | 216 | — |
| nav cohort | **0.98** | 1 | 1 | 438 | **0.093** | 18 | — | 0.93 | 1560 | 0.077 | 237 | — |
| ts: sort column | 1.00 | — | 1 | — | 0 | 0 | 35 | 1.00 | — | 0.0005 | 20 | 82 |
| ts: change page | 1.00 | — | 1 | — | 0 | 0 | 54 | 0.99 | — | 0.0001 | 75 | 150 |
| ts: open details panel | 1.00 | — | 1 | — | 0.0087 | 0 | 25 | (step failed: no row click target in the mobile layout) | | | | |
| ts: apply filter (preset "HIGH Impact") | 1.00 | — | 1 | — | 0.0013 | 0 | 41 | 1.00 | — | 0.0015 | 27 | 92 |
| ts: switch case | 1.00 | — | 1 | — | 0.0025 | 0 | 52 | 0.96 | — | 0.0016 | 168 | **203** |

**Comparison with the baseline:**
- Home went from desktop 72 / mobile 59 to 99 / 79.
- In-app A11y went from 77–81 to 100.
- Best Practices went from 95 (console 501/404) to 100.
- Case INP went from 247 to 25–57 ms on desktop, and from 1,192 to 82–203 ms on mobile.
- Remaining Lighthouse opportunities:
  - `unused-javascript` is about 149 KiB (it was 873–879 KiB).
  - `legacy-javascript` costs 16–18 KiB.
  - `render-blocking` costs 40 ms on home.

**Navigation CLS culprits:**
- Case table: `div.table-container` 0.025 and the sidebar `v-infinite-scroll__side` loader 0.011.
- Cohort: `cohort-table-container > .table-container` 0.037. The `applied-filters-bar` and `table-load-indicator` are inserted above the table, moving it from y 227 to 260.
- Mobile case table: the infinite-scroll side loader 0.050 and the table 0.078.

**Harness note:** my first desktop runs reported a switch-case CLS of 0.178. That came from my script clicking the sidebar toggle inside the timespan. The real cause is S-05, the toggle animating `v-main`. The numbers above come from a corrected re-run.

---

## 4. Visual stability and flicker (Playwright, CLS-obs + rAF sampler, 75 ms latency)

### 4.1 Per-interaction CLS, including input-adjacent shifts (the schema rule)

Desktop 1440×900. CLS is the median of 3 rounds; mobile is 390×844 in one round.

| Interaction | CLS incl. input | CLS no-input | INP 1×, ms | INP 4× CPU, ms | LoAF > 50 ms (4×) | Busy indicator / flicker | Mobile CLS incl. input |
|---|---|---|---|---|---|---|---|
| Initial load (deep link `/case?case=4`) | 0.033 | 0.033 | — | — | — | Skeleton **84 + 100 ms (two blinks)**, spinner 133–166 ms, progress 16–50 ms | 0.053–0.078 |
| Sort Gene asc | 0 | 0 | 24 | 80 | 84 | **None.** No skeleton, empty body or dimming. | 0 |
| Sort Gene desc | 0 | 0 | 16 | 56 | 73 | none | 0 |
| Next page | 0 | 0 | 32 | 128 | 119 | none | 0.0001 |
| Previous page | 0 | 0 | 32 | 136 | 128 | none (cached) | 0.0001 |
| Preset chip "Rare (1%)" on / off | 0.001 / 0.001 | 0 | 16 | 40–48 | 99 | none. First content change about 136 ms (the baseline settled at 545 ms). | **0.18 / 0.18** |
| Preset chip "CADD ≥ 20" on / off | 0.0009 | 0 | 16 | 40–48 | — | none | **0.18** |
| DSL search "ZNRF3" + Enter / clear | 0.0011 / 0.0011 | 0 | 16–24 | 56–80 | 76 | none | **0.18** |
| **Open details panel** | **0.208** | 0 | 16 | 56 | 136 | Panel skeleton **33–50 ms** (sub-300 ms flash) | (row click not possible on mobile) |
| Next variant (ArrowDown, panel open) | 0 | 0 | 16 | 40 | 98 | none | 0 |
| **Close details panel** | **0.306** | 0 | 24 | 96 | 91 | — | — |
| Switch case (sidebar) | 0.0025 | 0 | 32 | 136 | 127 | Skeleton 116 ms, spinner 117 ms, progress 367–484 ms (4×) | 0.0025 |
| Open cohort | 0.0065 | 0 | 16 | 40 | 197 | "Loading items" rows plus progress **100–117 ms** (sub-300 ms flash) | 0.001 |
| Back to case (keep-alive) | 0 | 0 | 16 | 40 | 93 | spinner 116 ms | 0 |
| Open protein modal (web: "unavailable" dialog) | 0.013 | 0 | 32 | 48 | 123 | Panel skeleton 34 ms | 0.0005 |
| Theme toggle dark / light (Preferences) | 0 / 0 | 0 | 64–72 | **208–216** | 187–191 | No flash on toggle | 0 |
| Sidebar toggle (1350 px) | **0.178** | 0 | — | — | — | 11 shifts over 166 ms: `div.case-content` and the footer | — |

**Shift sources (VERIFIED, `data/technical-cls-lat75-cpu1.json`):**

- **Open panel, 0.200 in one entry.**
  - `div.table-container` moves from 280,237 (750×631) to 280,259 (750×609).
  - The `applied-filters-bar` moves from y 198 to 220.
  - The preset `v-slide-group` shrinks from 220 to 52 px.
  - Cause: when the panel takes 410 px, the toolbar row narrows. The **PresetBar wraps to a second line** (+22 px), and the count chip collapses to "1,".
  - Then the panel's own sections shift 72 px when the skeleton is replaced (`annotation-scores-section` y 381 → 453, 0.0071).
  - Screenshot: `screenshots/technical/panel-open-toolbar-wrap.png`.
- **Close panel, 0.306.** The same reflow in reverse: `table-container` changes from 750×609 to 1150×631.
- **Mobile filter or search, 0.179.**
  - The preset row wraps or unwraps when the toolbar content changes. The "Save" preset button appears when a filter is active.
  - `div.table-container` moves from y 289 to 315.
- **Sidebar toggle, 0.178.** `v-main` padding animates over 200 ms (`transition: 0.2s cubic-bezier`), so the whole case view reflows in 11 frames.

### 4.2 Flicker catalogue

| # | What | Evidence | Rule | Status |
|---|---|---|---|---|
| 1 | Table → skeleton → table on sort/page/filter/search | 0 skeleton, loading-row, empty-body or dimmed frames in 3 × 10 interactions (`flicker.spans` empty) | C3 / D6c | **FIXED** (baseline F1) |
| 2 | Details-panel skeleton shows for 33–50 ms at 1× (150–167 ms at 4×) and is then replaced. The sections move 72 px. | rAF sampler | Spinner rule: skeletons are for first load only, and a busy indicator should appear only after 300 ms | OPEN, see S-03 |
| 3 | Cohort entry: "Loading items" plus the linear progress bar flash for 100–117 ms | rAF sampler | Indicator shown before 300 ms | OPEN (P3) |
| 4 | Deep-link load shows the **"Welcome to VarLens / Select a case" empty state** before the case renders, then the shortlist skeleton | `screenshots/technical/theme-flash-dark-os-login-to-app.png`, frame 8 | Content blink | OPEN (P3, S-07) |
| 5 | Initial load: the skeleton appears twice (84 ms, gap, 100 ms) | rAF sampler | Double blink | OPEN (P3) |
| 6 | Dark-OS user: light login → blank light frame → dark app | filmstrip above | D5d theme flash | **REGRESSED**, see E-01 |

---

## 5. Colour

### 5.1 Theme tokens (`src/renderer/src/plugins/vuetify.ts:36-104`; values confirmed from runtime `--v-theme-*`)

| Pair | Light WCAG / APCA Lc | Dark WCAG / APCA Lc |
|---|---|---|
| on-surface / surface | 16.3 / 101 | 13.6 / −90 |
| on-surface @ 0.70 (medium emphasis) / surface | 6.1 / 79 | 7.25 / **−54** |
| muted / surface | 5.84 / 78 | 7.04 / **−53** |
| primary (link and data text) / surface | 11.1 / 94 | 7.12 / **−54** |
| error / warning / info / success on surface | 6.3 / 5.4 / 5.6 / 7.6 (Lc 74–85) | 7.9 / 9.8 / 7.6 / 10.3 (Lc −57 to −73) |
| star / surface (non-text) | 4.09 | 10.4 |
| app bar text on primary | white 11.5 / Lc −100 | `#12141A` on `#7BAED4` 7.8 / Lc 56 |

**Eye comfort (D5):**

- **Backgrounds pass.** The dark background `#12141A` and surface `#1A1D22` are not pure black. The text `#E4E7EC` is about 89 % white. The light surface `#FAFBFD` is not pure white.
- **The dark app bar is a large saturated fill.** It is filled with `primary` `#7BAED4` (Y = 0.39, OKLCH chroma 0.077), a bright light-blue band across the top of a near-black UI. Material guidance is to use surface elevation for app bars in dark mode. See E-02 and `screenshots/technical/state-case-table-dark.png`.
- **Dark-theme APCA is low.** WCAG passes everywhere, but APCA for medium-emphasis, muted and primary text on dark is only Lc 53–54. Under the PO rule this matters for 12–14 px data:
  - **53 of 156** visible table-body text items in dark are below Lc 75, including chr/position links at Lc 51.
  - **106 of 156** are below the small-text target of Lc 90.
  - Light: 11 below Lc 75 and 90 below Lc 90.
  - Source: `data/technical-typography-apca.json`.
- **Reduced motion is honoured.** With `reducedMotion: reduce` only 3 navigation drawers still transition (0.15 s). The baseline found 77 of 88 elements still animating. **FIXED.**
- **No flash on theme toggle.** CLS 0 and no frame flash. The theme follows the OS (`System` default) and persists.

### 5.2 Contrast sampler (snippet 7.3) failures

The sampler covers all 11 states × 2 themes and composites text over the chip underlay. Disabled controls are excluded.

| ID | Where | Light | Dark | Source |
|---|---|---|---|---|
| T-01 | ACMG evidence grid buttons. Inactive outlined text: moderate (PM1, PM3–PM6, "Auto-suggest") `amber-darken-2` **1.97:1**; strong (PS1–4, BS1–4) `orange-darken-1` **2.29**; deprecated (PP5, BP6) `grey` 2.59; BA1 `red-lighten-1` 3.37; supporting (PM2, PP*, BP*) `blue-grey` 4.22. 36 failures in the dialog and the same grid in the panel. | 1.97–4.22 | PVS1 `deep-purple-lighten-1` 3.24; supporting `blue-grey` 3.87 (13 failures) | `components/acmg/AcmgEvidenceGrid.vue:105-122,139`, `AcmgSummaryBar.vue:55` |
| T-02 | Details-panel "Annotation Scores" chips: "gnomAD 0.970" `grey-lighten-1` **1.81:1** (Lc 33); "CADD --" `grey` 2.59 | 1.81 / 2.59 | 6.3 (Lc 48) | `utils/scoreThresholds.ts:34-47` (`'grey'`, `'grey-lighten-1'`) |
| T-03 | Transcript table chips: impact "MODIFIER" `grey` 2.59 (10 px); source "Import" `blue-grey` 4.22 / 3.87 dark | 2.59 / 4.22 | 3.87 (Lc 30) | `useTableColors.ts:36-45` `MODIFIER: 'grey'`; TranscriptSection source chip |
| T-04 | Cohort and case ClinVar chip with category "other" / grey (`text-grey`) | **2.35–2.42** (×21 rows in gate-case-a) | 5.2 | `shared/config/severity.config.ts` CLINVAR_CATEGORIES `color: 'grey'` (×7) |
| T-05 | Filter-drawer section overline (`text-overline text-medium-emphasis`, 10 px) | **4.39** (axe serious ×3) | pass | `FilterDrawer.vue:13…`, `font-size: .625rem` at `:846` |

**Computed for colours the fixtures do not contain** (SUSPECTED, from source tokens; `data/technical-palette.json`):

- ClinVar "Pathogenic/Likely pathogenic" and "Likely pathogenic" use Material `orange` `#FF9800`: **2.08:1** on the light surface, or 1.90 on its own 12 % tint.
- "Likely benign" and "Benign/Likely benign" use `light-green` `#8BC34A`: **2.03:1**.
- These are the two most triage-relevant ClinVar classes, rendered as tonal chip text (VERIFIED variant: `v-chip--variant-tonal`).
- The CADD 20–25 chip uses `orange`: 2.08:1.
- ACMG_COLORS used as chip text: LP `#D55E00` 3.73, B `#009E73` 3.30, VUS `#757575` 4.45.

### 5.3 Colour-blind safety (Machado 2009, severity 1.0, linear RGB; ΔE00)

Thresholds: ≥ 20 normal vision, ≥ 10 under CVD (≥ 15 for marks under 6 px), achromatopsia ≥ 1.5:1 for adjacent pairs. The full matrix is in `data/technical-palette.json`.

| Palette (used for) | Worst pairs (Normal / Protan / Deutan / Tritan ΔE00; achromatopsia ratio) | Redundant text cue? | Verdict |
|---|---|---|---|
| **Theme `error` vs `warning`.** Impact HIGH vs MODERATE (transcript chips), ClinVar P vs VUS, zygosity hom vs het, CADD ≥ 25 vs 15–20, ACMG filter chips P vs VUS | **7.4** / 7.0 / 4.6 / 4.0; A 1.17. Indistinguishable even with normal vision. | Yes, there are labels | D4b and D3e fail. E-03 |
| ClinVar table chips (dark) | LP orange ~ VUS warning: 8.2 / 7.1 / 5.6 / 8.1. VUS ~ LB: P 1.3 / D 7.7 | Yes | Fail under CVD. Text saves it. |
| ACMG_COLORS (row chip, summary bar, panel) | P~LP 18.3 / 15 / 10.5 / **9.1**; VUS~B D 10.1. Achromatopsia LP/VUS/LB 1.13–1.19 | Yes (P/LP/VUS/LB/B abbreviations) | Best palette. Near-pass. |
| ACMG filter chips (`constants.ts:12-28`) | P~VUS 7.4/7.0/4.6/4.0; VUS~B protan **3.0**; P~B protan 5.2 | Yes | Fails. It also uses **different colours** from ACMG_COLORS for the same classes (VUS is grey in one, orange-red in the other). E-04 |
| **Lollipop / 3D ClinVar (`CLINVAR_COLORS`, RdYlGn)** | LP~LB deutan **2.5**, protan 11.8; P~B deutan **9.5**; uncertain~LB protan 7.3 / deutan 9.9. The uncertain mark `#fee08b` is 1.25:1 on the surface (non-text needs 3:1). Diamonds are 8–14 px at opacity 0.7. | **No.** All diamonds have the same shape and colour is the only cue; text appears only in the hover tooltip and legend. | **Colour-only red/green for pathogenic vs benign. P1.** E-05 |
| Lollipop consequence (`CONSEQUENCE_COLORS`) | missense~inframe deutan **4.6**; synonymous~other normal 19.7; "other" `#C0C0C0` 1.76:1, splice `#FF8C00` 2.25:1 on the surface | No (legend only) | Fails. P2 |
| Protein domains (`DOMAIN_TYPE_COLORS`) | domain~repeat **3.5** normal; motif~coiled-coil **4.6** normal; signal~zinc-finger 7.5 normal; 22 of 45 pairs flagged | Domains are labelled in the plot (code) | P3. Two pairs are the same colour even for normal vision. |
| ACMG evidence strength (inactive) | strong~moderate 6.2 / 4.8 / 3.3 / 4.6 | Yes (code names) | Fail. Text saves it. |
| Score chips | `grey` ~ `grey-lighten-1` 8.8 | Yes (value) | P3 |

- CVD screenshots: `screenshots/technical/cvd-case-table.png`, `cvd-details-panel.png`, `cvd-acmg-dialog.png`, `cvd-palette-sheet.png` (normal | protan | deutan | tritan | achromat).
- **Lollipop and 3D could not be screenshotted in web mode.** The server has external lookups off, so "Protein view unavailable" is shown (by design, explained in the dialog). Their assessment is therefore computed from source (SUSPECTED) and includes the palette sheet rendering of `CLINVAR_COLORS` as diamonds.
- Hard-coded SVG colours in `useLollipopPlot.ts` are SUSPECTED to look wrong in the dark theme: axis text `#666`, backbone `#E0E0E0`, labels `#333`, stroke `#fff`, lines 509, 663 and 685–695.

### 5.4 Semantic-role consistency (D3e)

There are **three ACMG colour schemes**: ACMG_COLORS (Okabe-Ito), ACMG_FILTER_OPTIONS (Material/theme) and the evidence-strength colours. There are **two ClinVar schemes**: the table uses theme and Material tokens, while the lollipop and 3D views use RdYlGn hex. In both cases the same class is shown in different colours in different views.

---

## 6. Keyboard

| Check | Result | Status |
|---|---|---|
| Skip link | First Tab stop: "Skip to main content", visible on focus (`kbd-focus-sheet.png`). Enter moves focus to `#main-content`, and the next Tab reaches "SNV/Indel". | **FIXED** (was missing) |
| Tab order | Skip → 9 app-bar items → 5 sidebar → tab → case header → search → star/comment → 5 ACMG chips → Filters/Columns/Export → 10 presets → 36 header stops (name, sort, filter per column) → first row action at **stop 77**. No positive tabindex. | OK. The skip link mitigates the long path. |
| Focus visibility | Every stop shows a 2 px outline (`custom.css:104-133`). | Partial |
| Focus ring contrast | Contrast against the adjacent background is 10.2–11.1:1 in content areas, but **1.00:1 on all 9 app-bar stops** in both themes. The ring is `rgb(var(--v-theme-primary))` and the app bar is filled with `primary`. Only the active Case/Cohort toggle stays visible, through its own fill. | **FAIL**, A-02 |
| Esc behaviour | See the table below. | |

| Overlay | Focus moves inside on open | Esc closes | Focus after close |
|---|---|---|---|
| Filter drawer | **no** (Tab continues to Columns, Export…) | **no** | stays on the "Filters" button |
| Columns drawer | **no** | **no** | "Columns" |
| Details panel | yes (`H2.panel-heading`) | **no**. Verified with focus on the heading and on the close button, although `VariantDetailsPanel.vue:546-550` has a keydown handler that emits `update:open`. | — |
| ACMG evidence dialog (`a` key) | yes | yes | to the row |
| Preferences dialog / Import dialog / Shortcuts `?` | yes | yes | **`<body>`**, not the origin |
| Settings, Export, Account and column-filter menus | menu | yes | origin ✓ |
| "Protein view unavailable" | opening it by keyboard (focus + Enter on "Open protein view") **did not open the dialog** within 5 s; it opens by mouse click | — | — (SUSPECTED, A-06) |

---

## 7. Typography computed-style checks (D2)

- **Numbers.** Position uses `ui-monospace` with `tabular-nums`. **gnomAD AF and CADD use proportional Roboto** (`font-variant-numeric: normal`), so digits do not align in the columns that need comparison most (P3, Y-01).
- **HGVS.** Shown in `Courier New` in the panel and the table. In the panel `overflow-wrap: break-word` applies, and the long `ENST…:c.426+16212A>G` is cut at the panel edge (`panel-open-toolbar-wrap.png`) (P3).
- **Font.** "Roboto" is declared and computed but never shipped as a webfont, so it falls back to the system font. Mixed monospace stacks are in use (`ui-monospace` and `Courier New`).
- **Sizes.** Per the PO rule, small sizes (10–14 px) are not scored.

---

## 8. Findings (ranked)

| ID | Sev | View | Dim | What / evidence | Root cause | Minimal fix |
|---|---|---|---|---|---|---|
| **S-01** | **P1** | Case table, details panel | D6 | Opening or closing the details panel moves the whole table: CLS **0.208 / 0.306** including input, 0.20 in one shift, the table moves 22 px and changes width. VERIFIED: `technical-cls-lat75-cpu1.json`, `panel-open-toolbar-wrap.png`. | The PresetBar wraps when the toolbar narrows. The count chip collapses. | Keep presets on one line: `flex-wrap: nowrap` with horizontal scroll or an overflow "More" menu, like the slide-group the toolbar already uses. Or reserve the second row's height permanently. Apply the same to `CohortFilterBar` (parity). |
| **A-02** | **P1** | All authenticated views (shell) | D8, D3b | The focus ring is invisible on the app bar. All 9 header stops measure **1.00:1** in light and dark. VERIFIED: `kbd-focus-sheet.png`, `technical-keyboard.json`. | `assets/styles/custom.css:104-114` uses `outline: 2px solid rgb(var(--v-theme-primary))` on a `primary` app bar. | Add `.v-app-bar :focus-visible { outline-color: rgb(var(--v-theme-on-primary)) !important }`. Or use a two-tone ring: `outline` in on-primary plus a primary `box-shadow`. |
| **A-01** | **P1** | Columns drawer | D8 | 26 checkboxes have no accessible name (axe `label`, critical). The group checkbox uses `aria-checked="mixed"` on a native input (`aria-conditional-attr`, serious). Both themes. VERIFIED. | `ColumnsDrawer.vue:39,74`. The `v-checkbox-btn` has no `aria-label` or `label`, and the visible text is a sibling. | Add `:aria-label="col.title"` and `aria-label="Show all {group}"`. For the group checkbox use the `indeterminate` prop instead of `aria-checked`. Add `columns-drawer` and `filter-drawer` to `GATE_STATES` in `tests/ui-gates/support/app-states.ts`. |
| **E-05** | **P1** | Lollipop / 3D legend | D4 | ClinVar diamonds use RdYlGn as their only encoding: LP vs LB ΔE00 under deuteranopia is **2.5**, P vs B 9.5. The uncertain mark is 1.25:1 on the surface. All marks have the same shape. SUSPECTED (computed; not renderable in web). | `shared/utils/protein-utils.ts:61-68`, `composables/useLollipopPlot.ts:399-414`. | Use a CVD-safe set (reuse ACMG_COLORS / Okabe-Ito). Add a shape cue (filled for pathogenic, hollow for benign, a dot for VUS) or a letter glyph. Drop opacity 0.7, or add a dark stroke for 3:1. |
| **A-03** | P2 | Filter and columns drawers, details panel | D8, D12d | The drawers do not take focus and Esc does not close them. Esc does not close the details panel. VERIFIED. | The `v-navigation-drawer` has no focus trap or Esc handler. The panel's `window` keydown emit is not honoured. SUSPECTED: the parent binding, or the leave guard swallowing it (`VariantDetailsPanel.vue:540-555`). | On open, focus the drawer heading. Add `@keydown.esc="close"` on the drawer. Fix the panel's `update:open` wiring so Esc closes it, and return focus to the selected row. |
| **T-01** | P2 | ACMG evidence dialog and panel editor | D3 | Criterion code labels are 1.97–4.22:1 in light (36 nodes) and 3.24–3.87 in dark. VERIFIED. | `AcmgEvidenceGrid.vue:105-122,139` and `AcmgSummaryBar.vue:55` use Material named colours (`amber-darken-2`, `orange-darken-1`, `blue-grey`, `red-lighten-1`, `grey`). | Map strengths to theme tokens with dark variants, for example a `acmg-*` token set at ≥ 4.5:1 (Lc ≥ 75) in both themes, the way `star` and `clinvar-conflicting` already work. Keep hue but darken: moderate `#8A5A00`, strong `#B24A00`. |
| **T-02/T-03/T-04** | P2 | Details panel, transcript table, case and cohort ClinVar | D3 | Score chips 1.81–2.59:1 (Lc 33–50). Impact MODIFIER and source chips 2.59 / 4.22. ClinVar "other" grey 2.35 (×21). VERIFIED. ClinVar LP orange 2.08 and LB light-green 2.03 are computed (SUSPECTED, no fixture). | `scoreThresholds.ts:34-47`, `useTableColors.ts:28-45`, the `severity.config.ts` `CLINVAR_CATEGORIES` colours `orange` / `light-green` / `grey`. | Replace `grey` / `grey-lighten-1` with `muted`. Add theme tokens `clinvar-lp` (for example `#A84300`, light) and `clinvar-lb` (`#2E6B12`), with dark variants. |
| **E-01** | P2 | Login → app (dark OS) | D5d | Light login `#F0F4F8` → blank light frame → dark app `#12141A`. `html` and `body` stay light under the dark app. VERIFIED: `theme-flash-dark-os-login-to-app.png`, `technical-misc.json`. **Regressed** from baseline F13: the app now follows the OS, but the shell does not. | `src/web/login/login.html:14,28-59` and `src/web/index.html:11-22` hard-code `color-scheme: light` and a light background. Their comment "app ships a light theme only" is stale. | Add `<meta name="color-scheme" content="light dark">` and an `@media (prefers-color-scheme: dark)` background `#12141A` in both files. Also read `varlens_user_settings_v1.themePreference` in a tiny inline script, or the CSP-safe equivalent: a `data-theme` attribute set by the bootstrap. |
| **E-03** | P2 | Impact chips, ClinVar, zygosity, CADD, ACMG filter chips | D4b, D3e | `error` `#B71C1C` vs `warning` `#BF360C`: ΔE00 **7.4** normal, 4.0–7.0 under CVD, achromatopsia 1.17. HIGH vs MODERATE and P vs VUS look identical. Labels prevent misreading. Computed and VERIFIED from tokens. | `plugins/vuetify.ts:44-48` (warning is a deep orange-red). | Move `warning` toward amber/brown (for example light `#8A5300`, which is ≥ 4.5:1 and ΔE00 > 20 from error), with a matching dark `#FFB74D`, which already differs. |
| **E-04** | P2 | Case/cohort toolbar ACMG chips vs row/panel ACMG chips | D3e, D12b | The same ACMG class gets different colours: VUS is grey `#757575` in ACMG_COLORS and `warning` in the filter chips; LB is `#0072B2` vs `blue-grey`. VERIFIED (source). | `utils/filters/constants.ts:12-28` vs `shared/config/domain.config.ts:20-26`. | Derive `ACMG_FILTER_OPTIONS.color` from `ACMG_COLORS`. One source. |
| **E-02** | P2 | All views, dark | D5b | The app bar is a full-width `#7BAED4` fill (Y 0.39) on a near-black UI. It is a glare band, and it also causes A-02. VERIFIED (screenshot). | Vuetify `v-app-bar color="primary"` in dark. | In dark use `surface-bright` `#30353E` for the app bar, with a `primary` accent on the active toggle only. |
| **E-06** | P2 | Dark theme, table and panel | D3c | APCA small-text targets are missed in dark: chr/position links Lc 51 (WCAG 5.8), and muted / medium-emphasis text Lc 53. 53 of 156 table items are below Lc 75. VERIFIED (`technical-typography-apca.json`). | Dark `primary` `#7BAED4` and `muted` `#A0A8B4` are too dark for 13–14 px text. | Lighten dark `primary` for text to about `#9CC4E4` (Lc ≥ 70) and `muted` to about `#B8BFC9`. Or raise `medium-emphasis-opacity` in dark to 0.8. |
| **S-02** | P2 | Mobile case table | D6 | Each filter, preset or search change on mobile shifts the table: CLS **0.18** including input, the table moving 26 px. Navigation CLS on mobile is 0.13 (Lighthouse). VERIFIED. | The preset row wraps when the "Save" button appears. On load, `table-load-indicator` and `applied-filters-bar` insert above the table. | The same fix as S-01. Reserve the indicator's 2 px row (`min-height`) at all times. |
| **S-04** | P2 | Cohort and case table, navigation | D6a | Navigation CLS above the 0.02 budget: case table **0.040**, cohort **0.093** (desktop Lighthouse median). VERIFIED. | Cohort: the applied-filters bar and load indicator mount late (+33 px). Both views: the sidebar `v-infinite-scroll__side` loader jumps from y 233 to 745 and then collapses (0.008–0.05). | Render the side loader only once the list overflows, or with a fixed slot. Render the cohort filter bar immediately with a reserved height. |
| **S-03** | P3 | Details panel | D6d | The panel skeleton flashes for 33–50 ms (150–167 ms at 4×), then the sections shift 72 px. VERIFIED. | `VariantDetailsPanel` uses a skeleton on every open. | Delay the skeleton by 300 ms (`spin-delay`) and match its height to the sections. |
| **S-05** | P3 | Shell, at 1350 px | D6 | The sidebar toggle animates `v-main` padding: 11 shifts and 0.178. This is user-initiated, so it is expected but costly. VERIFIED. | Vuetify `v-main` transition. | `.v-main { transition: none }` or `temporary` overlay mode. |
| **S-06** | P3 | Case table, empty result | D1, D2 | The "No variants match" message is centred across the 2032 px table, so its hint text is clipped at 1440 px. VERIFIED: `empty-state-clipped-filter.png`. | The no-data row spans the table's scroll width. | Make the empty slot content `position: sticky; left: 0; width: <container width>`. |
| **S-07** | P3 | Deep-link load | D6c | Home "Welcome to VarLens" appears before the case loads, then the skeleton appears twice. VERIFIED (filmstrip). | The route resolves the case after the first render. | Show a neutral placeholder while `?case=` is pending. |
| **A-04** | P3 | Filter drawer | D3 | Section overline 4.39:1 at 10 px (axe serious ×3). VERIFIED. | `text-medium-emphasis` at 10 px (`FilterDrawer.vue:846`). | Use `muted` (5.84:1, Lc 78). |
| **A-05** | P3 | Preferences, import, shortcuts dialogs | D8c | After Esc, focus goes to `<body>` instead of the origin. VERIFIED. | The menu-item origin unmounts. | Restore focus to the "Application settings" button on close. |
| **A-06** | P3 | Details panel | D8b | "Open protein view" did not open its dialog via focus + Enter within 5 s; mouse works. SUSPECTED (one run). | — | Re-test. Make sure the `@click` handler is not tied to the pointer only. |
| **E-07** | P3 | Lollipop | D4, D5 | Consequence palette deutan 4.6 (missense vs inframe). Domain pairs that match for normal vision (domain vs repeat 3.5, motif vs coiled-coil 4.6). Hard-coded `#666` / `#E0E0E0` / `#333` SVG colours in dark. SUSPECTED. | `protein-utils.ts:11-18,45-56`, `useLollipopPlot.ts:509,663,685-695`. | Use Okabe-Ito categories plus theme-token axis colours. |
| **Y-01** | P3 | Case and cohort tables | D2b | gnomAD AF and CADD are not `tabular-nums`. VERIFIED (computed style). | `table-cells` numeric cells. | Add `font-variant-numeric: tabular-nums` to the score cells. |
| **P-01** | P3 | Theme toggle | D7 | INP 208–216 ms at 4× CPU (64–72 at 1×); LoAF 190 ms. VERIFIED. | Full re-theme recalculation. | Acceptable. Optionally add `view-transition` or `requestIdleCallback` for persistence. |

No P0 was found.

---

## 9. Prior-finding status (2026-10-06, reports 03 and 04)

| Prior | Item | Status | Evidence |
|---|---|---|---|
| 03-1 | Icon buttons unnamed | **FIXED** | axe button-name 0 in 22 runs |
| 03-2 | Clickable `v-icon` row actions | **FIXED** | `AnnotationsCell.vue` uses `<button aria-label aria-pressed>` |
| 03-3 | Invalid ARIA on menu activators | **FIXED** | aria-allowed-attr 0 |
| 03-4 | CaseList role mismatch | **FIXED** | aria-required-children/parent 0 |
| 03-5 | Text contrast < 4.5 | **STILL OPEN** (narrower) | Table placeholders now pass (`muted`). Panel score chips, ACMG grid and grey chips fail (T-01 to T-04). |
| 03-6 | Target size 2.5.8 | **FIXED** | axe target-size 0 (also out of scope under the PO rule) |
| 03-7 | Row selection / panel focus | **STILL OPEN** (partial) | Focus moves to `H2.panel-heading` (fixed). Esc does not close the panel, so focus never returns (A-03). |
| 03-8 | No headings / skip link | **FIXED** | Skip link verified; panel `h2` |
| 03-9 | Dark theme unreachable or broken | **FIXED** | Preferences toggle, System default, 0 axe issues in dark. New dark issues: E-01, E-02, E-06. |
| 03-10 | "Fetch VEP" label clipped | NOT RETESTED | VEP lookups are off on this server |
| 03-11 | Non-descriptive titles | **FIXED** | "HG002-VEP-panel · Case · VarLens" |
| 03-12 | 10 px text | WITHDRAWN | PO rule: intentional density |
| 03-13 | Reduced motion | **FIXED** | 3 drawers remain (was 77) |
| 03-14/15/16 | Empty `<th>`, toolbar role, unlabelled landmarks | NOT RETESTED | The best-practice tags were not run, to match the gate |
| 03-17 | Login border + shadow | **FIXED** | 0 detector findings on login |
| 03-18 | mockApi chunk | NOT RETESTED | |
| F1 | Skeleton swap on refetch | **FIXED** | 0 flicker frames |
| F2 | EmptyState import CTA, home CLS 0.19 | **FIXED** | Home CLS 0.013 |
| F3 | Sidebar auto-collapse on case select | **FIXED** | Switch-case CLS 0.0025. The manual toggle still animates (S-05). |
| F4 | No compression or immutable cache | **FIXED** | `content-encoding: br`, `max-age=31536000, immutable` |
| F5 | Unused Google font | **FIXED** | No `fonts.googleapis` in `index.html` |
| F6 | Bootstrap waterfall | **FIXED** | `modulepreload` for vuetify plus the CSS `<link>` in the HTML |
| F7 | Heavy startup chunks | **FIXED** | unused-JS 873 → 149 KiB |
| F8 | 300 ms filter debounce | **FIXED** | Preset first content change at 136 ms (was 545 settle) |
| F9 | Filter bars push the table | **STILL OPEN** | Desktop filter is 0.001, but panel open/close is 0.21/0.31 (S-01), mobile is 0.18 (S-02) and cohort navigation is 0.09 (S-04). |
| F10 | Cohort "undefined (undefined cases)" | NOT RETESTED | The settled label "GRCh38 (10 cases)" is correct |
| F11 | Row render cost and INP | **FIXED** | 4× CPU table INP ≤ 136 ms (was 664–928) |
| F12 | Console errors (BP 95) | **FIXED** | BP 1.00 everywhere |
| F13 | Theme flash | **REGRESSED** (new form) | Now light → dark for dark-OS users (E-01) |
| F14 | A11y blockers list | **FIXED** | Lighthouse A11y 100 |
| F15 | Login SEO | NOT RETESTED | `noindex` is intentional |

**Counts (33 prior items):** FIXED 21 · STILL OPEN 3 · REGRESSED 1 · WITHDRAWN 1 · NOT RETESTED 7.

---

## 10. Scores (schema §1, §4, §5; this assessment's dimensions only)

Weights: D2 6, D3 7, D4 6, D5 5, D6 8, D7 8, D8 10. D3, D4 and D5 take the worse of the two themes.

- **D8 is capped at 50 on every authenticated view** because of the P1 A-02 (shell focus ring).
- **D6 is capped at 50** on the case table and the details panel because of the P1 S-01.

| View | vw | D2 | D3 | D4 | D5 | D6 | D7 | D8 | View score |
|---|---|---|---|---|---|---|---|---|---|
| Login | 3 | 100 | 100 | — | 50 (flash) | 100 | 100 | 100 | **94** |
| Home / case list | 8 | 75 | 100 | 100 | 50 | 75 | 75 | 50 | **74** |
| Case variant table (+ filter and columns drawers) | 22 | 75 | 50 | 75 | 50 | 50 (cap) | 100 | 50 (cap; A-01, A-03) | **64** |
| Variant details panel (+ ACMG editor/dialog) | 16 | 75 | 25 (T-01 systematic) | 75 | 50 | 50 (cap) | 100 | 50 (cap) | **61** |
| Gene schema / lollipop (computed only) | 6 | — | 50 | 25 (P1 E-05) | 50 | n/m | n/m | n/m | **42** (D3/D4/D5 only) |
| 3D structure | 4 | not measurable in web (lookups off). Legend uses `CLINVAR_COLORS`, so E-05 applies. | | | | | | | — |
| Cohort | 13 | 75 | 50 | 75 | 50 | 50 | 100 | 50 | **64** |
| Import dialog | 9 | 75 | 100 | — | 50 | 100 | 75 | 50 | **75** |
| Settings / preferences | 4 | 75 | 100 | — | 50 | 100 | 100 | 50 | **80** |

- n/m = not measurable in web mode.
- **Technical sub-score:** `O_raw ≈ 66` (vw-weighted over the 8 scored views, vw total 81).
- **Gates:**
  - No P0.
  - D8 is not below 50 on any core view, so there is no 69 cap.
  - **CI thresholds fail:** CLS per interaction (0.21 / 0.31 including input) and navigation CLS (0.09 > 0.02). That caps the overall score at 79, which is not binding.
  - Result: **O ≈ 66, "needs work"**.

**Comparison:**
- Baseline Assessment B was 13/20 (≈ 65 %) and "Snappiness and stability" was 4.5/10.
- Measured performance and stability are now excellent: D7 is 100 on the core views and the table flicker is gone.
- The score is held down by four items: the P1 caps from the shell focus ring and the panel reflow, the unthemed Material colours, and the dark-mode and CVD encoding gaps.
- **Fixing A-02 and S-01**, which are about two small CSS changes, lifts D6 and D8 to 75 on the core views. That raises the sub-score to about 74.

**Dimension profile** (vw-weighted, scored views): D2 76 · D3 63 · D4 72 · D5 50 · D6 61 · D7 96 · D8 53.

---

## 11. Not covered or caveats

- **Lollipop and Mol\* were not rendered.** External lookups are disabled on this shared server, and I did not change admin settings because that would alter state other agents share. Their colour and CVD findings are computed from source.
- **The ClinVar LP and LB contrast figures are computed only.** The fixtures contain no ClinVar classes beyond numeric codes and "other".
- **The mobile "open details" step could not run** in Lighthouse or Playwright, because the row click target is off-screen in the 390 px layout. Other agents cover mobile UX.
- **The best-practice axe tags were not run**, to match the CI gate. Baseline items 03-14 to 03-16 are therefore not retested.
