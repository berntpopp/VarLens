-- Natural chromosome order (1..22, X, Y, MT, then other contigs by name) for
-- the case and cohort views. Mirrors SQLite migration v33
-- (src/main/database/chr-rank-indexes.ts) with the same index names.
--
-- Each index is built on the shared chr-rank expression. The expression below
-- MUST stay byte-identical to chrRankSql('chr') in
-- src/shared/sql/chromosome-order.ts (locked by
-- tests/main/storage/postgres-chr-rank-migration.test.ts). The query sinks emit
-- it through that function, so ORDER BY matches these indexes.
--
-- idx_variants_case_chr_rank: case view default order. Built on variants_all
--   because "variants" is the import-visibility view since 0015; the planner
--   flattens the view, so queries against "variants" still use this index.
--   WHERE case_id = $1 ORDER BY rank, chr, pos, id (also usable for keyset paging)
-- idx_cvs_chr_rank: cohort view sorted by chromosome.
-- idx_cvs_carrier_chr_rank: cohort default carrier_count DESC NULLS LAST + genomic tiebreaker.
--
-- Plain CREATE INDEX: the migration runner wraps each migration in a
-- transaction, which rules out CONCURRENTLY (same as 0007/0009).
-- "__schema__" is the migration-runner template placeholder (see 0001_create_cases.sql).

CREATE INDEX IF NOT EXISTS idx_variants_case_chr_rank
  ON "__schema__"."variants_all" (
    case_id,
    (CASE upper(CASE WHEN lower(substr(chr, 1, 3)) = 'chr' THEN substr(chr, 4) ELSE chr END) WHEN '1' THEN 1 WHEN '2' THEN 2 WHEN '3' THEN 3 WHEN '4' THEN 4 WHEN '5' THEN 5 WHEN '6' THEN 6 WHEN '7' THEN 7 WHEN '8' THEN 8 WHEN '9' THEN 9 WHEN '10' THEN 10 WHEN '11' THEN 11 WHEN '12' THEN 12 WHEN '13' THEN 13 WHEN '14' THEN 14 WHEN '15' THEN 15 WHEN '16' THEN 16 WHEN '17' THEN 17 WHEN '18' THEN 18 WHEN '19' THEN 19 WHEN '20' THEN 20 WHEN '21' THEN 21 WHEN '22' THEN 22 WHEN 'X' THEN 23 WHEN 'Y' THEN 24 WHEN 'M' THEN 25 WHEN 'MT' THEN 25 ELSE 100 END),
    chr COLLATE "C",
    pos,
    id
  );

CREATE INDEX IF NOT EXISTS idx_cvs_chr_rank
  ON "__schema__"."cohort_variant_summary" (
    (CASE upper(CASE WHEN lower(substr(chr, 1, 3)) = 'chr' THEN substr(chr, 4) ELSE chr END) WHEN '1' THEN 1 WHEN '2' THEN 2 WHEN '3' THEN 3 WHEN '4' THEN 4 WHEN '5' THEN 5 WHEN '6' THEN 6 WHEN '7' THEN 7 WHEN '8' THEN 8 WHEN '9' THEN 9 WHEN '10' THEN 10 WHEN '11' THEN 11 WHEN '12' THEN 12 WHEN '13' THEN 13 WHEN '14' THEN 14 WHEN '15' THEN 15 WHEN '16' THEN 16 WHEN '17' THEN 17 WHEN '18' THEN 18 WHEN '19' THEN 19 WHEN '20' THEN 20 WHEN '21' THEN 21 WHEN '22' THEN 22 WHEN 'X' THEN 23 WHEN 'Y' THEN 24 WHEN 'M' THEN 25 WHEN 'MT' THEN 25 ELSE 100 END),
    chr COLLATE "C",
    pos,
    ref,
    alt
  );

CREATE INDEX IF NOT EXISTS idx_cvs_carrier_chr_rank
  ON "__schema__"."cohort_variant_summary" (
    carrier_count DESC NULLS LAST,
    (CASE upper(CASE WHEN lower(substr(chr, 1, 3)) = 'chr' THEN substr(chr, 4) ELSE chr END) WHEN '1' THEN 1 WHEN '2' THEN 2 WHEN '3' THEN 3 WHEN '4' THEN 4 WHEN '5' THEN 5 WHEN '6' THEN 6 WHEN '7' THEN 7 WHEN '8' THEN 8 WHEN '9' THEN 9 WHEN '10' THEN 10 WHEN '11' THEN 11 WHEN '12' THEN 12 WHEN '13' THEN 13 WHEN '14' THEN 14 WHEN '15' THEN 15 WHEN '16' THEN 16 WHEN '17' THEN 17 WHEN '18' THEN 18 WHEN '19' THEN 19 WHEN '20' THEN 20 WHEN '21' THEN 21 WHEN '22' THEN 22 WHEN 'X' THEN 23 WHEN 'Y' THEN 24 WHEN 'M' THEN 25 WHEN 'MT' THEN 25 ELSE 100 END),
    chr COLLATE "C",
    pos,
    ref,
    alt
  );
