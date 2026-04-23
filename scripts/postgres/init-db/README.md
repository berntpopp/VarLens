# PostgreSQL Init Scripts

Files in this directory are mounted into `/docker-entrypoint-initdb.d` by
`docker-compose.postgres.yml`.

They run only when Docker initializes a fresh `varlens_postgres_data` volume.
If the named volume already exists, PostgreSQL skips these scripts on startup.

Phase 1 keeps this bootstrap SQL intentionally minimal. The local development
workflow only needs a stable schema baseline for early PostgreSQL session work.

Future phases may add development-only helper objects here if they improve local
iteration. Production migrations must not depend on this folder because these
scripts are a Docker convenience, not the application's migration system.
