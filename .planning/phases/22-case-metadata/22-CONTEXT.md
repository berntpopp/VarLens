# Phase 22: Case Metadata - Context

**Gathered:** 2026-01-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can assign status (affected/unaffected/unknown), cohort groups, and HPO phenotype terms to cases for stratification and phenotype-driven analysis. UI displays this metadata in case list and case header with filtering capabilities.

</domain>

<decisions>
## Implementation Decisions

### Status workflow
- Dropdown selector in case header to change status (click current status to reveal 3 options)
- Icon-only indicator in case list (minimal, no text badge)
- Filter case list by status (filter only, no sorting)
- Default status for new cases: "unknown"
- Import dialog shows optional status selector, defaults to "unknown" if skipped

### Cohort management
- Inline cohort creation: type new name in assignment field, creates on-the-fly
- Horizontal chips for multiple cohort assignments: [Control] [Batch-2] [Exome]
- Auto-assigned colors from palette when group created (no user color picking)
- Multi-select filter dropdown to filter case list by one or more cohorts

### HPO term display
- Name-only chips for HPO terms: [Seizure] [Sleep disturbance] — hover reveals HP:ID
- Show all assigned terms (no overflow limit, may wrap to multiple rows)
- Edit HPO terms directly in case header section
- HPO terms filterable in cohort analysis (find cases with specific phenotype)

### Case list integration
- Case list shows: status icon + cohort chips (HPO not in list view)
- Separate filter chips for Status, Cohort, HPO (combinable, not unified bar)
- Case detail header: grouped metadata card below case name
- Filter persistence: Claude's discretion based on UX best practice

### Claude's Discretion
- Filter state persistence across sessions
- Exact icon choices for status indicators
- Color palette for auto-assigned cohort colors
- Spacing and layout within metadata card

</decisions>

<specifics>
## Specific Ideas

- Status icons should be distinct enough to scan quickly in case list
- Cohort chips should feel like tags, not buttons
- HPO hover tooltip should show full term: "HP:0001250 Seizure"

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 22-case-metadata*
*Context gathered: 2026-01-28*
