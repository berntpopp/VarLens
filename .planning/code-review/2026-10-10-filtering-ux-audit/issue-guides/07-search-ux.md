**TL;DR:** Analysts should discover fields and understand a query without memorizing syntax. Errors and suggestions must work with keyboard and assistive technology.

**Priority:** P2 · Enhancement.

**Evidence:** `DslSearchBar.vue` hides error details in a hover tooltip; the input lacks combobox/listbox relationships, and Escape blurs it. Existing field metadata and typed controls provide the starting point.

**Implementation guide:**

- Show persistent inline errors, a clear Apply action, a readable preview and a searchable field/operator/value picker using the existing registry and applied state.
- Display only fields supported by the current view/type; explain missing-value behavior.
- Set combobox attributes on the actual input, with listbox/option IDs and active-descendant tracking. Escape should dismiss suggestions while retaining input focus.
- Implementation lesson: Vuetify 4 can copy a `role` prop to both wrapper and input. Inspect rendered DOM and assert exactly one valid combobox.
- Keep feedback visible below the popup, allow useful input width/wrapping, and check expanded-menu contrast in both themes.
- Force current validation on Apply/Enter; stale debounced errors must not block a just-corrected query.

**Acceptance:** Complete a guided query without typing syntax, round-trip it losslessly, fix an error and immediately press Enter, and navigate suggestions entirely by keyboard. Run axe with the popup open plus a manual screen-reader check.

Source review: VarLens `7989c395`. Browser observations refer to the earlier synthetic audit; implementation guidance is proposed work, not a claim of a completed fix.

