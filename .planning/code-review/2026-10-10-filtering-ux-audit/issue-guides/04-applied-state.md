**TL;DR:** The visible filter summary and restored URL must describe the query actually producing the rows.

**Priority:** P1 · Bug.

**Evidence:** A case DSL filter reduced a synthetic case to 0/50 and incremented the filter badge, while the summary said “No filters applied.” `FilterToolbar.vue` and `CohortFilterBar.vue` omit DSL conditions from their chip lists. `useDslFilterIntegration.ts` binds raw draft text to URL restoration.

**Implementation guide:**

- Separate draft text from committed conditions; show “Not applied” when they differ.
- Reuse `buildColumnFilterChips` for applied DSL conditions, with distinct IDs and working removal.
- Describe numeric `includeEmpty: true` as “or missing”; do not hide that meaning.
- Persist committed state. Removing a chip must also reconcile serialized state, so reload/back/forward cannot resurrect it.
- Avoid replaying preset references over subsequently edited filter values. Coordinate saved snapshots with #124.

**Acceptance:** In case and cohort, test apply, invalid draft, remove, clear, reload, copied URL and browser history. Verify row IDs, chip labels and export agree. Include quoted values, equality alternatives, null checks and preset divergence.

Source review: VarLens `7989c395`. Browser observations refer to the earlier synthetic audit; implementation guidance is proposed work, not a claim of a completed fix.

