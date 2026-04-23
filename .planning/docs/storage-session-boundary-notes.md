# Storage Session Boundary Notes

## Why Phase 1 keeps SQLite as the runtime of record

VarLens is still operationally built around a local SQLite runtime. `DatabaseService`
owns connection setup, schema initialization, migrations, repository assembly,
and SQLite-specific behavior such as PRAGMAs, WAL lifecycle, and SQLCipher
encryption. The worker model is also file-backed. Phase 1 therefore introduces a
session boundary above that runtime instead of pretending the existing
repositories are already portable.

## Why Docker PostgreSQL is added now

PostgreSQL development infrastructure needs to exist before backend work starts
so later phases can be exercised on a realistic local target. The Compose
workflow gives the repo a reproducible development database, explicit
configuration shape, and a place to verify workstation-friendly conventions such
as a nonstandard localhost port for parallel project stacks.

## Why repository portability is deferred

Current repositories are not thin SQL builders. They execute directly through
SQLite-specific semantics and assumptions, including transaction behavior, raw
handle access, metadata queries, and full-text search details. Forcing a shared
cross-engine abstraction in Phase 1 would add false portability and increase
risk before the lifecycle boundary is stable.

## What Phase 2 will implement

Phase 2 will add the first PostgreSQL-specific runtime scaffold behind the new
session boundary. That includes backend config loading from environment,
PostgreSQL connection metadata and health reporting, capability reporting for a
future hosted backend, and the initial `PostgresStorageSession` shape without
claiming full repository parity.
