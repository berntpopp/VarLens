-- Cheaper maintenance of the derived cohort tables.
--
-- Every import publication bumps a counter on most rows of variant_frequency
-- and of the gene aggregates. None of those counters is indexed, so the
-- update can be heap-only (HOT: no index entry is written) when the new row
-- version fits on the same page. With the default fillfactor of 100 pages are
-- full and most updates had to move to another page and re-insert every index
-- entry (measured at 100 exomes: 38% heap-only for variant_frequency, twice
-- the WAL records). Leaving free space per page keeps them heap-only.
--
-- cohort_gene_summary gets more room than the others: nearly all of its rows
-- (one per gene) are updated by every publication, and the table had grown to
-- 59 MB for 41,288 rows.
--
-- The setting applies to pages written from now on; existing pages gain free
-- space as their rows are updated or the table is rewritten. Nothing is
-- rewritten here.
--
-- cohort_variant_summary is deliberately left out: its counters are indexed
-- (carrier-count sort and filters), so its updates can never be heap-only.
-- "__schema__" is the migration-runner template placeholder.

ALTER TABLE "__schema__"."variant_frequency" SET (fillfactor = 85);
ALTER TABLE "__schema__"."cohort_gene_variant_summary" SET (fillfactor = 85);
ALTER TABLE "__schema__"."cohort_gene_summary" SET (fillfactor = 50);

-- Representative annotation of a summary row (#461).
--
-- A summary row stores one value per annotation column for all carriers of a
-- coordinate. The rule is now the same on every path: the NULL-ignoring MAX()
-- per column, text compared bytewise (COLLATE "C"), as SQLite does. Rows
-- written before this migration kept the first imported case's annotation
-- (incremental add) or a MAX() under the database collation (rebuild), and
-- were not updated by a transcript switch. They are valid apart from those
-- columns, so the summary is flagged stale rather than rebuilt here: readers
-- keep being served the current rows while a background rebuild replaces
-- them (cohort-read-freshness.ts). An empty summary has nothing to correct.
UPDATE "__schema__"."cohort_summary_state"
   SET is_stale = true,
       stale_reason = 'migration_0024_representative_annotation',
       stale_at = now()
 WHERE id = 1
   AND EXISTS (SELECT 1 FROM "__schema__"."cohort_variant_summary");
