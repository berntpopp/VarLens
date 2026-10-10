**TL;DR:** Resizing can shrink the filter drawer below its own minimum and leave controls obscured.

**Priority:** P2 · Bug.

**Evidence:** `filters/FilterDrawerShell.vue` clamps stored width to 40% of the viewport, bypassing the 250px minimum. Resizing an open drawer to a 390px viewport produced a 156px drawer; the sidebar/scrim also obstructed the Close action.

**Implementation guide:**

- Derive effective width from viewport and saved preferred width separately.
- Use a full-width drawer when space is insufficient; do not overwrite the user's desktop preference while temporarily narrow.
- Reuse the existing responsive detail-panel approach.
- Verify sidebar/scrim ordering, focus containment and Close reachability; width arithmetic alone does not resolve overlay interaction.

**Acceptance:** Open and resize at 390, 512, 768 and 1024 CSS pixels and at 200% zoom. Every field and Close action stays reachable without horizontal clipping. Returning to desktop restores preferred width. Test pointer and keyboard interaction in both themes.

Source review: VarLens `7989c395`. Browser observations refer to the earlier synthetic audit; implementation guidance is proposed work, not a claim of a completed fix.

