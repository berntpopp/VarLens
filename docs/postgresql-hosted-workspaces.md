# PostgreSQL Hosted Workspaces

VarLens can connect to a PostgreSQL workspace for teams that need shared hosted storage. This mode is separate from the default encrypted local SQLite database: the database server is operated by your organization, and VarLens remains a desktop application that connects to that server.

Use this page as an operations checklist before putting a PostgreSQL workspace into routine research or clinical use.

## Security Model

Run VarLens with a dedicated PostgreSQL role that has only the permissions required for application use. Do not use a superuser, database owner, or personal administrator account for day-to-day access.

Recommended role split:

| Role | Purpose | Suggested access |
|------|---------|------------------|
| Application role | Normal VarLens connections | Connect to the database and read/write only the VarLens workspace schema |
| Migration role | Schema upgrades | Own or alter the VarLens schema during controlled upgrades |
| Backup role | Scheduled dumps | Read-only access needed for `pg_dump` |

Keep each team or project in its own database or schema unless your governance model explicitly allows shared schemas. For schema-separated deployments, ensure `search_path` is controlled and that the application role cannot create objects outside the assigned workspace schema.

Store credentials in the operating system credential store where available. Do not put passwords, connection strings with embedded secrets, private keys, or certificate material in shared tickets, screenshots, exported diagnostics, or project notes.

## Audit Trail

VarLens keeps its audit trail (clinical change history, logins, API access) in a shared `varlens_audit` schema, separate from the per-project workspace schemas. Audit rows therefore survive the deletion of a project schema, and the table rejects `UPDATE`, `DELETE`, and `TRUNCATE` through database triggers. In the VarLens web UI, audit-log entries are visible to administrator accounts only.

Protection comes in two tiers, and the difference matters for compliance claims:

| Tier | Applied by | Protects against |
|------|-----------|------------------|
| 1 — append-only triggers | Automatically, by VarLens schema migrations | Application bugs, SQL injection through the application role, accidental mutation |
| 2 — ownership separation | The operator, once per database (see below) | Misuse of the application credential itself: with Tier 2, that role cannot drop the triggers or alter the table |

A fresh deployment is at Tier 1. **Statements about the audit trail being tamper-proof (Revisionssicherheit) require Tier 2.** To apply it, run once per database with a superuser connection, after the application has started at least once (so migrations have run):

```bash
VARLENS_PG_ADMIN_URL=postgres://postgres:...@db.example.org/varlens \
  scripts/postgres/provision-audit-owner.sh varlens   # app role name
```

This transfers ownership of the audit schema to a dedicated `varlens_audit_owner` role and reduces the application role to `INSERT` + `SELECT`.

### Retention

Audit rows include staff activity data, so storage-limitation rules apply to them independently of the clinical data. Retention is enforced with a separate script that must run with the admin credential — the application role cannot delete audit rows by design:

```bash
VARLENS_PG_ADMIN_URL=postgres://postgres:...@db.example.org/varlens \
VARLENS_AUDIT_CLINICAL_RETENTION_DAYS=3650 \
VARLENS_AUDIT_ACCESS_RETENTION_DAYS=730 \
  scripts/postgres/audit-retention.sh
```

The defaults (10 years for clinical change events, 2 years for access/login events) are starting points, not legal advice: **retention periods are your organization's data-protection policy and must be confirmed by your data-protection officer** before the script is put on a schedule. Scheduling (cron, systemd timer, or your platform's job runner) is the operator's choice.

Include the `varlens_audit` schema in backups; it is not covered by per-workspace schema dumps.

## SSL and Certificates

Hosted deployments should use SSL with certificate verification. In VarLens profile terms, prefer `require-verify` for any networked PostgreSQL service. Use `disable` only for trusted local development environments or isolated test containers.

For certificate-verified connections:

- Use the provider's root CA certificate or your organization's internal CA certificate.
- Rotate certificates before expiry and test a VarLens connection after rotation.
- Keep hostnames stable; certificate verification depends on the hostname matching the certificate.
- Avoid IP-address connections unless the certificate is issued for that address.

If a managed PostgreSQL provider offers multiple SSL modes, choose the mode that validates the server certificate rather than only encrypting the connection.

## Backups

Backups are the operator's responsibility for hosted PostgreSQL workspaces. At minimum, keep automated database or schema dumps and test restores on a schedule.

For a schema-scoped workspace, a typical logical backup is:

```bash
pg_dump --format=custom --schema=workspace_a --schema=varlens_audit --file=varlens-workspace-a.dump postgresql://backup_user@db.example.org/varlens
```

Always include `--schema=varlens_audit`: the audit trail lives in that shared schema, not in the workspace schema, and a workspace-only dump silently drops it.

For a database-scoped workspace, dump the full database:

```bash
pg_dump --format=custom --file=varlens.dump postgresql://backup_user@db.example.org/varlens
```

Operational guidance:

- Encrypt backups at rest and restrict restore permissions.
- Keep retention long enough to cover accidental deletions discovered after case review.
- Monitor backup job failures and storage exhaustion.
- Test restore into a non-production database before relying on backups for recovery.
- Record the VarLens application version and PostgreSQL server version alongside backup artifacts.

## Restore

Always restore into a new database or schema first. Do not overwrite a production workspace until the restored copy has been validated.

Example schema restore:

```bash
createdb varlens_restore
pg_restore --dbname=varlens_restore --schema=workspace_a varlens-workspace-a.dump
```

After restoring:

1. Connect VarLens to the restored database or schema with a non-production profile.
2. Confirm the expected cases, variants, annotations, and cohort views are present.
3. Run PostgreSQL diagnostics and check the schema and migration status.
4. Only promote the restored workspace after users have stopped writing to the damaged or stale workspace.

For point-in-time recovery on managed PostgreSQL, follow the provider's recovery process, then validate with VarLens before switching users to the recovered instance.

## Connection Pooling

Start with a small VarLens pool size. Hosted PostgreSQL services often enforce low connection limits, and each desktop client can open multiple connections.

Suggested starting points:

| Deployment | Starting pool size |
|------------|--------------------|
| Single analyst desktop | 2-4 |
| Small shared lab database | 2 per active user |
| Managed PostgreSQL with strict limits | Coordinate pool size with the service connection cap |

If PgBouncer or another pooler is used, prefer session pooling unless VarLens has been verified in your environment with transaction pooling. Transaction pooling can break workflows that depend on session state, temporary settings, prepared statements, advisory locks, or per-session timeouts.

Set conservative timeouts so stuck queries fail predictably:

- `connectionTimeoutMillis`: fail quickly when the server is unavailable.
- `statementTimeoutMs`: cap long-running interactive operations.
- `lockTimeoutMs`: avoid waiting indefinitely on schema or write locks.
- `idleInTransactionSessionTimeoutMs`: close abandoned transactions.

## Diagnostics

Use the PostgreSQL diagnostics export when reporting hosted workspace issues. Diagnostic bundles are intended to include operational state such as backend, schema, migration status, health checks, and storage capabilities while redacting credentials.

Before sharing diagnostics:

- Check that hostnames, schema names, usernames, and project labels are acceptable to share with the recipient.
- Do not add screenshots or notes that include passwords, full connection URLs, private keys, or certificate private material.
- Include the symptom, approximate time, VarLens version, PostgreSQL provider, and whether the issue affects one user or all users.

Useful operator checks outside VarLens include:

```sql
SELECT version();
SELECT current_user;
SHOW search_path;
SELECT now() - query_start AS runtime, state, wait_event_type, wait_event, query
FROM pg_stat_activity
WHERE datname = current_database()
ORDER BY query_start NULLS LAST;
```

For import or query performance reports, include whether the database uses local storage, managed network storage, a connection pooler, or cross-region access. Network latency and provider connection limits can dominate desktop-to-hosted PostgreSQL performance.
