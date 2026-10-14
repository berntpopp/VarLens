-- Phase set id of each call (#586; mirrors SQLite v56): the VCF FORMAT PS
-- value, read by the phase-aware compound-het labels. NULLable without a
-- default, so adding it is a catalogue change; rows imported before have none.
-- "__schema__" is the migration-runner template placeholder.

ALTER TABLE "__schema__"."variants_all" ADD COLUMN IF NOT EXISTS ps BIGINT;

-- The "variants" view (0015, 0025) expands SELECT v.* when defined: redefine
-- it so it exposes the new column, which comes last (CREATE OR REPLACE allowed).
CREATE OR REPLACE VIEW "__schema__"."variants" AS
  SELECT v.* FROM "__schema__"."variants_all" v
  WHERE EXISTS (
    SELECT 1 FROM "__schema__"."cases_all" c
    WHERE c.id = v.case_id AND c.import_status = 'ready'
  );
