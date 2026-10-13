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

-- Before the split: imports before f51a8e6c stored any build string, but the
-- key needs build ids. Aliases become their id (case-insensitive, a .pN patch
-- suffix ignored: 'hg19', 'GRCh37.p13' -> GRCh37); a value matching no build
-- is kept and its cases get a build review. The alias list and the id list
-- are genome-builds.config.ts (genomeBuildAliasPairs, GENOME_BUILDS); a drift
-- test (tests/main/storage/postgres-build-alias-drift.test.ts) keeps them equal.
UPDATE "__schema__"."cases_all" c
   SET genome_build = a.id
  FROM (VALUES
  ('b37', 'GRCh37'),
  ('b38', 'GRCh38'),
  ('chm13', 'T2T-CHM13'),
  ('gca_000001405.15', 'GRCh38'),
  ('gcf_000001405.13', 'GRCh37'),
  ('gcf_000001405.14', 'GRCh37'),
  ('gcf_000001405.15', 'GRCh37'),
  ('gcf_000001405.16', 'GRCh37'),
  ('gcf_000001405.17', 'GRCh37'),
  ('gcf_000001405.18', 'GRCh37'),
  ('gcf_000001405.19', 'GRCh37'),
  ('gcf_000001405.20', 'GRCh37'),
  ('gcf_000001405.21', 'GRCh37'),
  ('gcf_000001405.22', 'GRCh37'),
  ('gcf_000001405.23', 'GRCh37'),
  ('gcf_000001405.24', 'GRCh37'),
  ('gcf_000001405.25', 'GRCh37'),
  ('gcf_000001405.26', 'GRCh38'),
  ('gcf_000001405.27', 'GRCh38'),
  ('gcf_000001405.28', 'GRCh38'),
  ('gcf_000001405.29', 'GRCh38'),
  ('gcf_000001405.30', 'GRCh38'),
  ('gcf_000001405.31', 'GRCh38'),
  ('gcf_000001405.32', 'GRCh38'),
  ('gcf_000001405.33', 'GRCh38'),
  ('gcf_000001405.34', 'GRCh38'),
  ('gcf_000001405.35', 'GRCh38'),
  ('gcf_000001405.36', 'GRCh38'),
  ('gcf_000001405.37', 'GRCh38'),
  ('gcf_000001405.38', 'GRCh38'),
  ('gcf_000001405.39', 'GRCh38'),
  ('gcf_000001405.40', 'GRCh38'),
  ('grch37', 'GRCh37'),
  ('grch37lite', 'GRCh37'),
  ('grch38', 'GRCh38'),
  ('hg19', 'GRCh37'),
  ('hg38', 'GRCh38'),
  ('homo_sapiens_assembly19', 'GRCh37'),
  ('homo_sapiens_assembly38', 'GRCh38'),
  ('hs1', 'T2T-CHM13'),
  ('hs37', 'GRCh37'),
  ('hs37d5', 'GRCh37'),
  ('hs38', 'GRCh38'),
  ('hs38dh', 'GRCh38'),
  ('human_g1k_v37', 'GRCh37'),
  ('t2t', 'T2T-CHM13'),
  ('t2t-chm13', 'T2T-CHM13')
  ) AS a(alias, id)
 WHERE regexp_replace(lower(btrim(c.genome_build)), '\.p[0-9]+$', '') = a.alias
   AND c.genome_build <> a.id;

INSERT INTO "__schema__"."contig_build_review"
  (case_id, stored_build, suggested_build, reason, created_at)
SELECT id, genome_build, NULL, 'build_unknown', (EXTRACT(EPOCH FROM now()) * 1000)::bigint
  FROM "__schema__"."cases_all"
 WHERE genome_build NOT IN ('GRCh38', 'GRCh37', 'T2T-CHM13')
ON CONFLICT (case_id) DO NOTHING;

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
