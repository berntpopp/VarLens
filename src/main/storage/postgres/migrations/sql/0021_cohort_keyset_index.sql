-- Keyset-able cohort default order (carrier_count DESC NULLS LAST + genomic
-- tiebreaker). Mirrors SQLite migration v37 (src/main/database/cohort-keyset-index.ts)
-- with the same index name.
--
-- The column list MUST stay byte-identical to cohortKeysetTerms('', 'postgres')
-- in src/shared/sql/cohort-keyset.ts (locked by tests/main/storage/
-- postgres-cohort-keyset.test.ts): the summary page query orders and seeks by
-- exactly these terms, all ascending, so a row-value predicate
-- (terms) > (cursor) resumes after the previous page through this index.
-- (-COALESCE(carrier_count, -1)) ASC sorts like carrier_count DESC NULLS LAST.
--
-- idx_cvs_carrier_chr_rank (0017) served the old mixed-direction order, which no
-- query emits any more; it is dropped to save summary write amplification.
-- "__schema__" is the migration-runner template placeholder.

CREATE INDEX IF NOT EXISTS idx_cvs_carrier_keyset
  ON "__schema__"."cohort_variant_summary" (
    (-COALESCE(carrier_count, -1)),
    (CASE upper(CASE WHEN lower(substr(chr, 1, 3)) = 'chr' THEN substr(chr, 4) ELSE chr END) WHEN '1' THEN 1 WHEN '2' THEN 2 WHEN '3' THEN 3 WHEN '4' THEN 4 WHEN '5' THEN 5 WHEN '6' THEN 6 WHEN '7' THEN 7 WHEN '8' THEN 8 WHEN '9' THEN 9 WHEN '10' THEN 10 WHEN '11' THEN 11 WHEN '12' THEN 12 WHEN '13' THEN 13 WHEN '14' THEN 14 WHEN '15' THEN 15 WHEN '16' THEN 16 WHEN '17' THEN 17 WHEN '18' THEN 18 WHEN '19' THEN 19 WHEN '20' THEN 20 WHEN '21' THEN 21 WHEN '22' THEN 22 WHEN 'X' THEN 23 WHEN 'Y' THEN 24 WHEN 'M' THEN 25 WHEN 'MT' THEN 25 ELSE 100 END),
    chr COLLATE "C",
    pos,
    ref,
    alt,
    variant_type,
    genome_build
  );

DROP INDEX IF EXISTS "__schema__".idx_cvs_carrier_chr_rank;
