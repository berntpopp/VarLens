# Workstream: audit correctness batch (bfd3d80e review)

**Goal:** close the confirmed P1/P2 correctness, data-integrity and safety bugs from the
`bfd3d80e` dual review (Claude + Codex) in one batch branch, one preflight, one release.
On 2026-10-13 the cited code for #546 #549 #551 #552 #553 #558 #563 #564 #595 was spot-checked
on `origin/main` @ `281791f2` (v0.85.0) and is unchanged; all 19 issues are still open. The batch
branches from `281791f2`. Each lane re-verifies its own issues before fixing them.

**Scope (18 issues, 8 lanes; #558 ships via PR #591 elsewhere):** #546 #547 #548 #549 #550 #551 #552 #553 #554 #556 #559
#560 #561 #562 #563 #564 #579 #595.

**Why these together:** every issue has evidence with file:line, a proposed smallest fix and a
testable acceptance. None needs a product decision. They split cleanly by file ownership, so the
lanes run in parallel with no merge conflicts.

## Key simplification

**#595 removes #548.** `variant_frequency` has no readers since #555. Dropping the table and its
upkeep deletes every failure mode in #548 (delete-all drift, swallowed publish failure,
non-transactional recompute). Close #548 as "fixed by #595"; do not repair code that is being deleted.

## Lanes

Each lane gets its own worktree under `VarLens-wt/`, its own branch, and TDD against the issue's
acceptance text. Heavy commands go through `~/.cache/varlens-session/heavy.sh` (flock + systemd-run).

| Lane | Issues | Owns (only this lane edits) | Size |
|---|---|---|---|
| **L1 export** | #546 (#558 / PR #591 is owned by the `chore/deps-security-2026-10-13` session) | `ipc/handlers/panelIntervalHelper.ts`, its `clearPanelIntervalCache` callers | S |
| **L2 vcf-csq** | #547, #556 | `import/vcf/vcf-annotation-parser.ts` + tests; migration **SQLite v50 / PG 0033** (`%3D`/`%3B` backfill) | M |
| **L3 inheritance** | #553 (P1), #579, #554 | `variant-filter/inheritance-filters.ts`, `postgres-variant-clinical-filter-sql.ts`, `postgres-cohort-summary-query.ts`, filter composable / FilterDrawer, cohort query-param builder | M |
| **L4 import-integrity** (critical path, sequential) | #595 → #559 → #551 → #560, + #564 index part | `workers/import-worker.ts`, `worker-db.ts`, `delete-operations.ts`, `import-recovery.ts`, `ipc/handlers/import-logic*.ts`, `VariantFrequencyService.ts` (deleted), `import-index-sql.ts`, `fts-trigger-management.ts`, `cohort.ts` totals, `VariantRepository` extension metadata, PG frequency writers; migration **SQLite v51 / PG 0034** (drop `variant_frequency`, drop `idx_variants_coords`, recount `variant_count`) | L |
| **L5 lifecycle** | #552, #561, #562, #564 dead-code part | `src/main/index.ts` quit path, `services/DatabaseManager.ts`, `DatabasePicker.vue`, `import/TempDirectoryManager.ts`, `batch-import-logic.ts` cleanup export, `ipc/dbPoolManager.ts`, `useCohortData.fetchVariants` | M |
| **L6 statistics** | #549 (P1) | `statistics/logistic.ts`, `fisher.ts`, `cohort-logic.ts` OR serialisation, `ManhattanPlot.vue`, `VolcanoPlot.vue` | M |
| **L7 molstar** | #550 | `composables/useMolstarViewer.ts`, `StructureControls.vue` | S |
| **L8 auth** | #563 | `web/auth/PostgresWebAuthService.ts`, desktop `AuthService.ts`, `web/.../rate-limit.ts` | S |

### Ordering and cross-lane contracts

- L4 runs its four issues as stacked commits in the order shown: #595 first removes the frequency
  calls that #551 and #559 would otherwise move; #560's `SUM(variant_count)` needs #551's
  transactional count.
- L5 owns `before-quit`. #552's handler calls `closeDatabaseManager()` then the #562 ZIP cleanup,
  with a 5 s timeout. The `destroyDbPool()` call goes away (#564).
- Migration numbers are reserved above. No other lane adds a migration.
- #551: benchmark a ~300k-SV Sniffles append before removing the bulk-insert bracket (the issue
  requires it). If triggers are too slow, use the issue's fallback (session flag + watermark).
- L3: invoke the `varlens-cohort-parity` skill; every filter change ships case + cohort + both backends.

## Integration

1. Each lane: `make typecheck` + targeted vitest in its worktree, commit `Fixes #n` (or `Refs #n` if partial).
2. Merge lanes `--no-ff` into `fix/audit-correctness-batch` (L4 last).
3. One `make preflight-full` (lifecycle, workers and migrations are touched) and `make agent-check`.
4. One PR; close #548 with a pointer to #595.

## Not in this workstream

- **Need a decision or design first:** #567 (ACMG override reason; schema), #575 (reopen policy),
  #577 (build in annotation key; migration that splits rows), #580 (`hpo_match` storage shape).
  Good candidates for the *next* batch together with #574 export columns (depends on #567).
- **UX features:** #568 #569 #570 #572 #573 #576 #596, #578 (manual SR/GPU pass).
- **Shortlist epic:** #581–#584, #586, #587, #597, #600.
- **Auth/SSO epic:** #295, #315, #330. **Backlog:** #50 #93 #124 #125 #126 #149 #201 #538 #539.
- **Dependabot** #603–#605: rebase onto the batch head afterwards (their stale-base CI is not trusted).
