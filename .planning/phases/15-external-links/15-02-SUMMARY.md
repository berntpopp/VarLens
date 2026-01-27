---
phase: 15-external-links
plan: 02
subsystem: ui
tags: [external-links, variant-table, clickable-links, gnomad, clinvar, omim, ucsc, varsome, franklin, user-feedback]

# Dependency graph
requires:
  - phase: 15-01-external-links-foundation
    provides: URL builder functions and shell domain allowlist
provides:
  - Clickable external database links integrated into variant table cells
  - Visual link indicators (external-link icon, hover underline, click highlight)
  - Snackbar error handling for failed link opens
  - VarSome and Franklin virtual columns
affects: [future-variant-table-enhancements, genome-build-detection]

# Tech tracking
tech-stack:
  added: []
  patterns: [clickable-data-cells, inline-link-icons, user-feedback-snackbar, virtual-table-columns]

key-files:
  created: []
  modified:
    - src/renderer/src/components/VariantTable.vue

key-decisions:
  - "Data values themselves are clickable links -- no separate icon columns or action buttons"
  - "External-link icon (mdi-open-in-new) displayed as suffix on all clickable values for clear affordance"
  - "GRCh37 default genome build hardcoded for Phase 15; will be derived from case metadata in future phase"
  - "ClinVar links use coordinate search (chr:pos:ref:alt) since clinvar_id not yet in schema"
  - "OMIM links use gene symbol search since omim_mim_number not yet in schema"
  - "Brief highlight animation on click provides immediate visual feedback before browser opens"
  - "Snackbar error notification ('Could not open link') shown when shell.openExternal fails"

patterns-established:
  - "Clickable cell pattern: Conditional rendering based on URL builder result (null = no link, show dash)"
  - "Virtual columns for external tools: Non-sortable columns with 'View' link text instead of data"
  - "User feedback loop: Click highlight → URL open → snackbar on error"
  - "Icon suffix pattern: .external-link__icon with reduced opacity and small size"

# Metrics
duration: 8min
completed: 2026-01-27
---

# Phase 15-02: External Links UI Summary

**Clickable external database links in variant table (gnomAD, UCSC, ClinVar, OMIM, VarSome, Franklin) with visual indicators and error handling**

## Performance

- **Duration:** 8 min
- **Started:** 2026-01-27T22:10:58Z
- **Completed:** 2026-01-27T22:18:58Z
- **Tasks:** 2 (1 auto + 1 checkpoint)
- **Files modified:** 1

## Accomplishments

- Position values link to gnomAD variant pages with hover underline and external-link icon
- Chromosome values link to UCSC Genome Browser region centered on variant position
- ClinVar significance chips link to ClinVar coordinate search (chr:pos:ref:alt format)
- Gene symbols link to OMIM gene search pages
- VarSome and Franklin virtual columns added with "View" links for complete variants
- Click highlight animation provides immediate visual feedback
- Snackbar notification displays error message when link open fails
- Missing data shows dash placeholder with no clickable link

## Task Commits

Each task was committed atomically:

1. **Task 1: Add clickable external link cells to VariantTable.vue** - `6480323` (feat)
2. **Task 2: Human verification checkpoint** - APPROVED (no commit)

## Files Created/Modified

- `src/renderer/src/components/VariantTable.vue` - Added clickable link slots for pos, chr, clinvar, gene_symbol; virtual columns for VarSome and Franklin; click handler with visual feedback; snackbar error notification; external-link CSS styles

## Decisions Made

1. **Data values are links** - Design philosophy: the data itself is clickable (position value, chr value, ClinVar chip, gene symbol) rather than separate icon columns. Provides direct interaction with minimal visual clutter.

2. **External-link icon suffix** - Small `mdi-open-in-new` icon appears after each clickable value with reduced opacity. Provides clear affordance that value is a link without overwhelming the table.

3. **Default GRCh37 genome build** - Hardcoded for Phase 15 since Case interface does not yet store genome build. Future phase will add genome_build to Case metadata and derive from actual case data.

4. **ClinVar coordinate search** - Use `buildClinvarSearchUrl(chr, pos, ref, alt)` for coordinate-based search since Variant schema lacks clinvar_id field. When Phase 17 adds clinvar_id, can upgrade to ID-based links with fallback to coordinate search.

5. **OMIM gene search** - Use `buildOmimGeneSearchUrl(gene_symbol)` for gene-based search since Variant schema lacks omim_mim_number field. When Phase 17 adds omim_mim_number, can upgrade to MIM entry links with fallback to gene search.

6. **Click highlight feedback** - Brief 200ms highlight animation with primary color background applied to clicked element before browser opens. Provides immediate visual confirmation of user action.

7. **Snackbar error handling** - When `shell.openExternal` fails (invalid URL, non-allowlisted domain, or shell error), display snackbar with "Could not open link" message. Prevents silent failures and provides user feedback.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Verification Results

User tested external links and confirmed all working:
- Position → gnomAD: Correct variant pages opened
- Chromosome → UCSC: Correct genome browser regions opened
- ClinVar → ClinVar coordinate search: Correct search results
- Gene symbol → OMIM: Correct gene search pages
- VarSome → VarSome: Correct variant interpretation pages
- Franklin → Franklin: Correct variant assessment pages

**Verification outcome:** APPROVED

## User Setup Required

None - all external links work without configuration.

## Next Phase Readiness

**Ready for Phase 16 (Batch Import & ZIP Extraction):**
- External links feature complete for current schema
- No dependencies on Phase 16
- Phase 16 focuses on import workflows (independent concern)

**Future enhancements (Phase 17+):**
- Derive genome build from Case metadata instead of hardcoded GRCh37
- Upgrade ClinVar links to ID-based when clinvar_id added to schema
- Upgrade OMIM links to MIM entry when omim_mim_number added to schema
- Add additional database links as new data sources integrated

**No blockers or concerns.**

---
*Phase: 15-external-links*
*Completed: 2026-01-27*
