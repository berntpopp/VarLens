---
id: "DATA-02"
number: 2
title: "Destructive case deletion before validating replacement file existence and format"
priority: "P1 - Critical"
tags: ["data-integrity", "import", "safety", "bug"]
affected_files:
  - "src/main/workers/import-worker.ts"
created: "2026-10-06"
reviewed_by: "Claude Code CLI (Claude Opus 5.5)"
---

# [DATA-02] Destructive case deletion before validating replacement file existence and format

| Attribute | Value |
|---|---|
| **Priority** | **P1 - Critical** |
| **Tags** | `data-integrity` `import` `safety` `bug` |
| **Affected Files** | `src/main/workers/import-worker.ts` |
| **Audited Snippet** | `In import-worker.ts:119, stmts.deleteCase.run(existing.id) deletes the existing case before statSync...` |

---

## Technical Context & Audited Impact
User faces unrecoverable data loss if replacing a case with a misspelled or moved file.

---

## Claude Opus 5.5 Architectural Review & Issue Specification

# DATA-02: replacing a case deletes the old one before the new file is known to import

## 1. Technical assessment

**The finding is valid, and the real problem is larger than reported.** The missing-file case is one symptom. The root cause is that "overwrite" is done as *delete the old case, then try the import*, with no transaction around the two steps and nothing to put the old case back if the import fails.

What the code does (`src/main/workers/import-worker.ts`):
- Line 119: `stmts.deleteCase.run(existing.id)` runs straight away, outside any transaction.
- Line 124: `statSync(file.filePath)` runs afterwards. If the file is missing (`ENOENT`), the outer `catch` at line 244 records the file as `failed`, but the old case is already gone.
- Lines 152–202: `detectFormat` and the streaming insert can also throw, for example on a bad header, a corrupt gzip, a malformed JSON or VCF line, or a disk-full or I/O error. The inner `catch` at line 241 deletes the *new* partial case. The old case stays deleted, so the user ends up with no case at all.
- The only transaction is per batch (`import-pipeline.ts:122`, `db.transaction` around `insertBatch`). Nothing makes "delete old + insert new" a single unit.
- I found no check in the main process that the file exists before the worker runs. `batch-import-logic.ts`, `batch-import.ts` and `SqliteImportExecutor.ts` contain no `existsSync`, `statSync` or `access` calls. Files are often picked in an earlier dialog step, so there is time for them to be moved or for a network share to drop.

**Cancelling mid-file is worse than the reported case.** In `streamInsertJson` and `streamInsertVcf`, `isCancelled()` makes the loop `break` and return `totalInserted` *normally* (`import-pipeline.ts:295–318`). Nothing is thrown, so the worker:
- records the file as `status: 'success'`,
- writes a variant count that reflects only part of the file,
- and has already deleted the original case.

The user ends up with a truncated case reported as a successful import. That is silent data corruption, not a visible failure.

**What gets lost is more than variants.** `ON DELETE CASCADE` from `cases` also removes:
- `case_variant_annotations`, `variant_tags`, `case_comments`
- `case_hpo_terms`, `case_metadata`, `case_metrics`, `case_external_ids`
- `case_active_panels`, `case_cohort_links`, `analysis_group_members`
- `case_data_info`, `case_import_files`

Variants can be re-imported from the source file, but this curation (ACMG annotations, phenotypes, comments, cohort membership) cannot. It is permanently gone. Note that a *successful* overwrite deletes it too, which the current UI may not make clear.

**The same pattern exists elsewhere.** `src/main/import/BatchImportService.ts:159` deletes before calling `importVariants`. The Postgres write path (`PostgresCaseLifecycleRepository.deleteCase`) needs the same check.

## 2. Severity and priority

**P1 (Critical).**
- It causes permanent loss of clinical curation that can't be reproduced, in an offline app with no server-side backup.
- It happens on ordinary user actions: a moved or renamed file, a malformed file, a disk error, or pressing Cancel.
- The cancel path reports success while storing a truncated case, so the user may never notice.

It is not P0 because it only affects the explicit overwrite strategy, and users can still recover from their own database backups.

## 3. Labels

`data-integrity`, `bug`, `import`, `sqlite`, `postgres` (parity), `p1`

## 4. Issue

### Title
`fix(import): overwrite deletes the existing case before the replacement import succeeds (data loss on missing/invalid file or cancel)`

### Description and reproduction
When a duplicate case name is imported with the `overwrite` strategy, `import-worker.ts:119` deletes the existing case, and everything cascaded from it, before the replacement file has been checked or parsed. Any failure after that point leaves no case at all. Cancelling leaves a partial case marked as successful.

**Repro A (missing file):**
1. Import `caseA.vcf` as case `P001`, then add HPO terms and a comment.
2. Start a batch import that includes `P001` with overwrite.
3. Rename or delete the file before confirming.
4. Result: the import reports `failed: ENOENT`, `P001` and all its annotations are gone.

**Repro B (bad file):** Overwrite `P001` with a truncated `.vcf.gz` or a malformed JSON file. Result: the import fails and `P001` is gone.

**Repro C (cancel):** Overwrite `P001` with a large VCF and cancel halfway. Result: `P001` exists with N of M variants and status `success`, and the original curation is gone.

### Expected behaviour
- If a replacement import fails or is cancelled, the existing case is left exactly as it was (all-or-nothing).
- The file's existence and readability are checked, and its format detected, before anything is changed.
- A cancelled file is reported as `skipped` or `cancelled`, never `success`, and leaves no partial rows behind.
- The UI warns before overwrite that case-level curation (HPO, comments, ACMG, tags, cohort links) will be replaced.

### Proposed fix
1. **Check first, with no side effects.** Before any change to the database, run `fs.accessSync(path, R_OK)` and `statSync`, confirm it is a regular file and non-empty, and call `detectFormat(file.filePath)`. Do this once at the top of the loop iteration, and also in `batch-import-logic` before the worker is dispatched so errors are caught early.
2. **Stage the new case, then swap.** Never delete before import:
   - Insert the new case under a temporary unique name (for example `__import_staging__<uuid>`, or an `import_state='staging'` column).
   - Stream the variants into it.
   - On success, run one `db.transaction` that deletes the old case (cascade), renames the staged case to the real name, and updates `variant_count` and `case_data_info`.
   - On failure or cancel, delete only the staged case.

   This keeps the per-batch transactions, so memory stays bounded, unlike wrapping the whole stream in one transaction. It also means the old case remains visible to readers until the swap commits.
3. **Make cancellation explicit.** The stream functions should return `{ count, cancelled }` or throw a typed `ImportCancelledError`. The worker treats that as rollback and reports the file as `skipped`.
4. **Decide whether curation is carried over (needs a product decision).** Either keep the current behaviour and say clearly in the confirm dialog that curation is replaced, or add an overwrite mode that re-attaches case-scoped metadata (`case_hpo_terms`, `case_comments`, `case_metadata`, `case_external_ids`, cohort/group links) to the new case ID during the swap. Variant-keyed annotations would only be re-linked where the variant key matches.
5. **Fix both backends together.** Apply the same staging pattern to `BatchImportService.ts:159` and the Postgres import/lifecycle path.
6. **Tests** (in `tests/main/workers/`, at the behaviour boundary):
   - Overwrite with a missing path: the original case and a child row (for example an HPO term) survive.
   - Overwrite with a malformed file: the original survives and no staging rows are left.
   - Overwrite then cancel: the original survives, the result is not `success`, and no partial case exists.
   - A successful overwrite swaps the case atomically: exactly one case with that name and the correct variant count.

I checked this against the code by reading it, not by running anything, so the repros above have not been run. No files were changed.
