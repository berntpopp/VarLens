# Phase 5: UI Shell + Cases - Context

**Gathered:** 2026-01-26
**Status:** Ready for planning

<domain>
## Phase Boundary

App layout with case sidebar that lists, selects, and deletes imported cases. Users can view all cases, select one to see its variants, and delete cases with confirmation. The main content area updates based on case selection.

</domain>

<decisions>
## Implementation Decisions

### Layout structure
- Sidebar positioned on **left side** — standard familiar pattern
- Sidebar is **collapsible with toggle** — user can collapse to gain table space
- Sidebar width **~240px** (narrow) — maximizes variant table space
- When no case selected, show **welcome/empty state** with guidance message

### Case list display
- Each case shows: **name + variant count + import date** (e.g., "Sample A • 12,450 • Jan 26")
- Cases sorted **most recent first** — newest imports at top
- **Compact visual density** — tight spacing to see more cases
- Include **simple text filter** for searching case names

### Selection behavior
- Selected case indicated with **highlighted background** color
- **No session persistence** — each launch shows welcome state, no remembered selection
- Clicking already-selected case **does nothing** (stays selected)
- Show **loading indicator** when selecting a case while variants load

### Delete interaction
- Access delete via **right-click context menu**
- **Modal dialog confirmation** — "Delete 'Sample A'? This will remove all X variants."
- After delete, **show welcome state** (no auto-select next case)
- Show **brief toast/snackbar notification** on successful delete

### Claude's Discretion
- Exact toggle button design for collapsible sidebar
- Loading indicator style (spinner vs skeleton)
- Toast/snackbar duration and positioning
- Context menu styling

</decisions>

<specifics>
## Specific Ideas

No specific product references provided — open to standard Vuetify patterns.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-ui-shell-cases*
*Context gathered: 2026-01-26*
