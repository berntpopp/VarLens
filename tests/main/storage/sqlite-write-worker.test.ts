/**
 * End-to-end test of the single SQLite writer thread: the real
 * `write-worker.ts` (bundled with esbuild), a real on-disk database, and the
 * real `SqliteWriteExecutor` → `WriteWorkerClient` path used by the app.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { UniqueConstraintError } from '../../../src/main/database/errors'
import { toSerializableError } from '../../../src/main/ipc/serializable-error'
import { SqliteWriteExecutor } from '../../../src/main/storage/sqlite/SqliteWriteExecutor'
import { ErrorCode } from '../../../src/shared/types/errors'
import { bundleWorker } from '../../utils/bundle-worker'

describe('SQLite write worker (single writer thread)', () => {
  let workerPath: string
  let dir: string
  let db: DatabaseService
  let executor: SqliteWriteExecutor

  beforeAll(async () => {
    workerPath = await bundleWorker('src/main/workers/write-worker.ts')
  }, 60_000)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-write-worker-'))
    db = new DatabaseService(join(dir, 'test.db'))
    executor = new SqliteWriteExecutor(db, { workerPath })
  })

  afterEach(async () => {
    await executor.close()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('executes writes on the worker connection, visible to the main connection', async () => {
    expect(executor.usesWorker).toBe(true)

    const tag = (await executor.execute({
      type: 'tags:create',
      params: ['urgent', '#ff0000']
    })) as {
      id: number
      name: string
    }

    expect(tag.name).toBe('urgent')
    expect(db.tags.listTags().map((t) => t.name)).toEqual(['urgent'])
  })

  it('preserves FIFO order across queued writes', async () => {
    const created = await Promise.all(
      ['a', 'b', 'c', 'd'].map((name) =>
        executor.execute({
          type: 'presets:create',
          params: [{ name, filterJson: {} }]
        })
      )
    )

    const ids = (created as Array<{ id: number }>).map((p) => p.id)
    expect(ids).toEqual([...ids].sort((x, y) => x - y))
  })

  it('rehydrates domain error classes so IPC error mapping is unchanged', async () => {
    await executor.execute({ type: 'presets:create', params: [{ name: 'dup', filterJson: {} }] })

    const failure = await executor
      .execute({ type: 'presets:create', params: [{ name: 'dup', filterJson: {} }] })
      .then(
        () => null,
        (error: unknown) => error
      )

    expect(failure).toBeInstanceOf(UniqueConstraintError)
    expect(toSerializableError(failure).code).toBe(ErrorCode.CONFLICT)
  })

  it('keeps working after the writer is closed (lazy respawn)', async () => {
    await executor.execute({ type: 'tags:create', params: ['one', '#000000'] })
    await executor.close()
    await executor.execute({ type: 'tags:create', params: ['two', '#000000'] })

    expect(db.tags.listTags().map((t) => t.name)).toEqual(['one', 'two'])
  })
})
