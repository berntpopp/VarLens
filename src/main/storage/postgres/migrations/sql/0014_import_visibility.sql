ALTER TABLE "__schema__"."cases"
  ADD COLUMN IF NOT EXISTS import_status TEXT NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS import_variant_watermark BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS import_is_new BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "__schema__"."cases"
  DROP CONSTRAINT IF EXISTS cases_import_status_check;

ALTER TABLE "__schema__"."cases"
  ADD CONSTRAINT cases_import_status_check
  CHECK (import_status IN ('ready', 'importing'));

CREATE INDEX IF NOT EXISTS idx_cases_import_status
  ON "__schema__"."cases" (import_status);

ALTER TABLE "__schema__"."cases" RENAME TO "cases_all";

CREATE VIEW "__schema__"."cases" AS
  SELECT * FROM "__schema__"."cases_all" WHERE import_status = 'ready';

ALTER TABLE "__schema__"."variants" RENAME TO "variants_all";

CREATE VIEW "__schema__"."variants" AS
  SELECT v.* FROM "__schema__"."variants_all" v
  WHERE EXISTS (
    SELECT 1 FROM "__schema__"."cases_all" c
    WHERE c.id = v.case_id AND c.import_status = 'ready'
  );
