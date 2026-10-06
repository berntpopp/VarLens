-- Allow more than one active admin per web database.
--
-- 0008 added the partial unique index `users_only_one_active_admin` as the
-- race guard for first-admin bootstrap. It also made it impossible to promote
-- a second user to admin from the web user-management UI (role changes failed
-- with a unique violation). Bootstrap is now serialised by a per-schema
-- transaction-scoped advisory lock plus an "active admin exists?" check in
-- PostgresWebAuthService.insertFirstUser, so the index can go. Desktop SQLite
-- never had this restriction; this restores parity.
--
-- Last-admin protection (never demote/disable the only active admin) is
-- enforced in application code (src/web/auth/postgres-user-admin.ts).

DROP INDEX IF EXISTS "__schema__"."users_only_one_active_admin";
