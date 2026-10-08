-- Cohort summary het/hom counts resolve conflicting duplicate calls by dosage.
--
-- When one case has several rows for one variant with different genotypes,
-- the summary counted the textually greatest one (MAX(gt_num)): "./1" and
-- "0/." counted as no het, "1/." and "1/1" as het. Every writer now takes the
-- call with the highest dosage, as the association path does
-- (resolvedGtSql in src/shared/sql/genotype-dosage.ts, mirrors SQLite v43;
-- decision record: .planning/docs/SPLIT-GENOTYPE-ZYGOSITY.md).
--
-- As 0026: rows written before this migration are flagged stale and rebuilt
-- in the background; a summary already waiting for a rebuild keeps its
-- reason; an empty summary has nothing to correct. Replaying this statement
-- only flags the summary again.
UPDATE "__schema__"."cohort_summary_state"
   SET is_stale = true,
       stale_reason = CASE WHEN is_stale THEN stale_reason
                           ELSE 'migration_0027_conflicting_calls' END,
       stale_at = CASE WHEN is_stale THEN stale_at ELSE now() END,
       last_rebuilt_at = COALESCE(last_rebuilt_at, now())
 WHERE id = 1
   AND EXISTS (SELECT 1 FROM "__schema__"."cohort_variant_summary");
