# 08b — Ponytail fix review: theme, colour, typography

- **Scope:** X-02, X-04, X-07, X-08, X-09, C-01, X-10 and the dark-mode plot / 3D side-panel issue (03 F-14). Code at `bfd3d80e` (v0.83.0), read-only.
- **Approach:** fix at the theme/token level once and point the callers at it. Every proposal below was checked against the source lines. No sizes grow (product rule: dense UI).
- **CVD check:** Machado 2009 matrices (severity 1.0, linear RGB), CIEDE2000 through the `colorjs.io` 0.7.1 that is already in `node_modules` (via `sass-embedded`). The pass bar is ΔE00 ≥ 10 for every pair under normal, protan, deutan and tritan vision, plus ≥ 4.5:1 text contrast on `surface`. The script was a throwaway (session scratchpad `cvd.mjs`). The results are in §Shared semantic colour map.

## Shared semantic colour map (answer to X-09, used by X-08 and C-01)

**One map, defined once and consumed everywhere.** The hex values live in `src/shared/config/domain.config.ts` as `SEMANTIC_COLORS = { light, dark }`, so the SVG and Mol* code in `shared/utils/protein-utils.ts` can import them. `plugins/vuetify.ts` spreads `SEMANTIC_COLORS.light` / `.dark` into `warmLight` / `warmDark`. Chips then use token names, and SVG/Mol* use the light hex values (see #6).

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `error` (changed) | `#8E1B1B` (was `#B71C1C`) | `#FF8A8A` (was `#EF9A9A`) | ACMG/ClinVar **P**, impact HIGH, hom, high score |
| `acmg-lp` (new) | `#B34D00` | `#FFC078` | ACMG/ClinVar **LP**, ClinVar P/LP |
| `muted` (existing) | `#5C6370` | `#A0A8B4` | **VUS**, impact MODIFIER, low score |
| `acmg-lb` (new) | `#2B6CB0` | `#9CCBFF` | **LB**, ClinVar B/LB |
| `acmg-b` (new) | `#0B2E6B` | `#5C8DFF` | **B** |
| `warning` (changed) | `#9A5B00` (was `#BF360C`) | `#FFD166` (was `#FFB74D`) | impact MODERATE, het, mid score |
| `info`, `clinvar-conflicting` | unchanged | unchanged | LOW / hemi; conflicting |
| `on-surface` | existing | existing | ClinVar "other / not provided / drug response…" (neutral) |

Verified worst pairs (ΔE00, min over N/P/D/T):

| Scale | Light | Dark |
|---|---|---|
| ACMG/ClinVar P·LP·VUS·LB·B | P~LP **11.6** (all others ≥ 15.9) | P~LP **11.0** (all others ≥ 14.5) |
| Impact / zygosity HIGH·MOD·LOW·MODIFIER | HIGH~MOD **12.4** | HIGH~MOD **15.1** |
| *Today:* `error`~`warning` | **4.0** (deutan 4.6, tritan 4.0) | — |
| *Today:* lollipop LP~LB (RdYlGn) | deutan **2.5** | — |

- **Text contrast.** Every token is ≥ 5.1:1 on the light surface and ≥ 5.4:1 on the dark one. As non-text marks they are all ≥ 3:1.
- **The 07 proposal fails.** The amber warning `#8A5300` proposed in 05/07 collapses into `error` under deuteranopia (ΔE 1.8). The fix works because `error` gets darker and `warning` lighter, so the two are separated by lightness, not by hue.

**Every place that must use the map** (case and cohort read the same constants, so parity is automatic):

| Place | Today | Change |
|---|---|---|
| `shared/config/domain.config.ts:20-26` `ACMG_COLORS` (row chip `AnnotationsCell.vue:36`, `AcmgSummaryBar.vue:5,13,82`, `AcmgMenu.vue:15`, `AcmgQuickMenu.vue:16`, `VariantDetailsPanel.vue:111`) | hex, same in both themes | `'error' / 'acmg-lp' / 'muted' / 'acmg-lb' / 'acmg-b'` |
| `renderer/src/utils/filters/constants.ts:12-28` `ACMG_FILTER_OPTIONS(_LONG)` (FilterToolbar, FilterDrawer, CohortFilterBar, CohortFilterDrawer) | its own colours (VUS = warning, LB = blue-grey) | `color: ACMG_COLORS[value]`, one source |
| `shared/config/severity.config.ts:136-293` `CLINVAR_CATEGORIES` + `:571` `NEUTRAL_SEVERITY_COLOR` | error / orange / warning / light-green / success / grey | P `error`, P/LP + LP `acmg-lp`, VUS `muted`, B/LB + LB `acmg-lb`, B `acmg-b`, the 7 greys + neutral `on-surface` |
| `composables/useTableColors.ts:36-56` impact + CADD | `grey`, `orange` | MODIFIER/null → `muted`; CADD ≥ 20 `orange` → `error` (5 bins → 4: error / warning / info / muted) |
| `cohort/CarrierExpandedRow.vue:94` zygosity | error / warning / info | none needed; it is fixed by the token change |
| `shared/utils/protein-utils.ts:61-68` `CLINVAR_COLORS` (lollipop, gene structure, 3D legend, Mol*) | RdYlGn hex | `SEMANTIC_COLORS.light` values, `other` → muted |

---

## Must fix

### 1. X-02 — Focus ring invisible on the app bar
- **What this is:** the keyboard focus outline on the 9 header controls.
- **Problem:** the ring is drawn in `primary` on a `primary` app bar, so its contrast is 1.00:1 in both themes. This is a P1 that caps D8 for every view.
- **Fix:** make the ring colour a CSS variable, and set that variable once on the app bar. This is not 4 separate overrides.
  ```css
  /* custom.css:104-133, the 4 rules */
  - outline: 2px solid rgb(var(--v-theme-primary)) !important;
  + outline: 2px solid var(--vl-focus, rgb(var(--v-theme-primary))) !important;
  + .v-app-bar { --vl-focus: rgb(var(--v-theme-on-app-bar)); }  /* from #2; else on-primary */
  ```
  Menus are teleported out of the app bar, so they keep the primary ring.
- **If we skip it:** keyboard users cannot see where they are in the shell (WCAG 2.4.7 / 2.4.11).
- Root cause: VERIFIED — `src/renderer/src/assets/styles/custom.css:104-133` (focus ring) + `components/AppToolbar.vue:2` (`color="primary"`)
- Size: +2 lines (4 edited)
- Test: none needed (CSS only). Re-run the keyboard pass `technical/kbd2.cjs` and check that the app-bar ring is ≥ 3:1. The light ring is white on navy (11.5:1). The dark ring is `#E4E7EC` on `#30353E` (9.9:1).
- Verdict: **DO**

### 2. X-04 — Dark app bar is a light-blue slab (merged with X-02)
- **What this is:** the top bar is filled with `primary`, and in dark mode `primary` is `#7BAED4`.
- **Problem:** this is the loudest element on a near-black UI. It is also the cause of X-02.
- **Fix:** add two theme tokens and use them in one place. The light theme looks the same as today.
  ```ts
  // vuetify.ts, warmLight / warmDark
  + 'app-bar': '#1E3A5F', 'on-app-bar': '#FFFFFF',     // light: unchanged look
  + 'app-bar': '#30353E', 'on-app-bar': '#E4E7EC',     // dark: surface-bright
  // AppToolbar.vue:2      color="primary" → color="app-bar"
  // AppToolbar.vue:391-398 --v-theme-on-primary/--v-theme-primary → on-app-bar/app-bar (3 refs)
  ```
- **If we skip it:** the dark theme keeps a glare band, and the focus ring needs its own workaround.
- Root cause: VERIFIED — `components/AppToolbar.vue:2`, `plugins/vuetify.ts:77`
- Size: +4 / ~4 edited
- Test: none needed (trivial token swap). Check visually: `state-case-table-dark` screenshot.
- Verdict: **DO**

### 3. X-08 + X-09 + C-01 — One CVD-safe semantic map (see the table above)
- **What this is:**
  - three ACMG colour schemes and two ClinVar schemes;
  - Material named colours that ignore the theme (`orange`, `light-green`, `grey`, `blue-grey`, `deep-orange`);
  - `error` ≈ `warning`;
  - a red/green-only lollipop and 3D view.
- **Problem:** text runs from 1.97:1 to 4.22:1. VUS looks like Pathogenic. A filter chip and a row chip show the same class in different colours. Under deuteranopia, LP and LB in the protein view are almost the same colour (ΔE 2.5).
- **Fix:** add `SEMANTIC_COLORS` (+14 lines), change 2 tokens and add 3, then repoint the callers in the table above. Further simplifications:
  - Delete the gnomAD threshold branch (#5).
  - Delete the lollipop `opacity: 0.7` (`useLollipopPlot.ts:412`), which drags the non-text contrast below 3:1.
- **If we skip it:** colour misleads at triage. The labels save it, but every reader has to read them.
- Root cause: VERIFIED —
  - `shared/config/domain.config.ts:20-26`
  - `utils/filters/constants.ts:12-28`
  - `shared/config/severity.config.ts:136-293,571`
  - `plugins/vuetify.ts:44-48,85-88`
  - `shared/utils/protein-utils.ts:61-68`
  - `useLollipopPlot.ts:403-413`
- Size: about +20 / −12 lines (mostly value edits)
- Test: extend `tests/renderer/plugins/clinvar-theme-tokens.test.ts` (or rename it `semantic-theme-tokens.test.ts`). The assertions:
  1. Every colour used by `CLINVAR_CATEGORIES`, `ACMG_COLORS`, `ACMG_FILTER_OPTIONS` and the impact map is a token in both themes at ≥ 4.5:1.
  2. `ACMG_FILTER_OPTIONS[i].color === ACMG_COLORS[value]`.
  3. The luminance ratio is ≥ 1.4 for `error`/`warning` and for `error`/`acmg-lp` in both themes. This is a cheap proxy for CVD lightness separation: today 1.17, proposed 1.67 / 1.49.

  The test fails today on `orange`, `grey` and the 1.17 ratio. The test parses `vuetify.ts` source with a regex, so import `SEMANTIC_COLORS` directly instead of parsing a spread.
- Verdict: **DO**

## Should fix

### 4. X-08 — The remaining hard-coded low-contrast colours
- **What this is:** these are the leftovers once the semantic map exists:
  - ACMG evidence buttons;
  - score chips;
  - Fetch VEP;
  - the transcript source chip.
- **Problem:**
  - inactive evidence buttons are 1.97–4.22:1;
  - grey score chips are 1.81–2.59:1;
  - `deep-purple` is 2.31:1 in dark;
  - `blue-grey` is 4.22 / 3.87:1.
- **Fix (no new tokens):**
  - `AcmgEvidenceGrid.vue:113-122`: **delete `INACTIVE_COLORS`**. Inactive buttons become `'on-surface'` outlined. Strength is already shown by the group header ("Strong (4 pts)", lines 9-12). Change suggested `amber-darken-2` → `warning`, deprecated `grey` → `muted`, and the 0-points chip (line 5) `grey` → `muted`. Active `STRENGTH_COLORS` are flat fills, and Vuetify's Material `bg-*` classes set a readable text colour, so keep them.
  - `scoreThresholds.ts:32-46`: `grey` / `grey-lighten-1` → `muted` (3 returns).
  - `TranscriptSection.vue:124-126,203,214`:
    - Fetch VEP → `primary`;
    - source `imported` → `secondary`;
    - source `vep` → `info`;
    - `teal` → `success`;
    - the "VEP loaded" chip → `info`.
  - `AcmgSummaryBar.vue:55,67`: Auto-suggest `amber-darken-2` → `warning`, and `grey-darken-1` → `secondary`.
- **If we skip it:** the ACMG dialog, the main curation surface, keeps 36 failing text nodes.
- Root cause: VERIFIED — `AcmgEvidenceGrid.vue:105-142`, `scoreThresholds.ts:32-46`, `TranscriptSection.vue:124-126,203`, `AcmgSummaryBar.vue:55`
- Size: −10 / ~12 edited
- Test: the same token test (#3) can also assert that `getScoreColor` and `getImpactColor` return only theme tokens. Otherwise none needed.
- Verdict: **DO**

### 5. X-09 — gnomAD AF painted red
- **What this is:** in the details panel, the gnomAD chip turns `error` red when AF ≤ 1e-4.
- **Problem:** the colour for "pathogenic/alarm" is reused to mean "rare".
- **Fix:** drop `:color` on the gnomAD chip (`AnnotationScoresSection.vue:13`) and delete the now-dead `gnomad_af` / `low-bad` branch in `scoreThresholds.ts:12,22,42-47`. Its only caller is that one chip (grepped), and it has no tests. Rarity is already in the number.
- **If we skip it:** red keeps two meanings in one panel.
- Root cause: VERIFIED — `components/AnnotationScoresSection.vue:13`, `utils/scoreThresholds.ts:22,42-47`
- Size: −9 lines
- Test: none needed (deletion)
- Verdict: **DO**

### 6. F-14 — Dark-mode plot labels and 3D side panel invisible
- **What this is:** the lollipop and gene-structure SVGs hard-code `#666` / `#333` / `#999`. The 3D side panel hard-codes `#faf8f6`.
- **Problem:** in dark mode the plot text is dark on near-black, and the 3D panel stays white while its text turns light.
- **Fix (lean):** treat the plots as light "paper" figures, which they already are:
  - Mol* uses a fixed light `BG_COLOR` (`useMolstarViewer.ts:123-132`).
  - PNG export paints `#ffffff` under the SVG (`useLollipopPlot.ts:956`, `useGeneStructurePlot.ts:628`).

  So wrap only the plot area and the 3D side panel in the house component `<v-theme-provider theme="warmLight" with-background>`. That is 3 wrappers, in `LollipopPlotPanel.vue`, `GeneStructurePanel.vue` and `ProteinStructure3DPanel.vue`. All hard-coded greys, the light `CLINVAR_COLORS` hex values and the export then match. In the 3D panel, `#faf8f6` (`:298,308`) → `rgb(var(--v-theme-surface))`.
- **If we skip it:** the plot titles, axis labels and 3D legend text cannot be read in dark mode.
- Root cause: VERIFIED —
  - `useLollipopPlot.ts:509,663,685,695`
  - `useGeneStructurePlot.ts:167,219,286,361,371,381`
  - `ProteinStructure3DPanel.vue:298,308`
- Size: about +6 lines
- Test: none needed (template wrapper). Check visually in dark: d26/d27 states.
- Verdict: **DO**
- **Leaner than 07:** 07 asks for "full dark coverage incl. lollipop, Mol\* reads theme tokens on mount and on theme change". That means re-rendering D3 and Mol\* on every theme change and keeping a second palette for the marks. It is DO-LATER at most.

### 7. X-07 — Theme flash (smallest correct pre-paint fix)
- **What this is:** the pre-mount HTML and the Electron window background are hard-coded light, and their comments still say "app ships a light theme only", which is no longer true. Vuetify already resolves the right theme before mount (`plugins/vuetify.ts:105`, `utils/theme-preference.ts:62`).
- **Problem:** a dark-OS user sees light login → light blank → dark app. Under the dark app, `html`/`body` also stay light (the scrollbar gutter, overscroll).
- **Fix:** CSS first, plus one line of JS after mount. **No inline script**: `src/renderer/index.html` and `web/server/static.ts:24` use CSP `script-src 'self'`, so the inline `localStorage` script proposed in 05 E-01 would be blocked.
  ```html
  <!-- src/renderer/index.html:19-27 and src/web/index.html:14-22 -->
  <meta name="color-scheme" content="light dark" />
  @media (prefers-color-scheme: dark) { :root:not([data-theme='light']), :root:not([data-theme='light']) body { background:#12141A; color:#E4E7EC; color-scheme:dark } }
  :root[data-theme='dark'], :root[data-theme='dark'] body { background:#12141A; color:#E4E7EC; color-scheme:dark }
  ```
  - `useThemePreference.ts:21`, in `apply()`: `document.documentElement.dataset.theme = name === 'warmDark' ? 'dark' : 'light'` (+1 line).
  - `src/main/index.ts:84`: `backgroundColor: nativeTheme.shouldUseDarkColors ? '#12141A' : '#F0F4F8'` (+ the `nativeTheme` import).
  - `src/web/login/login.html:14,28-59`: `color-scheme: light dark`, and one `@media (prefers-color-scheme: dark) { :root { … } }` that redefines its existing ~10 CSS variables.
  - The renderer boot splash also needs its 2 colours in the same media block.
- **If we skip it:** dark-OS users get a white flash on every launch and every sign-in.
- Root cause: VERIFIED —
  - `src/renderer/index.html:15-27`
  - `src/web/index.html:11-22`
  - `src/web/login/login.html:11-14,58`
  - `src/main/index.ts:84`
- Size: about +32 lines
- Test: extend `tests/renderer/utils/theme-preference.test.ts`, or add a useThemePreference test: after a preference change, `document.documentElement.dataset.theme === 'dark'`.
- Verdict: **DO**
- `ponytail:` users who set an *explicit* theme opposite to their OS still get a one-frame pre-mount flash. Upgrade path: a 3-line `public/theme-boot.js`, loaded synchronously in `<head>` (CSP `'self'` allows it), that sets `data-theme` from `varlens_user_settings_v1`.

### 8. X-10 — Faint Courier New mono
- **What this is:** the global `--font-mono` rules already exist for `.variant-data-mono`, `.hgvs-notation` and `.genomic-coordinate` (`custom.css:2-4,74-94`). Local scoped copies override them with `'Courier New'`.
- **Problem:** Ref/Alt/HGVS render in a hairline Courier New, so the identity data is the quietest text on screen.
- **Fix:** replace `font-family: 'Courier New'…` with `font-family: var(--font-mono)` at the 10 sites, in a single sed pass. Keep each local font-size, so nothing grows.
  - `assets/styles/table-cells.scss:15,21`
  - `VariantIdentitySection.vue:158,163,169`
  - `VariantTable.vue:691`
  - `association/AssociationResultsTable.vue:199`
  - `protein/GeneStructureTooltip.vue:122`
  - `protein/ProteinTooltip.vue:240`
  - `ExtensionDetailsSection.vue:351` (`'SF Mono', Monaco`)

  Also point `ShortlistTable.vue:434` and `DslSearchBar.vue:320` at the token.
- **If we skip it:** the most important strings stay the least legible ones.
- Root cause: VERIFIED — the file:lines above
- Size: ±0 (about 12 edited)
- Test: none needed. A one-line guard could be added to `make agent-check`: grep `src/renderer` for `Courier New`, expect 0.
- Verdict: **DO**

## Nice to have

### 9. X-10 — Bundled UI font (the 07 proposal: Inter + JetBrains Mono)
- **What this is:** no UI font ships. Vuetify uses `var(--v-font-body, "Roboto", sans-serif)` 91× in `vuetify/lib/styles/main.css`, so text falls back to Arial on Windows and to DejaVu Sans on Linux.
- **Facts:**
  - No `@fontsource*` package is installed. It would be a new dependency.
  - Offline packaging is fine: Vite bundles the woff2 and the CSP already has `font-src 'self'`.
  - Cost: about 70 KB (Inter Variable, Latin) plus about 20–40 KB per mono weight.
  - The new font metrics change row heights on every OS. That means re-baselining the CLS / perf-interaction gates, the Lighthouse runs and the docs screenshots.
- **Lean recommendation:** do not bundle now. Add one line, `:root { --v-font-body: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }`, in `custom.css:1`. It is the same stack `login.html:52` already uses. This gives Segoe UI on Windows (not Arial), SF on macOS and the desktop UI font on Linux. Together with #8, which moves mono to the existing `--font-mono`, that removes the legibility problem.
- **When to bundle:** only if the PO wants pixel-identical density across operating systems. Then bundle Inter only and keep `--font-mono` on system monospace.
- **If we skip it:** Windows stays on Arial.
- Root cause: VERIFIED — `node_modules/vuetify/lib/styles/main.css` (`--v-font-body` fallback), no `--v-font-body` in `src/renderer`
- Size: +1 (system stack); bundling would be about +5 lines + 1 dependency + gate re-baselines
- Test: none needed. Do run `make perf-interaction-gates` and `make ui-gates`, because metrics shift.
- Verdict: system stack **DO**; bundle **DO-LATER** (PO decision)

### 10. E-06 (related) — Dark-theme APCA for 12–14 px text
- **What this is:** dark `primary` `#7BAED4` (link text) and `muted` `#A0A8B4` reach only Lc 51–54.
- **Problem:** dense dark-mode text is soft.
- **Fix:** two token values: `muted` → `#B8BFC9`, `primary` → `#9CC4E4`. After #2 the app bar no longer uses `primary`, so there is no glare cost. The `acmg-vus` alias follows `muted`. VUS~LB stays ≥ 14 ΔE, but re-run the CVD script.
- **If we skip it:** dark mode stays a notch less legible than light.
- Root cause: VERIFIED — `plugins/vuetify.ts:77,93`
- Size: ±0 (2 values)
- Test: covered by the #3 token-contrast test
- Verdict: **DO**, with #3

### 11. C-01 extra — Shape cue on ClinVar diamonds
- **What this is:** 05 E-05 proposes filled, hollow and dot shapes per class.
- **Problem:** with the #3 palette, the worst CVD ΔE is 11. The legend and tooltip give the text, and the legend toggles let users isolate a class.
- **Fix:** not needed now.
- **If we skip it:** colour remains the only on-plot cue. That is WCAG 1.4.1 borderline, but mitigated.
- Root cause: VERIFIED — `useLollipopPlot.ts:403-413`
- Size: about +15
- Test: —
- Verdict: **DO-LATER**

## Over-engineered proposals in 02–07, and the leaner alternative

| Report proposal | Leaner |
|---|---|
| 07 §3: theme tokens for **all four scales** (`acmg-p…b`, `impact-high…`, ClinVar, zygosity) | Impact and zygosity already use `error / warning / info`. Fix those two tokens once. ACMG and ClinVar share one 5-step map, and P/VUS reuse `error`/`muted`. **3 new tokens, not ~15.** |
| 05 T-01: a new `acmg-*` **strength** token set with dark variants | Delete `INACTIVE_COLORS`. Strength is already labelled by the group header (#4). |
| 05/07: warning → amber `#8A5300` | It fails deutan vs error (ΔE 1.8). Use darker error + `#9A5B00` (#3, verified). |
| 05 E-01: an inline `localStorage` script in `index.html` | Blocked by CSP `script-src 'self'`. Use the CSS media query plus `data-theme` from `useThemePreference` (#7). |
| 07 §3: Mol\* and D3 read theme tokens on mount and on theme change | A `v-theme-provider` light island, consistent with the PNG export and the Mol\* background (#6). |
| 07 §2: bundle Inter + JetBrains Mono + a `--vl-fs-*` / `--vl-row-h` token system | One `--v-font-body` system stack + the existing `--font-mono` (#8, #9). The density tokens are a separate project. |
| 05 A-02: per-selector `.v-app-bar :focus-visible` `!important` override | One `--vl-focus` variable set on `.v-app-bar` (#1). |

## Summary

| # | ID | Verdict | Size |
|---|---|---|---|
| 1 | X-02 app-bar focus ring | DO | +2 |
| 2 | X-04 dark app bar (`app-bar` token) | DO | +4 |
| 3 | X-08/X-09/C-01 shared CVD-safe semantic map | DO | +20 / −12 |
| 4 | X-08 evidence grid, score chips, Fetch VEP, source chips | DO | −10 |
| 5 | X-09 gnomAD AF red | DO | −9 |
| 6 | F-14 dark plots / 3D side panel (light theme-provider) | DO | +6 |
| 7 | X-07 theme flash (CSS + `data-theme` + Electron bg) | DO | +32 |
| 8 | X-10 Courier New → `--font-mono` | DO | ±0 |
| 9 | X-10 bundled UI font | system stack DO / bundle DO-LATER | +1 |
| 10 | E-06 dark APCA tokens | DO | ±0 |
| 11 | C-01 shape cue | DO-LATER | +15 |

Not checked:
- I did not run the app.
- Lollipop and Mol\* contrast in dark is inferred from source; their palettes were computed, not rendered.
- I did not check whether Material `bg-*` classes give the active evidence buttons ≥ 4.5:1.

Risk:
- Darkening `error` changes every error button and alert.
- `acmg-b` `#0B2E6B` sits close to the navy `primary`.
- Re-run `make ui-gates` and `make perf-interaction-gates` after #9.
