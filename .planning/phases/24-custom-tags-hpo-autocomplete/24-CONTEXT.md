# Phase 24: Custom Tags + HPO Autocomplete - Context

**Gathered:** 2026-01-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can create custom tags with colors, assign to variants, filter by tags, and search HPO terms with autocomplete. Tags are managed in settings and assigned via the side panel. HPO search supports full offline mode with bundled ontology data.

</domain>

<decisions>
## Implementation Decisions

### Tag visual design
- Color picker: Preset palette of 8-12 curated colors that work with the warm theme
- Table display: Count badge showing number of tags assigned (e.g., "3")
- Tag assignment: In side panel (Phase 23) — add a Tags section for viewing/assigning tags
- In side panel: Show assigned tags as chips, button to add more

### Tag management workflow
- Tag creation/editing: Dedicated settings page — Settings menu → 'Tags' section → list with edit/delete
- Tag scope: Per-database — tags stored in SQLite file, different databases have different tags
- Delete behavior: Confirm with count — "This tag is assigned to 12 variants. Delete anyway?"
- No inline creation: Must create tags in settings first, then assign in side panel

### HPO search behavior
- Result display: ID + Name format — "HP:0001250 - Seizure"
- Synonym matching: No — search matches official HPO term names only
- Assigned terms display: Chips with X to remove — horizontal row showing full ID + name
- Result limit: 10 autocomplete results shown at once

### Offline HPO fallback
- Bundle size: Full HPO (~18k terms, ~3-5MB) bundled with app
- Offline indicator: Silent fallback — same UX online/offline, no indicator
- Auto-update: No — HPO updates via app releases only

### Claude's Discretion
- Exact preset color palette values
- Tag chip styling in side panel
- HPO result ranking algorithm
- Minimum characters before search triggers
- Settings page layout for tag management
- Filter dropdown design in variant table

</decisions>

<specifics>
## Specific Ideas

- Tags section integrates into Phase 23 side panel design (scrollable sections pattern)
- Use existing warm palette theme colors as basis for preset tag colors
- HPO bundled JSON can be loaded lazily on first search to avoid startup impact
- Tag filter in variant table header should use multi-select dropdown pattern

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 24-custom-tags-hpo-autocomplete*
*Context gathered: 2026-01-29*
