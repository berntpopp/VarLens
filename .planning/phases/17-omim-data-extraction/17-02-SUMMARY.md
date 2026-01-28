---
phase: 17-omim-data-extraction
plan: 02
subsystem: ui
tags: [vue, vuetify, omim, external-links, variant-table]

# Dependency graph
requires:
  - phase: 17-01
    provides: Database schema with omim_mim_number field, OMIM gene dictionary import
  - phase: 15-external-links
    provides: External links infrastructure, buildOmimUrl function
provides:
  - OMIM column in variant table with clickable MIM number links
  - URL template system supporting {mim_number} variable
  - Removal of OMIM gene search link from external links defaults
affects: [18-cohort-analysis, future-variant-table-enhancements]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Dedicated inline links for specific columns (OMIM uses direct URL builder, not configurable template)
    - Em dash placeholder for empty cells in variant table

key-files:
  created: []
  modified:
    - src/shared/types/api.ts
    - src/renderer/src/utils/externalLinks.ts
    - src/renderer/src/stores/externalLinksStore.ts
    - src/renderer/src/components/VariantTable.vue
    - src/renderer/src/components/ExternalLinksSettings.vue

key-decisions:
  - "OMIM column uses dedicated inline link pattern (buildOmimUrl), not externalLinksStore template system"
  - "Removed OMIM gene search link from defaults - no fallback when MIM number absent"
  - "Em dash placeholder (—) for empty OMIM cells matches variant table design"

patterns-established:
  - "Dedicated column links: Some columns (like OMIM) bypass externalLinksStore and use direct URL builders for simpler user experience"
  - "mim_number field added to VariantLinkData for future custom link templates"

# Metrics
duration: 4min
completed: 2026-01-28
---

# Phase 17 Plan 02: OMIM MIM Number Display Summary

**Variant table shows clickable OMIM MIM numbers linking directly to omim.org entry pages, replacing gene search link**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-28T00:28:36Z
- **Completed:** 2026-01-28T00:33:16Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- OMIM column displays MIM numbers inline in variant table after Gene column
- MIM numbers are clickable links to https://omim.org/entry/{mim_number}
- Empty cells show em dash placeholder (no gene search fallback)
- Old OMIM gene search link removed from external links defaults
- URL template infrastructure supports {mim_number} for custom links

## Task Commits

Each task was committed atomically:

1. **Task 1: Update shared types and external links infrastructure for MIM number** - `6f18a5d` (feat)
2. **Task 2: Add OMIM column to variant table with clickable MIM number links** - `44d6e40` (feat)

## Files Created/Modified
- `src/renderer/src/utils/externalLinks.ts` - Added mim_number field to VariantLinkData, fieldMap, and variables in resolveUrlTemplate
- `src/renderer/src/stores/externalLinksStore.ts` - Removed OMIM gene search link from defaults, added omim_mim_number to LinkColumn type
- `src/renderer/src/components/VariantTable.vue` - Added OMIM column header after Gene, OMIM cell template with clickable link, buildOmimEntryUrl wrapper, mim_number in getVariantLinkData
- `src/renderer/src/components/ExternalLinksSettings.vue` - Added omim_mim_number label to column label map (bug fix for type completeness)

## Decisions Made

**OMIM link implementation pattern:**
- Used dedicated inline link pattern (buildOmimUrl) instead of externalLinksStore template system
- Rationale: Simpler user experience for core data field. MIM number is a single authoritative identifier, doesn't need configurable URL template like variant coordinates.

**No OMIM fallback:**
- Removed OMIM gene search link from defaults, no fallback when MIM number is absent
- Rationale: Per CONTEXT.md decision - users see exact OMIM entry when available, nothing when unavailable (prevents confusion from generic gene searches)

**Em dash placeholder:**
- Empty OMIM cells display "—" (em dash) instead of "--" or blank
- Rationale: Matches existing variant table design for optional fields (consistent visual language)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added omim_mim_number label to ExternalLinksSettings column label map**
- **Found during:** Task 2 (Type checking after VariantTable changes)
- **Issue:** Adding omim_mim_number to LinkColumn type broke type completeness check in ExternalLinksSettings.vue - Record<LinkColumn, string> was missing the new column
- **Fix:** Added `omim_mim_number: 'OMIM'` to getColumnLabel labels map
- **Files modified:** src/renderer/src/components/ExternalLinksSettings.vue
- **Verification:** `npm run typecheck` passes with zero errors
- **Committed in:** 44d6e40 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Bug fix required for type correctness. No scope creep.

## Issues Encountered
None - plan executed smoothly.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness

**Ready for Phase 18 (Cohort Analysis):**
- OMIM data fully integrated into variant table display
- Users can click MIM numbers to research gene phenotypes in OMIM
- Requirements OMIM-04 and OMIM-05 satisfied

**OMIM data extraction complete:**
- Phase 17-01: Database schema, OMIM gene dictionary import, MIM number extraction during VCF import
- Phase 17-02: UI display with clickable links

**No blockers or concerns.**

---
*Phase: 17-omim-data-extraction*
*Completed: 2026-01-28*
