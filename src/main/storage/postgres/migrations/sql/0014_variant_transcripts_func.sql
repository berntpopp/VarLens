-- D1 (2026-07-06 security-and-bug remediation): canonical transcript
-- impact/SO model. variant_transcripts.consequence was conflated — JSON
-- import wrote the IMPACT level (correct), but VCF import (VEP CSQ / SnpEff
-- ANN) wrote the raw Sequence Ontology term instead, corrupting
-- impact/rarity filters once the transcript-switch denormalization copies
-- it onto variants.consequence.
--
-- Fix: add `func` mirroring variants.func (the SO term), matching the
-- variants table's existing consequence/func convention. Application code
-- now writes consequence = IMPACT, func = SO term on every import path.
--
-- Backfill without guessing an impact:
--   - JSON-imported rows already have the correct IMPACT in `consequence`.
--     Recover `func` for the selected row when the parent still names that
--     transcript and retains its SO term; other unavailable terms stay NULL.
--   - A non-enum `consequence` is provably not an IMPACT. Preserve it as the
--     SO term in `func`. Recover the parent IMPACT only for the selected row
--     when the parent names that same transcript; otherwise leave it NULL.
--
-- "__schema__" is the migration-runner template placeholder (see
-- 0001_create_cases.sql). IF NOT EXISTS makes the ALTER itself replay-safe;
-- the migration runner's schema_migrations ledger already guarantees this
-- file is applied at most once per schema.

ALTER TABLE "__schema__"."variant_transcripts"
  ADD COLUMN IF NOT EXISTS func TEXT;

UPDATE "__schema__"."variant_transcripts" AS vt
   SET func = v.func
  FROM "__schema__"."variants" AS v
 WHERE v.id = vt.variant_id
   AND vt.func IS NULL
   AND vt.is_selected = 1
   AND vt.consequence IN ('HIGH', 'MODERATE', 'LOW', 'MODIFIER')
   AND v.transcript = vt.transcript_id
   AND v.func IS NOT NULL;

UPDATE "__schema__"."variant_transcripts" AS vt
   SET func = vt.consequence,
       consequence = CASE
         WHEN vt.is_selected = 1 AND v.transcript = vt.transcript_id
           AND v.consequence IN ('HIGH', 'MODERATE', 'LOW', 'MODIFIER')
         THEN v.consequence
         ELSE NULL
       END
  FROM "__schema__"."variants" AS v
 WHERE v.id = vt.variant_id
   AND vt.consequence IS NOT NULL
   AND vt.consequence NOT IN ('HIGH', 'MODERATE', 'LOW', 'MODIFIER');
