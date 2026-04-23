# PostgreSQL Init Scripts

Files in this directory are mounted into `/docker-entrypoint-initdb.d` by
`docker-compose.postgres.yml`.

They run only when Docker initializes a fresh `varlens_postgres_data` volume.
If the named volume already exists, PostgreSQL skips these scripts on startup.

The Compose file mounts the named volume at `/var/lib/postgresql`, not
`/var/lib/postgresql/data`. PostgreSQL 18's Docker image expects that parent
mount layout so it can manage the versioned data directory correctly.

VarLens uses a nonstandard default host port for local PostgreSQL development.
The checked-in example sets `VARLENS_PG_PORT=55432` so multiple projects can run
their own PostgreSQL containers in parallel on the same workstation without all
contending for the default `5432` binding.

Developers can override the host port in their untracked `.env.postgres.local`
file. If the port changes, update `VARLENS_PG_URL` in the same local env file so
client tools keep pointing at the correct endpoint.

Phase 1 keeps this bootstrap SQL intentionally minimal. The local development
workflow only needs a stable schema baseline for early PostgreSQL session work.

Future phases may add development-only helper objects here if they improve local
iteration. Production migrations must not depend on this folder because these
scripts are a Docker convenience, not the application's migration system.
