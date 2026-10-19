# PostgreSQL Init Scripts

Files in this directory are mounted into `/docker-entrypoint-initdb.d` by
`docker-compose.postgres.yml`.

Runtime PostgreSQL schema creation is owned by
`src/main/storage/postgres/migrations/`. This folder is retained only for local
Docker bootstrap compatibility and must not be updated independently from
migrations.

They run only when Docker initializes a fresh `varlens_postgres_data` volume.
If the named volume already exists, PostgreSQL skips these scripts on startup.

The Compose file mounts the named volume at `/var/lib/postgresql/data`, matching
the PostgreSQL 16 default `PGDATA` directory layout. If switching major
PostgreSQL versions or upgrading/downgrading from PostgreSQL 18, recreate the volume
(`make pg-reset` or `docker volume rm varlens_varlens_postgres_data`) because
PostgreSQL data directories are not compatible across major versions.

VarLens uses a nonstandard default host port for local PostgreSQL development.
The checked-in example sets `VARLENS_PG_PORT=55432` so multiple projects can run
their own PostgreSQL containers in parallel on the same workstation without all
contending for the default `5432` binding.

Developers can override the host port in their untracked `.env.postgres.local`
file. If the port changes, update `VARLENS_PG_URL` in the same local env file so
client tools keep pointing at the correct endpoint.

Current init files:

- `001-create-varlens-schema.sql` creates the schema only.
- `10-phase3-cases.sql` creates the base `cases` table.
- `11-phase6-case-metadata.sql` creates Phase 6 metadata/cohort/HPO/comment/metric
  tables that depend on `cases`.
- `12-phase7-variants.sql` creates read-only PostgreSQL variant tables, indexes,
  and FTS trigger-backed `tsvector` columns.
- `20-phase3-seed-cases.sql` seeds deterministic development rows and resets
  sequences after explicit-ID seed inserts.
- `21-phase7-seed-variants.sql` seeds deterministic variant rows for gated
  Phase 7 E2E tests. It is not an import path.

**Phase 8 (2026-04-24):** `cases.id` is now a `BIGSERIAL` generated column so
imports can create new datasets after seeded IDs. `20-phase3-seed-cases.sql`
resets the sequence to `MAX(id)` so the first imported case receives id 4 or
higher.

Future phases may add development-only helper objects here if they improve local
iteration. Production migrations must not depend on this folder because these
scripts are a Docker convenience, not the application's migration system.
