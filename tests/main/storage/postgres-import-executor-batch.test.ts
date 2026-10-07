import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import { PostgresImportExecutor } from '../../../src/main/storage/postgres/PostgresImportExecutor'
import type { PostgresImportWorkerCallbacks } from '../../../src/main/storage/postgres/PostgresImportWorkerClient'
import type {
  PostgresClientConfig,
  PostgresImportWorkerStartMessage
} from '../../../src/shared/types/postgres-import-worker'

/**
 * openBatch(): one control connection owns the workspace import lock and the
 * interrupted-import recovery; every file of the batch runs in its own leased
 * worker.
 */
const CLIENT_CONFIG: PostgresClientConfig = {
  connectionString: 'postgres://test:secret@localhost:5432/testdb',
  application_name: 'varlens-test',
  ssl: { mode: 'disable' }
}

class FakeWorker {
  message: PostgresImportWorkerStartMessage | null = null
  callbacks: PostgresImportWorkerCallbacks | null = null
  start = vi.fn((message: PostgresImportWorkerStartMessage, cb: PostgresImportWorkerCallbacks) => {
    this.message = message
    this.callbacks = cb
  })
  cancel = vi.fn()
  complete(caseId: number): void {
    this.callbacks?.onComplete({
      type: 'complete',
      mode: 'single-file',
      result: { caseId, variantCount: 7, skipped: 0, errors: [], elapsed: 5 }
    })
  }
}

function setup(lockFree = true) {
  const sql: string[] = []
  const control = {
    connect: vi.fn(async () => undefined),
    query: vi.fn(async (text: string) => {
      sql.push(text)
      if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: lockFree }] }
      if (text.includes('pg_backend_pid')) return { rows: [{ pid: 4242 }] }
      return { rows: [] }
    }),
    end: vi.fn(async () => {
      sql.push('END')
    })
  }
  const workers: FakeWorker[] = []
  const executor = new PostgresImportExecutor({
    schema: 'tenant',
    clientConfig: CLIENT_CONFIG,
    workerClientFactory: () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker as never
    },
    controlClientFactory: () => control as never
  })
  return { executor, control, sql, workers }
}

const isRecovery = (text: string): boolean => text.includes("import_status = 'importing'")

describe('PostgresImportExecutor.openBatch', () => {
  it('takes the workspace lock and recovers interrupted imports once, before any worker', async () => {
    const { executor, sql, workers } = setup()

    const batch = await executor.openBatch()

    const lockAt = sql.findIndex((text) => text.includes('pg_try_advisory_lock'))
    const recoverAt = sql.findIndex(isRecovery)
    expect(lockAt).toBeGreaterThanOrEqual(0)
    expect(recoverAt).toBeGreaterThan(lockAt)
    expect(workers).toHaveLength(0)
    await batch.close()
  })

  it('runs every file in its own worker, leased to the control connection', async () => {
    const { executor, workers } = setup()
    const batch = await executor.openBatch()

    const first = batch.importFile({ filePath: '/stage/a.vcf.gz', caseName: 'A' })
    const second = batch.importFile({ filePath: '/stage/b.vcf.gz', caseName: 'B' })

    expect(workers).toHaveLength(2)
    expect(workers.map((w) => w.message?.caseName)).toEqual(['A', 'B'])
    for (const worker of workers) {
      expect(worker.message).toMatchObject({
        mode: 'single-file',
        schema: 'tenant',
        lease: { holderPid: 4242 }
      })
    }
    workers[1].complete(12)
    workers[0].complete(11)
    expect(await first).toMatchObject({ caseId: 11, variantCount: 7 })
    expect(await second).toMatchObject({ caseId: 12, variantCount: 7 })
    await batch.close()
  })

  it('cancelAll reaches every file still in flight and nothing that already finished', async () => {
    const { executor, workers } = setup()
    const batch = await executor.openBatch()
    const first = batch.importFile({ filePath: '/stage/a.vcf.gz', caseName: 'A' })
    void batch.importFile({ filePath: '/stage/b.vcf.gz', caseName: 'B' }).catch(() => undefined)
    void batch.importFile({ filePath: '/stage/c.vcf.gz', caseName: 'C' }).catch(() => undefined)
    workers[0].complete(11)
    await first

    batch.cancelAll()

    expect(workers[0].cancel).not.toHaveBeenCalled()
    expect(workers[1].cancel).toHaveBeenCalledTimes(1)
    expect(workers[2].cancel).toHaveBeenCalledTimes(1)
  })

  it('close cleans up what cancelled or crashed files left behind, then releases the workspace', async () => {
    const { executor, sql, control } = setup()
    const batch = await executor.openBatch()
    const before = sql.filter(isRecovery).length

    await batch.close()

    expect(sql.filter(isRecovery).length).toBe(before + 1)
    expect(sql.at(-1)).toBe('END')
    expect(control.end).toHaveBeenCalledTimes(1)
  })

  it('refuses with a conflict, and leaves no connection open, when another import holds the workspace', async () => {
    const { executor, control, workers } = setup(false)

    await expect(executor.openBatch()).rejects.toMatchObject({
      name: 'ConflictError',
      message: expect.stringMatching(/already in progress/)
    })
    expect(control.end).toHaveBeenCalledTimes(1)
    expect(workers).toHaveLength(0)
  })

  it('leaves the single-file path untouched: its worker takes the lock itself', async () => {
    const { executor, workers, control } = setup()
    const run = executor.importSingleFile({ filePath: '/stage/a.vcf.gz', caseName: 'A' })
    await Promise.resolve()
    expect(workers[0].message?.lease).toBeUndefined()
    expect(control.connect).not.toHaveBeenCalled()
    workers[0].complete(1)
    await run
  })

  describe('when the control connection is lost mid-batch', () => {
    /** A control client that can emit `error`, as a pg Client does. */
    function setupWithLiveControl() {
      const control = Object.assign(new EventEmitter(), {
        connect: vi.fn(async () => undefined),
        query: vi.fn(async (text: string) => {
          if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] }
          if (text.includes('pg_backend_pid')) return { rows: [{ pid: 4242 }] }
          return { rows: [] }
        }),
        end: vi.fn(async () => undefined)
      })
      const workers: FakeWorker[] = []
      const executor = new PostgresImportExecutor({
        schema: 'tenant',
        clientConfig: CLIENT_CONFIG,
        workerClientFactory: () => {
          const worker = new FakeWorker()
          workers.push(worker)
          return worker as never
        },
        controlClientFactory: () => control as never
      })
      return { executor, control, workers }
    }

    /** What a worker posts after it was cancelled cooperatively. */
    const completeCancelled = (worker: FakeWorker): void =>
      worker.callbacks?.onComplete({
        type: 'complete',
        mode: 'single-file',
        result: {
          caseId: 0,
          variantCount: 0,
          skipped: 0,
          errors: ['Import cancelled by user'],
          elapsed: 0
        }
      })

    it('fails the files in flight instead of reporting them imported as case 0', async () => {
      const { executor, control, workers } = setupWithLiveControl()
      const batch = await executor.openBatch()
      const inFlight = batch.importFile({ filePath: '/stage/a.vcf.gz', caseName: 'A' })

      control.emit('error', new Error('terminating connection due to administrator command'))
      expect(workers[0].cancel).toHaveBeenCalledTimes(1)
      completeCancelled(workers[0])

      // The batch session counts whatever resolves as a success.
      await expect(inFlight).rejects.toThrow(/control connection lost/)
      await batch.close()
    })

    it('refuses files started afterwards', async () => {
      const { executor, control, workers } = setupWithLiveControl()
      const batch = await executor.openBatch()

      control.emit('error', new Error('boom'))

      await expect(
        batch.importFile({ filePath: '/stage/b.vcf.gz', caseName: 'B' })
      ).rejects.toThrow(/control connection lost/)
      expect(workers).toHaveLength(0)
      await batch.close()
    })

    it('close still ends the control client, so its workspace lock cannot outlive the batch', async () => {
      const { executor, control } = setupWithLiveControl()
      const batch = await executor.openBatch()
      control.emit('error', new Error('boom'))
      // pg can report one loss twice: again when the socket finally ends.
      control.end.mockImplementation(async () => {
        control.emit('error', new Error('Connection terminated unexpectedly'))
      })

      await expect(batch.close()).resolves.toBeUndefined()

      expect(control.end).toHaveBeenCalledTimes(1)
    })
  })
})
