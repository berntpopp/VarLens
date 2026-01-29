---
phase: 25-table-ux-filter-persistence
plan: 01
subsystem: ui-persistence
completed: 2026-01-29
duration: 2 minutes

requires:
  - "@vueuse/core for reactive localStorage"
  - "vuedraggable@next for future filter group dragging"

provides:
  - useColumnPreferences composable
  - useFilterPreferences composable
  - Reactive persistence infrastructure

affects:
  - 25-02 Column controls will use useColumnPreferences
  - 25-03 Filter toolbar will use useFilterPreferences
  - Future table/filter components for persistence integration

tech-stack:
  added:
    - vuedraggable@4.1.0
  patterns:
    - VueUse useStorage for reactive localStorage
    - Nullish coalescing operator for optional arrays
    - mergeDefaults for schema evolution safety

key-files:
  created:
    - src/renderer/src/composables/useColumnPreferences.ts
    - src/renderer/src/composables/useFilterPreferences.ts
  modified:
    - package.json

decisions:
  - id: varlens-prefix-localstorage
    summary: "Use 'varlens_' prefix for localStorage keys"
    rationale: "Follows existing convention from varlens_panel_width"
  - id: underscore-separation
    summary: "Use underscore separator (not dash) in localStorage keys"
    rationale: "Consistent with existing varlens_panel_width pattern"
  - id: width-clamping-range
    summary: "Column widths clamped to 60-500px"
    rationale: "60px minimum ensures readability, 500px maximum prevents extreme sizes"
  - id: default-filter-groups
    summary: "8 default filter groups: search, gene, impact, function, clinvar, frequency, cadd, tags"
    rationale: "Matches existing FilterToolbar functionality"
  - id: auto-merge-new-filters
    summary: "New filter groups auto-merged at end with active=true"
    rationale: "Graceful schema evolution when new filters added in future releases"

tags: [persistence, composables, preferences, columns, filters, localstorage]
---

# Phase 25 Plan 01: Composables Infrastructure for Preferences Summary

Reactive persistence infrastructure using VueUse for column and filter preferences with localStorage auto-sync.

## What Was Built

Created two composables that provide reactive state management with automatic localStorage persistence:

**useColumnPreferences(tableId):**
- Column order (drag to reorder, empty array = default order)
- Column visibility (show/hide, missing keys = visible by default)
- Column widths (resize with 60-500px clamping)
- LocalStorage key: `varlens_columns_${tableId}` (per-table)
- Functions: resetToDefaults, setColumnOrder, toggleColumnVisibility, setColumnWidth

**useFilterPreferences():**
- Filter group order (8 default groups: search, gene, impact, function, clinvar, frequency, cadd, tags)
- Filter group active state (expanded/collapsed)
- Auto-merge new filter groups when schema evolves
- LocalStorage key: `varlens_filter_groups` (global)
- Functions: filterGroups (computed, sorted), setFilterGroupOrder, toggleFilterGroupActive, resetToDefaults

**Dependency added:**
- vuedraggable@4.1.0 (Vue 3 port of SortableJS) for Plan 03 draggable filter groups

## Technical Approach

**VueUse useStorage pattern:**
- Ref<T> automatically syncs to localStorage on mutation
- mergeDefaults: true ensures backward compatibility when new properties added
- No manual localStorage.setItem calls needed (reactivity handles it)

**Width clamping:**
- MIN_WIDTH = 60px (readability threshold)
- MAX_WIDTH = 500px (prevent extreme sizes)
- Applied in setColumnWidth before storing

**Filter group merging:**
- mergeWithDefaults() checks stored groups against DEFAULT_FILTER_GROUPS
- Missing groups appended with order = maxOrder + 1
- Ensures new filter groups appear automatically in future releases

**Nullish coalescing:**
- Used `??` instead of `||` for array fallback to satisfy strict-boolean-expressions linter

## Deviations from Plan

None - plan executed exactly as written. One lint fix auto-applied (Rule 1):
- **[Rule 1 - Bug] Changed || to ?? in mergeWithDefaults:** ESLint strict-boolean-expressions error on array fallback. Fixed by using nullish coalescing operator.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 882b1e5 | Install vuedraggable@next for filter group dragging |
| 2 | fde26f7 | Create useColumnPreferences composable |
| 3 | 894493c | Create useFilterPreferences composable |
| Fix | 1742720 | Use nullish coalescing in useFilterPreferences |

## Integration Points

**For Plan 02 (Column controls):**
- Import useColumnPreferences('variants') in VariantTable.vue
- Use prefs.value.order for column reordering
- Use prefs.value.visibility for show/hide controls
- Use prefs.value.widths for resizable columns

**For Plan 03 (Filter toolbar):**
- Import useFilterPreferences() in FilterToolbar.vue
- Use filterGroups.value for rendering filter chips/groups
- Bind vuedraggable to setFilterGroupOrder for drag-to-reorder
- Use toggleFilterGroupActive for collapse/expand

## Testing Notes

TypeScript compilation verified. No runtime tests written (composables are reactive wrappers - behavior tested implicitly via UI integration in subsequent plans).

## Next Phase Readiness

Ready for Plan 02 (Column controls) and Plan 03 (Filter toolbar enhancement). Both can start immediately as they depend only on these composables.

---

*Completed: 2026-01-29*
*Duration: 2 minutes*
*Commits: 4 (3 feature + 1 fix)*
