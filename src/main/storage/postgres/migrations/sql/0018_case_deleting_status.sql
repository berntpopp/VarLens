-- 0018_case_deleting_status.sql
--
-- Non-blocking case deletion (2026-10 blocking audit, W-1). A case delete
-- used to run in one request transaction that TRUNCATEd variant_frequency
-- (ACCESS EXCLUSIVE, blocking every variants:query) and cascade-deleted
-- millions of rows. Deletion is now a background job:
--
--   1. one short transaction applies the case-scoped summary/frequency
--      decrements and flips import_status to 'deleting' — the `cases` and
--      `variants` views (0015) hide the case from every reader at that
--      instant;
--   2. variants_all rows are purged in small batches, each its own
--      transaction (row locks only);
--   3. the cases_all row is removed last.
--
-- A 'deleting' row left behind by a crash is resumed from step 2 at the
-- next server start. Only the CHECK constraint changes here; the cases
-- table is small, so validating it is instant.

ALTER TABLE "__schema__"."cases_all"
  DROP CONSTRAINT IF EXISTS cases_import_status_check;

ALTER TABLE "__schema__"."cases_all"
  ADD CONSTRAINT cases_import_status_check
  CHECK (import_status IN ('ready', 'importing', 'deleting'));
