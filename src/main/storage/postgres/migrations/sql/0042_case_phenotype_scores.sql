-- Stored phenotype column (#600; mirrors SQLite v59): per-case gene phenotype
-- scores, computed once per HPO profile and HPO data key; reads only join them.
-- "__schema__" is the migration-runner template placeholder.

CREATE TABLE IF NOT EXISTS "__schema__"."case_phenotype_scores" (
  case_id BIGINT NOT NULL REFERENCES "__schema__"."cases_all"(id) ON DELETE CASCADE,
  gene_symbol TEXT NOT NULL,
  score DOUBLE PRECISION NOT NULL,
  best_disease TEXT,
  PRIMARY KEY (case_id, gene_symbol)
);

CREATE TABLE IF NOT EXISTS "__schema__"."case_phenotype_state" (
  case_id BIGINT PRIMARY KEY REFERENCES "__schema__"."cases_all"(id) ON DELETE CASCADE,
  profile_hash TEXT NOT NULL,
  hpo_data_key TEXT,
  computed_at BIGINT NOT NULL
);
