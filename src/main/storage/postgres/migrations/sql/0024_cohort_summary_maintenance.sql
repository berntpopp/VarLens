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
