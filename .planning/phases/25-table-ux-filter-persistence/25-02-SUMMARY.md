---
phase: 25-table-ux-filter-persistence
plan: 02
subsystem: ui-components
completed: 2026-01-29
duration: 5 minutes

requires:
  - 25-01 useColumnPreferences composable
  - vuedraggable for drag-to-reorder

provides:
  - ColumnVisibilityMenu component with drag-to-reorder
  - Column visibility and order controls in VariantTable
  - Column visibility and order controls in CohortTable

affects:
  - VariantTable now has column customization with persistence
  - CohortTable now has column customization with persistence
  - Both tables store independent preferences in localStorage

tech-stack:
  added: []
  patterns:
    - Menu with close-on-content-click=false for interaction
    - Vuedraggable with handle for drag-to-reorder in menu
    - Computed properties for ordered and filtered headers
    - Per-table localStorage keys for independent preferences

key-files:
  created:
    - src/renderer/src/components/ColumnVisibilityMenu.vue
  modified:
    - src/renderer/src/components/VariantTable.vue
    - src/renderer/src/components/CohortTable.vue

decisions:
  - id: menu-based-reorder
    summary: "Column reorder via dragging items in menu (not dragging headers)"
    rationale: "Avoids complex DOM manipulation on v-data-table-server headers while providing full reorder functionality"
  - id: max-width-200px
    summary: "Column max-width set to 200px with ellipsis truncation"
    rationale: "Balances readability with horizontal scroll efficiency for data-dense tables"
  - id: independent-table-prefs
    summary: "VariantTable and CohortTable have separate localStorage keys"
    rationale: "Different table structures benefit from independent column preferences"

tags: [column-visibility, column-order, drag-drop, table-ux, persistence, vuedraggable]
---

# Phase 25 Plan 02: Column Visibility Menu with Drag-to-Reorder Summary

Column visibility menu with drag-to-reorder capability integrated into VariantTable and CohortTable for customizable column display with persistence.

## What Was Built

Created ColumnVisibilityMenu component and integrated column preferences into both VariantTable and CohortTable:

**ColumnVisibilityMenu.vue:**
- Menu component with draggable list for reordering columns
- Drag handle on left (grab cursor), checkbox for visibility toggle, column title
- Uses vuedraggable with handle=".drag-handle" for smooth drag experience
- Close-on-content-click=false keeps menu open during interactions
- Reset to Defaults button restores all columns visible in default order
- Props: columns, visibleColumns, tableId
- Events: toggle:column, reorder, reset

**VariantTable.vue integration:**
- Imported useColumnPreferences('variant-table') and ColumnVisibilityMenu
- Created orderedColumns computed property (applies user-preferred order)
- Created visibleHeaders computed property (filters by visibility)
- Used visibleHeaders in v-data-table-server :headers prop
- Added ColumnVisibilityMenu in toolbar above table
- Added CSS for max-width 200px with ellipsis and horizontal scroll

**CohortTable.vue integration:**
- Imported useColumnPreferences('cohort-table') and ColumnVisibilityMenu
- Converted headers const to baseHeaders
- Created orderedColumns and visibleHeaders computed properties
- Used visibleHeaders in v-data-table-server :headers prop
- Added ColumnVisibilityMenu in toolbar above search bar
- Added same CSS for max-width with ellipsis and horizontal scroll

## Technical Approach

**Column reordering UX pattern:**
- Drag items in menu list (not dragging headers directly)
- Avoids complex DOM manipulation on v-data-table-server
- Provides full reorder functionality with clear visual feedback
- vuedraggable with handle=".drag-handle" for grab-only-on-icon UX

**Computed property chain:**
1. `baseHeaders` (or `headers` computed for VariantTable with virtual links)
2. `orderedColumns` - sorts headers by prefs.value.order array
3. `visibleHeaders` - filters out columns with prefs.value.visibility[key] === false
4. Table uses `visibleHeaders` in :headers prop

**Persistence:**
- VariantTable: localStorage key `varlens_columns_variant-table`
- CohortTable: localStorage key `varlens_columns_cohort-table`
- Independent preferences allow different column configurations per table

**CSS for horizontal scroll:**
- th/td max-width 200px with overflow hidden and text-overflow ellipsis
- v-table__wrapper overflow-x auto for horizontal scroll when columns exceed viewport
- White-space nowrap prevents wrapping inside cells

## Deviations from Plan

**[Rule 1 - Bug] Removed explicit defineProps/defineEmits imports:**
- Found during: Task 1 TypeScript compilation
- Issue: defineProps and defineEmits are compiler macros in Vue 3 `<script setup>` and should not be explicitly imported from 'vue'
- Fix: Removed `import { defineProps, defineEmits } from 'vue'` line
- Files modified: ColumnVisibilityMenu.vue
- Commit: ea6b0ea

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 30db71e | Create ColumnVisibilityMenu component with drag-to-reorder |
| 2 | d15076b | Integrate column preferences into VariantTable |
| 3 | 9065e9b | Integrate column preferences into CohortTable |
| Fix | ea6b0ea | Remove explicit defineProps/defineEmits imports |

## Integration Points

**ColumnVisibilityMenu component:**
- Reusable for any table with column preferences
- Requires columns array with { key, title }
- Requires visibleColumns string[] of visible keys
- Emits toggle:column, reorder, reset events

**VariantTable:**
- Column menu in toolbar above table
- Preferences persist to `varlens_columns_variant-table`
- Includes virtual link columns from externalLinksStore
- Horizontal scroll enabled when all columns visible

**CohortTable:**
- Column menu in toolbar above search bar
- Preferences persist to `varlens_columns_cohort-table`
- Independent from VariantTable preferences
- Horizontal scroll enabled when all columns visible

## Testing Notes

TypeScript compilation verified (pre-existing FilterToolbar error unrelated to this plan). Lint passes for all modified files. Runtime testing deferred to manual verification:
- Column menu button appears in both tables
- Dragging items in menu reorders columns in table
- Checkbox toggles column visibility
- Preferences persist on page refresh
- Reset button restores defaults
- Click column headers to verify sorting still works with visual indicators
- Unhide all columns to verify horizontal scroll works without breaking layout

## Next Phase Readiness

Ready for Plan 03 (Filter toolbar enhancement with persistence) and Plan 04 (Filter state restoration). Both plans are independent and can proceed in parallel.

Column visibility and order functionality is complete and ready for user testing. Users can now customize which columns they see and the order of columns in both VariantTable and CohortTable, with preferences persisting across sessions.

---

*Completed: 2026-01-29*
*Duration: 5 minutes*
*Commits: 4 (3 feature + 1 fix)*
