-- HPO term status (#600; mirrors SQLite v58), Phenopackets semantics:
-- excluded = looked for and found absent, key = the leading finding. An
-- unlisted term is not assessed. A term is never both; existing rows become
-- present and not key. "__schema__" is the migration-runner template placeholder.

ALTER TABLE "__schema__"."case_hpo_terms"
  ADD COLUMN IF NOT EXISTS excluded BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "key" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "__schema__"."case_hpo_terms"
  DROP CONSTRAINT IF EXISTS case_hpo_terms_excluded_not_key;
ALTER TABLE "__schema__"."case_hpo_terms"
  ADD CONSTRAINT case_hpo_terms_excluded_not_key CHECK (NOT (excluded AND "key"));
