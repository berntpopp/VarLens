# Storage Session Boundary — Design

**Date:** 2026-04-23  
**Status:** Draft v4 — rewritten to replace the obsolete low-level adapter design  
**Motivation:** VarLens needs a realistic path from SQLite-only local storage to optional hosted PostgreSQL without destabilizing the current app. The codebase does not support a thin driver swap under `DatabaseService`; the seam needs to sit above the current SQLite runtime.

## Summary

This design replaces the earlier `StorageAdapter` concept with a higher-level `StorageSession` / `StorageManager` boundary.

The key decision is:

- **Do not** introduce a new low-level database adapter under `DatabaseService`.
- **Do** wrap the current SQLite runtime (`DatabaseService` + `DbPool`) in a session abstraction.
- **Do** keep repository internals SQLite-specific for now.
- **Do** add PostgreSQL as a second backend through a new session implementation, not by pretending existing repositories are already portable.

This is a more honest design for the current codebase and a safer path to an experimental hosted PostgreSQL mode.

## Why the previous design was wrong

The previous draft assumed a low-level `StorageAdapter` could isolate SQLite specifics while leaving most repository code structurally intact. That does not match the current codebase:

- [`DatabaseService`](<../../src/main/database/DatabaseService.ts>) is already the SQLite runtime. It opens the connection, applies PRAGMAs, initializes schema, runs migrations, builds repositories, and exposes the raw handle.
- [`BaseRepository`](<../../src/main/database/BaseRepository.ts>) compiles Kysely SQL but executes directly through `better-sqlite3`.
- Repositories and services depend on SQLite semantics such as `db.transaction(...)`, `db.exec(...)`, `lastInsertRowid`, `changes`, PRAGMAs, FTS5, and `sqlite_master`.
- Workers open SQLite databases by file path and encryption key. That architecture is explicitly file-backed.

Because of that, a low-level “portable adapter” below the repositories is the wrong seam. It creates duplication and false portability. The first stable boundary has to be **above** the current runtime.

## Design goals

1. Introduce a backend-neutral session boundary that the main process can own safely.
2. Preserve current SQLite behavior during the transition.
3. Keep existing IPC and renderer behavior stable as long as possible.
4. Add local PostgreSQL development infrastructure early, before runtime migration.
5. Make PostgreSQL support possible through a second session implementation.
6. Avoid rewriting all repositories before the architecture can carry the change.

## Non-goals

- No immediate repository portability across SQLite and PostgreSQL.
- No shared low-level SQL driver abstraction in this phase.
- No replacement of the current SQLite worker model in Phase 1.
- No renderer storage switcher UI in Phase 1.
- No production-grade hosted Postgres provisioning or secrets management design in this spec.
- No claim that PostgreSQL is feature-complete at the end of the first phase.

## Current codebase reality

The storage lifecycle today is built around these layers:

- [`DatabaseManager`](<../../src/main/services/DatabaseManager.ts>) owns the current open database and file-based switching.
- [`DatabaseService`](<../../src/main/database/DatabaseService.ts>) owns the SQLite runtime.
- [`createRepositories`](<../../src/main/database/createRepositories.ts>) centralizes repository assembly.
- [`DbPool`](<../../src/main/database/DbPool.ts>) and [`db-worker`](<../../src/main/workers/db-worker.ts>) provide SQLite-specific read offloading.
- write-side workers such as [`import-worker.ts`](<../../src/main/workers/import-worker.ts>) and [`worker-db.ts`](<../../src/main/workers/worker-db.ts>) also assume a local SQLite file.

The design must fit that shape rather than attempting to bypass it.

## Proposed architecture

### Core concept

Introduce:

- `StorageSession`: the active backend-specific workspace/session.
- `StorageManager`: the lifecycle owner of the current session.

The first implementation is:

- `SqliteStorageSession`: a thin wrapper around the existing `DatabaseService` plus optional `DbPool`.

The later implementation is:

- `PostgresStorageSession`: a separate backend-specific session with its own connection/pooling strategy and its own repository/service implementations where needed.

### Boundary placement

The session boundary sits **above** the existing SQLite runtime:

```text
IPC / lifecycle logic
        |
  StorageManager
        |
  StorageSession
   /         \
SQLite       Postgres
session      session
  |             |
DatabaseService  pg/pool + backend-specific services
DbPool           later worker/executor strategy
```

The existing SQLite runtime remains the source of truth until PostgreSQL-specific vertical slices are implemented.

## `StorageSession` shape

Phase 1 keeps the session surface intentionally small and compatibility-oriented.

```ts
export interface StorageSession {
  readonly workspace: WorkspaceRef
  readonly capabilities: StorageCapabilities

  getDatabaseService(): DatabaseService
  getDbPool(): DbPool | null
  getEncryptionKey(): string | undefined
  needsStartupRebuild(): boolean
  rekey(newPassword: string): void
  close(): Promise<void>
  health(): Promise<StorageHealth>
}
```

Important design choice:

- This is **not** pretending both backends share the same low-level repository internals yet.
- It provides the lifecycle and compatibility hooks needed to migrate the system in controlled vertical slices.

## `StorageManager` shape

`StorageManager` becomes the owner of the current session instead of owning a raw `DatabaseService`.

Initial shape:

```ts
export interface StorageManager {
  openSqlite(path: string, key?: string): Promise<void>
  createSqlite(path: string, key?: string): Promise<void>
  switchToSqlite(path: string, key?: string): Promise<void>
  detectSqliteEncryption(path: string): { needsPassword: boolean }
  getCurrentSession(): StorageSession
  getCurrentPath(): string | null
  close(): Promise<void>
}
```

Compatibility rule:

- Existing code that still expects `DatabaseService` can continue to work through a compatibility getter such as `getCurrentSession().getDatabaseService()`.
- Existing file-based UX remains intact in the SQLite path.

## Shared types

### Backend kind

```ts
export type StorageBackendKind = 'sqlite' | 'postgres'
```

### Capabilities

Capabilities let the rest of the app reason about backend behavior without dialect-specific branching scattered everywhere.

```ts
export interface StorageCapabilities {
  readonly backend: StorageBackendKind
  readonly supportsEncryptionAtRest: boolean
  readonly supportsLocalFileLifecycle: boolean
  readonly supportsHostedConnectionLifecycle: boolean
  readonly supportsWorkerReadPool: boolean
  readonly supportsFullTextSearch: boolean
}
```

### Workspace identity

```ts
export type WorkspaceRef =
  | {
      kind: 'sqlite'
      path: string
      name: string
      encrypted: boolean
    }
  | {
      kind: 'postgres'
      connectionLabel: string
      connectionUrlRedacted: string
      schema: string
    }
```

The important point is that PostgreSQL workspace identity is not a file path. It is a connection target plus schema context.

## SQLite session design

`SqliteStorageSession` is intentionally simple:

- owns a `DatabaseService`
- optionally owns a `DbPool`
- reports SQLite capabilities
- delegates encryption-key access, startup rebuild checks, and rekey to the wrapped service
- closes the pool first, then closes the wrapped database service

This design avoids opening a second SQLite connection purely to satisfy a new abstraction.

That is the main correction over the previous design.

## PostgreSQL direction

PostgreSQL is introduced later as a separate session implementation.

This spec intentionally does **not** overfit the low-level runtime details yet, but the direction is:

- one backend-specific `PostgresStorageSession`
- one connection configuration source
- one local Docker-backed development flow
- backend-specific health and capability reporting
- backend-specific worker/executor strategy
- backend-specific repository/service implementations where SQLite assumptions cannot be shared

The design explicitly rejects the idea that current repositories can be made portable by only changing the driver under them.

## Workers

Workers remain part of the design on both backends.

Reason:

- import/export/finalization work is not just DB I/O
- there is file parsing, CPU-heavy transforms, progress reporting, and orchestration that should stay off the Electron main process

Backend-specific consequence:

- SQLite keeps the current file-backed worker model initially.
- PostgreSQL will need a different executor strategy later, but not in Phase 1.

This spec intentionally separates:

- **keeping workers as an architectural concept**
- **changing how a backend-specific worker reaches storage**

## IPC impact

Phase 1 tries to avoid destabilizing IPC.

Near-term rule:

- existing `database:*` IPC remains the renderer-facing surface
- lifecycle logic behind it becomes session-backed instead of directly `DatabaseService`-backed

Later phases may introduce a broader `storage:*` domain, but that is deferred until the session boundary exists and the vertical-slice migration begins.

## PostgreSQL development workflow

The repo should gain local PostgreSQL development support early through Docker and `make`.

Required dev workflow:

- `docker-compose.postgres.yml`
- `.env.postgres.example`
- local `.env.postgres.local`
- `scripts/postgres/init-db/`
- `make pg-up`
- `make pg-down`
- `make pg-logs`
- `make pg-psql`
- `make pg-reset`

Design constraints:

- bind to `127.0.0.1` only
- named volume for persistence
- init scripts only for development bootstrap
- this workflow must be optional and must not change the default SQLite development path

## Phased implementation direction

### Phase 1

- add `StorageSession` and `StorageManager` contracts
- implement `SqliteStorageSession`
- refactor `DatabaseManager` to own a session
- preserve existing `DatabaseService` compatibility
- add PostgreSQL Docker development workflow

### Phase 2

- add PostgreSQL config scaffolding
- add `PostgresStorageSession` skeleton
- implement health/info/capability reporting

### Phase 3

- migrate one vertical slice end-to-end across both backends
- keep SQLite path stable
- evaluate where shared logic is actually safe

### Phase 4

- redesign backend-specific read/write executor strategy
- introduce PostgreSQL-specific worker/execution model

### Phase 5

- continue domain-by-domain migration
- add backend-aware tests and CI coverage
- add renderer storage settings when the runtime is ready

## Locked decisions

1. The old low-level `StorageAdapter` design is obsolete and removed.
2. The first seam is `StorageSession`, above the current SQLite runtime.
3. `DatabaseService` remains the SQLite runtime during the transition.
4. `SqliteStorageSession` wraps the current runtime rather than duplicating it.
5. Repository portability is deferred until vertical slices prove what is actually shareable.
6. Workers remain part of the architecture on both backends.
7. PostgreSQL local development uses Docker plus `make`, but SQLite remains the default development path.

## Risks

- **Risk:** The compatibility layer around `DatabaseService` becomes permanent accidental architecture.  
  **Mitigation:** Keep the `StorageSession` surface small and phase-driven; migrate vertically and delete compatibility shims when real backend slices land.

- **Risk:** Async lifecycle changes in `DatabaseManager` ripple through tests and startup code.  
  **Mitigation:** Limit Phase 1 to lifecycle ownership changes and keep IPC payloads stable.

- **Risk:** The team tries to generalize repositories too early.  
  **Mitigation:** Treat PostgreSQL support as a second implementation, not a driver swap.

- **Risk:** Docker/Postgres dev flow grows into a hidden production migration system.  
  **Mitigation:** Keep `scripts/postgres/init-db/` explicitly development-only and keep production schema changes in real migrations.

## Acceptance criteria for this design

This design is satisfied when:

- the planning docs no longer depend on the obsolete low-level adapter concept
- the implementation plan uses `StorageSession` / `StorageManager`
- PostgreSQL Docker development is a first-class explicit workflow
- the architecture preserves current SQLite behavior while creating a credible seam for PostgreSQL

## Relationship to the plan

The implementation plan at [2026-04-23-storage-adapter-phase-1-scaffold-plan.md](../plans/2026-04-23-storage-adapter-phase-1-scaffold-plan.md) is the execution document for Phase 1 of this design.
