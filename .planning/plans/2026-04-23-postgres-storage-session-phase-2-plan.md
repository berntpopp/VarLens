# PostgreSQL Storage Session — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real PostgreSQL-backed `StorageSession` plus validated config, pool lifecycle, workspace metadata, and health reporting without claiming repository portability.

**Architecture:** This phase keeps SQLite as the operational default and adds PostgreSQL only at the session/lifecycle layer. `PostgresStorageSession` owns a `pg.Pool`, reports redacted workspace identity and explicit capabilities, and exposes structured health checks. Repository migration, worker redesign, renderer backend switching, and schema-path mutation remain out of scope.

**Tech Stack:** Electron 40, TypeScript 6, `pg`, Vitest, existing storage/session boundary, Docker PostgreSQL 18 dev workflow.

---

## File Structure

**Created:**
- `src/main/storage/postgres/PostgresStorageSession.ts` — PostgreSQL session implementation backed by `pg.Pool`.
- `tests/main/storage/postgres-storage-session.test.ts` — unit tests for metadata, capabilities, pool lifecycle, unsupported compatibility methods, and health behavior.

**Modified:**
- `package.json` — add `pg` dependency.
- `package-lock.json` — lockfile update for `pg`.
- `src/main/storage/config.ts` — replace minimal dev config parsing with normalized PostgreSQL storage config parsing, pool option shaping, and redaction helpers.
- `tests/main/storage/config.test.ts` — extend config coverage for defaults, validation, redaction, and `PoolConfig` shaping.
- `src/shared/ipc/domains/database.ts` — additive storage metadata only if Phase 2 exposes backend info through existing IPC.
- `src/preload/domains/database.ts` — only if the shared contract changes additively.
- `src/main/ipc/domains/database.ts` — only if session metadata is exposed through the main IPC registration layer.
- `src/main/ipc/handlers/database-logic.ts` — only if additive backend/session metadata is surfaced through existing `database:*` handlers.

**Not touched in Phase 2:**
- Repository implementations under `src/main/database/`.
- `src/main/database/BaseRepository.ts`.
- import/export/delete workers.
- renderer backend selection UI.
- generic multi-backend `DatabaseManager` switching unless the task requires it explicitly.
- any `search_path` session mutation.

---

### Task 1: Add the PostgreSQL runtime dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Add `pg` to dependencies**

Update `package.json` dependencies with the current approved `pg` release used by the implementation:

```json
"pg": "^8.x"
```

Place it alphabetically with the existing production dependencies.

- [ ] **Step 2: Refresh the lockfile**

Run:

```bash
npm install
```

Expected:
- `package-lock.json` updated with `pg` and its transitive dependencies
- no other intentional dependency changes beyond the lock refresh

- [ ] **Step 3: Verify the dependency is present**

Run:

```bash
node -p "require('./package.json').dependencies.pg"
```

Expected:
- a `^8.x` `pg` version string

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(storage): add postgres session runtime dependency"
```

---

### Task 2: Expand PostgreSQL config parsing, validation, and pool option shaping

**Files:**
- Modify: `src/main/storage/config.ts`
- Modify: `tests/main/storage/config.test.ts`

- [ ] **Step 1: Write the failing config and pool-shaping tests**

Add tests to `tests/main/storage/config.test.ts` covering:

```ts
import { describe, expect, it } from 'vitest'

import {
  buildPostgresConnectionLabel,
  buildPostgresPoolConfig,
  getPostgresStorageConfig,
  redactPostgresConnectionUrl
} from '../../../src/main/storage/config'

describe('getPostgresStorageConfig', () => {
  it('returns null when postgres env is absent', () => {
    expect(getPostgresStorageConfig({})).toBeNull()
  })

  it('returns normalized defaults for schema, application name, timeouts, and pool size', () => {
    expect(
      getPostgresStorageConfig({
        VARLENS_PG_URL: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev'
      })
    ).toEqual({
      url: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
      schema: 'public',
      applicationName: 'varlens-main',
      sslMode: 'disable',
      connectionTimeoutMillis: 5000,
      statementTimeoutMs: 30000,
      queryTimeoutMs: 30000,
      lockTimeoutMs: 5000,
      idleInTransactionSessionTimeoutMs: 10000,
      poolMax: 4
    })
  })

  it('rejects an invalid ssl mode', () => {
    expect(() =>
      getPostgresStorageConfig({
        VARLENS_PG_URL: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
        VARLENS_PG_SSL_MODE: 'bogus'
      })
    ).toThrow('Invalid VARLENS_PG_SSL_MODE')
  })

  it('rejects a blank schema after trimming', () => {
    expect(() =>
      getPostgresStorageConfig({
        VARLENS_PG_URL: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
        VARLENS_PG_SCHEMA: '   '
      })
    ).toThrow('VARLENS_PG_SCHEMA')
  })

  it('rejects invalid numeric timeout values', () => {
    expect(() =>
      getPostgresStorageConfig({
        VARLENS_PG_URL: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
        VARLENS_PG_QUERY_TIMEOUT_MS: '-1'
      })
    ).toThrow('VARLENS_PG_QUERY_TIMEOUT_MS')
  })

  it('rejects pool sizes smaller than 1', () => {
    expect(() =>
      getPostgresStorageConfig({
        VARLENS_PG_URL: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
        VARLENS_PG_POOL_MAX: '0'
      })
    ).toThrow('VARLENS_PG_POOL_MAX')
  })
})

describe('redactPostgresConnectionUrl', () => {
  it('removes credentials while preserving the target database', () => {
    expect(
      redactPostgresConnectionUrl('postgres://varlens:secret@127.0.0.1:55432/varlens_dev')
    ).toBe('postgres://127.0.0.1:55432/varlens_dev')
  })
})

describe('buildPostgresConnectionLabel', () => {
  it('formats host, port, database, and schema', () => {
    expect(
      buildPostgresConnectionLabel('postgres://127.0.0.1:55432/varlens_dev', 'public')
    ).toBe('127.0.0.1:55432/varlens_dev (public)')
  })
})

describe('buildPostgresPoolConfig', () => {
  it('maps normalized config into pg pool options without search_path mutation', () => {
    const config = getPostgresStorageConfig({
      VARLENS_PG_URL: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
      VARLENS_PG_SCHEMA: 'varlens'
    })

    expect(buildPostgresPoolConfig(config!)).toMatchObject({
      connectionString: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
      application_name: 'varlens-main',
      connectionTimeoutMillis: 5000,
      statement_timeout: 30000,
      query_timeout: 30000,
      lock_timeout: 5000,
      idle_in_transaction_session_timeout: 10000,
      max: 4
    })
  })
})
```

- [ ] **Step 2: Run the config tests and confirm they fail**

Run:

```bash
npx vitest run tests/main/storage/config.test.ts
```

Expected:
- FAIL because the new config shape and helper functions do not exist yet

- [ ] **Step 3: Implement normalized config parsing and pool shaping**

Update `src/main/storage/config.ts` to add:

- `PostgresSslMode`
- `PostgresStorageConfig`
- explicit defaults for schema, app name, timeouts, and pool size
- numeric env parsing helper with validation
- `getPostgresStorageConfig(...)`
- `redactPostgresConnectionUrl(...)`
- `buildPostgresConnectionLabel(...)`
- `buildPostgresPoolConfig(...)`

Implementation requirements:

- `buildPostgresPoolConfig(...)` must map `sslMode` into a deterministic `ssl` setting
- no support in Phase 2 for mutating `search_path`
- no support in Phase 2 for mixing conflicting URL SSL parameters with separately managed SSL config
- config parsing stays side-effect-free and testable

- [ ] **Step 4: Run the config tests and confirm they pass**

Run:

```bash
npx vitest run tests/main/storage/config.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/config.ts tests/main/storage/config.test.ts
git commit -m "feat(storage): expand postgres session config parsing"
```

---

### Task 3: Add `PostgresStorageSession`

**Files:**
- Create: `src/main/storage/postgres/PostgresStorageSession.ts`
- Test: `tests/main/storage/postgres-storage-session.test.ts`

- [ ] **Step 1: Write the failing PostgreSQL session tests**

Create tests in `tests/main/storage/postgres-storage-session.test.ts` covering:

```ts
import { describe, expect, it, vi } from 'vitest'

import type { PostgresStorageConfig } from '../../../src/main/storage/config'
import { PostgresStorageSession } from '../../../src/main/storage/postgres/PostgresStorageSession'

function makeConfig(overrides: Partial<PostgresStorageConfig> = {}): PostgresStorageConfig {
  return {
    url: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
    schema: 'public',
    applicationName: 'varlens-main',
    sslMode: 'disable',
    connectionTimeoutMillis: 5000,
    statementTimeoutMs: 30000,
    queryTimeoutMs: 30000,
    lockTimeoutMs: 5000,
    idleInTransactionSessionTimeoutMs: 10000,
    poolMax: 4,
    ...overrides
  }
}

describe('PostgresStorageSession', () => {
  it('exposes redacted workspace metadata and explicit postgres capabilities', () => {
    const pool = {
      query: vi.fn(),
      end: vi.fn(),
      on: vi.fn()
    }

    const session = new PostgresStorageSession({
      config: makeConfig(),
      pool: pool as never
    })

    expect(pool.on).toHaveBeenCalledWith('error', expect.any(Function))
    expect(session.workspace.kind).toBe('postgres')
    expect(session.workspace.connectionUrlRedacted).toBe(
      'postgres://127.0.0.1:55432/varlens_dev'
    )
    expect(session.workspace.connectionLabel).toBe('127.0.0.1:55432/varlens_dev (public)')
    expect(session.capabilities).toEqual({
      backend: 'postgres',
      supportsEncryptionAtRest: false,
      supportsLocalFileLifecycle: false,
      supportsHostedConnectionLifecycle: true,
      supportsWorkerReadPool: false,
      supportsFullTextSearch: false
    })
  })

  it('returns a healthy result when the round-trip query succeeds', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn()
    }

    const session = new PostgresStorageSession({
      config: makeConfig(),
      pool: pool as never
    })

    await expect(session.health()).resolves.toMatchObject({
      ok: true,
      backend: 'postgres'
    })
    expect(pool.query).toHaveBeenCalledWith('SELECT 1')
  })

  it('returns a failed health result when the round-trip query fails', async () => {
    const session = new PostgresStorageSession({
      config: makeConfig(),
      pool: {
        query: vi.fn().mockRejectedValue(new Error('connection refused')),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn()
      } as never
    })

    await expect(session.health()).resolves.toMatchObject({
      ok: false,
      backend: 'postgres',
      message: 'connection refused'
    })
  })

  it('throws for sqlite-only compatibility methods', () => {
    const session = new PostgresStorageSession({
      config: makeConfig(),
      pool: {
        query: vi.fn(),
        end: vi.fn(),
        on: vi.fn()
      } as never
    })

    expect(() => session.getDatabaseService()).toThrow('DatabaseService is not available')
    expect(() => session.getDbPool()).toThrow('DbPool is not available')
    expect(() => session.rekey('secret')).toThrow('SQLite rekey is not supported')
  })

  it('closes the underlying pool', async () => {
    const pool = {
      query: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn()
    }

    const session = new PostgresStorageSession({
      config: makeConfig(),
      pool: pool as never
    })

    await session.close()
    expect(pool.end).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the PostgreSQL session tests and confirm they fail**

Run:

```bash
npx vitest run tests/main/storage/postgres-storage-session.test.ts
```

Expected:
- FAIL because `PostgresStorageSession` does not exist yet

- [ ] **Step 3: Implement the session**

Create `src/main/storage/postgres/PostgresStorageSession.ts` with:

- constructor accepting normalized config and a `Pool`
- workspace metadata derived via the config helpers
- explicit PostgreSQL capabilities
- `health()` implemented with `pool.query('SELECT 1')`
- pool `error` listener registration
- `close()` implemented with `pool.end()`
- SQLite-only compatibility methods throwing clear errors

- [ ] **Step 4: Run the PostgreSQL session tests and confirm they pass**

Run:

```bash
npx vitest run tests/main/storage/postgres-storage-session.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/postgres/PostgresStorageSession.ts tests/main/storage/postgres-storage-session.test.ts
git commit -m "feat(storage): add postgres storage session"
```

---

### Task 4: Add a small pool factory boundary

**Files:**
- Modify: `src/main/storage/config.ts`
- Modify: `tests/main/storage/config.test.ts`

- [ ] **Step 1: Add a focused test for SSL mapping**

Extend `tests/main/storage/config.test.ts` with coverage for:

```ts
it('maps ssl mode require into a pool ssl object', () => {
  const config = getPostgresStorageConfig({
    VARLENS_PG_URL: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
    VARLENS_PG_SSL_MODE: 'require'
  })

  expect(buildPostgresPoolConfig(config!)).toMatchObject({
    ssl: expect.any(Object)
  })
})
```

- [ ] **Step 2: Run the focused config tests**

Run:

```bash
npx vitest run tests/main/storage/config.test.ts
```

Expected:
- FAIL if SSL mapping is not implemented yet

- [ ] **Step 3: Finalize the pool helper**

Ensure the helper:

- maps `disable` to no SSL config
- maps `prefer` and `require` into explicit `ssl` behavior chosen for Phase 2
- does not set `search_path`
- keeps all timeout and pool bounds explicit

- [ ] **Step 4: Re-run the focused config tests**

Run:

```bash
npx vitest run tests/main/storage/config.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/config.ts tests/main/storage/config.test.ts
git commit -m "refactor(storage): add postgres pool config helper"
```

---

### Task 5: Add additive lifecycle metadata only if needed

**Files:**
- Modify only if required:
  - `src/shared/ipc/domains/database.ts`
  - `src/preload/domains/database.ts`
  - `src/main/ipc/domains/database.ts`
  - `src/main/ipc/handlers/database-logic.ts`

- [ ] **Step 1: Inspect whether existing database metadata flows need backend/session info**

Review the current `database:*` contract and choose the smallest additive surface.

Rule:
- if no current verification or consumer needs PostgreSQL metadata yet, skip this task entirely

- [ ] **Step 2: If needed, add only backend kind and redacted workspace metadata**

Allowed additions:
- backend kind
- redacted workspace ref
- capability flags

Disallowed additions:
- backend switching commands
- Postgres repository access
- raw URLs or credentials

- [ ] **Step 3: Run the affected tests**

Run the smallest relevant suite, for example:

```bash
npx vitest run tests/main/handlers/database-logic.test.ts
```

Expected:
- PASS

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc/domains/database.ts src/preload/domains/database.ts src/main/ipc/domains/database.ts src/main/ipc/handlers/database-logic.ts
git commit -m "feat(storage): expose additive postgres session metadata"
```

Skip the commit if no files changed because the task was intentionally unnecessary.

---

### Task 6: Verify the slice end-to-end at the unit boundary

**Files:**
- No new files required

- [ ] **Step 1: Run focused PostgreSQL storage tests**

Run:

```bash
npx vitest run tests/main/storage/config.test.ts tests/main/storage/postgres-storage-session.test.ts
```

Expected:
- PASS

- [ ] **Step 2: Run any adjacent storage/lifecycle tests touched by the implementation**

Run:

```bash
npx vitest run tests/main/storage/*.test.ts tests/main/services/DatabaseManager.test.ts tests/main/handlers/database-logic.test.ts
```

Expected:
- PASS for affected suites

- [ ] **Step 3: Run repo-standard verification**

Run:

```bash
make ci
```

Expected:
- PASS

- [ ] **Step 4: Commit any remaining verification-driven fixes**

```bash
git add -A
git commit -m "test(storage): verify postgres session phase 2"
```

Only do this if verification required a real code change after the earlier commits.

---

## Self-Review

### Spec coverage

This plan covers:

- `pg` adoption
- normalized config with explicit defaults
- pool config shaping
- SSL normalization
- explicit no-`search_path` rule
- session lifecycle and `health()`
- capability and workspace metadata
- additive IPC only if needed
- focused verification plus `make ci`

### Placeholder scan

Intended implementation choices remain explicit:

- no repository portability
- no backend switcher
- no search-path mutation
- no raw credential exposure
- no vague “add validation later” steps

### Type consistency

The plan consistently uses:

- `PostgresStorageConfig`
- `buildPostgresPoolConfig(...)`
- `PostgresStorageSession`
- `health()`
- existing `StorageSession` compatibility methods

No later task introduces alternative names for the same concepts.
