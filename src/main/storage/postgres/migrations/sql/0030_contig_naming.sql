-- Chromosome names in each build's reference form (GRCh38 chr1/chrM, GRCh37
-- 1/MT; spec .planning/specs/2026-10-12-chr-naming-per-build.md, SQLite v47).
--
-- No variant row is rewritten here: the migration runs in one transaction,
-- and a rewrite of 10k exomes must not. Every published case is queued and
-- the background job (postgres-contig-naming.ts) re-checks, renames or flags
-- one case per transaction. Cases imported from now on are stored in the
-- reference form and are never queued. Back the database up before upgrading:
-- the rename is one-way.
-- "__schema__" is the migration-runner template placeholder.

CREATE TABLE IF NOT EXISTS "__schema__"."contig_build_review" (
  case_id BIGINT PRIMARY KEY REFERENCES "__schema__"."cases_all"(id) ON DELETE CASCADE,
  stored_build TEXT NOT NULL,
  suggested_build TEXT,
  reason TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "__schema__"."contig_naming_pending" (
  case_id BIGINT PRIMARY KEY REFERENCES "__schema__"."cases_all"(id) ON DELETE CASCADE
);

INSERT INTO "__schema__"."contig_naming_pending" (case_id)
SELECT id FROM "__schema__"."cases"
ON CONFLICT (case_id) DO NOTHING;
