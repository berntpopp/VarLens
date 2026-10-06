---
id: "DATA-03"
number: 3
title: "Multi-file import frequency decrement erases shared counts for pre-existing cases"
priority: "P1 - Critical"
tags: ["data-integrity", "frequencies", "import", "bug"]
affected_files:
  - "src/main/ipc/handlers/import-logic.ts"
  - "src/main/database/VariantFrequencyService.ts"
created: "2026-10-06"
reviewed_by: "Claude Code CLI (Claude Opus 5.5)"
---

# [DATA-03] Multi-file import frequency decrement erases shared counts for pre-existing cases

| Attribute | Value |
|---|---|
| **Priority** | **P1 - Critical** |
| **Tags** | `data-integrity` `frequencies` `import` `bug` |
| **Affected Files** | `src/main/ipc/handlers/import-logic.ts`, `src/main/database/VariantFrequencyService.ts` |
| **Audited Snippet** | `In multi-file import, decrementFrequencies was called on the merged case before re-incrementing. If ...` |

---

## Technical Context & Audited Impact
Cohort frequency calculations become inconsistent across imports.

---

## Claude Opus 5.5 Architectural Review & Issue Specification

I've checked the finding against the code. It's real, but the audit describes the mechanism a little wrong, so the spec below states it precisely.

---

## 1. Technical assessment: confirmed, with a correction

**What happens** (`src/main/ipc/handlers/import-logic.ts:412-433`):

1. File 1 is imported by the worker, and `SqliteImportExecutor.ts:198` calls `updateFrequencies(caseId)`. Every key from file 1 gets +1.
2. Files 2..N are appended into the same case. No frequency update runs.
3. At the end, `decrementFrequencies(caseId)` then `updateFrequencies(caseId)` run, and both work on **every key the case now has** (file 1 plus files 2..N), not just file 1's keys.

The code comment says it will "decrement the first file's contribution", but the decrement actually covers all of the case's current variants. That mismatch is the root cause.

**What it does to each kind of key:**

| Key category | Count before | After decrement | After update | Correct count | Result |
|---|---|---|---|---|---|
| In file 1 | k+1 | k | k+1 | k+1 | ✅ |
| Only in files 2..N, in no other case | none | none (no-op) | 1 | 1 | ✅ |
| Only in files 2..N, in **k ≥ 2** other cases | k | k−1 | k | **k+1** | ❌ off by 1 |
| Only in files 2..N, in **exactly 1** other case | 1 | 0 → **row deleted** | 1 | **2** | ❌ off by 1 |

**Correction to the audit:** counts are never driven to zero overall. Every variant that first appears in files 2..N and already exists in another case ends up **one too low**. The row is deleted and re-created only in the 1→0→1 case. File 1 keys are correct. The error also adds up: each later multi-file import with overlap pushes the same keys further down.

**Further problems:**
- **Not atomic.** The decrement and the update aren't in one transaction, and any error is downgraded to `mainLogger.warn`. If `updateFrequencies` throws after the decrement has run, file 1's keys silently lose this case's contribution.
- **Typical trigger.** Combining SNV, SV and STR VCFs from the same caller pipeline is the normal multi-file workflow. Files from the same caller across a cohort share many recurring calls (common SVs, STR loci), so the error isn't a rare edge case.
- **Self-healing only by chance.** `recomputeAllFrequencies()` runs only on bulk deletes (`cases-logic.ts:163/203/248`). Deleting a single case uses `decrementFrequencies` (`cases-logic.ts:141`), so it keeps the wrong counts.
- **Who sees it.** `VariantFilterBuilder.ts:124` left-joins `variant_frequency`, so the in-house "seen in N cases" filter and column are affected.
- **Postgres.** `PostgresVcfImportRepository.ts:279` notes that it doesn't update `variant_frequency` at all. That's a separate parity question to check, not this bug.

## 2. Severity: **P2 (High)**

This is silent, cumulative data corruption in a value clinicians filter on. Undercounting in-house frequency lets recurrent artifacts and common local polymorphisms pass "rare in cohort" filters, which inflates candidate lists. Raw variant data isn't lost, and a full recompute repairs it, which is why it's not P1. There's no warning to the user and no automatic repair.

## 3. Labels

`bug`, `data-integrity`, `import`, `cohort`, `sqlite`

## 4. Issue specification

**Title:** `fix(import): multi-file import undercounts variant_frequency for appended variants shared with other cases`

**Description and reproduction**

1. Create case A from `snv.vcf`, which contains variant X. `variant_frequency[X] = 1`.
2. Run a multi-file import for case B: file 1 = `snv_b.vcf` without X, file 2 = `sv_b.vcf` with X.
3. Expected `variant_frequency[X] = 2`. Actual: `1`. The row was deleted by `DELETE … WHERE case_count <= 0` and then re-inserted.
4. If X is in two prior cases, expected 3, actual 2.

The cause is `import-logic.ts:423-424`: `decrementFrequencies(caseId)` subtracts from every current key of the case, including keys that were never added for that case.

**Expected behavior**

After any import, `variant_frequency.case_count` for each key equals `COUNT(DISTINCT case_id)` over `variants` for that key. The frequency refresh is atomic: either all of it applies or none of it does.

**Proposed fix**

1. Add a `skipFrequencyUpdate` option to `importSingleFile`. Pass it when `files.length > 1`, so the worker doesn't count file 1.
2. After the append loop, call `updateFrequencies(caseId)` **once**, wrapped in `db.transaction(...)`. Its `SELECT DISTINCT … WHERE case_id = ?` already removes duplicates across files.
3. Delete the decrement/update pair and the misleading comment.

This keeps frequency updates incremental, with cost proportional to the case, and avoids a global recompute on every import.

**Tests** (in `tests/main/database/variant-frequency.test.ts` and a multi-file case in `tests/main/ipc/handlers/import.test.ts`):
- the 1→2 and k→k+1 scenarios above
- a key present in both file 1 and file 2 of the same case counts once
- an invariant check that every count equals `COUNT(DISTINCT case_id)` after a multi-file import

**Repairing existing databases:** add a one-off `recomputeAllFrequencies()` as a guarded migration or startup repair, because databases with multi-file imports already have wrong counts.

**Separately:** check whether the Postgres VCF path maintains `variant_frequency` at all, since `PostgresVcfImportRepository.ts:279` says it doesn't.

---

This was a read-only review: I didn't change any code or run any tests. Several MCP connectors (Gmail, Google Calendar, genereviews-link, gtex-link, phentrieve, sysndd) need to be authorized in your claude.ai connector settings, and a few local `-link` servers failed to connect. None of them were needed for this review.
