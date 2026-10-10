**TL;DR:** Advertised filter shortcuts should operate the visible case or cohort view.

**Priority:** P2 · Bug.

**Evidence:** `src/renderer/src/App.vue` dispatches filter actions through the case toolbar reference. `cohort/CohortFilterBar.vue` does not expose the equivalent commands. The cohort browser probe confirmed that `/` did not focus search.

**Implementation guide:**

- Expose the same small command interface from both toolbars and select the active view when dispatching.
- Cover search focus, filter drawer, clear and export shortcuts.
- Guard views such as Shortlist where an action is unavailable; do not mutate a hidden case toolbar.
- Reuse existing shortcut definitions and input-focus guards. This is a routing correction to the functionality delivered in #41.

**Acceptance:** Test a fresh cohort route and case → cohort navigation. Verify `/`, Ctrl+Shift+F, Alt+Shift+C and Ctrl+Shift+X reach the visible controls and preserve normal text entry. Test dispatch through App, not just key-map constants.

Source review: VarLens `7989c395`. Browser observations refer to the earlier synthetic audit; implementation guidance is proposed work, not a claim of a completed fix.

