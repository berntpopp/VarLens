# Phase 7: Filters - Context

**Gathered:** 2026-01-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Filter toolbar that narrows variant table results via gene symbol, consequence, gnomAD AF, CADD score, and FTS5 search. Filters apply to the currently selected case's variants. Advanced filtering features (saved filters, filter presets, complex boolean queries) are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Filter layout
- Horizontal toolbar positioned above the variant table
- Always visible (not collapsible)
- Single row with all filters visible — no wrapping or grouping
- Compact density (smaller inputs, tighter spacing) to maximize table space

### Filter style
- Toggle chips/pills like Varvis design — colored when active, click to toggle
- Gene filter is exception: text input with autocomplete (open-ended search)
- Consequence filter: multi-select dropdown populated from database distinct values
- Visual reference: Varvis filter bar with colored pill buttons (A45, LGD, 1%, 0.1%, etc.)

### Input behaviors
- Auto-apply with debounce (no Apply button needed)
- 300ms debounce delay before filters execute
- Gene symbol input offers autocomplete suggestions from database values
- Consequence dropdown allows selecting multiple values

### Numeric filters (AF/CADD)
- Text input only for both gnomAD AF and CADD (no sliders)
- Preset quick-pick buttons for common AF thresholds (0.01, 0.001, 1e-4)
- Preset quick-pick buttons for common CADD thresholds (10, 15, 20, 25)
- Presets render as toggle chips — one click to apply

### Active filter feedback
- Highlighted inputs indicate active filters (border color or background change)
- No separate filter chips below toolbar
- Clear individual filters with X button on each input
- Clear All button appears only when at least one filter is active
- Result count displayed near filters: "Showing X of Y variants"

### Claude's Discretion
- Exact chip colors and highlight styles
- Preset value placement (inline with input or separate row)
- Loading indicator during filter queries
- Keyboard navigation between filter inputs

</decisions>

<specifics>
## Specific Ideas

- Follow Varvis design patterns — horizontal bar of colored toggle chips above table
- Reference screenshots in `plan/screenshots/varvis-*.png`:
  - `varvis-case-892-variants-full.png` — full variant table with filter bar
  - `varvis-filter-1pct.png` — filter bar with 1% AF filter active
  - `varvis-filter-xd.png` — inheritance mode filter panel (right sidebar, out of scope for Phase 7)
- Compact, data-dense aesthetic matching the overall app goal
- Toggle chips should feel snappy — immediate visual feedback on click

</specifics>

<deferred>
## Deferred Ideas

- Inheritance mode filters (DN, AD, AR, CH, XD, XR, etc.) — requires additional data model, separate phase
- Saved filter presets — user can save and recall filter combinations
- Column selector (visible in varvis-column-selector.png) — Phase 6 or separate phase
- Advanced boolean filter queries (AND/OR combinations)

</deferred>

---

*Phase: 07-filters*
*Context gathered: 2026-01-26*
