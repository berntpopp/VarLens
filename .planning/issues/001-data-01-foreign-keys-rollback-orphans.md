---
id: "DATA-01"
number: 1
title: "Orphaned variants and transcripts on failed import rollback due to foreign_keys=OFF"
priority: "P1 - Critical"
tags: ["data-integrity", "database", "sqlite", "bug"]
affected_files:
  - "src/main/workers/worker-db.ts"
  - "src/main/workers/import-pipeline.ts"
  - "src/main/workers/import-worker.ts"
created: "2026-10-06"
reviewed_by: "Claude Code CLI (Claude Opus 5.5)"
---

# [DATA-01] Orphaned variants and transcripts on failed import rollback due to foreign_keys=OFF

| Attribute | Value |
|---|---|
| **Priority** | **P1 - Critical** |
| **Tags** | `data-integrity` `database` `sqlite` `bug` |
| **Affected Files** | `src/main/workers/worker-db.ts`, `src/main/workers/import-pipeline.ts`, `src/main/workers/import-worker.ts` |
| **Audited Snippet** | `In worker-db.ts:47, openWorkerDatabase sets db.pragma('foreign_keys = OFF'). When import fails, impo...` |

---

## Technical Context & Audited Impact
Orphaned rows silently corrupt subsequent frequency calculations and waste storage.

---

## Claude Opus 5.5 Architectural Review & Issue Specification

# DATA-01 review: orphaned rows when an import is rolled back or a case is replaced

I checked this against the code and **the finding is valid**. It is also wider than reported, and one claim about its impact is overstated. Nothing was changed and no tests were run; this is a review only.

## 1. Technical assessment

**Confirmed root cause**
- `src/main/workers/worker-db.ts:47` turns off foreign-key checks for the import connection (`foreign_keys = OFF`). They are only turned back on during cleanup (`import-worker.ts:314`), after every file has been processed.
- Rows are written in per-batch transactions (`import-pipeline.ts:122`), so when a file fails partway through, the earlier batches are already saved. The code then tries to undo the import by deleting the case (`import-worker.ts:241`, using `DELETE FROM cases WHERE id = ?` at `import-pipeline.ts:104`). With foreign keys off, none of the `ON DELETE CASCADE` rules run.
- **What gets orphaned:** `variants`, then everything that points at variants (`variant_transcripts`, `variant_sv`, `variant_cnv`, `variant_str`), plus `case_data_info` and the other tables that point at cases.

**A wider trigger the audit missed**
- `import-worker.ts:119`: when the user chooses to overwrite a duplicate, the existing case is removed with the same `deleteCase` statement. **Every overwrite import leaves the old case's whole variant set orphaned**, not just failed ones. This is a normal user workflow and it fails silently every time, so it matters more than the failure path.

**Edge cases checked**
- **Case ids are not reused.** `cases.id` is `AUTOINCREMENT` (`schema.ts:15`), so orphaned rows can't be picked up by a new case.
- **Cohort frequency is not affected — the audit overstates this.** `REBUILD_VARIANT_SUMMARY_SQL` joins `variants` to `cases` with an inner join, so orphaned rows are left out of `carrier_count` and `cohort_frequency`.
- **What is actually affected:**
  - `getCohortSummary()` counts `FROM variants` without that join (`cohort.ts:329`), so the "total variants" figure is inflated.
  - The FTS search index is rebuilt over every variant row, orphans included.
  - Storage and WAL size grow with no bound.
  - Any later query that reads `variants` without joining `cases` will silently include the orphans.
- **The delete is slow during import.** Import drops the `variants` indexes (`import-pipeline.ts:38-42`), so any delete by `case_id` at that point scans the whole table.

## 2. Severity: **P2 (High)**

- **Why not P3:** the overwrite path is deterministic and part of normal use. The damage is silent and permanent, and existing databases are already affected.
- **Why not P1:** the main clinical number, cohort carrier frequency, is protected by the inner join. Raise it to P1 if a query is found that reads `variants` per variant without joining `cases`.

## 3. Labels

`bug`, `data-integrity`, `database`, `import`, `sqlite`

## 4. Issue specification

**Title:** `fix(import): case deletion in import worker bypasses ON DELETE CASCADE (foreign_keys=OFF), orphaning variants on failure and on duplicate overwrite`

**Description and reproduction**
1. Import case `A` from a valid VCF.
2. Import the same file again with the duplicate strategy set to "overwrite".
3. `SELECT COUNT(*) FROM variants WHERE case_id NOT IN (SELECT id FROM cases)` returns a non-zero count, and `PRAGMA foreign_key_check` reports violations.
4. A second route: import a VCF that is truncated or malformed after more than one batch. The rows from the batches already committed stay behind after the rollback at `import-worker.ts:241`.

**Expected behavior**
- Deleting a case from inside the import worker removes all of its dependent rows, on both the failure path and the overwrite path.
- `PRAGMA foreign_key_check` is empty after any import, whether it succeeds or fails.

**Proposed fix**
1. **Add one helper for this, e.g. `deleteCaseCascading(db, caseId)`, in `worker-db.ts`, and route both `deleteCase` call sites through it.**
   - It turns `foreign_keys` on, runs the delete inside its own transaction, then turns `foreign_keys` back off.
   - This is safe: the pragma can't be changed inside a transaction, and the per-batch transactions have already committed by the time the delete runs.
   - Leave foreign keys off for bulk inserts so import speed doesn't change.
   - Using the schema's cascade rules is better than hand-written per-table `DELETE`s, which would drift from the roughly 15 child tables over time.
2. **Make the delete fast.** On the failure path, run `RECREATE_INDEXES` before the cascading delete, or at minimum create the `case_id` index. Otherwise the cascade scans all of `variants`.
3. **Clean up existing databases.** Add a migration or startup sweep that deletes orphaned rows from `variants` and the other tables that point at `cases`, then rebuilds FTS and the cohort summary.
4. **Tests** in `tests/main/workers/`:
   - Failure after more than one batch.
   - Overwrite of a duplicate case.
   - For both, assert that `PRAGMA foreign_key_check` returns `[]` and that no rows remain for the old case id in `variants`, `variant_transcripts` or `case_data_info`.
5. **Optional extra protection:** join `variants` to `cases` in `getCohortSummary` so the reported totals are correct even if orphans exist.
