# Worker Testability Implementation Plan

> **Status: COMPLETED** — All 5 tasks implemented and merged in PR #139. Worker coverage 11.4%→36.7%.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise `main/workers` coverage from ~11% to >35% by testing pure extracted modules and extracting additional testable logic from worker files.

**Architecture:** Workers already follow a good pattern — several have pure logic modules (`import-pipeline.ts`, `export-renderer.ts`, `delete-operations.ts`, `worker-db.ts`). The focus is: (1) deepen tests for under-tested pure modules, (2) extract the `db-worker.ts` task dispatcher into a testable module, (3) extract export-worker formatting/pipeline logic. Worker plumbing files (`*-worker.ts` with parentPort) stay untouched — they're thin shells.

**Tech Stack:** Vitest, better-sqlite3-multiple-ciphers (in-memory), Node.js streams

---

## Current State

| File | Lines | Stmts Coverage | Tests | Action |
|------|-------|---------------|-------|--------|
| `delete-operations.ts` | 25 | 100% | 5 tests | **Done** — skip |
| `export-renderer.ts` | 28 | 100% | 30+ tests | **Done** — skip |
| `import-pipeline.ts` | 488 | 15.9% | 7 tests (prepareStatements only) | **Deepen** — streaming functions |
| `worker-db.ts` | 121 | 2.4% | 0 direct | **Add tests** — openWorkerDatabase, rebuildFts |
| `db-worker.ts` | 343 | 0% | 0 | **Extract** task dispatcher logic |
| `export-worker.ts` | 188 | 0% | 0 | **Extract** CSV/XLSX pipeline logic |
| `import-worker.ts` | 332 | 0% | 0 | Thin shell — skip |
| `delete-worker.ts` | 122 | 0% | 0 | Thin shell — skip |
| `rebuild-summary-worker.ts` | 92 | 0% | 0 | Thin shell — skip |
| `statistics/worker.ts` | 55 | 0% | 0 | Thin shell — skip |

## File Structure

### New Files

| File | Purpose |
|------|---------|
| `src/main/workers/db-worker-dispatch.ts` | Pure task dispatcher extracted from `db-worker.ts` |
| `src/main/workers/export-pipeline.ts` | Pure CSV/XLSX export logic extracted from `export-worker.ts` |
| `tests/main/workers/db-worker-dispatch.test.ts` | Tests for task dispatcher |
| `tests/main/workers/export-pipeline.test.ts` | Tests for export pipeline |
| `tests/main/workers/worker-db.test.ts` | Tests for worker-db utilities |

### Modified Files

| File | Change |
|------|--------|
| `src/main/workers/db-worker.ts` | Delegate to `db-worker-dispatch.ts` |
| `src/main/workers/export-worker.ts` | Delegate to `export-pipeline.ts` |
| `tests/main/workers/import-pipeline.test.ts` | Add streaming tests |

---

## Task 1: Test worker-db.ts utilities

**Files:**
- Create: `tests/main/workers/worker-db.test.ts`
- Read: `src/main/workers/worker-db.ts`

The `worker-db.ts` file exports 4 functions: `openWorkerDatabase()`, `openWorkerDatabaseReadOnly()`, `rebuildFts()`, `rebuildCohortSummary()`, plus a `DROP_FTS_TRIGGERS` constant. All accept a DB connection — pure and testable.

- [ ] **Step 1: Read `src/main/workers/worker-db.ts` fully**

Understand each exported function's signature and behavior.

- [ ] **Step 2: Write tests for `openWorkerDatabase`**

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { openWorkerDatabase, openWorkerDatabaseReadOnly } from '../../../src/main/workers/worker-db'

describe('worker-db', () => {
  let db: DatabaseType | null = null

  afterEach(() => {
    db?.close()
    db = null
  })

  describe('openWorkerDatabase', () => {
    it('opens a writable in-memory database', () => {
      db = openWorkerDatabase(':memory:')
      expect(db).toBeDefined()
      // Verify write works
      db.exec('CREATE TABLE test (id INTEGER)')
      db.exec('INSERT INTO test VALUES (1)')
      const row = db.prepare('SELECT id FROM test').get() as { id: number }
      expect(row.id).toBe(1)
    })

    it('sets WAL journal mode', () => {
      db = openWorkerDatabase(':memory:')
      const mode = db.pragma('journal_mode', { simple: true })
      // In-memory DBs use 'memory' mode, but the pragma was called
      expect(mode).toBeDefined()
    })
  })
})
```

Add tests for `openWorkerDatabaseReadOnly` — verify it opens in read-only mode (write attempt should fail).

- [ ] **Step 3: Write tests for `rebuildFts`**

Test that `rebuildFts` works on a database with the proper schema. Use `initializeSchema` + `runMigrations` to set up the FTS table, insert a case with variants, then call `rebuildFts` and verify FTS search returns results.

- [ ] **Step 4: Write tests for `rebuildCohortSummary`**

Test that `rebuildCohortSummary` doesn't throw on a valid schema. It rebuilds analytics tables — verify the cohort_variant_summary table exists after the call.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/main/workers/worker-db.test.ts`
Expected: All pass

- [ ] **Step 6: Commit**

```
test: add tests for worker-db utilities (openWorkerDatabase, rebuildFts, rebuildCohortSummary)
```

---

## Task 2: Deepen import-pipeline.ts tests

**Files:**
- Modify: `tests/main/workers/import-pipeline.test.ts`
- Read: `src/main/workers/import-pipeline.ts`

Current tests only cover `prepareStatements`. The file has 488 lines including streaming functions for JSON and VCF import. The key pure functions to test are `streamInsertJson` and `streamInsertVcf`.

- [ ] **Step 1: Read `src/main/workers/import-pipeline.ts` fully**

Understand the exported functions: `prepareStatements`, `streamInsertJson`, `streamInsertVcf`, `DROP_INDEXES`, `RECREATE_INDEXES`, `DROP_FTS_TRIGGERS`.

- [ ] **Step 2: Write tests for `streamInsertJson`**

`streamInsertJson` takes a DB, prepared statements, a file path, format info, batch size, and callbacks. Create a test JSON file in a temp directory, insert known data, and verify:
- Correct variant count inserted
- Progress callback called
- Known fields (chr, pos, ref, alt) stored correctly

Use `initializeSchema` + `runMigrations` for the DB, and create a minimal JSON test fixture. Check `tests/test-data/` for existing fixtures to reuse.

- [ ] **Step 3: Write tests for SQL constants**

Verify `DROP_INDEXES` and `RECREATE_INDEXES` SQL executes without error on a schema-initialized DB:

```typescript
describe('index management SQL', () => {
  it('DROP_INDEXES executes on fresh schema', () => {
    expect(() => db.exec(DROP_INDEXES)).not.toThrow()
  })

  it('RECREATE_INDEXES executes after drop', () => {
    db.exec(DROP_INDEXES)
    expect(() => db.exec(RECREATE_INDEXES)).not.toThrow()
  })

  it('RECREATE_INDEXES is idempotent', () => {
    expect(() => db.exec(RECREATE_INDEXES)).not.toThrow()
    expect(() => db.exec(RECREATE_INDEXES)).not.toThrow()
  })
})
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/main/workers/import-pipeline.test.ts`
Expected: All pass (existing + new)

- [ ] **Step 5: Commit**

```
test: deepen import-pipeline tests with streaming and index management
```

---

## Task 3: Extract db-worker task dispatcher

**Files:**
- Create: `src/main/workers/db-worker-dispatch.ts`
- Modify: `src/main/workers/db-worker.ts`
- Create: `tests/main/workers/db-worker-dispatch.test.ts`

The `db-worker.ts` file has a 200-line `switch` statement dispatching 25+ task types. The dispatch logic is pure — it takes repositories and task objects, returns results. The worker plumbing (DB init, workerData, pragma setup) stays in `db-worker.ts`.

- [ ] **Step 1: Read `src/main/workers/db-worker.ts` fully**

Understand the full `run(task)` function and `resolvePanelIntervalsInPlace`.

- [ ] **Step 2: Create `src/main/workers/db-worker-dispatch.ts`**

Extract:
- The `PanelAwareFilter` interface
- The `resolvePanelIntervalsInPlace` function  
- The task dispatch `switch` statement as a new function

The new module should accept dependencies:

```typescript
import type { Repositories } from '../database/createRepositories'
import type { GeneReferenceDb } from '../database/GeneReferenceDb'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import type { DbTask } from '../../shared/types/db-task'

export interface DispatchDependencies {
  db: DatabaseType
  repos: Repositories
  geneRefDb: GeneReferenceDb | null
}

export function dispatchTask(deps: DispatchDependencies, task: DbTask): unknown {
  // ... switch statement from db-worker.ts
}
```

Also export `resolvePanelIntervalsInPlace` so it's independently testable.

- [ ] **Step 3: Update `db-worker.ts` to delegate**

Replace the `run` function body with:

```typescript
import { dispatchTask } from './db-worker-dispatch'

export default function run(task: DbTask): unknown {
  return dispatchTask({ db, repos, geneRefDb }, task)
}
```

Keep all DB initialization, workerData handling, and pragma setup in `db-worker.ts`.

- [ ] **Step 4: Write tests for `dispatchTask`**

Create `tests/main/workers/db-worker-dispatch.test.ts`. Use real in-memory SQLite databases:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { createRepositories } from '../../../src/main/database/createRepositories'
import { dispatchTask } from '../../../src/main/workers/db-worker-dispatch'

describe('db-worker-dispatch', () => {
  let db: DatabaseType

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  it('cases:list returns empty array for fresh DB', () => {
    const repos = createRepositories(db)
    const result = dispatchTask(
      { db, repos, geneRefDb: null },
      { type: 'cases:list', params: [] }
    )
    expect(result).toEqual([])
  })

  it('cohort:summary returns summary for empty DB', () => {
    const repos = createRepositories(db)
    const result = dispatchTask(
      { db, repos, geneRefDb: null },
      { type: 'cohort:summary', params: [] }
    )
    expect(result).toBeDefined()
  })

  it('tags:list returns empty for fresh DB', () => {
    const repos = createRepositories(db)
    const result = dispatchTask(
      { db, repos, geneRefDb: null },
      { type: 'tags:list', params: [] }
    )
    expect(result).toEqual([])
  })

  it('throws on unknown task type', () => {
    const repos = createRepositories(db)
    expect(() =>
      dispatchTask(
        { db, repos, geneRefDb: null },
        { type: 'unknown:task' as never, params: [] }
      )
    ).toThrow('Unknown db-worker task type')
  })
})
```

Add tests for at least 5-8 task types covering variants, cohort, cases, annotations, tags.

- [ ] **Step 5: Write tests for `resolvePanelIntervalsInPlace`**

Test the panel interval resolution function:
- No-op when `active_panel_ids` is empty or undefined
- Removes IPC-only fields (`active_panel_ids`, `panel_padding_bp`, `genome_build`) from filter
- No-op when `geneRefDb` is null

- [ ] **Step 6: Run typecheck and tests**

Run: `make typecheck && npx vitest run tests/main/workers/db-worker-dispatch.test.ts`
Expected: All pass

- [ ] **Step 7: Commit**

```
refactor: extract db-worker task dispatcher into testable module
```

---

## Task 4: Extract export-worker pipeline logic

**Files:**
- Create: `src/main/workers/export-pipeline.ts`
- Modify: `src/main/workers/export-worker.ts`
- Create: `tests/main/workers/export-pipeline.test.ts`

The `export-worker.ts` has ~138 lines of business logic: CSV streaming with RFC 4180 escaping, XLSX in-memory aggregation with metadata sheets, filter summary serialization. The cell formatting is already in `export-renderer.ts` (100% covered). What remains is the pipeline orchestration.

- [ ] **Step 1: Read `src/main/workers/export-worker.ts` fully**

Identify the pure functions that can be extracted: the main export pipeline logic that takes a DB connection, query params, output path, and format — and produces the file.

- [ ] **Step 2: Create `src/main/workers/export-pipeline.ts`**

Extract the core export function(s). The function should accept:
- DB connection (or query results)
- Output file path
- Export format ('csv' | 'xlsx')
- Filter params for the metadata sheet
- A progress callback

Keep parentPort messaging in `export-worker.ts`.

- [ ] **Step 3: Update `export-worker.ts` to delegate**

The worker file should just:
1. Parse workerData
2. Open DB
3. Call the exported pipeline function
4. Report progress/completion via parentPort

- [ ] **Step 4: Write tests for export pipeline**

Test the CSV and XLSX generation with in-memory databases:
- Insert known variants
- Run the export pipeline to a temp file
- Verify file contents (CSV: check lines, headers; XLSX: check sheet names exist)
- Verify progress callback is called

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { vi } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from 'fs'
// import the extracted function

describe('export-pipeline', () => {
  let db: DatabaseType
  let tempDir: string

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    tempDir = mkdtempSync(join(tmpdir(), 'export-test-'))
  })

  afterEach(() => {
    db.close()
    // cleanup temp files
  })

  it('exports CSV with headers for empty DB', () => {
    // Call export pipeline with CSV format
    // Verify file exists and has header row
  })

  it('calls progress callback during export', () => {
    const onProgress = vi.fn()
    // Call export with onProgress
    expect(onProgress).toHaveBeenCalled()
  })
})
```

- [ ] **Step 5: Run typecheck and tests**

Run: `make typecheck && npx vitest run tests/main/workers/export-pipeline.test.ts`
Expected: All pass

- [ ] **Step 6: Commit**

```
refactor: extract export-worker pipeline into testable module
```

---

## Task 5: Final verification and coverage update

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 2: Run coverage and check workers directory**

Run: `npx vitest run --coverage 2>&1 | grep "main/workers"`
Expected: `main/workers` statements >35%

- [ ] **Step 3: Run lint and typecheck**

Run: `npm run lint:check && make typecheck`
Expected: Clean

- [ ] **Step 4: Commit any threshold updates**

If `autoUpdate` changed `vitest.config.ts`:

```bash
git add vitest.config.ts
git commit -m "chore: auto-update coverage thresholds after worker testability improvements"
```
