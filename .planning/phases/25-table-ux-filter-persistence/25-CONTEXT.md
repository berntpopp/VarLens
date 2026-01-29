# Phase 25: Table UX & Filter Persistence - Context

**Gathered:** 2026-01-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Professional-grade table UX with sortable/draggable/hideable columns, sticky filter bar, filter groups with persistence, consistent filtering across Case/Cohort views, and streamlined case metadata access via modal. This phase improves existing table and filter infrastructure — no new data capabilities.

</domain>

<decisions>
## Implementation Decisions

### Column interactions
- Drag column headers directly to reorder (grab header, drag to new position, visual drop indicator)
- Right-click column header context menu for hide/show ("Hide column" + "Show columns..." submenu)
- Columns resizable by dragging edge (cursor changes at border, drag to adjust, snaps to min/max)
- Arrow icon sorting indicator (↑ ascending, ↓ descending) next to header text

### Filter bar UX
- Tab bar + filter bar both sticky at top during vertical scroll
- Keep current filter layout style but with better visual separation and controls
- Draggable filter groups — users can reorder filters in the bar to their preference
- Remove/close button per filter group
- Deactivated filters collapse to save space (minimized state, enables room for more filters)
- Horizontal scroll with left/right arrows when filters overflow (single row, no wrapping)

### Persistence strategy
- Column preferences (order, visibility, width) are global across all cases and cohorts
- Filter groups and arrangement are global
- All preferences stored in localStorage (simple, no IPC overhead)
- Separate reset options in Settings: "Reset columns" and "Reset filters" as distinct actions

### Case metadata modal
- Trigger button in case banner/header area (visible in Case Analysis mode)
- Medium dialog size (500-600px) centered on screen
- View + edit all metadata: status, cohorts, HPO terms
- Auto-save on change (no explicit save button needed)

### Claude's Discretion
- Exact drag indicator styling during column/filter reorder
- Collapse animation for deactivated filters
- Scroll arrow button styling
- Modal section layout and spacing
- Context menu styling for column hide/show

</decisions>

<specifics>
## Specific Ideas

- Filter bar should follow best practices for draggable/reorderable UI elements — research senior UI/UX patterns for intuitive drag-and-drop filter arrangement
- Deactivated filters should collapse to save horizontal space, enabling power users to have many filter presets available
- The goal is that users can set their own filters and arrange them to their liking

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 25-table-ux-filter-persistence*
*Context gathered: 2026-01-29*
