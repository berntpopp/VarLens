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

-- Per-case filter metadata (cohort_column_meta) now carries min/max for
-- end_pos and the unsigned sv_length, numeric like SQLite (refreshColumnMetas,
-- META_NUMERIC_COLUMNS). Rows written before hold no bounds: fill them from
-- each case's variants with the same aggregates.
UPDATE "__schema__"."cohort_column_meta" m
   SET min_value = to_jsonb(b.min_value),
       max_value = to_jsonb(b.max_value)
  FROM (
    SELECT v.case_id, 'end_pos' AS column_name,
           MIN(v.end_pos) AS min_value, MAX(v.end_pos) AS max_value
      FROM "__schema__"."variants_all" v GROUP BY v.case_id
    UNION ALL
    SELECT v.case_id, 'sv_length',
           MIN(ABS(v.sv_length)), MAX(ABS(v.sv_length))
      FROM "__schema__"."variants_all" v GROUP BY v.case_id
  ) b
 WHERE m.case_id = b.case_id AND m.column_name = b.column_name;
