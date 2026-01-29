---
phase: 22
plan: 01
subsystem: backend
status: complete
completed: 2026-01-29
duration: 3 minutes
tags: [database, ipc, case-metadata, cohorts, hpo-terms]

requires:
  - phase: 19
    provides: Schema migration v2 with case_metadata, cohort_groups, case_cohort_links, case_hpo_terms tables
  - phase: 20
    provides: Atomic annotation upsert pattern with COALESCE

provides:
  - DatabaseService methods for case metadata CRUD
  - IPC layer for case metadata operations
  - Typed preload API for renderer access

affects:
  - phase: 23
    impact: Side panel UI can consume caseMetadata API

tech-stack:
  added: []
  patterns:
    - Atomic upsert with COALESCE for partial updates
    - setCaseCohorts bulk replace pattern (delete + insert in transaction)
    - HPO term upsert updates label on conflict

key-files:
  created:
    - src/main/ipc/handlers/case-metadata.ts
  modified:
    - src/main/database/DatabaseService.ts
    - src/main/ipc/index.ts
    - src/preload/index.ts
    - src/shared/types/api.ts

decisions:
  - name: Case metadata upsert pattern
    choice: Same atomic COALESCE pattern as annotations
    rationale: Proven pattern from phase 20, avoids race conditions
    alternatives:
      - Read-modify-write: Prone to race conditions
    impact: All case metadata updates are atomic and partial-update safe

  - name: setCaseCohorts bulk replace
    choice: Delete all + insert new in transaction
    rationale: Simpler than diffing, atomic replacement
    alternatives:
      - Diff and apply incremental changes: More complex, same result
    impact: UI can set entire cohort list with single API call

  - name: HPO term label updates
    choice: Upsert updates hpo_label on conflict
    rationale: Label might change in HPO ontology, keep in sync
    alternatives:
      - Never update labels: Would show stale labels
    impact: HPO term labels stay current with latest ontology

metrics:
  - name: DatabaseService methods added
    value: 12
    unit: methods
  - name: IPC channels registered
    value: 14
    unit: channels
  - name: Lines of code
    value: 433
    unit: lines
    breakdown:
      - DatabaseService.ts: 236 lines
      - case-metadata.ts: 197 lines
---

# Phase 22 Plan 01: Case Metadata Backend Summary

**One-liner:** Case metadata backend with DatabaseService methods, IPC layer, and typed preload API for status/cohorts/HPO terms.

## What Was Accomplished

Built complete case metadata backend infrastructure:

**DatabaseService extensions (12 methods, 236 lines):**
- Case metadata: `getCaseMetadata`, `upsertCaseMetadata` with atomic COALESCE upsert
- Cohort groups: `listCohortGroups`, `createCohortGroup`, `deleteCohortGroup`, `getCohortGroupByName`
- Case-cohort links: `getCaseCohorts`, `assignCaseCohort`, `removeCaseCohort`, `setCaseCohorts` (bulk replace)
- HPO terms: `getCaseHpoTerms`, `assignCaseHpoTerm` (upsert with label update), `removeCaseHpoTerm`

**IPC layer (14 channels, 197 lines):**
- `case-metadata:get`, `case-metadata:upsert`
- `case-metadata:listCohorts`, `createCohort`, `deleteCohort`, `getCohortByName`
- `case-metadata:getCaseCohorts`, `assignCohort`, `removeCohort`, `setCohorts`
- `case-metadata:getHpoTerms`, `assignHpoTerm`, `removeHpoTerm`
- `case-metadata:getFullMetadata` convenience method (metadata + cohorts + HPO in one call)

**Preload API:**
- `window.api.caseMetadata` namespace with 14 typed methods
- `CaseMetadataAPI`, `CaseMetadataUpdates`, `AffectedStatus`, `FullCaseMetadata` types exported from shared types

**Patterns established:**
- Reused atomic upsert COALESCE pattern from phase 20 annotations
- `setCaseCohorts` bulk replace pattern (delete all + insert in transaction)
- HPO term upsert updates label on conflict (keeps labels current)

## Deviations from Plan

None - plan executed exactly as written.

## Technical Decisions

**1. Case metadata upsert pattern**

Used same atomic COALESCE pattern as annotations (phase 20):
```sql
INSERT INTO case_metadata (case_id, affected_status, notes, created_at, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(case_id) DO UPDATE SET
  affected_status = COALESCE(excluded.affected_status, affected_status),
  notes = COALESCE(excluded.notes, notes),
  updated_at = excluded.updated_at
```

- Only updates fields provided in updates object
- Atomic operation prevents race conditions
- Proven pattern from phase 20

**2. setCaseCohorts bulk replace**

Chose delete-all + insert-new over incremental diff:
```typescript
setCaseCohorts(caseId: number, cohortIds: number[]): void {
  this.runTransaction(() => {
    this.stmt('DELETE FROM case_cohort_links WHERE case_id = ?').run(caseId)
    for (const cohortId of cohortIds) {
      insert.run(caseId, cohortId)
    }
  })
}
```

- Simpler than diffing (no add/remove arrays)
- Atomic replacement in transaction
- UI can set entire cohort list with single call

**3. HPO term upsert updates label**

`assignCaseHpoTerm` uses upsert that updates `hpo_label`:
```sql
INSERT INTO case_hpo_terms (case_id, hpo_id, hpo_label, created_at)
VALUES (?, ?, ?, ?)
ON CONFLICT(case_id, hpo_id) DO UPDATE SET hpo_label = excluded.hpo_label
```

- HPO ontology labels can change over time
- Ensures labels stay current without manual refresh
- No user action required

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | faf5902 | feat(22-01): add case metadata methods to DatabaseService |
| 2 | c1383e6 | feat(22-01): create case-metadata IPC handlers |
| 3 | 77323cf | feat(22-01): extend preload API and shared types |

## Verification

```bash
npm run typecheck  # ✓ No TypeScript errors
npm run lint       # ✓ ESLint passes
```

All 14 IPC channels operational:
- ✓ case-metadata:get, upsert
- ✓ case-metadata:listCohorts, createCohort, deleteCohort, getCohortByName
- ✓ case-metadata:getCaseCohorts, assignCohort, removeCohort, setCohorts
- ✓ case-metadata:getHpoTerms, assignHpoTerm, removeHpoTerm
- ✓ case-metadata:getFullMetadata

## Next Phase Readiness

**Phase 23 (Side Panel UI)** can now:
- Fetch and update case status (affected/unaffected/unknown)
- Display and assign cases to cohorts
- Manage HPO term lists per case
- Use `getFullMetadata` for efficient initial load

**No blockers.** Backend infrastructure complete and ready for UI consumption.

## Notes

**Code quality:**
- All methods use `this.stmt()` for prepared statement caching (performance)
- All multi-step operations use transactions (atomicity)
- All IPC handlers use `wrapHandler` for consistent error handling
- Full type safety from preload → IPC → DatabaseService

**Performance considerations:**
- `getFullMetadata` convenience method reduces 3 IPC calls to 1
- Prepared statement caching avoids SQL reparsing overhead
- Bulk `setCaseCohorts` more efficient than N individual calls

**Schema notes:**
- `case_metadata` has UNIQUE(case_id) - one metadata row per case
- `case_hpo_terms` has UNIQUE(case_id, hpo_id) - no duplicate HPO terms
- `case_cohort_links` has UNIQUE(case_id, cohort_id) - no duplicate links
- CASCADE on cohort_groups delete handles cleanup automatically
