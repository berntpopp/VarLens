# Storage Session Boundary — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a backend-neutral `StorageSession` / `StorageManager` seam above the existing SQLite runtime, preserve current behavior, and add a local PostgreSQL Docker workflow for development without attempting premature repository portability.

**Architecture:** Phase 1 does **not** add a low-level adapter under `DatabaseService`. Instead, it wraps the existing SQLite runtime (`DatabaseService` + `DbPool`) in a `SqliteStorageSession`, then updates lifecycle management to depend on that session boundary. PostgreSQL remains non-runtime in Phase 1, but the repo gains the development infrastructure and configuration shape needed to start implementing a hosted backend in Phase 2.

**Tech Stack:** Electron 40, TypeScript 6 (strict), better-sqlite3-multiple-ciphers, Kysely, Piscina, PostgreSQL 18 (Docker), Vitest, Make.

**Why this plan replaces the prior draft:** The previous plan cut the abstraction seam below the current SQLite runtime and attempted to make `DatabaseService` hold a second SQLite adapter connection. That conflicts with the actual codebase shape in `src/main/services/DatabaseManager.ts`, `src/main/database/DatabaseService.ts`, `src/main/database/BaseRepository.ts`, and the SQLite-specific worker architecture under `src/main/workers/`. This rewritten plan moves the seam to the layer the codebase can actually support safely.

**Non-goals for Phase 1:**
- No repository migration to PostgreSQL.
- No shared cross-engine SQL abstraction for repository internals.
- No renderer-facing storage switcher UI yet.
- No replacement of SQLite workers with a PostgreSQL worker model yet.
- No user-visible behavior change for the default local SQLite workflow.

**Phase position:** 1 of 5.
- **Phase 1 (this plan):** `StorageSession` scaffold + `SqliteStorageSession` wrapper + manager/lifecycle refactor + local PostgreSQL Docker workflow.
- Phase 2: `PostgresStorageSession` scaffold + config loading + connection health/info + capabilities.
- Phase 3: first vertical slice on both backends (`database:info`, `database:overview`, `cases:list` or equivalent).
- Phase 4: backend-specific read/write executor redesign and worker strategy.
- Phase 5: domain-by-domain migration, cross-backend CI, and renderer storage settings.

---

## File Structure

**Created:**
- `src/main/storage/types.ts` — shared storage metadata and capability types.
- `src/main/storage/session.ts` — `StorageSession` interface and compatibility-facing session surface.
- `src/main/storage/manager.ts` — `StorageManager` interface used by lifecycle code.
- `src/main/storage/sqlite/SqliteStorageSession.ts` — wrapper over the current `DatabaseService` + optional `DbPool`.
- `src/main/storage/config.ts` — storage configuration parsing helpers for future backend selection.
- `docker-compose.postgres.yml` — local PostgreSQL development service bound to localhost only.
- `.env.postgres.example` — example local PostgreSQL environment variables.
- `.planning/docs/storage-session-boundary-notes.md` — short rationale / migration notes for later phases.
- `tests/main/storage/sqlite-storage-session.test.ts` — unit tests for the wrapper/session behavior.
- `tests/main/storage/storage-manager-compat.test.ts` — lifecycle compatibility tests.

**Modified:**
- `src/main/services/DatabaseManager.ts` — owns `StorageSession` instead of raw `DatabaseService`, while preserving compatibility getters.
- `src/main/database/index.ts` — initializes and exports the new manager/session-aware lifecycle shape without breaking current imports.
- `src/main/ipc/handlers/database-logic.ts` — depends on session-backed lifecycle metadata rather than assuming direct `DatabaseService` ownership.
- `src/shared/ipc/domains/database.ts` — additive storage metadata if needed, without breaking existing renderer callers.
- `src/preload/domains/database.ts` — only if the shared contract changes additively.
- `Makefile` — add `pg-up`, `pg-down`, `pg-logs`, `pg-psql`, `pg-reset`.

**Not touched in Phase 1:**
- Repository implementations under `src/main/database/`.
- `src/main/database/BaseRepository.ts` execution model.
- SQLite migrations and FTS internals.
- import/export/delete workers beyond keeping compatibility intact.
- renderer settings UI.

---

### Task 1: Add storage session contracts above the current runtime

**Files:**
- Create: `src/main/storage/types.ts`
- Create: `src/main/storage/session.ts`
- Create: `src/main/storage/manager.ts`

- [ ] **Step 1: Define the shared types in `src/main/storage/types.ts`**

```ts
// src/main/storage/types.ts
export type StorageBackendKind = 'sqlite' | 'postgres'

export interface StorageCapabilities {
  readonly backend: StorageBackendKind
  readonly supportsEncryptionAtRest: boolean
  readonly supportsLocalFileLifecycle: boolean
  readonly supportsHostedConnectionLifecycle: boolean
  readonly supportsWorkerReadPool: boolean
  readonly supportsFullTextSearch: boolean
}

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

export interface StorageHealth {
  ok: boolean
  backend: StorageBackendKind
  message?: string
  roundTripMs?: number
}
```

- [ ] **Step 2: Define the session interface in `src/main/storage/session.ts`**

```ts
// src/main/storage/session.ts
import type { DatabaseService } from '../database/DatabaseService'
import type { DbPool } from '../database/DbPool'
import type { StorageCapabilities, StorageHealth, WorkspaceRef } from './types'

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

- [ ] **Step 3: Define the manager interface in `src/main/storage/manager.ts`**

```ts
// src/main/storage/manager.ts
import type { StorageSession } from './session'

export interface StorageManager {
  openSqlite(path: string, key?: string): Promise<void>
  createSqlite(path: string, key?: string): Promise<void>
  switchToSqlite(path: string, key?: string): Promise<void>
  detectSqliteEncryption(path: string): { needsPassword: boolean }
  getCurrent(): StorageSession
  getCurrentPath(): string | null
  close(): Promise<void>
}
```

- [ ] **Step 4: Run typecheck**

Run: `make typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/types.ts src/main/storage/session.ts src/main/storage/manager.ts
git commit -m "feat(storage): add storage session and manager contracts"
```

---

### Task 2: Implement `SqliteStorageSession` as a wrapper over the current runtime

**Files:**
- Create: `src/main/storage/sqlite/SqliteStorageSession.ts`
- Test: `tests/main/storage/sqlite-storage-session.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/storage/sqlite-storage-session.test.ts
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { SqliteStorageSession } from '../../../src/main/storage/sqlite/SqliteStorageSession'

let tempDir: string | null = null

afterEach(() => {
  if (tempDir !== null) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('SqliteStorageSession', () => {
  it('exposes sqlite workspace metadata and compatibility getters', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'varlens-storage-session-'))
    const dbPath = join(tempDir, 'session.db')
    const db = new DatabaseService(dbPath)

    const session = new SqliteStorageSession({
      databaseService: db,
      dbPool: null
    })

    expect(session.workspace.kind).toBe('sqlite')
    expect(session.workspace.path).toBe(dbPath)
    expect(session.getDatabaseService()).toBe(db)
    expect(session.getDbPool()).toBeNull()
    expect(session.capabilities.backend).toBe('sqlite')
    expect(session.capabilities.supportsLocalFileLifecycle).toBe(true)

    await session.close()
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `make rebuild-node && npx vitest run tests/main/storage/sqlite-storage-session.test.ts`
Expected: FAIL because `SqliteStorageSession` does not exist.

- [ ] **Step 3: Implement `SqliteStorageSession`**

```ts
// src/main/storage/sqlite/SqliteStorageSession.ts
import type { DatabaseService } from '../../database/DatabaseService'
import type { DbPool } from '../../database/DbPool'
import type { StorageSession } from '../session'
import type { StorageCapabilities, StorageHealth, WorkspaceRef } from '../types'

interface SqliteStorageSessionOptions {
  databaseService: DatabaseService
  dbPool: DbPool | null
}

const SQLITE_CAPABILITIES: StorageCapabilities = {
  backend: 'sqlite',
  supportsEncryptionAtRest: true,
  supportsLocalFileLifecycle: true,
  supportsHostedConnectionLifecycle: false,
  supportsWorkerReadPool: true,
  supportsFullTextSearch: true
}

export class SqliteStorageSession implements StorageSession {
  readonly capabilities = SQLITE_CAPABILITIES
  readonly workspace: WorkspaceRef

  private readonly databaseService: DatabaseService
  private readonly dbPool: DbPool | null

  constructor(options: SqliteStorageSessionOptions) {
    this.databaseService = options.databaseService
    this.dbPool = options.dbPool
    this.workspace = {
      kind: 'sqlite',
      path: this.databaseService.getPath(),
      name: this.databaseService.getPath().split(/[\\/]/).pop() ?? 'varlens.db',
      encrypted: this.databaseService.isEncrypted()
    }
  }

  getDatabaseService(): DatabaseService {
    return this.databaseService
  }

  getDbPool(): DbPool | null {
    return this.dbPool
  }

  getEncryptionKey(): string | undefined {
    return this.databaseService.getEncryptionKey()
  }

  needsStartupRebuild(): boolean {
    return this.databaseService.needsStartupRebuild()
  }

  rekey(newPassword: string): void {
    this.databaseService.rekey(newPassword)
  }

  async health(): Promise<StorageHealth> {
    const startedAt = Date.now()
    this.databaseService.database.prepare('SELECT 1').get()
    return {
      ok: true,
      backend: 'sqlite',
      roundTripMs: Date.now() - startedAt
    }
  }

  async close(): Promise<void> {
    if (this.dbPool !== null) {
      await this.dbPool.destroy()
    }
    this.databaseService.close()
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `make rebuild-node && npx vitest run tests/main/storage/sqlite-storage-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/sqlite/SqliteStorageSession.ts tests/main/storage/sqlite-storage-session.test.ts
git commit -m "feat(storage): add sqlite storage session wrapper"
```

---

### Task 3: Refactor `DatabaseManager` to own sessions while preserving compatibility

**Files:**
- Modify: `src/main/services/DatabaseManager.ts`
- Test: `tests/main/storage/storage-manager-compat.test.ts`

- [ ] **Step 1: Write the failing compatibility test**

```ts
// tests/main/storage/storage-manager-compat.test.ts
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DatabaseManager } from '../../../src/main/services/DatabaseManager'
import { RecentDatabasesService } from '../../../src/main/services/RecentDatabasesService'

let tempDir: string | null = null

afterEach(() => {
  if (tempDir !== null) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('DatabaseManager storage-session compatibility', () => {
  it('still exposes the current DatabaseService through getCurrent()', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'varlens-storage-manager-'))
    const settingsPath = join(tempDir, 'settings.json')
    const dbPath = join(tempDir, 'test.db')
    const manager = new DatabaseManager(new RecentDatabasesService(settingsPath))

    await manager.open(dbPath)

    const current = manager.getCurrent()
    expect(current.getPath()).toBe(dbPath)

    await manager.close()
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `make rebuild-node && npx vitest run tests/main/storage/storage-manager-compat.test.ts`
Expected: FAIL because the manager methods are still synchronous and session-backed lifecycle does not exist.

- [ ] **Step 3: Refactor `DatabaseManager`**

Implementation requirements:
- Replace the internal `currentDb` field with `currentSession: StorageSession | null`.
- Preserve `getCurrent(): DatabaseService` as a compatibility shim by delegating to `currentSession.getDatabaseService()`.
- Preserve `getCurrentPath()` for SQLite by reading from `currentSession.workspace.kind === 'sqlite'`.
- Convert `open`, `createDatabase`, `switchDatabase`, and `close` to async methods because session close can await `DbPool.destroy()`.
- Keep existing recent-database behavior and SQLCipher password detection.
- Build `SqliteStorageSession` after creating the current `DatabaseService`.

- [ ] **Step 4: Run the compatibility test**

Run: `make rebuild-node && npx vitest run tests/main/storage/storage-manager-compat.test.ts`
Expected: PASS.

- [ ] **Step 5: Run existing manager tests**

Run: `make rebuild-node && npx vitest run tests/main/services/DatabaseManager.test.ts`
Expected: PASS after updating sync call sites in the tests to `await`.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/DatabaseManager.ts tests/main/storage/storage-manager-compat.test.ts tests/main/services/DatabaseManager.test.ts
git commit -m "refactor(storage): make DatabaseManager session-backed with DatabaseService compatibility"
```

---

### Task 4: Update lifecycle entry points to use the session-backed manager

**Files:**
- Modify: `src/main/database/index.ts`
- Modify: `src/main/ipc/handlers/database-logic.ts`
- Modify: `src/main/ipc/handlers/database.ts`
- Test: `tests/main/handlers/database-logic.test.ts`

- [ ] **Step 1: Update lifecycle call sites**

Required changes:
- `initDatabaseManager()` and `initDatabaseManagerSafe()` in `src/main/database/index.ts` must await the async manager methods.
- `database-logic.ts` must continue returning the same payload shape for `database:open`, `database:create`, and `database:info`.
- `triggerStartupRebuildIfNeeded` must receive `getDb()` from the session-backed compatibility getter and continue working unchanged.

- [ ] **Step 2: Run focused handler tests**

Run: `make rebuild-node && npx vitest run tests/main/handlers/database-logic.test.ts tests/main/handlers/cases-handlers.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/database/index.ts src/main/ipc/handlers/database-logic.ts src/main/ipc/handlers/database.ts tests/main/handlers/database-logic.test.ts tests/main/handlers/cases-handlers.test.ts
git commit -m "refactor(storage): route lifecycle code through session-backed manager"
```

---

### Task 5: Add storage config scaffolding for future backend selection

**Files:**
- Create: `src/main/storage/config.ts`
- Test: `tests/main/storage/config.test.ts`

- [ ] **Step 1: Add config parsing helpers**

```ts
// src/main/storage/config.ts
export interface PostgresDevConfig {
  url: string
  schema: string
}

export function getPostgresDevConfig(env: NodeJS.ProcessEnv = process.env): PostgresDevConfig | null {
  const url = env.VARLENS_PG_URL
  if (url === undefined || url === '') {
    return null
  }

  return {
    url,
    schema: env.VARLENS_PG_SCHEMA || 'public'
  }
}
```

- [ ] **Step 2: Add tests**

```ts
// tests/main/storage/config.test.ts
import { describe, expect, it } from 'vitest'
import { getPostgresDevConfig } from '../../../src/main/storage/config'

describe('getPostgresDevConfig', () => {
  it('returns null when postgres env is absent', () => {
    expect(getPostgresDevConfig({})).toBeNull()
  })

  it('returns the configured url and default schema', () => {
    expect(getPostgresDevConfig({ VARLENS_PG_URL: 'postgres://x/y' })).toEqual({
      url: 'postgres://x/y',
      schema: 'public'
    })
  })
})
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/main/storage/config.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/storage/config.ts tests/main/storage/config.test.ts
git commit -m "chore(storage): add postgres dev config scaffold"
```

---

### Task 6: Add local PostgreSQL Docker development workflow

**Files:**
- Create: `docker-compose.postgres.yml`
- Create: `.env.postgres.example`
- Create: `scripts/postgres/init-db/001-create-varlens-schema.sql`
- Create: `scripts/postgres/init-db/README.md`
- Modify: `Makefile`
- Create: `.planning/docs/storage-session-boundary-notes.md`

- [ ] **Step 1: Add Docker Compose file**

```yaml
# docker-compose.postgres.yml
services:
  postgres:
    image: postgres:18
    container_name: varlens-postgres-dev
    restart: unless-stopped
    ports:
      - "127.0.0.1:5432:5432"
    env_file:
      - .env.postgres.local
    volumes:
      - varlens_postgres_data:/var/lib/postgresql/data
      - ./scripts/postgres/init-db:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 5s
      timeout: 5s
      retries: 20

volumes:
  varlens_postgres_data:
```

Notes:
- Keep the bind on `127.0.0.1` only so the dev database is not exposed on the local network by default.
- Use a named volume so PostgreSQL init scripts run only on first boot, matching Docker’s documented behavior.
- Do **not** make this compose file part of `make dev`; SQLite remains the default developer path.

- [ ] **Step 2: Add env example**

```dotenv
# .env.postgres.example
POSTGRES_DB=varlens_dev
POSTGRES_USER=varlens
POSTGRES_PASSWORD=varlens_dev_password
VARLENS_PG_URL=postgres://varlens:varlens_dev_password@127.0.0.1:5432/varlens_dev
VARLENS_PG_SCHEMA=public
```

Notes:
- Developers should copy this to `.env.postgres.local`.
- `.env.*.local` is already gitignored in this repo, so `.env.postgres.local` stays untracked.

- [ ] **Step 3: Add the init SQL layout**

Create `scripts/postgres/init-db/001-create-varlens-schema.sql`:

```sql
CREATE SCHEMA IF NOT EXISTS public;
```

Create `scripts/postgres/init-db/README.md` describing:
- files in this directory run only on first initialization of the Docker volume,
- Phase 1 keeps bootstrap SQL intentionally minimal,
- future phases may add development-only helper objects here, but production migrations must not depend on this folder.

- [ ] **Step 4: Add Make targets**

Add these targets to `Makefile`:

```make
.PHONY: pg-up pg-down pg-logs pg-psql pg-reset

pg-up: ## Start local PostgreSQL dev container
	docker compose -f docker-compose.postgres.yml --env-file .env.postgres.local up -d

pg-down: ## Stop local PostgreSQL dev container
	docker compose -f docker-compose.postgres.yml --env-file .env.postgres.local down

pg-logs: ## Tail local PostgreSQL dev container logs
	docker compose -f docker-compose.postgres.yml --env-file .env.postgres.local logs -f postgres

pg-psql: ## Open psql in the local PostgreSQL dev container
	docker compose -f docker-compose.postgres.yml --env-file .env.postgres.local exec postgres sh -lc 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

pg-reset: ## Destroy local PostgreSQL dev container and volume
	docker compose -f docker-compose.postgres.yml --env-file .env.postgres.local down -v
```

- [ ] **Step 5: Add short planning note**

Write `.planning/docs/storage-session-boundary-notes.md` with:
- why Phase 1 keeps SQLite as the runtime of record,
- why Docker PostgreSQL is added now,
- why repository portability is deferred,
- what Phase 2 will implement.

- [ ] **Step 6: Verify the compose and Make targets**

Run:
```bash
cp .env.postgres.example .env.postgres.local
docker compose -f docker-compose.postgres.yml --env-file .env.postgres.local config
make pg-up
docker compose -f docker-compose.postgres.yml --env-file .env.postgres.local exec postgres sh -lc 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
make pg-down
```

Expected:
- `docker compose ... config` exits 0.
- `make pg-up` starts the container.
- `pg_isready` reports the container is accepting connections.
- `make pg-down` stops it cleanly.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.postgres.yml .env.postgres.example scripts/postgres/init-db/001-create-varlens-schema.sql scripts/postgres/init-db/README.md Makefile .planning/docs/storage-session-boundary-notes.md
git commit -m "chore(storage): add local postgres development workflow"
```

---

### Task 7: Run the full Phase 1 verification gate

**Files:**
- No new files

- [ ] **Step 1: Run focused storage and lifecycle tests**

Run:
```bash
make rebuild-node
npx vitest run \
  tests/main/storage/sqlite-storage-session.test.ts \
  tests/main/storage/storage-manager-compat.test.ts \
  tests/main/storage/config.test.ts \
  tests/main/services/DatabaseManager.test.ts \
  tests/main/handlers/database-logic.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the repo minimum gate**

Run:
```bash
make ci
```

Expected: PASS.

- [ ] **Step 3: Commit final Phase 1 verification note**

```bash
git commit --allow-empty -m "test(storage): verify phase 1 storage session scaffold"
```

---

## Expected Outcome

After this plan:
- the app still opens and uses local SQLite databases exactly as before,
- lifecycle management is no longer hard-bound to `DatabaseService` as the only top-level concept,
- a `StorageSession` seam exists for future PostgreSQL support,
- the repo has a reproducible local PostgreSQL dev workflow,
- no false claim of repository portability has been introduced.

## Phase 2 Entry Criteria

Do not start `PostgresStorageSession` implementation until all of the following are true:
- Phase 1 tests are green.
- `DatabaseManager` async lifecycle changes have settled.
- local PostgreSQL dev container can be started with `make pg-up`.
- team agrees on the first vertical slice to support on both backends.

## Explicit Deferred Work

- `PostgresStorageSession`
- backend capability reporting over IPC
- hosted connection persistence model
- cross-backend overview query implementation
- PostgreSQL read executor / pooling strategy
- PostgreSQL migration runner
- FTS abstraction beyond backend capability flags

## Self-Review

- **Spec coverage:** The rewritten plan now matches the actual code seam in `DatabaseManager`/`DatabaseService` and covers the user’s request for local PostgreSQL Docker development.
- **Placeholder scan:** No `TBD`, `TODO`, or fake portability claims remain.
- **Type consistency:** The plan consistently uses `StorageSession`, `StorageManager`, `WorkspaceRef`, and `StorageCapabilities`; it does not mix them with the previously proposed low-level `StorageAdapter` contract.
