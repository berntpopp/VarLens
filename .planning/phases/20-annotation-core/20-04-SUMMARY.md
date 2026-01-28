---
phase: 20-annotation-core
plan: 04
status: complete
completed: 2026-01-28
duration: 6 minutes
subsystem: renderer-components
tags: [vue, vuetify, acmg, comments, dialog, menu]

dependency-graph:
  requires: ["20-03"]
  provides: ["acmg-dropdown-ui", "comment-dialog-ui", "variant-table-annotation-integration"]
  affects: ["23-side-panel-ui"]

tech-stack:
  added: []
  patterns: ["emit-based-component-communication", "slot-based-activator-pattern", "optimistic-ui-update"]

files:
  created:
    - src/renderer/src/components/AcmgMenu.vue
    - src/renderer/src/components/CommentDialog.vue
  modified:
    - src/renderer/src/components/VariantTable.vue

decisions:
  - id: props-simplified-for-dialog
    summary: "CommentDialog receives only comment data, not variant coordinates (caller handles persistence)"
    rationale: "Cleaner separation of concerns, avoids reserved prop name conflicts with Vue's ref"

metrics:
  tasks-completed: 3
  tasks-total: 3
  commits: 3
---

# Phase 20 Plan 04: ACMG Menu and Comment Dialog UI Summary

**One-liner:** Dropdown menu for ACMG classification selection and tabbed dialog for global/per-case comment editing

## What Was Built

### AcmgMenu Component (50 lines)
A v-menu dropdown component that:
- Uses slot-based activator pattern for flexible triggering
- Shows all 5 ACMG classifications (Pathogenic, Likely Pathogenic, VUS, Likely Benign, Benign)
- Displays colored chips with abbreviations (P, LP, VUS, LB, B)
- Includes "Clear classification" option with divider
- Emits `select` event with classification or null

### CommentDialog Component (143 lines)
A dialog component that:
- Uses v-tabs to switch between Global and Per-case comment views
- Displays timestamps (created_at, updated_at) when comments exist
- Tracks changes via initial value comparison
- Normalizes empty strings to null on save
- Emits save event with change flags for selective persistence

### VariantTable Integration
Updates to VariantTable.vue:
- ACMG column now wraps badge in AcmgMenu dropdown
- Shows add icon (mdi-tag-plus-outline) when no classification exists
- New comment column with mdi-comment-text icons
- Filled icon when comment exists, outline when empty
- Click handlers call useAnnotations composable methods
- Timestamp helpers extract from annotation cache

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | e585ebf | Create AcmgMenu component for classification dropdown |
| 2 | dc7a911 | Create CommentDialog component for comment editing |
| 3 | ea324fc | Integrate AcmgMenu and CommentDialog into VariantTable |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reserved prop name conflict**
- **Found during:** Task 2
- **Issue:** Vue's `ref` import conflicted with `ref` prop name, causing ESLint vue/no-reserved-props error
- **Fix:** Simplified CommentDialog props to only include comment data (globalComment, perCaseComment, timestamps), removed unused variant coordinate props
- **Files modified:** src/renderer/src/components/CommentDialog.vue
- **Commit:** dc7a911

## Key Implementation Details

### Component Communication Pattern
```
VariantTable
  |
  +-- AcmgMenu (emits 'select')
  |     +-- handleAcmgSelect() calls setAcmgClassification()
  |
  +-- CommentDialog (emits 'save')
        +-- handleCommentSave() calls upsertGlobalComment/upsertPerCaseComment()
```

### Activator Slot Pattern
```vue
<AcmgMenu @select="(c) => handleAcmgSelect(item, c)">
  <template #activator="{ props: menuProps }">
    <v-chip v-bind="menuProps" ... />
  </template>
</AcmgMenu>
```

## Testing Notes

Manual verification required:
1. Click ACMG badge -> dropdown appears with 5 options
2. Select classification -> badge updates, persists after refresh
3. Click clear -> classification removed
4. Click comment icon -> dialog opens with tabs
5. Add global comment -> saves, icon fills
6. Add per-case comment -> saves
7. Timestamps display when comments exist

## Next Phase Readiness

**Blockers:** None

**Ready for:**
- Phase 21: API Service Layer (VEP + HPO clients)
- Phase 23: Side Panel UI (can use ACMG/comment data in drawer)

**Dependencies satisfied:**
- Annotation mutation methods available (20-03)
- UI components integrate seamlessly with composable
- Optimistic updates provide instant feedback
