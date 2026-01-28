# Phase 23: Side Panel UI - Context

**Gathered:** 2026-01-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Variant details side panel displays all database annotations, comments, ACMG classification, VEP enrichment, and external links with edit capabilities. This is a right-hand drawer triggered from the variant table.

</domain>

<decisions>
## Implementation Decisions

### Panel behavior
- Trigger: clicking anywhere on a variant row opens the panel
- Closes on navigation: switching between Case Analysis and Cohort Analysis tabs closes the panel
- Close methods: X button in panel header + Escape key (no click-outside-to-close)
- Width: User-resizable with drag handle, preference persisted

### Content organization
- Structure: Scrollable sections (not tabs, not accordions)
- Section order from top to bottom:
  1. Variant identity (gene, HGVS, position)
  2. Annotation scores (CADD, REVEL, SpliceAI, gnomAD AF, etc.)
  3. VEP enrichment data
  4. Comments (global and per-case)
  5. External links
- Score display: Compact horizontal chips with values (e.g., "CADD 28.5", "REVEL 0.92")
- Score coloring: Threshold-based colors (red/orange/green based on clinical significance thresholds)

### Edit experience
- Comment editing: Inline editing — click comment text to edit in place, auto-save on blur
- ACMG editing: Click badge to open dedicated menu with classification + evidence checkboxes (reuse existing AcmgMenu pattern)
- Save feedback: Optimistic updates with subtle checkmark — only show error if save fails
- Delete confirmation: Yes, confirm dialog for comment deletion ("Delete this comment?")

### External links
- Link targets: Both clinical (ClinVar, ClinGen, OMIM, Decipher, Franklin) and research (PubTator, LitVar, gnomAD browser, UCSC, Ensembl)
- Layout: Small icon buttons in a horizontal row with tooltips
- Missing data handling: Hide links that can't be generated (don't show disabled buttons)
- Copy buttons: Prominent copy-to-clipboard buttons next to HGVS, chr:pos:ref:alt, and rsID

### Claude's Discretion
- Exact resizable panel implementation (drag handle position, min/max widths)
- Clinical thresholds for score color-coding
- Icon choices for external link buttons
- VEP section layout and loading skeleton design
- Exact spacing and typography within sections

</decisions>

<specifics>
## Specific Ideas

- Panel should use existing Vuetify v-navigation-drawer (right, temporary)
- Reuse AcmgMenu component from Phase 20 for ACMG editing
- Follow existing warm palette theme for score chip colors
- Use existing URL template system for external link generation

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 23-side-panel-ui*
*Context gathered: 2026-01-28*
