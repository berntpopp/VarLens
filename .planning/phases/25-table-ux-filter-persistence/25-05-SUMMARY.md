---
phase: 25-table-ux-filter-persistence
plan: 05
subsystem: ui
tags: [vuetify, vue3, table-ux, scrolling, filter-ui]

# Dependency graph
requires:
  - phase: 25-04
    provides: Filter visibility management foundation
provides:
  - Top scrollbar for both VariantTable and CohortTable
  - Middle mouse button horizontal drag scrolling
  - Rotated collapsed filter labels
  - Consistent CohortTable layout with FilterToolbar
affects: [table-ux, filter-ui]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Dual scrollbar synchronization", "Middle mouse button drag scrolling", "CSS writing-mode for rotated text"]

key-files:
  created: []
  modified:
    - src/renderer/src/components/VariantTable.vue
    - src/renderer/src/components/CohortTable.vue
    - src/renderer/src/components/FilterToolbar.vue
    - src/renderer/src/components/FilterVisibilityMenu.vue
    - src/renderer/src/composables/useFilterPreferences.ts
    - src/renderer/src/App.vue

key-decisions:
  - "Top scrollbar synced with bottom - both visible and functional"
  - "Middle mouse button enables drag-to-scroll horizontally"
  - "Rotated filter labels use CSS writing-mode: vertical-rl with 180deg rotation"
  - "CohortTable results section uses same 3x2 grid layout as FilterToolbar"

patterns-established:
  - "Dual scrollbar pattern: top and bottom scrollbars sync via onscroll events with flag to prevent loops"
  - "Middle mouse drag: mousedown sets isDragging flag, mousemove adjusts scrollLeft proportionally"
  - "ResizeObserver updates top scrollbar inner width to match table scroll width"

# Metrics
duration: ~30min
completed: 2026-01-29
---

# Phase 25 Plan 05: Table Scrolling & Filter Collapse Labels Summary

**Enhanced table horizontal scrolling with dual scrollbars and middle mouse drag, plus collapsed filter group labels**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-01-29T09:45:00Z
- **Completed:** 2026-01-29T10:15:00Z
- **Tasks:** 4
- **Files modified:** 6

## Accomplishments

### 1. Top Scrollbar for Tables
- Added top scrollbar container above both VariantTable and CohortTable
- Scrollbar inner div width dynamically matches table scroll width via ResizeObserver
- Top and bottom scrollbars synchronized - scrolling one scrolls both
- Matching visual style for both scrollbars (same height, color, hover effects)

### 2. Middle Mouse Button Horizontal Scrolling
- Middle mouse button (wheel click) enables drag-to-scroll horizontally
- Drag motion proportionally scrolls the table left/right
- Works in both VariantTable and CohortTable
- Prevents default middle-click behavior during drag

### 3. Collapsed Filter Labels
- When a filter group is collapsed, its name displays as a rotated vertical label
- Uses CSS `writing-mode: vertical-rl` with `transform: rotate(180deg)` for proper orientation
- Clicking the collapsed label expands the filter group
- Labels styled with subtle colors and uppercase text

### 4. CohortTable Layout Consistency
- CohortTable results section now uses same 3x2 grid layout as FilterToolbar
- ColumnVisibilityMenu moved inside the results section grid
- Consistent visual hierarchy between Case Analysis and Cohort Analysis views

## Files Modified

- **VariantTable.vue**: Added top scrollbar container, dual scrollbar sync, middle mouse drag scrolling, ResizeObserver for dynamic width
- **CohortTable.vue**: Same scrollbar enhancements, updated results section to 3x2 grid layout matching FilterToolbar
- **FilterToolbar.vue**: Added collapsed-label component with rotated text styling
- **FilterVisibilityMenu.vue**: Updated toggle methods to use `toggleFilterGroupExpanded` and `toggleFilterGroupVisible`
- **useFilterPreferences.ts**: Added `toggleFilterGroupVisible` and `hideFilterGroup` methods, fixed method exports
- **App.vue**: Minor adjustments for consistency

## Technical Details

### Dual Scrollbar Synchronization
```javascript
const isTopScrolling = ref(false)
const isTableScrolling = ref(false)

const handleTopScroll = () => {
  if (isTableScrolling.value) return
  isTopScrolling.value = true
  tableWrapper.scrollLeft = topScrollbar.scrollLeft
  nextTick(() => { isTopScrolling.value = false })
}

const handleTableScroll = () => {
  if (isTopScrolling.value) return
  isTableScrolling.value = true
  topScrollbar.scrollLeft = tableWrapper.scrollLeft
  nextTick(() => { isTableScrolling.value = false })
}
```

### Middle Mouse Drag Scrolling
```javascript
const handleMouseDown = (e: MouseEvent) => {
  if (e.button === 1) { // Middle mouse button
    isDragging.value = true
    startX.value = e.clientX
    startScrollLeft.value = scrollContainer.scrollLeft
    e.preventDefault()
  }
}

const handleMouseMove = (e: MouseEvent) => {
  if (!isDragging.value) return
  const dx = e.clientX - startX.value
  scrollContainer.scrollLeft = startScrollLeft.value - dx
}
```

### Collapsed Label CSS
```css
.collapsed-label {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  transform: rotate(180deg);
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer;
  padding: 4px 0;
  white-space: nowrap;
}
```

## Issues Encountered

1. **Scrollbar sync loop**: Initially both scrollbars triggered each other infinitely. Fixed with flag-based debouncing.
2. **Unused variable lint error**: `resetToDefaults`, `toggleColumnVisibility`, `setColumnOrder` from useColumnPreferences were unused in VariantTable after moving column management. Fixed by only destructuring `prefs`.

## Deviations from Plan

This was ad-hoc enhancement work requested by user, not a pre-planned execution. Work was done iteratively based on user feedback.

## User Setup Required

None - no external service configuration required.

## Next Steps

Phase 25 table UX and filter persistence work is now complete. Ready for:
- User verification of scrolling behavior
- Potential future enhancements based on user feedback

---
*Phase: 25-table-ux-filter-persistence*
*Completed: 2026-01-29*
