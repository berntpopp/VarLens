-- Import integrity (mirrors SQLite v51).
--
-- variant_frequency has had no reader since the carrier frequency moved to
-- cohort_variant_summary.carrier_count (#555); its upkeep on every publish and
-- delete is dropped with it (#595).
DROP TABLE IF EXISTS "__schema__"."variant_frequency";
