-- Global annotations keyed by genome build (#577; mirrors SQLite v52,
-- annotation-build-key-migration.ts). A GRCh37 and a GRCh38 case at the same
-- numbers no longer share one star, comment or ACMG call.
--
-- Every existing row applied to every build's locus, so it is COPIED, never
-- moved: one row per build of the cases that hold the coordinate, and a row
-- no case uses goes to every build present (to the column default when there
-- are no cases). Only the build-less originals are removed, each after at
-- least one copy was written.
-- "__schema__" is the migration-runner template placeholder.

ALTER TABLE "__schema__"."variant_annotations" ADD COLUMN genome_build TEXT;
ALTER TABLE "__schema__"."variant_annotations"
  DROP CONSTRAINT variant_annotations_chr_pos_ref_alt_key;

WITH builds AS (
  SELECT DISTINCT genome_build FROM "__schema__"."cases_all"
  UNION
  SELECT 'GRCh38' WHERE NOT EXISTS (SELECT 1 FROM "__schema__"."cases_all")
)
INSERT INTO "__schema__"."variant_annotations"
  (chr, pos, ref, alt, genome_build, global_comment, starred,
   acmg_classification, acmg_evidence, created_at, updated_at)
SELECT va.chr, va.pos, va.ref, va.alt, b.genome_build, va.global_comment, va.starred,
       va.acmg_classification, va.acmg_evidence, va.created_at, va.updated_at
FROM "__schema__"."variant_annotations" va
CROSS JOIN builds b
WHERE va.genome_build IS NULL
  AND (
    EXISTS (
      SELECT 1 FROM "__schema__"."variants_all" v
      JOIN "__schema__"."cases_all" c ON c.id = v.case_id
      WHERE v.chr = va.chr AND v.pos = va.pos AND v.ref = va.ref AND v.alt = va.alt
        AND c.genome_build = b.genome_build
    )
    OR NOT EXISTS (
      SELECT 1 FROM "__schema__"."variants_all" v
      WHERE v.chr = va.chr AND v.pos = va.pos AND v.ref = va.ref AND v.alt = va.alt
    )
  );

DELETE FROM "__schema__"."variant_annotations" WHERE genome_build IS NULL;

ALTER TABLE "__schema__"."variant_annotations" ALTER COLUMN genome_build SET NOT NULL;
ALTER TABLE "__schema__"."variant_annotations"
  ADD CONSTRAINT variant_annotations_build_key UNIQUE (chr, pos, ref, alt, genome_build);

-- The summary flags now count each build's annotations only: recompute them.
UPDATE "__schema__"."cohort_summary_state"
   SET is_stale = true,
       stale_reason = CASE WHEN is_stale THEN stale_reason
                           ELSE 'migration_0035_annotation_genome_build' END,
       stale_at = CASE WHEN is_stale THEN stale_at ELSE now() END,
       last_rebuilt_at = COALESCE(last_rebuilt_at, now())
 WHERE id = 1
   AND EXISTS (SELECT 1 FROM "__schema__"."cohort_variant_summary");
