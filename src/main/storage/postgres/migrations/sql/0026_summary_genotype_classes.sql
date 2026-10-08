-- Cohort summary het/hom counts follow the shared genotype classes.
--
-- A multi-allelic record is split on import, and a sample carrying another
-- ALT allele on its second chromosome ("1/2") is stored per allele as "1/."
-- and "./1". Such a carrier was counted in carrier_count but in neither
-- het_count nor hom_count. It is heterozygous for the allele of its row, and
-- every writer now counts it so (src/shared/utils/genotype.ts, mirrors SQLite
-- v42; decision record: .planning/docs/SPLIT-GENOTYPE-ZYGOSITY.md).
--
-- Rows written before this migration hold the old counts. They are valid
-- apart from het_count, so the summary is flagged stale rather than rebuilt
-- here: readers keep being served while a background rebuild replaces the
-- rows (cohort-read-freshness.ts), as 0024 and 0025 did. A summary that is
-- already waiting for a rebuild keeps its reason. An empty summary has
-- nothing to correct. Replaying this statement only flags the summary again.
UPDATE "__schema__"."cohort_summary_state"
   SET is_stale = true,
       stale_reason = CASE WHEN is_stale THEN stale_reason
                           ELSE 'migration_0026_genotype_classes' END,
       stale_at = CASE WHEN is_stale THEN stale_at ELSE now() END,
       last_rebuilt_at = COALESCE(last_rebuilt_at, now())
 WHERE id = 1
   AND EXISTS (SELECT 1 FROM "__schema__"."cohort_variant_summary");
