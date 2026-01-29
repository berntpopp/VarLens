---
phase: 23-side-panel-ui
plan: 03
subsystem: ui
tags: [vue, vuetify, inline-editing, comments, acmg, external-links]

# Dependency graph
requires:
  - phase: 23-01
    provides: VariantDetailsPanel infrastructure with resize and state management
  - phase: 20
    provides: useAnnotations composable, AcmgMenu component, annotation IPC API
provides:
  - Inline comment editing in side panel (global and per-case)
  - ACMG classification editing in side panel
  - Delete confirmation for comments
  - Shell domain allowlist for DECIPHER, ClinGen, Ensembl links
affects: [24-custom-tags-hpo]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "InlineEditableText reusable component for click-to-edit pattern"
    - "CommentsSection with optimistic updates via useAnnotations"
    - "Shell domain allowlist extension for new external resources"

key-files:
  created:
    - src/renderer/src/components/InlineEditableText.vue
    - src/renderer/src/components/CommentsSection.vue
  modified:
    - src/renderer/src/components/VariantDetailsPanel.vue
    - src/main/ipc/handlers/shell.ts

key-decisions:
  - "InlineEditableText uses v-textarea with auto-focus and blur-to-save UX"
  - "Delete confirmation dialog prevents accidental comment deletion"
  - "ACMG section shows both per-case and global classification in case mode"
  - "Comments load automatically when variant changes via watch"

patterns-established:
  - "Click-to-edit pattern: hover shows pencil icon, click switches to textarea"
  - "Optimistic UI updates with revert on error for all comment operations"
  - "Timestamp display with created/edited distinction"

# Metrics
duration: 6min
completed: 2026-01-29
---

# Phase 23 Plan 03: Comments and ACMG Editing Summary

**Inline comment editing with delete confirmation, ACMG classification editor, and external link domains for DECIPHER/ClinGen/Ensembl**

## Performance

- **Duration:** 6 minutes
- **Started:** 2026-01-29T01:08:51Z
- **Completed:** 2026-01-29T01:14:54Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- InlineEditableText reusable component with click-to-edit and auto-save on blur
- CommentsSection displaying global and per-case comments with inline editing
- ACMG classification section in panel with colored chip and AcmgMenu integration
- Shell domain allowlist updated to support DECIPHER, ClinGen, and Ensembl external links

## Task Commits

Each task was committed atomically:

1. **Task 1: Create InlineEditableText and CommentsSection components** - `880e206` (feat)
2. **Task 2: Update VariantDetailsPanel with comments and ACMG sections** - `f675679` (feat)
3. **Task 3: Update shell.ts ALLOWED_DOMAINS** - `cd10974` (feat)

## Files Created/Modified

**Created:**
- `src/renderer/src/components/InlineEditableText.vue` - Reusable click-to-edit text component with auto-save on blur
- `src/renderer/src/components/CommentsSection.vue` - Global and per-case comment display with inline editing and delete confirmation

**Modified:**
- `src/renderer/src/components/VariantDetailsPanel.vue` - Integrated 5 sections: VariantIdentity, AnnotationScores, ACMG, Comments, ExternalLinks
- `src/main/ipc/handlers/shell.ts` - Added deciphergenomics.org, clinicalgenome.org, ensembl.org, grch37.ensembl.org to allowlist

## Decisions Made

1. **InlineEditableText UX pattern:** Click-to-edit with hover pencil icon, blur saves automatically, Escape cancels
2. **Delete confirmation:** Dialog prevents accidental deletion, separate buttons for global vs case comments
3. **ACMG section layout:** Show per-case classification in case mode, display global classification as hint below if exists
4. **Timestamp formatting:** Use `Date.toLocaleString()` for consistent timestamp display with "edited" indicator
5. **Comment loading strategy:** Load annotations automatically via watch when variant changes, using loadAnnotations (case mode) or loadGlobalAnnotations (cohort mode)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**ESLint console.warn/error errors:**
- **Issue:** Flat config ESLint doesn't support `/* eslint-env browser */`, console undefined in Vue components
- **Resolution:** Added `/* global console */` comment at top of script section
- **Verification:** Lint passes for CommentsSection.vue

## Next Phase Readiness

**Ready for Phase 24 (Custom Tags + HPO):**
- Side panel fully functional with all annotation capabilities
- External link domains cover all planned resources
- Panel infrastructure solid for adding custom tag UI

**Parallel execution note:**
- Plan 23-02 (section components) ran in parallel as wave 2
- Both plans modified VariantDetailsPanel.vue successfully
- Integration worked seamlessly - section components existed when this plan ran

---
*Phase: 23-side-panel-ui*
*Completed: 2026-01-29*
