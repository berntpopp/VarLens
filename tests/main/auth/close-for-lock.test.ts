/**
 * The desktop sign-in lock's close (#295) through a real session with the
 * real read pool (`db-worker.ts`, bundled with esbuild): the key goes first,
 * a read that arrives during the close fails instead of hanging or respawning
 * a keyed worker, and every step runs even when one fails.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DbPool } from '../../../src/main/database/DbPool'
import { createSqliteStorageSession } from '../../../src/main/storage/sqlite/createSqliteStorageSession'
import type { SqliteStorageSession } from '../../../src/main/storage/sqlite/SqliteStorageSession'
import { bundleWorker } from '../../utils/bundle-worker'

describe('SqliteStorageSession.closeForLock', () => {
  let dbWorkerPath: string
  let dir: string
  let session: SqliteStorageSession

  beforeAll(async () => {
    dbWorkerPath = await bundleWorker('src/main/workers/db-worker.ts')
  }, 60_000)

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-close-for-lock-'))
    session = createSqliteStorageSession(join(dir, 'locked.db'), 'a-key', { dbWorkerPath })
    session.getDatabaseService().cases.createCase('case-a', '/path/a.vcf', 1)
    // A pool worker now holds a connection with the key.
    expect(await session.listCases()).toHaveLength(1)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  it('drops the key at once and fails a read that arrives during the close', async () => {
    const service = session.getDatabaseService()
    const closing = session.closeForLock()
    expect(service.getEncryptionKey()).toBeUndefined()
    const late = session.listCases()
    await closing
    await expect(late).rejects.toThrow(/not initialized/)
    expect(service.database.open).toBe(false)
  })

  it('runs every step when one fails, then reports the failure', async () => {
    vi.spyOn(DbPool.prototype, 'suspend').mockRejectedValueOnce(new Error('suspend failed'))
    const service = session.getDatabaseService()
    await expect(session.closeForLock()).rejects.toThrow('suspend failed')
    expect(service.getEncryptionKey()).toBeUndefined()
    expect(service.database.open).toBe(false)
    await expect(session.listCases()).rejects.toThrow(/not initialized/)
  })
})
