# PostgreSQL Storage Session — Phase 2 Design

**Date:** 2026-04-23  
**Status:** Draft v2  
**Depends on:** `2026-04-23-storage-adapter-boundary-design.md`, `2026-04-23-storage-adapter-phase-1-scaffold-plan.md`  
**Motivation:** Phase 1 created the storage-session boundary and local PostgreSQL development workflow. Phase 2 should add the first real PostgreSQL runtime object behind that boundary without pretending the existing SQLite repositories are already portable.

## Summary

Phase 2 introduces a backend-specific `PostgresStorageSession` and replaces the current PostgreSQL development placeholder config with a real, validated session-level config shape.

This phase is intentionally narrow:

- **Do** add a real PostgreSQL session implementation.
- **Do** add validated environment-backed PostgreSQL config parsing.
- **Do** add a `pg.Pool` factory with explicit lifecycle and timeout configuration.
- **Do** expose PostgreSQL workspace metadata, capability reporting, and health checks.
- **Do** keep lifecycle and IPC changes additive where needed.
- **Do not** migrate repositories.
- **Do not** redesign workers.
- **Do not** add renderer-facing backend switching UI.
- **Do not** implicitly mutate PostgreSQL `search_path` in this phase.

This is the first honest PostgreSQL runtime slice after the Phase 1 boundary work. It proves that the new storage seam can carry a second backend at the lifecycle level before any data-access portability work begins.

## Why this is the next step

The 2026-04-22 codebase review kept **Priority C** open: create a real storage boundary before starting PostgreSQL work. That boundary now exists on `main`.

The next safe step is therefore not repository portability. It is session-level backend reality:

- a concrete PostgreSQL session object,
- a concrete configuration source,
- explicit pool configuration and lifecycle,
- concrete backend capability reporting,
- and a concrete health/readiness signal.

That gives later phases a real target to integrate against without creating false claims that a single query layer already works across SQLite and PostgreSQL.

## Design goals

1. Add a real `PostgresStorageSession` that satisfies the current `StorageSession` contract.
2. Define a validated PostgreSQL config shape for VarLens main-process lifecycle code.
3. Own PostgreSQL connection pooling explicitly through `pg.Pool`.
4. Report PostgreSQL workspace identity without exposing raw credentials.
5. Provide a reliable `health()` implementation for connection verification.
6. Keep renderer and IPC changes additive and backward-compatible.
7. Preserve the rule that repository migration is a later phase.

## Non-goals

- No query portability across SQLite and PostgreSQL.
- No Postgres-backed repository implementations yet.
- No `DatabaseManager` default switch from SQLite to PostgreSQL.
- No worker/executor redesign.
- No schema migration framework for PostgreSQL in this phase.
- No renderer settings UI for backend selection.
- No production secrets-management story beyond explicit environment parsing.
- No automatic `search_path` manipulation.
- No claim that PostgreSQL-specific features such as FTS are operationally available yet.

## Current codebase reality

After Phase 1, the relevant storage pieces are:

- [`src/main/storage/session.ts`](<../../src/main/storage/session.ts>) defines the session contract.
- [`src/main/storage/types.ts`](<../../src/main/storage/types.ts>) defines `StorageCapabilities`, `WorkspaceRef`, and `StorageHealth`.
- [`src/main/storage/config.ts`](<../../src/main/storage/config.ts>) currently parses only a minimal `{ url, schema }` development config.
- [`src/main/storage/sqlite/SqliteStorageSession.ts`](<../../src/main/storage/sqlite/SqliteStorageSession.ts>) is the reference implementation of the session contract.
- [`src/main/services/DatabaseManager.ts`](<../../src/main/services/DatabaseManager.ts>) is now session-backed but remains SQLite-oriented in lifecycle behavior.

That means Phase 2 should add a second session implementation and stronger config parsing without prematurely forcing `DatabaseManager` to become a full multi-backend switchboard.

## Driver choice

Phase 2 uses **`pg`** (`node-postgres`) rather than `postgres` (`postgres.js`).

Reasons:

- it fits the existing Electron main-process service style better,
- pooled connection lifecycle is explicit,
- `Pool` is the documented normal mode for application use,
- health-check behavior is straightforward and unsurprising,
- it is the more conservative choice for a first backend scaffold.

The design assumes a single long-lived `Pool` owned by `PostgresStorageSession`.

## Proposed architecture

### Core shape

Add:

- `src/main/storage/postgres/PostgresStorageSession.ts`
- pool/config helpers in `src/main/storage/config.ts`

The session boundary then looks like:

```text
StorageManager / lifecycle code
        |
  StorageSession
   /         \
SQLite       Postgres
session      session
  |             |
DatabaseService  pg.Pool
DbPool           session metadata + health
```

### Session responsibilities

`PostgresStorageSession` is responsible for:

- owning the PostgreSQL pool,
- wiring a pool `error` listener,
- exposing redacted workspace identity,
- reporting backend capabilities,
- implementing `health()` via a minimal round-trip query,
- closing the pool cleanly with `pool.end()`.

It is **not** responsible for:

- repository assembly,
- SQL portability,
- import/export execution,
- worker orchestration,
- renderer-specific concerns.

## PostgreSQL config design

Phase 1 used:

```ts
export interface PostgresDevConfig {
  url: string
  schema: string
}
```

Phase 2 should replace that with a real config shape:

```ts
export type PostgresSslMode = 'disable' | 'prefer' | 'require'

export interface PostgresStorageConfig {
  url: string
  schema: string
  applicationName: string
  sslMode: PostgresSslMode
  connectionTimeoutMillis: number
  statementTimeoutMs: number
  queryTimeoutMs: number
  lockTimeoutMs: number
  idleInTransactionSessionTimeoutMs: number
  poolMax: number
}
```

### Environment contract

Environment variables:

- `VARLENS_PG_URL` — required to enable PostgreSQL config
- `VARLENS_PG_SCHEMA` — optional, defaults to `public`
- `VARLENS_PG_APPLICATION_NAME` — optional, defaults to `varlens-main`
- `VARLENS_PG_SSL_MODE` — optional, defaults to `disable`
- `VARLENS_PG_CONNECTION_TIMEOUT_MS` — optional, defaults to a nonzero value
- `VARLENS_PG_STATEMENT_TIMEOUT_MS` — optional, defaults to a nonzero value
- `VARLENS_PG_QUERY_TIMEOUT_MS` — optional, defaults to a nonzero value
- `VARLENS_PG_LOCK_TIMEOUT_MS` — optional, defaults to a nonzero value
- `VARLENS_PG_IDLE_IN_TX_TIMEOUT_MS` — optional, defaults to a nonzero value
- `VARLENS_PG_POOL_MAX` — optional, defaults to a small desktop-appropriate pool size

### Recommended defaults

Phase 2 should choose explicit defaults rather than inheriting driver defaults silently:

- `schema`: `public`
- `applicationName`: `varlens-main`
- `sslMode`: `disable`
- `connectionTimeoutMillis`: `5000`
- `statementTimeoutMs`: `30000`
- `queryTimeoutMs`: `30000`
- `lockTimeoutMs`: `5000`
- `idleInTransactionSessionTimeoutMs`: `10000`
- `poolMax`: `4`

These values are intentionally conservative for a single-user desktop app. The exact numbers can still be revised during implementation if local verification shows a mismatch, but the design should require explicit, bounded settings.

### Parsing rules

- If `VARLENS_PG_URL` is absent or empty, return `null`.
- If present, return a fully normalized config object.
- Reject invalid `sslMode` values.
- Reject empty schema strings after trimming.
- Reject non-numeric or negative timeout values.
- Reject `poolMax < 1`.
- Keep parsing side-effect-free and testable.

Phase 2 should continue treating PostgreSQL config as opt-in rather than as the default app path.

## Pool option shaping

The session should not pass environment strings directly into `pg.Pool`.

Instead, `src/main/storage/config.ts` should expose a helper that converts `PostgresStorageConfig` into the exact `PoolConfig` shape used by `pg`.

The helper should:

- set `connectionString` from `config.url`,
- set `application_name` from `config.applicationName`,
- set `connectionTimeoutMillis`,
- set `statement_timeout`,
- set `query_timeout`,
- set `lock_timeout`,
- set `idle_in_transaction_session_timeout`,
- set `max` from `config.poolMax`,
- map `sslMode` deterministically into a `ssl` setting.

### SSL rule

Phase 2 should avoid ambiguous SSL behavior.

Recommended rule:

- treat `sslMode` as the single source of truth for pool SSL configuration,
- do not add support in this phase for mixing URL-level SSL parameters with a separate `ssl` object,
- document that URLs containing libpq-style SSL parameters are unsupported in Phase 2 if they conflict with VarLens-managed SSL configuration.

That avoids the `node-postgres` config collision where URL SSL fields can override or replace the supplied `ssl` object.

## Schema handling

The `schema` field belongs in config and workspace metadata in Phase 2, but it should **not** trigger automatic `search_path` mutation yet.

Reason:

- PostgreSQL treats schemas on `search_path` as trusted resolution targets,
- a session-level `search_path` policy is a real design decision,
- VarLens does not yet have PostgreSQL repositories that need this behavior.

Phase 2 rule:

- keep `schema` as validated metadata only,
- do not run `SET search_path`,
- do not use `Pool` connect hooks to modify session state,
- defer any `search_path` strategy to the first repository portability phase.

## Workspace identity and redaction

`WorkspaceRef` for PostgreSQL already exists:

```ts
{
  kind: 'postgres'
  connectionLabel: string
  connectionUrlRedacted: string
  schema: string
}
```

Phase 2 must define how those fields are populated.

### Redaction rules

The raw URL must never be surfaced in workspace metadata, logs, health output, or IPC payloads.

Recommended redaction behavior:

- preserve protocol, host, port, and database name,
- strip username and password from the visible URL,
- if no database name is present, still return a syntactically meaningful redacted target.

Example:

```text
postgres://varlens:secret@127.0.0.1:55432/varlens_dev
```

becomes:

```text
postgres://127.0.0.1:55432/varlens_dev
```

`connectionLabel` should be human-oriented and stable enough for UI and logs later. In Phase 2 it can be derived from host, port, database, and schema.

Example:

```text
127.0.0.1:55432/varlens_dev (public)
```

## Capabilities design

Phase 2 should explicitly report PostgreSQL capabilities rather than guessing from future goals.

Recommended initial PostgreSQL capabilities:

```ts
{
  backend: 'postgres',
  supportsEncryptionAtRest: false,
  supportsLocalFileLifecycle: false,
  supportsHostedConnectionLifecycle: true,
  supportsWorkerReadPool: false,
  supportsFullTextSearch: false
}
```

Rationale:

- `supportsEncryptionAtRest`: VarLens does not control PostgreSQL at-rest encryption in this phase, so claiming `true` would be misleading.
- `supportsLocalFileLifecycle`: false by definition.
- `supportsHostedConnectionLifecycle`: true is the main point of the backend.
- `supportsWorkerReadPool`: false until a PostgreSQL executor strategy actually exists.
- `supportsFullTextSearch`: PostgreSQL can support FTS in general, but VarLens does not implement it yet, so Phase 2 should report actual app capability, not theoretical database capability.

This keeps capability reporting operationally honest.

## `PostgresStorageSession` contract behavior

`PostgresStorageSession` should satisfy the existing `StorageSession` interface, but some methods are compatibility-only and therefore intentionally unsupported for PostgreSQL in Phase 2.

### Supported methods

- `workspace`
- `capabilities`
- `health()`
- `close()`

### Compatibility methods

- `getDatabaseService()`
- `getDbPool()`
- `getEncryptionKey()`
- `needsStartupRebuild()`
- `rekey(newPassword: string)`

For Phase 2, SQLite-only methods should fail explicitly and predictably for PostgreSQL rather than returning fake SQLite-shaped values.

Recommended rule:

- methods that only make sense for SQLite should throw a descriptive error such as:
  - `DatabaseService is not available for postgres sessions`
  - `DbPool is not available for postgres sessions`
  - `SQLite rekey is not supported for postgres sessions`

That is preferable to inventing null-like fallback behavior that would hide incorrect call paths.

## Health-check design

`health()` should run a minimal round-trip query through the PostgreSQL pool.

Recommended query:

```sql
SELECT 1
```

Recommended behavior:

- use `pool.query('SELECT 1')` directly rather than a checked-out client,
- measure round-trip latency around the call,
- return a structured failure payload rather than throwing.

Return:

```ts
{
  ok: true,
  backend: 'postgres',
  roundTripMs: ...
}
```

or on failure:

```ts
{
  ok: false,
  backend: 'postgres',
  message: ...,
  roundTripMs: ...
}
```

## Lifecycle design

### Pool lifecycle

The pool should be long-lived and session-owned.

Phase 2 rules:

- `PostgresStorageSession` constructs or receives a single `Pool`,
- the session registers an `error` handler for background idle-client failures,
- `close()` calls `pool.end()`,
- `health()` and any future single-query session checks use `pool.query(...)`,
- transaction behavior remains out of scope for this phase.

### `DatabaseManager`

Do **not** turn `DatabaseManager` into a generic multi-backend switcher yet.

Instead:

- keep existing SQLite open/create/switch behavior as-is,
- allow other code to construct and inspect a `PostgresStorageSession` directly in tests and targeted lifecycle utilities,
- only add manager-level PostgreSQL methods if needed by the agreed verification path.

This avoids over-designing a multi-backend orchestration API before the first real vertical slice exists.

### IPC

Any IPC changes should be additive and low-risk.

Good Phase 2 changes:

- expose backend kind in already-existing metadata flows if it can be done additively,
- expose redacted workspace information if needed for diagnostics,
- keep existing SQLite flows unchanged.

Bad Phase 2 changes:

- switching the renderer to backend-aware behavior,
- adding a backend selector,
- adding Postgres CRUD handlers for repositories that do not exist yet.

## Testing strategy

Phase 2 should stay mostly unit-level.

Required coverage:

- config parsing defaults
- config parsing validation failures
- numeric timeout validation
- `poolMax` validation
- redacted URL generation
- label generation
- pool option shaping from normalized config
- capability reporting
- unsupported SQLite-only compatibility methods
- successful `health()` result
- failed `health()` result
- `close()` calling `pool.end()`
- pool `error` listener registration behavior

Optional integration coverage:

- a local Docker-backed smoke test can be added later if the implementation work reveals value, but it is not required to make Phase 2 honest.

## Verification gate

Minimum verification before Phase 2 is called done:

- focused Vitest coverage for config and PostgreSQL session tests
- any touched storage-manager or database lifecycle tests
- `make ci`

`make ci-full` is optional for Phase 2 unless lifecycle integration expands into Electron startup or packaging behavior.

## Risks and mitigations

### Risk: accidental overreach into repository portability

Mitigation:

- keep repository interfaces and implementations out of scope,
- do not modify `BaseRepository`,
- do not wire PostgreSQL into case/variant handlers yet.

### Risk: leaking credentials through workspace metadata or logs

Mitigation:

- centralize URL redaction,
- never expose raw `VARLENS_PG_URL`,
- test redaction directly.

### Risk: silent pool misconfiguration

Mitigation:

- normalize config before pool creation,
- validate numeric bounds,
- test pool option shaping explicitly,
- use explicit timeout defaults instead of inheriting driver defaults invisibly.

### Risk: future schema behavior becoming inconsistent

Mitigation:

- keep `schema` as metadata only in Phase 2,
- defer `search_path` policy until a repository phase that can justify it end-to-end.

## Phase 2 exit criteria

Phase 2 is complete when:

- VarLens has a real `PostgresStorageSession` backed by `pg.Pool`,
- PostgreSQL session config is normalized and validated from environment input,
- workspace metadata is redacted and stable,
- capability reporting is explicit and honest,
- `health()` reports PostgreSQL readiness without throwing,
- pool lifecycle is explicit and test-covered,
- no repository portability claims have been introduced.

## Sources

- `pg` Pool API: <https://node-postgres.com/apis/pool>
- `pg` Client config and timeout fields: <https://node-postgres.com/apis/client>
- `pg` pooling guidance: <https://node-postgres.com/features/pooling>
- `pg` transactions guidance: <https://node-postgres.com/features/transactions>
- `pg` SSL behavior: <https://node-postgres.com/features/ssl>
- PostgreSQL libpq connection params: <https://www.postgresql.org/docs/current/libpq-connect.html>
- PostgreSQL client timeout settings: <https://www.postgresql.org/docs/18/runtime-config-client.html>
- PostgreSQL schema and `search_path` behavior: <https://www.postgresql.org/docs/18/ddl-schemas.html>
