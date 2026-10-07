-- Cohort frequency is derived at read time.
--
-- `cohort_variant_summary.cohort_frequency` used to be rewritten for every
-- summary row on every import and every case deletion (carrier_count divided
-- by the number of cases of the genome build), which made each import slower
-- than the one before and bloated the table with dead rows. Readers now
-- compute the same value from carrier_count and the visible cases of the
-- build (postgres-cohort-summary-query.ts), so nothing maintains the column.
--
-- The column itself stays, unused, so a rollback to older code keeps working:
-- that code rewrites it on its next import or deletion.

DROP INDEX IF EXISTS "__schema__".idx_cvs_cohort_freq;

-- Imports upsert carrier counts into this table continuously; vacuum and
-- re-analyse it well before the default 20% / 10% change thresholds.
ALTER TABLE "__schema__"."cohort_variant_summary"
  SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
