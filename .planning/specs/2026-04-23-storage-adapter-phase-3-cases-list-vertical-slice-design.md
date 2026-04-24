# Storage Session Boundary Phase 3: `cases:list` Vertical Slice

**Date:** 2026-04-23  
**Status:** Proposed Phase 3 spec  
**Depends on:** [`2026-04-23-storage-adapter-boundary-design.md`](./2026-04-23-storage-adapter-boundary-design.md)  
**Previous phases:** Phase 1 and Phase 2 complete and archived  
**Recommendation:** Use `cases:list` as the first dual-backend vertical slice

## Summary

Phase 3 should migrate `cases:list` end-to-end across SQLite and PostgreSQL.

This is the best first vertical slice because it is:

- the first option that is meaningfully user-visible
- still narrow enough to keep SQLite stable
- already a real IPC seam in the current app
- testable on this workstation with the current local PostgreSQL development flow
- a more honest signal of whether the `StorageSession` boundary can carry backend-specific behavior than `database:info` or `database:overview`

Phase 3 should **not** attempt broad repository portability. It should instead add the first backend-neutral read capability at the session boundary, implement it separately for SQLite and PostgreSQL, and keep the renderer-facing IPC contract stable.

## Why this slice

The active architecture doc leaves three plausible first slices:

1. `database:info`
2. `database:overview`
3. `cases:list`

### Option review

#### `database:info`

Pros:

- lowest implementation risk
- mostly lifecycle/session metadata
- little SQL portability pressure

Cons:

- too thin for the current goal
- mostly proves config and session wiring, not a usable backend path
- likely produces another scaffold phase rather than the first credible migration slice

Conclusion:

- useful compatibility work may still happen around session metadata
- not strong enough to justify being the primary Phase 3 slice

#### `database:overview`

Pros:

- exercises real query execution
- touches a mix of aggregates and summary reads
- could flush out backend-specific SQL assumptions early

Cons:

- less representative of everyday app usage than case listing
- more likely to force aggregate-query divergence before the boundary pattern is proven
- lower immediate value than making the basic workspace case list work

Conclusion:

- a viable later slice after the first read-path boundary is proven
- not the best first candidate

#### `cases:list`

Pros:

- already powers real renderer behavior
- narrow, read-only, and easy to reason about
- exercises IPC, session dispatch, backend query code, and renderer consumption
- useful for internal dev validation immediately
- forces one honest backend-specific implementation without pretending the whole repository layer is portable

Cons:

- does require a small amount of PostgreSQL workspace usability work
- may pull in one or two compatibility updates outside the exact `cases:list` handler

Conclusion:

- best balance of user-visible value, scope control, and architectural signal
- recommended Phase 3 slice

## Design goals

1. Prove one real dual-backend read path through the active `StorageSession` boundary.
2. Keep SQLite behavior stable and default.
3. Avoid claiming broad repository portability.
4. Keep the renderer-facing `cases:list` IPC contract stable.
5. Make the PostgreSQL path testable end-to-end on this workstation.
6. Limit incidental compatibility work to what is needed to make the dev PostgreSQL session usable.

## Non-goals

- No migration of `cases:query` in Phase 3.
- No import, delete, export, or cohort-write migration.
- No worker/executor redesign.
- No renderer storage-switcher UI.
- No general-purpose cross-database repository abstraction.
- No attempt to make `DatabaseService` itself portable.
- No broad PostgreSQL schema or migration framework for the whole product.

## Current codebase anchors

The chosen slice is grounded in the existing code:

- [`src/main/ipc/handlers/cases.ts`](../../src/main/ipc/handlers/cases.ts) exposes `cases:list`.
- [`src/main/ipc/handlers/cases-logic.ts`](../../src/main/ipc/handlers/cases-logic.ts) already centralizes list/query logic and currently branches only on SQLite main-thread vs `DbPool`.
- [`src/main/storage/session.ts`](../../src/main/storage/session.ts) is the active session seam from Phases 1 and 2.
- [`src/main/storage/sqlite/SqliteStorageSession.ts`](../../src/main/storage/sqlite/SqliteStorageSession.ts) already owns SQLite-specific runtime access.
- [`src/main/storage/postgres/PostgresStorageSession.ts`](../../src/main/storage/postgres/PostgresStorageSession.ts) already owns the PostgreSQL pool and session metadata.
- [`src/main/services/DatabaseManager.ts`](../../src/main/services/DatabaseManager.ts) owns the active session but is still SQLite-oriented at lifecycle boundaries.
- [`src/renderer/src/stores/databaseStore.ts`](../../src/renderer/src/stores/databaseStore.ts) and renderer callers already consume `cases:list` without needing a new IPC contract.

That is enough structure to add one honest migrated read slice without redesigning the rest of storage.

## Proposed Phase 3 architecture

### 1. Make `cases:list` the first migrated session capability

Phase 1 introduced `StorageSession` as a lifecycle wrapper with SQLite compatibility methods. Phase 3 should evolve it by adding the first real backend-neutral read capability:

```ts
listCases(): Promise<Case[]>
```

This is intentionally narrow. It does **not** imply that all case operations or repositories are portable. It only means the session boundary now owns one real vertical slice.

Reasoning:

- adding one explicit slice method is more honest than adding a fake general repository adapter
- the implementation stays close to the current codebase
- the compatibility methods from Phase 1 can continue to exist while this first slice is proven

### 2. SQLite keeps its current behavior behind the new method

`SqliteStorageSession.listCases()` should preserve current behavior:

- use `DbPool` when available
- otherwise read through the wrapped `DatabaseService`
- preserve current sort order and payload shape from `CaseRepository.getAllCases()`

This keeps SQLite stable while moving ownership of the slice into the session.

### 3. PostgreSQL gets a backend-specific case-list implementation

`PostgresStorageSession.listCases()` should query PostgreSQL directly through the owned `pg.Pool`.

Phase 3 should create a small PostgreSQL-specific read component for this slice only, for example:

- `src/main/storage/postgres/PostgresCaseListRepository.ts`

That repository should:

- query the PostgreSQL `cases` table
- return rows shaped exactly like the shared `Case` type
- sort by `created_at DESC` to match SQLite behavior
- keep SQL intentionally small and local to this slice

This is the first explicit proof that PostgreSQL support is a second implementation, not a driver swap under the SQLite repositories.

### 4. `cases:list` handler becomes session-backed

The `cases:list` handler path should stop reaching around the session boundary.

Near-term rule:

- `cases:list` resolves the active `StorageSession`
- it calls `session.listCases()`
- it no longer depends on raw `getDb()` / `getDbPool()` for this slice

`cases:query`, delete operations, and other case handlers remain unchanged in Phase 3.

### 5. Allow small compatibility work required for a usable PostgreSQL dev session

Although `cases:list` is the chosen slice, Phase 3 may include a limited amount of adjacent compatibility work where it is necessary to make the PostgreSQL path usable on this workstation.

Allowed examples:

- a dev-only session-open path for PostgreSQL
- startup/session selection via explicit environment configuration
- additive workspace metadata handling so the renderer does not break when the active session is not file-backed
- minimal bootstrap checks for the PostgreSQL `cases` table or development schema

Disallowed examples:

- broad migration of all `database:*` handlers
- full workspace-management UI for PostgreSQL
- broad renderer assumptions that both backends are already equivalent

### 6. Keep PostgreSQL access dev-focused and explicit

Phase 3 should remain an internal/dev milestone, not a user-facing backend switch.

Recommended activation rule:

- SQLite stays the default app path
- PostgreSQL requires explicit environment-backed activation in dev/test

One acceptable pattern is:

```text
VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres
```

with the existing PostgreSQL config env vars from Phase 2.

The important point is not the exact variable name. The important point is that:

- the PostgreSQL path is explicit
- it is opt-in
- it is testable locally
- it does not destabilize normal SQLite startup

### 7. Keep PostgreSQL schema scope intentionally small

Phase 3 should not pretend the full SQLite schema is now portable. It only needs enough PostgreSQL schema support to back `cases:list`.

That means Phase 3 should define and bootstrap only what the slice actually needs:

- `cases` table columns required by the shared `Case` type
- any minimal constraints needed for realistic data and deterministic tests

The phase may use a dedicated dev bootstrap SQL file or a narrow bootstrap helper, but it should not introduce a fake “full migration parity” story.

## Data contract for the slice

Phase 3 keeps the existing shared `Case` payload contract:

```ts
interface Case {
  id: number
  name: string
  file_path: string
  file_size: number
  variant_count: number
  created_at: number
  genome_build: string
}
```

The PostgreSQL implementation must return the same field names and value types as the SQLite path.

This is the compatibility line for the slice:

- same IPC channel
- same renderer contract
- backend-specific implementation behind it

## Testing strategy

Phase 3 should be test-driven and verifiable locally.

### Unit tests

- session-level tests for `SqliteStorageSession.listCases()`
- session-level tests for `PostgresStorageSession.listCases()`
- handler/logic tests proving `cases:list` resolves through the active session

### PostgreSQL integration tests

Run against the local Docker-backed PostgreSQL environment from earlier phases:

- bootstrap a minimal `cases` schema
- seed known rows
- verify exact payload shape and ordering

These tests should stay focused on the slice rather than trying to reuse all SQLite integration machinery.

### End-to-end/dev verification

At least one local verification path should prove:

1. app starts in explicit PostgreSQL dev mode
2. session becomes healthy
3. `window.api.cases.list()` returns expected rows
4. the main case list UI can render those rows without IPC or shape regressions

This is what makes the phase meaningful on the workstation rather than purely architectural.

## Risks and mitigations

### Risk: `StorageSession` turns into an unstructured bag of slice methods

Mitigation:

- add only one explicit migrated capability in Phase 3
- require each future slice to justify itself the same way
- avoid adding “generic repository” escape hatches

### Risk: PostgreSQL dev activation leaks into normal SQLite startup

Mitigation:

- keep PostgreSQL activation explicit and env-gated
- keep SQLite as the default startup path
- keep packaged/release behavior unchanged

### Risk: the slice silently depends on more renderer/database compatibility than planned

Mitigation:

- allow only additive compatibility work needed to keep the dev path usable
- keep `cases:list` as the only migrated read contract
- defer general `database:*` redesign

### Risk: the team starts generalizing repository portability from one successful slice

Mitigation:

- write Phase 3 to prove a pattern, not to declare portability solved
- require later slices to evaluate shared logic based on evidence

## Locked decisions

1. Phase 3 recommends `cases:list`, not `database:info` or `database:overview`, as the first dual-backend slice.
2. SQLite remains the stable default backend path.
3. PostgreSQL remains explicit, internal, and workstation-testable in this phase.
4. The renderer-facing `cases:list` IPC contract stays unchanged.
5. PostgreSQL implementation is backend-specific and local to the slice.
6. Small adjacent compatibility work is allowed only when required to make the dev slice usable.
7. Broad repository portability remains out of scope.

## Acceptance criteria

Phase 3 is successful when all of the following are true:

- `cases:list` resolves through the active `StorageSession`
- SQLite `cases:list` behavior is unchanged
- PostgreSQL has a real `cases:list` implementation returning the shared `Case` payload
- local PostgreSQL dev mode can be activated explicitly on this workstation
- tests cover both backends for the slice
- the implementation does not claim that other domains are portable yet

## Relationship to the implementation plan

The corresponding implementation plan should:

- keep the work split into small vertical tasks
- maximize safe parallelism where file ownership is disjoint
- avoid worktrees
- preserve `make ci` as the minimum completion gate
- treat PostgreSQL dev verification as a required deliverable, not optional polish
