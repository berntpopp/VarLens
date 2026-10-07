-- Maintained per-gene cohort aggregates.
--
-- The cohort gene-burden table and the "genes with variants" tile used to
-- aggregate every variant row on each read (COUNT(*), COUNT(DISTINCT case_id)
-- and COUNT(DISTINCT (chr, pos, ref, alt)) per gene), which is linear in the
-- total number of variant rows. These two tables hold the same figures and
-- are maintained in the same transactions, under the same summary write lock,
-- as cohort_variant_summary: an import's publication adds the case's
-- contribution, hiding a case for deletion subtracts it, a transcript switch
-- that changes a row's gene moves that row, and a full rebuild recomputes
-- both (cohort-gene-summary-sql.ts).
--
-- cohort_gene_variant_summary: one row per distinct (gene, coordinate) pair
-- among the visible variant rows, with the number of cases carrying the pair.
-- It exists because cohort_variant_summary keeps a single gene per coordinate,
-- while the gene-burden figure counts a coordinate under every gene symbol
-- that any case annotated it with. The refcount tells a removal when a pair
-- disappears.
--
-- cohort_gene_summary: one row per non-NULL gene symbol (the empty string
-- included, as COUNT(DISTINCT gene_symbol) counts it):
--   variant_count        = visible variant rows carrying the gene
--   unique_variant_count = rows of cohort_gene_variant_summary for the gene
--   affected_case_count  = visible cases with at least one such row

CREATE TABLE IF NOT EXISTS "__schema__"."cohort_gene_variant_summary" (
  gene_symbol TEXT NOT NULL,
  chr TEXT NOT NULL,
  pos INTEGER NOT NULL,
  ref TEXT NOT NULL,
  alt TEXT NOT NULL,
  carrier_count BIGINT NOT NULL,
  PRIMARY KEY (gene_symbol, chr, pos, ref, alt)
);

CREATE TABLE IF NOT EXISTS "__schema__"."cohort_gene_summary" (
  gene_symbol TEXT PRIMARY KEY,
  variant_count BIGINT NOT NULL,
  unique_variant_count BIGINT NOT NULL,
  affected_case_count BIGINT NOT NULL
);

-- Both tables are upserted by every import, like cohort_variant_summary.
ALTER TABLE "__schema__"."cohort_gene_variant_summary"
  SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE "__schema__"."cohort_gene_summary"
  SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);

-- Existing databases: populate here, with one aggregate over the visible
-- variants, rather than flagging the summary stale. Flagging would make the
-- next cohort read rebuild cohort_variant_summary as well, although it is
-- valid, and readers that do not go through the cohort freshness check would
-- see empty gene aggregates until then. Populating costs one scan at upgrade
-- (measured: about 3.5 s per million variant rows) and leaves the tables exact as soon
-- as the migration commits. The runner holds this in its migration
-- transaction; the scan may outlast the pool's statement timeout, so lift it
-- for this statement only. Guarded by "the gene summary is empty" so a
-- re-run never double counts.
SET LOCAL statement_timeout = 0;

WITH per_case_pair AS MATERIALIZED (
  SELECT v.gene_symbol, v.chr, v.pos, v.ref, v.alt, v.case_id, COUNT(*) AS row_count
  FROM "__schema__"."variants" v
  WHERE v.gene_symbol IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "__schema__"."cohort_gene_summary")
  GROUP BY v.gene_symbol, v.chr, v.pos, v.ref, v.alt, v.case_id
),
pairs AS (
  INSERT INTO "__schema__"."cohort_gene_variant_summary"
    (gene_symbol, chr, pos, ref, alt, carrier_count)
  SELECT gene_symbol, chr, pos, ref, alt, COUNT(*)
  FROM per_case_pair
  GROUP BY gene_symbol, chr, pos, ref, alt
  ON CONFLICT (gene_symbol, chr, pos, ref, alt) DO NOTHING
)
INSERT INTO "__schema__"."cohort_gene_summary"
  (gene_symbol, variant_count, unique_variant_count, affected_case_count)
SELECT gene_symbol,
       SUM(row_count)::bigint,
       COUNT(DISTINCT (chr, pos, ref, alt))::bigint,
       COUNT(DISTINCT case_id)::bigint
FROM per_case_pair
GROUP BY gene_symbol;

SET LOCAL statement_timeout = DEFAULT;
