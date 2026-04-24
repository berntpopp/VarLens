# Storage Session Boundary Phase 3: `cases:list` Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first real dual-backend storage slice by making `cases:list` run through `StorageSession` for both SQLite and PostgreSQL while keeping SQLite stable and making PostgreSQL testable on this workstation.

**Architecture:** Extend `StorageSession` with one explicit migrated read capability, implement that capability separately in `SqliteStorageSession` and `PostgresStorageSession`, and route the existing `cases:list` IPC handler through the active session. Keep renderer IPC stable, keep PostgreSQL activation explicit and dev-only, and allow only the minimum adjacent compatibility work needed to make the PostgreSQL path usable.

**Tech Stack:** Electron 40, TypeScript 6, Vue 3, Pinia, `better-sqlite3-multiple-ciphers`, `pg`, Vitest, Playwright `_electron`, Docker PostgreSQL dev workflow, `make ci`

---

## File structure

### New files

- `src/main/storage/postgres/PostgresCaseListRepository.ts`
- `tests/main/storage/postgres-case-list-repository.test.ts`
- `tests/main/storage/storage-session-cases-list.test.ts`
- `tests/e2e/postgres-cases-list-dev-mode.e2e.ts`
- `scripts/postgres/init-db/10-phase3-cases.sql`
- `scripts/postgres/init-db/20-phase3-seed-cases.sql`

### Modified files

- `src/main/storage/session.ts`
- `src/main/storage/sqlite/SqliteStorageSession.ts`
- `src/main/storage/postgres/PostgresStorageSession.ts`
- `src/main/services/DatabaseManager.ts`
- `src/main/ipc/handlers/cases.ts`
- `src/main/ipc/handlers/cases-logic.ts`
- `src/main/index.ts`
- `src/renderer/src/stores/databaseStore.ts`
- `src/shared/ipc/domains/database.ts`
- `src/shared/types/api.ts`
- `tests/main/storage/sqlite-storage-session.test.ts`
- `tests/main/storage/postgres-storage-session.test.ts`
- `tests/main/handlers/cases-handlers.test.ts`

### Notes on ownership and parallelism

- Task 1 and Task 2 can run in parallel after the slice contract is agreed.
- Task 3 can run in parallel with Task 2 once the PostgreSQL repository file path is fixed.
- Task 4 depends on Tasks 1-3 landing.
- Task 5 depends on the activation path from Task 4.
- Task 6 is the final verification/documentation pass.

## Task 1: Add the session-level `cases:list` capability

**Files:**

- Modify: `src/main/storage/session.ts`
- Modify: `src/main/storage/sqlite/SqliteStorageSession.ts`
- Modify: `src/main/storage/postgres/PostgresStorageSession.ts`
- Test: `tests/main/storage/sqlite-storage-session.test.ts`
- Test: `tests/main/storage/postgres-storage-session.test.ts`
- Test: `tests/main/storage/storage-session-cases-list.test.ts`

- [ ] **Step 1: Write failing session-contract tests for `listCases()`**

Add tests that assert:

- SQLite sessions expose `listCases()` and preserve current ordering
- PostgreSQL sessions expose `listCases()` and delegate to PostgreSQL query code
- the method returns the shared `Case[]` shape

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/sqlite-storage-session.test.ts tests/main/storage/postgres-storage-session.test.ts tests/main/storage/storage-session-cases-list.test.ts
```

Expected:

- FAIL because `StorageSession` does not yet define `listCases()`

- [ ] **Step 2: Extend `StorageSession` with the first migrated read slice**

Update `src/main/storage/session.ts` to add:

```ts
import type { Case } from '../../shared/types/database'

export interface StorageSession {
  readonly workspace: WorkspaceRef
  readonly capabilities: StorageCapabilities

  listCases(): Promise<Case[]>
  getDatabaseService(): DatabaseService
  getDbPool(): DbPool | null
  getEncryptionKey(): string | undefined
  needsStartupRebuild(): boolean
  rekey(newPassword: string): void
  close(): Promise<void>
  health(): Promise<StorageHealth>
}
```

- [ ] **Step 3: Implement SQLite `listCases()` with current behavior**

Update `src/main/storage/sqlite/SqliteStorageSession.ts` to add:

```ts
import type { Case } from '../../../shared/types/database'

async listCases(): Promise<Case[]> {
  if (this.dbPool !== null) {
    return (await this.dbPool.run({ type: 'cases:list', params: [] })) as Case[]
  }

  return this.databaseService.cases.getAllCases()
}
```

- [ ] **Step 4: Implement PostgreSQL session delegation**

Update `src/main/storage/postgres/PostgresStorageSession.ts` so the session owns a case-list repository and exposes:

```ts
import type { Case } from '../../../shared/types/database'
import { PostgresCaseListRepository } from './PostgresCaseListRepository'

private readonly cases: PostgresCaseListRepository

constructor(options: PostgresStorageSessionOptions) {
  this.pool = options.pool
  this.cases = new PostgresCaseListRepository(options.pool, options.config.schema)
  // existing workspace setup follows
}

async listCases(): Promise<Case[]> {
  return await this.cases.listCases()
}
```

- [ ] **Step 5: Run the storage-session test set**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/sqlite-storage-session.test.ts tests/main/storage/postgres-storage-session.test.ts tests/main/storage/storage-session-cases-list.test.ts
```

Expected:

- PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/storage/session.ts src/main/storage/sqlite/SqliteStorageSession.ts src/main/storage/postgres/PostgresStorageSession.ts tests/main/storage/sqlite-storage-session.test.ts tests/main/storage/postgres-storage-session.test.ts tests/main/storage/storage-session-cases-list.test.ts
git commit -m "feat(storage): add session-level cases list capability"
```

## Task 2: Route `cases:list` through the active session

**Files:**

- Modify: `src/main/ipc/handlers/cases.ts`
- Modify: `src/main/ipc/handlers/cases-logic.ts`
- Test: `tests/main/handlers/cases-handlers.test.ts`

- [ ] **Step 1: Write failing handler tests for session-backed `cases:list`**

Add tests that assert:

- `cases:list` resolves through `getDbManager().getCurrentSession().listCases()`
- the SQLite fallback still behaves the same through the new path
- `cases:query` remains unchanged

Run:

```bash
make rebuild-node && npx vitest run tests/main/handlers/cases-handlers.test.ts
```

Expected:

- FAIL because `cases:list` still depends on raw `getDb()` / `getDbPool()`

- [ ] **Step 2: Update cases logic to accept a session**

Refactor `src/main/ipc/handlers/cases-logic.ts` so `listCases` becomes:

```ts
import type { StorageSession } from '../../storage/session'

export async function listCases(getSession: () => StorageSession): Promise<unknown> {
  const session = getSession()
  return await session.listCases()
}
```

Keep `queryCases`, `deleteSingleCase`, `deleteAllCases`, and `deleteBatchCases` unchanged in this task.

- [ ] **Step 3: Update the `cases:list` handler only**

Change `src/main/ipc/handlers/cases.ts`:

```ts
export function registerCaseHandlers({
  ipcMain,
  getDb,
  getDbPool,
  getDbManager
}: HandlerDependencies): void {
  ipcMain.handle('cases:list', async () => {
    return wrapHandler(() => listCases(() => getDbManager().getCurrentSession()))
  })

  // leave other handlers as-is
}
```

- [ ] **Step 4: Run the handler tests**

Run:

```bash
make rebuild-node && npx vitest run tests/main/handlers/cases-handlers.test.ts
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/handlers/cases.ts src/main/ipc/handlers/cases-logic.ts tests/main/handlers/cases-handlers.test.ts
git commit -m "refactor(cases): route cases list through storage session"
```

## Task 3: Add the PostgreSQL `cases:list` repository and schema bootstrap

**Files:**

- Create: `src/main/storage/postgres/PostgresCaseListRepository.ts`
- Create: `tests/main/storage/postgres-case-list-repository.test.ts`
- Create: `scripts/postgres/init-db/10-phase3-cases.sql`
- Create: `scripts/postgres/init-db/20-phase3-seed-cases.sql`

- [ ] **Step 1: Write a failing PostgreSQL repository test**

The test should seed rows and assert:

- `listCases()` returns rows sorted by `created_at DESC`
- each row matches the shared `Case` field names exactly

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/postgres-case-list-repository.test.ts
```

Expected:

- FAIL because `PostgresCaseListRepository` does not exist

- [ ] **Step 2: Add minimal PostgreSQL schema bootstrap for the slice**

Create `scripts/postgres/init-db/10-phase3-cases.sql`:

```sql
CREATE TABLE IF NOT EXISTS cases (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  variant_count BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  genome_build TEXT NOT NULL DEFAULT 'GRCh38'
);
```

Create `scripts/postgres/init-db/20-phase3-seed-cases.sql` with 2-3 deterministic rows for local verification.

- [ ] **Step 3: Implement the repository**

Create `src/main/storage/postgres/PostgresCaseListRepository.ts`:

```ts
import type { Pool } from 'pg'
import type { Case } from '../../../shared/types/database'

export class PostgresCaseListRepository {
  constructor(
    private readonly pool: Pool,
    private readonly schema: string
  ) {}

  async listCases(): Promise<Case[]> {
    const query = `
      SELECT
        id::bigint AS id,
        name,
        file_path,
        file_size::bigint AS file_size,
        variant_count::bigint AS variant_count,
        created_at::bigint AS created_at,
        genome_build
      FROM ${this.schema}.cases
      ORDER BY created_at DESC
    `

    const result = await this.pool.query(query)
    return result.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      file_path: row.file_path,
      file_size: Number(row.file_size),
      variant_count: Number(row.variant_count),
      created_at: Number(row.created_at),
      genome_build: row.genome_build
    }))
  }
}
```

Then replace string interpolation with a schema-safe helper before merging. The engineer implementing this task must not leave raw schema interpolation in the final code.

- [ ] **Step 4: Run the PostgreSQL repository test**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/postgres-case-list-repository.test.ts
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/postgres/PostgresCaseListRepository.ts tests/main/storage/postgres-case-list-repository.test.ts scripts/postgres/init-db/10-phase3-cases.sql scripts/postgres/init-db/20-phase3-seed-cases.sql
git commit -m "feat(storage): add postgres cases list repository"
```

## Task 4: Add explicit PostgreSQL dev activation and minimal session usability wiring

**Files:**

- Modify: `src/main/services/DatabaseManager.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/stores/databaseStore.ts`
- Modify: `src/shared/ipc/domains/database.ts`
- Modify: `src/shared/types/api.ts`
- Test: `tests/main/storage/storage-manager-compat.test.ts`

- [ ] **Step 1: Write failing tests for PostgreSQL session activation**

Add tests that assert:

- `DatabaseManager` can hold a PostgreSQL current session
- startup code can choose PostgreSQL explicitly via environment configuration
- renderer database info handling remains safe when the active session is not file-backed

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/storage-manager-compat.test.ts
```

Expected:

- FAIL because `DatabaseManager` only exposes SQLite lifecycle entry points

- [ ] **Step 2: Add an explicit PostgreSQL session-open path**

Extend `DatabaseManager` with a narrow method:

```ts
async openPostgres(session: StorageSession): Promise<void> {
  await this.close()
  this.currentSession = session
}
```

Do not add broad backend-switching UI or file-lifecycle semantics in this task.

- [ ] **Step 3: Add startup activation in `src/main/index.ts`**

Introduce an explicit environment gate such as:

```ts
const experimentalBackend = process.env.VARLENS_EXPERIMENTAL_STORAGE_BACKEND
if (experimentalBackend === 'postgres') {
  // build config, pool, PostgresStorageSession, manager.openPostgres(...)
}
```

Requirements:

- SQLite remains the default path
- PostgreSQL startup is explicit and opt-in
- startup failure logs a structured error and does not silently mutate SQLite behavior

- [ ] **Step 4: Make renderer info handling additive and safe**

If `database:info` remains SQLite-only, update `databaseStore.fetchInfo()` so a `null` response clears stale file-backed state instead of leaving the previous SQLite path visible:

```ts
if (info) {
  currentPath.value = info.path
  currentName.value = info.name
  isEncrypted.value = info.encrypted
} else {
  currentPath.value = null
  currentName.value = ''
  isEncrypted.value = false
}
```

Do not turn this task into a general backend UI redesign.

- [ ] **Step 5: Run the activation and compatibility tests**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/storage-manager-compat.test.ts tests/main/storage/postgres-storage-session.test.ts
```

Expected:

- PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/services/DatabaseManager.ts src/main/index.ts src/renderer/src/stores/databaseStore.ts src/shared/ipc/domains/database.ts src/shared/types/api.ts tests/main/storage/storage-manager-compat.test.ts tests/main/storage/postgres-storage-session.test.ts
git commit -m "feat(storage): add explicit postgres dev session activation"
```

## Task 5: Prove the slice end-to-end in app and local PostgreSQL

**Files:**

- Create: `tests/e2e/postgres-cases-list-dev-mode.e2e.ts`
- Modify: any shared E2E helper needed for env injection

- [ ] **Step 1: Write the failing E2E smoke test**

The test should:

1. start the app with `VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres`
2. point it at the local PostgreSQL dev database
3. call `window.api.cases.list()`
4. assert the returned rows match the seeded PostgreSQL rows

Run:

```bash
make build && npx playwright test tests/e2e/postgres-cases-list-dev-mode.e2e.ts
```

Expected:

- FAIL until the startup activation and repository path are wired

- [ ] **Step 2: Implement any minimal E2E helper changes**

Keep changes narrow:

- env injection for the Electron process
- optional readiness wait for PostgreSQL dev mode

- [ ] **Step 3: Run the targeted E2E**

Run:

```bash
make build && npx playwright test tests/e2e/postgres-cases-list-dev-mode.e2e.ts
```

Expected:

- PASS

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/postgres-cases-list-dev-mode.e2e.ts tests/e2e/helpers
git commit -m "test(e2e): verify postgres cases list dev mode"
```

## Task 6: Final verification and closeout

**Files:**

- Modify: `.planning/specs/2026-04-23-storage-adapter-phase-3-cases-list-vertical-slice-design.md` if implementation reality requires a tiny clarification
- Modify: `.planning/plans/2026-04-23-storage-adapter-phase-3-cases-list-vertical-slice-plan.md` only if task tracking notes need correction

- [ ] **Step 1: Start local PostgreSQL and seed the Phase 3 slice**

Run:

```bash
make pg-up
make pg-reset
```

Expected:

- PostgreSQL container is healthy
- Phase 3 seed rows are present

- [ ] **Step 2: Run focused verification**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/sqlite-storage-session.test.ts tests/main/storage/postgres-storage-session.test.ts tests/main/storage/postgres-case-list-repository.test.ts tests/main/storage/storage-session-cases-list.test.ts tests/main/handlers/cases-handlers.test.ts
make build && npx playwright test tests/e2e/postgres-cases-list-dev-mode.e2e.ts
```

Expected:

- all targeted tests PASS

- [ ] **Step 3: Run the required repo gate**

Run:

```bash
make ci
```

Expected:

- PASS

- [ ] **Step 4: Commit final verification note**

```bash
git add .planning/specs/2026-04-23-storage-adapter-phase-3-cases-list-vertical-slice-design.md .planning/plans/2026-04-23-storage-adapter-phase-3-cases-list-vertical-slice-plan.md
git commit --allow-empty -m "test(storage): verify phase 3 cases list vertical slice"
```

## Parallel execution recommendation

Use this wave order for maximum safe parallelism without worktrees:

1. Wave 1:
   - Task 1: session capability
   - Task 3: PostgreSQL repository + schema bootstrap
2. Wave 2:
   - Task 2: handler migration
   - Task 4: dev activation + compatibility wiring
3. Wave 3:
   - Task 5: E2E proof
4. Wave 4:
   - Task 6: full verification

Keep write ownership disjoint:

- Worker A owns `src/main/storage/session.ts`, `src/main/storage/sqlite/**`, related storage tests
- Worker B owns `src/main/storage/postgres/**`, PostgreSQL repository tests, bootstrap SQL
- Worker C owns `src/main/ipc/handlers/cases*`, related handler tests
- Worker D owns startup activation, renderer compatibility state, and E2E helper/test files

## Spec coverage check

- Chosen vertical slice: covered by Tasks 1-5
- SQLite stability: covered by Tasks 1, 2, and 6
- PostgreSQL workstation testability: covered by Tasks 3, 4, 5, and 6
- No broad repository portability: enforced by limiting repository work to `PostgresCaseListRepository`
- No worktrees: enforced by the wave and ownership guidance above

## Placeholder scan

- No `TBD`
- No hidden “implement later” steps
- All verification commands are explicit

## Type consistency check

- The plan consistently uses `StorageSession.listCases(): Promise<Case[]>`
- The renderer-facing IPC contract remains `cases:list`
- PostgreSQL remains explicit dev activation, not the default runtime path
