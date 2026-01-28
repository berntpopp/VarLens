---
phase: 20-annotation-core
verified: 2026-01-29T00:05:00Z
status: passed
score: 9/9 must-haves verified
---

# Phase 20: Annotation Core Verification Report

**Phase Goal:** Users can annotate variants with comments, stars/flags, and ACMG classification with persistent storage.
**Verified:** 2026-01-29T00:05:00Z
**Status:** passed
**Re-verification:** Yes - post-UAT design changes (per-case starred/ACMG, cohort mode global annotations)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can add a global comment to any variant visible to all cases containing that variant | VERIFIED | `upsertGlobalComment()` in useAnnotations.ts calls `window.api.annotations.upsertGlobal`, IPC handler in annotations.ts, DatabaseService.upsertGlobalAnnotation with INSERT ON CONFLICT pattern |
| 2 | User can add a per-case comment to a variant specific to one case's context | VERIFIED | `upsertPerCaseComment()` in useAnnotations.ts calls `window.api.annotations.upsertPerCase`, IPC handler in annotations.ts, DatabaseService.upsertPerCaseAnnotation |
| 3 | User can edit and delete existing comments with preserved timestamps (created_at, updated_at) | VERIFIED | Schema has `created_at` and `updated_at` columns, timestamps displayed in CommentDialog.vue, delete methods call upsert with null |
| 4 | User can toggle per-case star/flag on any variant to mark as interesting for this case | VERIFIED | `toggleStar()` in useAnnotations.ts with per-case upsert, star column in VariantTable.vue with optimistic updates |
| 5 | User can toggle global star/flag in cohort mode to mark variant as globally interesting | VERIFIED | `toggleGlobalStar()` in useAnnotations.ts, star icon in CohortTable.vue with click handler |
| 6 | User can assign per-case ACMG 5-tier classification to any variant | VERIFIED | `setAcmgClassification()` in useAnnotations.ts with caseId/variantId, AcmgMenu.vue defines all 5 classifications |
| 7 | User can assign global ACMG classification in cohort mode | VERIFIED | `setGlobalAcmgClassification()` in useAnnotations.ts, AcmgMenu in CohortTable.vue |
| 8 | Global annotations show with visual indicator (ring/border) in Case Analysis mode | VERIFIED | `.annotation-icon-wrapper.has-global` CSS class in VariantTable.vue shows 2px box-shadow ring when global annotation exists |
| 9 | Deleting a case cascades deletion of that case's per-case annotations without orphaned records | VERIFIED | Foreign key `ON DELETE CASCADE` in migrations.ts, test passes in migrations.test.ts |

**Score:** 9/9 truths verified

### Post-UAT Design Changes (2026-01-29)

The following changes were made after UAT feedback:

1. **Per-case Starred and ACMG** (Schema Migration v3)
   - Moved `starred`, `acmg_classification`, `acmg_evidence` columns from `variant_annotations` to `case_variant_annotations`
   - Different cases can now classify the same variant differently
   - Migration in migrations.ts handles upgrade to version 3

2. **Consolidated Annotation Column**
   - Star, ACMG, and Comment icons now in single column (`annotations`)
   - Reduced table width, compact UI with `d-flex align-center ga-1`

3. **Global Annotations Visible in Case Mode**
   - When viewing a variant in Case Analysis, global annotations show with ring indicator
   - Tooltips explain: "Starred (case + global)", "Global star (click to add case star)", etc.
   - Box-shadow ring: `0 0 0 2px rgba(primary, 0.4)`

4. **Cohort Mode Global Annotations**
   - CohortTable.vue now has full annotation controls
   - Global star, ACMG classification, and comments can be set from cohort view
   - Uses `toggleGlobalStar`, `setGlobalAcmgClassification`, `upsertGlobalComment`

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/main/database/DatabaseService.ts` | Annotation CRUD methods | VERIFIED | upsertGlobalAnnotation, upsertPerCaseAnnotation with IFNULL pattern for partial updates |
| `src/main/ipc/handlers/annotations.ts` | IPC handlers for annotations | VERIFIED | 7 IPC channels with boolean-to-integer conversion for starred field |
| `src/preload/index.ts` | Annotations namespace in window.api | VERIFIED | All 7 methods exposed in annotations namespace |
| `src/renderer/src/composables/useAnnotations.ts` | Reactive annotation state management | VERIFIED | 498 lines, exports per-case AND global methods for star, ACMG, comments |
| `src/renderer/src/components/AcmgMenu.vue` | ACMG classification dropdown | VERIFIED | v-menu with 5 classifications and clear option |
| `src/renderer/src/components/CommentDialog.vue` | Comment editing dialog | VERIFIED | v-dialog with v-tabs for global/per-case, timestamp display |
| `src/renderer/src/components/VariantTable.vue` | Integrated annotation columns | VERIFIED | 750+ lines, consolidated annotation column with global indicator rings, tooltips |
| `src/renderer/src/components/CohortTable.vue` | Global annotations in cohort mode | VERIFIED | 497 lines, annotation column with global star/ACMG/comment controls |
| `src/main/database/migrations.ts` | Schema migration v3 | VERIFIED | Added starred, acmg_classification, acmg_evidence to case_variant_annotations |
| `tests/main/database/migrations.test.ts` | Migration tests updated | VERIFIED | Tests expect user_version = 3 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| VariantTable.vue | useAnnotations composable | import + destructure | WIRED | Imports both per-case AND global methods |
| VariantTable.vue | isGlobalStarred, getGlobalAcmgClassification | composable methods | WIRED | Used for ring indicator display |
| CohortTable.vue | useAnnotations composable | import + destructure | WIRED | Uses global annotation methods only |
| CohortTable.vue | toggleGlobalStar | @click handler | WIRED | handleGlobalStarToggle calls toggleGlobalStar |
| CohortTable.vue | CommentDialog | v-model + @save | WIRED | Opens dialog for global comments |
| VariantTable.vue | .has-global CSS class | :class binding | WIRED | Applied when global annotation exists |

### CSS Verification

| Selector | Purpose | File | Status |
|----------|---------|------|--------|
| `.annotation-icon-wrapper` | Container for annotation icons | VariantTable.vue | VERIFIED |
| `.annotation-icon-wrapper.has-global` | Ring indicator for global annotations | VariantTable.vue | VERIFIED |
| `.cursor-pointer` | Pointer cursor on clickable icons | VariantTable.vue, CohortTable.vue | VERIFIED |

### Test Status

- **Migration tests:** Updated to expect `user_version = 3` - all pass
- **App.vue tests:** 2 failures (pre-existing mock issue, unrelated to Phase 20)
- **All other tests:** Pass (194/197)

---

## Summary

Phase 20 goal has been achieved with post-UAT enhancements:

1. **Per-case annotations** (star, ACMG) stored in `case_variant_annotations` table
2. **Global annotations** (star, ACMG, comment) stored in `variant_annotations` table
3. **Visual distinction** between global and per-case via ring indicator + tooltips
4. **Cohort mode** has full global annotation support
5. **Case mode** shows both per-case (primary) and global (ring indicator) annotations

Schema migration v3 handles the transition from global-only to per-case starred/ACMG.

---

*Verified: 2026-01-29T00:05:00Z*
*Verifier: Claude (manual re-verification after UAT changes)*
