# Review: PR 4 `fix/layout-a11y` (diff `fix/data-safety-audit...HEAD`, 14 commits, +810/−146)

What this change does: it ships 08c items 1-10. Chip rows stay on one line, the preset bar always renders, the filter drawer stays open, the sticky header sits on top, the columns drawer is labelled, Escape and focus work on both drawers, a global listener returns focus after dialogs, column priority keeps the locus, the panel heading and scroll are fixed, the lollipop falls back, and the panel shows ClinVar and call quality. Case and cohort share every changed component (FilterDrawerShell, ColumnsDrawer, SlimFilterToolbar, PresetBar, COLUMN_PRIORITY), so parity holds. New copy and fields live in `config/uiCopyConfig.ts` and `config/columnPriority.ts`.

**Must fix**
1. **Focus is not returned while a snackbar or tooltip is showing** (`utils/overlay-focus-return.ts:34,59`)
   - **What this is:** after a dialog with no activator closes, the listener puts focus back on the last element outside it.
   - **Problem:** it gives up whenever any `.v-overlay--active` exists. `v-snackbar` (AppSnackbar, "saved" toasts) and `v-tooltip` are also `.v-overlay`. In the common flow "Save in a dialog → toast → dialog closes", focus stays on `<body>` (WCAG 2.4.3), which is exactly the case this listener was written for.
   - **Fix:** use the existing `isPopupOpen()` from `useTableKeyboardNav.ts` (dialogs and menus only) instead of `ACTIVE_OVERLAY_SELECTOR`. Add one test with an active `.v-snackbar.v-overlay--active` sibling.
   - **If we skip it:** keyboard and screen-reader users lose their place after most save dialogs.

**Should fix**
2. **"Clear all" can scroll out of reach** (`SlimFilterToolbar.vue:204-213,366-369`)
   - **What this is:** the applied-filter row now scrolls sideways, and its scrollbar is hidden.
   - **Problem:** with many chips, "Clear all" (`ml-auto`, the last item) sits off-screen. A plain mouse wheel cannot scroll sideways, and nothing shows that the row overflows. Keyboard Tab still reaches it, and screen readers still read every chip, because all chips stay in the DOM.
   - **Fix:** `position: sticky; right: 0;` with the bar background on the Clear-all button (about 3 CSS lines, no change in height). This works in case and cohort alike.
   - **If we skip it:** mouse users with many filters cannot clear them in one click.
3. **Screenshot drawer check is always false** (`tests/e2e/screenshots.e2e.ts:1173`)
   - **Problem:** `!drawer.getAttribute('aria-label') === 'Variant details'` parses as `(!x) === '…'`, so the check never skips a drawer. ESLint ignores this file and no tsconfig includes it, so nothing catches it.
   - **Fix:** `if (drawer.getAttribute('aria-label') !== 'Variant details') continue`.
   - **If we skip it:** it works today only because the next `.acmg-section` check covers for it.

**Checked, no finding.** Escape layering: a menu or autocomplete inside a drawer closes first, because `isPopupOpen` still sees the closing menu and the escape-guard replay also bubbles into the drawer. A drawer over the docked panel closes before the panel. The panel has `scrim=false`, so counting scrims in `isOverlayOpen` blocks only row shortcuts, and only behind a modal drawer or the narrow app sidebar. That is correct. The listener is installed once and stays harmless when Electron loses window focus (activeElement is kept). Nested dialogs leave focus inside the outer one, which is no worse than before. Vuetify's own activator return runs first and wins. Priorities: budget 5 gives Gene · Chr · Pos · Impact · ClinVar, and 10 adds Ref/Alt/AF/CADD + Func. Cohort `carrier_count` was hidden at budget 10 before this change too. Gates: the `getByRole('button',{name:'Next page'})` fix is right (the hidden Shortlist pagination made the old locator ambiguous) and still clicks the visible table's button. A new 1440×900 dock CLS gate was added with unchanged budgets. Known-failures and budgets are untouched. The new axe states cover the filter drawer in case and cohort, and the columns drawer in case only (it is a shared component). The 18 px chips sit in one row with no target above or below, so they meet WCAG 2.5.8.

Verdict: fix 1 first (2 and 3 are small, same PR).
Not checked: no tests or app runs (read-only review). Vuetify snackbar/tooltip class names were inferred from Vuetify source conventions, not confirmed in the browser.
