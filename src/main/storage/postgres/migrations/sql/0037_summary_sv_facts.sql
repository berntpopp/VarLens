-- SV type and unsigned length as cohort summary facts next to end_pos (#573,
-- mirrors SQLite v54), so the cohort view sorts and filters them. The rule is
-- in src/shared/sql/cohort-representative.ts.
--
-- As 0029: a populated summary is flagged stale and rebuilt in the background
-- to fill the new columns; a summary already waiting for a rebuild keeps its
-- reason. Replaying this file only flags the summary again.
ALTER TABLE "__schema__"."cohort_variant_summary"
  ADD COLUMN IF NOT EXISTS sv_type TEXT,
  ADD COLUMN IF NOT EXISTS sv_length BIGINT;

UPDATE "__schema__"."cohort_summary_state"
   SET is_stale = true,
       stale_reason = CASE WHEN is_stale THEN stale_reason
                           ELSE 'migration_0037_summary_sv_facts' END,
       stale_at = CASE WHEN is_stale THEN stale_at ELSE now() END,
       last_rebuilt_at = COALESCE(last_rebuilt_at, now())
 WHERE id = 1
   AND EXISTS (SELECT 1 FROM "__schema__"."cohort_variant_summary");
