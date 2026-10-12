-- Cohort summary and gene burden count carrier rows only (#555).
--
-- An SV/CNV/STR no-call row ("./.") is imported but carries nothing; every
-- summary contribution now leaves it out (carrierRowSql in
-- src/shared/sql/genotype-dosage.ts, mirrors SQLite v46). Counts written
-- before include it, and the incremental delete subtracts carrier rows only,
-- so such a row would never reach 0.
--
-- As 0027: a populated summary is flagged stale and rebuilt in the
-- background; a summary already waiting for a rebuild keeps its reason; an
-- empty summary has nothing to correct. Replaying this statement only flags
-- the summary again.
UPDATE "__schema__"."cohort_summary_state"
   SET is_stale = true,
       stale_reason = CASE WHEN is_stale THEN stale_reason
                           ELSE 'migration_0029_carrier_rows' END,
       stale_at = CASE WHEN is_stale THEN stale_at ELSE now() END,
       last_rebuilt_at = COALESCE(last_rebuilt_at, now())
 WHERE id = 1
   AND EXISTS (SELECT 1 FROM "__schema__"."cohort_variant_summary");
