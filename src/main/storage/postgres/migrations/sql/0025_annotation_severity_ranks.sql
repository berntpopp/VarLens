-- Severity ranks for the cohort representative annotation (#469).
--
-- A cohort summary row shows one annotation for all carriers of a variant.
-- It used to be the bytewise MAX() of every column on its own, which ranks
-- impact HIGH < LOW < MODERATE < MODIFIER, ranks ClinVar strings
-- alphabetically, and mixes columns of different carriers. The representative
-- is now the most severe carrier row, by two ranks stored on every variant:
--
--   impact_rank    from the IMPACT level in "consequence"
--   clinvar_rank   from the ClinVar significance string in "clinvar"
--
-- Both come from src/shared/config/severity.config.ts (0 = unknown / NULL).
-- The import pipeline writes them from now on; existing rows are backfilled
-- by this migration's afterApply step (migrations/severity-rank-backfill.ts),
-- because the ClinVar category of a multi-valued string cannot be derived in
-- plain SQL. Adding the columns here is a catalogue change; the backfill then
-- rewrites the table once.
-- "__schema__" is the migration-runner template placeholder.

ALTER TABLE "__schema__"."variants_all"
  ADD COLUMN IF NOT EXISTS impact_rank SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clinvar_rank SMALLINT NOT NULL DEFAULT 0;

-- The "variants" view (0015) is redefined by the afterApply step, after the
-- backfill: the backfill rewrites the table through the new columns, which is
-- only allowed while no view uses them.

-- The summary stores the ranks of its representative row, so an import can
-- compare a new carrier with the stored row without reading other carriers.
ALTER TABLE "__schema__"."cohort_variant_summary"
  ADD COLUMN IF NOT EXISTS impact_rank SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clinvar_rank SMALLINT NOT NULL DEFAULT 0;

-- Existing summary rows hold the old per-column maxima. They are valid apart
-- from the annotation columns, so the summary is flagged stale rather than
-- rebuilt here: readers keep being served while a background rebuild replaces
-- the rows (cohort-read-freshness.ts), exactly as 0024 did. An empty summary
-- has nothing to correct.
UPDATE "__schema__"."cohort_summary_state"
   SET is_stale = true,
       stale_reason = 'migration_0025_representative_severity',
       stale_at = now(),
       last_rebuilt_at = COALESCE(last_rebuilt_at, now())
 WHERE id = 1
   AND EXISTS (SELECT 1 FROM "__schema__"."cohort_variant_summary");
