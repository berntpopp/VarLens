-- Optional web OIDC identity binding. Instance and database lifecycle remains
-- external; one VarLens database may be bound to at most one platform subject.

ALTER TABLE "__schema__"."users"
  ADD COLUMN IF NOT EXISTS auth_source TEXT NOT NULL DEFAULT 'local';

UPDATE "__schema__"."users"
SET auth_source = 'platform'
WHERE password_hash = 'platform-identity-disabled-local-password';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_auth_source_check'
      AND conrelid = '"__schema__"."users"'::regclass
  ) THEN
    ALTER TABLE "__schema__"."users"
      ADD CONSTRAINT users_auth_source_check
      CHECK (auth_source IN ('local', 'platform'));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS users_single_platform_identity
  ON "__schema__"."users" (auth_source)
  WHERE auth_source = 'platform';
