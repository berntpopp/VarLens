-- Severity ranks for the cohort summary (#469).
--
-- A cohort summary row shows one annotation for all carriers of a variant.
-- It used to be the bytewise MAX() of every column on its own, which ranks
-- impact HIGH < LOW < MODERATE < MODIFIER, ranks ClinVar strings
-- alphabetically, and mixes columns of different carriers. The summary is now
-- built by two ranks stored on every variant:
--
--   impact_rank    from the IMPACT level in "consequence"
--   clinvar_rank   from the ClinVar significance string in "clinvar"
--
-- Both come from src/shared/config/severity.config.ts (0 = unknown).
--
-- Nothing here rewrites or scans-and-updates "variants_all": at thousands of
-- exomes that table has hundreds of millions of rows.
--
--   * The columns are added NULLable without a default: a catalogue change.
--     NULL means "not backfilled yet". The import pipeline writes both ranks
--     for every new row.
--   * Until a row is backfilled, every reader computes its rank on the fly:
--     impact from a CASE generated from the configuration, ClinVar from the
--     lookup table "clinvar_severity" (cohort-summary-representative-sql.ts,
--     carrierRanks). Results are correct from the first read.
--   * "clinvar_severity" maps each distinct stored ClinVar string to its rank.
--     A multi-valued string cannot be categorised in SQL, so the afterApply
--     step (migrations/severity-rank-backfill.ts) reads the distinct strings
--     once and ranks them with the configuration's normaliser.
--   * Existing rows are then backfilled in the background in id-range batches,
--     each its own transaction, resumable from "severity_rank_backfill"
--     (severity-rank-backfill-job.ts).
--
-- "__schema__" is the migration-runner template placeholder.

ALTER TABLE "__schema__"."variants_all"
  ADD COLUMN IF NOT EXISTS impact_rank SMALLINT,
  ADD COLUMN IF NOT EXISTS clinvar_rank SMALLINT;

-- The "variants" view (0015) was created as SELECT v.*, which is expanded
-- when the view is defined: it has to be redefined to expose new columns.
-- They come last, so CREATE OR REPLACE is allowed and no dependent breaks.
CREATE OR REPLACE VIEW "__schema__"."variants" AS
  SELECT v.* FROM "__schema__"."variants_all" v
  WHERE EXISTS (
    SELECT 1 FROM "__schema__"."cases_all" c
    WHERE c.id = v.case_id AND c.import_status = 'ready'
  );

CREATE TABLE IF NOT EXISTS "__schema__"."clinvar_severity" (
  raw TEXT PRIMARY KEY,
  rank SMALLINT NOT NULL
);

-- Progress of the background backfill: ids up to next_id are done. max_id is
-- the highest id that existed when the columns were added; later rows are
-- written with their ranks. MAX(id) is one probe of the primary key.
CREATE TABLE IF NOT EXISTS "__schema__"."severity_rank_backfill" (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  next_id BIGINT NOT NULL DEFAULT 0,
  max_id BIGINT NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO "__schema__"."severity_rank_backfill" (id, next_id, max_id, completed_at)
SELECT 1, 0, COALESCE(m.max_id, 0), CASE WHEN m.max_id IS NULL THEN now() END
  FROM (SELECT MAX(id) AS max_id FROM "__schema__"."variants_all") m
ON CONFLICT (id) DO NOTHING;

-- The summary stores the rank of its transcript row and of its ClinVar value,
-- so an import can compare a new carrier with the stored row without reading
-- other carriers. The summary is small next to the variants and its ranks
-- are always written, so these are NOT NULL (still a catalogue change).
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
