/**
 * Off-thread SQLite migrations (audit 05, M-6 follow-up): the real migration
 * worker (bundled with esbuild) upgrades the file, so the main-thread
 * DatabaseService open that follows has nothing left to migrate.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import {
  migrateSqliteOffThread,
  setMigrationWorkerPathForTesting
} from '../../../src/main/database/migrate-off-thread'
import { COHORT_KEYSET_INDEX } from '../../../src/shared/sql/cohort-keyset'
import { bundleWorker } from '../../utils/bundle-worker'

const KEY = 'correct horse battery staple'

function indexExists(path: string, key?: string): boolean {
  const db = new Database(path, { readonly: true })
  try {
    if (key !== undefined) db.pragma(`key='${key}'`)
    return (
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get(COHORT_KEYSET_INDEX) !== undefined
    )
  } finally {
    db.close()
  }
}

/** Create a current database, then roll it back to "v36 without the v37 index". */
function makeV36Database(path: string, key?: string): void {
  const service = new DatabaseService(path, key)
  service.database.exec(`DROP INDEX ${COHORT_KEYSET_INDEX}`)
  service.database.pragma('user_version = 36')
  service.close()
}

describe('migrateSqliteOffThread', () => {
  let dir: string

  beforeAll(async () => {
    setMigrationWorkerPathForTesting(await bundleWorker('src/main/workers/migration-worker.ts'))
  }, 60_000)

  afterAll(() => {
    setMigrationWorkerPathForTesting(undefined)
  })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-migrate-worker-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('applies pending migrations in the worker', async () => {
    const path = join(dir, 'plain.db')
    makeV36Database(path)

    const result = await migrateSqliteOffThread(path)

    expect(result).toMatchObject({ ran: true, fromVersion: 36, toVersion: 39 })
    expect(indexExists(path)).toBe(true)
    // The main-thread open now finds a current schema.
    const service = new DatabaseService(path)
    expect(service.database.pragma('user_version', { simple: true })).toBe(39)
    service.close()
  })

  it('migrates encrypted databases with the supplied key', async () => {
    const path = join(dir, 'encrypted.db')
    makeV36Database(path, KEY)

    const result = await migrateSqliteOffThread(path, KEY)

    expect(result).toMatchObject({ ran: true, fromVersion: 36, toVersion: 39 })
    expect(indexExists(path, KEY)).toBe(true)
  })

  it('reports a wrong key without touching the file (caller falls back to main)', async () => {
    const path = join(dir, 'encrypted.db')
    makeV36Database(path, KEY)

    const result = await migrateSqliteOffThread(path, 'wrong key')

    expect(result.ran).toBe(false)
    expect(result.error).toMatch(/not a database/i)
    expect(indexExists(path, KEY)).toBe(false)
  })

  it('creates a new database file with the standard page size', async () => {
    const path = join(dir, 'fresh.db')
    const result = await migrateSqliteOffThread(path)
    expect(result).toMatchObject({ ran: true, fromVersion: 0, toVersion: 39 })
    const db = new Database(path, { readonly: true })
    expect(db.pragma('page_size', { simple: true })).toBe(8192)
    db.close()
  })

  it('is a no-op for in-memory databases', async () => {
    expect(await migrateSqliteOffThread(':memory:')).toEqual({ ran: false })
  })
})
