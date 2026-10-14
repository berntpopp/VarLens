-- Minimal alleles for rows imported before #587 (mirrors SQLite v57,
-- allele-trim-migration.ts). The rows are trimmed and the global annotations
-- re-keyed and merged by this migration's afterApply step
-- (migrations/allele-trim-backfill.ts), with the import's own trim rule; here
-- only a populated summary is flagged stale, so the rebuild counts old and new
-- carriers on one key. A summary already waiting for a rebuild keeps its reason.
-- 0038 / 0039 are reserved for other sprint-3 lanes.
UPDATE "__schema__"."cohort_summary_state"
   SET is_stale = true,
       stale_reason = CASE WHEN is_stale THEN stale_reason
                           ELSE 'migration_0040_allele_trim' END,
       stale_at = CASE WHEN is_stale THEN stale_at ELSE now() END,
       last_rebuilt_at = COALESCE(last_rebuilt_at, now())
 WHERE id = 1
   AND EXISTS (SELECT 1 FROM "__schema__"."cohort_variant_summary");
