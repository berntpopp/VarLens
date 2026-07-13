# PR310 WGS-Safe Import Hardening Plan

**Goal:** Preserve bounded WGS imports and file-atomic visibility while closing parser amplification and multi-file cancellation gaps.

**Architecture:** Use bounded streaming/scanning at parser boundaries, hidden PostgreSQL base tables with per-batch production commits and a ready-only visibility boundary, and a dedicated SQLite append connection with operation-scoped cancellation.

### Task 1: Parser and diagnostic budgets

- [x] Add red tests for unbounded JSON keys, high-sample selected-column parsing, annotation/allele amplification, structural expansion, valid high-ratio VCFs, and bounded BED errors.
- [x] Implement bounded JSON key/token/depth accounting.
- [x] Resolve the selected VCF sample once and avoid cohort-width row allocation.
- [x] Add high-sample-safe header scanning and a bounded all-samples compatibility path.
- [x] Group annotations once, map selected alleles, and enforce aggregate work/output budgets.
- [x] Run the focused parser/import tests and type checking.
- [x] Checkpoint as `474e1fde`.

### Task 2: PostgreSQL WGS-safe provisional imports

- [x] Change tests to require commit boundaries between staging batches and no production case on late failure.
- [x] Add durable provisional case status, watermark, and ready-only case/variant views.
- [x] COPY each bounded batch directly to production base tables inside its own transaction.
- [x] Add a schema-scoped advisory lock before recovery and hold it for the full import.
- [x] Delete current-file rows in bounded watermark-scoped chunks after failure/cancellation.
- [x] Recover interrupted provisional cases before starting a new locked import.
- [x] Flip visibility only in the final consistent bookkeeping transaction.
- [x] Preserve final synchronous bookkeeping and cohort-summary behavior.
- [x] Run the full PostgreSQL worker/repository/integration test cluster.

### Task 3: SQLite transaction isolation and cancellation

- [x] Add a regression test proving the main connection is outside the append transaction and cancellation rolls back inserted batches.
- [x] Move appended-file writes to a dedicated encrypted worker-style SQLite connection.
- [x] Add abort checks around row parsing, batch flush, and commit.
- [x] Keep multi-file cancellation reachable across nested first-file and append phases.
- [x] Run all SQLite executor, handler, database, and append tests.

### Task 4: Verification and checkpoint

- [x] Run focused import, worker, executor, database, and handler tests.
- [x] Run `make ci` and every `make ci-full` component because workers and IPC lifecycle changed.
- [x] Run `make agent-check`, formatting, and `git diff --check`.
- [ ] Commit the storage/cancellation redesign on the PR310 branch.
