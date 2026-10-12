# 08c: Ponytail fix review (layout, keyboard, a11y, viewers, learnability)

Scope: X-01, X-03, X-06, R-01, the case-table/details P2s (sticky header, drawer closing, panel scroll and heading, mobile jump, cohort load CLS, gene-structure labels), L-01, P-01, and the five learnability features in `07` §4.
Method: I read the code at `bfd3d80e`. I also ran live checks against the audit server (`127.0.0.1:8797`) with Playwright scripts in the session scratchpad: CSS injected before and after the fix, the same CLS observer the audit used, axe-core with the CSP bypassed, and `elementFromPoint` hit tests. Numbers marked *measured* come from those runs.

## Must fix

### 1. X-01 + S-02: preset row and applied-filters row wrap, so the table jumps
**What this is:** The preset chips (`PresetBar`) and the applied-filter chips (`SlimFilterToolbar`) are `flex-wrap: wrap`. When the toolbar gets narrower (docked panel at ≥ 1440 px) or a chip or the "Save" button appears (mobile), the row adds a line and pushes the table down.
**Problem:** Opening or closing the panel shifts the table 22 px (CLS 0.208 / 0.306). On mobile each preset click shifts it 50 px (CLS 0.18).
**Fix:** Keep both rows on one line and let them scroll sideways. `PresetBar.vue:76` `flex-wrap: wrap` → `nowrap; overflow-x: auto`, add `.preset-bar > * { flex-shrink: 0 }`, and delete the now-dead `row-gap` media block (`:79-85`). Make the same change on `.applied-filters-bar` (`SlimFilterToolbar.vue:366`). Mouse users need to reach chips that are scrolled out of view, so put the preset `v-chip` loop inside the Vuetify `<v-slide-group show-arrows>` (a built-in, so no new component). Its arrows appear only on overflow and add width, not height. Keep Save and the cog outside it. Do not use a thin scrollbar: it appears only on overflow and would bring the shift back.
*Measured* with the CSS alone: panel open 0.208 → **0.011**, close 0.306 → **0.012**, table moves 22 → 0 px. Mobile preset click 0.18 → 0.019 with the preset row fixed, and → **0.0002** (0 px) once the applied-filters row is fixed too.
**If we skip it:** The panel open/close CLS stays at ten times the 0.02 budget, and the score cap for this view stays in place.
Root cause: VERIFIED — `components/PresetBar.vue:76`, `components/SlimFilterToolbar.vue:366`
Reaches: `FilterToolbar.vue` (case) and `cohort/CohortFilterBar.vue` (cohort) share both components, so cohort parity is automatic. Panel docking (`utils/responsive-layout.ts:9`, docked ≥ 1440, overlay below, `useDockedPanelInstantLayout`) needs no change.
Size: ±8 lines (CSS + the slide-group wrapper, −7 dead lines)
Test: add `case-panel-open` / `case-panel-close` steps to `tests/e2e/helpers/interaction-workflows.ts` with the window at 1440×900. The existing `case-row-select` step runs below the docking width and never sees the shift. It fails at 0.21 today. Also add a 390 px preset-click step.
Verdict: **DO**

### 2. Filter drawer closes after every filter click
**What this is:** Every filter click writes the filter to the URL (`&f={…}`). Vuetify's temporary `v-navigation-drawer` closes itself on every route change.
**Problem:** Building "MOD + LOW + ≤ 0.1 % + ClinVar" takes four reopens. The audit's suspected cause (click-outside after a re-render) is wrong. *Measured:* the drawer closes exactly when the URL gains `f=`.
**Fix:** One prop on the shared shell, `FilterDrawerShell.vue:5`: add `disable-route-watcher`. A real navigation away (case or view switch) still unmounts or covers the drawer, because the scrim blocks clicks on the app behind it.
**If we skip it:** The drawer cannot do its job, which is to combine several filters (it even has a "Done" button).
Root cause: WRONG in `02` F6 (click-outside); real cause `node_modules/vuetify/lib/components/VNavigationDrawer/VNavigationDrawer.js:159-160` (`watch(router.currentRoute, () => isTemporary && (isActive = false))`)
Reaches: `FilterDrawer.vue` (case) and `cohort/CohortFilterDrawer.vue` both use `FilterDrawerShell`. `ColumnsDrawer.vue` does not write to the URL, so it needs no change.
Size: +1
Test: `tests/renderer/components/filters/FilterDrawerShell.test.ts`: mount with a router, push a query, and assert that no `update:open` false is emitted. Or extend the Playwright drawer script (s14) in the e2e workflows.
Over-engineered alternative in `02`: "non-temporary persistent drawer without scrim". It changes layout and focus behaviour; the one prop is enough.
Verdict: **DO**

### 3. X-03: columns drawer has 26 unnamed checkboxes and 2 aria-conditional-attr; drawers are not in the CI gate
**What this is:** The `v-checkbox-btn`s in `ColumnsDrawer.vue:39` (group) and `:74` (each column) have no label. The visible title is a sibling element. For the group checkbox, Vuetify itself writes `aria-checked="mixed"` on the native input (`VCheckboxBtn.js:38`) but never sets the DOM `indeterminate` property, and axe flags the mismatch.
**Problem:** These are axe-critical failures, and CI cannot catch them because no gate state opens a drawer.
**Fix:**
```vue
<!-- :74 -->  <v-checkbox-btn :aria-label="`Show ${column.title}`" … />
<!-- :39 -->  <v-checkbox-btn :aria-label="`Show all ${groupLabel(groupId)} columns`"
                :indeterminate="isGroupIndeterminate(groupId)"
                .indeterminate="isGroupIndeterminate(groupId)" … />
```
`.indeterminate` is a DOM-prop binding. It is not a declared prop of `VCheckboxBtn`, so it falls through to the `<input>` (`filterInputAttrs`) and sets `input.indeterminate`. If that turns out to be too clever, use a three-line `watchEffect` on a template ref instead. *Measured:* aria-labels plus native `indeterminate` give **0 violations** (from `label ×26`, `aria-conditional-attr ×2`). The `05` advice to "use the indeterminate prop instead of aria-checked" is wrong: the code already uses the prop, and the bug is Vuetify's.
Also give the drawer a name: `aria-label="Column options"` on the `v-navigation-drawer` (the filter drawer already has one).
Gate: in `tests/ui-gates/support/app-states.ts`, add `'case-filter-drawer'` and `'case-columns-drawer'` to `GateStateName` and `GATE_STATES`. In `gotoState`, after `case-table`, click the "Filters" or "Columns" button and wait for `.v-navigation-drawer--active`. `a11y.gate.ts` iterates `GATE_STATES`, so it needs no change. Cohort uses the same `ColumnsDrawer` and `FilterDrawerShell`. A `cohort-filter-drawer` state is worth one more line, because `CohortFilterDrawer`'s content differs.
**If we skip it:** Screen-reader users hear 26 times "checkbox, not checked" with no column name, and the next drawer regression ships silently.
Root cause: VERIFIED — `components/ColumnsDrawer.vue:39,74`; aria-conditional-attr from `vuetify/lib/components/VCheckbox/VCheckboxBtn.js:38`
Size: +4 component, +14 gate
Test: the new gate states (`make ui-gates-axe`) fail before and pass after.
Verdict: **DO**

### 4. L-01: lollipop is an empty SVG with no message
**What this is:** `protein/getDomains` returns `proteinLength: 0` when it has no domains. `0 ?? mapping.proteinLength` keeps the 0, and `useLollipopPlot.ts:259` returns early.
**Problem:** The plot shows nothing and says nothing.
**Fix:** `useProteinData.ts:49`: `(domainsQuery.data.value?.proteinLength || mapping.value?.proteinLength) ?? 0`. Also in `LollipopPlotPanel.vue:42`, add `v-if="proteinLength > 0"` on `LollipopPlot` and a `v-else` `<div role="note" class="pa-3 text-body-small text-medium-emphasis">Protein length unknown, so the plot is unavailable.</div>`.
**If we skip it:** A blank plot reads as "no variants in this protein".
Root cause: VERIFIED — `composables/useProteinData.ts:49`
Reaches: `ProteinVisualizationModal.vue:24,105` reads the same computed and gains the length badge for free. The modal is opened from both case and cohort.
Size: +4
Test: `tests/renderer/composables/useProteinData.test.ts`: domains `{domains: [], proteinLength: 0}` plus mapping `{proteinLength: 683}` should give 683 (today it gives 0).
Verdict: **DO**

### 5. P-01: panel shows no ClinVar significance and no GT/DP/GQ/AB/FILTER
**What this is:** The data is already on the row object the panel receives. `Variant` (`shared/types/database.ts:111-143`) has `clinvar`, `gt_num`, `gq`, `dp`, `ab` and `filter`, and `CohortVariant` has `clinvar`. `VariantIdentitySection.vue` simply never renders them.
**Problem:** The panel is where the user classifies, yet it hides the ClinVar class and the call quality.
**Fix:** In `VariantIdentitySection.vue`, after the position line (`:51`):
```vue
<div class="d-flex align-center mt-1 ga-2 text-body-small">
  <ClinVarCell :significance="variant.clinvar" :url="null" />
  <span v-if="callLine" class="variant-data-mono">{{ callLine }}</span>
</div>
```
`callLine` is a computed. It applies only when `'gt_num' in variant` (case mode). It builds `GT 0/1 · DP 34 · GQ 99 · AB 0.47 · FILTER PASS` from the non-null fields. Reuse `ClinVarCell` from the table cells so the colour and humanised text match the table. Skip the "split from multi-allelic" line for now.
**If we skip it:** Users classify without seeing ClinVar, and auto-suggest uses a value the user never sees.
Root cause: VERIFIED — `components/VariantIdentitySection.vue:38-51` (fields exist, not rendered)
Reaches: case and cohort panels both use `VariantIdentitySection`. Cohort gets ClinVar only, which is correct because cohort has no per-sample call. Check that the web-path row payload carries `dp`/`gq`/`ab`/`filter` (the table's `GT` column proves `gt_num` does).
Size: +12 (VariantIdentitySection is 172 lines)
Test: new `tests/renderer/components/VariantIdentitySection.test.ts`: a variant with `clinvar: 'Pathogenic', gt_num: '0/1', dp: 34` renders "Pathogenic" and "DP 34". A cohort variant renders no call line.
Verdict: **DO**

## Should fix

### 6. X-06: Esc and focus for drawers, panel, menus and dialogs (one mechanism)
**What this is:** Four separate claims, checked one by one:
- **Drawers (filter, columns):** VERIFIED. There is no Esc handler and no focus move. Vuetify's nav drawer handles neither.
- **Details panel Esc:** WRONG / not reproduced. *Measured* at 1440 (docked) and 1280 (overlay): Esc closes the panel and focus returns to the selected row (`usePanelFocus`). The real panel Esc defect is P-03/F-11. The window listener at `VariantDetailsPanel.vue:546` also fires while a menu or input owns the key.
- **Focus after dialogs:** VERIFIED. Dialogs opened from menu items have no activator, so Vuetify's `afterLeave` (`VDialog.js:61`) has nothing to focus and focus lands on `<body>`.

**Problem:** The shortcut sheet (`KeyboardShortcutsDialog.vue:68`) promises "Escape: Close drawer", but no drawer closes on Esc. Keyboard users also lose their place after every settings dialog.
**Fix:** Use what already exists:
- **Drawers:** reuse `composables/usePanelFocus.ts`. It is already generic: `(isOpen, headingRef)`, focus in on open, return to the opener on close. Call `usePanelFocus(() => props.open, titleRef)` in `FilterDrawerShell.vue` and `ColumnsDrawer.vue`, with `tabindex="-1"` on the toolbar title. Add `@keydown.esc="emit('update:open', false)"` on each `v-navigation-drawer`; focus is now inside, so the handler fires. Optional: add `retain-focus` (a Vuetify prop, no code) to trap Tab while the scrim is up. Together that is case + cohort through two components.
- **Panel / menus (shared with P-03 owner):** add one guard to `VariantDetailsPanel.vue:547` and to the tables' Escape `onKeyStroke` handlers: `if (e.defaultPrevented || isInputFocused() || document.querySelector('.v-overlay--active')) return`. That is the same selector `overlay-escape-guard.ts:30` uses. Export it from there instead of copying it.
- **Dialogs:** use one global listener next to `installOverlayEscapeGuard` (`main.ts:45`), in the same file style (`utils/overlay-focus-return.ts`, about 20 lines). On `focusin` outside `.v-overlay`, remember the target. On `focusout` from inside a `.v-overlay` with `relatedTarget === null`, wait one frame. If `document.activeElement === document.body` and the remembered element is still connected, focus it. This one listener covers every dialog (Database Overview, External Links, Tags, Gene Panels, External lookups, Preferences) without touching any of them. The per-dialog "store trigger, focus on afterLeave" fix in `04`/`05` would touch 8+ components.

**If we skip it:** The sheet stays wrong, drawers stay keyboard traps without Esc, and WCAG 2.4.3 keeps failing on every settings dialog.
Root cause: VERIFIED (drawers, dialogs) / WRONG (panel Esc) — `filters/FilterDrawerShell.vue:2-9`, `ColumnsDrawer.vue:2-8`, `vuetify/lib/components/VDialog/VDialog.js:61`
Size: +6 drawers, +3 guard, +22 focus-return util (+ test)
Test: `tests/renderer/utils/overlay-focus-return.test.ts` (happy-dom): focus a button, open and remove a `.v-overlay` containing a focused input, and expect the button focused. Add a drawer Esc test in `tests/renderer/components/filters/FilterDrawerShell.test.ts`.
Verdict: **DO** (drawers + guard), **DO** (focus-return util; small and global)

### 7. Cohort page-load CLS 0.03-0.09
**What this is:** `PresetBar.vue:5` renders only once the presets have loaded (`v-if="visiblePresets.length > 0 || hasActiveFilters"`). *Measured* on `/cohort`: the preset bar is inserted at 278 ms at top 188, pushing `.applied-filters-bar` from 188 → 221 px (shift 0.031). The other sources the audit listed are side effects of this insert (`table-container`, `applied-filters-bar--empty`). `table-load-indicator` is `position: absolute` and cannot cause a shift.
**Problem:** Navigation CLS is over budget on every cohort load.
**Fix:** Drop the `v-if` and give `.preset-bar` a `min-height` equal to one chip row. The bar always holds the cog, so it is never empty, and it also gives users back "Manage presets" when every preset is hidden. Chips arriving later then only fill the row sideways.
**If we skip it:** The cohort navigation CLS stays over budget.
Root cause: VERIFIED — `components/PresetBar.vue:5`
Reaches: case and cohort (shared component).
Size: ±2
Test: the Lighthouse `switch-cohort` step in `tests/ui-gates/support/lighthouse-flow.ts` already measures this. Assert per-navigation CLS ≤ 0.02 on direct `/cohort` load.
The `05` S-02 advice to "reserve the indicator's 2 px row" is not needed: that indicator is absolute.
Verdict: **DO**

### 8. Sticky header: ★/Chr header cells painted over by body cells
**What this is:** The audit suspected a missing `top: 0`. That is WRONG. *Measured:* the `th` already computes `top: 0px`. The real cause is stacking order. Vuetify makes `thead` sticky with `z-index: 2` (`VTable.css:137-141`), which creates a stacking context. The sticky body cells are also `z-index: 2` (`data-table-shared.css:194,204`) and come later in the DOM, so they paint over the whole header. The header cells' own `z-index: 3` only counts inside thead's context.
**Problem:** On vertical scroll the first two header cells disappear behind body rows.
**Fix:** `data-table-shared.css` (after `:212`): `.table-container .variant-table--sticky thead { z-index: 3; }`. *Measured:* `elementFromPoint` on the header cell hits the `TD` before the fix and the `THEAD` after it.
**If we skip it:** The left sticky header cells vanish whenever the user scrolls.
Root cause: WRONG (not `top:0`) — real: `data-table-shared.css:194,204` vs `vuetify VTable.css:140`
Reaches: only `VariantTable.vue:24` uses `variant-table--sticky`. Cohort has no sticky lead columns, so this is not a parity gap.
Size: +3
Test: none in Vitest (layout). Verify in browser.
Verdict: **DO**

### 9. R-01: responsive column priority hides the locus first
**What this is:** `COLUMN_PRIORITY` (`utils/responsive-layout.ts:51-76`) ranks gene, consequence, clinvar, gnomad_af and cadd (1-5) above chr and pos (8-9). Under 840 px only 5 columns show, so rows read "ZNRF3 · MODIFIER".
The second claim, "720×450 pagination unreachable", is WRONG. *Measured:* `.case-content` scrolls (scrollHeight 535 vs clientHeight 370), and after scrolling, the footer bottom lands at 418 px, inside the viewport. The audit measured `document.scrollHeight`, but the page scrolls in `.case-content` (fix `494311f8`).
**Problem:** On a phone or at 200 % zoom you cannot tell rows apart.
**Fix:** Renumber: `gene_symbol 1, chr 2, pos 3, consequence 4, clinvar 5, ref 6, alt 7, gnomad_af 8, cadd 9 …`. At 5 columns that is Gene · Chr · Pos · Impact · ClinVar. At 10, Ref/Alt/AF/CADD come back. This is data only and one table.
**If we skip it:** Narrow and zoomed users see rows they cannot tell apart.
Root cause: VERIFIED (priority) / WRONG (pagination) — `utils/responsive-layout.ts:51-76`
Reaches: shared by case and cohort tables (the comment at `:45-49` says so), so parity is automatic. Cohort keys `carrier_count`/`cohort_frequency` keep their slots after the reshuffle; check that Carriers still makes the 10-column cut.
Size: ±11 (renumber only)
Test: `tests/renderer/utils/responsive-layout.test.ts`: `computeAutoHiddenColumns(defaultKeys, 5)` must not contain `chr` or `pos`. Update any existing order assertion.
Verdict: **DO** (one product call: confirm that Impact + ClinVar beat Ref/Alt at 5 columns)

### 10. Panel keeps its scroll on the next variant; heading doesn't name the variant
**What this is:** The scroll container (`VariantDetailsPanel.vue:35`) has no ref, and nothing resets it. The `h2` says "Variant Details" (`:23`). It sits in the toolbar outside the scroller, so it is already sticky. The `03` advice to "make the title sticky" needs no CSS.
**Problem:** After switching rows the user lands on ACMG with no gene or HGVS visible.
**Fix:**
```vue
<h2 …>{{ variant?.gene_symbol ?? 'Variant' }}<span v-if="variant?.aa_change || variant?.cdna" class="text-medium-emphasis"> · {{ variant.aa_change || variant.cdna }}</span></h2>
<div ref="scrollRef" class="flex-grow-1 overflow-y-auto pa-3">
```
```ts
watch(() => [props.variant?.chr, props.variant?.pos, props.variant?.ref, props.variant?.alt].join(':'), () => scrollRef.value?.scrollTo({ top: 0 }))
```
Key the watch on the locus, not the object, so case and cohort rows behave the same and a refresh does not jump. The h2 is already the focus target, so screen readers now hear the variant.
**If we skip it:** Users can classify the wrong variant, especially at 1280×720 where the panel covers the highlighted row.
Root cause: VERIFIED — `components/VariantDetailsPanel.vue:23,35`
Reaches: one panel for case and cohort.
Size: +5. The file is 596 lines, so delete the three narrating comments at `:545,552,557` to stay ≤ 600.
Test: `tests/renderer/components/VariantDetailsPanel.cohort-mode.test.ts` (existing harness): set scrollTop, change the variant prop, expect 0, and expect the heading to contain the gene symbol.
Verdict: **DO**

## Nice to have

### 11. Gene structure: repeated tick labels, overlapping exon numbers
**What this is:** The tick format is hard-coded to `toFixed(2)` Mb (`useGeneStructurePlot.ts:350`, duplicated at `:548`), so ticks 5 kb apart print the same label. Exon numbers that don't fit inside an exon are drawn above it (`:210-223`) with no collision check.
**Problem:** The axis reads "29.52 Mb" three times, and "17 16" renders as "1Ꞁ6".
**Fix:** Replace both duplicated formatters with d3's step-aware one, `xScale.tickFormat(n, '~s')`, and append `b` ("29.515Mb"). This deletes about 12 lines. For exon labels, keep a `lastLabelRight` and skip an outside label whose left edge is within 2 px of it. The exon tooltip already names every exon.
**If we skip it:** The axis and exon labels stay hard to read. It is cosmetic, and the tooltip still gives the exon number.
Root cause: VERIFIED — `composables/useGeneStructurePlot.ts:350,548,210-223`
Size: −8 net
Test: none needed (trivial); verify visually on THOC5.
Verdict: **DO-LATER**, bundled with the F-14 dark-theme `#666`/`#fff` fills in the same file.

## Learnability features (`07` §4, top 5)

### 12. Column-header help
**Lean form:** `VariantColumnHeader.vue:16` already sets `:data-tooltip="headerColumn.title"` through the delegated tooltip. Add one `COLUMN_HELP: Record<string, string>` map (definition + threshold, e.g. `cadd: 'CADD PHRED: deleteriousness rank; ≥ 20 = top 1 %'`) next to `COLUMN_PRIORITY`, or in `variant-table/columns.ts`. Bind `:data-tooltip="COLUMN_HELP[headerColumn.key] ?? headerColumn.title"`. Move the attribute from the inner `span` to the `role="button"` div so it also shows on keyboard focus (`findTooltipTarget` uses `closest`). Cohort uses the same header component (`CohortDataTable.vue:43`), so parity is free. Skip the structured `{definition, source, thresholds}` object `07` proposes until a second consumer needs it.
Size: +25 (mostly text). Test: `tests/renderer/components/variant-table/VariantColumnHeader.test.ts` checks that `data-tooltip` contains the help for `cadd`.
Verdict: **DO**

### 13. Explain-why empty states
**Lean form:** without counts, the empty state lists the active filters (`activeFiltersList`, already computed for the chip bar), each with a "remove" action, next to the existing "Clear filters". The per-clause-count version needs n extra count queries per empty result through both storage backends. Defer it. Note D-02 (owned elsewhere): the empty state must first stop showing for query *errors*.
Size: +15 (lean). Verdict: **DO-LATER** (lean form after D-01/D-02 land; counts version SKIP for now)

### 14. Shortcut hints in tooltips
**Lean form:** edit the existing tooltip strings. `IconButton`'s `tooltip` prop gets "Filters (Ctrl+Shift+F)", "Columns (Alt+Shift+C)", "Star (S)", "Comment (C)", "ACMG (A)". Take the key text from one exported list: move `shortcutGroups` out of `KeyboardShortcutsDialog.vue:43` into `utils/keyboard-shortcuts.ts` so the dialog and tooltips cannot drift. Skip the one-time "nudge after a mouse action": it needs persisted state and a new UI surface.
Size: +10 / −0 (move). Verdict: **DO**

### 15. Ctrl/⌘+K command palette
**Lean form:** the actions already exist as callbacks in `useKeyboardShortcuts({...})` (`App.vue:411-423`), so a palette is a `v-dialog` + `v-autocomplete` over those callbacks plus the shortcut list from item 14. That is still a new component (~120 lines), a new binding, a focus/Esc story, a parity-manifest/capability check for desktop-only actions, and a test. It duplicates what `?` + tooltips already teach.
Verdict: **DO-LATER**. Revisit after items 12 and 14 ship; do not build the "generated shortcut dialog from a registry" refactor up front.

### 16. Clinical-question presets
**Lean form:** presets and their tooltip descriptions already exist (`main/database/built-in-presets.ts`, `PresetBar.vue:24`). The cheapest win is rewording the descriptions as questions ("Any rare, known pathogenic variant?"). That is a seed-data change in one file, but existing databases keep their seeded copy unless a migration updates built-ins on both SQLite and Postgres. New question presets (recessive/compound-het, de novo in trio) need genotype/inheritance filter semantics that the preset DSL may not have. Skip live counts in tooltips: one count query per chip on every hover or filter change.
Verdict: **DO-LATER** (needs a product decision on which questions, plus a migration for both backends); live counts **SKIP**

## Over-engineered proposals in 02-07 (leaner alternative)

| Report | Proposal | Leaner |
|---|---|---|
| 02 F6 | Make the filter drawer persistent without scrim | `disable-route-watcher` (item 2) |
| 02 F9 | Add `top:0` to sticky `th` | Wrong cause; `thead { z-index: 3 }` (item 8) |
| 03 F-07 | Make toolbar title sticky | Already outside the scroller; just change its text (item 10) |
| 04/05 X-P2-1, A-05 | Store trigger + focus on `afterLeave` per dialog | One global focus-return listener (item 6) |
| 05 A-01 | "Use indeterminate prop instead of aria-checked" | Already does; set the native `indeterminate` property (item 3) |
| 05 S-02 | Reserve the load indicator's 2 px row | Indicator is absolute; the wrapping chip rows are the cause (item 1) |
| 07 #2 | n COUNT queries per empty result | List active filters with remove actions first (item 13) |
| 07 #4 | Action registry + generated shortcut dialog + palette | Shared shortcut list + tooltip hints (item 14); palette later |
| 07 #5 | Live counts in preset tooltips | Skip; reword descriptions |

## Summary

| # | ID | Item | Root cause | Verdict | Size |
|---|---|---|---|---|---|
| 1 | X-01, S-02 | Chip rows wrap → panel/mobile shift | VERIFIED | DO | ±8 |
| 2 | 02 F6 | Filter drawer closes per click | WRONG → Vuetify route watcher | DO | +1 |
| 3 | X-03 | Columns drawer names + indeterminate + gate states | VERIFIED | DO | +18 |
| 4 | L-01 | Empty lollipop | VERIFIED | DO | +4 |
| 5 | P-01 | ClinVar + call line in panel | VERIFIED | DO | +12 |
| 6 | X-06 | Esc/focus drawers, guard, dialog focus return | VERIFIED / panel Esc WRONG | DO | +31 |
| 7 | 04 cohort CLS | PresetBar inserted late | VERIFIED | DO | ±2 |
| 8 | 02 F9 | Sticky header covered | WRONG → thead z-index | DO | +3 |
| 9 | R-01 | Column priority / pagination | VERIFIED / pagination WRONG | DO | ±11 |
| 10 | 03 F-07 | Panel scroll reset + named heading | VERIFIED | DO | +5 (−3) |
| 11 | 03 F-15 | Gene-structure ticks/exon labels | VERIFIED | DO-LATER | −8 |
| 12 | 07 #1 | Column-header help | — | DO | +25 |
| 13 | 07 #2 | Explain-why empty state | — | DO-LATER | +15 |
| 14 | 07 #3 | Shortcut hints in tooltips | — | DO | +10 |
| 15 | 07 #4 | Ctrl/⌘+K palette | — | DO-LATER | ~+120 |
| 16 | 07 #5 | Clinical-question presets | — | DO-LATER / counts SKIP | n/a |

Not checked: Electron (all measurements were web/Chromium); the `.indeterminate` fall-through binding (I verified the DOM effect by script, not the Vue binding); whether the web row payload carries `dp/gq/ab/filter`; screen-reader output.
