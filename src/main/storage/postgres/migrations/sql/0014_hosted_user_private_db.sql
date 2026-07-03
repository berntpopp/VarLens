-- 0014_hosted_user_private_db.sql
--
-- Control-DB metadata for hosted web mode. Private clinical data lives in the
-- per-user database referenced by private_db_secret_ref; the control DB stores
-- only routing metadata and public annotation snapshot selection.

ALTER TABLE "__schema__"."users"
  ADD COLUMN IF NOT EXISTS private_db_secret_ref TEXT,
  ADD COLUMN IF NOT EXISTS private_db_status TEXT NOT NULL DEFAULT 'unassigned',
  ADD COLUMN IF NOT EXISTS public_annotation_snapshot_id TEXT;

-- PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS; guard it so the migration is
-- idempotent (matching the ADD COLUMN / CREATE INDEX IF NOT EXISTS statements around it).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_private_db_status_check'
      AND conrelid = '"__schema__"."users"'::regclass
  ) THEN
    ALTER TABLE "__schema__"."users"
      ADD CONSTRAINT users_private_db_status_check
      CHECK (private_db_status IN ('unassigned', 'active', 'migration_failed', 'disabled'))
      NOT VALID;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS users_private_db_secret_ref_unique
  ON "__schema__"."users"(private_db_secret_ref)
  WHERE private_db_secret_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_public_annotation_snapshot_id
  ON "__schema__"."users"(public_annotation_snapshot_id)
  WHERE public_annotation_snapshot_id IS NOT NULL;
