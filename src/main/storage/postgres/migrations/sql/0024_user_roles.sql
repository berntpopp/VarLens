-- Role model for shared multi-user data: viewer / analyst / admin.
--
-- Data stays SHARED across users; the role gates writes (see
-- src/web/server/security/operation-policy.ts):
--   viewer  read-only
--   analyst classify / comment / tag / import / export / curate
--   admin   analyst + user management, settings, delete-all, egress config
--
-- The old `user` role had every write ability an analyst has, so existing
-- accounts move to `analyst` (no one loses access). New accounts default to
-- the least-privileged `viewer`. Mirrors SQLite migration v38.

ALTER TABLE "__schema__"."users" DROP CONSTRAINT IF EXISTS "users_role_check";

UPDATE "__schema__"."users" SET role = 'analyst' WHERE role = 'user';

ALTER TABLE "__schema__"."users" ALTER COLUMN role SET DEFAULT 'viewer';

ALTER TABLE "__schema__"."users"
  ADD CONSTRAINT "users_role_check" CHECK (role IN ('viewer', 'analyst', 'admin'));
