# Assessment B — Deterministic Detector + Automated Accessibility Evidence

- Date: 2026-10-06 · Build under test: VarLens v0.72.0 web mode (`http://localhost:8787/`, admin session)
- Assessor: Assessment B (independent; prior review files were not read)
- Tools: impeccable CLI 0.1.5 (`detect`, `live-server` `/detect.js` overlay), axe-core 4.14.0 (injected), Playwright 1.63 Chromium (headless, 1440x900), custom probes (headings, landmarks, names, tab order, target size, reflow, reduced motion, contrast spot scan), source greps.
- Raw evidence in this directory:
  - `03-detector.json`: CLI and browser-overlay findings.
  - `03-axe-<state>-<light|dark>.json`: axe violations (8 example nodes each) plus incomplete counts.
  - `03-probes.json`: probes, tab-through traces, reflow, axe-by-component, contrast spot scans.

## Method notes and caveats

- **States tested:**
  - `login` (unauthenticated).
  - `home` (case list sidebar + EmptyState).
  - `case-table` (case LB26-0060, SNV/Indel tab).
  - `case-details` (the same table with the Variant Details panel open on the first row).
  - `cohort` (Cohort mode, Variants tab).
- The URL stays `/` in every state. The SPA does not change the path when the view changes.
- **CSP preflight.** The app's CSP (`script-src 'self' 'unsafe-eval' …`) blocks both inline scripts and the external `localhost:8400/detect.js`:
  - `document.title` mutation works.
  - An appended inline `<script>` does not execute.
  - Because of this, all injections (detect.js, axe) used a Playwright context with `bypassCSP: true`. This is a test-harness choice. It is not a weakness in the app; the strict CSP is a positive security finding.
- **Dark theme has no in-app toggle.** `warmDark` is defined (`src/renderer/src/plugins/vuetify.ts:59-82`), but nothing in `src/` calls `useTheme` or switches it. Dark results come from forcing the theme through the app's Vuetify theme instance. They describe a latent state that users cannot reach today. `login.html` has its own `prefers-color-scheme` dark tokens; it was tested by emulating the color scheme.
- axe left many `color-contrast` checks "incomplete" in table views (193–215 nodes), because of sticky and stacked backgrounds. To cover that gap, a custom contrast spot scan composites alpha and opacity over visible text in the viewport.
- The live server was started with `impeccable live-server --background` (pid 365247, port 8400) and stopped with `impeccable live-server stop`. `stop` printed `config_missing` while trying to remove a live script tag. This is harmless: no inject had been performed, and `git status` confirmed no source changes.

## 1. Impeccable CLI detector

| Target | Exit | Primary findings | Advisory |
|---|---|---|---|
| `src/renderer/src` (369 files incl. web) | 0 | 0 | 0 |
| `src/renderer/src --no-config` (ignores off) | 0 | 0 | 0 |
| `src/web` | 0 | 0 | 1 |
| `http://localhost:8787/login` (URL scan) | 0 | 0 | 0 |

- **Inline ignores and detector config.** There are no `impeccable-disable` comments in `src/`. `.impeccable/config.json` only ignores `src/renderer/public/**`. The clean result is not an artifact of suppression.
- **Advisory `gpt-thin-border-wide-shadow`** at `src/web/login/login.html` (card at lines 86-88: `1px solid var(--border)` plus `--shadow` with a 16px blur).
  - Verified true positive, cosmetic only. Pick either the edge or the elevation.
- **Caveat on coverage.** The static detector reads authored markup and CSS only. It cannot see Vuetify-generated DOM, utility-class colors (`text-grey`), or runtime ARIA. A clean CLI run says nothing about the runtime a11y defects below.

## 2. Browser overlay detector (`/detect.js`)

Counts are de-duplicated: detect.js logs each finding twice.

| State | Total | layout-transition | low-contrast | clipped-overflow | undersized-ui-text (10px) | tiny-text (11.9px) | nested-cards | edge-flush-cards | overused-font | cramped-padding |
|---|---|---|---|---|---|---|---|---|---|---|
| login | 0 | – | – | – | – | – | – | – | – | – |
| home | 29 | 24 | 3 | 1 | – | – | 1 | – | – | – |
| case-table | 77 | 62 | 2 | 5 | 6 | – | 1 | 1 | 1 | – |
| case-details | 85 | 66 | 3 | 6 | 6 | – | 2 | 1 | 1 | 1 |
| cohort | 80 | 61 | 1 | 8 | 4 | 4 | 1 | – | 1 | 1 |

What each rule found, checked in context:

- **layout-transition** (`transition: width` / `height, width, max-width` / `margin-top, max-width` / `padding`): **mostly a framework false positive.**
  - These are Vuetify internals: `v-navigation-drawer` width, `v-field` label and outline, `v-expansion-panel`. None are authored transitions.
  - Low practical impact on a desktop data tool. P3 at most.
- **low-contrast**: **true positive.**
  - `#9e9e9e` on `#fafbfd` gives 2.6:1. These are `text-grey` placeholders (see §3).
  - `#757575` and `#9e9e9e` on `#f0f4f8` give 4.2:1 and 2.4:1 in `EmptyState.vue`.
- **undersized-ui-text 10px** ("Variant Properties", "Population & Scores", "Annotations", "Inheritance", "Structural Variants", "6399"):
  - **True in source:**
    - `FilterDrawer.vue:849` and `cohort/CohortFilterDrawer.vue:672` set `font-size: 10px`.
    - `assets/styles/custom.css:69` sets `.v-menu .v-list-subheader` to 0.625rem.
    - The count badge sets 10px.
  - **Partly a false positive at runtime:** the drawer section labels were in a closed drawer when measured. The tab-count badge "6399" is visible.
- **tiny-text 11.9px** (cohort): true. Dense table body text sits under 12px. P3: this is a deliberate density choice, so it is a judgment call.
- **clipped-overflow-container**: largely intended (`div.case-content`, `table-container`, and `v-card h-100` scroll containers).
  - One real visual defect correlates with it: the **"Fetch VEP" button label is clipped vertically** in `TranscriptSection.vue:188-196`. It is visible in the 1440 and 640 screenshots.
- **nested-cards / edge-flush-cards / cramped-padding / overused-font (Roboto 68–82%)**: advisory and stylistic. The edge-flush finding is the data-table header flush to its wrapper, which is intended. These are not defects.

## 3. Automated accessibility (axe-core 4.14.0)

Tags: wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice. Cells give the node count; impact is in brackets.

| Rule (WCAG SC) | login L/D | home L | home D | case-table L/D | case-details L | case-details D | cohort L/D |
|---|---|---|---|---|---|---|---|
| button-name [critical] (4.1.2, A) | 0 | 2 | 2 | 20 | 30 | 30 | 42 |
| aria-command-name [serious] (4.1.2, A) | 0 | – | – | 50 | 50 | 50 | 75 |
| aria-required-children [critical] (1.3.1, A) | 0 | 1 | 1 | – | – | – | – |
| aria-required-parent [critical] (1.3.1, A) | 0 | 3 | 3 | – | – | – | – |
| aria-allowed-attr [critical] (4.1.2, A) | 0 | – | – | 26 | 26 | 26 | 1 |
| aria-tooltip-name [serious] (4.1.2, A) | 0 | 19 | 19 | 243 | 252 | 252 | 102 |
| color-contrast [serious] (1.4.3, AA) | 0 | 8 | 1 | 0 (193 incomplete) | 7 | 0 | 0 (215 incomplete) |
| target-size [serious] (2.5.8, AA) | 0 | – | – | 2 | 2 | 2 | 53 |
| page-has-heading-one [moderate] (BP) | 0 | 1 | 1 | 1 | 1 | 1 | 1 |
| empty-table-header [minor] (BP) | 0 | – | – | 1 | 1 | 1 | 2 |
| aria-allowed-role [minor] (BP) | 0 | – | – | 1 | 1 | 1 | 1 |

L = light, D = forced dark. Where a cell reads "L/D", the counts were identical in both themes.

- **Login is clean** in both schemes: 0 violations, 0 incomplete.
- **Component attribution.** Scoped-style `data-v-*` hashes were reversed to source files by recomputing plugin-vue's hash against root `src/web`. Every one was verified.

| Rule | Where the nodes come from |
|---|---|
| aria-command-name 50/75 | Row action icons. `VariantTable.vue` → `table-cells/AnnotationsCell.vue` (unscoped, so attributed to its parent). Cohort: `cohort/CohortDataTable.vue`. |
| button-name | `variant-table/VariantColumnHeader.vue` (14–16 per view), `FilterToolbar.vue` (2), `cohort/CohortFilterBar.vue` (2), `PresetBar.vue` (1), `AppToolbar.vue` (1), `AppSidebar.vue` (2, attributed to `App.vue`), `VariantIdentitySection.vue`, `ExternalLinksSection.vue` (7), `CohortDataTable.vue` (25: Vuetify `show-expand` chevrons). |
| aria-allowed-attr | `AnnotationsCell.vue` `<span v-bind="menuProps">` activators (25) and `DslSearchBar.vue` (1). Both put `aria-expanded` on a span or div with no role. |
| aria-required-children/parent | `CaseList.vue:69-98`. The `v-list` renders `role="list"` with `role="option"` children. |
| aria-tooltip-name (100–250) | Vuetify `v-tooltip` overlays mounted with no content. This is mostly a framework artifact. It confirms the codebase pattern of naming icon buttons only through tooltips, which never become the accessible name. |
| target-size | `FilterToolbar.vue` / `CohortFilterBar.vue` 20x20 icon buttons. Cohort row icons are 17.5x17.5 (51). |

- **Contrast spot scan** (composited, visible viewport) confirmed and extended axe:
  - **Light theme:**
    - `text-grey` `#9e9e9e` on `#fafbfd` gives 2.59:1. It appears on 46 table placeholders ("--") in `table-cells/EmptyPlaceholder.vue:2`, `VariantTable.vue:220` and `table-cells/ClinVarCell.vue:21`.
    - The same pair appears in `VariantIdentitySection.vue:70` ("rsID:", "N/A"), `TagsSection.vue` ("No tags assigned"), `InlineEditableText.vue` ("Add a global comment…") and the CADD/gnomAD score chips in `VariantDetailsPanel`.
    - CaseList subtitles and field labels: `#85878b` on `#fafbfd` gives 3.47:1.
    - EmptyState: `#9e9e9e` on `#f0f4f8` gives 2.42:1.
  - **Forced dark theme:**
    - App bar mode toggle "Case"/"Cohort": 1.91–2.11:1 (`AppToolbar.vue:325-332`, hard-coded `rgba(255,255,255,.85)`).
    - "Select a case…": 4.34:1.
    - EmptyState heading: `text-grey-darken-2` gives 2.97:1 (`EmptyState.vue:6-9`).
    - "Fetch VEP": `deep-purple` `#673ab7` on `#1a1d22` gives 2.31:1.
    - Footer: hard-coded `#dfe4ea` background (`AppFooter.vue:399-401`) stays light while its text and icons switch to dark-theme light colors, so the content is near-invisible (screenshot evidence; the scanner missed it because the icons are not text nodes).

## 4. Keyboard and semantics probes

| Probe | login | home | case-table | case-details | cohort |
|---|---|---|---|---|---|
| `<html lang>` | en | en | en | en | en |
| `document.title` | "VarLens — Sign in" | "VarLens" | "VarLens" | "VarLens" | "VarLens" |
| Headings | H1 VarLens | H2 "Welcome to VarLens" only | **none** | **none** | **none** |
| Landmarks | main | header, nav×2, main, footer (unlabelled) | 13 (header×4, nav×5; 3 labelled) | same | same |
| Interactive elements / unnamed (heuristic) | 3 / 0 | 27 / 5 | 221 / 117 | 239 / 126 | 256 / 154 |
| tabindex > 0 | 0 | 0 | 0 | 0 | 0 |
| Targets < 24px (any side) | 0 | 14 | 128 | 144 | 173 |
| Focus indicator present (first 40 Tab stops) | 10/10 | 40/40 | 40/40 | 40/40 | 40/40 |
| Horizontal page scroll at 640px (1280 @ 200%) | none | none | none | none | none |
| Horizontal page scroll at 320px | none | none | none | none | none |

- **Focus visibility is good.** Every Tab stop matched `:focus-visible` and showed an outline or overlay (SC 2.4.7 pass). There is no positive tabindex.
- **No skip link.** In case and cohort views, Tab moves through about 25 toolbar and preset-chip stops, then a sort and filter-button pair for each column header, before reaching rows (SC 2.4.1).
- **Keyboard row navigation is global.** Arrow and Enter are handled by document-level `onKeyStroke` handlers (`VariantTable.vue:529-560`). Rows are never focusable.
  - Selection is a CSS class only (`variant-row--selected`, `components/variant-table/useVariantData.ts:129-136`). It has no `aria-selected` or `aria-current`, and no focus move.
  - Screen-reader users get no feedback about which variant is selected (SC 4.1.2 / 1.3.1).
  - After a row opens the details panel, focus stays on the row icons. The trace shows 40 stops inside row action icons, and the panel is reached only after roughly 150 stops (SC 2.4.3).
- **Reflow (1.4.10) passes.**
  - At 640 px the shell adapts: the mode toggle collapses to icons, the toolbar overflows into a kebab menu, and the details panel goes full-width.
  - At 320 px there is no page-level horizontal scroll. Chips and toolbars scroll inside their own containers, and the tables need 2-D scrolling, which the SC exempts.
- **Reduced motion.**
  - Only `CohortTable.vue:801` has `@media (prefers-reduced-motion: reduce)`.
  - With `reducedMotion: 'reduce'` emulated, 77 of 88 animated elements still transition (Vuetify 0.2–0.28 s micro-transitions).
  - This is low risk: SC 2.3.3 is AAA, and none of these are parallax or large motion.
- **Page titles.** `document.title` stays "VarLens" for case and cohort, and does not name the case (SC 2.4.2 is technically met, but the titles are not descriptive).

## 5. Theming integrity (source greps, `src/renderer/src`)

| Check | Result |
|---|---|
| `surface-variant` used as a background (project rule) | **0 violations.** It appears only as token definitions (`plugins/vuetify.ts:41,67`) and in comments enforcing the rule. |
| Theme-token usage `var(--v-theme-*)` in styles | 101 |
| Hard-coded hex in `.vue/.css/.scss` | 174 in `.vue`. Top: `icons/DnaIcon.vue` 170 (illustration, acceptable), `protein/ProteinTooltip.vue` 8, `protein/LollipopLegend.vue` 8, `assets/styles/custom.css` 6, `protein/GeneStructureTooltip.vue` 5, `AppFooter.vue` 2 (breaks dark). |
| Hex literals in `.ts` | `plugins/vuetify.ts` 36 (tokens, correct), `composables/useGeneStructurePlot.ts` 21, `composables/useTags.ts` 19, `composables/useLollipopPlot.ts` 15 (chart palettes, mostly acceptable) |
| Literal `rgb()/rgba()` | 29. Top: `protein/ProteinStructure3DPanel.vue` 5, `AppToolbar.vue` 3 (breaks dark), `GroupedMultiSelect.vue` 3, `ColorSwatchPicker.vue` 3. |
| Material grey utilities (`text-grey*`, `color="grey…"`) | **113.** These are the root cause of most contrast failures, and they ignore the theme. |
| Inline `style=` / `:style=` | 96. Top: `variant-details/ExtensionDetailsSection.vue` 23, `CaseMetadataCard.vue` 9, `protein/LollipopLegend.vue` 8. |
| `!important` | 74 |
| Dark theme reachable by user | **No.** There is no toggle and no `useTheme` call. When forced, the app bar, footer, EmptyState and the deep-purple accents break. |

## 6. Scores (impeccable audit dimensions)

| Dimension | Score | Rationale |
|---|---|---|
| Accessibility | **2 / 4** | Positives: lang set, clean login, focus-visible on 100% of stops, no positive tabindex, reflow OK, live regions present. Against: systematic Level-A failures in every data view (icon buttons named only by tooltip: 20–42 unnamed buttons and 50–75 unnamed clickable icons per view), invalid ARIA in CaseList and the menu activators, AA contrast failures from `text-grey`, 2.5.8 target-size failures (cohort: 53), no headings or skip link in working views, and row selection that AT cannot perceive. |
| Performance (code-level) | **3 / 4** | Route-level lazy views (`router` `() => import`). The 5.2 MB Mol* viewer and 1.2 MB Plotly are split and lazy. Tables are server-paginated. Main chunk 470 KB plus Vuetify 189 KB, uncompressed. Layout-property transitions are mostly Vuetify internals. A `mockApi` chunk (37 KB) is emitted in the web build; confirm it is not loaded in production. |
| Responsive | **3 / 4** | Adapts well at 640 and 320 px with no page-level horizontal scroll, and the details panel goes full-width. Against: many sub-24px targets, and the 10–12 px dense text is borderline at mobile widths. The product is primarily desktop. |
| Theming | **2 / 4** | Good light token system, 101 token uses, and zero `surface-variant` violations. Against: 113 hard-coded Material grey utilities that bypass the theme, hard-coded footer and app-bar colors, and a dark theme that is defined but unreachable and visibly broken when forced. |
| Implementation integrity | **3 / 4** | CLI detector is clean with no suppression, and component patterns are coherent. Against: one anti-pattern (tooltip-as-label) repeated across about 15 components, the clipped "Fetch VEP" label, a dead dark theme, and the same `text-grey` placeholder copied across cell components. |
| **Total** | **13 / 20 — Acceptable** | |

## 7. Issues (P0–P3)

No P0 was found: login, navigation and core flows all work by keyboard.

### P1: WCAG A/AA violations

1. **Icon-only buttons have no accessible name (tooltip-as-label).** SC 4.1.2 (A).
   - Location: 20–42 per view.
     - `variant-table/VariantColumnHeader.vue:23` (column filter menu button, one per column).
     - `FilterToolbar.vue:35-61` and `cohort/CohortFilterBar.vue:34,55` (starred/comment toggles).
     - `AppSidebar.vue:13,24` (info and "+" import).
     - `VariantIdentitySection.vue:35,46,66` (copy buttons).
     - `PresetBar.vue:39`, `ExternalLinksSection.vue` (7), `AppToolbar.vue:42`.
     - `CohortDataTable` Vuetify `show-expand` chevrons (25).
   - Impact: a screen reader announces these as "button".
   - Fix: add `aria-label`, for example the same string as the tooltip. Or add a lint rule: `vuejs-accessibility/…`, or a custom check that requires `aria-label` on `<v-btn icon>`. For the expand column, override `#item.data-table-expand` with a labelled button ("Expand variant details").
2. **Clickable `v-icon` row actions with no name, too small, and low contrast.** SC 4.1.2 (A), 2.5.8 (AA), 1.4.11 (AA).
   - Location: `table-cells/AnnotationsCell.vue:11-17, 33-40, 43-100`. Cohort equivalent in `cohort/CohortDataTable.vue`.
   - Measured: 50 per case page and 75 per cohort page; 17.5x17.5 px; `grey-lighten-1` `#bdbdbd` on white is about 1.9:1.
   - Fix: use `<v-btn icon size="small" :aria-label="starred ? 'Unstar variant' : 'Star variant'" :aria-pressed="starred">`, with a minimum 24x24 hit area and a theme-aware `medium-emphasis` color.
3. **Invalid ARIA on menu activators.** SC 4.1.2 (A).
   - Location: `AnnotationsCell.vue:47` and `:95` (a `<span v-bind="menuProps">` gets `aria-expanded` with no role), and `DslSearchBar.vue:3` (`aria-expanded` lands on the `v-input` div).
   - Fix: make the activator a `<v-btn>` or `<button>`. For the search bar, bind `aria-expanded`, `aria-controls` and `role="combobox"` on the input element.
4. **Case list role mismatch.** SC 1.3.1 (A).
   - Location: `CaseList.vue:69-98`. `v-list` with `select-strategy` renders `role="list"` on the container and `role="option"` on the items.
   - Fix: set `role="listbox"` and `aria-label="Cases"` on the `v-list`, or drop the option role. Expose the selected case with `aria-selected`.
5. **Text contrast below 4.5:1** (light theme, the shipped one). SC 1.4.3 (AA).
   - Location:
     - `text-grey` `#9e9e9e` on `#fafbfd` (2.59:1) in `table-cells/EmptyPlaceholder.vue:2`, `VariantTable.vue:220`, `table-cells/ClinVarCell.vue:21` (46 per page), `VariantIdentitySection.vue:70`, `TagsSection.vue`, `InlineEditableText.vue` and the VariantDetailsPanel score chips.
     - CaseList subtitles and field labels: `#85878b` gives 3.47:1.
     - `EmptyState.vue:6-12`: 2.42:1 and 4.17:1.
   - Fix: replace `text-grey*` with `text-medium-emphasis`, or with a token measured at ≥4.5:1 against `surface`. For "--" placeholders, `rgba(on-surface, .62)` or darker.
6. **Target size below 24 px without spacing.** SC 2.5.8 (AA).
   - Location: `FilterToolbar.vue` and `CohortFilterBar.vue` 20x20 toggles, plus the row icons in issue 2.
   - Measured: 2 in case views and 53 in cohort.
   - Fix: `size="small"` with `min-width/height: 24px`, or add spacing so the 24 px circles do not overlap.

### P2

7. **Row selection is not exposed to assistive technology, and focus is not managed when the details panel opens.** SC 4.1.2, 2.4.3.
   - Location: `variant-table/useVariantData.ts:129-136` (class-only selection), `VariantTable.vue:529-560` (document-level arrow handlers), and the details panel.
   - Fix: add `aria-selected` on the selected `<tr>` (or a roving `tabindex` grid), announce the selection through the existing `role="status"` region, and move focus to the panel heading on open, returning it on close.
8. **No headings or skip link in working views.** SC 2.4.1 (A), 1.3.1, best practice.
   - Location: case, case-details and cohort have zero headings, the home page has only an H2, and no view has a bypass link.
   - Fix:
     - Add an `h1` per view, which can be visually hidden ("Case LB26-0060 — SNV/Indel variants" / "Cohort variants").
     - Add an `h2` "Variant details" in the panel.
     - Add a "Skip to variant table" link.
9. **Dark theme defined but unreachable, and broken when forced.** Theming.
   - Location: `plugins/vuetify.ts:59-82` (defined, never selectable).
   - Breakage when forced:
     - `AppFooter.vue:399-401`: hard-coded `#dfe4ea` makes the footer content invisible.
     - `AppToolbar.vue:325-332`: hard-coded white overlays give 1.9–2.1:1 on mode-toggle text.
     - `EmptyState.vue:6-9`: `text-grey-darken-*` gives 2.97:1.
     - `TranscriptSection.vue:192`: `deep-purple` gives 2.31:1.
   - Fix: either remove `warmDark` until it is supported, or ship a toggle that honours `prefers-color-scheme` and replace these literals with `rgb(var(--v-theme-…))` tokens.
10. **Clipped "Fetch VEP" button label.** Visual integrity.
    - Location: `TranscriptSection.vue:188-196`. An `x-small` tonal `v-btn` inside `v-card-title.text-body-large` renders with the text cut vertically. Seen at 1440 and 640 px.
    - Fix: drop the inherited line-height (`class="text-label-small"`) or use `size="small"`.
11. **Non-descriptive document titles.** SC 2.4.2 (best effort).
    - Location: every authenticated view is titled "VarLens".
    - Fix: set the title per view and case, e.g. "LB26-0060 · SNV/Indel — VarLens".

### P3

12. **10 px functional text.**
    - Location: `FilterDrawer.vue:849`, `cohort/CohortFilterDrawer.vue:672`, `assets/styles/custom.css:69`, `variant-table/VariantColumnHeader.vue:244`, tab count badge.
    - Fix: raise to 11–12 px or more.
13. **Reduced motion is honoured only in `CohortTable.vue:801`.**
    - Fix: add a global `@media (prefers-reduced-motion: reduce) { *,*::before,*::after { transition-duration: .01ms !important; animation-duration: .01ms !important } }`.
14. **Empty `<th>`.**
    - Location: the annotation-icon column (`VariantTable.vue`) and the expand column (`CohortDataTable.vue`).
    - Fix: add visually hidden header text ("Annotations", "Expand").
15. **`role="toolbar"` on a `<header>`.**
    - Location: `SlimFilterToolbar.vue:6-10`.
    - Fix: use a `div` wrapper, or accept it (minor best-practice finding).
16. **Unlabelled duplicate landmarks.**
    - Detail: 4 `header` and 5 `nav` per view, of which 3 are labelled.
    - Fix: add `aria-label` to the sidebar nav, footer nav and toolbar headers.
17. **Login card uses both a hairline border and a wide shadow.**
    - Location: `src/web/login/login.html:86-88`, an impeccable advisory.
    - Fix: cosmetic; pick one.
18. **`mockApi` chunk emitted in the production web build.**
    - Location: `out/web/public/assets/mockApi-*.js`.
    - Fix: confirm it is never requested in production, and tree-shake it if it is.
