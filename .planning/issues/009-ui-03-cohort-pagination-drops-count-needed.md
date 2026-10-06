---
id: "UI-03"
number: 9
title: "Cohort pagination drops _count_needed flag causing redundant full-table COUNT(*) queries"
priority: "P2 - High"
tags: ["performance", "ui-ux", "cohort", "renderer", "bug"]
affected_files:
  - "src/renderer/src/composables/useCohortData.ts"
  - "src/renderer/src/components/CohortTable.vue"
created: "2026-10-06"
reviewed_by: "Claude Code CLI (Claude Opus 5.5)"
---

# [UI-03] Cohort pagination drops _count_needed flag causing redundant full-table COUNT(*) queries

| Attribute | Value |
|---|---|
| **Priority** | **P2 - High** |
| **Tags** | `performance` `ui-ux` `cohort` `renderer` `bug` |
| **Affected Files** | `src/renderer/src/composables/useCohortData.ts`, `src/renderer/src/components/CohortTable.vue` |
| **Audited Snippet** | `CohortTable passes _count_needed: false for page 2+, but buildIpcParams in useCohortData.ts does not...` |

---

## Technical Context & Audited Impact
Significant UI lag and CPU waste when paging through large cohorts.

---

## Claude Opus 5.5 Architectural Review & Issue Specification

I checked the code, and the finding holds on `main`. One detail in the audit is wrong, though. Your working tree on `feat/variant-simulator` already has an uncommitted 3-line fix and a unit test for it. I didn't run any tests for this review.

## 1. Technical assessment

**The bug is real. The audit's root-cause wording is slightly off.**

- `CohortTable.vue:366` sets `_count_needed: skipCount !== true`. `useOffsetPagination` sets `skipCount = true` in two cases: on page/sort changes when it already has the total cached (`useOffsetPagination.ts:200`), and for every prefetch (`:109`).
- On `main`, `buildIpcParams` (`useCohortData.ts:273–345`) builds the outgoing request from a list of named fields, and `_count_needed` isn't one of them. So the flag is **always** dropped. The audit says it's dropped "unless cachedCount is present", but there's no such condition. It never gets through.
- The backend counts whenever the flag is missing (`params._count_needed !== false`): `cohort.ts:213` runs `SELECT COUNT(*) FROM cohort_variant_summary <where>`, and `PostgresCohortRepository.ts:310/355` does the same. The request schema (`ipc-schemas.ts:187`) already accepts the flag, so the only problem is in the renderer.
- **Effect:** after the first page, every page turn runs a filtered `COUNT(*)` that isn't needed. Each next-page prefetch runs one too, so it's about two per page turn. The total shown is still correct, because `commitTotal(..., skipCount=true)` throws away the returned number. That's why nobody noticed.
- **Edge cases:**
  - The older `loadVariants` path (`useCohortData.ts:418–421`) sets `_count_needed = false` *after* calling `buildIpcParams`, so it was never affected. That's why only `CohortTable` hit this.
  - When filters change, the total is invalidated, so the count still runs as it should.
  - On SQLite the queries run one at a time, so a slow `COUNT(*)` also holds up the actual page query and other requests behind it.

## 2. Severity: P2 (High)

- **Why not P1:** no wrong data, no crash, and the total shown stays correct.
- **Why P2:** on large cohorts (WGS-scale `cohort_variant_summary`), a filtered `COUNT(*)` is usually the most expensive query in the request. Paging gets slower in proportion to cohort size, and the count-skipping optimisation the code was designed around has no effect.

## 3. Labels

`bug`, `performance`, `ui-ux`, `parity` (`loadVariants` and `CohortTable` handle the flag differently), `test-coverage`

## 4. Issue specification

**Title:** `fix(renderer): forward _count_needed through useCohortData.buildIpcParams so cohort paging skips COUNT(*)`

**Description and reproduction**
`buildIpcParams` only copies the fields it lists by name, and `_count_needed` isn't one of them. `CohortTable` sends `_count_needed: false` for page turns and prefetches once it has the total cached, but the flag is lost before the request goes out. The repository then runs a full filtered `COUNT(*)` every time.

1. Open the cohort view with a large database (for example the WGS fixture).
2. Go to page 2, then page 3.
3. Log the SQL in `cohort.ts` (or watch `pg_stat_statements` on Postgres). You'll see a `SELECT COUNT(*) FROM cohort_variant_summary …` for each page and each prefetch.

**Expected behaviour**
- `COUNT(*)` runs only on the first load, after a filter, genome build or variant type change, or after an explicit invalidation.
- Page and sort changes and prefetches don't run it, on both SQLite and Postgres.

**Proposed fix**
1. Forward the flag in `buildIpcParams`:
   ```ts
   if (params._count_needed !== undefined) ipcParams._count_needed = params._count_needed
   ```
   This is what's already uncommitted in your working tree.
2. **Test at the boundary.** The pending unit test only checks `buildIpcParams` on its own. Add a `CohortTable`/`useOffsetPagination` test that pages forward and asserts `api.cohort.getVariants` gets `_count_needed: false` on page 2+ and on prefetch, and `true` (or nothing) after a filter change.
3. **Prevent this class of bug.** Type the return value of `buildIpcParams` as the shared `CohortQueryParams` IPC type instead of `Record<string, unknown>`, or add a test that every key in `ipc-schemas.ts`'s cohort schema reaches the request. That way the next new param can't be dropped silently.
4. **Branch hygiene.** The fix is sitting on `feat/variant-simulator`, which has nothing to do with it. Move it to its own `fix/` branch and PR, and run `make rebuild-node && make test` before merging.
