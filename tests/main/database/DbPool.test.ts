/**
 * Integration tests for DbPool (Piscina worker pool)
 *
 * Uses a file-based database so worker threads can open their own connections.
 * Requires `npx electron-vite build` before running so that out/main/db-worker.js exists.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { unlinkSync, existsSync } from 'fs'
import { DatabaseService } from '../../../src/main/database'
import { DbPool } from '../../../src/main/database/DbPool'
import type { DbTask } from '../../../src/shared/types/db-task'

const TEST_DB_PATH = join(tmpdir(), `varlens-dbpool-test-${Date.now()}.db`)
// Use the built JS worker (same as production) — no tsx dependency needed
const WORKER_PATH = resolve(__dirname, '../../../out/main/db-worker.js')
const WORKER_OPTS = { workerPath: WORKER_PATH }

// Skip entire suite if the built worker doesn't exist (CI runs tests before build)
const workerAvailable = existsSync(WORKER_PATH)

describe.skipIf(!workerAvailable)('DbPool', () => {
  let mainService: DatabaseService
  let pool: DbPool

  beforeAll(() => {
    // Create a file-based DB and insert test data on the main thread
    mainService = new DatabaseService(TEST_DB_PATH)

    // Insert a test case so read queries return data
    mainService.database.exec(`
      INSERT INTO cases (name, file_path, file_size, variant_count, created_at)
      VALUES ('TestCase1', '/tmp/test.vcf', 1024, 0, ${Date.now()})
    `)
  })

  afterAll(async () => {
    // Destroy pool first, then close main connection
    if (pool) {
      await pool.destroy()
    }
    if (mainService) {
      mainService.close()
    }
    // Clean up temp files
    for (const suffix of ['', '-wal', '-shm']) {
      const p = TEST_DB_PATH + suffix
      if (existsSync(p)) unlinkSync(p)
    }
  })

  it('initialises pool and runs cases:list task', async () => {
    pool = new DbPool()
    pool.init(TEST_DB_PATH, undefined, WORKER_OPTS)

    const task: DbTask = { type: 'cases:list', params: [] }
    const result = await pool.run<Array<{ name: string }>>(task)

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0].name).toBe('TestCase1')
  })

  it('rejects unknown task types with descriptive error', async () => {
    // Pool already initialised from previous test
    const task = { type: 'unknown:task' as DbTask['type'], params: [] }

    await expect(pool.run(task)).rejects.toThrow('Unknown db-worker task type: unknown:task')
  })

  it('throws if run() called before init()', async () => {
    const uninitPool = new DbPool()
    const task: DbTask = { type: 'cases:list', params: [] }

    await expect(uninitPool.run(task)).rejects.toThrow('DbPool not initialized')
  })

  it('handles cohort:summaryStatus task', async () => {
    const task: DbTask = { type: 'cohort:summaryStatus', params: [] }
    const result = await pool.run<{ is_stale: boolean }>(task)

    expect(result).toBeDefined()
    expect(typeof result.is_stale).toBe('boolean')
  })

  it('handles case-metadata:listCohorts task', async () => {
    const task: DbTask = { type: 'case-metadata:listCohorts', params: [] }
    const result = await pool.run<unknown[]>(task)

    expect(Array.isArray(result)).toBe(true)
  })

  it('can destroy and re-initialise', async () => {
    await pool.destroy()

    pool = new DbPool()
    pool.init(TEST_DB_PATH, undefined, WORKER_OPTS)

    const task: DbTask = { type: 'cases:list', params: [] }
    const result = await pool.run<unknown[]>(task)
    expect(Array.isArray(result)).toBe(true)
  })
})
