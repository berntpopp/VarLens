---
id: "UI-04"
number: 10
title: "Case comment cache invalidation missing when cases are deleted"
priority: "P3 - Medium"
tags: ["ui-ux", "cache", "renderer", "tech-debt"]
affected_files:
  - "src/renderer/src/composables/useCaseComments.ts"
  - "src/renderer/src/composables/useCaseMetadata.ts"
created: "2026-10-06"
reviewed_by: "Claude Code CLI (Claude Opus 5.5)"
---

# [UI-04] Case comment cache invalidation missing when cases are deleted

| Attribute | Value |
|---|---|
| **Priority** | **P3 - Medium** |
| **Tags** | `ui-ux` `cache` `renderer` `tech-debt` |
| **Affected Files** | `src/renderer/src/composables/useCaseComments.ts`, `src/renderer/src/composables/useCaseMetadata.ts` |
| **Audited Snippet** | `useCaseComments caches comments by caseId. Deleting a case does not invalidate the cache, so re-impo...` |

---

## Technical Context & Audited Impact
Erroneous clinical annotations attached to newly imported cases.

---

## Claude Opus 5.5 Architectural Review & Issue Specification

I'd downgrade this from a data-integrity bug to a P3 cleanup: the failure described in the audit can't happen. Part of the finding is right, though: caches for deleted cases are never cleared, and the helper meant to do that is never called.

## 1. Technical assessment

**Partly confirmed.** The audit's claim is that re-importing a case with the same ID brings back its old comments. I checked the code and that can't happen, for four separate reasons:

| Check | Evidence | Result |
|---|---|---|
| Can a case ID be reused? | SQLite `cases.id INTEGER PRIMARY KEY AUTOINCREMENT` (`src/main/database/schema.ts:15`). Nothing resets the ID counter (`sqlite_sequence`). Postgres uses `BIGSERIAL` (`0001_create_cases.sql:2`). | No. IDs only go up within one database, so a re-imported case always gets a new ID. |
| Are the database rows deleted? | `case_comments.case_id … ON DELETE CASCADE` on both backends, and every delete path turns foreign keys on (`delete-worker.ts:119`). | Yes, deleting a case deletes its comments. |
| Is the cache cleared when switching databases? | `useShellLifecycle.ts:49` calls `clearMetadataCache()`, which also calls `useCaseComments().clearCache()` and `useCaseMetrics().clearCache()` (`useCaseMetadata.ts:468-477`). | Yes. This is the only case where IDs could overlap (another database file), and it's covered. |
| Could a stale cache entry be shown? | `CaseCommentsTab.vue:173-179` reloads with `immediate: true` and overwrites the cached entry every time it opens. | Very little room. Only `CaseMetadataModal.vue:173` (`commentCount`) reads the cache without reloading. |

**What is actually wrong:**
- **No eviction on delete.** `CaseList.vue` `handleDelete` / `handleDeleteSelected` emit `case-deleted` but never evict anything. Entries for deleted cases stay in `commentsCache`, `loadingStates`, `useCaseMetrics.metricsCache` and `metadataCache` until the next database switch.
- **Unbounded caches.** `commentsCache` and `metricsCache` are plain reactive `Map`s with no size limit. `metadataCache` is limited to 200 entries.
- **Dead and incomplete helper.** `invalidateCase()` (`useCaseMetadata.ts:481`) has no callers. It also only evicts metadata, not comments or metrics.
- **Undefined post-delete behaviour.** If the delete fails and is rolled back, cached entries for the case are still there, so the UI state after a failed delete isn't well defined.

**Root cause:** each per-case cache handles clearing everything at once (on database switch) but has no way to drop a single case when it is deleted.

## 2. Severity and priority

**P3 (Medium), downgraded from the implied P1.** No clinical annotation can end up on the wrong case: IDs are never reused and the stale comment list is refetched whenever it is shown. What's left is a memory leak that grows with the number of deleted cases, an incorrect comment count in the modal if a deleted case is somehow still referenced, and a dead API that implies a guarantee nobody provides.

## 3. Labels

`bug`, `architecture`, `renderer`, `tech-debt`, `low-risk`. Not `data-integrity`.

## 4. Issue specification

**Title:** `fix(renderer): evict per-case caches (comments, metrics, metadata) on case deletion`

**Description**
Deleting a case removes its rows (`ON DELETE CASCADE`), but the renderer's per-case caches keep their entries until the next database switch. `useCaseMetadata.invalidateCase()` exists, but nothing calls it and it doesn't touch the comment or metrics caches. `commentsCache` and `metricsCache` have no size limit.

The audit's "resurrected comments" scenario is not reachable: AUTOINCREMENT and BIGSERIAL never reuse IDs, the caches are cleared on database switch, and `CaseCommentsTab` always refetches. This issue covers cache hygiene only.

**Reproduction**
1. Open case A's comments tab and add a comment.
2. Delete case A from the case list.
3. In DevTools, inspect `useCaseComments` → `commentsCache`: key `A` is still there. The same holds for `metricsCache` and `metadataCache`.

**Expected behaviour**
- Once a delete succeeds, no per-case renderer cache holds the deleted case's ID.
- If the delete fails and is rolled back, the case's caches are reloaded rather than trusted.
- A single function owns eviction for one case, so a future per-case cache can't be missed.

**Proposed fix**
1. Add `invalidateCase(caseId)` to `useCaseComments` and `useCaseMetrics`, deleting the key from both the data map and `loadingStates`.
2. Make `useCaseMetadata.invalidateCase()` the single entry point for the whole case, calling both. This mirrors how `clearCache()` already works.
3. In `CaseList.vue`, call it from `handleDelete` and `handleDeleteSelected` (once per ID) after the delete IPC succeeds, not optimistically. Calling it on rollback as well is harmless.
4. Optionally, replace the comment and metrics `Map`s with the existing `LruMap`, using the same 200-entry limit as metadata.
5. Tests in `tests/renderer/composables/`:
   - Deleting a case evicts all three caches.
   - The rollback path doesn't leave a stale entry.
   - A regression note that AUTOINCREMENT IDs are never reused, so a future change to `INTEGER PRIMARY KEY` without AUTOINCREMENT would turn this into a real data-integrity bug.
6. Verify with `make typecheck` and `make rebuild-node && make test`.

I didn't change any code or run any `make` targets; this is a review only. Separately, several MCP connectors failed to connect or need authorization (gnomad-link, hgnc-link, sysndd, others). None were needed here.
