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
--   - JSON-imported rows already have the correct IMPACT in `consequence`;
--     the original per-transcript SO term was discarded at import time and
--     is not recoverable from the database alone, so `func` stays NULL.
--   - A non-enum `consequence` is provably not an IMPACT. Preserve it as the
--     SO term in `func` and clear `consequence`; do not invent an impact.
--
-- "__schema__" is the migration-runner template placeholder (see
-- 0001_create_cases.sql). IF NOT EXISTS makes the ALTER itself replay-safe;
-- the migration runner's schema_migrations ledger already guarantees this
-- file is applied at most once per schema.

ALTER TABLE "__schema__"."variant_transcripts"
  ADD COLUMN IF NOT EXISTS func TEXT;

UPDATE "__schema__"."variant_transcripts"
   SET func = consequence,
       consequence = NULL
 WHERE consequence IS NOT NULL
   AND consequence NOT IN ('HIGH', 'MODERATE', 'LOW', 'MODIFIER');
